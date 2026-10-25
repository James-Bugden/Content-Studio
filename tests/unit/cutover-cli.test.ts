import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

it('npm run cutover -- status prints a correct table with mocked fetch and TTY, without network or credential files', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-cutover-cli-'));
  const bearer = ['synthetic-cli', 'bearer-test'].join('-');
  try {
    mkdirSync(join(root, 'scripts'));
    for (const file of ['cutover.mjs', 'env-setup.mjs', 'env-manifest.json']) copyFileSync(join('scripts',file),join(root,'scripts',file));
    writeFileSync(join(root,'package.json'),JSON.stringify({private:true,type:'module',scripts:{cutover:'node scripts/cutover.mjs'}}));
    const preload=join(root,'mock.mjs');
    writeFileSync(preload,`
      const bearer = ['synthetic-cli', 'bearer-test'].join('-');
      Object.defineProperty(process.stdin,'isTTY',{value:true});
      Object.defineProperty(process.stdout,'isTTY',{value:true});
      process.stdin.setRawMode = () => {};
      process.stdin.resume = () => queueMicrotask(() => process.stdin.emit('data',Buffer.from(bearer+'\\r')));
      globalThis.fetch = async (url, init) => {
        if(init.headers.Authorization !== 'Bearer '+bearer || init.redirect !== 'error') throw new Error('Mock request refused');
        if(url === 'https://mock.example.com/api/health') return Response.json({ok:true,mode:'live',commit:'a'.repeat(40),capabilities:[]});
        if(url === 'https://mock.example.com/api/ops/content-cutover' && init.method === 'GET') return Response.json({ok:true,status:{build:'a'.repeat(40),contract:'schema-2:cutover-1',deploymentId:null,store:'db-shadow',epoch:'none',writesDisabled:true,evidenceAgesMs:{parity:0,'phase-c':null,rehearsal:null,backup:null},waivers:{calendar:{audited:false},backup:{audited:false}},gates:{'db-read':{ok:true,reasons:[]},db:{ok:false,reasons:['parity_not_green']}}}});
        throw new Error('No network is allowed');
      };
    `);
    const npmCli=process.env.npm_execpath ?? join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
    expect(existsSync(npmCli)).toBe(true);
    const env={...process.env,APP_BASE_URL:'https://mock.example.com',NODE_OPTIONS:`--import=${pathToFileURL(preload).href}`,FORCE_COLOR:'0'};
    const manifest=JSON.parse(readFileSync('scripts/env-manifest.json','utf8'));
    for(const entry of manifest.variables) if(entry.secret && entry.name!=='APP_BASE_URL') delete env[entry.name as keyof typeof env];
    delete env['CS_CUTOVER_BEARER' as keyof typeof env];
    let output='';
    try { output=execFileSync(process.execPath,[npmCli,'run','cutover','--','status'],{cwd:root,env,encoding:'utf8',timeout:20_000,stdio:['pipe','pipe','pipe']}); }
    catch(error) { const result=error as {status:number;stdout:Buffer|string};expect(result.status).toBe(1);output=String(result.stdout); }
    expect(output).toContain('step | result | reason');
    expect(output).toContain('gate db-read | PASS | server green');
    expect(output).toContain('gate db | FAIL | parity_not_green');
    expect(output).not.toContain(bearer);
    const scan=(path:string):void=>{for(const entry of readdirSync(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())scan(file);else expect(readFileSync(file,'utf8')).not.toContain(bearer);}};
    scan(root);
    const journal=join(root,'artifacts','cutover-owner');
    expect(readdirSync(journal).some(name=>name.startsWith('run-'))).toBe(true);
    expect(readdirSync(journal)).not.toContain('run.lock');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

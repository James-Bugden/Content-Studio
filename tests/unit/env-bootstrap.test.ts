import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { schema } from '@/lib/env';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
// Scripts deliberately have no runtime TypeScript/dependency requirement.
// @ts-expect-error JavaScript CLI module
import { command, launch, manifest, options, parseNames, setup } from '../../scripts/env-setup.mjs';
// @ts-expect-error JavaScript CLI module
import { compareHealth, verify } from '../../scripts/env-verify.mjs';

const secret = 'synthetic-bootstrap-secret-DO-NOT-LOG';
const header = '  name  value  environments  created\n';
const ok = (stdout = '') => ({ ok: true, stdout });
type Entry = { name: string; required: boolean; schemaRequired: boolean; secret: boolean; default: string | null; schemaDefault: string | null; lastpass?: string; field?: string; managed?: boolean; capabilities: string[] };
function harness(initial: string[] = []) {
  const names = new Set(initial);
  const logs: string[] = [];
  const run = vi.fn(async (file: string, args: string[], _input?: string) => {
    if (file === 'vercel' && args[1] === 'ls') return ok(header + [...names].map(n => `  ${n} Encrypted Production now`).join('\n'));
    if (file === 'vercel') { names.add(args[2]!); return ok(); }
    if (args[0] === 'show') return ok(`${secret}\n`);
    return ok();
  });
  return { run, names, logs, env: {}, tty: true, project: 'content-studio', log: (s: string) => logs.push(s) };
}
beforeEach(() => vi.clearAllMocks());

describe('manifest is derived from the Zod schema', () => {
  it('covers every key exactly once, requiredness, defaults and validates production defaults', () => {
    const entries = manifest.variables as Entry[];
    expect(entries.map(v => v.name).sort()).toEqual(Object.keys(schema.shape).sort());
    for (const item of entries) {
      const field = schema.shape[item.name as keyof typeof schema.shape];
      const parsed = field.safeParse(undefined);
      expect(item.schemaRequired, item.name).toBe(!parsed.success);
      expect(item.schemaDefault, item.name).toBe(parsed.success ? parsed.data ?? null : null);
      if (item.default !== null) expect(field.safeParse(item.default).success, item.name).toBe(true);
      expect(item.capabilities.every(c => Object.hasOwn(manifest.capabilities, c))).toBe(true);
      if (item.secret) { expect(item.default).toBeNull(); expect(item.lastpass).toBe(`content-studio/${item.name}`); expect(item.field).toBe('password'); }
    }
    expect(manifest.variables.find((v: Entry) => v.name === 'CS_CONTENT_STORE').default).toBe('sheet');
  });
});

describe('setup guards and mutation semantics', () => {
  it.each([['CI', { env: { CI: 'true' } }, ['--yes']], ['TTY', { tty: false }, []], ['project', { project: 'other' }, []]])('refuses %s before any process is started', async (_name, overrides, args) => {
    const h = harness();
    await expect(setup(args, { ...h, ...overrides })).rejects.toThrow();
    expect(h.run).not.toHaveBeenCalled();
  });
  it('allows explicit --yes without a TTY but never bypasses CI', async () => {
    expect(await setup(['--yes', '--dry-run'], { ...harness(), tty: false })).toBe(0);
  });
  it.each([['--unknown'],['--only'],['--only','unknown'],['--rotate'],['--rotate','UNKNOWN']])('rejects malformed options %s', (...args) => {
    expect(() => options(args)).toThrow('Invalid arguments');
  });
  it('dry-run only lists names, even with generation and rotation requested', async () => {
    const h = harness(['CRON_SECRET']);
    expect(await setup(['--dry-run','--generate-cron-secret','--rotate','CRON_SECRET'], h)).toBe(0);
    expect(h.run.mock.calls.every(([file, args]) => file === 'vercel' && args[1] === 'ls')).toBe(true);
  });
  it('never bootstraps deployment-owned or test variables', async () => {
    const h = harness();
    await setup(['--dry-run'],h);
    for (const name of ['VERCEL_ENV','VERCEL_GIT_COMMIT_SHA','CS_COMMIT_SHA','CS_TEST_MODE','CS_BACKUP_GATE_WAIVED']) expect(h.logs.join(' ')).not.toContain(name);
    expect(() => options(['--rotate', 'CS_BACKUP_GATE_WAIVED'])).toThrow('Invalid arguments');
  });
  it('preserves all existing values and honors --only', async () => {
    const h = harness(['TYPEFULLY_API_KEY','TYPEFULLY_SOCIAL_SET_ID']);
    expect(await setup(['--only','typefully'], h)).toBe(0);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.logs.join(' ')).toContain('skipped: TYPEFULLY_API_KEY, TYPEFULLY_SOCIAL_SET_ID');
  });
  it('adds secrets on stdin, with no secrets in argv, env, or logs; verifies names after add', async () => {
    const h = harness();
    expect(await setup(['--only','typefully'], h)).toBe(0);
    const writes = h.run.mock.calls.filter(([file,args]) => file === 'vercel' && args[1] === 'add');
    expect(writes).toHaveLength(2);
    expect(writes.every(([, , input]) => input === secret)).toBe(true);
    expect(JSON.stringify(h.run.mock.calls.map(([f,a]) => [f,a])) + JSON.stringify(h.env) + h.logs.join(' ')).not.toContain(secret);
    expect(h.run.mock.calls.filter(([,args]) => args[1] === 'ls')).toHaveLength(5);
  });
  it('sets conditional AI defaults after the key is added; never sets them without a key', async () => {
    const h = harness();
    await setup(['--only','ai'],h);
    expect(h.run.mock.calls).toContainEqual(['vercel', ['env','add','AI_PROVIDER','production','--scope','james-projects-1242b366'], 'anthropic']);
    expect(h.run.mock.calls).toContainEqual(['vercel', ['env','add','AI_MODEL','production','--scope','james-projects-1242b366'], 'claude-sonnet-5-5']);
    const missing = harness();
    missing.run.mockImplementation(async (file,args) => file === 'vercel' ? ok(header) : args[0] === 'show' ? {ok:false,stdout:''} : ok());
    await setup(['--only','ai'],missing);
    expect(missing.run.mock.calls.some(([,args]) => args[1] === 'add')).toBe(false);
  });
  it('rotates only the explicit existing name with update, never remove/add', async () => {
    const h = harness(['TYPEFULLY_API_KEY']);
    await setup(['--rotate','TYPEFULLY_API_KEY'],h);
    expect(h.run.mock.calls.filter(([f,a])=>f === 'vercel' && a[1] !== 'ls')).toEqual([['vercel',['env','update','TYPEFULLY_API_KEY','production','--scope','james-projects-1242b366','--yes'],secret]]);
    await expect(setup(['--rotate','AUTH_SECRET'],h)).rejects.toThrow('existing');
    expect(() => options(['--only','ai','--rotate','AUTH_SECRET'])).toThrow();
    expect(() => options(['--rotate','VERCEL_ENV'])).toThrow();
  });
  it.each(['missing CLI','logged out'])('stops on LastPass %s with actionable redacted error', async () => {
    const h = harness();
    h.run.mockImplementation(async (file) => file === 'vercel' ? ok(header) : {ok:false,stdout:secret});
    await expect(setup(['--only','auth','--from','lastpass'],h)).rejects.toThrow('lpass login');
    expect(h.run.mock.calls.some(([,a])=>a[0] === 'show')).toBe(false);
  });
  it('reports missing required entries as failures and optional entries as skipped', async () => {
    const h = harness();
    h.run.mockImplementation(async (file,args) => file === 'vercel' ? ok(header) : args[0] === 'show' ? {ok:false,stdout:secret} : ok());
    expect(await setup(['--only','auth'],h)).toBe(1);
    expect(h.logs.join(' ')).toContain('content-studio/AUTH_SECRET');
    expect(h.logs.join(' ')).not.toContain(secret);
    expect(h.run.mock.calls.some(([,a])=>a[1] === 'add')).toBe(false);
  });
  it('treats an empty password as missing and never generates non-cron secrets', async () => {
    const h = harness();
    const original = h.run.getMockImplementation()!;
    h.run.mockImplementation(async (f,a,i) => f === 'lpass' && a[0] === 'show' ? ok(' \n') : original(f,a,i));
    expect(await setup(['--only','auth','--generate-cron-secret'],h)).toBe(1);
    expect(h.run.mock.calls.some(([,a])=>a[0] === 'add' || a[1] === 'add')).toBe(false);
  });
  it('does not overwrite a concurrent addition', async () => {
    const h = harness();
    const original = h.run.getMockImplementation()!;
    h.run.mockImplementation(async (f,a,i) => { if (f === 'lpass' && a[0] === 'show') h.names.add('CRON_SECRET'); return original(f,a,i); });
    await setup(['--only','cron'],h);
    expect(h.run.mock.calls.some(([,a])=>a[1] === 'add')).toBe(false);
  });
  it('generates cron only on request, saves to LastPass first, then Vercel', async () => {
    const h = harness();
    const original = h.run.getMockImplementation()!;
    h.run.mockImplementation(async (f,a,i) => f === 'lpass' && a[0] === 'show' ? {ok:false,stdout:''} : original(f,a,i));
    await setup(['--only','cron','--generate-cron-secret'],h);
    const save = h.run.mock.calls.find(([f,a]) => f === 'lpass' && a[0] === 'add')!;
    const write = h.run.mock.calls.find(([f,a]) => f === 'vercel' && a[1] === 'add')!;
    expect(write[2]).toMatch(/^[a-f0-9]{64}$/);
    expect(save[2]).toBe(`Password: ${write[2]}\n`);
    expect(h.run.mock.calls.indexOf(save)).toBeLessThan(h.run.mock.calls.indexOf(write));
    expect(h.logs.join(' ')).not.toContain(write[2]);
  });
  it.each(['vault','save'])('refuses cron generation on %s failure', async (failure) => {
    const h = harness();
    h.run.mockImplementation(async (f,a) => f === 'vercel' ? ok(header) : a[0] === 'show' || a[0] === (failure === 'vault' ? 'ls' : 'add') ? {ok:false,stdout:''} : ok());
    await expect(setup(['--only','cron','--generate-cron-secret'],h)).rejects.toThrow();
    expect(h.run.mock.calls.some(([f,a])=>f === 'vercel' && a[1] === 'add')).toBe(false);
  });
  it('never generates over an existing LastPass entry, on rotation, or without the generator flag', async () => {
    for (const mode of ['existing','rotation','no-flag']) {
      const h = harness(mode === 'rotation' ? ['CRON_SECRET'] : []);
      const original = h.run.getMockImplementation()!;
      h.run.mockImplementation(async (f,a,i) => {
        if (f === 'lpass' && a[0] === 'show') return {ok:false,stdout:''};
        if (f === 'lpass' && a[0] === 'ls') return ok('content-studio/CRON_SECRET\n');
        return original(f,a,i);
      });
      const args = mode === 'rotation' ? ['--rotate','CRON_SECRET','--generate-cron-secret'] : ['--only','cron',...(mode === 'existing' ? ['--generate-cron-secret'] : [])];
      if (mode === 'existing') await expect(setup(args,h)).rejects.toThrow('absent');
      else expect(await setup(args,h)).toBe(mode === 'rotation' ? 1 : 0);
      expect(h.run.mock.calls.some(([,a])=>a[0] === 'add' || a[1] === 'add' || a[1] === 'update')).toBe(false);
    }
  });
  it('does not claim success unless a successful write is visible in the name recheck', async () => {
    const h = harness();
    h.run.mockImplementation(async (f,a) => f === 'vercel' && a[1] === 'ls' ? ok(header) : f === 'lpass' && a[0] === 'show' ? ok(secret) : ok());
    expect(await setup(['--only','typefully'],h)).toBe(1);
    expect(h.logs).toContain('failed: TYPEFULLY_API_KEY, TYPEFULLY_SOCIAL_SET_ID');
  });
  it('fails closed on listing errors, unknown table format, and failed mutations', async () => {
    expect(() => parseNames('unexpected')).toThrow();
    expect(parseNames('No Environment Variables found')).toEqual(new Set());
    const h = harness();
    h.run.mockResolvedValue({ok:false,stdout:secret});
    await expect(setup([],h)).rejects.toThrow('Cannot list');
    const failed = harness();
    const original = failed.run.getMockImplementation()!;
    failed.run.mockImplementation(async (f,a,i) => f === 'vercel' && a[1] === 'add' ? {ok:false,stdout:secret} : original(f,a,i));
    expect(await setup(['--only','typefully'],failed)).toBe(1);
    expect(failed.logs.join(' ')).not.toContain(secret);
  });
});

describe('child process isolation', () => {
  it('bounds captured output and handles the empty-list stderr notice without exposing it', async () => {
    for (const oversized of [true,false]) {
      const kill = vi.fn();
      vi.mocked(spawn).mockImplementation(() => {
        const child = Object.assign(new EventEmitter(), {stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill});
        queueMicrotask(()=> {
          if (oversized) child.stdout.write('x'.repeat(1_048_577));
          else child.stderr.write('No Environment Variables found for private-project-name');
          child.emit('close',0);
        });
        return child as unknown as ReturnType<typeof spawn>;
      });
      const result = await command('vercel',['env','ls','production']);
      expect(result.ok).toBe(!oversized);
      expect(result.stdout).toBe(oversized ? '' : 'No Environment Variables found');
      expect(kill).toHaveBeenCalledTimes(oversized ? 1 : 0);
    }
  });
  it('resolves the Windows npm shim without a shell and native LastPass directly', () => {
    const entry = 'C:\\tools\\node_modules\\vercel\\dist\\vc.js';
    expect(launch('vercel',{platform:'win32',path:'C:\\tools',exists:(p:string)=>p === entry})).toEqual({file:process.execPath,prefix:[entry]});
    expect(launch('lpass',{platform:'win32',path:'C:\\tools',exists:(p:string)=>p === 'C:\\tools\\lpass.exe'})).toEqual({file:'C:\\tools\\lpass.exe',prefix:[]});
    expect(launch('vercel',{platform:'linux'})).toEqual({file:'vercel',prefix:[]});
  });
  it.each(['success','exit','error','stdin','throw'])('never leaks secret from %s or uses argv/env/shell for stdin', async (kind) => {
    let received = '';
    vi.mocked(spawn).mockImplementation((..._args: unknown[]) => {
      if (kind === 'throw') throw new Error(secret);
      const child = Object.assign(new EventEmitter(), {stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
      child.stdin.on('data', d => received += d.toString());
      queueMicrotask(() => {
        child.stderr.write(secret);
        if (kind === 'error') child.emit('error', new Error(secret));
        else if (kind === 'stdin') child.stdin.emit('error',new Error(secret));
        else { child.stdout.write(kind === 'success' ? 'names only' : secret); child.emit('close',kind === 'success' ? 0 : 1); }
      });
      return child as unknown as ReturnType<typeof spawn>;
    });
    const log = vi.spyOn(console,'log');
    const error = vi.spyOn(console,'error');
    vi.stubEnv('AUTH_SECRET', secret);
    vi.stubEnv('VERCEL_PROJECT_ID', 'synthetic-override');
    const result = await command('vercel',['env','add','AUTH_SECRET','production'],secret);
    vi.unstubAllEnvs();
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.ok).toBe(kind === 'success');
    expect(JSON.stringify(vi.mocked(spawn).mock.calls)).not.toContain(secret);
    expect(vi.mocked(spawn).mock.calls[0]![2]).toMatchObject({shell:false,stdio:['pipe','pipe','pipe'],timeout:60_000});
    expect(vi.mocked(spawn).mock.calls[0]![2]?.env).not.toHaveProperty('VERCEL_PROJECT_ID');
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    if (kind !== 'throw') expect(received).toBe(secret);
    log.mockRestore(); error.mockRestore();
  });
});

const health = () => ({ok:true,mode:'live',capabilities:['auth','sheet','drive','typefully','ai'].map(provider=>({provider,mode:'live',state:provider === 'sheet' || provider === 'drive' ? 'read_only' : provider === 'auth' ? 'ready' : 'not_configured'}))});
describe('health verification', () => {
  it('accepts safe read-only Google and optional not_configured; unreported is not a pass', () => {
    const result = compareHealth(health());
    expect(result.code).toBe(0);
    expect(result.rows.find((r: {capability:string})=>r.capability === 'cron').result).toBe('unverified');
  });
  it.each(['not_configured','error','degraded','unavailable'])('fails required auth %s distinctly', state => {
    const h = health(); h.capabilities[0]!.state = state;
    const result = compareHealth(h);
    expect(result.code).toBe(1);
    expect(result.rows[0].state).toBe(state === 'not_configured' ? 'not_configured' : 'error');
  });
  it('refuses fake, missing, duplicate, and optional provider errors', () => {
    expect(compareHealth({...health(),mode:'fake'}).code).toBe(1);
    expect(compareHealth({...health(),capabilities:[]}).code).toBe(1);
    const h = health(); h.capabilities.push(h.capabilities[0]!);
    expect(compareHealth(h).code).toBe(1);
    const optional = health(); optional.capabilities[4]!.state='error';
    expect(compareHealth(optional).code).toBe(1);
  });
  it('fetches only the public health origin without redirect and prints a safe table', async () => {
    const fetcher = vi.fn().mockResolvedValue({ok:true,json:async()=>health()});
    const log = vi.fn();
    expect(await verify({baseUrl:'https://synthetic.example',fetcher,log})).toBe(0);
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://synthetic.example/api/health');
    expect(fetcher.mock.calls[0]![1].redirect).toBe('error');
    expect(log.mock.calls[0]![0]).toContain('capability | required');
  });
  const credentialOrigin = new URL('https://synthetic.example');
  credentialOrigin.username = 'synthetic';
  credentialOrigin.password = 'synthetic';
  it.each(['http://synthetic.example',String(credentialOrigin),'https://synthetic.example/private',undefined])('rejects invalid origin %s before network', async baseUrl => {
    const fetcher = vi.fn();
    expect(await verify({baseUrl,fetcher,log:vi.fn()})).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('suppresses network/response secrets', async () => {
    const log = vi.fn();
    for (const response of [Promise.reject(new Error(secret)),Promise.resolve({ok:false}),Promise.resolve({ok:true,json:async()=>({secret})})]) {
      expect(await verify({baseUrl:'https://synthetic.example',fetcher:()=>response,log})).toBe(1);
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });
  it('rejects an HTTP error even if its body claims every capability is ready', async () => {
    expect(await verify({baseUrl:'https://synthetic.example',fetcher:async()=>({ok:false,json:async()=>health()}),log:vi.fn()})).toBe(1);
  });
});

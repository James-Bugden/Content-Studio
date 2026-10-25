import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { type Stats, mkdtempSync, writeFileSync, unlinkSync, rmdirSync, fstatSync, realpathSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error dependency-free CLI
import { hiddenPrompt, selectSource, readSecretsFile, setup, options } from '../../scripts/env-setup.mjs';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {...actual, readFileSync: vi.fn(actual.readFileSync), fstatSync: vi.fn(actual.fstatSync), realpathSync: vi.fn(actual.realpathSync), existsSync: vi.fn(actual.existsSync)};
});

const secret = 'synthetic-secret-source-sentinel';
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) { unlinkSync(join(dir, 'secrets')); rmdirSync(dir); } });
const secretLine = (name: string, value: string) => [name, value].join('=');
function fixture(text = [secretLine('TYPEFULLY_API_KEY', secret), secretLine('TYPEFULLY_SOCIAL_SET_ID', secret)].join('\n')) {
  const dir = mkdtempSync(join(tmpdir(), 'cs-env-sources-'));
  scratch.push(dir);
  const path = join(dir, 'secrets'); writeFileSync(path, text, { mode: 0o600 }); return path;
}
function tty() {
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode: vi.fn() });
  const output = Object.assign(new PassThrough(), { isTTY: true });
  let printed = ''; output.on('data', chunk => { printed += chunk; });
  return { input, output, printed: () => printed };
}
function harness(initial: string[] = []) {
  const names = new Set(initial);
  const log = vi.fn();
  const run = vi.fn(async (file: string, args: string[], _input?: string) => {
    if (file === 'icacls') return { ok: true, stdout: 'private-owner:(F)' };
    if (file === 'lpass') return { ok: false, stdout: secret };
    if (args[1] !== 'ls') names.add(args[2]!);
    return { ok: true, stdout: 'name value environments created\n' + [...names].map(n => `${n} Encrypted Production now`).join('\n') };
  });
  return { run, log, tty: true, env: {}, project: 'content-studio' };
}
describe('secret source guards', () => {
  it('reads a hidden TTY without ever echoing a value and restores raw mode', async () => {
    const t = tty(); const result = hiddenPrompt('AUTH_SECRET', 2, 5, t.input, t.output);
    t.input.emit('data', Buffer.from(secret + '\r'));
    expect(await result).toBe(secret);
    expect(t.printed()).toContain('AUTH_SECRET (2 of 5)');
    expect(t.printed()).not.toContain(secret);
    expect(t.input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(t.input.listenerCount('data')).toBe(0);
    expect(t.input.isPaused()).toBe(true);
  });
  it.each(['input','output','raw'])('refuses absent %s TTY capability', kind => {
    const t = tty();
    if (kind === 'input') t.input.isTTY = false;
    if (kind === 'output') t.output.isTTY = false;
    if (kind === 'raw') Object.assign(t.input, {setRawMode: undefined});
    expect(() => hiddenPrompt('AUTH_SECRET', 1, 1, t.input, t.output)).toThrow('TTY');
    expect(t.printed()).toBe('');
  });
  it.each(['\x03','\x04','end','error'])('cancels and restores the terminal on %s', async end => {
    const t = tty(); const result = hiddenPrompt('AUTH_SECRET', 1, 1, t.input, t.output);
    t.input.emit('data', Buffer.from(secret));
    if (end === 'end' || end === 'error') t.input.emit(end); else t.input.emit('data', Buffer.from(end));
    await expect(result).rejects.toThrow('cancelled');
    expect(t.input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(t.printed()).not.toContain(secret);
  });
  it('handles blank, backspace and bracketed multiline paste without echo', async () => {
    for (const [input, expected] of [['\r',''], ['x\x7f' + secret + '\r',secret], ['\x1b[200~line1\nline2\x1b[201~\r','line1\nline2']]) {
      const t = tty(); const result = hiddenPrompt('AUTH_SECRET', 1, 1, t.input, t.output);
      for (const c of input!) t.input.emit('data', Buffer.from(c));
      expect(await result).toBe(expected); expect(t.printed()).not.toContain('line1'); expect(t.printed()).not.toContain(secret);
    }
  });
  it('selects LastPass only when installed and logged in; explicit choices never probe it', async () => {
    for (const available of [true,false]) {
      const run = vi.fn().mockResolvedValue({ok: available, stdout: secret});
      expect(await selectSource(null,run)).toBe(available ? 'lastpass' : 'prompt');
      expect(run).toHaveBeenCalledWith('lpass',['status','--quiet']);
    }
    const run = vi.fn();
    for (const source of ['prompt','file','lastpass']) expect(await selectSource(source,run)).toBe(source);
    expect(run).not.toHaveBeenCalled();
  });
  it.each([['--from'], ['--from','other'], ['--from','file'], ['--from','file','--secrets-file'], ['--secrets-file','outside'], ['--from','prompt','--secrets-file','outside'], ['--from','prompt','--generate-cron-secret'], ['--from','file','--secrets-file','outside','--generate-cron-secret']])('rejects invalid source options %s', (...args) => {
    expect(() => options(args)).toThrow();
  });
  it('skips blanks, uses only stdin, and retains explicit rotation semantics', async () => {
    const h = harness(['TYPEFULLY_API_KEY']);
    const prompt = vi.fn().mockResolvedValue(secret);
    expect(await setup(['--from','prompt','--rotate','TYPEFULLY_API_KEY'], {...h,prompt})).toBe(0);
    expect(prompt).toHaveBeenCalledExactlyOnceWith('TYPEFULLY_API_KEY',1,1);
    expect(h.run.mock.calls.filter(([f,a]) => f === 'vercel' && a[1] !== 'ls')).toEqual([['vercel',['env','update','TYPEFULLY_API_KEY','production','--scope','james-projects-1242b366','--yes'],secret]]);
    expect(JSON.stringify(h.run.mock.calls.map(([f,a]) => [f,a])) + JSON.stringify(h.log.mock.calls)).not.toContain(secret);
    const blank = harness();
    expect(await setup(['--from','prompt','--only','auth'], {...blank,prompt:vi.fn().mockResolvedValue('')})).toBe(0);
    expect(blank.run.mock.calls.every(([,a])=>a[1] === 'ls')).toBe(true);
  });
  it('cannot bypass prompt TTY using --yes and falls back to prompt by default', async () => {
    const h = harness(); const prompt = vi.fn().mockResolvedValue(secret);
    await expect(setup(['--yes','--from','prompt','--only','cron'], {...h,tty:false,prompt})).rejects.toThrow('TTY');
    expect(prompt).not.toHaveBeenCalled();
    expect(await setup(['--only','cron'], {...h,prompt})).toBe(0);
    expect(prompt).toHaveBeenCalledExactlyOnceWith('CRON_SECRET',1,1);
    await expect(setup(['--only','cron','--generate-cron-secret'],harness())).rejects.toThrow('requires --from lastpass');
  });
  it('refuses files in this worktree without printing contents or paths', async () => {
    for (const file of ['scripts/env-manifest.json','package.json']) {
      await expect(readSecretsFile(resolve(file),vi.fn())).rejects.toThrow('Secrets file refused');
    }
  });
  it('reads outside files, warns plaintext, never logs values, and preserves rotation', async () => {
    const path = fixture(); const h = harness(['TYPEFULLY_API_KEY']);
    expect(await setup(['--from','file','--secrets-file',path,'--rotate','TYPEFULLY_API_KEY'],h)).toBe(0);
    expect(h.log.mock.calls.flat().join(' ')).toContain('plaintext');
    expect(JSON.stringify(h.log.mock.calls)).not.toContain(secret);
    expect(h.run.mock.calls.find(([,a])=>a[1] === 'update')?.[2]).toBe(secret);
    expect(h.run.mock.calls.some(([f])=>f === 'lpass')).toBe(false);
  });
  it.each(['Everyone:(R)', 'Everyone:(GR)', 'Everyone:(RD,RC)', 'BUILTIN\\Users:(I)(RX)', 'Authenticated Users:(F)', 'S-1-1-0:(M)', 'S-1-5-11:(R)', 'S-1-5-32-545:(RX)', 'failure'])('refuses detectable Windows broad ACL %s', async acl => {
    await expect(readSecretsFile(fixture(),vi.fn().mockResolvedValue({ok:acl !== 'failure',stdout:acl}),'win32')).rejects.toThrow('Secrets file refused');
  });
  it('accepts private POSIX mode and refuses group/world-readable permissions', async () => {
    const path = fixture();
    const stat = {mode:0o600,isFile:()=>true} as Stats;
    for (const mode of [0o600,0o640,0o604]) {
      vi.mocked(fstatSync).mockReturnValueOnce({...stat,mode,isFile:()=>true});
      if (mode === 0o600) expect((await readSecretsFile(path,vi.fn(),'linux')).get('TYPEFULLY_API_KEY')).toBe(secret);
      else await expect(readSecretsFile(path,vi.fn(),'linux')).rejects.toThrow('Secrets file refused');
    }
    vi.mocked(fstatSync).mockReturnValueOnce({...stat,isFile:()=>false});
    await expect(readSecretsFile(path,vi.fn(),'linux')).rejects.toThrow('Secrets file refused');
  });
  it('refuses resolved and lexical in-repo paths even without git markers', async () => {
    const path = fixture();
    const originalExists = vi.mocked(existsSync).getMockImplementation()!;
    const originalRead = vi.mocked(readFileSync).getMockImplementation()!;
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue(`AUTH_SECRET=${secret}`);
    try {
      vi.mocked(realpathSync).mockReturnValueOnce(resolve('package.json'));
      await expect(readSecretsFile(path,harness().run)).rejects.toThrow('Secrets file refused');
      vi.mocked(realpathSync).mockReturnValueOnce(path);
      await expect(readSecretsFile(resolve('package.json'),harness().run)).rejects.toThrow('Secrets file refused');
    } finally {
      vi.mocked(existsSync).mockReset().mockImplementation(originalExists);
      vi.mocked(readFileSync).mockReset().mockImplementation(originalRead);
    }
  });
  it('refuses other git trees independently of the current worktree guard', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true);
    await expect(readSecretsFile(fixture(),harness().run)).rejects.toThrow('Secrets file refused');
  });
  it('preserves UTF-8 across split terminal chunks', async () => {
    const t = tty(); const result = hiddenPrompt('AUTH_SECRET',1,1,t.input,t.output);
    for (const byte of Buffer.from('synthetic-??\r')) t.input.emit('data',Buffer.from([byte]));
    expect(await result).toBe('synthetic-??');
    expect(t.printed()).not.toContain('??');
  });
  it('fails a missing file rotation even for an optional secret', async () => {
    const h = harness(['TYPEFULLY_API_KEY']);
    expect(await setup(['--from','file','--secrets-file',fixture('# absent'),'--rotate','TYPEFULLY_API_KEY'],h)).toBe(1);
    expect(h.run.mock.calls.some(([,a])=>a[1] === 'update')).toBe(false);
  });
  it('fails required file omissions and skips optional blanks without mutation', async () => {
    for (const capability of ['auth','typefully']) {
      const h = harness();
      expect(await setup(['--from','file','--secrets-file',fixture(['# comment', '', secretLine('TYPEFULLY_API_KEY','OPTIONAL=VALUE'), secretLine('TYPEFULLY_SOCIAL_SET_ID','')].join('\n')),'--only',capability],h)).toBe(capability === 'auth' ? 1 : 0);
      if (capability === 'typefully') expect(h.run.mock.calls.find(([,a])=>a[1] === 'add')?.[2]).toBe('OPTIONAL=VALUE');
    }
  });
  it.each([`AUTH_SECRET=${secret}\nAUTH_SECRET=duplicate`, `UNKNOWN=${secret}`, secret, `CS_DATA_MODE=${secret}`])('refuses malformed, duplicate or non-secret file lines without leaking', async text => {
    const h = harness();
    await expect(setup(['--from','file','--secrets-file',fixture(text),'--only','auth'],h)).rejects.toThrow('Secrets file refused');
    expect(JSON.stringify(h.log.mock.calls)).not.toContain(secret);
    expect(h.run.mock.calls.some(([,a])=>a[1] === 'add')).toBe(false);
  });
});

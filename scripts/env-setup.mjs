#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { win32, relative, isAbsolute, resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const manifest = JSON.parse(readFileSync(new URL('./env-manifest.json', import.meta.url), 'utf8'));
class SetupError extends Error {}
const scope = ['--scope', 'james-projects-1242b366'];

// Windows cannot spawn npm .cmd shims without a shell. Launch Vercel's Node
// entry point directly instead; secrets never pass through cmd.exe.
export function launch(file, { platform = process.platform, path = process.env.PATH ?? '', exists = existsSync } = {}) {
  if (platform !== 'win32') return { file, prefix: [] };
  for (const directory of path.split(';').filter(Boolean)) {
    const native = win32.join(directory, `${file}.exe`);
    if (exists(native)) return { file: native, prefix: [] };
    const entry = win32.join(directory, 'node_modules', 'vercel', 'dist', 'vc.js');
    if (file === 'vercel' && exists(entry)) return { file: process.execPath, prefix: [entry] };
  }
  return { file, prefix: [] };
}

// Never expose provider output/errors: either can echo stdin, credentials or IDs.
export function command(file, args, input) {
  return new Promise((resolve) => {
    let stdout = '';
    let emptyList = false;
    let settled = false;
    const finish = (ok) => { if (!settled) { settled = true; resolve({ ok, stdout: ok ? (emptyList && !stdout.trim() ? 'No Environment Variables found' : stdout) : '' }); } };
    try {
      const executable = launch(file);
      const env = { ...process.env, NO_COLOR: '1' };
      for (const item of manifest.variables) delete env[item.name];
      delete env.CS_CUTOVER_BEARER;
      delete env.VERCEL_PROJECT_ID;
      delete env.VERCEL_ORG_ID;
      const child = spawn(executable.file, [...executable.prefix, ...args], { env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, timeout: 60_000 });
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 1_048_576) { child.kill(); finish(false); } });
      child.stderr.on('data', chunk => {
        if (file === 'vercel' && args[1] === 'ls' && /No Environment Variables found/.test(String(chunk))) emptyList = true;
      });
      child.on('error', () => finish(false));
      child.on('close', code => finish(code === 0));
      child.stdin.on('error', () => finish(false));
      child.stdin.end(input ?? '');
    } catch { finish(false); }
  });
}

// Read directly from the terminal in raw mode: no readline echo or shell involved.
export function hiddenPrompt(name, index, total, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') throw new SetupError('Hidden prompt requires a real TTY. Open PowerShell, cmd, or Git Bash.');
  return new Promise((resolveValue, reject) => {
    const decoder = new StringDecoder('utf8');
    let value = '';
    let pasted = false;
    let pending = '';
    const raw = Boolean(input.isRaw);
    const paused = input.readableFlowing !== true;
    const finish = (error) => {
      input.removeListener('data', data);
      input.removeListener('error', failed);
      input.removeListener('end', ended);
      input.setRawMode(raw);
      if (paused) input.pause();
      output.write('\x1b[?2004l\n');
      if (error) { value = ''; reject(new SetupError('Hidden input cancelled or unavailable.')); }
      else resolveValue(value);
    };
    const failed = () => finish(true);
    const ended = () => finish(true);
    const data = chunk => {
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      while (pending.length) {
        if (pending.startsWith('\x1b[200~')) { pasted = true; pending = pending.slice(6); continue; }
        if (pending.startsWith('\x1b[201~')) { pasted = false; pending = pending.slice(6); continue; }
        if ('\x1b[200~'.startsWith(pending) || '\x1b[201~'.startsWith(pending)) return;
        const char = pending[0]; pending = pending.slice(1);
        if (char === '\x03' || char === '\x04') { finish(true); return; }
        if (!pasted && (char === '\r' || char === '\n')) { finish(false); return; }
        if (!pasted && (char === '\x7f' || char === '\b')) value = value.slice(0, -1);
        else if (pasted || char >= ' ') value += char;
      }
    };
    input.on('data', data);
    input.on('error', failed);
    input.on('end', ended);
    input.setRawMode(true);
    output.write(`\x1b[?2004h${name} (${index} of ${total}): `);
    input.resume();
  });
}

export async function selectSource(requested, run) {
  if (requested) return requested;
  return (await run('lpass', ['status', '--quiet'])).ok ? 'lastpass' : 'prompt';
}

export async function readSecretsFile(path, run, platform = process.platform) {
  // Resolve symlinks before containment checks; never include paths or file data in errors.
  let file;
  let fd;
  try {
    file = realpathSync(path);
    const root = realpathSync(new URL('..', import.meta.url));
    for (const candidate of [resolve(path), file]) {
      const rel = relative(root, candidate);
      if (!rel || (rel.split(/[\\/]/)[0] !== '..' && !isAbsolute(rel))) throw new Error();
      for (let directory = dirname(candidate); ; directory = dirname(directory)) {
        if (existsSync(join(directory, '.git'))) throw new Error();
        if (dirname(directory) === directory) break;
      }
    }
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error();
    if (platform === 'win32') {
      const acl = await run('icacls', [file]);
      if (!acl.ok || /(?:Everyone|BUILTIN\\Users|Authenticated Users|S-1-1-0|S-1-5-11|S-1-5-32-545):[^\r\n]*\(/i.test(acl.stdout)) throw new Error();
    } else if (stat.mode & 0o077) throw new Error();
    const values = new Map();
    for (const line of readFileSync(fd, 'utf8').split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (!match || values.has(match[1]) || !manifest.variables.some(v => v.secret && v.name === match[1])) throw new Error();
      values.set(match[1], match[2]);
    }
    return values;
  } catch { throw new SetupError('Secrets file refused: use a private regular file outside this git work tree, with unique known SECRET NAME=value lines and owner-only permissions.'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function options(args) {
  const result = { dryRun: false, yes: false, generateCron: false, only: null, rotate: null, from: null, secretsFile: null };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--from' && ['prompt', 'lastpass', 'file'].includes(args[0])) result.from = args.shift();
    else if (flag === '--secrets-file' && args[0] && !args[0].startsWith('--')) result.secretsFile = resolve(args.shift());
    else if (flag === '--dry-run') result.dryRun = true;
    else if (flag === '--yes') result.yes = true;
    else if (flag === '--generate-cron-secret') result.generateCron = true;
    else if (flag === '--only' && Object.hasOwn(manifest.capabilities, args[0])) result.only = args.shift();
    else if (flag === '--rotate' && manifest.variables.some(v => v.name === args[0] && !v.managed)) result.rotate = args.shift();
    else throw new SetupError('Invalid arguments. Use --dry-run, --yes, --only <capability>, --rotate <NAME>, --generate-cron-secret, --from prompt|lastpass|file, --secrets-file <path>.');
  }
  if ((result.from === 'file') !== Boolean(result.secretsFile)) throw new SetupError('Use --from file together with --secrets-file <path>.');
  if (result.generateCron && result.from && result.from !== 'lastpass') throw new SetupError('Cron generation requires --from lastpass for recoverable vault storage.');
  if (result.rotate && result.only && !manifest.variables.find(v => v.name === result.rotate).capabilities.includes(result.only)) throw new SetupError('Rotation must belong to the selected capability.');
  return result;
}

export function parseNames(stdout) {
  // Vercel's table contains names only here; ignore type/target/time columns.
  if (/No Environment Variables found/i.test(stdout)) return new Set();
  if (!/^\s*name\s+value\s+environments?\s+/im.test(stdout)) throw new SetupError('Cannot parse Vercel environment names; update the CLI/table parser before retrying.');
  return new Set([...stdout.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s+/gm)].map(m => m[1]));
}

export async function setup(args = process.argv.slice(2), deps = {}) {
  const run = deps.run ?? command;
  const log = deps.log ?? console.log;
  const env = deps.env ?? process.env;
  const opts = options([...args]);
  if (env.CI === 'true') throw new SetupError('env:setup refuses CI=true. Run locally.');
  if (!(deps.tty ?? process.stdin.isTTY) && !opts.yes) throw new SetupError('env:setup requires a TTY; use --yes for an intentional local non-interactive run.');
  const linked = deps.project ?? (() => {
    try { return JSON.parse(readFileSync('.vercel/project.json', 'utf8')).projectName; } catch { return null; }
  })();
  if (linked !== 'content-studio') throw new SetupError('Link this checkout to the content-studio Vercel project first (vercel link).');
  const list = async () => {
    const r = await run('vercel', ['env', 'ls', 'production', ...scope]);
    if (!r.ok) throw new SetupError('Cannot list Vercel Production names. Install/login to the Vercel CLI and check project access.');
    return parseNames(r.stdout);
  };
  const existing = await list();
  if (opts.rotate && !existing.has(opts.rotate)) throw new SetupError('Rotation requires an existing Production name. Use normal setup to add it.');
  const summary = { added: [], skipped: [], failed: [] };
  let loggedIn = false;
  let source;
  let fileValues;
  let promptIndex = 0;
  const total = manifest.variables.filter(v => v.secret && !v.managed && (!opts.only || v.capabilities.includes(opts.only)) && (!opts.rotate || v.name === opts.rotate) && (!existing.has(v.name) || opts.rotate === v.name)).length;
  let aiKey = existing.has('AI_API_KEY');
  let current;
  try {
    for (const item of [...manifest.variables].sort((a, b) => Number(Boolean(a.when)) - Number(Boolean(b.when)))) {
      const { name } = item;
      if (item.managed || (opts.only && !item.capabilities.includes(opts.only)) || (opts.rotate && name !== opts.rotate)) continue;
      current = name;
      if ((existing.has(name) && opts.rotate !== name) || (item.when === 'AI_API_KEY' && !aiKey)) { summary.skipped.push(name); continue; }
      if (opts.dryRun) { log(`would ${opts.rotate === name ? 'rotate' : 'add'} ${name}`); continue; }
      let value = item.default;
      if (item.secret) {
        source ??= await selectSource(opts.from, run);
        if (opts.generateCron && source !== 'lastpass') throw new SetupError('Cron generation requires --from lastpass for recoverable vault storage.');
        if (source === 'prompt') {
          if (!(deps.tty ?? process.stdin.isTTY)) throw new SetupError('Hidden prompt requires a real TTY, even with --yes.');
          value = await (deps.prompt ?? hiddenPrompt)(name, ++promptIndex, total);
        } else if (source === 'file') {
          if (!fileValues) {
            log('Warning: secrets file is plaintext; protect and remove it after use.');
            fileValues = await readSecretsFile(opts.secretsFile, run);
          }
          value = fileValues.get(name) ?? '';
        } else {
          if (!loggedIn) {
            const status = await run('lpass', ['status', '--quiet']);
            if (!status.ok) throw new SetupError('LastPass CLI unavailable or not logged in. Install lpass, then run lpass login <email> locally.');
            loggedIn = true;
          }
          const entry = await run('lpass', ['show', '--password', item.lastpass]);
          if (!entry.ok || !entry.stdout.trim()) {
            if (name === 'CRON_SECRET' && opts.generateCron && !opts.rotate) {
              // A failed show is not proof of absence: require a successful vault listing.
              const vault = await run('lpass', ['ls', '--format=%an']);
              if (!vault.ok || vault.stdout.split(/\r?\n/).includes(item.lastpass)) throw new SetupError('Cannot prove CRON_SECRET entry is absent; repair LastPass access and retry.');
              value = randomBytes(32).toString('hex');
              const saved = await run('lpass', ['add', '--non-interactive', item.lastpass], `Password: ${value}\n`);
              if (!saved.ok) throw new SetupError('Cannot save CRON_SECRET in LastPass; Vercel was not changed for this name.');
            } else {
              log(`missing LastPass entry for ${name}; create content-studio/${name} (password field), then retry.`);
              summary[item.required || opts.rotate === name ? 'failed' : 'skipped'].push(name);
              continue;
            }
          } else value = entry.stdout.replace(/\r?\n$/, '');
        }
        if (!value) { summary[source === 'file' && (item.required || opts.rotate === name) ? 'failed' : 'skipped'].push(name); continue; }
      }
      if (value === null) { summary.skipped.push(name); continue; }
      // Recheck immediately before writing. Concurrent additions are conflicts, never updates.
      if (!opts.rotate && (await list()).has(name)) { summary.skipped.push(name); continue; }
      const result = await run('vercel', ['env', opts.rotate === name ? 'update' : 'add', name, 'production', ...scope, ...(opts.rotate === name ? ['--yes'] : [])], value);
      value = undefined;
      const verified = result.ok && (await list()).has(name);
      summary[verified ? 'added' : 'failed'].push(name);
      if (name === 'AI_API_KEY' && verified) aiKey = true;
    }
  } catch (error) {
    if (current && !summary.failed.includes(current)) summary.failed.push(current);
    throw error;
  } finally {
    fileValues?.clear();
    for (const [state, names] of Object.entries(summary)) log(`${state}: ${names.join(', ') || '(none)'}`);
  }
  return summary.failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await setup(); }
  catch (error) { console.error(error instanceof SetupError ? error.message : 'Environment setup stopped; provider error output suppressed. Check CLI access and retry.'); process.exitCode = 1; }
}

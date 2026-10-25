#!/usr/bin/env node
/** Owner-only HTTP runner. No app credentials, provider SDKs or deployment writes. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, lstatSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, rmdirSync, chmodSync, readdirSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { command, hiddenPrompt, selectSource } from './env-setup.mjs';

const commands = ['status', 'measure', 'activate-read', 'backup', 'rollback', 'activate-db', 'export', 'all-prepare', 'smoke'];
const collections = ['library', 'queue', 'ready', 'schedule', 'queue_summary', 'workflow_settings'];
const exportCollections = ['library', 'queue', 'schedule', 'workflow_settings'];
const shaPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const gateReasons = ['invalid_gate', 'full_parity_required', 'parity_not_green', 'backup_waiver_export_not_exact', 'write_proof_missing', 'write_proof_expired', 'phase_c_proof_missing', 'rollback_proof_missing', 'backup_proof_missing', 'gate_unavailable'];
const deploymentPattern = /^dpl_[A-Za-z0-9]{1,128}$/;
const reasons = new Set([...gateReasons, 'cron_auth', 'cutover_contract_mismatch', 'cutover_build_identity', 'cutover_parity_stale', 'stale_parity', 'import_lag', 'contract_mismatch', 'imports_disabled_in_db_mode', 'google_writes_disabled', 'private_backup_folder', 'rollback_store_mode', 'freeze_every_instance_first', 'export_store_mode', 'backup_store_mode', 'export_mismatch', 'markdown_missing', 'cutover_gate', 'parity', 'phase-c', 'backup', 'rehearsal']);
const errorCodes = new Set(['AUTH_REQUIRED', 'FORBIDDEN', 'CONFIG_MISSING', 'SCHEMA_DRIFT', 'NOT_FOUND', 'STALE_READ', 'CONFLICT', 'GATE_BLOCKED', 'AMBIGUOUS_MATCH', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'PARTIAL_FAILURE', 'VALIDATION_FAILED', 'UNKNOWN']);
class CutoverError extends Error {}
const fail = message => { throw new CutoverError(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;

export function parseOptions(args) {
  const opts = { action: args.shift(), from: 'prompt', sha: null, base: null, scheduled: false };
  if (!commands.includes(opts.action)) fail('Use cutover -- status|measure|activate-read|backup|rollback|activate-db|export|all-prepare|smoke.');
  const seen = new Set();
  while (args.length) {
    const flag = args.shift();
    if (flag === '--scheduled' && opts.action === 'backup' && !opts.scheduled) { opts.scheduled = true; continue; }
    const value = args.shift();
    if (seen.has(flag) || !value) fail('Invalid or duplicate option. Use --base-url <HTTPS origin>, --sha <40 lowercase hex>, --from prompt|lastpass|env.');
    seen.add(flag);
    if (flag === '--from' && ['prompt', 'lastpass', 'env'].includes(value)) opts.from = value;
    else if (flag === '--sha' && shaPattern.test(value)) opts.sha = value;
    else if (flag === '--base-url') opts.base = value;
    else fail('Invalid option. Secrets are accepted only by hidden prompt, LastPass or explicit --from env.');
  }
  if (opts.action.startsWith('activate-') && !opts.sha) fail('Activation requires --sha with the reviewed full 40-character git SHA.');
  return opts;
}

export function redact(text, secret) {
  let value = String(text);
  if (secret) for (const variant of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])) value = value.split(variant).join('[REDACTED]');
  return value;
}

function origin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url.origin;
  } catch { fail('Set APP_BASE_URL or --base-url to the explicitly verified HTTPS production origin (no path, credentials or query).'); }
}

// icacls /inheritance:r retains pre-existing explicit grants. Verify every ACE,
// including custom groups/users, before trusting an existing state directory.
function ownerOnlyAcl(output, root, account, sid, allowInherited = false) {
  let entries = 0;
  for (const raw of output.split(/\r?\n/)) {
    let line = raw.trim();
    if (line.toLowerCase().startsWith(root.toLowerCase())) line = line.slice(root.length).trim();
    if (!line || /^Successfully processed \d+ files; Failed processing 0 files$/.test(line)) continue;
    const ace = /^([^:]+):((?:\([^()]+\))+)$/.exec(line);
    if (!ace || ![account.toLowerCase(), sid.toLowerCase()].includes(ace[1].toLowerCase()) || (!allowInherited && ace[2].includes('(I)')) || ace[2].includes('(DENY)')) return false;
    entries++;
  }
  return entries > 0;
}

/** Fixed, gitignored directory. Refuse symlinks/reparse points and overlapping runs. */
export function privateStore(directory, run = command, platform = process.platform) {
  const root = resolve(directory);
  let locked = false;
  const regular = (path, type) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !(type === 'directory' ? stat.isDirectory() : stat.isFile()) || (type !== 'directory' && stat.nlink !== 1)) fail('Private state path refused. Ask the coordinator to inspect local state.');
  };
  const write = (name, value) => {
    const target = join(root, name), temp = join(root, `${name}.pending`);
    let fd, created = false;
    try {
      fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      created = true;
      writeFileSync(fd, value); fsyncSync(fd); closeSync(fd); fd = undefined;
      try { regular(target, 'file'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      renameSync(temp, target);
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (created) try { unlinkSync(temp); } catch { /* absent temporary file */ }
    }
  };
  return {
    async open() {
      // Inspect every existing ancestor before mkdir follows it.
      const chain = []; let cursor = root;
      while (true) {
        chain.unshift(cursor); const parent = resolve(cursor, '..');
        if (parent === cursor) break; cursor = parent;
      }
      for (const path of chain) {
        try { regular(path, 'directory'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      mkdirSync(root, { recursive: true, mode: 0o700 }); regular(root, 'directory');
      chmodSync(root, 0o700);
      if (platform === 'win32') {
        // Apply a protected owner ACL before any state/log file is created.
        // Git Bash puts a POSIX whoami first on PATH; it cannot return a SID.
        const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
        const identity = await run(join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']);
        const owner = identity.ok && /^"([^"\r\n]+)","(S-1-\d+(?:-\d+)+)"\s*$/m.exec(identity.stdout);
        const account = owner?.[1], sid = owner?.[2];
        if (!sid || !(await run(join(system, 'icacls.exe'), [root, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`])).ok) fail('Cannot protect local state permissions. Ask the coordinator to repair the private folder ACL.');
        const acl = await run(join(system, 'icacls.exe'), [root]);
        if (!acl.ok || !ownerOnlyAcl(acl.stdout, root, account, sid)) fail('Private state has a broad ACL or unverified permissions; stop and repair permissions.');
        // A protected directory does not remove explicit grants on old files.
        // Bypass-traverse can expose a known filename, so inspect those too.
        for (const name of readdirSync(root)) {
          const path = join(root, name);
          if (name === 'run.lock') { regular(path, 'directory'); continue; }
          if (name !== 'state.json' && !(name.startsWith('run-') && name.endsWith('.json') && uuidPattern.test(name.slice(4, -5)))) fail('Unexpected private state entry. Preserve the folder for coordinator inspection.');
          regular(path, 'file');
          const fileAcl = await run(join(system, 'icacls.exe'), [path]);
          if (!fileAcl.ok || !ownerOnlyAcl(fileAcl.stdout, path, account, sid, true)) fail('Existing private file permissions are not owner-only. Preserve the folder and ask the coordinator to repair its ACL.');
        }
      }
      try { mkdirSync(join(root, 'run.lock'), { mode: 0o700 }); locked = true; }
      catch { fail('Another run or interrupted run holds the local lock. Do not delete it until the coordinator proves the old process stopped.'); }
    },
    read() {
      try {
        const path = join(root, 'state.json'); regular(path, 'file');
        const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try { return JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
      } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    },
    save(value) { write('state.json', value); },
    log(value) { write(`run-${randomUUID()}.json`, value); },
    close() { if (locked) { rmdirSync(join(root, 'run.lock')); locked = false; } },
  };
}

function namedReasons(body) {
  const values = [body?.code, body?.details?.reason, ...(Array.isArray(body?.details?.reasons) ? body.details.reasons : [])];
  return values.filter(v => errorCodes.has(v) || reasons.has(v)).join(', ') || 'server_refused (details suppressed)';
}

function exactParity(value) {
  return object(value) && value.exact === true && hashPattern.test(value.dbHash) && value.dbHash === value.sheetHash &&
    exportCollections.every(key => count(value.counts?.[key])) && Array.isArray(value.differences) && value.differences.length === 0;
}

function measurement(value) {
  return object(value) && value.coverage === 'all-rows' && shaPattern.test(value.build) && collections.every(key => {
    const sample = value.samples?.[key];
    return sample?.collection === key && sample.idsEqual === true && sample.blocking === 0 && count(sample.fields) && count(sample.equal) &&
      sample.equal <= sample.fields && (sample.fields === 0 || sample.equal / sample.fields >= .999) &&
      Number.isFinite(sample.lagMs) && sample.lagMs >= 0 && sample.lagMs <= 900_000;
  });
}

/** All dependencies injectable for offline tests; CLI never exposes a secret argument. */
export async function cutover(args = process.argv.slice(2), deps = {}) {
  const env = deps.env ?? process.env, log = deps.log ?? console.log, run = deps.run ?? command;
  const tty = deps.tty ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let secret = '', store, opened = false, step = 'setup', resultCode = 0;
  const rows = [], records = [];
  const now = deps.now ?? (() => new Date().toISOString());
  const say = value => log(redact(value, secret));
  const row = (name, pass, detail) => {
    rows.push({ step: name, result: pass ? 'PASS' : 'FAIL', reason: detail });
    say(`${name} | ${pass ? 'PASS' : 'FAIL'} | ${detail}`);
  };
  let identity = {};
  try {
    say('step | result | reason');
    const opts = parseOptions([...args]);
    const base = origin(opts.base ?? env.APP_BASE_URL);
    if (!tty && opts.from !== 'env') fail('No TTY: only explicit --from env with process-only CS_CUTOVER_BEARER is allowed.');
    // Snapshot and remove the process-only source before any possible child starts.
    const bearer = opts.from === 'env' ? env.CS_CUTOVER_BEARER : undefined;
    delete env.CS_CUTOVER_BEARER;
    if (opts.from === 'env') secret = bearer ?? '';
    else if (await selectSource(opts.from, run) === 'lastpass') {
      const status = await run('lpass', ['status', '--quiet']);
      if (!status.ok) fail('LastPass CLI unavailable or locked. Log in locally, then retry.');
      const entry = await run('lpass', ['show', '--password', 'content-studio/CRON_SECRET']);
      if (!entry.ok) fail('Cannot read content-studio/CRON_SECRET from LastPass. Repair local vault access.');
      secret = entry.stdout.replace(/\r?\n$/, '');
    } else secret = await (deps.prompt ?? hiddenPrompt)('CRON_SECRET', 1, 1);
    if (typeof secret !== 'string' || !secret || /[^\x21-\x7e]/.test(secret)) fail('Bearer must be nonempty printable ASCII without whitespace. Retry the private source.');
    // A mistyped URL must never transmit the bearer, even if pasted as a hostname.
    if (base.toLowerCase().includes(secret.toLowerCase()) || base.includes(encodeURIComponent(secret))) fail('Production origin refused: credential overlap.');
    store = deps.store ?? privateStore(fileURLToPath(new URL('../artifacts/cutover-owner', import.meta.url)), run);
    await store.open();
    opened = true;
    const state = store.read();
    if (!object(state) || Object.entries(state).some(([slot, v]) => !hashPattern.test(slot) || !object(v) || Object.keys(v).sort().join(',') !== 'key,sha,status' || !uuidPattern.test(v.key) || !['pending', 'completed'].includes(v.status) || !(v.sha === null || shaPattern.test(v.sha)))) fail('Local retry state is invalid. Preserve it for coordinator inspection.');
    const save = () => {
      const text = JSON.stringify(state);
      if (text.includes(secret)) fail('Local retry state refused: credential overlap.');
      store.save(text);
    };
    const request = async (path, method = 'GET', body, key) => {
      try {
        const response = await (deps.fetcher ?? fetch)(`${base}${path}`, {
          method, redirect: 'error', signal: AbortSignal.timeout(deps.timeoutMs ?? 65_000),
          headers: { Accept: 'application/json', Authorization: `Bearer ${secret}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        let value;
        try { value = await response.json(); } catch { fail('Invalid server JSON. No completion confirmed; keep the retry state.'); }
        if (!response.ok || value?.ok !== true) {
          const advice = response.status === 401 || response.status === 403 ? 'Check bearer/configuration and server gate proofs.' : response.status === 409 ? 'Conflict: inspect revisions or operation identity before retry.' : response.status === 429 ? 'Rate limited: wait, then retry the same command.' : response.status >= 500 ? 'Server unavailable: completion unknown; retry the same command.' : 'Inspect the deployed route and server gate proofs.';
          if (response.status === 405) fail('HTTP 405: deployed read-only cutover status route is unavailable; activation is blocked.');
          fail(`HTTP ${Number(response.status)}: ${namedReasons(value)}. ${advice}`);
        }
        return value;
      } catch (error) {
        if (error instanceof CutoverError) throw error;
        fail('Network failure or timeout; completion unknown. Retry the identical command to reuse its key. Provider error suppressed.');
      }
    };
    const health = async () => {
      step = 'health';
      const value = await request('/api/health');
      if (value.mode !== 'live' || !shaPattern.test(value.commit) || !Array.isArray(value.capabilities)) fail('Health requires live mode, full deployed SHA and capability list.');
      if (value.deploymentId !== undefined && !deploymentPattern.test(value.deploymentId)) fail('Health deployment identity is invalid.');
      identity = { sha: value.commit, deploymentId: value.deploymentId ?? null };
      if (opts.sha && value.commit !== opts.sha) fail('Deployed SHA differs from --sha. Stop; ask the coordinator to verify the deployment.');
      row('health', true, `live; SHA ${value.commit}; deployment id ${identity.deploymentId ?? 'unreported'}`);
      records.push({ timestamp: now(), step: 'health', ...identity });
      return value;
    };
    const status = async () => {
      await health(); step = 'status';
      // Admission comes from the current server SQL gate, never capabilities.
      const value = await request('/api/ops/content-cutover');
      if (!object(value.status) || value.status.build !== identity.sha || value.status.contract !== 'schema-2:cutover-1' || !object(value.status.gates)) fail('Cutover status contract missing or mismatched; activation is blocked.');
      const result = value.status;
      if (result.deploymentId !== identity.deploymentId || !['sheet','db-shadow','db-read','db'].includes(result.store) ||
        !['none','read','db','retired'].includes(result.epoch) || typeof result.writesDisabled !== 'boolean' ||
        !object(result.evidenceAgesMs) || !['parity','phase-c','rehearsal','backup'].every(k => result.evidenceAgesMs[k] === null || count(result.evidenceAgesMs[k])) ||
        !['calendar','backup'].every(k => typeof result.waivers?.[k]?.audited === 'boolean')) fail('Cutover status state missing or mismatched; activation is blocked.');
      row('state', true, `store ${result.store}; epoch ${result.epoch}; writes ${result.writesDisabled ? 'frozen locally' : 'not frozen locally'}`);
      for (const name of ['calendar','backup']) row(`waiver ${name}`, true, result.waivers[name].audited ? 'audited' : 'not audited');
      for (const name of ['parity','phase-c','rehearsal','backup']) row(`age ${name}`, true, result.evidenceAgesMs[name] === null ? 'unavailable for this build/import' : `${result.evidenceAgesMs[name]} ms`);
      for (const mode of ['db-read', 'db']) {
        const gate = result.gates[mode];
        if (!object(gate) || typeof gate.ok !== 'boolean' || !Array.isArray(gate.reasons) || gate.reasons.some(r => !gateReasons.includes(r)) || (gate.ok ? gate.reasons.length !== 0 : gate.reasons.length === 0)) fail('Gate verdict is unmeasured; activation is blocked.');
        const target = opts.action === 'activate-read' ? 'db-read' : opts.action === 'activate-db' ? 'db' : null;
        if (!target || mode === target) row(`gate ${mode}`, gate.ok && gate.reasons.length === 0, gate.ok && gate.reasons.length === 0 ? 'server green' : namedReasons({ details: { reasons: gate.reasons } }));
      }
      return result;
    };
    const mutate = async (action, path, method, body, validate) => {
      step = action;
      const slot = createHash('sha256').update(`${base}\0${action}`).digest('hex');
      const prior = state[slot];
      if (prior?.status === 'pending' && prior.sha !== opts.sha) fail('Pending operation belongs to another expected SHA. Preserve state and ask the coordinator to resolve it.');
      const key = prior?.status === 'pending' ? prior.key : (deps.uuid ?? randomUUID)();
      if (!uuidPattern.test(key)) fail('Invalid request UUID.');
      state[slot] = { key, status: 'pending', sha: opts.sha }; save();
      const value = await request(path, method, body, key);
      const result = path === '/api/ops/content-cutover' ? value.result : value;
      if (!validate(result) || (['measure', 'rollback'].includes(action) && result.build !== identity.sha)) fail('Server result failed verification; completion is unconfirmed. Preserve state and retry only after coordinator inspection.');
      state[slot].status = 'completed'; save();
      row(action, true, result.status === 'backup_waived' ? 'backup_waived (server audited waiver)' : action === 'rollback' ? 'readyToFlip: sheet; rehearsal only; coordinator must redeploy' : 'verified');
      // Project only reviewed aggregate fields. Never walk arbitrary response keys.
      records.push({ timestamp: now(), step: action, ...identity,
        ...(hashPattern.test(result.manifestHash) ? { manifestHash: result.manifestHash } : {}),
        ...(exactParity(result.parity ?? result) ? { counts: Object.fromEntries(exportCollections.map(k => [k, (result.parity ?? result).counts[k]])), dbHash: (result.parity ?? result).dbHash, sheetHash: (result.parity ?? result).sheetHash } : {}),
        ...(action === 'measure' ? { counts: Object.fromEntries(collections.map(k => [k, { fields: result.samples[k].fields, equal: result.samples[k].equal, blocking: result.samples[k].blocking }])) } : {}),
      });
    };
    const operation = (action, validate) => mutate(action, '/api/ops/content-cutover', 'POST', { action }, validate);
    const backupValid = value => object(value) && (['verified', 'already_verified'].includes(value.status) && hashPattern.test(value.manifestHash) ||
      value.status === 'backup_waived' && value.waiver?.audited === true && value.waiver?.build === identity.sha && hashPattern.test(value.waiver?.auditHash));
    if (opts.action === 'status' || opts.action.startsWith('activate-')) {
      const result = await status();
      if (opts.action.startsWith('activate-')) {
        const mode = opts.action === 'activate-read' ? 'db-read' : 'db';
        if (result.gates[mode].ok !== true || result.gates[mode].reasons.length !== 0) fail('Target server gate is not green. Resolve its named reasons before activation.');
        if (!tty) fail('Activation requires a real TTY and the exact word ACTIVATE.');
        say(`Will record the ${mode} authority epoch for SHA ${opts.sha}. Deployment flags still require the coordinator.`);
        say(mode === 'db-read' ? 'Rollback: coordinator redeploys Sheet mode while Sheet is authoritative.' : 'Rollback: coordinator freezes/drains all writers, then owner runs npm run cutover -- rollback; only after exact parity may coordinator redeploy Sheet.');
        say('Rollback command: npm run cutover -- rollback (same verified APP_BASE_URL).');
        if (await (deps.confirm ?? hiddenPrompt)('Type ACTIVATE to continue', 1, 1) !== 'ACTIVATE') fail('Activation cancelled: exact ACTIVATE confirmation required.');
        // Recheck identity and gates after the deliberate prompt (which can sit open).
        const latest = await status();
        if (latest.gates[mode].ok !== true || latest.gates[mode].reasons.length !== 0) fail('Target server gate changed; activation refused.');
        await operation(opts.action, value => value?.mode === mode && value.build === opts.sha && value.contract === 'schema-2:cutover-1');
      }
    } else if (opts.action === 'smoke') {
      const value = await health(); step = 'read-only capabilities';
      for (const provider of ['auth', 'sheet', 'drive']) {
        const matches = value.capabilities.filter(c => c?.provider === provider);
        if (matches.length !== 1 || matches[0].mode !== 'live' || !['ready', 'read_only'].includes(matches[0].state)) fail('Required read capability is unavailable or ambiguous. Ask the coordinator to inspect health.');
        row(provider, true, matches[0].state);
      }
      say('Read-only HTTP smoke only. Owner login and content/save checks remain separate coordinator/owner checks.');
    } else {
      await health();
      if (opts.action === 'all-prepare') {
        try { await status(); } catch (error) {
          if (!(error instanceof CutoverError)) throw error;
          row('status', false, error.message);
        }
      }
      if (opts.action === 'all-prepare' || opts.action === 'measure') await operation('measure', measurement);
      if (opts.action === 'all-prepare') await status();
      if (opts.action === 'backup') {
        if (opts.scheduled) await mutate('backup-scheduled', '/api/ops/content-backup/reconcile', 'GET', null, backupValid);
        else await operation('backup', backupValid);
      }
      if (opts.action === 'rollback') await operation('rollback', value => value?.readyToFlip === 'sheet' && value.writesDisabled === true && shaPattern.test(value.build) && exactParity(value.parity));
      if (opts.action === 'export') await mutate('export', '/api/ops/content-export/reconcile', 'GET', null, exactParity);
    }
    resultCode = rows.some(r => r.result === 'FAIL') ? 1 : 0;
  } catch (error) {
    row(step, false, error instanceof CutoverError ? error.message : 'Runner stopped; untrusted error suppressed. Preserve local state and ask the coordinator to inspect.');
    resultCode = 1;
  } finally {
    if (opened) {
      try { store.log(redact(JSON.stringify({ timestamp: now(), ...identity, records }), secret)); }
      catch { say('run log | FAIL | Cannot persist private run evidence.'); resultCode = 1; }
      try { store.close(); } catch { say('local lock | FAIL | Coordinator must inspect local lock.'); resultCode = 1; }
    }
    secret = '';
  }
  return resultCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await cutover();

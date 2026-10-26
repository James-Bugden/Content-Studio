#!/usr/bin/env node
/** Run only in a disposable D:/wt copy. Never mutates the working checkout. */
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const root = realpathSync(process.cwd()).replaceAll('\\', '/');
if (!/^D:\/wt\/[^/]+$/i.test(root) || !root.includes('cs-231-fix-')) throw new Error('Use a disposable cs-231-fix-* copy under D:/wt');
const evidence = resolve(process.argv[2] ?? '../cs-231-fix-r1-evidence');
mkdirSync(`${evidence}/mutation-logs`, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const calendar = ['tests/unit/supabase/content-timestamps.test.ts'];
const unit = ['tests/unit/supabase/parity-shape.test.ts', ...calendar];
const sql = ['tests/unit/supabase/content-timestamps-pglite.test.ts'];
const probes = ['tests/unit/supabase/independent-parity-review.test.ts'];
const timestamps = 'src/application/content-timestamps.ts';
const parity = 'src/application/content-parity.ts';
const importer = 'src/application/content-import.ts';
const repository = 'src/integrations/supabase/content-repository.ts';
const cases = [];
const add = (guard, file, before, after, tests = calendar) => cases.push({ guard, file, before, after, tests });
function runTests(tests, log) {
  const args = [resolve(homedir(), 'bin/heavy').replaceAll('\\', '/'), 'npx', 'vitest', 'run', ...tests, '--maxWorkers=1'];
  const run = spawnSync('bash', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (run.error) throw run.error;
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  writeFileSync(`${evidence}/${log}`, output);
  return { run, output };
}

add('Calendar syntax refusal', timestamps, 'if (!match) return false;', 'if (!match) return true;');
add('Year zero refused', timestamps, 'year < 1 || ', '');
add('Calendar day ranges', timestamps, 'day > days[month - 1]!', 'day > 31');
add('Leap year multiple of four', timestamps, 'year % 4 === 0 && ', 'false && ');
add('Leap year century rule', timestamps, 'year % 100 !== 0 || year % 400 === 0', 'true');
add('Leap year four-century exception', timestamps, 'year % 400 === 0', 'false');
add('Month refusal direction', timestamps, 'if (year < 1 || month < 1', 'if (month > 12) return true;\n  if (year < 1 || month < 1');
add('Minute refusal direction', timestamps, 'if (minute > 59 ||', 'if (minute > 59) return true;\n  if (minute > 59 ||');
add('Second refusal direction', timestamps, 'if (minute > 59 ||', 'if (second > 59) return true;\n  if (minute > 59 ||');
add('Offset hour refusal direction', timestamps, 'if (minute > 59 ||', 'if (Number(offsetHour) > 23) return true;\n  if (minute > 59 ||');
add('Offset minute refusal direction', timestamps, 'if (minute > 59 ||', 'if (Number(offsetMinute) > 59) return true;\n  if (minute > 59 ||');
add('Hour and exact end-of-day refusal direction', timestamps, 'if (hour > 24 ||', 'if (hour >= 24) return true;\n  if (hour > 24 ||');
add('Minute-only compatibility', timestamps, '(?::(\\d{2})(?:\\.(\\d+))?)?', ':(\\d{2})(?:\\.(\\d+))?');
add('Exact 24:00 compatibility', timestamps, 'hour > 24 ||', 'hour >= 24 ||');
add('Timestamp calendar validation is mandatory', timestamps, 'if (stamp && !validCalendarStamp(stamp)) return null;', 'if (false) return null;');
add('Import conversion refuses invalid parsed input', importer, 'if (!parts) throw blocked();', 'if (!parts) return {};');
add('Patch conversion refuses invalid parsed input', repository, "if (!parts) throw new AppError('VALIDATION_FAILED', { reason: 'value_invalid', field });", 'if (!parts) return {};');

add('Timestamp field allowlist', timestamps, 'if (!CONTENT_TIMESTAMP_FIELDS.has(field)) return null;', 'if (false) return null;', unit);
add('Hash suffix only on finalSyncedAt', timestamps, "field === 'finalSyncedAt' ? text.split(' #') : [text]", "text.split(' #')", unit);
add('Multiple hash delimiters refused', timestamps, 'parts.length > 2 || ', 'false || ', unit);
add('Empty hash or stamp refused', timestamps, 'parts.length === 2 && (!stamp || !hash)', 'false', unit);
add('Exact hash bytes required', timestamps, 'a.hash !== b.hash', 'false', unit);
add('Instant seconds must match', timestamps, 'x[0] === y[0] && x[1] === y[1]', 'x[1] === y[1]', unit);
add('Submillisecond fraction must match', timestamps, 'x[0] === y[0] && x[1] === y[1]', 'x[0] === y[0]', unit);

add('Raw final timestamp retained during import', importer, '[FINAL_SYNCED_AT_RAW_KEY]: text', '[FINAL_SYNCED_AT_RAW_KEY]: rendered', sql);
add('Raw timestamp preserved rather than normalized on render', repository, 'sameContentTimestamp(originalStamp, value, field)) value = originalStamp;', 'false) value = originalStamp;', sql);
add('Stale timestamp metadata must match the DB instant and hash', repository, 'sameContentTimestamp(originalStamp, value, field)) value = originalStamp;', 'true) value = originalStamp;', sql);
add('Stale timestamp guard compares every fractional digit', timestamps, "fraction.replace(/0+$/, '')", "fraction.slice(0, 3).replace(/0+$/, '')", sql);
add('Malformed original metadata refused', repository, "typeof originalStamp === 'string'\n      && sameContentTimestamp(originalStamp, value, field)", "typeof originalStamp === 'string'", sql);
add('Schedule timestamp metadata hidden from exported unknown columns', repository, 'const { [HOOK_SCORE_RAW_KEY]: originalScore, [FINAL_SYNCED_AT_RAW_KEY]: _originalStamp, ...passthrough }', 'const { [HOOK_SCORE_RAW_KEY]: originalScore, ...passthrough }', sql);
add('Library and Queue timestamp metadata hidden from export', repository, 'const { [CONTENT_ANGLE_RAW_KEY]: originalAngle, [HOOK_SCORE_RAW_KEY]: originalScore, [FINAL_SYNCED_AT_RAW_KEY]: _originalStamp, ...passthrough }', 'const { [CONTENT_ANGLE_RAW_KEY]: originalAngle, [HOOK_SCORE_RAW_KEY]: originalScore, ...passthrough }', sql);

add('value parity allowance applies only to finalSyncedAt', parity, "field === 'value.finalSyncedAt';", "['value.finalSyncedAt', 'value.publishedAt', 'value.analyticsSyncedAt'].includes(field);", probes);
add('Other timestamp fields keep previous unequal cell accounting', parity, "(field === 'cells.finalSyncedAt' || field === 'value.finalSyncedAt')", 'true', calendar);
add('Equivalent final timestamp value compares equal', parity, "const timestampValue = collection === 'schedule'", "const timestampValue = false && collection === 'schedule'", unit);
add('Equivalent final timestamp contributes to field equality', parity, "kind === 'blank_boolean' || kind === 'timestamp_formatting'", "kind === 'blank_boolean' || false && kind === 'timestamp_formatting'", unit);

const results = [];
const baselineTests = [...unit, ...sql, ...probes];
const baseline = runTests(baselineTests, 'mutation-baseline.log');
if (baseline.run.status !== 0) throw new Error('Mutation baseline is not green');
console.log('Mutation baseline PASS');
for (const [index, mutation] of cases.entries()) {
  const original = readFileSync(mutation.file), source = original.toString('utf8');
  if (source.split(mutation.before).length !== 2) throw new Error(`Expected one mutation anchor: ${mutation.guard}`);
  const beforeSha256 = digest(original);
  let result;
  try {
    writeFileSync(mutation.file, source.replace(mutation.before, mutation.after));
    const mutantSha256 = digest(readFileSync(mutation.file));
    if (mutantSha256 === beforeSha256) throw new Error('Mutation did not apply');
    const { run, output } = runTests(mutation.tests, `mutation-logs/${index + 1}.log`);
    result = { ...mutation, beforeSha256, mutantSha256, command: `bash ~/bin/heavy npx vitest run ${mutation.tests.join(' ')} --maxWorkers=1`,
      exitCode: run.status, detected: run.status !== 0 && /Tests[^\n]*\b\d+ failed/.test(output),
      assertions: output.split('\n').filter(line => /^ FAIL |^AssertionError:|^\s+Tests /.test(line)).slice(0, 8) };
  } finally {
    writeFileSync(mutation.file, original);
    const restoredSha256 = digest(readFileSync(mutation.file));
    if (restoredSha256 !== beforeSha256) throw new Error('Byte-for-byte restoration failed');
    if (result) results.push({ ...result, restoredSha256 });
    writeFileSync(`${evidence}/mutations.json`, JSON.stringify({ baseCommit: '68148a5bc1e372853f444e33b1b9f47cdf85cb84', baselinePassed: true, mutants: cases.length, detected: results.filter(r => r.detected).length, results }, null, 2) + '\n');
  }
  console.log(`${index + 1}/${cases.length} ${result.detected ? 'DETECTED' : 'SURVIVED'}: ${mutation.guard}`);
  if (!result.detected) throw new Error(`Mutation survived or failed without an assertion: ${mutation.guard}`);
}
const restored = runTests(baselineTests, 'mutation-restored.log');
if (restored.run.status !== 0) throw new Error('Restored implementation failed its final retest');
const report = JSON.parse(readFileSync(`${evidence}/mutations.json`, 'utf8'));
writeFileSync(`${evidence}/mutations.json`, JSON.stringify({ ...report, restoredPassed: true }, null, 2) + '\n');
console.log('Restored implementation PASS');

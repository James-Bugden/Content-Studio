// Disposable D:/wt COPY only: bash ~/bin/heavy node tests/support/hook-score-mutations.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

assert.equal(process.env.HEAVY_LOCK_HELD, '1', 'Use the shared heavy queue');
assert.match(resolve('.').replaceAll('\\', '/'), /^D:\/wt\//i, 'Mutate a scratch copy only');
const parser = 'src/domain/hook-score.ts', importer = 'src/application/content-import.ts';
const adapter = 'src/integrations/supabase/content-repository.ts', mapping = 'src/domain/mapping.ts';
const schema = 'src/integrations/supabase/content-row-schema.ts', parity = 'src/application/content-parity.ts';
const sql = 'supabase/migrations/20261026000100_content_hook_score_decimal.sql';
const unit = 'tests/unit/supabase/hook-score.test.ts', pglite = 'tests/unit/supabase/hook-score-pglite.test.ts';
// [name, path, original, replacement, files, occurrence, total occurrences]
const mutations = [
  ['G01-grammar', parser, 'if (!/^-?', 'if (false && !/^-?'],
  ['G02-magnitude', parser, 'Math.abs(score) < 1000', 'Math.abs(score) <= 1000'],
  ['G03-precision', parser, '{1,2}', '{1,3}'],
  ['G04-required-dot', parser, '\\.', '.'],
  ['G05-start-anchor', parser, '/^-?', '/-?'],
  ['G06-end-anchor', parser, '?$/', '?/'],
  ['G07-ASCII-NFKC', parser, '.test(text.trim())', ".test(text.normalize('NFKC').trim())", [unit, pglite]],
  ['G08-hook-only', importer, "else if (field === 'hookScore')", 'else if (true)'],
  ['G09-refuse-null', importer, "if (value === null) throw new AppError('VALIDATION_FAILED', { reason: 'copy_numeric', field: column });", "if (false) throw new AppError('VALIDATION_FAILED', { reason: 'copy_numeric', field: column });"],
  ['G10-raw-NBSP', importer, '[HOOK_SCORE_RAW_KEY]: text', '[HOOK_SCORE_RAW_KEY]: text.trim()', [unit, pglite]],
  ['G11-merge-metadata', importer, '{ ...(row.passthrough as Record<string, unknown>), [HOOK_SCORE_RAW_KEY]: text }', '{ [HOOK_SCORE_RAW_KEY]: text }'],
  ['G12-render-import', importer, "angle !== null || field === 'hookScore' && value !== null ? text", 'angle !== null ? text'],
  ['G13-NFC', importer, 'Object.entries(record.cells)', "Object.entries(record.cells).map(([field, text]) => [field, text.normalize('NFC')] as const)", [unit, pglite]],
  ['G14-terminal-tab', importer, '[HOOK_SCORE_RAW_KEY]: text', "[HOOK_SCORE_RAW_KEY]: text.replace(/\\t+$/, '')", [unit, pglite]],
  ['G15-post-type', adapter, "typeof originalScore === 'string' && ", '', [unit], 1, 2],
  ['G16-post-valid', adapter, 'decimalHookScore(originalScore) !== null\n      && ', '', [unit], 1, 2],
  ['G17-post-stale', adapter, 'decimalHookScore(originalScore) === row.hook_score', 'true', [unit], 1, 2],
  ['G18-schedule-type', adapter, "typeof originalScore === 'string' && ", '', [unit], 2, 2],
  ['G19-schedule-valid', adapter, 'decimalHookScore(originalScore) !== null\n      && ', '', [unit], 2, 2],
  ['G20-schedule-stale', adapter, 'decimalHookScore(originalScore) === row.hook_score', 'true', [unit], 2, 2],
  ['G21-post-strip', adapter, "this.revision(row, 'content_studio_posts', `${row.collection}:${c.libraryId}`), formulaFields: [], passthrough,", "this.revision(row, 'content_studio_posts', `${row.collection}:${c.libraryId}`), formulaFields: [], passthrough: row.passthrough,"],
  ['G22-schedule-strip', adapter, "this.revision(row, 'content_studio_schedule', c.contentId), formulaFields: [], passthrough,", "this.revision(row, 'content_studio_schedule', c.contentId), formulaFields: [], passthrough: row.passthrough,"],
  ['G23-patch-parser', adapter, "value === '' ? null : decimalHookScore(value)", "value === '' ? null : Number(value)"],
  ['G24-patch-refusal', adapter, "if (typed === null && value !== '')", 'if (false)'],
  ['G25-row-validator', schema, 'decimalHookScore(String(n)) !== null', 'true'],
  ['G26-library-mapping', mapping, 'hookScore: decimalHookScore(c.hookScore)', 'hookScore: null', [unit], 1, 2],
  ['G27-schedule-mapping', mapping, 'hookScore: decimalHookScore(c.hookScore)', 'hookScore: null', [unit], 2, 2],
  ['G28-exact-classification', importer, " && field !== 'hookScore'", ''],
  ['G29-exact-parity', parity, 'fields++;', "fields++; if (field === 'cells.hookScore' && Number(af[field]) === Number(bf[field])) { equal++; continue; }"],
  ['G30-posts-decimal-type', sql, 'alter column hook_score type numeric(6,2) using hook_score::numeric(6,2)', 'alter column hook_score type integer using hook_score::integer', [pglite], 1, 2],
  ['G31-schedule-decimal-type', sql, 'alter column hook_score type numeric(6,2) using hook_score::numeric(6,2)', 'alter column hook_score type integer using hook_score::integer', [pglite], 2, 2],
  ['G32-view-invoker', sql, 'security_invoker = true', 'security_invoker = false', [pglite]],
  ['G33-view-ACL', sql, 'revoke all on public.content_studio_ready_queue from public, anon, authenticated;', '', [pglite]],
  ['G34-atomic-migration', sql, 'begin;', '', [pglite]],
];
const originals = new Map([...new Set([...mutations.map(m => m[1]), unit, pglite])].map(path => [path, readFileSync(path)]));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const output = resolve('score-mutation-results'); mkdirSync(output, { recursive: true });
const results = [];
function run(name, files = [unit, pglite]) {
  const reportPath = resolve(output, `${name}.json`);
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...files, '--maxWorkers=1', '--reporter=json', `--outputFile=${reportPath}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(resolve(output, `${name}.log`), (result.stdout ?? '') + (result.stderr ?? ''));
  assert.ifError(result.error);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  return { status: result.status, failed: report.numFailedTests, passed: report.numPassedTests,
    failures: report.testResults.flatMap(s => s.assertionResults.filter(t => t.status === 'failed').map(t => ({ file: s.name, name: t.fullName }))) };
}
try {
  const baseline = run('baseline'); assert.equal(baseline.status, 0, 'Baseline must pass');
  for (const [name, path, from, to, files = [unit], occurrence = 1, count = 1] of mutations) {
    const original = originals.get(path), source = original.toString('utf8');
    assert.equal(source.split(from).length - 1, count, `${name}: exact mutation target count`);
    let start = -1; for (let i = 0; i < occurrence; i++) start = source.indexOf(from, start + 1);
    const changed = Buffer.from(source.slice(0, start) + to + source.slice(start + from.length));
    const before = sha256(original), mutated = sha256(changed); assert.notEqual(before, mutated);
    writeFileSync(path, changed); assert.deepEqual(readFileSync(path), changed, 'Mutation written');
    let result; try { result = run(name, files); } finally { writeFileSync(path, original); }
    const restored = readFileSync(path); assert.deepEqual(restored, original, `${name}: byte-for-byte restoration`);
    results.push({ name, path, before, mutated, after: sha256(restored), ...result });
    writeFileSync(resolve(output, 'summary.json'), JSON.stringify({ baseline, results }, null, 2));
    assert.notEqual(result.status, 0, `${name}: survived`); assert.ok(result.failed > 0, `${name}: assertion failure required`);
    for (const file of files) assert.ok(result.failures.some(f => f.file.replaceAll('\\', '/').endsWith(file)), `${name}: failed assertions required in ${file}`);
    process.stdout.write(`${name}: killed (${result.failed}); SHA-256 restored ${before}\n`);
  }
  assert.equal(run('restored').status, 0, 'Restored tests must pass');
} finally {
  for (const [path, bytes] of originals) { writeFileSync(path, bytes); assert.deepEqual(readFileSync(path), bytes, `${path}: final restoration`); }
}

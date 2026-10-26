// Run in a disposable D:/wt COPY, via bash ~/bin/heavy node tests/support/content-angle-mutations.mjs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

assert.equal(process.env.HEAVY_LOCK_HELD, '1', 'Use the shared heavy queue');
assert.match(resolve('.').replaceAll('\\', '/'), /^D:\/wt\//i, 'Mutate a scratch copy only');
const parser = 'src/domain/content-angle.ts';
const importer = 'src/application/content-import.ts';
const adapter = 'src/integrations/supabase/content-repository.ts';
const parity = 'src/application/content-parity.ts';
const tests = 'tests/unit/supabase/content-angle.test.ts';
const pglite = 'tests/unit/supabase/content-import-pglite.test.ts';
const mutations = [
  ['G01-grammar', parser, 'if (!match) return null;', 'if (!match) return 3;'],
  ['G02-lower-bound', parser, 'angle >= 1', 'angle >= 0'],
  ['G03-upper-bound', parser, 'angle <= 14', 'angle <= 15'],
  ['G04-digit-count', parser, '\\d{1,2}', '\\d{1,3}'],
  ['G05-required-dot', parser, '\\.', '.'],
  ['G06-required-label', parser, '\\S.*', '.*'],
  ['G07-start-anchor', parser, '/^\\s*', '/\\s*'],
  ['G08-end-anchor', parser, '(\\S.*)$', '(\\S.*)'],
  ['G09-field-scope', importer, "field === 'contentAngle' ? numberedContentAngle(text) : null", 'numberedContentAngle(text)'],
  ['G10-null-label', importer, 'if (angle !== null)', 'if (angle === null)'],
  ['G11-preserve-bytes', importer, '[CONTENT_ANGLE_RAW_KEY]: text', '[CONTENT_ANGLE_RAW_KEY]: text.trim()'],
  ['G12-preserve-unknown', importer, '{ ...(row.passthrough as Record<string, unknown>), [CONTENT_ANGLE_RAW_KEY]: text }', '{ [CONTENT_ANGLE_RAW_KEY]: text }'],
  ['G13-render-import', importer, "angle !== null || field === 'hookScore' && value !== null ? text", "field === 'hookScore' && value !== null ? text"],
  ['G14-metadata-type', adapter, "typeof originalAngle === 'string' && ", ''],
  ['G15-valid-metadata', adapter, 'numberedContentAngle(originalAngle) !== null\n      && ', ''],
  ['G16-stale-label', adapter, 'numberedContentAngle(originalAngle) === row.content_angle', 'true'],
  ['G17-strip-metadata', adapter, "this.revision(row, 'content_studio_posts', `${row.collection}:${c.libraryId}`), formulaFields: [], passthrough,", "this.revision(row, 'content_studio_posts', `${row.collection}:${c.libraryId}`), formulaFields: [], passthrough: row.passthrough,"],
  ['G18-exact-parity', parity, 'fields++;', "fields++; if (field === 'cells.contentAngle' && parseInt(String(af[field])) === parseInt(String(bf[field]))) { equal++; continue; }"],
  ['G19-non-ascii-digits', parser, '.exec(text)', ".exec(text.normalize('NFKC'))", [tests, pglite]],
  ['G20-decomposed-unicode', importer, '[CONTENT_ANGLE_RAW_KEY]: text', "[CONTENT_ANGLE_RAW_KEY]: text.normalize('NFC')", [tests, pglite]],
  ['G21-terminal-tabs', importer, '[CONTENT_ANGLE_RAW_KEY]: text', "[CONTENT_ANGLE_RAW_KEY]: text.replace(/\\t+$/, '')", [tests, pglite]],
];
const paths = [...new Set([...mutations.map(m => m[1]), tests, pglite])];
const originals = new Map(paths.map(path => [path, readFileSync(path)]));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
const output = resolve('angle-mutation-results');
mkdirSync(output, { recursive: true });
function run(name, files = [tests, pglite]) {
  const reportPath = resolve(output, `${name}.json`);
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...files, '--maxWorkers=1', '--reporter=json', `--outputFile=${reportPath}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(resolve(output, `${name}.log`), (result.stdout ?? '') + (result.stderr ?? ''));
  assert.ifError(result.error);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const failures = report.testResults.flatMap(suite => suite.assertionResults.filter(test => test.status === 'failed').map(test => ({ file: suite.name, name: test.fullName })));
  return { status: result.status, failed: report.numFailedTests, passed: report.numPassedTests, failures };
}
try {
  const baseline = run('baseline');
  assert.equal(baseline.status, 0, 'Unmutated tests must pass');
  assert.equal(baseline.failed, 0);
  for (const [name, path, from, to, files = [tests]] of mutations) {
    const original = originals.get(path);
    const source = original.toString('utf8');
    assert.equal(source.split(from).length - 1, 1, `${name}: mutation must match exactly once`);
    const changed = Buffer.from(source.replace(from, to));
    const before = sha256(original), mutated = sha256(changed);
    assert.notEqual(before, mutated);
    writeFileSync(path, changed);
    let result;
    try { result = run(name, files); }
    finally { writeFileSync(path, original); }
    const restored = readFileSync(path);
    assert.deepEqual(restored, original, `${name}: restore bytes`);
    results.push({ name, path, before, mutated, after: sha256(restored), ...result });
    writeFileSync(resolve(output, 'summary.json'), JSON.stringify({ baseline, results }, null, 2));
    assert.notEqual(result.status, 0, `${name}: survived`);
    assert.ok(result.failed > 0, `${name}: must fail actual tests, not startup`);
    if (files.includes(pglite)) {
      for (const file of files) assert.ok(result.failures.some(f => f.file.replaceAll('\\', '/').endsWith(file)), `${name}: must fail regression assertions in ${file}`);
    }
    process.stdout.write(`${name}: killed (${result.failed} failed); SHA-256 restored ${before}\n`);
  }
  assert.equal(run('restored').status, 0, 'Restored tests must pass');
} finally {
  for (const [path, bytes] of originals) {
    writeFileSync(path, bytes);
    assert.deepEqual(readFileSync(path), bytes, `${path}: final byte-for-byte restoration`);
  }
}

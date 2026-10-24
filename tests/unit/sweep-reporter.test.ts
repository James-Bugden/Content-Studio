import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import SweepReporter from '../e2e/sweep-reporter';

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => {
    if (!path.resolve(dir).startsWith(path.join(path.resolve(tmpdir()), 'cs163-reporter-'))) throw new Error('Unexpected temporary reporter path');
    return rm(dir, { recursive: true, force: true });
  }));
});
const suite = (count: number) => ({ allTests: () => Array.from({ length: count }) }) as unknown as Suite;
const testCase = { titlePath: () => ['synthetic sweep'] } as TestCase;
const passed: FullResult = { status: 'passed', startTime: new Date(0), duration: 1 };
function result(status: TestResult['status'] = 'passed', attachment?: string): TestResult {
  return { status, duration: 1, annotations: [], errors: [], parallelIndex: 0, retry: 0, startTime: new Date(0),
    stderr: [], stdout: [], steps: [], workerIndex: 0,
    attachments: attachment ? [{ name: 'sweep', path: attachment, contentType: 'application/json' }] : [] };
}

async function reporter() {
  const dir = await mkdtemp(path.join(tmpdir(), 'cs163-reporter-'));
  dirs.push(dir);
  return { dir, report: new SweepReporter({ outputDir: dir }) };
}

const passRow = { route: '/', width: 375, role: 'owner', check: 'load', result: 'pass' };
async function attachment(dir: string, row = passRow) {
  const file = path.join(dir, 'synthetic.json');
  await writeFile(file, JSON.stringify({ rows: [row] }));
  return file;
}

describe('sweep artifacts cannot turn missing evidence green', () => {
  it('collects every attachment before publishing the complete result', async () => {
    const { dir, report } = await reporter();
    const attachment = path.join(dir, 'synthetic.json');
    await writeFile(attachment, JSON.stringify({ rows: [{ route: '/', width: 375, role: 'owner', check: 'load', result: 'pass' }] }));
    report.onBegin({}, suite(1));
    report.onTestEnd(testCase, result('passed', attachment));
    expect(await report.onEnd(passed)).toEqual({ status: 'passed' });
    expect(JSON.parse(await readFile(path.join(dir, 'coverage.json'), 'utf8')).rows).toHaveLength(1);
  });

  it.each(['not-started', 'missing-attachment', 'skipped', 'interrupted'] as const)('fails an otherwise green runner result with %s evidence', async (kind) => {
    const { report } = await reporter();
    report.onBegin({}, suite(1));
    if (kind !== 'not-started') report.onTestEnd(testCase, result(kind === 'missing-attachment' ? 'passed' : kind));
    expect(await report.onEnd(passed)).toEqual({ status: 'failed' });
  });

  it('fails unreadable evidence and records why', async () => {
    const { dir, report } = await reporter();
    report.onBegin({}, suite(1));
    report.onTestEnd(testCase, result('passed', path.join(dir, 'missing.json')));
    expect(await report.onEnd(passed)).toEqual({ status: 'failed' });
    expect(JSON.parse(await readFile(path.join(dir, 'coverage.json'), 'utf8')).reportErrors).toHaveLength(1);
  });

  it('rejects one missing attachment even when both tests passed and some rows exist', async () => {
    const { dir, report } = await reporter();
    report.onBegin({}, suite(2));
    report.onTestEnd(testCase, result('passed', await attachment(dir)));
    report.onTestEnd(testCase, result());
    expect(await report.onEnd(passed)).toEqual({ status: 'failed' });
    const coverage = JSON.parse(await readFile(path.join(dir, 'coverage.json'), 'utf8'));
    expect(coverage.rows).toHaveLength(1);
    expect(coverage.reportErrors).toEqual([]);
  });

  it('rejects an unreadable attachment alongside readable passing rows', async () => {
    const { dir, report } = await reporter();
    report.onBegin({}, suite(2));
    report.onTestEnd(testCase, result('passed', await attachment(dir)));
    report.onTestEnd(testCase, result('passed', path.join(dir, 'missing.json')));
    expect(await report.onEnd(passed)).toEqual({ status: 'failed' });
    const coverage = JSON.parse(await readFile(path.join(dir, 'coverage.json'), 'utf8'));
    expect(coverage.rows).toHaveLength(1);
    expect(coverage.reportErrors).toHaveLength(1);
  });

  it('rejects a failed check row even when the runner and test passed', async () => {
    const { dir, report } = await reporter();
    report.onBegin({}, suite(1));
    report.onTestEnd(testCase, result('passed', await attachment(dir, { ...passRow, result: 'fail' })));
    expect(await report.onEnd(passed)).toEqual({ status: 'failed' });
  });

  it.each(['skipped', 'interrupted'] as const)('rejects a %s test even with a valid passing attachment', async (status) => {
    const { dir, report } = await reporter();
    report.onBegin({}, suite(1));
    report.onTestEnd(testCase, result(status, await attachment(dir)));
    expect(await report.onEnd(passed)).toEqual({ status: 'failed' });
  });

  it('rejects zero discovered tests independently of the row gate', async () => {
    const { report } = await reporter();
    report.onBegin({}, suite(0));
    // Isolate the zero-test guard from rows.length: model retained in-memory
    // evidence. Real empty runs also fail the row gate, masking this regression.
    Object.assign(report, { rows: [passRow] });
    expect(await report.onEnd(passed)).toEqual({ status: 'failed' });
  });

  it.each([240_000, 240_001, 288_000])('reports %i ms separately from test completeness', async (duration) => {
    const { dir, report } = await reporter();
    const summary = path.join(dir, 'summary.md');
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    report.onBegin({}, suite(1));
    report.onTestEnd(testCase, result('passed', await attachment(dir)));
    expect(await report.onEnd({ ...passed, duration })).toEqual({ status: 'passed' });
    const coverage = JSON.parse(await readFile(path.join(dir, 'coverage.json'), 'utf8'));
    expect(coverage.budget).toEqual({ durationMs: duration, targetMs: 240_000, hardCeilingMs: 360_000,
      status: duration > 240_000 ? 'over-budget' : 'within-budget' });
    expect(await readFile(summary, 'utf8')).toContain(`Sweep execution: ${duration} ms`);
    expect(await readFile(path.join(dir, 'coverage.md'), 'utf8')).toContain(`Sweep execution: ${duration} ms`);
    if (duration > 240_000) expect(warning).toHaveBeenCalledWith(expect.stringContaining('::warning::'));
    else expect(warning).not.toHaveBeenCalled();
  });
});

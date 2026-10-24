import { afterEach, describe, expect, it } from 'vitest';
import type { FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import SweepReporter from '../e2e/sweep-reporter';

const dirs: string[] = [];
afterEach(async () => {
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
});

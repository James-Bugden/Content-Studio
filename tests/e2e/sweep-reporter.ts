import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A single stable artifact across both widths, including failures and partial runs. */
export default class SweepReporter implements Reporter {
  private rows: Record<string, unknown>[] = [];
  private tests: { title: string; status: string; durationMs: number }[] = [];
  private expectedTests = 0;
  private attachments: string[] = [];

  constructor(private options: { outputDir?: string } = {}) {}

  onBegin(_config: unknown, suite: Suite) {
    this.expectedTests = suite.allTests().length;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.tests.push({ title: test.titlePath().join(' / '), status: result.status, durationMs: result.duration });
    for (const attachment of result.attachments.filter((a) => a.name === 'sweep' && a.path)) {
      this.attachments.push(attachment.path!);
    }
  }

  async onEnd(result: FullResult) {
    const dir = path.resolve(this.options.outputDir ?? 'sweep-report');
    await mkdir(dir, { recursive: true });
    // Playwright does not await onTestEnd. Read attachments in the awaited
    // onEnd hook so a final slow read cannot silently disappear from coverage.
    const reports = await Promise.allSettled(this.attachments.map(async (file) => {
      const report = JSON.parse(await readFile(file, 'utf8')) as { rows: Record<string, unknown>[] };
      if (!Array.isArray(report.rows) || !report.rows.length) throw new Error(`Empty/invalid sweep attachment: ${file}`);
      return report.rows;
    }));
    const reportErrors: string[] = [];
    for (const report of reports) {
      if (report.status === 'fulfilled') this.rows.push(...report.value);
      else reportErrors.push(String(report.reason));
    }
    this.rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const complete = this.expectedTests > 0 && this.tests.length === this.expectedTests && this.tests.every((test) => test.status === 'passed') &&
      this.attachments.length === this.expectedTests && reportErrors.length === 0 && this.rows.length > 0 && this.rows.every((row) => row.result === 'pass');
    const status = result.status === 'passed' && complete ? 'passed' : 'failed';
    const budget = { durationMs: result.duration, targetMs: 240_000, hardCeilingMs: 360_000,
      status: result.duration > 240_000 ? 'over-budget' : 'within-budget' };
    const timing = `Sweep execution: ${budget.durationMs} ms; reported budget: ${budget.targetMs} ms; hard ceiling: ${budget.hardCeilingMs} ms. Budget status: ${budget.status}.`;
    console.log(timing);
    if (budget.status === 'over-budget') {
      console.warn(`${process.env.GITHUB_ACTIONS === 'true' ? '::warning::' : ''}${timing}`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${timing}\n`);
    await writeFile(path.join(dir, 'coverage.json'), JSON.stringify({ seed: 163, status, budget, expectedTests: this.expectedTests, reportErrors, tests: this.tests, rows: this.rows }, null, 2));
    const table = ['# Synthetic exploratory sweep', '', `Status: ${status}. Completed tests: ${this.tests.length}/${this.expectedTests}.`, '',
      'Seed: 163. Widths: 375 and 1280 CSS px. Emulation only.', '',
      timing, '',
      '| Route | Width | Role | Check | Result |', '|---|---:|---|---|---|',
      ...this.rows.map((r) => `| ${r.route} | ${r.width} | ${r.role} | ${r.check} | ${r.result} |`),
      '', 'See coverage.json for diagnostics and deterministic monkey action sequences.',
      'Screenshots for failed checks are in the accompanying test-results artifact.', ''];
    await writeFile(path.join(dir, 'coverage.md'), table.join('\n'));
    return { status } as const;
  }
}

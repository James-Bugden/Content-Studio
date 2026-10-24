import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';

// Run through `bash ~/bin/heavy node scripts/verify-sweep.mjs` on this PC.
// The inherited queue slot covers every sequential Playwright child process.
const buildId = (await readFile('.next/BUILD_ID', 'utf8')).trim(); // require an already-verified production build
const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dir = path.resolve('sweep-report/validation');
await mkdir(dir, { recursive: true });
const cli = path.resolve('node_modules/@playwright/test/cli.js');
const baseArgs = ['test', 'sweep', '--reporter=list,./tests/e2e/sweep-reporter.ts'];
const env = { ...process.env, CS_E2E_PREBUILT: '1', CS_SWEEP_ISOLATED: '1', CS_E2E_PORT: process.env.CS_E2E_PORT ?? '3263' };
delete env.CS_SWEEP_MUTATION;
const evidence = { headSha, buildId, runs: [], mutations: [], status: 'running' };
const save = () => writeFile(path.join(dir, 'validation.json'), JSON.stringify(evidence, null, 2));
// A crash during the first run must not leave a previous validation marked green.
await save();

async function run(name, args, overrides = {}) {
  await rm('sweep-report/coverage.json', { force: true });
  await rm('sweep-report/coverage.md', { force: true });
  const start = performance.now();
  const child = spawnSync(process.execPath, [cli, ...baseArgs, ...args], {
    env: { ...env, ...overrides }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  await writeFile(path.join(dir, `${name}.log`), `${child.stdout ?? ''}\n${child.stderr ?? ''}`);
  const report = JSON.parse(await readFile('sweep-report/coverage.json', 'utf8'));
  await copyFile('sweep-report/coverage.json', path.join(dir, `${name}.json`));
  await copyFile('sweep-report/coverage.md', path.join(dir, `${name}.md`));
  const result = { name, exitCode: child.status, elapsedMs: Math.round(performance.now() - start), executionMs: report.budget.durationMs,
    rows: report.rows.length, hash: createHash('sha256').update(JSON.stringify(report.rows)).digest('hex') };
  console.log(`${name}: exit=${child.status}, rows=${result.rows}, ${result.elapsedMs}ms`);
  return { report, result };
}

try {
  let firstHash;
  for (let index = 1; index <= 3; index++) {
    const { report, result } = await run(`run-${index}`, ['--project=sweep-375', '--project=sweep-1280', '--project=sweep-fault-375', '--project=sweep-fault-1280']);
    evidence.runs.push(result);
    await save();
    if (result.exitCode !== 0 || report.status !== 'passed') throw new Error(`Full sweep ${index} failed; inspect ${dir}`);
    firstHash ??= result.hash;
    if (firstHash !== result.hash) throw new Error(`Coverage/action sequences differ on run ${index}`);
  }
  for (const name of ['load', 'overflow', 'axe', 'tab-order', 'keyboard-trap', 'focus', 'escape',
    'missing-state', 'unsafe-write', 'dead-end', 'data-loss-guard', 'pageerror', 'console-error',
    'console-warning', 'hydration', 'requestfailed', 'router-requestfailed', 'http']) {
    const { report, result } = await run(`red-${name}`, ['--project=sweep-375', '--grep', `mutation proof: ${name}$`], { CS_SWEEP_MUTATION: name, CS_SWEEP_ISOLATED: '0' });
    evidence.mutations.push(result);
    await save();
    // A startup/configuration failure is not evidence that the detector caught it.
    if (result.exitCode !== 1 || report.tests.length !== 1 || report.tests[0].status !== 'failed' ||
      !report.rows.some((row) => row.check === `mutation/${name}` && row.result === 'fail')) {
      throw new Error(`Mutation ${name} did not produce the required detector failure`);
    }
  }
  await copyFile(path.join(dir, 'run-3.json'), 'sweep-report/coverage.json');
  await copyFile(path.join(dir, 'run-3.md'), 'sweep-report/coverage.md');
  evidence.status = 'passed';
  await save();
} catch (error) {
  evidence.status = 'failed';
  await save();
  throw error;
}

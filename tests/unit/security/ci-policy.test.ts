import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * DEP-01, DEP-02, QA-04, QA-01: the CI workflow itself is policy. These tests
 * read the committed workflow so a later edit cannot quietly weaken it.
 */
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

describe('DEP-01 deterministic clean-checkout pipeline', () => {
  it('installs from the lockfile and runs typecheck, lint, tests and a production build', () => {
    for (const step of ['npm ci', 'npm run typecheck', 'npm run lint', 'npm test', 'npm run build', 'npm run test:e2e']) {
      expect(ci).toContain(step);
    }
    expect(readFileSync('package-lock.json', 'utf8').length).toBeGreaterThan(1000);
  });
});

describe('DEP-02 public and fork CI cannot reach secrets', () => {
  it('uses pull_request (not pull_request_target), read-only permissions and no secrets', () => {
    expect(ci).toMatch(/^on:\n\s+push:/m);
    expect(ci).toContain('pull_request:');
    expect(ci).not.toContain('pull_request_target');
    expect(ci).toMatch(/^permissions:\n\s+contents: read/m);
    // A real secret reference looks like `${{ secrets.NAME }}`; the scanner's file name does not count.
    expect(ci).not.toMatch(/\$\{\{\s*secrets\./);
    expect(ci).toContain('CS_DATA_MODE: fake');
  });

  it('pins every action to a commit SHA', () => {
    const uses = [...ci.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(3);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
});

describe('QA-04 private-data scans cover repo, history and artifacts', () => {
  it('scans tracked files and full history, and uploads only the report directory', () => {
    expect(ci).toContain('npm run check:secrets');
    expect(ci).toContain('npm run check:private');
    expect(ci).toContain('git log -p --all');
    expect(ci).toMatch(/path: playwright-report\//);
  });
});

describe('QA-01 every acceptance ID is accounted for', () => {
  it('has a test reference or an explicit status with owner and reason', () => {
    const out = execFileSync(process.execPath, ['scripts/acceptance-matrix.mjs', '--check'], { encoding: 'utf8' });
    expect(out).toContain('all 103 IDs accounted for');
  });
});

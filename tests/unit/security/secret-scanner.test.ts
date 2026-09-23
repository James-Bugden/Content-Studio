import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * SEC-01. The point of these tests is that the scanner actually fires.
 *
 * A scanner that has never produced a finding is not evidence of a clean
 * repository; it is an untested script. Every case below plants a synthetic
 * value in an isolated temporary directory outside the repository, so no real
 * credential and no committed file is ever involved.
 */

const SCANNER = join(process.cwd(), 'scripts', 'scan-secrets.mjs');

// Every fixture below is assembled at runtime so that this test file does not
// itself contain a literal that the scanner would flag. That keeps the scanner's
// allowlist minimal: an allowlisted file is a file the scanner is blind to.
const SENTINEL = `CS_SECRET_SENTINEL_${'A1B2C3D4'}`;
const AT = String.fromCharCode(64);

let dir: string;

function runScanner(target: string): { code: number; stderr: string; stdout: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCANNER, target], { encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-scan-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('secret scanner', () => {
  it('detects the synthetic sentinel and exits non-zero', () => {
    const file = join(dir, 'planted.txt');
    writeFileSync(file, `harmless line\nvalue = ${SENTINEL}\nanother line\n`, 'utf8');

    const result = runScanner(file);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('test-sentinel');
    expect(result.stderr).toContain('planted.txt:2');
  });

  it('never prints the matched value', () => {
    const file = join(dir, 'quiet.txt');
    writeFileSync(file, `${SENTINEL}\n`, 'utf8');

    const result = runScanner(file);

    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain(SENTINEL);
    expect(result.stdout).not.toContain(SENTINEL);
  });

  it.each([
    ['anthropic-key', `AI_API_KEY=sk-ant-${'a'.repeat(40)}`],
    ['openai-key', `EMBEDDING_API_KEY=sk-proj-${'b'.repeat(48)}`],
    ['google-api-key', `KEY=AIza${'d'.repeat(35)}`],
    ['google-oauth-client-secret', `AUTH_GOOGLE_SECRET=GOCSPX-${'f'.repeat(28)}`],
    ['google-service-account-json', `{ "type": "service_${'account'}" }`],
    ['google-drive-id-url', `see https://docs.google.com/spreadsheets/d/1${'g'.repeat(40)}/edit`],
    ['private-key-block', `-----BEGIN RSA ${'PRIVATE'} KEY-----`],
    ['postgres-url-with-password', `DB=postgresql://owner:hunter2${AT}db.internal:5432/app`],
    ['jwt', `token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.${'e'.repeat(20)}`],
  ])('detects %s', (rule, line) => {
    const file = join(dir, `${rule}.env.sample`);
    writeFileSync(file, `${line}\n`, 'utf8');

    const result = runScanner(file);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(rule);
  });

  it('flags an owner email address but allows example.com', () => {
    const owner = join(dir, 'owner.md');
    writeFileSync(owner, `contact: someone${AT}somewhere.co.uk\n`, 'utf8');
    expect(runScanner(owner).code).toBe(1);

    const synthetic = join(dir, 'synthetic.md');
    writeFileSync(synthetic, 'contact: owner@example.com\n', 'utf8');
    expect(runScanner(synthetic).code).toBe(0);
  });

  it('passes on a clean directory', () => {
    const clean = join(dir, 'clean');
    mkdirSync(clean, { recursive: true });
    writeFileSync(join(clean, 'a.ts'), 'export const value = 1;\n', 'utf8');
    writeFileSync(join(clean, 'b.md'), '# Notes\n\nNothing sensitive here.\n', 'utf8');

    const result = runScanner(clean);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('clean');
  });

  it('ignores binary extensions rather than reporting noise', () => {
    const file = join(dir, 'image.png');
    writeFileSync(file, `${SENTINEL}\n`, 'utf8');

    expect(runScanner(file).code).toBe(0);
  });
});

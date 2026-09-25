import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Architectural boundaries, enforced rather than documented (SEC-07, CS-001).
 */
const NUL = String.fromCharCode(0);

function tracked(prefix: string, exts: string[]): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split(NUL)
    .filter(Boolean)
    .filter((f) => f.startsWith(prefix) && exts.some((e) => f.endsWith(e)));
}

const read = (f: string) => readFileSync(f, 'utf8');

describe('client code never reaches server credentials', () => {
  const clientFiles = tracked('src/', ['.ts', '.tsx']).filter((f) => /^\s*['"]use client['"]/m.test(read(f)));

  it('no client module imports env, integrations, application services or server-only helpers', () => {
    const forbidden = /from\s+['"]@\/(lib\/env|lib\/http|lib\/auth|integrations\/|application\/|observability\/server)/;
    const offenders = clientFiles.filter((f) => forbidden.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('every server-side integration and service module declares server-only', () => {
    const serverFiles = [
      ...tracked('src/integrations/', ['.ts']),
      ...tracked('src/application/', ['.ts']),
      ...tracked('src/lib/', ['.ts']),
    ].filter((f) => !f.endsWith('.d.ts') && !f.startsWith('src/lib/client/'));
    const missing = serverFiles.filter((f) => !/^import ['"]server-only['"];/m.test(read(f)));
    expect(missing).toEqual([]);
  });

  it('no module reads a provider secret through NEXT_PUBLIC_', () => {
    const offenders = tracked('src/', ['.ts', '.tsx']).filter((f) => /NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN)/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe('Supabase clients stay server-only', () => {
  it('never imports the SDK or privileged Reply helpers from a client module', () => {
    const replyClientFiles = tracked('src/', ['.ts', '.tsx']).filter((file) =>
      /^\s*['"]use client['"]/m.test(read(file)),
    );
    const forbidden = [
      '@supabase/supabase-js',
      '@/replies/lib/supabase/',
      '@/replies/lib/auth/',
      '@/replies/lib/config/env',
      '@/replies/lib/server/',
    ];
    const offenders = replyClientFiles.filter((file) => {
      const runtimeSource = read(file).replace(/^import\s+type\s+.*;$/gm, '');
      return forbidden.some((specifier) => runtimeSource.includes(specifier));
    });
    expect(offenders).toEqual([]);
  });

  it('never exposes the service credential through a public environment name', () => {
    const offenders = tracked('src/', ['.ts', '.tsx']).filter((file) =>
      read(file).includes('NEXT_PUBLIC_SUPABASE_READ_MODEL_SERVICE_KEY'),
    );
    expect(offenders).toEqual([]);
  });
});

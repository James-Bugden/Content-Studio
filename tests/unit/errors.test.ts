import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { AppError, ERROR_CODES, isAppError, toAppError } from '@/domain/errors';
import { AppError as RepliesAppError } from '@/replies/lib/contracts/errors';

describe('application errors across server module identities (#170)', () => {
  it('preserves same-graph errors and their exact message/details', () => {
    for (const code of ERROR_CODES) {
      const error = new AppError(code, { provider: 'synthetic' }, 'Synthetic safe message');
      expect(isAppError(error)).toBe(true);
      expect(toAppError(error)).toBe(error);
      expect(error.message).toBe('Synthetic safe message');
    }
  });

  it('recognises the actual module in a separate VM realm', () => {
    const source = readFileSync('src/domain/errors.ts', 'utf8');
    const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
    const exports = runInNewContext(`${compiled}\nexports`, { exports: {} }) as typeof import('@/domain/errors');
    for (const code of ERROR_CODES) {
      const foreign = new exports.AppError(code, { provider: 'synthetic' });
      expect(foreign).not.toBeInstanceOf(Error);
      expect(isAppError(foreign)).toBe(true);
      expect(toAppError(foreign)).toBe(foreign);
    }
  });

  it('rejects the separate Replies error vocabulary', () => {
    expect(isAppError(new RepliesAppError('rate_limited', 'Synthetic'))).toBe(false);
  });

  // Registry symbols prevent accidental data forgery, not deliberate in-process
  // code impersonating our class. Such code already has application authority.
  it('documents the deliberate symbol-forgery boundary', () => {
    const deliberate = Object.assign(new Error('Synthetic'), {
      [Symbol.for('content-studio.AppError')]: true, code: 'RATE_LIMITED', details: {},
    });
    expect(isAppError(deliberate)).toBe(true);
  });

  it.each([
    { code: 'PRIVATE_DETAIL', details: {} },
    { code: 'RATE_LIMITED' },
    { code: 'RATE_LIMITED', details: null },
    { code: 'RATE_LIMITED', details: [] },
    { code: 'rate_limited', details: {} },
  ])('rejects malformed branded foreign errors: %s', fields => {
    const error = Object.assign(new Error('Synthetic'), { [Symbol.for('content-studio.AppError')]: true }, fields);
    expect(isAppError(error)).toBe(false);
    expect(toAppError(error).code).toBe('UNKNOWN');
  });

  it.each([false, undefined, 'true'])('requires the exact brand value: %s', brand => {
    expect(isAppError({ [Symbol.for('content-studio.AppError')]: brand, code: 'RATE_LIMITED', details: {} })).toBe(false);
  });

  it('preserves every typed code from an independently loaded module', async () => {
    vi.resetModules();
    const { AppError: OtherAppError } = await import('@/domain/errors');
    expect(OtherAppError).not.toBe(AppError);
    for (const code of ERROR_CODES) {
      const other = new OtherAppError(code, { provider: 'synthetic' });
      expect(other).not.toBeInstanceOf(AppError);
      expect(isAppError(other)).toBe(true);
      expect(toAppError(other)).toBe(other);
      expect(toAppError(other).code).toBe(code);
      expect(toAppError(other).details).toEqual({ provider: 'synthetic' });
    }
  });

  it.each([
    null, undefined, 'RATE_LIMITED',
    { name: 'AppError', code: 'RATE_LIMITED', details: {} },
    Object.assign(new Error('Synthetic provider payload'), { name: 'AppError', code: 'RATE_LIMITED', details: {} }),
    Object.assign(new Error('Synthetic provider payload'), { code: 'RATE_LIMITED', details: {} }),
    Object.assign(new Error('Synthetic provider payload'), { name: 'AppError', code: 'INVALID_CODE', details: {} }),
    Object.assign(new Error('Synthetic provider payload'), { name: 'AppError', code: 'RATE_LIMITED' }),
    Object.assign(new Error('Synthetic provider payload'), { name: 'AppError', code: 'RATE_LIMITED', details: null }),
    Object.assign(new Error('Synthetic provider payload'), { name: 'AppError', code: 'RATE_LIMITED', details: [] }),
  ])('keeps unknown/malformed errors safely UNKNOWN: %s', (value) => {
    expect(isAppError(value)).toBe(false);
    const safe = toAppError(value);
    expect(safe.code).toBe('UNKNOWN');
    expect(safe.message).not.toContain('Synthetic provider payload');
    expect(safe.details).toEqual({});
  });
});

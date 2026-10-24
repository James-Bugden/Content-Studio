import { describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES, isAppError, toAppError } from '@/domain/errors';

describe('application errors across server module identities (#170)', () => {
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

import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '@/domain/errors';

/** Fail closed and compare without a secret-dependent early exit. */
export function requireCronSecret(request: Request, secret: string | undefined): void {
  if (!secret) throw new AppError('FORBIDDEN', { reason: 'cron_auth' });
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  const expected = digest(`Bearer ${secret}`);
  const actual = digest(request.headers.get('authorization') ?? '');
  if (!timingSafeEqual(actual, expected)) {
    throw new AppError('FORBIDDEN', { reason: 'cron_auth' });
  }
}

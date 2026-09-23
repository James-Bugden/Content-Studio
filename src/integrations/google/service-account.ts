import 'server-only';
import { SignJWT, importPKCS8 } from 'jose';
import { AppError } from '@/domain/errors';
import { emit } from '@/observability/events';

/**
 * Google service-account access tokens (server-only, SEC-07).
 *
 * The Sheet and the Drive folder are shared with the service account; the owner's
 * personal OAuth tokens are never stored. Scopes are the minimum for the mode:
 * read-only scopes unless writes are explicitly enabled.
 */
export const SCOPES = {
  sheetsRead: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  sheetsWrite: 'https://www.googleapis.com/auth/spreadsheets',
  driveRead: 'https://www.googleapis.com/auth/drive.readonly',
  driveWrite: 'https://www.googleapis.com/auth/drive',
} as const;

type Cached = { token: string; expiresAt: number };

export class ServiceAccountTokens {
  private cache = new Map<string, Cached>();
  private failures = 0;

  constructor(
    private readonly email: string,
    private readonly privateKeyPem: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async token(scopes: string[]): Promise<string> {
    const key = scopes.slice().sort().join(' ');
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;

    let privateKey: CryptoKey;
    try {
      privateKey = await importPKCS8(this.privateKeyPem.replace(/\\n/g, '\n'), 'RS256');
    } catch {
      throw new AppError('CONFIG_MISSING', { provider: 'google', reason: 'private_key_unreadable' });
    }
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: key })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);

    const res = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) {
      this.failures += 1;
      // OBS-08: repeated auth refresh failure is an alert condition.
      emit({ name: 'google.token_refresh_failed', adapter: 'auth', outcome: 'error', httpStatus: res.status, facts: { consecutive: this.failures } });
      throw new AppError(res.status === 429 ? 'RATE_LIMITED' : res.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'CONFIG_MISSING', {
        provider: 'google',
        reason: 'token_refresh_failed',
      });
    }
    this.failures = 0;
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'google', reason: 'token_missing' });
    this.cache.set(key, { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }
}

/** Map a Google API HTTP status to a typed error. Response bodies are never surfaced. */
export function googleError(status: number, provider: 'sheet' | 'drive'): AppError {
  if (status === 401) return new AppError('CONFIG_MISSING', { provider, reason: 'unauthorised' });
  if (status === 403) return new AppError('FORBIDDEN', { provider, reason: 'no_access' });
  if (status === 404) return new AppError('NOT_FOUND', { provider });
  if (status === 409 || status === 412) return new AppError('CONFLICT', { provider });
  if (status === 429) return new AppError('RATE_LIMITED', { provider });
  if (status >= 500) return new AppError('PROVIDER_UNAVAILABLE', { provider });
  return new AppError('VALIDATION_FAILED', { provider, status });
}

/** Bounded retry for idempotent reads only: 429 and 5xx, with jittered backoff. */
export async function withReadRetry<T>(fn: () => Promise<T>, attempts = 3, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const code = (error as AppError).code;
      if (code !== 'RATE_LIMITED' && code !== 'PROVIDER_UNAVAILABLE') throw error;
      if (i < attempts - 1) await sleep(250 * 2 ** i + Math.floor(Math.random() * 100));
    }
  }
  throw last;
}

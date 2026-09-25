import { z } from 'zod';

/**
 * C07's unified error envelope.
 *
 * The envelope carries a code, a message safe to show a person, whether retrying
 * could help, and a request id. It never carries a stack trace, a provider
 * response body, a SQL string or any part of the owner's writing.
 */

export const errorCodeSchema = z.enum([
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'version_conflict',
  'idempotency_conflict',
  'payload_too_large',
  'rate_limited',
  'provider_invalid_response',
  'provider_timeout',
  'provider_unavailable',
  // The provider did its job and the app decided not to show the result. It is a
  // separate code because blaming the provider for the app's own refusal sends
  // whoever reads it looking at the wrong system.
  'withheld_unsafe',
  'not_configured',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  request_id: z.string(),
  retry_after_seconds: z.number().int().positive().optional(),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

const STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  version_conflict: 409,
  idempotency_conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  provider_invalid_response: 502,
  provider_timeout: 504,
  provider_unavailable: 503,
  // Not a 5xx: nothing upstream failed. The request was understood and answered,
  // and the answer was not fit to show.
  withheld_unsafe: 422,
  not_configured: 503,
  internal_error: 500,
});

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'rate_limited',
  'provider_timeout',
  'provider_unavailable',
  'internal_error',
]);

export function statusForCode(code: ErrorCode): number {
  return STATUS[code];
}

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE.has(code);
}

/**
 * Identity that survives module duplication.
 *
 * `instanceof` compares against one class object, and a bundler can hand two
 * chunks two copies of the same module. Next does exactly that: a server
 * component and a route handler get separate copies, so an AppError thrown inside
 * a store built by a page is not `instanceof` the AppError a route imports. The
 * check silently fails and a deliberate 409 becomes an unexplained 500.
 *
 * `Symbol.for` looks up a process-wide registry rather than a module scope, so a
 * branded property is the same brand in every copy. Use `isAppError`, never
 * `instanceof AppError`; a boundary test enforces that.
 */
const APP_ERROR_BRAND = Symbol.for('social-replies.AppError');

/**
 * An error that carries a code the API layer can map without parsing text.
 *
 * `message` is written for the owner, not for a log grep: it appears in the UI.
 */
export class AppError extends Error {
  readonly [APP_ERROR_BRAND] = true;
  readonly code: ErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(code: ErrorCode, message: string, options?: { retryAfterSeconds?: number; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    if (options?.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

export function isAppError(error: unknown): error is AppError {
  return typeof error === 'object' && error !== null && APP_ERROR_BRAND in error;
}

/**
 * A last-resort structural match for an error that lost its brand.
 *
 * The brand survives module duplication, which is the failure this app actually
 * hit. It would not survive an error crossing a worker boundary, being serialised
 * and revived, or a future bundler doing something new. This recognises the shape
 * instead, so the next variant of that problem degrades to the right status code
 * rather than to a 500 that reads as a crash.
 *
 * It returns the code only. The message is deliberately not trusted from an
 * unbranded object, because the one thing a generic envelope must never do is
 * forward text from an error whose provenance is unknown.
 */
export function recoverAppErrorCode(error: unknown): ErrorCode | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name !== 'AppError' || typeof candidate.code !== 'string') return null;
  const parsed = errorCodeSchema.safeParse(candidate.code);
  return parsed.success ? parsed.data : null;
}

/**
 * Whether a string is shaped like a SQLSTATE at all.
 *
 * Postgres SQLSTATEs are exactly five characters from A to Z and 0 to 9. This
 * exists because the classifier used to treat *any* string `code` as one, and an
 * AppError carries a `code` too. When the brand check failed, `version_conflict`
 * was fed to the SQLSTATE mapper, matched nothing, and fell through to
 * `internal_error`. That is how a deliberate 409 became an unexplained 500: not
 * one bug but two, the second of which turned the first into silence.
 */
export function looksLikeSqlState(value: string): boolean {
  return /^[A-Z0-9]{5}$/.test(value);
}

/**
 * Maps the user-defined SQLSTATEs raised by the recording functions, plus the
 * standard ones worth distinguishing, onto envelope codes.
 *
 * Anything unrecognised becomes `internal_error`: a database message is never
 * forwarded to the client, because it can name another record's existence.
 */
export function codeForSqlState(sqlState: string | undefined): ErrorCode {
  switch (sqlState) {
    case 'SR401':
      return 'unauthenticated';
    case 'SR404':
      return 'not_found';
    case 'SR409':
      return 'version_conflict';
    case '23505': // unique_violation
      return 'version_conflict';
    case '23503': // foreign_key_violation
    case '23514': // check_violation
      return 'validation_failed';
    case '42501': // insufficient_privilege, which for this app means RLS said no
      return 'forbidden';
    default:
      return 'internal_error';
  }
}

/** Generic messages. They never confirm or deny that some other record exists. */
export const GENERIC_MESSAGE: Readonly<Record<ErrorCode, string>> = Object.freeze({
  validation_failed: 'That request was not valid.',
  unauthenticated: 'Sign in to continue.',
  forbidden: 'That is not available.',
  not_found: 'That is not available.',
  version_conflict: 'This changed somewhere else. Check the latest version before saving.',
  idempotency_conflict: 'This save was already handled with different text.',
  payload_too_large: 'That is too long to save.',
  rate_limited: 'Reply ideas are temporarily paused. Your draft is unchanged.',
  provider_invalid_response: "Couldn't create reply ideas. Your draft is unchanged.",
  provider_timeout: "Couldn't create reply ideas. Your draft is unchanged.",
  provider_unavailable: "Couldn't create reply ideas. Your draft is unchanged.",
  withheld_unsafe:
    "These suggestions didn't pass the grounding checks, so they aren't shown. Your draft is unchanged.",
  not_configured: 'Reply ideas are not configured yet. Your draft is unchanged.',
  internal_error: 'Something went wrong. Your text is still here.',
});


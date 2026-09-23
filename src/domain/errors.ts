/**
 * Typed error vocabulary (MASTER-SPEC section 7, OBS-05).
 *
 * Every code has a user message that says what is safe, and a recovery action.
 * Messages never include copy, private IDs or provider payloads.
 */
export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'CONFIG_MISSING',
  'SCHEMA_DRIFT',
  'NOT_FOUND',
  'STALE_READ',
  'CONFLICT',
  'GATE_BLOCKED',
  'AMBIGUOUS_MATCH',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PARTIAL_FAILURE',
  'VALIDATION_FAILED',
  'UNKNOWN',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type RecoveryAction =
  | 'sign_in'
  | 'none'
  | 'configure'
  | 'fix_sheet_headers'
  | 'reload'
  | 'compare'
  | 'resolve_gate'
  | 'choose_match'
  | 'retry_later'
  | 'retry'
  | 'retry_pending_steps'
  | 'fix_input';

export const ERROR_CATALOGUE: Record<ErrorCode, { status: number; message: string; recovery: RecoveryAction; retryable: boolean }> = {
  AUTH_REQUIRED: { status: 401, message: 'Sign in to continue. Nothing was changed.', recovery: 'sign_in', retryable: false },
  FORBIDDEN: { status: 403, message: 'This account cannot do that. Nothing was changed.', recovery: 'none', retryable: false },
  CONFIG_MISSING: {
    status: 503,
    message: 'This integration is not configured yet. Reading and manual work still function where available.',
    recovery: 'configure',
    retryable: false,
  },
  SCHEMA_DRIFT: {
    status: 409,
    message: 'The Sheet columns no longer match the expected layout. No write was attempted.',
    recovery: 'fix_sheet_headers',
    retryable: false,
  },
  NOT_FOUND: { status: 404, message: 'That item was not found. It may have moved or been removed.', recovery: 'reload', retryable: false },
  STALE_READ: {
    status: 409,
    message: 'This item changed since you opened it. Your version is kept; compare before saving.',
    recovery: 'compare',
    retryable: false,
  },
  CONFLICT: {
    status: 409,
    message: 'Someone or something else changed this first. Both versions are kept; choose what to keep.',
    recovery: 'compare',
    retryable: false,
  },
  GATE_BLOCKED: { status: 422, message: 'A release gate is not met yet. Resolve the listed blocker first.', recovery: 'resolve_gate', retryable: false },
  AMBIGUOUS_MATCH: { status: 409, message: 'More than one candidate matches. Choose the right one to continue.', recovery: 'choose_match', retryable: false },
  RATE_LIMITED: { status: 429, message: 'The provider asked us to slow down. Nothing was lost; try again shortly.', recovery: 'retry_later', retryable: true },
  PROVIDER_UNAVAILABLE: {
    status: 503,
    message: 'A provider is unavailable. Nothing was confirmed as written; manual work is still available.',
    recovery: 'retry',
    retryable: true,
  },
  PARTIAL_FAILURE: {
    status: 207,
    message: 'Some steps finished and some did not. Completed steps are listed; retry the rest safely.',
    recovery: 'retry_pending_steps',
    retryable: true,
  },
  VALIDATION_FAILED: { status: 400, message: 'Some input was not valid. Nothing was changed.', recovery: 'fix_input', retryable: false },
  UNKNOWN: { status: 500, message: 'Something unexpected went wrong. Nothing was confirmed as written.', recovery: 'reload', retryable: true },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Safe, content-free details (field names, IDs, gate codes). */
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, details: Record<string, unknown> = {}, message?: string) {
    super(message ?? ERROR_CATALOGUE[code].message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return new AppError('UNKNOWN');
}

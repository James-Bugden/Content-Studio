import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AppError,
  isAppError,
  looksLikeSqlState,
  recoverAppErrorCode,
  GENERIC_MESSAGE,
  codeForSqlState,
  isRetryable,
  statusForCode,
  type ErrorCode,
  type ErrorEnvelope,
} from '@/replies/lib/contracts/errors';
import { REQUEST_LIMITS } from '@/replies/lib/contracts/limits';

/**
 * The shared request and response plumbing for every API route (C07, C10).
 *
 * Three things every private response must do, and therefore three things no
 * route should have to remember:
 *   * never be stored by any cache;
 *   * never carry a stack trace, a SQL message or a provider body;
 *   * never accept a cross-origin mutation.
 */

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  Vary: 'Cookie',
} as const;

export function jsonResponse<T>(body: T, init?: { status?: number; headers?: HeadersInit }): NextResponse {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { ...PRIVATE_HEADERS, ...(init?.headers ?? {}) },
  });
}

export function errorResponse(
  code: ErrorCode,
  message?: string,
  options?: { requestId?: string; retryAfterSeconds?: number },
): NextResponse {
  const envelope: ErrorEnvelope = {
    code,
    message: message ?? GENERIC_MESSAGE[code],
    retryable: isRetryable(code),
    request_id: options?.requestId ?? randomUUID(),
    ...(options?.retryAfterSeconds ? { retry_after_seconds: options.retryAfterSeconds } : {}),
  };

  const headers: Record<string, string> = {};
  if (options?.retryAfterSeconds) headers['Retry-After'] = String(options.retryAfterSeconds);

  return jsonResponse(envelope, { status: statusForCode(code), headers });
}

/**
 * Same-origin enforcement for mutations.
 *
 * The app is a single-user tool served from one origin, so an Origin header that
 * is absent or different is never legitimate for a state-changing request. This
 * runs before the body is even read.
 */
export function assertSameOrigin(request: NextRequest): void {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  const origin = request.headers.get('origin');
  if (!origin) {
    // A browser always sends Origin on a cross-site request, so its absence means
    // the caller is not a browser. This app has no non-browser callers.
    throw new AppError('forbidden', 'That is not available.');
  }

  let sent: URL;
  try {
    sent = new URL(origin);
  } catch {
    // Includes the literal "null" a sandboxed frame sends.
    throw new AppError('forbidden', 'That is not available.');
  }

  // Compare origins, not hosts. Host alone treats http://app and https://app as
  // the same place, which is the one difference that matters when someone can
  // answer for that host over plain http.
  //
  // The expected origin comes from the request itself rather than from
  // APP_BASE_URL. Configuration would be one more thing that has to be right, and
  // getting it wrong on a preview deployment would reject every mutation with a
  // message that says nothing about why.
  const host = request.headers.get('host') ?? new URL(request.url).host;
  const expected = `${forwardedProtocol(request)}//${host}`;

  if (sent.origin !== expected) {
    throw new AppError('forbidden', 'That is not available.');
  }
}

/**
 * The scheme the browser actually used.
 *
 * A proxy terminates TLS, so the request this code sees may be plain http even
 * though the owner is on https. `x-forwarded-proto` is what the proxy sets; the
 * request's own protocol is the fallback for running without one.
 */
function forwardedProtocol(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return `${forwarded.split(',')[0]!.trim()}:`;
  return new URL(request.url).protocol;
}

/**
 * Reads and validates a JSON body.
 *
 * Oversize input is rejected with 413 rather than truncated, because a silently
 * shortened reply is worse than a refused one: the owner would copy text the app
 * had already damaged (C07).
 */
export async function readJson<S extends z.ZodTypeAny>(
  request: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > REQUEST_LIMITS.bodyBytes) {
    throw new AppError('payload_too_large', 'That is too long to save.');
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > REQUEST_LIMITS.bodyBytes) {
    throw new AppError('payload_too_large', 'That is too long to save.');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new AppError('validation_failed', 'That request was not valid.');
  }

  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    // The first issue's message is written for a person; the path is not echoed
    // back with its value, so no submitted text leaves in an error body.
    const issue = result.error.issues[0];
    throw new AppError('validation_failed', issue?.message ?? 'That request was not valid.');
  }
  return result.data;
}

interface PostgresErrorLike {
  code?: string;
  message?: string;
}

/**
 * Turns anything thrown inside a route into a safe envelope.
 *
 * A database error is mapped by SQLSTATE and its message is discarded: Postgres
 * messages name constraints, columns and sometimes values, and this app's rows
 * are the owner's private writing.
 */
export function toErrorResponse(error: unknown, requestId: string = randomUUID()): NextResponse {
  if (isAppError(error)) {
    return errorResponse(error.code, error.message, {
      requestId,
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    });
  }

  if (error instanceof z.ZodError) {
    return errorResponse('validation_failed', error.issues[0]?.message, { requestId });
  }

  // An AppError that arrived without its brand. Worth answering correctly, and
  // worth logging loudly: it means something upstream is producing errors this
  // process cannot identify, which is exactly the condition that once turned
  // every deliberate 409 into a 500.
  const recovered = recoverAppErrorCode(error);
  if (recovered) {
    logUnexpected(error, requestId, 'unbranded AppError');
    return errorResponse(recovered, undefined, { requestId });
  }

  const candidate = error as PostgresErrorLike;
  if (typeof candidate?.code === 'string') {
    // Only a SQLSTATE-shaped string is read as a SQLSTATE. Treating *any* string
    // `code` as one is half of how a deliberate 409 became a silent 500: an
    // AppError carries a `code` too, so `version_conflict` went to the SQLSTATE
    // mapper, matched nothing, and defaulted to internal_error.
    //
    // The two cases are also different problems, and the log says which. An
    // unmapped SQLSTATE means the database did something this app has not
    // accounted for. An unrecognised code means an error arrived from somewhere
    // whose conventions this app does not know at all.
    if (!looksLikeSqlState(candidate.code)) {
      logUnexpected(error, requestId, 'unrecognised error code, not a SQLSTATE');
      return errorResponse('internal_error', undefined, { requestId });
    }

    const code = codeForSqlState(candidate.code);
    if (code === 'internal_error') logUnexpected(error, requestId, 'unmapped SQLSTATE');
    return errorResponse(code, undefined, { requestId });
  }

  logUnexpected(error, requestId);
  return errorResponse('internal_error', undefined, { requestId });
}

/**
 * The one place an unexpected failure is recorded.
 *
 * Returning a generic 500 to the caller is right: a database message can name
 * another record's existence. Returning it and writing nothing anywhere is not.
 * An unexplained 500 with no trace cost most of an afternoon to diagnose once,
 * which is the whole argument for this function.
 *
 * The request id ties the log line to what the owner saw. The name and stack say
 * where it happened. The message is deliberately excluded: it is the part most
 * likely to quote a row, and C10 keeps writing bodies out of logs.
 */
function logUnexpected(error: unknown, requestId: string, note?: string): void {
  const details =
    error instanceof Error
      ? { name: error.name, at: error.stack?.split(String.fromCharCode(10))[1]?.trim() ?? 'unknown' }
      : { name: typeof error, at: 'unknown' };

  console.error(
    `[${requestId}] unhandled ${details.name}${note ? ` (${note})` : ''} at ${details.at}`,
  );
}

/**
 * Wraps a route handler with same-origin enforcement and safe error mapping.
 * A route that uses this cannot accidentally return a raw exception.
 */
export function route(
  handler: (request: NextRequest, context: { requestId: string }) => Promise<NextResponse>,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const requestId = randomUUID();
    try {
      assertSameOrigin(request);
      return await handler(request, { requestId });
    } catch (error) {
      return toErrorResponse(error, requestId);
    }
  };
}


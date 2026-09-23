import 'server-only';
import { NextResponse } from 'next/server';
import { ERROR_CATALOGUE, toAppError, type ErrorCode } from '@/domain/errors';

/** Private responses are never cached by a shared cache (SEC-09). */
export const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' } as const;

export function json<T>(body: T, init: { status?: number } = {}): NextResponse {
  return NextResponse.json(body, { status: init.status ?? 200, headers: NO_STORE });
}

/** Typed error response: code, safe message and recovery only. Never a stack or provider payload. */
export function errorResponse(error: unknown): NextResponse {
  const e = toAppError(error);
  const entry = ERROR_CATALOGUE[e.code];
  return json({ ok: false, code: e.code, message: entry.message, recovery: entry.recovery, details: e.details }, { status: entry.status });
}

/**
 * A typed service result as a response: success is 200; a failure keeps its code,
 * steps and safe details and adds the catalogue message, recovery and status.
 */
export function resultResponse<T extends { ok: true } | { ok: false; code: ErrorCode }>(result: T): NextResponse {
  if (result.ok) return json(result);
  const entry = ERROR_CATALOGUE[result.code];
  return json({ ...result, message: entry.message, recovery: entry.recovery }, { status: entry.status });
}

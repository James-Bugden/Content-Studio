import 'server-only';
import { NextResponse } from 'next/server';
import { ERROR_CATALOGUE, toAppError } from '@/domain/errors';

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

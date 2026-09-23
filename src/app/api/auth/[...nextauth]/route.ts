import type { NextRequest } from 'next/server';
import { AppError } from '@/domain/errors';
import { errorResponse } from '@/lib/http';
import { handlers } from '@/lib/auth/config';
import { googleSignInConfigured } from '@/lib/auth/policy';

export const dynamic = 'force-dynamic';

/**
 * Auth.js endpoints (CS-005). Absent Google configuration they do not exist.
 * The JSON session endpoint is not offered: the app reads sessions server-side
 * only, and the browser never needs the subject identifier.
 */
function unavailable(request: NextRequest): boolean {
  if (!googleSignInConfigured()) return true;
  return request.nextUrl.pathname.replace(/\/+$/, '').endsWith('/api/auth/session');
}

export async function GET(request: NextRequest) {
  if (unavailable(request)) return errorResponse(new AppError('NOT_FOUND'));
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  if (unavailable(request)) return errorResponse(new AppError('NOT_FOUND'));
  return handlers.POST(request);
}

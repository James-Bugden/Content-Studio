import { z } from 'zod';
import { AppError } from '@/domain/errors';
import { errorResponse, json } from '@/lib/http';
import { SYNTHETIC_SUBJECTS, testAuthEnabled } from '@/lib/auth/policy';
import { TEST_COOKIE_NAME, signTestCookie, testCookieOptions } from '@/lib/auth/test-cookie';

export const dynamic = 'force-dynamic';

/**
 * E2E test sign-in (CS-005). Exists only when CS_DATA_MODE=fake, CS_TEST_MODE=e2e
 * and VERCEL_ENV is not production; everywhere else it is a plain 404. Sets or
 * clears a signed httpOnly cookie naming a synthetic subject.
 */
const bodySchema = z.object({ as: z.enum(['owner', 'viewer', 'stranger', 'none']) });

export async function POST(request: Request) {
  if (!testAuthEnabled()) return errorResponse(new AppError('NOT_FOUND'));
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return errorResponse(new AppError('VALIDATION_FAILED', { field: 'as' }));
  }
  const secure = new URL(request.url).protocol === 'https:';
  const res = json({ ok: true });
  if (body.as === 'none') {
    res.cookies.set(TEST_COOKIE_NAME, '', testCookieOptions(secure, 0));
    return res;
  }
  res.cookies.set(TEST_COOKIE_NAME, await signTestCookie(SYNTHETIC_SUBJECTS[body.as]), testCookieOptions(secure));
  return res;
}

export async function GET() {
  return errorResponse(new AppError('NOT_FOUND'));
}

import { NextResponse, type NextRequest } from 'next/server';
import { ownerRoute } from '@/replies/lib/server/owner-route';
import { getStore } from '@/replies/lib/server/get-store';
import { AppError } from '@/replies/lib/contracts/errors';
import { sniffBankImage } from '@/replies/lib/images/validate';

export const dynamic = 'force-dynamic';

/**
 * GET /api/replies/images/:id/file (#245).
 *
 * The only way pixels leave the bank. The owner session is checked before the row
 * is read, so there is no public or signed URL anywhere: the browser holds a
 * same-origin path that is useless without the owner's cookie.
 *
 * Headers match the Library asset route: the bytes are served as an inert image
 * (nosniff, a sandboxing CSP) and cached only privately and briefly. The type sent
 * is re-derived from the bytes, never taken from storage on trust.
 */
export const GET = ownerRoute(async (request: NextRequest, { session }) => {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 2];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('not_found', 'That is not available.');

  const file = await getStore(session).readBankImageFile(id);
  if (!file) throw new AppError('not_found', 'That is not available.');
  const mime = sniffBankImage(file.bytes);
  if (!mime) throw new AppError('not_found', 'That is not available.');

  return new NextResponse(file.bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
      Vary: 'Cookie',
    },
  });
});

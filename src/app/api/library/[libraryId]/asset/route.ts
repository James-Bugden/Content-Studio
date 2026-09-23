import { getServices } from '@/application/container';
import { previewAsset } from '@/application/assets';
import { AppError } from '@/domain/errors';
import { libraryIdSchema } from '@/domain/mutation';
import { requireActor } from '@/lib/auth';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Server-mediated preview of the row's `Image File` (VIS-01). The browser gets
 * bytes from this origin only, never a Drive URL or token. Short private cache.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    await requireActor('viewer');
    const { libraryId } = await ctx.params;
    if (!libraryIdSchema.safeParse(libraryId).success) throw new AppError('VALIDATION_FAILED');
    const { repo, drive } = getServices();
    const record = await repo.getLibrary(libraryId);
    const ref = record.links.imageFile ?? record.cells.imageFile;
    if (!ref.trim()) throw new AppError('NOT_FOUND');
    const { bytes, contentType } = await previewAsset(drive, ref.trim());
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'inline',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

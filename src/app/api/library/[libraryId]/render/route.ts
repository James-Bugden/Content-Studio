import { getServices } from '@/application/container';
import { renderPreview } from '@/application/visuals';
import { AppError } from '@/domain/errors';
import { libraryIdSchema } from '@/domain/mutation';
import { requireActor } from '@/lib/auth';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Server-side SVG preview (CS-012, VIS-03). SVG is never streamed from Drive:
 * this re-renders the saved brief deterministically. The UI shows it through
 * <img>, and the response is sandboxed with a no-script CSP besides, so a copy
 * line cannot become markup or script.
 *
 * `rev=current` renders the current Visual Version; `rev=draft` renders the saved
 * brief as an unversioned draft preview.
 */
export async function GET(request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    await requireActor('viewer');
    const { libraryId } = await ctx.params;
    if (!libraryIdSchema.safeParse(libraryId).success) throw new AppError('VALIDATION_FAILED');
    const rev = new URL(request.url).searchParams.get('rev') ?? 'current';
    if (rev !== 'current' && rev !== 'draft') throw new AppError('VALIDATION_FAILED', { field: 'rev' });
    const { svg, version } = await renderPreview(getServices().repo, libraryId, rev);
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': 'inline',
        'X-Visual-Version': version,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

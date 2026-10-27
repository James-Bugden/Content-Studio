import { getServices } from '@/application/container';
import { imageState, runImageAction } from '@/application/image-pipeline';
import { imageActionSchema } from '@/domain/image-pipeline';
import { AppError, ERROR_CATALOGUE, type ErrorCode } from '@/domain/errors';
import { libraryIdSchema } from '@/domain/mutation';
import { requireActor, requireMutation } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { getImageRenderer } from '@/integrations/image-renderer/container';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    await requireActor('viewer');
    const id = libraryIdSchema.parse(new URL(request.url).searchParams.get('id'));
    return json({ ok: true, image: imageState(await getServices().repo.getLibrary(id, true)) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await requireMutation(request);
    const body = await request.text();
    if (body.length > 8000) throw new AppError('VALIDATION_FAILED');
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { throw new AppError('VALIDATION_FAILED'); }
    const parsed = imageActionSchema.safeParse(raw);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const result = await runImageAction({ ...getServices(), renderer: getImageRenderer() }, actor, parsed.data);
    return json(result, { status: result.ok ? 200 : ERROR_CATALOGUE[result.code as ErrorCode].status });
  } catch (error) { return errorResponse(error); }
}

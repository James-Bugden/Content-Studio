import { createHash } from 'node:crypto';
import { getAiUsage } from '@/application/ai-usage-container';
import { aiCapSchema } from '@/domain/ai-usage';
import { AppError } from '@/domain/errors';
import { requireActor, requireMutation } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';
export async function GET() {
  try { await requireActor('owner'); return json(await getAiUsage().summary()); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    const actor = await requireMutation(request);
    const body = aiCapSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) throw new AppError('VALIDATION_FAILED');
    await getAiUsage().setCap({ ...body.data, actorHash: createHash('sha256').update(actor.sub).digest('hex') });
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

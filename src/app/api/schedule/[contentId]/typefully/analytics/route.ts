import { syncAnalytics } from '@/application/typefully';
import { baseBody, typefullyMutation } from '@/lib/typefully-route';

export const dynamic = 'force-dynamic';

const bodySchema = baseBody;

/**
 * Publication and metric sync for one row's platform only (PUB-01..04).
 * Idempotent: unchanged provider facts write nothing.
 */
export async function POST(request: Request, ctx: { params: Promise<{ contentId: string }> }) {
  return typefullyMutation(request, ctx, bodySchema, ({ services, actor, contentId, body }) =>
    syncAnalytics(services.repo, services.typefully, actor, { ...body, contentId }),
  );
}

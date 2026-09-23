import { z } from 'zod';
import { syncFromTypefully } from '@/application/typefully';
import { baseBody, typefullyMutation } from '@/lib/typefully-route';

export const dynamic = 'force-dynamic';

const bodySchema = baseBody.extend({ resolve: z.literal('take_typefully').optional() });

/**
 * Typefully to Sheet: exact text into Final Content, Content untouched (TYPE-04).
 * A Sheet edit made after the last sync is a conflict unless the owner chose
 * `take_typefully` explicitly (TYPE-05, PUB-03).
 */
export async function POST(request: Request, ctx: { params: Promise<{ contentId: string }> }) {
  return typefullyMutation(request, ctx, bodySchema, ({ services, actor, contentId, body }) =>
    syncFromTypefully(services.repo, services.typefully, actor, { ...body, contentId }),
  );
}

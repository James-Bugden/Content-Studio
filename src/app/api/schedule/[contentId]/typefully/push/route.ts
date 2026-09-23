import { z } from 'zod';
import { pushToTypefully } from '@/application/typefully';
import { baseBody, typefullyMutation } from '@/lib/typefully-route';

export const dynamic = 'force-dynamic';

const bodySchema = baseBody.extend({ resolve: z.literal('take_sheet').optional() });

/**
 * Sheet to Typefully. A newer Typefully edit blocks the overwrite unless the
 * owner chose `take_sheet` explicitly (TYPE-05).
 */
export async function POST(request: Request, ctx: { params: Promise<{ contentId: string }> }) {
  return typefullyMutation(request, ctx, bodySchema, ({ services, actor, contentId, body }) =>
    pushToTypefully(services.repo, services.typefully, actor, { ...body, contentId }),
  );
}

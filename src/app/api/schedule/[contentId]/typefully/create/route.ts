import { z } from 'zod';
import { createDraft } from '@/application/typefully';
import { baseBody, typefullyMutation } from '@/lib/typefully-route';

export const dynamic = 'force-dynamic';

/**
 * Plan and never auto-publish by default. Publishing timing is not accepted here:
 * the owner schedules publication in Typefully itself.
 */
const bodySchema = baseBody.extend({ timing: z.enum(['plan', 'none']).default('plan') });

/**
 * Create a planned Typefully draft for a row with no match (TYPE-02). The same
 * operation id on a retry or double click looks the earlier draft up first, so
 * at most one draft and one linked row result.
 */
export async function POST(request: Request, ctx: { params: Promise<{ contentId: string }> }) {
  return typefullyMutation(request, ctx, bodySchema, ({ services, actor, contentId, body }) =>
    createDraft(services.repo, services.typefully, actor, { ...body, contentId }),
  );
}

import { z } from 'zod';
import { linkDraft } from '@/application/typefully';
import { baseBody, typefullyMutation } from '@/lib/typefully-route';

export const dynamic = 'force-dynamic';

const bodySchema = baseBody.extend({ draftId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

/** Link an existing Typefully draft the owner picked explicitly (TYPE-01, TYPE-03). */
export async function POST(request: Request, ctx: { params: Promise<{ contentId: string }> }) {
  return typefullyMutation(request, ctx, bodySchema, ({ services, actor, contentId, body }) =>
    linkDraft(services.repo, services.typefully, actor, { ...body, contentId }),
  );
}

import { createHash } from 'node:crypto';
import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { once } from '@/replies/lib/server/ai-memo';
import { getServices } from '@/application/container';
import { suggestBankImageMeta } from '@/application/bank-images';
import { bankImageSuggestSchema, type BankImageSuggestResponse } from '@/replies/lib/contracts/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/replies/images/suggest (#245).
 *
 * One small AI call proposing a title, alt text and tags for an image the owner is
 * about to upload. The owner edits all three before anything is saved, and nothing
 * is saved here.
 *
 * The call goes through the one AI gateway, so it is counted in the monthly cap and
 * refused with "Monthly AI limit reached" once the cap is spent. The gateway sends
 * text only, so the model sees the file name and the owner's note, never the pixels.
 */
export const POST = ownerRoute(async (request) => {
  const body = await readJson(request, bankImageSuggestSchema);
  const hash = createHash('sha256').update(JSON.stringify([body.file_name, body.hint ?? ''])).digest('hex');

  const suggestion = await once(`tags:${body.request_key}`, hash, () =>
    suggestBankImageMeta(getServices().ai, { fileName: body.file_name, hint: body.hint ?? '' }, request.signal),
  );
  const response: BankImageSuggestResponse = suggestion;
  return jsonResponse(response);
});

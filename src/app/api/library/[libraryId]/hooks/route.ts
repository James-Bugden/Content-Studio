import { z } from 'zod';
import { getServices } from '@/application/container';
import { generateHooks, type HookReference } from '@/application/hooks';
import type { DriveGateway } from '@/application/ports';
import { AppError } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import { libraryIdSchema, revisionSchema } from '@/domain/mutation';
import { requireMutation } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { errorResponse, resultResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  draft: z.string().min(1).max(40_000),
  draftHash: revisionSchema,
});

/** Hook reference documents from Drive, read as untrusted data. Unreadable ones are skipped. */
async function references(drive: DriveGateway): Promise<HookReference[]> {
  const ids = (serverEnv().CS_HOOK_REFERENCE_FILE_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  const out: HookReference[] = [];
  for (const fileId of ids) {
    try {
      const { text, meta } = await drive.readText(fileId);
      out.push({ fileId, revision: meta.revision, text });
    } catch {
      // A missing reference only narrows the prompt; generation still works.
    }
  }
  return out;
}

/**
 * Hook review generation (CS-010 HOOK-01/02). Proposes exactly three alternatives
 * for the exact draft the editor sent and writes nothing. The current hook and the
 * platform come from the Library row.
 */
export async function POST(request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    await requireMutation(request);
    const { libraryId } = await ctx.params;
    if (!libraryIdSchema.safeParse(libraryId).success) throw new AppError('VALIDATION_FAILED');
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const { draft, draftHash } = parsed.data;
    if (fingerprint(draft) !== draftHash) throw new AppError('STALE_READ', { reason: 'draft_hash_mismatch' });
    const { repo, drive, ai } = getServices();
    const record = await repo.getLibrary(libraryId);
    const platform = record.value.targetPlatform;
    if (!platform.ok) throw new AppError('VALIDATION_FAILED', { reason: 'platform_unrecognised' });
    const refs = await references(drive);
    const result = await generateHooks({
      ai,
      libraryId,
      platform: platform.value,
      currentHook: record.value.currentHook,
      draft,
      draftHash,
      ...(refs.length ? { references: refs } : {}),
      signal: request.signal,
    });
    return resultResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}

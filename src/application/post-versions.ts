import 'server-only';
import { z } from 'zod';
import { fingerprint } from '@/domain/hash';
import { AppError } from '@/domain/errors';
import { operationIdSchema, revisionSchema, type Actor } from '@/domain/mutation';
import { SAVE_PLATFORMS } from '@/domain/post-versions';
import type { ContentRepository, AiGateway } from './ports';
import { ZH_TW_TASK } from './zh-tw';
import { sectionBodyProblems } from '@/domain/markdown';

export const versionSaveSchema = z.object({
  operationId: operationIdSchema, expectedRevision: revisionSchema,
  proposed: z.string().max(40_000),
  platforms: z.array(z.enum(SAVE_PLATFORMS)).min(1).max(3).refine(p => new Set(p).size === p.length),
  chinese: z.object({ source: z.string().max(40_000), content: z.string().min(1).max(40_000) }).strict().optional(),
}).strict();

export async function savePostVersions(repo: ContentRepository, actor: Actor, libraryId: string, input: z.infer<typeof versionSaveSchema>) {
  if (actor.role !== 'owner') throw new AppError('FORBIDDEN');
  if (!repo.updatePostProperties || repo.draftBodyAuthority?.() !== 'db') throw new AppError('FORBIDDEN');
  const parsed = versionSaveSchema.safeParse(input);
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');
  const data = parsed.data;
  if (sectionBodyProblems(data.proposed, 2).length) throw new AppError('VALIDATION_FAILED', { reason: 'unsafe_markdown_structure' });
  if (data.chinese && data.chinese.source !== data.proposed) throw new AppError('STALE_READ');
  return repo.updatePostProperties({ operationId: data.operationId, actor, target: { libraryId }, expectedRevision: data.expectedRevision,
    patch: { draft: data.proposed, versions: data.platforms.map(platform => ({ platform, english: data.proposed,
      sourceHash: fingerprint(data.proposed), ...(data.chinese ? { chinese: data.chinese.content } : {}) })) } });
}

/** Draft proposals reuse the existing zh-TW task. Publication approval still uses the scheduled adaptation gates. */
export async function proposePostChinese(repo: ContentRepository, ai: AiGateway, libraryId: string, source: string, signal?: AbortSignal) {
  await repo.getLibrary(libraryId, true);
  if (!source.trim() || source.length > 30_000) throw new AppError('VALIDATION_FAILED');
  const hook = source.split('\n').find(line => line.trim())?.slice(0, 2000) ?? '';
  const result = await ai.run(ZH_TW_TASK, { hook, content: source }, { signal });
  return result.ok ? { ok: true as const, source, content: result.value.content, qa: result.value.qa } : result;
}

export const postLifecycleSchema = z.object({ operationId: operationIdSchema, expectedRevision: revisionSchema,
  action: z.enum(['delete', 'restore']), deletedAt: z.string().datetime().optional() }).strict();

export async function changePostLifecycle(repo: ContentRepository, actor: Actor, libraryId: string, input: z.infer<typeof postLifecycleSchema>) {
  if (actor.role !== 'owner' || !repo.updatePostProperties || repo.draftBodyAuthority?.() !== 'db') throw new AppError('FORBIDDEN');
  const data = postLifecycleSchema.parse(input);
  // A stable timestamp supplied on the first attempt makes transport retries identical.
  if (data.action === 'delete' && !data.deletedAt) throw new AppError('VALIDATION_FAILED');
  return repo.updatePostProperties({ operationId: data.operationId, actor, target: { libraryId }, expectedRevision: data.expectedRevision,
    patch: { deletedAt: data.action === 'delete' ? data.deletedAt! : null } });
}

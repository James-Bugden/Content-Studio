import 'server-only';
import { z } from 'zod';
import { AppError } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import { findSection } from '@/domain/markdown';
import { parseDriveFileId } from '@/domain/links';
import { libraryIdSchema, operationIdSchema, revisionSchema, type Actor } from '@/domain/mutation';
import type { ContentRepository, DriveGateway } from './ports';

import type { MarkdownImportPreview } from '@/domain/markdown-import';
export type { MarkdownImportPreview } from '@/domain/markdown-import';
function ownerDb(repo: ContentRepository, actor: Actor) {
  if (actor.role !== 'owner' || repo.draftBodyAuthority?.() !== 'db') throw new AppError('FORBIDDEN');
}

export async function previewMarkdownImport(repo: ContentRepository, drive: DriveGateway, actor: Actor, link: string): Promise<MarkdownImportPreview> {
  ownerDb(repo, actor);
  const fileId = parseDriveFileId(link);
  if (!fileId) throw new AppError('VALIDATION_FAILED');
  const read = await drive.readText(fileId);
  if (read.meta.trashed) throw new AppError('NOT_FOUND');
  const sections: MarkdownImportPreview['sections'] = [];
  const refused: string[] = [];
  for (const row of await repo.listLibrary()) {
    const found = findSection(read.text, row.value.libraryId);
    if (!found.ok) {
      if (found.reason === 'duplicate') refused.push(row.value.libraryId);
      continue;
    }
    sections.push({ libraryId: row.value.libraryId, databaseBody: row.value.draftContent, markdownBody: found.section.body,
      expectedRevision: row.revision, sectionHash: found.section.bodyHash, differs: row.value.draftContent !== found.section.body });
  }
  if (!sections.length) throw new AppError(refused.length ? 'CONFLICT' : 'NOT_FOUND', { reason: refused.length ? 'duplicate_section' : 'no_matching_library_ids' });
  return { fileId, fileRevision: read.meta.revision, refused, sections };
}

export const markdownImportInput = z.object({
  operationId: operationIdSchema, libraryId: libraryIdSchema, fileId: z.string().min(1).max(300),
  fileRevision: z.string().min(1).max(300), expectedRevision: revisionSchema, sectionHash: revisionSchema,
  // Every section, including an equal body, needs an explicit confirmation.
  direction: z.enum(['markdown_to_db', 'keep_db']),
  markdownBody: z.string().max(40_000),
}).strict();

export async function importMarkdownSection(repo: ContentRepository, drive: DriveGateway, actor: Actor, raw: unknown) {
  ownerDb(repo, actor);
  const parsed = markdownImportInput.safeParse(raw);
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');
  const input = parsed.data;
  if (input.direction === 'keep_db') {
    // No write, no new baseline and no permission for a later export overwrite.
    return { ok: true as const, kept: true, operationId: input.operationId };
  }
  if (parseDriveFileId(input.fileId) !== input.fileId || fingerprint(input.markdownBody) !== input.sectionHash) throw new AppError('VALIDATION_FAILED');
  const read = await drive.readText(input.fileId);
  const section = findSection(read.text, input.libraryId);
  if (read.meta.trashed || read.meta.revision !== input.fileRevision || !section.ok || section.section.body !== input.markdownBody) throw new AppError('STALE_READ');
  // The exact body patch is stable on replay. Source links stay unchanged. The DB ledger binds
  // actor, target, operation and content; CAS refuses a newer DB row.
  return repo.updateLibrary({ actor, operationId: input.operationId, target: { libraryId: input.libraryId }, expectedRevision: input.expectedRevision,
    patch: { draftContent: input.markdownBody } });
}

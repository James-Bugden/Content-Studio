import 'server-only';
import { evaluateLibraryGates } from '@/domain/gates';
import type { LibraryRecord } from '@/domain/records';
import { formatVisualSource } from '@/domain/visual';
import type { EditorModel } from '@/domain/views';

export type { EditorModel };
import { readSection } from './markdown-source';
import type { ContentRepository, DriveGateway } from './ports';
import { screenshotUses } from './review';
import { AppError } from '@/domain/errors';

/**
 * Editor view model (CS-008). Loads the authoritative Library row and its
 * Markdown section together, with both revisions, and says plainly when they
 * disagree. The editor never guesses which one is right.
 */

export async function loadEditor(repo: ContentRepository, drive: DriveGateway, libraryId: string): Promise<EditorModel> {
  const [library, schedule] = await Promise.all([repo.listLibrary(), repo.listSchedule().catch(() => null)]);
  const record: LibraryRecord | undefined = library.find((r) => r.value.libraryId === libraryId);
  if (!record) throw new AppError('NOT_FOUND');
  const read = await readSection(drive, record);
  const item = record.value;
  const mismatch = read.ok && read.section.body !== item.draftContent;
  const gates = evaluateLibraryGates(item, {
    purpose: 'review',
    markdown: read.ok ? (mismatch ? 'mismatch' : 'ok') : 'unknown',
    screenshotUses: schedule === null && item.visual.source.kind === 'screenshot' ? null : screenshotUses(item, library, schedule ?? []),
  });
  return {
    libraryId: item.libraryId,
    slug: item.slug,
    source: item.contentSource,
    targetPlatform: item.targetPlatform.ok ? item.targetPlatform.value : 'Unrecognised',
    reviewStatus: item.reviewStatus.ok ? item.reviewStatus.value : 'Unrecognised',
    sheet: { revision: record.revision, draft: item.draftContent, hook: item.currentHook },
    markdown: read.ok
      ? {
          state: 'ok',
          body: read.section.body,
          sectionHash: read.section.bodyHash,
          fileRevision: read.meta.revision,
          modifiedTime: read.meta.modifiedTime,
          headingLine: read.section.headingLine,
        }
      : { state: 'unavailable', reason: read.reason, code: read.code },
    mismatch,
    visual: formatVisualSource(item.visual.source) || 'Undecided',
    gates,
  };
}

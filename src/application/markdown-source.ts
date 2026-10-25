import 'server-only';
import { fingerprint } from '@/domain/hash';
import { AppError, isAppError, type ErrorCode } from '@/domain/errors';
import { parseDriveFileId } from '@/domain/links';
import { findSection, type MarkdownSection } from '@/domain/markdown';
import type { LibraryRecord } from '@/domain/records';
import type { DriveFileMeta, DriveGateway } from './ports';

/**
 * Resolve and read the Library-ID section of the master Markdown (CS-004).
 *
 * The file id comes only from the row's own `Source Markdown` link (hyperlink or
 * HYPERLINK formula) or, failing that, a link in `Source Master File`. Section
 * text is data: it is never rendered as HTML or interpreted.
 */
export type SectionRead =
  | { ok: true; fileId: string; meta: DriveFileMeta; section: MarkdownSection; text: string }
  | { ok: false; code: ErrorCode; reason: 'no_link' | 'missing_section' | 'duplicate_section' | 'trashed' | 'provider'; fileId?: string };

export function markdownFileId(record: LibraryRecord): string | null {
  const candidates = [record.links.sourceMarkdown, record.cells.sourceMarkdown, record.links.sourceMasterFile, record.cells.sourceMasterFile];
  for (const c of candidates) {
    if (!c) continue;
    const id = parseDriveFileId(c);
    if (id) return id;
  }
  return null;
}

function safeReadErrorCode(error: unknown): ErrorCode {
  return isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE';
}

export async function readSection(drive: DriveGateway, record: LibraryRecord, authority?: 'db'): Promise<SectionRead> {
  if (authority === 'db') {
    const body = record.value.draftContent;
    return { ok: true, fileId: '', text: body,
      meta: { id: '', mimeType: 'text/plain', revision: record.revision, modifiedTime: '', size: Buffer.byteLength(body), trashed: false },
      section: { libraryId: record.value.libraryId, headingLine: '', level: 2, body, bodyHash: fingerprint(body), bodyStart: 0, bodyEnd: body.length } };
  }
  const fileId = markdownFileId(record);
  if (!fileId) return { ok: false, code: 'NOT_FOUND', reason: 'no_link' };
  let text: string;
  let meta: DriveFileMeta;
  try {
    ({ text, meta } = await drive.readText(fileId));
  } catch (error) {
    return { ok: false, code: safeReadErrorCode(error), reason: 'provider', fileId };
  }
  if (meta.trashed) return { ok: false, code: 'NOT_FOUND', reason: 'trashed', fileId };
  const found = findSection(text, record.value.libraryId);
  if (!found.ok) {
    return { ok: false, code: found.reason === 'missing' ? 'NOT_FOUND' : 'CONFLICT', reason: found.reason === 'missing' ? 'missing_section' : 'duplicate_section', fileId };
  }
  return { ok: true, fileId, meta, section: found.section, text };
}

export function sectionOrThrow(read: SectionRead): Extract<SectionRead, { ok: true }> {
  if (!read.ok) throw new AppError(read.code, { reason: read.reason });
  return read;
}

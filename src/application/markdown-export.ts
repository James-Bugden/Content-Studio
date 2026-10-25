import 'server-only';
import { AppError, isAppError } from '@/domain/errors';
import { safeReplaceSectionBody } from '@/domain/markdown';
import { readSection, markdownFileId } from './markdown-source';
import type { ContentRepository, DriveGateway } from './ports';

/** Private outbox payloads are never returned by an HTTP route or telemetry. */
export type MarkdownExport = { libraryId: string; version: string; expectedBody: string; body: string; since: number };
export interface MarkdownExportStore {
  pendingMarkdownExports(): Promise<MarkdownExport[]>;
  completeMarkdownExport(job: MarkdownExport): Promise<void>;
  /** Audited body edits with a before-image; initial imports are not DB edits. */
  markdownBodyEdits(): Promise<string[]>;
}

/** Only the db composition opts in. db-read retains the Drive/Sheet saga. */
export function databaseBodyRepository(repo: ContentRepository): ContentRepository {
  return new Proxy(repo, { get(target, key) {
    if (key === 'draftBodyAuthority') return () => 'db';
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

export class MarkdownExporter {
  private active?: Promise<void>;
  readonly failures = new Map<string, { code: string; since: number; reason?: string }>();
  constructor(private readonly repo: ContentRepository, private readonly drive: DriveGateway, private readonly store: MarkdownExportStore,
    private readonly exclusive?: (run: () => Promise<void>) => Promise<void>, private readonly fence?: () => Promise<void>) {}
  async verifyRollback() {
    await this.run();
    if ((await this.store.pendingMarkdownExports()).length) throw new AppError('CONFLICT', { reason: 'rollback_markdown_export_pending' });
    const edited = new Set(await this.store.markdownBodyEdits());
    for (const record of await this.repo.listLibrary()) {
      // Rows without a Drive destination roll back via their exact Sheet body.
      if (!markdownFileId(record)) continue;
      const read = await readSection(this.drive, record);
      // Legacy rows can lack a section (including an ambiguous legacy match).
      // Once a body has been edited, even an empty body must be exported exactly.
      if (!read.ok && !edited.has(record.value.libraryId) && ['no_link', 'missing_section', 'duplicate_section'].includes(read.reason)) continue;
      if (!read.ok || read.section.body !== record.value.draftContent) throw new AppError('CONFLICT', { reason: 'rollback_markdown_not_exact', libraryId: record.value.libraryId });
    }
  }
  async status() {
    const jobs: { libraryId: string; since: number; code?: string; reason?: string; recovery?: 'restore_markdown_link' }[] = [];
    for (const job of await this.store.pendingMarkdownExports()) {
      let failure = this.failures.get(job.libraryId);
      let recovery: 'restore_markdown_link' | undefined;
      try {
        const record = await this.repo.getLibrary(job.libraryId);
        const read = await readSection(this.drive, record);
        if (!read.ok && read.reason === 'no_link') recovery = 'restore_markdown_link';
        // Reconstruct named blockers after restart, without claiming a worker
        // or performing any Drive write during a reconcile inspection.
        if (!read.ok && ['no_link', 'missing_section', 'duplicate_section'].includes(read.reason)) failure = { code: read.code, reason: 'markdown_missing', since: job.since };
        else if (read.ok && read.section.body !== job.expectedBody && read.section.body !== job.body) failure = { code: 'CONFLICT', reason: 'markdown_mismatch', since: job.since };
      } catch { /* Keep any known failure; pending work never disappears. */ }
      jobs.push({ libraryId: job.libraryId, since: job.since, ...failure, ...(recovery ? { recovery } : {}) });
    }
    const edited = new Set(await this.store.markdownBodyEdits());
    for (const record of await this.repo.listLibrary()) if (edited.has(record.value.libraryId) && !markdownFileId(record) && !jobs.some(j => j.libraryId === record.value.libraryId)) {
      jobs.push({ libraryId: record.value.libraryId, since: 0, code: 'NOT_FOUND', reason: 'markdown_missing', recovery: 'restore_markdown_link' });
    }
    return jobs;
  }
  editedLibraryIds() { return this.store.markdownBodyEdits(); }
  run(): Promise<void> {
    if (this.active) return this.active;
    this.active = (this.exclusive ? this.exclusive(() => this.repair()) : this.repair()).finally(() => { this.active = undefined; });
    return this.active;
  }
  private async repair() {
    for (const job of await this.store.pendingMarkdownExports()) {
      try {
        const record = await this.repo.getLibrary(job.libraryId);
        // A newer DB body must not be replaced by an older queued snapshot.
        if (record.value.draftContent !== job.body) throw new AppError('CONFLICT', { reason: 'queued_body_stale' });
        if (!markdownFileId(record)) { await this.store.completeMarkdownExport(job); continue; }
        const read = await readSection(this.drive, record);
        if (!read.ok) throw new AppError(read.code, { reason: ['no_link', 'missing_section', 'duplicate_section'].includes(read.reason) ? 'markdown_missing' : 'markdown_export_unavailable' });
        if (read.section.body !== job.body) {
          if (read.section.body !== job.expectedBody) throw new AppError('CONFLICT', { reason: 'markdown_mismatch' });
          const next = safeReplaceSectionBody(read.text, read.section, job.body);
          if (next === null) throw new AppError('VALIDATION_FAILED');
          await this.fence?.();
          const written = await this.drive.writeText(read.fileId, next, read.meta.revision);
          const after = await this.drive.readText(read.fileId);
          // DRV-01 verifies the entire file, including every byte outside our section.
          if (after.text !== next || after.meta.revision !== written.revision) throw new AppError('CONFLICT');
        }
        await this.store.completeMarkdownExport(job);
        this.failures.delete(job.libraryId);
      } catch (error) {
        this.failures.set(job.libraryId, { code: isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE', since: job.since,
          ...(isAppError(error) && typeof error.details.reason === 'string' ? { reason: error.details.reason } : {}) });
      }
    }
  }
}

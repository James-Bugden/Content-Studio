import 'server-only';
import { AppError, isAppError } from '@/domain/errors';
import { safeReplaceSectionBody } from '@/domain/markdown';
import { readSection } from './markdown-source';
import type { ContentRepository, DriveGateway } from './ports';

/** Private outbox payloads are never returned by an HTTP route or telemetry. */
export type MarkdownExport = { libraryId: string; version: string; expectedBody: string; body: string; since: number };
export interface MarkdownExportStore {
  pendingMarkdownExports(): Promise<MarkdownExport[]>;
  completeMarkdownExport(job: MarkdownExport): Promise<void>;
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
  readonly failures = new Map<string, { code: string; since: number }>();
  constructor(private readonly repo: ContentRepository, private readonly drive: DriveGateway, private readonly store: MarkdownExportStore) {}
  async verifyRollback() {
    await this.run();
    if ((await this.store.pendingMarkdownExports()).length) throw new AppError('CONFLICT', { reason: 'rollback_markdown_export_pending' });
    for (const record of await this.repo.listLibrary()) {
      if (!record.value.draftContent) continue;
      const read = await readSection(this.drive, record);
      if (!read.ok || read.section.body !== record.value.draftContent) throw new AppError('CONFLICT', { reason: 'rollback_markdown_not_exact' });
    }
  }
  async status() {
    return (await this.store.pendingMarkdownExports()).map(job => ({ libraryId: job.libraryId, since: job.since, code: this.failures.get(job.libraryId)?.code }));
  }
  run(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.repair().finally(() => { this.active = undefined; });
    return this.active;
  }
  private async repair() {
    for (const job of await this.store.pendingMarkdownExports()) {
      try {
        const record = await this.repo.getLibrary(job.libraryId);
        // A newer DB body must not be replaced by an older queued snapshot.
        if (record.value.draftContent !== job.body) continue;
        const read = await readSection(this.drive, record);
        if (!read.ok) throw new AppError(read.code);
        if (read.section.body !== job.body) {
          if (read.section.body !== job.expectedBody) throw new AppError('CONFLICT');
          const next = safeReplaceSectionBody(read.text, read.section, job.body);
          if (next === null) throw new AppError('VALIDATION_FAILED');
          const written = await this.drive.writeText(read.fileId, next, read.meta.revision);
          const after = await this.drive.readText(read.fileId);
          // DRV-01 verifies the entire file, including every byte outside our section.
          if (after.text !== next || after.meta.revision !== written.revision) throw new AppError('CONFLICT');
        }
        await this.store.completeMarkdownExport(job);
        this.failures.delete(job.libraryId);
      } catch (error) {
        this.failures.set(job.libraryId, { code: isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE', since: job.since });
      }
    }
  }
}

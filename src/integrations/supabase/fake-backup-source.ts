import 'server-only';
import { AppError } from '@/domain/errors';
import type { BackupPageRequest, BackupRow, BackupRowSource } from '@/application/backup-ports';

const compare = (a: unknown, b: unknown) => (a === b ? 0 : (a as number | string) < (b as number | string) ? -1 : 1);

/** In-memory tables with real keyset semantics (ordering and "after" on composite keys). */
export class FakeBackupRowSource implements BackupRowSource {
  readonly pages: BackupPageRequest[] = [];
  /** Throws on the Nth page request (1-based). */
  failAtPage: number | null = null;
  constructor(readonly tables: Record<string, BackupRow[]> = {}) {}

  async page(request: BackupPageRequest): Promise<BackupRow[]> {
    this.pages.push(request);
    if (this.failAtPage !== null && this.pages.length >= this.failAtPage) throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'db', reason: 'injected' });
    const rows = this.tables[request.table];
    if (!rows) throw new AppError('NOT_FOUND', { provider: 'db', reason: 'table_missing' });
    const dir = request.desc ? -1 : 1;
    const cmp = (a: BackupRow, b: BackupRow) => {
      for (const c of request.order) { const d = compare(a[c], b[c]); if (d) return d * dir; }
      return 0;
    };
    const sorted = [...rows].sort(cmp);
    const after = request.after;
    const rest = after ? sorted.filter(r => cmp(r, after) > 0) : sorted;
    return rest.slice(0, request.limit).map(r => {
      if (!request.select || request.select === '*') return { ...r };
      return Object.fromEntries(request.select.split(',').map(c => [c, r[c]]));
    });
  }

  async count(table: string): Promise<number | null> {
    const rows = this.tables[table];
    if (!rows) throw new AppError('NOT_FOUND', { provider: 'db', reason: 'table_missing' });
    return rows.length;
  }
}

/** Small synthetic dataset for fake mode and tests. */
export function syntheticBackupTables(): Record<string, BackupRow[]> {
  return {
    content_studio_posts: [
      { collection: 'library', library_id: 'SYN-L001', title: 'Synthetic post one', deleted_at: null, image_sketch: null, image_sketch_options: null, platform_versions: null },
      { collection: 'library', library_id: 'SYN-L002', title: 'Synthetic post two', deleted_at: null, image_sketch: 'A', image_sketch_options: null, platform_versions: null },
    ],
    content_studio_schedule: [{ content_id: 'SYN-C001', slot: '2026-11-02' }],
    content_studio_workflow_settings: [{ setting: 'synthetic', value: '1' }],
    content_studio_schema_version: [{ singleton: true, version: 2 }],
    content_studio_row_history: [{ history_id: 1, note: 'a' }, { history_id: 2, note: 'b' }],
    content_studio_audit_events: [{ event_id: 1, kind: 'x' }],
  };
}

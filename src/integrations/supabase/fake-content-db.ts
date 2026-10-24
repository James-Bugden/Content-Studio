import 'server-only';
import type { ContentCollection, ContentDb, ContentPostRow, ContentScheduleRow, ContentSettingRow, ContentSummaryRow } from '@/application/content-db';
import { syntheticLibraryRows, syntheticQueueRows, syntheticScheduleRows, syntheticSettingsRows } from '@/fixtures/synthetic';
import { discoverHeaders, LIBRARY_HEADERS, SCHEDULE_HEADERS } from '@/domain/sheet-schema';
import { toLibraryRecord, toScheduleRecord } from '@/domain/mapping';
import { contentColumn } from './content-repository';
import { CONTENT_STUDIO_SCHEMA_VERSION } from './content-schema';

export type ContentDbSeed = { posts: ContentPostRow[]; schedule: ContentScheduleRow[]; settings: ContentSettingRow[] };
const numeric = new Set(['hookScore', 'contentAngle', 'views', 'likes', 'reposts', 'replies', 'bookmarks', 'newFollowers']);
function typedCells(cells: Record<string, string>) {
  return Object.fromEntries(Object.entries(cells).map(([field, text]) => [contentColumn(field),
    field === 'posted' || field === 'queueForSchedule' ? text === 'TRUE' : numeric.has(field) ? text === '' ? null : Number(text.replace(/,/g, '')) : text]));
}

/** Fixture conversion only, not an importer. DB-4 owns real Sheet import. */
export function syntheticContentDbSeed(): ContentDbSeed {
  const posts = (['library', 'queue'] as const).flatMap(collection => {
    const [header, ...rows] = collection === 'library' ? syntheticLibraryRows() : syntheticQueueRows();
    const found = discoverHeaders(LIBRARY_HEADERS, header!.values);
    if (!found.ok) throw new Error('Invalid synthetic library headers');
    return rows.map((raw, i) => {
      const record = toLibraryRecord(found.index, raw, i + 2);
      return { ...typedCells(record.cells), collection, row_version: 1, source_sheet_row: i + 2,
        sheet_revision: record.revision, passthrough: {}, source_markdown_url: record.links.sourceMarkdown ?? '',
        source_master_file_url: record.links.sourceMasterFile ?? '', image_file_url: record.links.imageFile ?? '' } as ContentPostRow;
    });
  });
  const rows = syntheticScheduleRows();
  const found = discoverHeaders(SCHEDULE_HEADERS, rows[1]!.values);
  if (!found.ok) throw new Error('Invalid synthetic schedule headers');
  const schedule = rows.slice(2).map((raw, i) => {
    const record = toScheduleRecord(found.index, raw, i + 3);
    const [stamp, hash = ''] = record.cells.finalSyncedAt.split(' #');
    return { ...typedCells(record.cells), final_synced_at: stamp || null, final_synced_hash: hash,
      published_at: record.cells.publishedAt || null, analytics_synced_at: record.cells.analyticsSyncedAt || null,
      parent_content_id: record.cells.parentContentId || null,
      row_version: 1, source_sheet_row: i + 3, sheet_revision: record.revision, passthrough: {},
      source_link_url: record.links.sourceLink ?? '', image_file_url: record.links.imageFile ?? '' } as ContentScheduleRow;
  });
  const settings = syntheticSettingsRows().slice(3).map((raw, i) => ({ setting: String(raw.values[0]), value: String(raw.values[1] ?? ''), notes: String(raw.values[2] ?? ''), source_sheet_row: i + 4 }));
  return { posts, schedule, settings };
}

const textCompare = (a: unknown, b: unknown) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const position = (a: { source_sheet_row: number | null }, b: { source_sheet_row: number | null }) => (a.source_sheet_row ?? Infinity) - (b.source_sheet_row ?? Infinity);

export class FakeContentDb implements ContentDb {
  readonly mode = 'fake' as const;
  private readonly seed: ContentDbSeed;
  constructor(seed: ContentDbSeed = syntheticContentDbSeed(), private readonly version: unknown = CONTENT_STUDIO_SCHEMA_VERSION) { this.seed = structuredClone(seed); }
  async schemaVersion() { return this.version; }
  async listPosts(collection: ContentCollection | 'ready') {
    return structuredClone(this.seed.posts.filter(r => collection === 'ready' ? r.collection === 'library' && r.review_status === 'Approved' && r.queue_for_schedule === true : r.collection === collection)
      .sort((a, b) => position(a, b) || textCompare(a.library_id, b.library_id)));
  }
  async getPost(collection: ContentCollection, id: string) { return structuredClone(this.seed.posts.find(r => r.collection === collection && r.library_id === id) ?? null); }
  async listSchedule() { return structuredClone([...this.seed.schedule].sort((a, b) => textCompare(a.date, b.date) || textCompare(a.platform, b.platform) || textCompare(a.slot, b.slot) || textCompare(a.content_id, b.content_id))); }
  async getSchedule(id: string) { return structuredClone(this.seed.schedule.find(r => r.content_id === id) ?? null); }
  async workflowSettings() { return structuredClone([...this.seed.settings].sort((a, b) => position(a, b) || textCompare(a.setting, b.setting))); }
  async queueSummary(): Promise<ContentSummaryRow[]> {
    const groups = new Map<string, ContentPostRow[]>();
    for (const row of this.seed.posts.filter(r => r.collection === 'queue')) {
      const source = String(row.content_source); groups.set(source, [...groups.get(source) ?? [], row]);
    }
    return [...groups].sort(([a], [b]) => textCompare(a, b)).map(([content_source, rows]) => ({
      content_source, master_link: rows.map(r => r.source_master_file_url).filter(Boolean).sort()[0]
        ?? rows.map(r => r.source_markdown_url).filter(Boolean).sort()[0] ?? '', count: rows.length,
      counts: { Total: rows.length, 'Not Reviewed': rows.filter(r => ['', 'Not Reviewed', 'Pending'].includes(String(r.review_status))).length,
        Approved: rows.filter(r => r.review_status === 'Approved').length, Queued: rows.filter(r => r.queue_for_schedule).length,
        'Needs Fix': rows.filter(r => r.review_status === 'Changes Requested' || r.copyright_qa === 'REWORK' || ['CHECK', 'DUPLICATE'].includes(String(r.duplicate_qa))).length },
    }));
  }
}

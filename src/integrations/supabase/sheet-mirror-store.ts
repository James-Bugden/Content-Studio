import 'server-only';
import { AppError } from '@/domain/errors';
import type { MirrorApplyResult, MirrorRow, SheetMirrorSnapshot, SheetMirrorStore } from '@/application/sheet-mirror';

type Fetch = typeof fetch;

export type SupabaseSheetMirrorOptions = {
  url: string;
  serviceKey: string;
  fetch?: Fetch;
};

type DbRow = {
  collection: MirrorRow['collection'];
  stable_id: string;
  source_row: number | null;
  source_revision: string | null;
  row_hash: string;
  payload: unknown;
};

export class SupabaseSheetMirrorStore implements SheetMirrorStore {
  private readonly base: string;
  private readonly request: Fetch;

  constructor(private readonly options: SupabaseSheetMirrorOptions) {
    if (!/^(?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost):54321)\/?$/i.test(options.url)) {
      throw new AppError('CONFIG_MISSING', { provider: 'supabase', reason: 'url' });
    }
    if (options.serviceKey.trim().length < 20) throw new AppError('CONFIG_MISSING', { provider: 'supabase', reason: 'service_key' });
    this.base = options.url.replace(/\/$/, '');
    this.request = options.fetch ?? fetch;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(`${this.base}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.options.serviceKey,
        Authorization: `Bearer ${this.options.serviceKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new AppError(response.status === 409 ? 'CONFLICT' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', {
        provider: 'supabase',
        httpStatus: response.status,
      });
    }
    return (await response.json()) as T;
  }

  async applySnapshot(snapshot: SheetMirrorSnapshot): Promise<MirrorApplyResult> {
    return this.call<MirrorApplyResult>('rpc/apply_content_studio_sheet_snapshot', {
      method: 'POST',
      body: JSON.stringify({
        p_schema_version: snapshot.schemaVersion,
        p_source_key: snapshot.sourceKey,
        p_run_id: snapshot.runId,
        p_started_at: snapshot.startedAt,
        p_snapshot_hash: snapshot.snapshotHash,
        p_counts: snapshot.counts,
        p_rows: snapshot.rows.map((item) => ({
          collection: item.collection,
          stable_id: item.stableId,
          source_row: item.sourceRow,
          source_revision: item.sourceRevision,
          row_hash: item.rowHash,
          payload: item.payload,
        })),
      }),
    });
  }

  async readActive(sourceKey: string): Promise<MirrorRow[]> {
    const query = new URLSearchParams({
      source_key: `eq.${sourceKey}`,
      retired_at: 'is.null',
      select: 'collection,stable_id,source_row,source_revision,row_hash,payload',
      order: 'collection.asc,stable_id.asc',
    });
    const rows = await this.call<DbRow[]>(`content_studio_sheet_rows?${query.toString()}`);
    return rows.map((item) => ({
      collection: item.collection,
      stableId: item.stable_id,
      sourceRow: item.source_row,
      sourceRevision: item.source_revision,
      rowHash: item.row_hash,
      payload: item.payload,
    }));
  }
}

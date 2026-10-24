import 'server-only';
import type { ContentDb, ContentTarget } from './content-db';
import type { ContentRepository, QueueIdeaCreate } from './ports';
import type { LibraryPatch, SchedulePatch } from '@/domain/mapping';
import type { MutationEnvelope, MutationResult } from '@/domain/mutation';
import type { LibraryRecord, ScheduleRecord } from '@/domain/records';
import { AppError, isAppError } from '@/domain/errors';
import { SupabaseContentRepository, sha256 } from '@/integrations/supabase/content-repository';
import { assertContentSchemaVersion } from '@/integrations/supabase/content-schema';
import { typedContentRow } from './content-import';
import { mirrorHash } from './sheet-mirror';

type Record = LibraryRecord | ScheduleRecord;
type Pending = { kind: ContentTarget; id: string; operationId: string; record: Record };

/** Phase C only. DB failures can never veto a Sheet write or authorize one. */
export class ContentReadCutoverRepository implements ContentRepository {
  private readonly reader: SupabaseContentRepository;
  // Disposable read-your-writes overlay, like the existing per-instance Sheet cache.
  // No timer clears a marker: only observing the repaired Sheet fingerprint does.
  private readonly pending = new Map<string, Pending>();
  private generation = 0;
  constructor(private readonly sheet: ContentRepository, private readonly db: ContentDb) {
    this.reader = new SupabaseContentRepository(db, 'db-read');
  }
  capability() { return { ...this.sheet.capability(), provider: 'db' as const }; }
  mutationProvider() { return 'sheet' as const; }
  pendingRefresh(kind: ContentTarget, id: string) { return this.pending.has(this.key(kind, id)); }
  authorityLibrary(id: string) { return this.sheet.getLibrary(id); }
  schema() { return this.reader.schema(); }
  private key(kind: ContentTarget, id: string) { return `${kind}:${id}`; }
  private async verifyPending() {
    for (const [key, entry] of this.pending) {
      const row = await (entry.kind === 'schedule' ? this.db.getSchedule(entry.id) : this.db.getPost(entry.kind, entry.id)).catch(() => null);
      if (row?.sheet_revision === entry.record.revision && this.pending.get(key) === entry) this.pending.delete(key);
    }
    return [...this.pending.values()].map(({ kind, id, operationId }) => ({ kind, id, operationId }));
  }
  async refreshPending() {
    // Reconstruct lag after a process restart too. This explicit reconciliation
    // scan reads the authority; ordinary Content reads never run this scan.
    const generation = this.generation;
    for (const kind of ['library', 'queue', 'schedule'] as const) {
      const originals = await (kind === 'schedule' ? this.sheet.listSchedule() : kind === 'library' ? this.sheet.listLibrary() : this.sheet.listQueue());
      const copies = kind === 'schedule' ? await this.db.listSchedule() : await this.db.listPosts(kind);
      if (this.generation !== generation) return this.verifyPending();
      const revisions = new Map(copies.map(r => ['library_id' in r ? r.library_id : r.content_id, r.sheet_revision]));
      for (const record of originals) {
        const id = 'libraryId' in record.value ? record.value.libraryId : record.value.contentId;
        const key = this.key(kind, id);
        if (revisions.get(id) === record.revision) this.pending.delete(key);
        else this.pending.set(key, { kind, id, record, operationId: this.pending.get(key)?.operationId ?? 'import_repair' });
      }
    }
    return [...this.pending.values()].map(({ kind, id, operationId }) => ({ kind, id, operationId }));
  }
  private async read<R extends Record>(kind: ContentTarget, id: string, read: () => Promise<R>): Promise<R> {
    const entry = this.pending.get(this.key(kind, id));
    if (!entry) return read();
    await this.verifyPending();
    return this.pending.has(this.key(kind, id)) ? this.pending.get(this.key(kind, id))!.record as R : read();
  }
  getLibrary(id: string) { return this.read('library', id, () => this.reader.getLibrary(id)); }
  getQueue(id: string) { return this.read('queue', id, () => this.reader.getQueue(id)); }
  getSchedule(id: string) { return this.read('schedule', id, () => this.reader.getSchedule(id)); }
  private async list<R extends Record>(kind: ContentTarget, read: () => Promise<R[]>): Promise<R[]> {
    await this.verifyPending();
    const rows = await read();
    for (const entry of this.pending.values()) if (entry.kind === kind) {
      const index = rows.findIndex(row => ('libraryId' in row.value ? row.value.libraryId : row.value.contentId) === entry.id);
      if (index < 0) rows.push(entry.record as R); else rows[index] = entry.record as R;
    }
    return rows;
  }
  listLibrary() { return this.list('library', () => this.reader.listLibrary()); }
  listQueue() { return this.list('queue', () => this.reader.listQueue()); }
  listSchedule() { return this.list('schedule', () => this.reader.listSchedule()); }
  async listReadyQueue() {
    if (![...this.pending.values()].some(p => p.kind === 'library')) return this.reader.listReadyQueue();
    return (await this.listLibrary()).filter(r => r.cells.reviewStatus === 'Approved' && r.cells.queueForSchedule === 'TRUE');
  }
  queueSummary() { return this.reader.queueSummary(); }
  workflowSettings() { return this.reader.workflowSettings(); }
  private async write<R extends Record>(kind: ContentTarget, id: string, operationId: string, actor: string,
    write: () => Promise<MutationResult<R>>): Promise<MutationResult<R>> {
    // Observe BEFORE the authority write/read-back. A concurrent import/copy must
    // reject this derived copy, never cause the Sheet mutation to be refused.
    let expectedVersion: string | null = null;
    let observed = false;
    try {
      assertContentSchemaVersion(await this.db.schemaVersion());
      const before = kind === 'schedule' ? await this.db.getSchedule(id) : await this.db.getPost(kind, id);
      expectedVersion = before ? String(before.row_version) : null;
      observed = true;
    } catch { /* The Sheet still owns the mutation. */ }
    const result = await write();
    if (!result.ok) return result;
    const key = this.key(kind, id);
    // Sheet operation replay may return an old before-image. Never copy it over
    // a newer derived row, or replace a newer read-your-writes overlay with it.
    if (result.replayed) {
      const current = await (kind === 'schedule' ? this.sheet.getSchedule(id) : kind === 'library' ? this.sheet.getLibrary(id) : this.sheet.getQueue(id)).catch(() => null);
      if (current?.revision !== result.value.revision) return result;
    }
    this.generation++;
    this.pending.set(key, { kind, id, operationId, record: result.value });
    try {
      if (!observed) throw new AppError('PROVIDER_UNAVAILABLE');
      const data = typedContentRow(kind, id, result.value);
      const copied = await this.db.writeThrough({ operationId: `copy_${sha256(operationId)}`, patchHash: mirrorHash([kind, id, data]),
        actorHash: sha256(actor), kind, id, expectedVersion, data });
      if (!copied.ok) throw new AppError(copied.code ?? 'PROVIDER_UNAVAILABLE');
      // An overlapping request may already have installed a newer pending row.
      if (this.pending.get(key)?.record === result.value) this.pending.delete(key);
      return { ...result, steps: [...result.steps, { step: 'write_through', provider: 'db', status: 'done', revision: result.value.revision }] };
    } catch (error) {
      // A newer Sheet save may have won while this copy was in flight. Keep
      // the newest authoritative read-back in the overlay, not this response's
      // historical value. A read failure leaves the confirmed saved value.
      const current = await (kind === 'schedule' ? this.sheet.getSchedule(id) : kind === 'library' ? this.sheet.getLibrary(id) : this.sheet.getQueue(id)).catch(() => null);
      if (current && this.pending.get(key)?.record === result.value) {
        this.generation++;
        this.pending.set(key, { kind, id, operationId, record: current });
      }
      return { ...result, steps: [...result.steps, { step: 'refresh_pending', provider: 'db', status: 'pending',
        errorCode: isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE' }] };
    }
  }
  updateLibrary(m: MutationEnvelope<{ libraryId: string }, LibraryPatch>) { return this.write('library', m.target.libraryId, m.operationId, m.actor.sub, () => this.sheet.updateLibrary(m)); }
  updateQueue(m: MutationEnvelope<{ libraryId: string }, LibraryPatch>) { return this.write('queue', m.target.libraryId, m.operationId, m.actor.sub, () => this.sheet.updateQueue(m)); }
  updateSchedule(m: MutationEnvelope<{ contentId: string }, SchedulePatch>) { return this.write('schedule', m.target.contentId, m.operationId, m.actor.sub, () => this.sheet.updateSchedule(m)); }
  createQueueIdea(m: QueueIdeaCreate) { return this.write('queue', m.libraryId, m.operationId, m.actor.sub, () => this.sheet.createQueueIdea(m)); }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache, serverEnv } from '@/lib/env';
import { GoogleSheetTransport } from '@/integrations/google/google-sheet';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { syntheticContentDbSeed } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentImportStore } from '@/integrations/supabase/content-import-store';
import { SupabaseContentParityJournal } from '@/integrations/supabase/content-parity-journal';
import { runConfiguredSheetMirror } from '@/lib/sheet-mirror-operation';
import { assertImportMode } from '@/application/content-import';
import { ContentParityJournal, PARITY_COLLECTIONS, shadowContentRepository } from '@/application/content-parity';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { LIBRARY_ORDER } from '@/fixtures/synthetic';
import { SHEET_TABS } from '@/domain/sheet-schema';

const key = '11111111-1111-4111-8111-111111111111';
const owner = { kind: 'owner', idempotencyKey: key } as const;
const env = { CS_DATA_MODE: 'live', CS_CONTENT_STORE: 'db-shadow', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com',
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'synthetic-not-a-key', CS_SHEET_ID: 'synthetic_workbook_0000000000', GOOGLE_WRITE_ENABLED: 'true',
  SUPABASE_READ_MODEL_URL: 'https://synthetic.supabase.co', SUPABASE_READ_MODEL_SERVICE_KEY: 'synthetic-service-key-for-tests', SUPABASE_READ_MODEL_SOURCE_KEY: 'synthetic_source' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let sheet: FakeSheetTransport;
let request: ReturnType<typeof vi.fn<typeof fetch>>;
let events: unknown[];
let completed: Map<string, unknown>;
beforeEach(() => {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  resetServices(); resetEnvCache(); sheet = new FakeSheetTransport(); events = []; completed = new Map();
  vi.spyOn(GoogleSheetTransport.prototype, 'readTab').mockImplementation((...args) => sheet.readTab(...args));
  vi.spyOn(GoogleSheetTransport.prototype, 'writeCells').mockImplementation((...args) => sheet.writeCells(...args));
  const seed = syntheticContentDbSeed();
  request = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://synthetic.supabase.co');
    const name = url.pathname.split('/').at(-1)!;
    const p = init?.body ? JSON.parse(String(init.body)) : {};
    if (name === 'content_studio_shadow_claim') return response(completed.has(p.p_operation_id) ? { status: 'replayed', result: completed.get(p.p_operation_id) } : { status: 'acquired' });
    if (name === 'content_studio_shadow_import') {
      const result = { snapshotHash: p.p_snapshot_hash, counts: p.p_counts, hashes: p.p_hashes, exceptions: p.p_exceptions };
      completed.set(p.p_operation_id, result);
      events.push({ event_id: p.p_token, at: new Date().toISOString(), kind: 'imported', payload: { snapshotAt: Date.now(), evidence: result } });
      return response({ ok: true });
    }
    if (name === 'content_studio_shadow_sample') {
      events.push({ event_id: p.p_event_id, at: new Date().toISOString(), kind: 'sample', payload: p.p_sample }); return response({ ok: true });
    }
    if (name === 'content_studio_shadow_release') return response({ ok: true });
    if (name === 'content_studio_shadow_history') return response(events);
    let rows: unknown[] = name === 'content_studio_schema_version' ? [{ version: 2 }]
      : name === 'content_studio_posts' ? seed.posts.filter(r => r.collection === url.searchParams.get('collection')?.slice(3))
      : name === 'content_studio_ready_queue' ? seed.posts.filter(r => r.collection === 'library' && r.review_status === 'Approved' && r.queue_for_schedule)
      : name === 'content_studio_schedule' ? seed.schedule : name === 'content_studio_workflow_settings' ? seed.settings.map(r => ({ ...r, row_version: r.row_version ?? 1 }))
      : name === 'content_studio_shadow_events' ? events.filter(e => !url.searchParams.has('kind') || (e as { kind: string }).kind === url.searchParams.get('kind')!.slice(3)) : [];
    if (url.searchParams.get('order')?.startsWith('at.desc')) rows = [...rows].reverse();
    const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000);
    return response(rows.slice(offset, offset + limit));
  });
  vi.stubGlobal('fetch', request);
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetServices(); resetEnvCache(); });

describe('DB-9 live Phase A composition over synthetic REST', () => {
  it('keeps default sheet byte-identical and performs no DB work', async () => {
    vi.stubEnv('CS_CONTENT_STORE', undefined); resetEnvCache();
    expect(serverEnv().CS_CONTENT_STORE).toBe('sheet');
    expect(getServices().contentImport).toBeUndefined();
    await getServices().repo.listLibrary(); expect(request).not.toHaveBeenCalled();
  });
  it.each(['db-read', 'db'])('still refuses live %s at env and import boundaries', mode => {
    vi.stubEnv('CS_CONTENT_STORE', mode); resetEnvCache();
    expect(() => serverEnv()).toThrow('not enabled for live data');
    expect(() => assertImportMode()).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(request).not.toHaveBeenCalled();
  });
  it('requires the existing production variables even with the legacy mirror off', () => {
    vi.stubEnv('SUPABASE_READ_MODEL_SERVICE_KEY', undefined); resetEnvCache();
    expect(() => serverEnv()).toThrow('SUPABASE_READ_MODEL_SERVICE_KEY');
    expect(request).not.toHaveBeenCalled();
  });
  it('imports real-composition Sheet records, persists exception evidence, and replays after restart without reading Sheet', async () => {
    const services = getServices();
    expect(services.contentImport).toBeInstanceOf(SupabaseContentImportStore);
    expect(services.contentParity).toBeInstanceOf(SupabaseContentParityJournal);
    const original = (await services.repo.listLibrary())[0]!;
    sheet.externalEdit(SHEET_TABS.library.name, original.row, LIBRARY_ORDER.indexOf('draftContent'), 'Synthetic fresh import body');
    const write = vi.spyOn(sheet, 'writeCells');
    const result = await runConfiguredSheetMirror(owner);
    expect(result).toMatchObject({ status: 'completed', counts: { library: 12, queue: 5, schedule: 21, workflow_settings: 18 } });
    const body = JSON.parse(String(request.mock.calls.find(([url]) => String(url).endsWith('/content_studio_shadow_import'))![1]!.body));
    expect(body.p_rows.length).toBe(56); expect(body.p_exceptions.length).toBeGreaterThan(0);
    expect(body.p_rows.find((r: { target_id: string }) => r.target_id === original.value.libraryId).row.draft_content).toBe('Synthetic fresh import body');
    expect(body.p_operation_id).toBe(`owner:synthetic_source:${key}`);
    expect(write).not.toHaveBeenCalled();
    resetServices(); resetEnvCache();
    const read = vi.spyOn(sheet, 'readTab');
    expect(await runConfiguredSheetMirror(owner)).toMatchObject({ ...result, status: 'replayed' });
    expect(read).not.toHaveBeenCalled();
    await getServices().contentParity!.refresh();
    expect(getServices().contentParity!.summary()).toMatchObject({ scope: 'durable database history', ready: false, lastRun: { snapshotHash: result.snapshotHash } });
  });
  it('returns distributed busy before any Sheet read, and scheduled redelivery has stable identity', async () => {
    request.mockImplementation(async () => response({ status: 'in_progress' }));
    const read = vi.spyOn(sheet, 'readTab');
    expect(await runConfiguredSheetMirror(owner)).toMatchObject({ status: 'in_progress' });
    resetServices(); resetEnvCache();
    await runConfiguredSheetMirror({ kind: 'scheduled' }); await runConfiguredSheetMirror({ kind: 'scheduled' });
    const bodies = request.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies[0].p_operation_id).toBe(bodies[1].p_operation_id); expect(read).not.toHaveBeenCalled();
  });
  it.each([401, 403, 500, 'timeout'])('shadow %s cannot change any Sheet list, detail or mutation response', async failure => {
    request.mockImplementation(async () => { if (failure === 'timeout') throw new DOMException('Synthetic timeout', 'TimeoutError'); return response({ code: '42501' }, Number(failure)); });
    const run = async (store: string) => {
      sheet = new FakeSheetTransport(); vi.stubEnv('CS_CONTENT_STORE', store); resetServices(); resetEnvCache();
      const repo = getServices().repo;
      const lists = await Promise.all([repo.listLibrary(), repo.listQueue(), repo.listReadyQueue(), repo.listSchedule(), repo.queueSummary(), repo.workflowSettings(), repo.schema()]);
      const row = (await repo.listLibrary())[0]!;
      const mutation = { operationId: 'synthetic_write_197', actor: { sub: 'synthetic-owner', role: 'owner' as const }, target: { libraryId: row.value.libraryId }, expectedRevision: row.revision, patch: { currentHook: 'Synthetic revised hook' } };
      const saved = await repo.updateLibrary(mutation);
      expect(saved.ok).toBe(true);
      const replay = await repo.updateLibrary(mutation);
      const conflict = await repo.updateLibrary({ ...mutation, patch: { currentHook: 'Synthetic conflict' } });
      return JSON.stringify({ lists, saved, replay, conflict, detail: await repo.getLibrary(row.value.libraryId) });
    };
    expect(await run('db-shadow')).toBe(await run('sheet'));
  });
  it('refuses every DB writer through the shadow client before fetch', async () => {
    const db = getServices().contentImport!.db;
    const write = { operationId: 'synthetic-write', patchHash: 'a'.repeat(64), actorHash: 'b'.repeat(64), kind: 'library' as const, id: 'SYN-L001', expectedVersion: '1', data: {} };
    for (const action of [() => db.applyPatch(write), () => db.writeThrough(write), () => db.insertQueueIdea(write)]) await expect(action()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(request).not.toHaveBeenCalled();
  });
  it('swallows synchronous comparison and journal exceptions and bounds stalled persistence', async () => {
    const repo = new SheetsContentRepository(new FakeSheetTransport()), db = new SupabaseContentRepository(new FakeContentDb());
    const journal = new ContentParityJournal(), expected = await repo.listLibrary();
    vi.spyOn(db, 'listLibrary').mockImplementation(() => { throw new Error('Synthetic sync'); });
    vi.spyOn(journal, 'record').mockImplementation(() => { throw new Error('Synthetic sink'); });
    expect(await shadowContentRepository(repo, db, journal, () => true).listLibrary()).toEqual(expected);
    expect(journal.available).toBe(false);
    vi.mocked(journal.record).mockImplementation(() => new Promise(() => {}));
    const start = performance.now();
    expect(await shadowContentRepository(repo, db, journal, () => true).listLibrary()).toEqual(expected);
    expect(performance.now() - start).toBeLessThan(1500);
  });
  it('rebuilds 7 days / 200+ durable samples in a fresh instance, refuses malformed or unavailable history', async () => {
    const now = Date.UTC(2026, 9, 25), day = 86400_000;
    for (let d = 7; d >= 1; d--) for (const collection of PARITY_COLLECTIONS) for (let n = 0; n < 5; n++) events.push({ event_id: crypto.randomUUID(), at: new Date(now - d * day + n).toISOString(), kind: 'sample',
      payload: { at: now - d * day + n, collection, idsEqual: true, fields: 1000, equal: 1000, blocking: 0, lagMs: 100, facts: [] } });
    await runConfiguredSheetMirror(owner);
    const journal = new SupabaseContentParityJournal({ url: env.SUPABASE_READ_MODEL_URL, serviceKey: env.SUPABASE_READ_MODEL_SERVICE_KEY });
    await journal.refresh(); journal.lastImport = now;
    expect(journal.summary(now)).toMatchObject({ ready: true, daysGreen: 7, sampleCount: 210 });
    journal.samples.push({ at: now, collection: 'library', idsEqual: true, fields: 1, equal: 1, blocking: 0, lagMs: null, facts: [] });
    expect(journal.summary(now).ready).toBe(false);
    request.mockResolvedValue(response([{ invalid: true }])); await journal.refresh();
    expect(journal.summary(now)).toMatchObject({ ready: false, available: false, sampleCount: 0 });
    request.mockRejectedValue(new Error('Synthetic offline')); await journal.refresh();
    expect(journal.summary(now).ready).toBe(false);
  });
});

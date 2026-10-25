import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache, serverEnv } from '@/lib/env';
import { GoogleSheetTransport } from '@/integrations/google/google-sheet';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { syntheticContentDbSeed } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentImportStore } from '@/integrations/supabase/content-import-store';
import { SupabaseContentParityJournal } from '@/integrations/supabase/content-parity-journal';
import { runConfiguredSheetMirror } from '@/lib/sheet-mirror-operation';
import { assertImportMode, buildTypedImport } from '@/application/content-import';
import { ContentParityJournal, PARITY_COLLECTIONS, shadowContentRepository } from '@/application/content-parity';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { LIBRARY_ORDER } from '@/fixtures/synthetic';
import { buildSheetMirrorSnapshot } from '@/application/sheet-mirror';
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
      const result = { snapshotHash: p.p_snapshot_hash, counts: p.p_counts, hashes: p.p_hashes, exceptions: p.p_exceptions,
        fullParity: { rows: p.p_rows.length, fields: 10000, equal: 10000, idsEqual: true, unclassified: 0 },
        windowWaiver: p.p_window_waiver ? { by: 'owner', on: p.p_window_waiver, recordedAt: new Date().toISOString() } : null };
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
  it.each(['not-a-url', 'https://example.com', ''])('keeps Sheet reads/writes available for invalid shadow URL %s', async url => {
    vi.stubEnv('SUPABASE_READ_MODEL_URL', url); resetEnvCache();
    const services = getServices();
    const row = (await services.repo.listLibrary())[0]!;
    expect(await services.repo.updateLibrary({ operationId: 'synthetic_config_write', actor: { sub: 'synthetic-owner', role: 'owner' }, target: { libraryId: row.value.libraryId }, expectedRevision: row.revision, patch: { currentHook: 'Synthetic config hook' } })).toMatchObject({ ok: true });
    expect(services.contentParity!.summary()).toMatchObject({ ready: false, available: false, gap: 'CONFIG_MISSING' });
    await expect(runConfiguredSheetMirror(owner)).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps a short/missing shadow key as a visible configuration gap', async () => {
    vi.stubEnv('SUPABASE_READ_MODEL_SERVICE_KEY', 'short'); resetEnvCache();
    expect((await getServices().repo.listLibrary()).length).toBeGreaterThan(0);
    expect(getServices().contentParity!.summary().gap).toBe('CONFIG_MISSING');
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
    const originalFetch = request.getMockImplementation()!;
    request.mockImplementation(async (url, init) => {
      // Prepare and persistence stay healthy; failure is at the actual DB read.
      if (String(url).includes('content_studio_shadow_')) return originalFetch(url, init);
      if (failure === 'timeout') throw new DOMException('Synthetic timeout', 'TimeoutError');
      return response({ code: '42501' }, Number(failure));
    });
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
    const shadow = await run('db-shadow');
    expect(events.filter(e => (e as { kind: string }).kind === 'sample')).toHaveLength(7);
    expect(request.mock.calls.some(([url]) => String(url).includes('content_studio_schema_version'))).toBe(true);
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('content_studio_shadow_sample'))).toHaveLength(7);
    expect(getServices().contentParity!.samples.every(s => s.facts[0]?.field === 'provider')).toBe(true);
    expect(shadow).toBe(await run('sheet'));
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
  it('always samples reconcile even when normal request sampling selects nothing', async () => {
    vi.mocked(Math.random).mockReturnValue(1);
    const services = getServices();
    await services.repo.listLibrary(); expect(events).toHaveLength(0);
    expect(services.reconcileRepo).toBeDefined();
    await services.reconcileRepo!.listLibrary();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'sample', payload: { collection: 'library', fields: expect.any(Number) } });
    expect(request.mock.calls.some(([url]) => String(url).includes('content_studio_posts'))).toBe(true);
  });
  it('forwards the explicit waiver to import and reloads its durable owner audit', async () => {
    vi.stubEnv('CS_PARITY_WINDOW_WAIVED', '2026-10-25'); resetEnvCache();
    await runConfiguredSheetMirror(owner);
    const payload = JSON.parse(String(request.mock.calls.find(([url]) => String(url).endsWith('content_studio_shadow_import'))![1]!.body));
    expect(payload.p_window_waiver).toBe('2026-10-25');
    await getServices().contentParity!.refresh();
    expect(getServices().contentParity!.summary()).toMatchObject({ windowWaiver: { by: 'owner', on: '2026-10-25', recordedAt: expect.any(String) }, fullParity: { rows: 56, idsEqual: true }, ready: false });
  });
  it('normalises uppercase owner UUID before durable SQL claim', async () => {
    const upper = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    request.mockImplementation(async () => response({ status: 'in_progress' }));
    await runConfiguredSheetMirror({ kind: 'owner', idempotencyKey: upper });
    const payload = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(payload.p_operation_id).toBe(`owner:synthetic_source:${upper.toLowerCase()}`);
  });
  it('explicitly refuses legacy mirror cron takeover before claim', async () => {
    vi.stubEnv('SUPABASE_READ_MODEL_MODE', 'mirror'); resetEnvCache();
    await expect(runConfiguredSheetMirror({ kind: 'scheduled' })).rejects.toMatchObject({ code: 'CONFIG_MISSING', details: { reason: 'legacy_mirror_refused_in_db_shadow_disable_mirror_mode' } });
    expect(request).not.toHaveBeenCalled();
  });
  it('releases the exact claimed operation and token after import failure', async () => {
    const originalFetch = request.getMockImplementation()!;
    request.mockImplementation((url, init) => String(url).endsWith('content_studio_shadow_import') ? Promise.resolve(response({ ok: false })) : originalFetch(url, init));
    await expect(runConfiguredSheetMirror(owner)).rejects.toMatchObject({ code: 'CONFLICT' });
    const payload = (suffix: string) => JSON.parse(String(request.mock.calls.find(([url]) => String(url).endsWith(suffix))![1]!.body));
    expect(payload('content_studio_shadow_release')).toEqual({ p_operation_id: `owner:synthetic_source:${key}`, p_token: payload('content_studio_shadow_claim').p_token });
  });
  it('live store requires a lease, validates replay, and refuses non-success import responses', async () => {
    const store = getServices().contentImport!;
    const snapshot = await buildSheetMirrorSnapshot(new SheetsContentRepository(sheet), { sourceKey: 'synthetic_source' });
    const envelope = buildTypedImport(snapshot, new Map(), 'a'.repeat(64));
    await expect(store.applyImport(envelope)).rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'import_lease_required' } });
    expect(request).not.toHaveBeenCalled();
    for (const result of [{ ok: false }, {}, { ok: 'true' }]) {
      request.mockImplementation(async () => response(result));
      await expect(store.applyImport(envelope, crypto.randomUUID())).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    request.mockImplementation(async () => response({ status: 'replayed', result: { snapshotHash: 'invalid' } }));
    await expect(store.claim!('synthetic-op', 'b'.repeat(64))).rejects.toThrow();
    const valid = { snapshotHash: 'a'.repeat(64), counts: { library: 0, queue: 0, schedule: 0, workflow_settings: 0 }, hashes: { library: 'a'.repeat(64), queue: 'a'.repeat(64), schedule: 'a'.repeat(64), workflow_settings: 'a'.repeat(64) }, exceptions: [] };
    request.mockImplementation(async () => response({ status: 'replayed', result: { ...valid, body: 'Synthetic unexpected private payload' } }));
    expect((await store.claim!('synthetic-op', 'b'.repeat(64))).result).toEqual(valid);
    vi.stubEnv('CS_DATA_MODE', 'fake');
    request.mockImplementation(async () => response({ ok: true, code: null, steps: [], revision: null }));
    await store.applyImport(envelope);
    expect(JSON.parse(String(request.mock.calls.at(-1)![1]!.body))).toEqual({ p_operation_id: envelope.operationId, p_snapshot_hash: envelope.snapshotHash, p_actor_hash: envelope.actorHash, p_counts: envelope.counts, p_hashes: envelope.hashes, p_exceptions: envelope.exceptions, p_rows: envelope.rows });
  });

});

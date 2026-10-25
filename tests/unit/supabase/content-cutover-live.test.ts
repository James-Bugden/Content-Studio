import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../replies/support/db';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { GoogleSheetTransport } from '@/integrations/google/google-sheet';
import { GoogleDriveGateway } from '@/integrations/google/google-drive';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { buildTypedImport } from '@/application/content-import';
import { buildSheetMirrorSnapshot } from '@/application/sheet-mirror';
import { ContentCutoverStore } from '@/integrations/supabase/content-cutover-store';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache } from '@/lib/env';
import { SHEET_TABS } from '@/domain/sheet-schema';
import { ContentExporter } from '@/application/content-export';
import { SupabaseContentDb } from '@/integrations/supabase/content-db';
import { POST } from '@/app/api/ops/content-cutover/route';
import { runConfiguredSheetMirror } from '@/lib/sheet-mirror-operation';

let db: TestDatabase, sheet: FakeSheetTransport, transport: ReturnType<typeof vi.fn<typeof fetch>>;
const build = 'a'.repeat(40), hash = 'b'.repeat(64), token = '11111111-1111-4111-8111-111111111111';
const options = { url: 'https://synthetic.supabase.co', serviceKey: 'synthetic-only-service-key' };
const env = { CS_DATA_MODE: 'live', CS_CONTENT_STORE: 'db-shadow', CS_COMMIT_SHA: build,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com', GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'synthetic-not-a-key',
  CS_SHEET_ID: 'synthetic_workbook_0000000000', GOOGLE_WRITE_ENABLED: 'true', CS_CONTENT_READ_ENABLED: 'true',
  CS_CONTENT_DB_ENABLED: 'true', CS_CONTENT_WRITE_ENABLED: 'false', CS_CONTENT_BACKUP_FOLDER_ID: 'synthetic_folder_00000',
  SUPABASE_READ_MODEL_URL: options.url, SUPABASE_READ_MODEL_SERVICE_KEY: options.serviceKey,
  SUPABASE_READ_MODEL_SOURCE_KEY: 'synthetic_source', AUTH_SECRET: 'synthetic-secret-for-tests-000000000000', CRON_SECRET: 'synthetic-cron-secret-000000' };
const query = (sql: string, values: unknown[] = []) => db.asService(q => q.query(sql, values));
beforeAll(async () => {
  db = await createTestDatabase();
  for (const file of readdirSync('supabase/migrations').filter(f => /^\d+_content_.*\.sql$/.test(f)).sort()) await db.raw.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
}, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', ''); resetServices(); resetEnvCache(); sheet = new FakeSheetTransport();
  await db.raw.exec('truncate content_studio_cutover_jobs,content_studio_cutover_state,content_studio_cutover_evidence,content_studio_markdown_export,content_studio_shadow_jobs,content_studio_shadow_lease,content_studio_shadow_events,content_studio_import_runs,content_studio_operations,content_studio_posts,content_studio_schedule,content_studio_workflow_settings,content_studio_audit_events,content_studio_row_history restart identity cascade');
  const e = buildTypedImport(await buildSheetMirrorSnapshot(new SheetsContentRepository(sheet), { sourceKey: 'synthetic_source' }), new Map(), hash);
  e.operationId = 'owner:synthetic_source:22222222-2222-4222-8222-222222222222';
  await query('select content_studio_import_run($1,$2,$3,$4,$5,$6,$7)', [e.operationId, e.snapshotHash, e.actorHash, e.counts, e.hashes, e.exceptions, e.rows]);
  await query("insert into content_studio_shadow_events values($1,clock_timestamp(),'imported',$2)", [token, { snapshotAt: Date.now(), evidence: { snapshotHash: e.snapshotHash, counts: e.counts, hashes: e.hashes, exceptions: e.exceptions } }]);
  vi.spyOn(GoogleSheetTransport.prototype, 'readTab').mockImplementation((...args) => sheet.readTab(...args));
  vi.spyOn(GoogleSheetTransport.prototype, 'writeCells').mockImplementation((...args) => sheet.writeCells(...args));
  vi.spyOn(GoogleSheetTransport.prototype, 'appendRow').mockImplementation((...args) => sheet.appendRow(...args));
  const drive = new FakeDriveGateway();
  vi.spyOn(GoogleDriveGateway.prototype, 'readText').mockImplementation((...args) => drive.readText(...args));
  vi.spyOn(GoogleDriveGateway.prototype, 'writeText').mockImplementation((...args) => drive.writeText(...args));
  transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(options.url);
    const table = url.pathname.split('/').at(-1)!;
    try {
      if (url.pathname.includes('/rpc/')) {
        const params = JSON.parse(String(init?.body ?? '{}'));
        const keys = Object.keys(params);
        if (!/^content_studio_[a-z_]+$/.test(table) || keys.some(k => !/^p_[a-z_]+$/.test(k))) throw new Error('invalid test SQL identifier');
        const result = await query(`select ${table}(${keys.map((k, i) => `${k}=>$${i + 1}`).join(',')}) as result`, Object.values(params));
        return Response.json(result.rows[0]!.result);
      }
      if (!/^content_studio_[a-z_]+$/.test(table)) throw new Error('invalid test table');
      const where: string[] = [], args: unknown[] = [];
      for (const [key, value] of url.searchParams) {
        if (!/^[a-z_]+$/.test(key)) continue;
        if (value.startsWith('eq.')) { args.push(value.slice(3)); where.push(`${key}=$${args.length}`); }
        if (value === 'not.is.null') where.push(`${key} is not null`);
        if (value.startsWith('cs.')) { args.push(value.slice(3)); where.push(`${key} @> $${args.length}::text[]`); }
      }
      const order = url.searchParams.get('order')?.split(',').map(v => v.replace('.nullslast', '.nulls.last').split('.').join(' ')).join(',') ?? '';
      if (!/^[a-z_ ,0-9]*$/.test(order)) throw new Error('invalid test order');
      const rows = await query(`select * from ${table}${where.length ? ` where ${where.join(' and ')}` : ''}${order ? ` order by ${order}` : ''}` , args);
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000);
      return new Response(JSON.stringify(rows.rows.slice(offset, offset + limit)), { headers: { 'content-range': `*/${rows.rows.length}` } });
    } catch (error) {
      return Response.json({ code: (error as { code?: string }).code ?? 'XX000' }, { status: (error as { code?: string }).code === '42501' ? 403 : (error as { code?: string }).code === '23505' ? 409 : 500 });
    }
  });
  vi.stubGlobal('fetch', transport);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetServices(); resetEnvCache(); });
const mode = (value: string) => { vi.stubEnv('CS_CONTENT_STORE', value); resetServices(); resetEnvCache(); return getServices(); };
async function admitRead() {
  // Real measured collection comparison, not a hand-written ready boolean.
  await getServices().liveCutover!.measure();
}
async function admitWrite() {
  await admitRead();
  const importId = await new SupabaseContentDb(options).latestImportId();
  const store = new ContentCutoverStore(options, build);
  await store.record('rehearsal', importId!, { exact: true, dbHash: hash, sheetHash: hash });
  await store.record('backup', importId!, { manifestHash: hash });
  await query('select content_studio_cutover_record($1,$2,$3,$4)', ['phase-c', build, importId, {
    smoke: true, t4: true, writeThrough: true, freeze: true, dailyPlanBackup: true, restoreExact: true,
    importsStopped: true, flagRoundTrip: true, hostedSecurity: true, independentConcurrency: true, sheetRaceAccepted: true,
    privateEvidence: 'synthetic-local-fixture-only', sheetRead429: 0, lagStale: 0, warmP95Ms: 100, coldP95Ms: 200,
  }]);
}

describe('DB-10 live composition / real SQL over mocked REST and Google boundaries', () => {
  it('fails closed before any Sheet write when the flag alone is present, evidence is missing, stale, wrong-build or denied', async () => {
    const write = vi.spyOn(sheet, 'writeCells');
    await expect(mode('db-read').repo.listLibrary()).rejects.toBeDefined();
    mode('db-shadow'); await admitRead();
    expect((await mode('db-read').repo.listLibrary()).length).toBe(12);
    vi.stubEnv('CS_COMMIT_SHA', 'c'.repeat(40)); resetServices(); resetEnvCache();
    await expect(getServices().repo.listLibrary()).rejects.toBeDefined();
    expect(write).not.toHaveBeenCalled();
  });
  it('serves db-read Sheet revisions; writes Sheet first, copies through real RPC, preserves replay and stale conflicts', async () => {
    await admitRead(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
    const services = mode('db-read'), first = (await services.repo.listLibrary())[0]!;
    const mutation = { operationId: 'synthetic-live-copy', actor: { role: 'owner' as const, sub: 'synthetic-owner' }, target: { libraryId: first.value.libraryId }, expectedRevision: first.revision, patch: { currentHook: 'Synthetic copied hook' } };
    const result = await services.repo.updateLibrary(mutation);
    expect(result.ok).toBe(true); expect(result.steps).toContainEqual(expect.objectContaining({ step: 'write_through', status: 'done' }));
    expect((await new SupabaseContentDb(options).getPost('library', first.value.libraryId))!.current_hook).toBe('Synthetic copied hook');
    expect(await services.repo.updateLibrary(mutation)).toMatchObject({ ok: true, replayed: true });
    expect(await services.repo.updateLibrary({ ...mutation, operationId: 'synthetic-stale', patch: { currentHook: 'Synthetic stale' } })).toMatchObject({ ok: false, code: 'STALE_READ' });
  });
  it.each([403, 429, 500])('retains successful Sheet saves and refresh_pending when DB write-through returns %s', async status => {
    await admitRead(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true'); const services = mode('db-read');
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (url, init) => String(url).endsWith('content_studio_write_through') ? Response.json({ code: status === 403 ? '42501' : 'XX000' }, { status }) : original(url, init));
    const row = (await services.repo.listLibrary())[0]!;
    const result = await services.repo.updateLibrary({ operationId: `synthetic-copy-failure-${status}`, actor: { role: 'owner', sub: 'synthetic-owner' }, target: { libraryId: row.value.libraryId }, expectedRevision: row.revision, patch: { currentHook: 'Synthetic authoritative Sheet success' } });
    expect(result.ok).toBe(true); expect(result.steps).toContainEqual(expect.objectContaining({ step: 'refresh_pending' }));
    expect((await services.repo.getLibrary(row.value.libraryId)).cells.currentHook).toBe('Synthetic authoritative Sheet success');
  });
  it('exports live DB saves, persists checkpoints across restarts, and preserves a Sheet hand edit byte-for-byte with a blocking mismatch', async () => {
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true'); let services = mode('db');
    const row = await services.repo.getLibrary('SYN-L001');
    const mutation = { operationId: 'synthetic-live-db', actor: { role: 'owner' as const, sub: 'synthetic-owner' }, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { currentHook: 'Synthetic live DB hook' } };
    expect((await services.repo.updateLibrary(mutation)).ok).toBe(true);
    expect((await services.contentCutover!.exporter.parity()).exact).toBe(true);
    services = mode('db');
    const grid = sheet.rawTab(SHEET_TABS.library.name), col = grid[0]!.findIndex(c => c.value === 'Current Hook');
    const hand = '  Synthetic hand edit\r\n\u7e41\u9ad4\u4e2d\u6587\t  ';
    sheet.externalEdit(SHEET_TABS.library.name, 2, col, hand);
    const bytes = JSON.stringify(grid);
    const parity = await services.contentCutover!.exporter.run();
    expect(parity.exact).toBe(false); expect(JSON.stringify(grid)).toBe(bytes);
    expect(grid[1]![col]!.value).toBe(hand);
    expect([...services.contentCutover!.exporter.journal.issues.values()]).toContainEqual(expect.objectContaining({ reason: 'export_mismatch', id: 'SYN-L001', fields: expect.arrayContaining(['Current Hook']) }));
    expect(await services.repo.updateLibrary(mutation)).toMatchObject({ ok: true, replayed: true });
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'false'); services = mode('db');
    await expect(services.liveCutover!.rollback()).rejects.toBeDefined();
  });
  it('keeps DB body saves independent of Drive failure, creates the real durable outbox, and refuses rollback', async () => {
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true'); const services = mode('db');
    vi.mocked(GoogleDriveGateway.prototype.readText).mockRejectedValue(new Error('synthetic Drive unavailable'));
    const row = await services.repo.getLibrary('SYN-L001');
    expect(services.repo.draftBodyAuthority?.()).toBe('db');
    expect((await services.repo.updateLibrary({ operationId: 'synthetic-live-body', actor: { role: 'owner', sub: 'synthetic-owner' }, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { draftContent: 'Synthetic DB body while Drive fails' } })).ok).toBe(true);
    await services.markdownExport!.run();
    expect((await query('select * from content_studio_markdown_export')).rows).toHaveLength(1);
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'false');
    await expect(mode('db').liveCutover!.rollback()).rejects.toBeDefined();
  });
  it('serializes independent workers, rejects stale tokens and retains a crash lock until explicit recovery', async () => {
    await admitRead();
    await query('select content_studio_cutover_claim($1,$2)', ['sheet-export', token]);
    const other = new ContentCutoverStore(options, build);
    await expect(other.exclusive('sheet-export', async () => true)).rejects.toBeDefined();
    await expect(query('select content_studio_cutover_save($1,$2,$3)', ['sheet-export', '33333333-3333-4333-8333-333333333333', {}])).rejects.toBeDefined();
    expect((await query('select token from content_studio_cutover_state')).rows[0]!.token).toBe(token);
  });
  it('refuses unauthenticated coordinator operations without a provider call', async () => {
    const result = await POST(new Request('https://synthetic.example.com/api/ops/content-cutover', { method: 'POST', body: JSON.stringify({ action: 'measure' }) }));
    expect(result.status).toBe(403); expect(transport).not.toHaveBeenCalled();
  });
  it('requires a valid coordinator idempotency key, durably replays measurement after restart, and rejects reuse for a different action', async () => {
    const request = (key: string | undefined, action = 'measure') => new Request('https://synthetic.example.com/api/ops/content-cutover', {
      method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}`, ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify({ action }),
    });
    expect((await POST(request(undefined))).status).toBe(400); expect(transport).not.toHaveBeenCalled();
    const first = await POST(request(token)); expect(first.status).toBe(200); const result = await first.json();
    resetServices(); resetEnvCache(); const read = vi.spyOn(sheet, 'readTab');
    const replay = await POST(request(token)); expect(replay.status).toBe(200); expect(await replay.json()).toEqual(result); expect(read).not.toHaveBeenCalled();
    expect((await POST(request(token, 'backup'))).status).toBe(409);
  });
  it('keeps sheet mode byte-identical and never consults a broken DB after flag rollback', async () => {
    const baseline = JSON.stringify(await new SheetsContentRepository(sheet, { writable: true }).listLibrary());
    transport.mockRejectedValue(new Error('synthetic DB down'));
    expect(JSON.stringify(await mode('sheet').repo.listLibrary())).toBe(baseline);
    expect(transport).not.toHaveBeenCalled();
  });
  it('requires DB gate evidence for live exporter operations even when invoked directly', async () => {
    const store = new ContentCutoverStore(options, build, 'db');
    const exporter = new ContentExporter(new SupabaseContentDb(options), new GoogleSheetTransport(env.CS_SHEET_ID, {} as never, true), store.exportJournal);
    await expect(exporter.run()).rejects.toBeDefined();
  });
  it.each([429, 500])('preserves committed DB writes on Sheet %s, records durable lag, then repairs after restart', async status => {
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true'); let services = mode('db');
    expect((await services.contentCutover!.exporter.run()).exact).toBe(true);
    const row = await services.repo.getLibrary('SYN-L001');
    vi.mocked(GoogleSheetTransport.prototype.writeCells).mockRejectedValueOnce(Object.assign(new Error('synthetic Sheet failure'), { status }));
    const mutation = { operationId: `synthetic-sheet-${status}`, actor: { sub: 'synthetic-owner', role: 'owner' as const }, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { currentHook: 'Synthetic committed despite Sheet failure' } };
    expect((await services.repo.updateLibrary(mutation)).ok).toBe(true);
    expect([...services.contentCutover!.exporter.journal.issues.values()]).toContainEqual(expect.objectContaining({ id: 'SYN-L001', reason: 'export_lag' }));
    services = mode('db');
    expect((await services.contentCutover!.exporter.run()).exact).toBe(true);
    expect(await services.repo.updateLibrary(mutation)).toMatchObject({ ok: true, replayed: true });
  });
  it.each(['denied', 'timeout'])('fails safely on DB %s mid-export, retaining earlier durable checkpoints and the worker lock', async failure => {
    await admitWrite(); const services = mode('db');
    expect((await services.contentCutover!.exporter.run()).exact).toBe(true);
    await query('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7)', ['synthetic-mid-export', hash, hash, 'library', 'SYN-L001', 1, { current_hook: 'Synthetic export checkpoint' }]);
    const original = transport.getMockImplementation()!;
    let failed = false;
    transport.mockImplementation(async (url, init) => {
      // Checkpoints have been saved for at least one row before failure.
      if (String(url).endsWith('content_studio_cutover_save')) failed = true;
      if (failed && String(url).includes('/content_studio_posts?')) {
        if (failure === 'timeout') throw new DOMException('synthetic timeout', 'TimeoutError');
        return Response.json({ code: '42501' }, { status: 403 });
      }
      return original(url, init);
    });
    await expect(services.contentCutover!.exporter.run()).rejects.toBeDefined();
    const state = (await query("select token,state from content_studio_cutover_state where name='sheet-export'")).rows[0]!;
    expect(state.token).not.toBeNull();
    expect((state.state as { checkpoints: unknown[] }).checkpoints.length).toBeGreaterThan(0);
    transport.mockImplementation(original);
    await expect(mode('db').contentCutover!.exporter.run()).rejects.toBeDefined();
  });
  it('captures a full unchanged imported baseline with collection reads, not two Sheet reads per row', async () => {
    await admitWrite(); const services = mode('db');
    const read = vi.mocked(GoogleSheetTransport.prototype.readTab); read.mockClear();
    const writes = vi.mocked(GoogleSheetTransport.prototype.writeCells); writes.mockClear();
    expect((await services.contentCutover!.exporter.run()).exact).toBe(true);
    expect(read.mock.calls.length).toBe(8); expect(writes).not.toHaveBeenCalled();
  });
  it('refreshes full measured admission after a live db-read repair import, including durable request replay', async () => {
    await admitRead(); const services = mode('db-read');
    const trigger = { kind: 'owner', idempotencyKey: '44444444-4444-4444-8444-444444444444' } as const;
    expect(await runConfiguredSheetMirror(trigger)).toMatchObject({ status: 'completed' });
    expect((await services.repo.listLibrary()).length).toBe(12);
    expect(await runConfiguredSheetMirror(trigger)).toMatchObject({ status: 'replayed' });
    expect((await mode('db-read').repo.listLibrary()).length).toBe(12);
  });
  it('executes exact rollback preparation before authority and after DB saves, freezes writes, and permits the actual flag round trip', async () => {
    await admitWrite(); let services = mode('db-read');
    const first = await services.liveCutover!.rollback() as { readyToFlip: string; parity: { exact: boolean; dbHash: string; sheetHash: string } };
    expect(first.readyToFlip).toBe('sheet'); expect(first.parity.exact).toBe(true); expect(first.parity.dbHash).toBe(first.parity.sheetHash);
    expect((await mode('sheet').repo.listLibrary()).length).toBe(12);
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true'); services = mode('db');
    const row = await services.repo.getLibrary('SYN-L001');
    expect((await services.repo.updateLibrary({ operationId: 'synthetic-pre-rollback', actor: { sub: 'synthetic-owner', role: 'owner' }, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { pesto: 'Synthetic topic' } })).ok).toBe(true);
    await expect(services.liveCutover!.rollback()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'false'); services = mode('db');
    const final = await services.liveCutover!.rollback() as { parity: { exact: boolean } };
    expect(final.parity.exact).toBe(true);
    expect((await mode('sheet').repo.getLibrary('SYN-L001')).cells.pesto).toBe('Synthetic topic');
    expect((await mode('db').repo.getLibrary('SYN-L001')).cells.pesto).toBe('Synthetic topic');
  });
});

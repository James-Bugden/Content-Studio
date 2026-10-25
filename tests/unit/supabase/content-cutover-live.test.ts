import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../replies/support/db';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { GoogleSheetTransport } from '@/integrations/google/google-sheet';
import { GoogleDriveGateway } from '@/integrations/google/google-drive';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { buildTypedImport, importVersions } from '@/application/content-import';
import { buildSheetMirrorSnapshot } from '@/application/sheet-mirror';
import { ContentCutoverStore } from '@/integrations/supabase/content-cutover-store';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache, serverEnv } from '@/lib/env';
import { ContentShadowStore } from '@/integrations/supabase/content-shadow-store';
import { AppError } from '@/domain/errors';
import { fingerprintValues } from '@/domain/hash';
import { rowRevision } from '@/domain/mapping';
import { SHEET_TABS } from '@/domain/sheet-schema';
import { FakePrivateBackupFolder } from '@/integrations/supabase/fake-content-backup';
import { CUTOVER_CONTRACT } from '@/application/cutover-contract';
import { buildReconcileReport } from '@/application/reconcile';
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
  await db.raw.exec('truncate content_studio_cutover_authority,content_studio_cutover_jobs,content_studio_cutover_state,content_studio_cutover_evidence,content_studio_markdown_export,content_studio_shadow_jobs,content_studio_shadow_lease,content_studio_shadow_events,content_studio_import_runs,content_studio_operations,content_studio_posts,content_studio_schedule,content_studio_workflow_settings,content_studio_audit_events,content_studio_row_history restart identity cascade');
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
async function admitWrite(activate = true) {
  await admitRead();
  const importId = await new SupabaseContentDb(options).latestImportId();
  const store = new ContentCutoverStore(options, build);
  const preparation = mode('db-read');
  preparation.contentBackup!.folder = new FakePrivateBackupFolder();
  await preparation.liveCutover!.backup();
  await preparation.liveCutover!.rollback();
  await query('select content_studio_cutover_record($1,$2,$3,$4)', ['phase-c', build, importId, {
    smoke: true, t4: true, writeThrough: true, freeze: true, dailyPlanBackup: true, restoreExact: true,
    importsStopped: true, flagRoundTrip: true, hostedSecurity: true, independentConcurrency: true, sheetRaceAccepted: true,
    privateEvidence: 'synthetic-local-fixture-only', sheetRead429: 0, lagStale: 0, warmP95Ms: 100, coldP95Ms: 200,
  }]);
  if (activate) await store.activate('db');
}

describe('DB-10 live composition / real SQL over mocked REST and Google boundaries', () => {
  it('retires DB authority before Sheet writes resume; a stale epoch cannot be reused without a new import and activation', async () => {
    await admitWrite();
    const services = mode('db');
    const ready = await services.liveCutover!.rollback() as { parity: { dbHash: string } };
    await expect(query('select content_studio_cutover_retire($1,$2,$3)', [token, build, 'e'.repeat(64)])).rejects.toMatchObject({ code: '42501', message: 'verified rollback required' });
    const retire = () => query('select content_studio_cutover_retire($1,$2,$3) as result', [token, build, ready.parity.dbHash]);
    expect((await retire()).rows[0]!.result).toMatchObject({ ok: true, mode: 'sheet' });
    expect((await retire()).rows[0]!.result).toMatchObject({ ok: true, mode: 'sheet' });
    await expect(services.repo.listLibrary()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
    const authority = mode('sheet').repo, row = await authority.getLibrary('SYN-L001');
    expect(await authority.updateLibrary({ operationId: 'synthetic-post-rollback-sheet', actor: { role: 'owner', sub: 'synthetic-owner' }, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { currentHook: 'Synthetic Sheet authority after rollback' } })).toMatchObject({ ok: true });
    await expect(mode('db').repo.listQueue()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(new ContentCutoverStore(options, build).activate('db')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    mode('db-shadow');
    const e = buildTypedImport(await buildSheetMirrorSnapshot(new SheetsContentRepository(sheet), { sourceKey: 'synthetic_source' }), await importVersions(new SupabaseContentDb(options)), hash);
    await query('select content_studio_import_run($1,$2,$3,$4,$5,$6,$7)', ['synthetic-post-retirement-import', e.snapshotHash, e.actorHash, e.counts, e.hashes, e.exceptions, e.rows]);
    await admitRead();
    await expect(new ContentCutoverStore(options, build).activate('db-read')).resolves.toMatchObject({ mode: 'db-read' });
    expect((await mode('db-read').repo.getLibrary('SYN-L001')).cells.currentHook).toBe('Synthetic Sheet authority after rollback');
  });
  it('recovers a single injected 429 at every awaited IO boundary in parity and a changed-row export', async () => {
    await admitWrite();
    await mode('db').contentCutover!.exporter.run();
    const baseline = (await query("select state from content_studio_cutover_state where name='sheet-export'")).rows[0]!.state;
    await query("update content_studio_posts set current_hook='Synthetic fenced export',row_version=row_version+1 where library_id='SYN-L001'");
    const fetchOriginal = transport.getMockImplementation()!;
    const read = vi.mocked(GoogleSheetTransport.prototype.readTab), readOriginal = read.getMockImplementation()!;
    const write = vi.mocked(GoogleSheetTransport.prototype.writeCells), writeOriginal = write.getMockImplementation()!;
    for (const action of ['parity', 'run'] as const) {
      let boundaryCount = 0;
      const exercise = async (point: number) => {
        sheet = new FakeSheetTransport();
        await query("update content_studio_cutover_state set state=$1,token=null where name='sheet-export'", [baseline]);
        let boundary = 0, injected = false;
        const after = <T,>(value: T) => {
          if (++boundary === point) { injected = true; throw new AppError('RATE_LIMITED'); }
          return value;
        };
        transport.mockImplementation(async (...args) => after(await fetchOriginal(...args)));
        read.mockImplementation(async (...args) => after(await readOriginal(...args)));
        write.mockImplementation(async (...args) => after(await writeOriginal(...args)));
        const exporter = mode('db').contentCutover!.exporter;
        try { await exporter[action](); } catch (error) { expect(error).toBeInstanceOf(AppError); }
        finally { transport.mockImplementation(fetchOriginal); read.mockImplementation(readOriginal); write.mockImplementation(writeOriginal); }
        if (Number.isFinite(point)) expect(injected, `${action} await ${point}`).toBe(true);
        expect((await query("select token from content_studio_cutover_state where name='sheet-export'")).rows[0]!.token, `${action} await ${point}`).toBeNull();
        // If Google accepted a write before a lost response, its precondition
        // must still block rather than inventing a checkpoint. Restore exact
        // Sheet baseline bytes, as documented, and retry with a new worker.
        sheet = new FakeSheetTransport();
        await query("update content_studio_cutover_state set state=$1 where name='sheet-export'", [baseline]);
        expect((await mode('db').contentCutover!.exporter.run()).exact).toBe(true);
        return boundary;
      };
      boundaryCount = await exercise(Infinity);
      expect(boundaryCount).toBeGreaterThan(10);
      for (let point = 1; point <= boundaryCount; point++) await exercise(point);
    }
  }, 60_000);
  it('rejects a red actual measurement rather than returning successful full coverage', async () => {
    await admitRead();
    const col = sheet.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === 'Current Hook');
    sheet.externalEdit(SHEET_TABS.library.name, 2, col, 'Synthetic drift after import');
    await expect(getServices().liveCutover!.measure()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await query("select payload->'samples'->'library' as sample from content_studio_cutover_evidence where name='parity'")).rows[0]!.sample).toMatchObject({ blocking: expect.any(Number) });
  });
  it('loads mismatches before a busy claim and reloads the claimed state after a racing worker finishes', async () => {
    await admitWrite(); const exporter = mode('db').contentCutover!.exporter; await exporter.run();
    sheet.externalEdit(SHEET_TABS.library.name, 2, 2, 'Synthetic external edit'); await exporter.run();
    await query('select content_studio_cutover_claim($1,$2)', ['sheet-export', token]);
    const restarted = new ContentCutoverStore(options, build, 'db');
    await expect(restarted.exclusive('sheet-export', async () => true)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(restarted.exportJournal.issues.get('library\0SYN-L001')).toMatchObject({ reason: 'export_mismatch' });
    await query('select content_studio_cutover_release($1,$2)', ['sheet-export', token]);
    const original = ContentShadowStore.prototype.cutoverRpc;
    vi.spyOn(ContentShadowStore.prototype, 'cutoverRpc').mockImplementation(async function(this: ContentShadowStore, name, params) {
      // Simulate another worker committing a newer state between READ and CLAIM.
      if (name === 'read' && params.p_name === 'sheet-export') return { checkpoints: [], issues: [], reports: [] };
      return original.call(this, name, params);
    });
    await restarted.exportJournal.live!.exclusive(async () => {
      expect(restarted.exportJournal.issues.get('library\0SYN-L001')).toMatchObject({ reason: 'export_mismatch' });
    });
  });
  it('uses durable updated_at for repair lag and rejects a missing live change timestamp', async () => {
    await admitWrite(); const exporter = mode('db').contentCutover!.exporter; await exporter.run();
    await query("update content_studio_posts set current_hook='Synthetic delayed change',row_version=row_version+1,updated_at=clock_timestamp()-interval '20 minutes' where library_id='SYN-L001'");
    expect((await exporter.run()).exact).toBe(true);
    expect(exporter.lagSamples.at(-1)!.lagMs).toBeGreaterThanOrEqual(1_199_000);
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (url, init) => {
      const result = await original(url, init);
      if (new URL(String(url)).pathname.endsWith('/content_studio_posts')) {
        const rows = await result.json();
        return Response.json(rows.map((r: Record<string, unknown>) => ({ ...r, updated_at: undefined })), { headers: Object.fromEntries(result.headers) });
      }
      return result;
    });
    await expect(exporter.run()).rejects.toMatchObject({ code: 'SCHEMA_DRIFT', details: { reason: 'export_change_time' } });
  });
  it('keeps backup available with a linked missing or externally edited section and names a dependent rollback blocker', async () => {
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true'); let services = mode('db');
    const row = await services.repo.getLibrary('SYN-L001');
    expect((await services.repo.updateLibrary({ operationId: 'synthetic-missing-section', actor: { role: 'owner', sub: 'synthetic-owner' }, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { draftContent: 'Synthetic exact DB draft' } })).ok).toBe(true);
    const read = vi.mocked(GoogleDriveGateway.prototype.readText), original = read.getMockImplementation()!;
    read.mockImplementation(async id => ({ ...await original(id), text: 'Synthetic document with no matching section' }));
    await services.markdownExport!.run();
    expect(await services.markdownExport!.status()).toContainEqual(expect.objectContaining({ libraryId: 'SYN-L001', reason: 'markdown_missing' }));
    services.contentBackup!.folder = new FakePrivateBackupFolder();
    expect(await services.liveCutover!.backup()).toMatchObject({ status: 'verified' });
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'false'); services = mode('db');
    await expect(services.liveCutover!.rollback()).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'rollback_markdown_export_pending' } });
    read.mockImplementation(async id => ({ ...await original(id), text: (await original(id)).text.replace(row.value.draftContent, 'Synthetic external section edit') }));
    await services.markdownExport!.run();
    expect(await services.markdownExport!.status()).toContainEqual(expect.objectContaining({ libraryId: 'SYN-L001', reason: 'markdown_mismatch' }));
  });
  it('a read-phase rollback refuses inexact linked Markdown and never invents rehearsal evidence', async () => {
    await admitRead(); const services = mode('db-read');
    const read = vi.mocked(GoogleDriveGateway.prototype.readText), original = read.getMockImplementation()!;
    read.mockImplementation(async id => ({ ...await original(id), text: (await original(id)).text.replace('Synthetic', 'Synthetic external edit') }));
    // The fixture body need not contain this word; change its unique section
    // using the actual DB body so the test cannot pass on an unrelated failure.
    const body = (await services.repo.getLibrary('SYN-L001')).value.draftContent;
    read.mockImplementation(async id => ({ ...await original(id), text: (await original(id)).text.replace(body, 'Synthetic external section body') }));
    await expect(services.liveCutover!.rollback()).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'rollback_markdown_not_exact' } });
    expect((await query("select * from content_studio_cutover_evidence where name='rehearsal'")).rows).toHaveLength(0);
  });
  it.each(['CS_CONTENT_BACKUP_FOLDER_ID', 'SUPABASE_READ_MODEL_URL', 'SUPABASE_READ_MODEL_SERVICE_KEY', 'SUPABASE_READ_MODEL_SOURCE_KEY'])('requires live DB configuration: %s', key => {
    vi.stubEnv('CS_CONTENT_STORE', 'db'); vi.stubEnv(key, undefined); resetEnvCache();
    expect(() => serverEnv()).toThrow(new RegExp(key));
  });
  it('fences stale/expired leases, releases only its own token and persists exported revision without content version churn', async () => {
    await admitWrite(); const services = mode('db'); await services.contentCutover!.exporter.run();
    const post = (await query("select exported_sheet_revision,row_version from content_studio_posts where library_id='SYN-L001'")).rows[0]!;
    expect(post.exported_sheet_revision).toBe(services.contentCutover!.exporter.journal.checkpoints.get('library\0SYN-L001')!.fingerprint);
    expect(Number(post.row_version)).toBe(1);
    await query('select content_studio_cutover_claim($1,$2)', ['sheet-export', token]);
    const wrong = '33333333-3333-4333-8333-333333333333';
    for (const sql of ['select content_studio_cutover_save($1,$2,null)', 'select content_studio_cutover_release($1,$2)', 'select content_studio_cutover_fence($1,$2)']) {
      await expect(query(sql, ['sheet-export', wrong])).rejects.toMatchObject({ code: '42501', message: 'stale worker' });
      expect((await query("select token from content_studio_cutover_state where name='sheet-export'")).rows[0]!.token).toBe(token);
    }
    await query("update content_studio_cutover_state set lease_until=clock_timestamp()-interval '1 second' where name='sheet-export'");
    await expect(query('select content_studio_cutover_fence($1,$2)', ['sheet-export', token])).rejects.toMatchObject({ code: '42501' });
    await query('select content_studio_cutover_claim($1,$2)', ['sheet-export', wrong]);
    await expect(query('select content_studio_cutover_save($1,$2,null)', ['sheet-export', token])).rejects.toMatchObject({ code: '42501' });
  });
  it('releases after a 429 at each awaited lease-operation boundary; abandoned claims expire and stale workers stay fenced', async () => {
    await admitRead();
    const store = new ContentCutoverStore(options, build);
    const original = ContentShadowStore.prototype.cutoverRpc;
    // authorize, read, claim, persist, release: fail each boundary, including
    // an ambiguous claim/release response. No real timers or live SQL calls.
    for (let point = 1; point <= 5; point++) {
      await query('delete from content_studio_cutover_state');
      let count = 0;
      const spy = vi.spyOn(ContentShadowStore.prototype, 'cutoverRpc').mockImplementation(async function(this: ContentShadowStore, name, params) {
        const result = await original.call(this, name, params);
        if (++count === point) throw new AppError('RATE_LIMITED');
        return result;
      });
      await store.exclusive('sheet-export', async () => true).catch(error => expect(error).toMatchObject({ code: 'RATE_LIMITED' }));
      spy.mockRestore();
      const state = (await query("select token from content_studio_cutover_state where name='sheet-export'")).rows[0];
      if (state?.token) {
        // A lost claim/release response cannot strand the lock permanently.
        await query("update content_studio_cutover_state set lease_until=clock_timestamp()-interval '1 second'");
      }
      expect(await store.exclusive('sheet-export', async () => true)).toBe(true);
      expect((await query("select token from content_studio_cutover_state where name='sheet-export'")).rows[0]!.token).toBeNull();
    }
  });
  it('retries a failed daily backup operation on the same day, including a compatible redeploy', async () => {
    await admitWrite(); let services = mode('db');
    services.contentBackup!.folder = new FakePrivateBackupFolder();
    vi.spyOn(services.contentBackup!.folder, 'assertPrivate').mockRejectedValueOnce(new AppError('RATE_LIMITED'));
    await expect(services.liveCutover!.execute('backup', token)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    vi.stubEnv('CS_COMMIT_SHA', 'c'.repeat(40)); services = mode('db'); services.contentBackup!.folder = new FakePrivateBackupFolder();
    expect(await services.liveCutover!.execute('backup', token)).toMatchObject({ status: 'verified' });
  });
  it('fails a backup closed on Google writes off, invalid persisted verification or incomplete snapshot', async () => {
    await admitRead(); vi.stubEnv('GOOGLE_WRITE_ENABLED', 'false');
    await expect(mode('db-read').liveCutover!.backup()).rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'google_writes_disabled' } });
    const store = new ContentCutoverStore(options, build); store.backupJournal.lastVerified = {} as never;
    vi.spyOn(ContentShadowStore.prototype, 'cutoverRpc').mockResolvedValue({ invalid: true });
    await expect(store.refreshBackup()).rejects.toBeDefined(); expect(store.backupJournal.lastVerified).toBeNull();
    vi.mocked(ContentShadowStore.prototype.cutoverRpc).mockResolvedValue({ posts: [] });
    await expect(store.snapshot()).rejects.toMatchObject({ code: 'SCHEMA_DRIFT' });
    await expect(store.exportJournal.live!.persist()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it.each([
    ['parity', 'coverage', 'sample', 'full parity required'],
    ...['smoke', 'writeThrough', 'freeze', 'dailyPlanBackup', 'restoreExact', 'importsStopped', 'flagRoundTrip', 'hostedSecurity', 'independentConcurrency'].map((field): [string, string, boolean, string] => ['phase-c', field, false, 'phase C proof missing']),
    ['phase-c', 't4', false, 'phase C proof missing'],
    ['phase-c', 'sheetRaceAccepted', false, 'phase C proof missing'],
    ['phase-c', 'warmP95Ms', 1000, 'phase C proof missing'],
    ['phase-c', 'warmP95Ms', null, 'phase C proof missing'],
    ['phase-c', 'coldP95Ms', 2500, 'phase C proof missing'],
    ['phase-c', 'privateEvidence', '', 'phase C proof missing'],
    ['phase-c', 'sheetRead429', 1, 'phase C proof missing'],
    ['phase-c', 'lagStale', 1, 'phase C proof missing'],
    ['rehearsal', 'exact', false, 'rollback proof missing'],
    ['rehearsal', 'sheetHash', 'e'.repeat(64), 'rollback proof missing'],
    ['rehearsal', 'dbHash', null, 'rollback proof missing'],
    ['backup', 'manifestHash', 'invalid', 'backup proof missing'],
    ['backup', 'manifestHash', null, 'backup proof missing'],
  ])('refuses activation for exactly %s.%s = %s with otherwise real green operation evidence', async (name, field, value, message) => {
    await admitWrite(false);
    await expect(query('select content_studio_cutover_gate($1,$2)', ['db', build])).resolves.toBeDefined();
    await query('update content_studio_cutover_evidence set payload=payload || jsonb_build_object($1::text,$2::jsonb) where name=$3', [field, JSON.stringify(value), name]);
    await expect(query('select content_studio_cutover_activate($1,$2,$3)', ['db', build, CUTOVER_CONTRACT])).rejects.toMatchObject({ code: '42501', message });
    expect((await query('select * from content_studio_cutover_authority')).rows).toHaveLength(0);
  });
  it('P5: an audited DB patch cannot clear a hand-edit checkpoint; exact Sheet revert then export clears it', async () => {
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true'); let services = mode('db');
    const exporter = services.contentCutover!.exporter; await exporter.run();
    const old = exporter.journal.checkpoints.get('library\0SYN-L001')!.cells['Current Hook']!.value;
    const col = sheet.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === 'Current Hook');
    const hand = 'Synthetic deliberately selected hand edit'; sheet.externalEdit(SHEET_TABS.library.name, 2, col, hand);
    await exporter.run();
    const row = await services.repo.getLibrary('SYN-L001');
    expect((await services.repo.updateLibrary({ operationId: 'synthetic-p5-choose-copy', actor: { role: 'owner', sub: 'synthetic-owner' }, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { currentHook: hand } })).ok).toBe(true);
    expect((await exporter.parity()).exact).toBe(true); expect(exporter.journal.issues.size).toBe(1);
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'false'); services = mode('db');
    await expect(services.liveCutover!.rollback()).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'rollback_export_not_exact' } });
    sheet.externalEdit(SHEET_TABS.library.name, 2, col, old);
    expect((await services.contentCutover!.exporter.run()).exact).toBe(true); expect(services.contentCutover!.exporter.journal.issues.size).toBe(0);
    expect(await services.liveCutover!.rollback()).toMatchObject({ readyToFlip: 'sheet' });
  });
  it.each(['parity', 'phase-c', 'rehearsal', 'backup'])('refuses obsolete import identity and wrong build on %s evidence at flip', async name => {
    await admitWrite(false);
    const id = (await query('select import_id from content_studio_cutover_evidence where name=$1', [name])).rows[0]!.import_id;
    const flip = () => query('select content_studio_cutover_activate($1,$2,$3)', ['db', build, CUTOVER_CONTRACT]);
    await query("update content_studio_cutover_evidence set import_id='synthetic-old-import' where name=$1", [name]);
    await expect(flip()).rejects.toMatchObject({ code: '42501', message: name === 'parity' ? 'full parity required' : 'write proof missing' });
    await query('update content_studio_cutover_evidence set import_id=$1,build=$2 where name=$3', [id, 'c'.repeat(40), name]);
    await expect(flip()).rejects.toMatchObject({ code: '42501', message: name === 'parity' ? 'full parity required' : 'write proof missing' });
  });
  it('bounds evidence age at flip and exposes expired Phase C evidence as read-only after activation', async () => {
    await admitRead(); const store = new ContentCutoverStore(options, build); await store.activate('db-read');
    await query("update content_studio_cutover_evidence set at=clock_timestamp()-interval '16 minutes' where name='parity'");
    await expect(store.activate('db-read')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const services = mode('db-read');
    expect((await services.repo.listLibrary()).length).toBe(12);
    expect(await services.liveCutover!.status()).toEqual({ blocking: 'cutover_measurement_required' });
    await expect(store.assertGate('db-read', true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it.each(['phase-c', 'backup', 'rehearsal'])('bounds %s flip proof age without expiring ongoing DB authority', async name => {
    await admitWrite(false);
    await query("update content_studio_cutover_evidence set at=clock_timestamp()-interval '25 hours' where name=$1", [name]);
    await expect(query('select content_studio_cutover_gate($1,$2)', ['db', build])).rejects.toMatchObject({ code: '42501', message: 'write proof expired' });
  });
  it('bounds persisted diagnostic state and refuses oversized checkpoint state without dropping recovery data', async () => {
    await admitRead(); const store = new ContentCutoverStore(options, build);
    await store.exportJournal.live!.exclusive(async () => {
      store.exportJournal.reports = Array.from({ length: 2200 }, () => ({ at: 1, exact: true, counts: { library: 0, queue: 0, schedule: 0, workflow_settings: 0 }, dbHash: hash, sheetHash: hash, differences: [] }));
      store.exportJournal.lagSamples = Array.from({ length: 4200 }, () => ({ at: 1, lagMs: 1 }));
      store.exportJournal.repairedFailures = Array.from({ length: 2200 }, () => ({ since: 1, repairedAt: 2 }));
    });
    const before = (await query("select state from content_studio_cutover_state where name='sheet-export'")).rows[0]!.state as { reports: unknown[]; lagSamples: unknown[]; repairedFailures: unknown[] };
    expect(before.reports).toHaveLength(2048); expect(before.lagSamples).toHaveLength(4096); expect(before.repairedFailures).toHaveLength(2048);
    await expect(store.exportJournal.live!.exclusive(async () => {
      for (let i = 0; i < 20001; i++) store.exportJournal.checkpoints.set(`workflow_settings\0SYN-${i}`, { fingerprint: 'a'.repeat(16), cells: {}, version: '1', at: 1 });
    })).rejects.toMatchObject({ code: 'SCHEMA_DRIFT', details: { reason: 'export_state_bound' } });
    const after = (await query("select state,token from content_studio_cutover_state where name='sheet-export'")).rows[0]!;
    expect(after.state).toEqual(before); expect(after.token).toBeNull();
  });
  it.each(['db', 'db-read', 'sheet'])('freezes the %s repository including the Replies Queue insert boundary', async value => {
    if (value === 'db') await admitWrite(); else if (value === 'db-read') await admitRead();
    const services = mode(value), writes = vi.spyOn(sheet, 'appendRow');
    expect(await services.repo.createQueueIdea({ operationId: 'synthetic-frozen-reply', actor: { role: 'owner', sub: 'synthetic-owner' }, libraryId: 'SYN-FROZEN', sourcePlatform: 'X', currentHook: 'Synthetic', draftContent: 'Synthetic' })).toMatchObject({ ok: false, code: value === 'db' ? 'FORBIDDEN' : 'CONFIG_MISSING' });
    expect(writes).not.toHaveBeenCalled();
    if (value === 'db') expect(services.repo.capability().state).toBe('read_only');
  });
  it('refuses DB reads and recovery before activation; records no operation proof on refusal', async () => {
    const services = mode('db');
    for (const run of [() => services.repo.listLibrary(), () => services.liveCutover!.backup(), () => services.liveCutover!.rollback()]) {
      await expect(run()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect((await query('select * from content_studio_cutover_evidence')).rows).toHaveLength(0);
    expect(services.contentImport).toBeUndefined();
  });
  it('calls the real RPC authorization boundary with mode allow-lists, freeze and ongoing authority checks', async () => {
    await admitRead(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
    const spy = vi.spyOn(SupabaseContentDb.prototype, 'schemaVersion');
    const services = mode('db-read'); await services.repo.listLibrary();
    const reader = spy.mock.contexts.at(-1)! as SupabaseContentDb;
    const w = { operationId: 'synthetic-direct-rpc', patchHash: hash, actorHash: hash, kind: 'library' as const, id: 'SYN-L001', expectedVersion: '1', data: { current_hook: 'Synthetic direct RPC' } };
    transport.mockClear();
    await expect(reader.applyPatch(w)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transport).not.toHaveBeenCalled();
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'false'); mode('db-shadow'); await admitWrite();
    const writer = mode('db').contentCutover!.exporter.db as SupabaseContentDb;
    transport.mockClear();
    await expect(writer.writeThrough(w)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(writer.applyPatch(w)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transport).not.toHaveBeenCalled();
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true'); const enabled = mode('db').contentCutover!.exporter.db as SupabaseContentDb;
    await expect(enabled.writeThrough(w)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transport).not.toHaveBeenCalled();
    await db.raw.exec('delete from content_studio_cutover_authority');
    await expect(enabled.applyPatch(w)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transport.mock.calls.some(([url]) => String(url).endsWith('content_studio_apply_patch'))).toBe(false);
    transport.mockClear();
    await expect(new SupabaseContentDb(options).applyPatch(w)).rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'live_db_writes_disabled' } });
    expect(transport).not.toHaveBeenCalled();
  });
  it('never replays cached rollback readiness after a Sheet hand edit', async () => {
    await admitWrite(); const services = mode('db');
    expect(await services.liveCutover!.execute('rollback', token)).toMatchObject({ readyToFlip: 'sheet' });
    sheet.externalEdit(SHEET_TABS.library.name, 2, 0, 'Synthetic unexpected ID');
    await expect(mode('db').liveCutover!.execute('rollback', token)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'rollback_export_not_exact' } });
  });
  it('refuses the live hand-edit force-overwrite with a valid owner decision and leaves every Sheet byte intact', async () => {
    await admitWrite(); const services = mode('db'), exporter = services.contentCutover!.exporter;
    await exporter.run();
    const grid = sheet.rawTab(SHEET_TABS.library.name), col = grid[0]!.findIndex(c => c.value === 'Current Hook');
    sheet.externalEdit(SHEET_TABS.library.name, 2, col, 'Synthetic hand edit to preserve');
    const bytes = JSON.stringify(grid), current = grid[1]!, width = grid[0]!.length;
    const observed = fingerprintValues([rowRevision(current.map(c => c.value), width), rowRevision(current.map(c => c.formula ?? c.value), width)]);
    const before = exporter.journal.checkpoints.get('library\0SYN-L001')!.fingerprint;
    transport.mockClear(); vi.mocked(GoogleSheetTransport.prototype.readTab).mockClear();
    await expect(exporter.resolveMismatch({ actor: { role: 'owner', sub: 'synthetic-owner' }, operationId: 'synthetic-force', kind: 'library', id: 'SYN-L001', expectedSheetFingerprint: observed, expectedDbVersion: '1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transport).not.toHaveBeenCalled(); expect(GoogleSheetTransport.prototype.readTab).not.toHaveBeenCalled();
    expect(exporter.journal.checkpoints.get('library\0SYN-L001')!.fingerprint).toBe(before);
    expect(JSON.stringify(sheet.rawTab(SHEET_TABS.library.name))).toBe(bytes);
  });
  it('P1: admits SHA A once; compatible SHA B reads, writes, backs up and rolls back without fresh build evidence', async () => {
    await admitWrite();
    vi.stubEnv('CS_COMMIT_SHA', 'c'.repeat(40)); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
    let services = mode('db');
    const row = await services.repo.getLibrary('SYN-L001');
    expect((await services.repo.updateLibrary({ operationId: 'synthetic-build-b', actor: { role: 'owner', sub: 'synthetic-owner' },
      target: { libraryId: row.value.libraryId }, expectedRevision: row.revision, patch: { currentHook: 'Synthetic compatible deployment' } })).ok).toBe(true);
    services.contentBackup!.folder = new FakePrivateBackupFolder();
    expect(await services.liveCutover!.backup()).toMatchObject({ status: 'verified' });
    await expect(services.liveCutover!.measure()).rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'imports_disabled_in_db_mode' } });
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'false'); services = mode('db');
    expect(await services.liveCutover!.rollback()).toMatchObject({ readyToFlip: 'sheet', parity: { exact: true } });
    expect((await services.repo.listLibrary()).length).toBe(12);
    // Even with an epoch, a new activation must have this deployed SHA's proofs.
    await expect(services.liveCutover!['activate-db']()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('P1: an incompatible contract is visibly read-only; owner backup and rollback still work', async () => {
    await admitWrite();
    await query("update content_studio_cutover_authority set contract='schema-2:older-contract'");
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true'); let services = mode('db');
    expect((await services.repo.listLibrary()).length).toBe(12);
    expect(services.repo.capability().state).toBe('read_only');
    const row = await services.repo.getLibrary('SYN-L001');
    await expect(services.repo.updateLibrary({ operationId: 'synthetic-incompatible', actor: { role: 'owner', sub: 'synthetic-owner' },
      target: { libraryId: row.value.libraryId }, expectedRevision: row.revision, patch: { currentHook: 'Synthetic refused' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const report = await buildReconcileReport(services.repo, services.drive, undefined, { liveCutover: services.liveCutover });
    expect(report.items).toContainEqual(expect.objectContaining({ kind: 'cutover_blocked', severity: 'blocking', facts: expect.arrayContaining(['cutover_contract_mismatch']) }));
    services.contentBackup!.folder = new FakePrivateBackupFolder();
    expect(await services.liveCutover!.backup()).toMatchObject({ status: 'verified' });
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'false'); services = mode('db');
    expect(await services.liveCutover!.rollback()).toMatchObject({ readyToFlip: 'sheet' });
  });
  it('produces backup/rehearsal gate evidence only through real operations, bound to the build/import', async () => {
    await admitWrite(false);
    const records = (await query('select name,build,import_id,payload from content_studio_cutover_evidence')).rows;
    const journal = getServices().contentBackup!.journal.lastVerified!;
    expect(records.find(r => r.name === 'backup')).toMatchObject({ build, payload: { manifestHash: journal.manifestHash, verifiedAt: journal.verifiedAt } });
    expect(records.find(r => r.name === 'rehearsal')).toMatchObject({ build, payload: { exact: true, dbHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    await expect(new ContentCutoverStore(options, build).activate('db')).resolves.toMatchObject({ contract: CUTOVER_CONTRACT });
  });
  it('P2: a transient read-only parity 429 takes no export lease and the next export succeeds', async () => {
    await admitWrite(); const services = mode('db');
    await services.contentCutover!.exporter.run();
    const original = transport.getMockImplementation()!;
    transport.mockClear();
    vi.mocked(GoogleSheetTransport.prototype.readTab).mockRejectedValueOnce(Object.assign(new Error('synthetic 429'), { status: 429 }));
    await expect(services.contentCutover!.exporter.parity()).rejects.toThrow('synthetic 429');
    expect(transport.mock.calls.some(([url]) => String(url).endsWith('content_studio_cutover_claim'))).toBe(false);
    expect((await query("select token from content_studio_cutover_state where name='sheet-export'")).rows[0]!.token).toBeNull();
    transport.mockImplementation(original);
    expect((await services.contentCutover!.exporter.run()).exact).toBe(true);
  });
  it('P3: no-link body saves name markdown_missing without an impossible outbox; backup and Sheet rollback work', async () => {
    // The probe removes both possible Markdown destinations before importing.
    await query("update content_studio_posts set source_markdown_url='',source_master_file_url='' where library_id='SYN-L002'");
    for (const header of ['Source Markdown', 'Source Master File']) {
      const col = sheet.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === header);
      const row = sheet.rawTab(SHEET_TABS.library.name)[2]![col]!; row.value = ''; delete row.formula; delete row.link;
    }
    // Re-import captures exact source fingerprints after the probe's link edit.
    const e = buildTypedImport(await buildSheetMirrorSnapshot(new SheetsContentRepository(sheet), { sourceKey: 'synthetic_source' }), await importVersions(new SupabaseContentDb(options)), hash);
    await query('select content_studio_import_run($1,$2,$3,$4,$5,$6,$7)', ['synthetic-no-link', e.snapshotHash, e.actorHash, e.counts, e.hashes, e.exceptions, e.rows]);
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true'); let services = mode('db');
    const row = await services.repo.getLibrary('SYN-L002');
    expect((await services.repo.updateLibrary({ operationId: 'synthetic-no-link-body', actor: { role: 'owner', sub: 'synthetic-owner' }, target: { libraryId: 'SYN-L002' }, expectedRevision: row.revision, patch: { draftContent: 'Synthetic DB-only body' } })).ok).toBe(true);
    expect((await query('select * from content_studio_markdown_export')).rows).toHaveLength(0);
    await services.markdownExport!.run(); await services.markdownExport!.run();
    expect((await query('select * from content_studio_markdown_export')).rows).toHaveLength(0);
    expect(await services.markdownExport!.status()).toContainEqual(expect.objectContaining({ libraryId: 'SYN-L002', reason: 'markdown_missing' }));
    const report = await buildReconcileReport(services.repo, services.drive, undefined, { markdownExport: services.markdownExport });
    expect(report.items).toContainEqual(expect.objectContaining({ kind: 'markdown_missing', severity: 'blocking', action: expect.objectContaining({ label: 'Review' }) }));
    services.contentBackup!.folder = new FakePrivateBackupFolder(); expect(await services.liveCutover!.backup()).toMatchObject({ status: 'verified' });
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'false'); services = mode('db');
    expect(await services.liveCutover!.rollback()).toMatchObject({ readyToFlip: 'sheet' });
    expect((await mode('sheet').repo.getLibrary('SYN-L002')).value.draftContent).toBe('Synthetic DB-only body');
  });
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
  it('serializes independent workers, rejects stale tokens and retains a live lease until expiry', async () => {
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
    expect((await POST(request('not-a-uuid'))).status).toBe(400); expect(transport).not.toHaveBeenCalled();
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
  it.each(['denied', 'timeout'])('fails safely on DB %s mid-export, retaining earlier durable checkpoints and releasing the worker lease', async failure => {
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
    expect(state.token).toBeNull();
    expect((state.state as { checkpoints: unknown[] }).checkpoints.length).toBeGreaterThan(0);
    transport.mockImplementation(original);
    expect((await mode('db').contentCutover!.exporter.run()).exact).toBe(true);
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
  it('retains failed backup evidence after restart and permits retry without advancing verification', async () => {
    await admitRead(); const store = new ContentCutoverStore(options, build);
    await expect(store.exclusive('backup', async () => { store.backupJournal.failureSince = 42; throw new Error('Synthetic Drive upload failure'); })).rejects.toThrow('Synthetic Drive upload failure');
    const restarted = new ContentCutoverStore(options, build); await restarted.refreshBackup();
    expect(restarted.backupJournal).toEqual({ lastVerified: null, failureSince: 42 });
    expect(await restarted.exclusive('backup', async () => true)).toBe(true);
  });
  it('executes exact rollback preparation before authority and after DB saves, freezes writes, and permits the actual flag round trip', async () => {
    await admitWrite(false); let services = mode('db-read');
    const first = await services.liveCutover!.rollback() as { readyToFlip: string; parity: { exact: boolean; dbHash: string; sheetHash: string } };
    expect(first.readyToFlip).toBe('sheet'); expect(first.parity.exact).toBe(true); expect(first.parity.dbHash).toBe(first.parity.sheetHash);
    expect((await mode('sheet').repo.listLibrary()).length).toBe(12);
    await new ContentCutoverStore(options, build).activate('db');
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

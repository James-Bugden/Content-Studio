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
import { POST as draftRoute } from '@/app/api/library/[libraryId]/draft/route';
import { POST as typefullyRoute } from '@/app/api/schedule/[contentId]/typefully/create/route';
import { readSection } from '@/application/markdown-source';
import { safeReplaceSectionBody } from '@/domain/markdown';
import { GET as backupGET } from '@/app/api/ops/content-backup/reconcile/route';
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: '100000000000000000001' } }) }));

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
  await db.raw.exec('truncate content_studio_backup_waivers,content_studio_cutover_authority,content_studio_cutover_jobs,content_studio_cutover_state,content_studio_cutover_evidence,content_studio_markdown_export,content_studio_shadow_jobs,content_studio_shadow_lease,content_studio_shadow_events,content_studio_import_runs,content_studio_operations,content_studio_posts,content_studio_schedule,content_studio_workflow_settings,content_studio_audit_events,content_studio_row_history restart identity cascade');
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
  async function waiveBackup() {
    const importId = await new SupabaseContentDb(options).latestImportId();
    return query('select content_studio_cutover_waive_backup($1,$2,$3,$4,$5) as result', [token, build, importId, '2026-10-25', hash]);
  }
  async function waivedPreparation() {
    await admitWrite(false);
    await query("delete from content_studio_cutover_evidence where name='backup'");
    vi.stubEnv('CS_BACKUP_GATE_WAIVED', '2026-10-25');
    vi.stubEnv('CS_CONTENT_BACKUP_FOLDER_ID', '');
    await waiveBackup();
    return mode('db-read');
  }
  const activationRequest = (id = '33333333-3333-4333-8333-333333333333') => new Request('https://synthetic.example/api/ops/content-cutover', {
    method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}`, 'Idempotency-Key': id },
    body: JSON.stringify({ action: 'activate-db' }),
  });
  const preparationExporter = () => new ContentExporter(new SupabaseContentDb(options),
    new GoogleSheetTransport(env.CS_SHEET_ID, {} as never, true), new ContentCutoverStore(options, build).exportJournal);
  const waiverGate = () => query('select content_studio_cutover_gate($1,$2,$3)', ['db', build, '2026-10-25']);
  const waiverActivate = () => query('select content_studio_cutover_activate($1,$2,$3,$4)', ['db', build, CUTOVER_CONTRACT, '2026-10-25']);
  it('CS-066: reapplying the additive migration is safe', async () => {
    await waivedPreparation();
    const before = (await query('select * from content_studio_backup_waivers')).rows;
    await db.raw.exec(readFileSync('supabase/migrations/20261025000700_content_backup_gate_waiver.sql', 'utf8'));
    expect((await query('select * from content_studio_backup_waivers')).rows).toEqual(before);
    await expect(new ContentCutoverStore(options, build).activate('db')).resolves.toBeDefined();
  });
  it.each(['date', 'build', 'actor', 'import', 'id'])('CS-066: audited action rejects invalid %s without a record', async fault => {
    const importId = await new SupabaseContentDb(options).latestImportId();
    const args = [token, build, importId, '2026-10-25', hash];
    args[{ date: 3, build: 1, actor: 4, import: 2, id: 0 }[fault]!] = fault === 'id' ? null : 'invalid';
    await expect(query('select content_studio_cutover_waive_backup($1,$2,$3,$4,$5)', args)).rejects.toBeDefined();
    expect((await query('select * from content_studio_backup_waivers')).rows).toHaveLength(0);
  });
  it('CS-066: completed activation and waived backup replays cannot outlive env/audit revocation', async () => {
    await waivedPreparation();
    const store = new ContentCutoverStore(options, build);
    await store.operation('activate-db', '33333333-3333-4333-8333-333333333333', () => store.activate('db'));
    const services = mode('db');
    const backupId = '44444444-4444-4444-8444-444444444444';
    expect(await services.liveCutover!.execute('backup', backupId)).toEqual({ status: 'backup_waived' });
    await db.raw.exec('delete from content_studio_backup_waivers');
    await expect(store.operation('activate-db', '33333333-3333-4333-8333-333333333333', () => store.activate('db'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(services.liveCutover!.execute('backup', backupId)).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
    await waiveBackup(); vi.stubEnv('CS_BACKUP_GATE_WAIVED', undefined);
    await expect(store.operation('activate-db', '33333333-3333-4333-8333-333333333333', () => store.activate('db'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('CS-066: red admission and a past backup failure stay visible beside the waiver', async () => {
    await waivedPreparation();
    await query("insert into content_studio_cutover_state(name,state) values('backup',$1) on conflict(name) do update set state=excluded.state", [{ lastVerified: null, failureSince: Date.now() }]);
    await query("delete from content_studio_cutover_evidence where name='parity'");
    const services = mode('db-read');
    const report = await buildReconcileReport(services.repo, services.drive, Date.now(), { liveCutover: services.liveCutover });
    expect(report.items.map(i => i.kind)).toEqual(expect.arrayContaining(['backup_waived', 'cutover_blocked', 'backup_fresh']));
  });
  it('CS-066: requires env AND an audited owner decision; env removal revokes waiver', async () => {
    const services = await waivedPreparation();
    expect(await services.liveCutover!['activate-db']()).toMatchObject({ mode: 'db' });
    const rows = (await query('select * from content_studio_backup_waivers')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ by: 'owner', on: '2026-10-25', actor_hash: hash, build });
    expect(rows[0]!.recorded_at).toBeDefined();
    await waiveBackup(); expect((await query('select * from content_studio_backup_waivers')).rows).toEqual(rows);
    await expect(query('select content_studio_cutover_waive_backup($1,$2,$3,$4,$5)', [token, build, rows[0]!.import_id, '2026-10-25', 'c'.repeat(64)])).rejects.toMatchObject({ code: '23505' });
    vi.stubEnv('CS_BACKUP_GATE_WAIVED', undefined);
    await expect(new ContentCutoverStore(options, build).activate('db')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    vi.stubEnv('CS_BACKUP_GATE_WAIVED', '2026-10-25');
    await db.raw.exec('delete from content_studio_backup_waivers');
    await expect(new ContentCutoverStore(options, build).activate('db')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it.each(['missing-rehearsal', 'inexact', 'hash', 'issues', 'stale', 'plan', 'private-reference', 'parity', 'lag', 'freeze', 'sha', 'import', 'failed-backup', 'obsolete-backup', 'backup-failure'])('CS-066: waiver never hides %s', async fault => {
    const services = await waivedPreparation();
    await expect(new ContentCutoverStore(options, build).assertFlip('db')).resolves.toBeUndefined();
    if (fault === 'missing-rehearsal') await query("delete from content_studio_cutover_evidence where name='rehearsal'");
    if (fault === 'inexact') await query("update content_studio_cutover_evidence set payload=payload || '{\"exact\":false}' where name='rehearsal'");
    if (fault === 'hash') await query("update content_studio_cutover_evidence set payload=payload || jsonb_build_object('sheetHash',$1::text) where name='rehearsal'", ['c'.repeat(64)]);
    if (fault === 'issues') await query("update content_studio_cutover_evidence set payload=payload || '{\"differences\":[{}]}' where name='rehearsal'");
    if (fault === 'stale') await query("update content_studio_cutover_evidence set at=clock_timestamp()-interval '25 hours' where name='rehearsal'");
    if (fault === 'plan') await query("update content_studio_cutover_evidence set payload=payload-'dailyPlanBackup' where name='phase-c'");
    if (fault === 'private-reference') await query("update content_studio_cutover_evidence set payload=payload-'privateEvidence' where name='phase-c'");
    if (fault === 'parity') await query("update content_studio_cutover_evidence set payload=jsonb_set(payload,'{samples,library,idsEqual}','false') where name='parity'");
    if (fault === 'lag') await query("update content_studio_cutover_evidence set payload=jsonb_set(payload,'{samples,library,lagMs}','900001') where name='parity'");
    if (fault === 'freeze') await query("update content_studio_cutover_evidence set payload=payload || '{\"freeze\":false}' where name='phase-c'");
    if (fault === 'sha') await db.raw.query("update content_studio_backup_waivers set build=$1", ['c'.repeat(40)]);
    if (fault === 'import') await db.raw.query("update content_studio_backup_waivers set import_id='synthetic-old'");
    if (fault === 'failed-backup') await query("insert into content_studio_cutover_evidence select 'backup',build,import_id,'{\"manifestHash\":\"bad\"}',clock_timestamp() from content_studio_cutover_evidence where name='rehearsal'");
    if (fault === 'obsolete-backup') await query("insert into content_studio_cutover_evidence select 'backup',build,'synthetic-old-import',jsonb_build_object('manifestHash',$1::text),clock_timestamp() from content_studio_cutover_evidence where name='rehearsal'", [hash]);
    if (fault === 'backup-failure') await query("insert into content_studio_cutover_state(name,state) values('backup',$1) on conflict(name) do update set state=excluded.state", [{ lastVerified: null, failureSince: Date.now() }]);
    await expect(services.liveCutover!['activate-db']()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await query('select * from content_studio_cutover_authority')).rows).toHaveLength(0);
  });
  it('CS-066: waiver reports honestly through worker/cron/reconcile, preserves export mismatch and emergency rollback', async () => {
    const preparation = await waivedPreparation();
    expect(await preparation.liveCutover!.backup()).toEqual({ status: 'backup_waived' });
    await preparation.liveCutover!['activate-db']();
    const services = mode('db'); // env admission permits missing folder, but never creates an archive
    const response = await backupGET(new Request('https://synthetic.example/api/ops/content-backup/reconcile', { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, status: 'backup_waived' });
    const col = sheet.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === 'Current Hook');
    await services.contentCutover!.exporter.run();
    sheet.externalEdit(SHEET_TABS.library.name, 2, col, 'Synthetic hand edit');
    const report = await buildReconcileReport(services.repo, services.drive, Date.now(), { liveCutover: services.liveCutover, contentCutover: services.contentCutover });
    expect(report.items.some(i => i.title === 'Backup gate waived by owner' && i.facts.join(' ').includes('2026-10-25'))).toBe(true);
    expect(report.items.some(i => i.kind === 'backup_fresh')).toBe(false);
    expect(report.items.some(i => i.kind === 'export_mismatch' && i.severity === 'blocking')).toBe(true);
    await expect(services.liveCutover!.rollback()).rejects.toMatchObject({ code: 'CONFLICT' });
    vi.stubEnv('CS_BACKUP_GATE_WAIVED', undefined); resetEnvCache();
    await expect(new ContentCutoverStore(options, build).backupWaiver()).resolves.toBeNull();
  });
  it('CS-066: configured folder still verifies backups, even with an audit and env switch', async () => {
    await waivedPreparation();
    vi.stubEnv('CS_CONTENT_BACKUP_FOLDER_ID', env.CS_CONTENT_BACKUP_FOLDER_ID);
    const services = mode('db-read');
    await expect(services.liveCutover!['activate-db']()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    services.contentBackup!.folder = new FakePrivateBackupFolder();
    expect(await services.liveCutover!.backup()).toMatchObject({ status: 'verified', manifestHash: expect.any(String) });
    expect(await services.liveCutover!['activate-db']()).toMatchObject({ mode: 'db' });
    vi.spyOn(services.contentBackup!.folder, 'assertPrivate').mockRejectedValue(new AppError('FORBIDDEN'));
    await expect(services.liveCutover!.backup()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it.each(['hand-edit', 'unexpected-id'])('CS-066 R1: refuses activation AFTER real export detects %s', async fault => {
    await waivedPreparation();
    await expect(waiverGate()).resolves.toBeDefined();
    const grid = sheet.rawTab(SHEET_TABS.library.name);
    if (fault === 'hand-edit') sheet.externalEdit(SHEET_TABS.library.name, 2, grid[0]!.findIndex(c => c.value === 'Current Hook'), 'Synthetic later hand edit');
    else {
      const extra = structuredClone(grid[1]!);
      extra[grid[0]!.findIndex(c => c.value === 'Library ID')] = { value: 'SYN-UNEXPECTED' };
      grid.push(extra);
    }
    const before = JSON.stringify(grid), exporter = preparationExporter();
    const result = await exporter.run();
    expect(result.exact).toBe(false); expect(result.dbHash).not.toBe(result.sheetHash);
    expect(result.differences).toContainEqual(expect.objectContaining({ fields: expect.arrayContaining([fault === 'hand-edit' ? 'Current Hook' : '@unexpected']) }));
    if (fault === 'hand-edit') expect([...exporter.journal.issues.values()]).toContainEqual(expect.objectContaining({ reason: 'export_mismatch' }));
    const response = await POST(activationRequest());
    expect(response.status).toBe(403);
    await expect(waiverGate()).rejects.toMatchObject({ code: '42501', message: 'waived backup requires exact Sheet export' });
    await expect(waiverActivate()).rejects.toMatchObject({ code: '42501', message: 'waived backup requires exact Sheet export' });
    expect(JSON.stringify(grid)).toBe(before);
    expect((await query('select * from content_studio_cutover_authority')).rows).toHaveLength(0);
  });
  it.each(['first', 'replay'])('CS-066 R1: %s activation rechecks Sheet without a new exporter run', async attempt => {
    const services = await waivedPreparation();
    if (attempt === 'replay') {
      await services.liveCutover!['activate-db']();
      mode('db');
      expect((await POST(activationRequest())).status).toBe(200);
      const beforeReplay = (await query('select * from content_studio_cutover_authority')).rows;
      const reads = vi.mocked(GoogleSheetTransport.prototype.readTab); reads.mockClear();
      expect((await POST(activationRequest())).status).toBe(200);
      expect(reads).toHaveBeenCalled();
      expect((await query('select * from content_studio_cutover_authority')).rows).toEqual(beforeReplay);
    }
    const authority = (await query('select * from content_studio_cutover_authority')).rows;
    const grid = sheet.rawTab(SHEET_TABS.library.name);
    sheet.externalEdit(SHEET_TABS.library.name, 2, grid[0]!.findIndex(c => c.value === 'Current Hook'), 'Synthetic unexported edit');
    // Durable export remains green: only a fresh provider read can refuse this.
    await expect(waiverGate()).resolves.toBeDefined();
    const before = JSON.stringify(grid), writes = vi.mocked(GoogleSheetTransport.prototype.writeCells); writes.mockClear();
    if (attempt === 'first') await expect(services.liveCutover!['activate-db']()).rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'backup_waiver_export_not_exact' } });
    const response = await POST(activationRequest());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ details: { reason: 'backup_waiver_export_not_exact' } });
    expect(writes).not.toHaveBeenCalled(); expect(JSON.stringify(grid)).toBe(before);
    expect((await query('select * from content_studio_cutover_authority')).rows).toEqual(authority);
  });
  it('CS-066 R1: provider failure cannot reuse a green export at activation', async () => {
    await waivedPreparation();
    vi.mocked(GoogleSheetTransport.prototype.readTab).mockRejectedValue(new AppError('PROVIDER_UNAVAILABLE'));
    expect((await POST(activationRequest())).status).toBe(503);
    expect((await query('select * from content_studio_cutover_authority')).rows).toHaveLength(0);
  });
  it('CS-066 R1: fresh equality cannot clear a retained exporter conflict', async () => {
    await waivedPreparation();
    const grid = sheet.rawTab(SHEET_TABS.library.name), col = grid[0]!.findIndex(c => c.value === 'Current Hook');
    const original = structuredClone(grid[1]![col]!);
    sheet.externalEdit(SHEET_TABS.library.name, 2, col, 'Synthetic conflicting edit');
    expect((await preparationExporter().run()).exact).toBe(false);
    grid[1]![col] = original;
    expect((await preparationExporter().parity()).exact).toBe(true);
    const response = await POST(activationRequest());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ details: { reason: 'backup_waiver_export_not_exact' } });
    expect((await query('select * from content_studio_cutover_authority')).rows).toHaveLength(0);
  });
  it('CS-066 R1: a newer worker conflict between fresh inspection and SQL activation refuses', async () => {
    await waivedPreparation();
    const original = transport.getMockImplementation()!;
    let injected = false;
    transport.mockImplementation(async (url, init) => {
      if (String(url).endsWith('content_studio_cutover_activate')) {
        injected = true;
        await query("update content_studio_cutover_state set state=jsonb_set(state,'{issues}',$1) where name='sheet-export'", [JSON.stringify([[JSON.stringify(['library', 'SYN-L001']), { kind: 'library', id: 'SYN-L001', fields: ['Current Hook'], since: Date.now(), reason: 'export_mismatch' }]])]);
      }
      return original(url, init);
    });
    expect((await POST(activationRequest())).status).toBe(403); expect(injected).toBe(true);
    expect((await query('select * from content_studio_cutover_authority')).rows).toHaveLength(0);
  });
  it.each(['missing-state', 'issues', 'missing-reports', 'inexact', 'hash', 'missing-hash', 'invalid-hash', 'differences', 'stale', 'future', 'missing-time'])('CS-066 R1: SQL waiver refuses %s with all other proofs green', async fault => {
    await waivedPreparation();
    await expect(waiverGate()).resolves.toBeDefined();
    if (fault === 'missing-state') await query("delete from content_studio_cutover_state where name='sheet-export'");
    else {
      const state = structuredClone((await query("select state from content_studio_cutover_state where name='sheet-export'")).rows[0]!.state) as { issues: unknown[]; reports: Record<string, unknown>[] };
      const report = state.reports.at(-1)!;
      if (fault === 'issues') state.issues = [[JSON.stringify(['library', 'SYN-L001']), { kind: 'library', id: 'SYN-L001', fields: ['Current Hook'], since: Date.now(), reason: 'export_mismatch' }]];
      if (fault === 'missing-reports') state.reports = [];
      if (fault === 'inexact') report.exact = false;
      if (fault === 'hash') report.sheetHash = 'c'.repeat(64);
      if (fault === 'missing-hash') { delete report.dbHash; delete report.sheetHash; }
      if (fault === 'invalid-hash') { report.dbHash = 'bad'; report.sheetHash = 'bad'; }
      if (fault === 'differences') report.differences = [{ fields: ['@unexpected'] }];
      if (fault === 'stale') report.at = Date.now() - 16 * 60_000;
      if (fault === 'future') report.at = Date.now() + 60_000;
      if (fault === 'missing-time') delete report.at;
      await query("update content_studio_cutover_state set state=$1 where name='sheet-export'", [state]);
    }
    await expect(waiverGate()).rejects.toMatchObject({ code: '42501', message: 'waived backup requires exact Sheet export' });
    await expect(waiverActivate()).rejects.toMatchObject({ code: '42501', message: 'waived backup requires exact Sheet export' });
    expect((await query('select * from content_studio_cutover_authority')).rows).toHaveLength(0);
  });
  it.each([
    ['whitespace', ' \t\r\n '], ['false', false], ['number', 123], ['object', { reference: 'synthetic' }],
    ['empty-array', []], ['null', null], ['missing', undefined], ['empty', ''], ['oversized', 'x'.repeat(2049)],
  ])('CS-066 R1: phase-c rejects privateEvidence %s through the supported record RPC', async (_label, reference) => {
    const services = await waivedPreparation();
    const evidence = (await query("select import_id,payload from content_studio_cutover_evidence where name='phase-c'")).rows[0]!;
    const payload = { ...(evidence.payload as Record<string, unknown>), privateEvidence: reference };
    // JSON transport omits undefined, preserving the missing-key case.
    await query('select content_studio_cutover_record($1,$2,$3,$4)', ['phase-c', build, evidence.import_id, JSON.parse(JSON.stringify(payload))]);
    await expect(waiverGate()).rejects.toMatchObject({ code: '42501', message: 'phase C proof missing' });
    await expect(services.liveCutover!['activate-db']()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await POST(activationRequest())).status).toBe(403);
    expect((await query('select * from content_studio_cutover_authority')).rows).toHaveLength(0);
  });
  it.each(['x', 'x'.repeat(2048), ' \t synthetic-private-reference \n '])('CS-066 R1: accepts a bounded nonblank evidence string (%#)', async reference => {
    const services = await waivedPreparation();
    await query("update content_studio_cutover_evidence set payload=jsonb_set(payload,'{privateEvidence}',$1) where name='phase-c'", [JSON.stringify(reference)]);
    await expect(services.liveCutover!['activate-db']()).resolves.toMatchObject({ mode: 'db' });
  });
  it.each(['db', 'db-read'].flatMap(storeMode => ['draft', 'typefully'].map(action => [storeMode, action])))('R2 route: refreshes an initially green %s status and blocks %s before any provider call', async (storeMode, action) => {
    if (storeMode === 'db') await admitWrite();
    else { await admitRead(); await new ContentCutoverStore(options, build).activate('db-read'); }
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
    vi.stubEnv('APP_BASE_URL', 'https://synthetic.example');
    vi.stubEnv('CS_OWNER_GOOGLE_SUB', '100000000000000000001'); vi.stubEnv('AUTH_GOOGLE_ID', 'synthetic-client'); vi.stubEnv('AUTH_GOOGLE_SECRET', 'synthetic-secret');
    const services = mode(storeMode);
    const library = await services.repo.getLibrary('SYN-L001'), schedule = (await services.repo.listSchedule())[0]!;
    const section = await readSection(services.drive, library); expect(section.ok).toBe(true);
    // Prime the cached status green, then change durable authority WITHOUT
    // recreating Services. Both the route check and its refresh are necessary.
    expect(await services.liveCutover!.status()).toEqual({ blocking: undefined });
    await query("update content_studio_cutover_authority set contract='schema-2:older-contract'");
    const providerSpies = [vi.mocked(GoogleDriveGateway.prototype.readText), vi.mocked(GoogleDriveGateway.prototype.writeText),
      vi.spyOn(services.typefully, 'findByIdempotencyKey'), vi.spyOn(services.typefully, 'listDrafts'), vi.spyOn(services.typefully, 'createDraft'),
      vi.spyOn(services.typefully, 'getDraft'), vi.spyOn(services.typefully, 'updateDraft'), vi.spyOn(services.typefully, 'getPublication')];
    for (const spy of providerSpies) spy.mockClear();
    const path = action === 'draft' ? '/api/library/SYN-L001/draft' : `/api/schedule/${schedule.value.contentId}/typefully/create`;
    const request = new Request(`https://synthetic.example${path}`, { method: 'POST', headers: { origin: 'https://synthetic.example', 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'synthetic-blocked-route', expectedRevision: schedule.revision, expectedSheetRevision: library.revision, expectedSectionHash: section.ok ? section.section.bodyHash : '', proposed: 'Synthetic blocked draft' }) });
    const response = action === 'draft' ? await draftRoute(request, { params: Promise.resolve({ libraryId: 'SYN-L001' }) }) : await typefullyRoute(request, { params: Promise.resolve({ contentId: schedule.value.contentId }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'FORBIDDEN', details: { reason: 'cutover_contract_mismatch' } });
    for (const spy of providerSpies) expect(spy).not.toHaveBeenCalled();
  });
  it('R2 epochs: refuses a db-read deployment against DB authority before any Sheet-first write', async () => {
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
    const stale = mode('db-read');
    const write = vi.spyOn(sheet, 'writeCells'), append = vi.spyOn(sheet, 'appendRow');
    await expect(stale.repo.listLibrary()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(stale.repo.updateLibrary({ operationId: 'synthetic-old-deployment', actor: { role: 'owner', sub: 'synthetic-owner' }, target: { libraryId: 'SYN-L001' }, expectedRevision: 'old', patch: { currentHook: 'Must not overwrite DB' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(write).not.toHaveBeenCalled(); expect(append).not.toHaveBeenCalled();
  });
  it('R2 epochs: cannot downgrade an active DB epoch with otherwise green read evidence', async () => {
    await admitWrite();
    await expect(query('select content_studio_cutover_gate($1,$2)', ['db-read', build])).resolves.toBeDefined();
    await expect(query('select content_studio_cutover_activate($1,$2,$3)', ['db-read', build, CUTOVER_CONTRACT])).rejects.toMatchObject({ code: '42501', message: 'DB authority exists' });
    expect((await query('select mode from content_studio_cutover_authority')).rows[0]!.mode).toBe('db');
  });
  it('R2 epochs: activation refuses only the contract mismatch with all proofs green', async () => {
    await admitWrite(false);
    await expect(query('select content_studio_cutover_gate($1,$2)', ['db', build])).resolves.toBeDefined();
    await expect(query('select content_studio_cutover_activate($1,$2,$3)', ['db', build, 'schema-2:cutover-9'])).rejects.toMatchObject({ code: '42501', message: 'contract mismatch' });
    expect((await query('select * from content_studio_cutover_authority')).rows).toHaveLength(0);
  });
  it.each(['post-write', 'schedule-write', 'expired', 'inexact'])('R2 retire: refuses %s with every other retirement precondition green', async fault => {
    await admitWrite();
    const ready = await mode('db').liveCutover!.rollback() as { parity: { dbHash: string } };
    if (fault === 'post-write' || fault === 'schedule-write') {
      vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
      const writer = mode('db').contentCutover!.exporter.db as SupabaseContentDb;
      const schedule = (await writer.listSchedule())[0]!;
      expect(await writer.applyPatch({ operationId: `synthetic-after-rehearsal-${fault}`, actorHash: hash, patchHash: hash,
        kind: fault === 'post-write' ? 'library' : 'schedule', id: fault === 'post-write' ? 'SYN-L001' : schedule.content_id,
        expectedVersion: fault === 'post-write' ? '1' : String(schedule.row_version), data: { [fault === 'post-write' ? 'current_hook' : 'hook']: 'Synthetic post-rehearsal write' } })).toMatchObject({ ok: true });
    } else if (fault === 'expired') {
      // Put all content before the rehearsal: age must be the ONLY red guard.
      await query("update content_studio_posts set updated_at=clock_timestamp()-interval '17 minutes'");
      await query("update content_studio_schedule set updated_at=clock_timestamp()-interval '17 minutes'");
      await query("update content_studio_cutover_evidence set at=clock_timestamp()-interval '16 minutes' where name='rehearsal'");
    } else await query("update content_studio_cutover_evidence set payload=jsonb_set(payload,'{exact}','false') where name='rehearsal'");
    await expect(query('select content_studio_cutover_retire($1,$2,$3)', [token, build, ready.parity.dbHash])).rejects.toMatchObject({ code: '42501', message: 'verified rollback required' });
    expect((await query('select mode from content_studio_cutover_authority')).rows[0]!.mode).toBe('db');
  });
  it('R2 lease: an expired owner cannot save even before another worker claims', async () => {
    await query('select content_studio_cutover_claim($1,$2)', ['sheet-export', token]);
    const before = (await query("select state from content_studio_cutover_state where name='sheet-export'")).rows[0]!.state;
    await query("update content_studio_cutover_state set lease_until=clock_timestamp()-interval '1 second' where name='sheet-export'");
    await expect(query('select content_studio_cutover_save($1,$2,$3)', ['sheet-export', token, { checkpoints: [], issues: [], reports: [] }])).rejects.toMatchObject({ code: '42501', message: 'stale worker' });
    expect((await query("select state from content_studio_cutover_state where name='sheet-export'")).rows[0]!.state).toEqual(before);
  });
  it('R2 lease: an operation is taken over only after expiry and its old completion is fenced', async () => {
    const next = '33333333-3333-4333-8333-333333333333';
    const claim = (t: string, result: unknown = null) => query('select content_studio_cutover_operation($1,$2,$3,$4) as result', [token, hash, t, result]);
    expect((await claim(token)).rows[0]!.result).toEqual({ status: 'acquired' });
    await expect(claim(next)).rejects.toMatchObject({ code: '55000', message: 'operation in progress' });
    expect((await query('select token from content_studio_cutover_jobs')).rows[0]!.token).toBe(token);
    await query("update content_studio_cutover_jobs set at=clock_timestamp()-interval '121 seconds'");
    expect((await claim(next)).rows[0]!.result).toEqual({ status: 'acquired' });
    await expect(claim(token, { ok: true })).rejects.toMatchObject({ code: '55000' });
    expect((await claim(next, { ok: true })).rows[0]!.result).toEqual({ status: 'completed', result: { ok: true } });
  });
  it.each(['writeCells', 'appendRow'] as const)('R2 fence: expired export refuses before Sheet %s', async action => {
    await admitWrite(); const services = mode('db'), exporter = services.contentCutover!.exporter;
    await exporter.run();
    if (action === 'writeCells') await query("update content_studio_posts set current_hook='Synthetic fenced change',row_version=row_version+1 where library_id='SYN-L001'");
    else {
      vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
      const writer = mode('db').contentCutover!.exporter.db as SupabaseContentDb;
      expect(await writer.insertQueueIdea({ operationId: 'synthetic-fenced-append', actorHash: hash, patchHash: hash, kind: 'queue', id: 'SYN-FENCED', expectedVersion: null, data: { current_hook: 'Synthetic fenced idea' } })).toMatchObject({ ok: true });
    }
    const provider = vi.mocked(GoogleSheetTransport.prototype[action]); provider.mockClear();
    const read = vi.mocked(GoogleSheetTransport.prototype.readTab), readOriginal = read.getMockImplementation()!;
    let reads = 0;
    read.mockImplementation(async (...args) => {
      const result = await readOriginal(...args);
      // The second read is the fresh row precondition, immediately before the
      // fence/write. Expiry occurs even if the fence is deleted by a mutant.
      if (args[0] === SHEET_TABS[action === 'writeCells' ? 'library' : 'queue'].name && ++reads === 2) {
        await query("update content_studio_cutover_state set lease_until=clock_timestamp()-interval '1 second' where name='sheet-export'");
      }
      return result;
    });
    const original = ContentShadowStore.prototype.cutoverRpc;
    let fences = 0;
    vi.spyOn(ContentShadowStore.prototype, 'cutoverRpc').mockImplementation(async function(this: ContentShadowStore, name, params) {
      if (name === 'fence' && params.p_name === 'sheet-export') fences++;
      return original.call(this, name, params);
    });
    await exporter.run().catch(error => expect(error).toMatchObject({ code: 'FORBIDDEN' }));
    expect(provider).not.toHaveBeenCalled(); expect(fences).toBeGreaterThan(0);
    expect(exporter.journal.issues.size).toBeGreaterThan(0);
  });
  it('R2 fence: expired Markdown worker refuses before Drive write', async () => {
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true'); const services = mode('db');
    const writer = services.contentCutover!.exporter.db as SupabaseContentDb;
    expect(await writer.applyPatch({ operationId: 'synthetic-fenced-markdown', patchHash: hash, actorHash: hash, kind: 'library', id: 'SYN-L001', expectedVersion: '1', data: { draft_content: 'Synthetic fenced body' } })).toMatchObject({ ok: true });
    const read = vi.mocked(GoogleDriveGateway.prototype.readText), readOriginal = read.getMockImplementation()!;
    read.mockImplementation(async (...args) => {
      const result = await readOriginal(...args);
      await query("update content_studio_cutover_state set lease_until=clock_timestamp()-interval '1 second' where name='markdown-export'");
      return result;
    });
    const original = ContentShadowStore.prototype.cutoverRpc; let fences = 0;
    vi.spyOn(ContentShadowStore.prototype, 'cutoverRpc').mockImplementation(async function(this: ContentShadowStore, name, params) {
      if (name === 'fence' && params.p_name === 'markdown-export') fences++;
      return original.call(this, name, params);
    });
    vi.mocked(GoogleDriveGateway.prototype.writeText).mockClear();
    await services.markdownExport!.run().catch(error => expect(error).toMatchObject({ code: 'FORBIDDEN' }));
    expect(GoogleDriveGateway.prototype.writeText).not.toHaveBeenCalled(); expect(fences).toBe(1);
    expect((await writer.pendingMarkdownExports()).map(j => j.libraryId)).toEqual(['SYN-L001']);
    expect(services.markdownExport!.failures.get('SYN-L001')).toMatchObject({ code: 'FORBIDDEN' });
  });
  it.each([1, 2, 3, 4, 5, 6, 7])('R2 fence: expiry refuses backup create number %i including the manifest', async boundary => {
    await admitWrite(); const services = mode('db'), folder = new FakePrivateBackupFolder(); services.contentBackup!.folder = folder;
    const previous = (await query("select payload->>'manifestHash' as hash from content_studio_cutover_evidence where name='backup'")).rows[0]!.hash;
    const createOriginal = folder.create.bind(folder);
    const expire = () => query("update content_studio_cutover_state set lease_until=clock_timestamp()-interval '1 second' where name='backup'");
    const create = vi.spyOn(folder, 'create').mockImplementation(async (...args) => {
      const id = await createOriginal(...args);
      if (create.mock.calls.length === boundary - 1) await expire();
      return id;
    });
    const original = ContentShadowStore.prototype.cutoverRpc; let fences = 0;
    vi.spyOn(ContentShadowStore.prototype, 'cutoverRpc').mockImplementation(async function(this: ContentShadowStore, name, params) {
      if (name === 'fence' && params.p_name === 'backup') fences++;
      const result = await original.call(this, name, params);
      if (name === 'snapshot' && boundary === 1) await expire();
      return result;
    });
    await expect(services.liveCutover!.backup()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(create).toHaveBeenCalledTimes(boundary - 1); expect(fences).toBe(boundary);
    expect(services.contentBackup!.journal.lastVerified!.manifestHash).toBe(previous);
  });
  it('R2 no-link: a legacy queued job completes without Drive calls', async () => {
    await admitWrite();
    await query("update content_studio_posts set source_markdown_url='',source_master_file_url='' where library_id='SYN-L002'");
    await query("insert into content_studio_markdown_export(library_id,row_version,expected_body,body) select library_id,row_version,draft_content,draft_content from content_studio_posts where library_id='SYN-L002'");
    const services = mode('db'); vi.mocked(GoogleDriveGateway.prototype.readText).mockClear(); vi.mocked(GoogleDriveGateway.prototype.writeText).mockClear();
    await services.markdownExport!.run();
    expect((await query('select * from content_studio_markdown_export')).rows).toHaveLength(0);
    expect(GoogleDriveGateway.prototype.readText).not.toHaveBeenCalled(); expect(GoogleDriveGateway.prototype.writeText).not.toHaveBeenCalled();
  });
  it('R2 no-link recovery: Restore Drive link clears an edited no-link blocker using an audited CAS patch', async () => {
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true'); const services = mode('db');
    const writer = services.contentCutover!.exporter.db as SupabaseContentDb;
    const linked = await services.repo.getLibrary('SYN-L001'), section = await readSection(services.drive, linked);
    expect(section.ok).toBe(true); if (!section.ok) throw new Error('synthetic section missing');
    await query("update content_studio_posts set source_markdown_url='',source_master_file_url='',source_markdown='',source_master_file='' where library_id='SYN-L001'");
    const body = 'Synthetic retained DB-only recovery body';
    expect(await writer.applyPatch({ operationId: 'synthetic-unlinked-edit', patchHash: hash, actorHash: hash, kind: 'library', id: 'SYN-L001', expectedVersion: '1', data: { draft_content: body } })).toMatchObject({ ok: true });
    const before = await buildReconcileReport(services.repo, services.drive, undefined, { markdownExport: services.markdownExport });
    expect(await services.markdownExport!.status()).toContainEqual(expect.objectContaining({ libraryId: 'SYN-L001', recovery: 'restore_markdown_link' }));
    expect(before.items).toContainEqual(expect.objectContaining({ kind: 'markdown_missing', stableIds: ['SYN-L001'], action: expect.objectContaining({ label: 'Restore Drive link' }) }));
    // A recovered URL is not permission to overwrite a conflicting section.
    const text = safeReplaceSectionBody(section.text, section.section, body)!;
    const link = `https://drive.google.com/file/d/${section.fileId}/view`;
    const recovery = { operationId: 'synthetic-restore-markdown-link', patchHash: hash, actorHash: hash, id: 'SYN-L001', expectedVersion: '2', url: link };
    await expect(writer.restoreMarkdownLink({ ...recovery, url: 'https://unexpected.example/file' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(writer.restoreMarkdownLink({ ...recovery, url: `https://drive.google.com/file/d/${'a'.repeat(201)}/view` })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(writer.restoreMarkdownLink({ ...recovery, id: 'SYN-NOT-FOUND' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await writer.restoreMarkdownLink({ ...recovery, operationId: 'synthetic-stale-link-recovery', expectedVersion: '1' })).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(await writer.restoreMarkdownLink(recovery)).toMatchObject({ ok: true, revision: 3 });
    expect(await writer.restoreMarkdownLink(recovery)).toMatchObject({ ok: true, replayed: true, revision: 3 });
    await expect(writer.restoreMarkdownLink({ ...recovery, operationId: 'synthetic-already-linked', expectedVersion: '3' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(db.asAnon(q => q.query('select content_studio_restore_markdown_link($1,$2,$3,$4,$5,$6)', [recovery.operationId, hash, hash, recovery.id, '3', link]))).rejects.toMatchObject({ code: '42501' });
    vi.mocked(GoogleDriveGateway.prototype.writeText).mockClear();
    await services.markdownExport!.run();
    expect(GoogleDriveGateway.prototype.writeText).not.toHaveBeenCalled();
    expect((await services.drive.readText(section.fileId)).text).toBe(section.text);
    expect(await services.markdownExport!.status()).toContainEqual(expect.objectContaining({ libraryId: 'SYN-L001', reason: 'markdown_mismatch' }));
    // Only the explicit owner restoration supplies the exact body. The next
    // repair acknowledges it without rewriting the file or losing history.
    await services.drive.writeText(section.fileId, text, section.meta.revision);
    await services.markdownExport!.run();
    expect(await services.markdownExport!.status()).not.toContainEqual(expect.objectContaining({ libraryId: 'SYN-L001' }));
    const after = await buildReconcileReport(services.repo, services.drive, undefined, { markdownExport: services.markdownExport });
    expect(after.items.filter(i => i.kind === 'markdown_missing' && i.stableIds.includes('SYN-L001'))).toHaveLength(0);
    expect((await query("select changed_fields from content_studio_row_history where operation_id='synthetic-restore-markdown-link'")).rows).toHaveLength(1);
  });
  it('R2 RPC: the direct RPC write gate refuses a contract mismatch before sending a patch', async () => {
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
    const writer = mode('db').contentCutover!.exporter.db as SupabaseContentDb;
    await query("update content_studio_cutover_authority set contract='schema-2:older-contract'"); transport.mockClear();
    await expect(writer.applyPatch({ operationId: 'synthetic-rpc-blocked', patchHash: hash, actorHash: hash, kind: 'library', id: 'SYN-L001', expectedVersion: '1', data: { current_hook: 'Must refuse' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transport.mock.calls.some(([url]) => String(url).endsWith('/content_studio_apply_patch'))).toBe(false);
  });
  it.each(['apply_patch', 'insert_queue_idea'] as const)('R2 transaction: %s refuses an epoch changed between authorization and the SQL write', async rpc => {
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
    const writer = mode('db').contentCutover!.exporter.db as SupabaseContentDb;
    const original = transport.getMockImplementation()!; let authorized = false, changed = false;
    transport.mockImplementation(async (url, init) => {
      const name = String(url).split('/').at(-1);
      if (name === 'content_studio_cutover_authorize') {
        const result = await original(url, init); expect(result.ok).toBe(true); authorized = true; return result;
      }
      if (name === `content_studio_${rpc}`) {
        expect(authorized).toBe(true);
        // Another transaction commits retirement after authorize returns. The
        // real write RPC now has to recheck under the retirement lock.
        await query("update content_studio_cutover_authority set mode='sheet'"); changed = true;
      }
      return original(url, init);
    });
    const w = { operationId: `synthetic-racing-${rpc}`, patchHash: hash, actorHash: hash, kind: 'library' as const, id: 'SYN-L001', expectedVersion: '1', data: { current_hook: 'Must never commit' } };
    await expect(rpc === 'apply_patch' ? writer.applyPatch(w) : writer.insertQueueIdea({ ...w, kind: 'queue', id: 'SYN-RACE', expectedVersion: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(changed).toBe(true);
    expect((await query('select * from content_studio_operations where operation_id=$1', [w.operationId])).rows).toHaveLength(0);
    expect((await query("select * from content_studio_posts where library_id='SYN-RACE' or current_hook='Must never commit'")).rows).toHaveLength(0);
  });
  it('R2 epoch import: a db-shadow Sheet import cannot overwrite a DB-only save while the epoch is db', async () => {
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
    const dbOnly = 'Synthetic DB-only hook the Sheet never received';
    const services = mode('db'); const row = await services.repo.getLibrary('SYN-L001');
    // Sheet writes fail with 503 for the whole scenario; the DB save is still durable.
    vi.mocked(GoogleSheetTransport.prototype.writeCells).mockRejectedValue(new AppError('PROVIDER_UNAVAILABLE'));
    expect(await services.repo.updateLibrary({ operationId: 'synthetic-db-only-save', actor: { role: 'owner', sub: 'synthetic-owner' }, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { currentHook: dbOnly } })).toMatchObject({ ok: true });
    const hook = async () => (await query("select current_hook from content_studio_posts where library_id='SYN-L001'")).rows[0]!.current_hook;
    expect(await hook()).toBe(dbOnly);
    const counts = async () => (await query('select (select count(*) from content_studio_import_runs)::int as runs, (select count(*) from content_studio_operations)::int as ops')).rows[0];
    const before = await counts();
    // A deployment or env mistake puts the importer back into db-shadow.
    mode('db-shadow');
    await expect(runConfiguredSheetMirror({ kind: 'owner', idempotencyKey: '55555555-5555-4555-8555-555555555555' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await hook()).toBe(dbOnly);
    expect((await query('select mode from content_studio_cutover_authority')).rows[0]).toMatchObject({ mode: 'db' });
    expect(await counts()).toEqual(before);
    // The SQL itself refuses both Sheet-sourced paths, not only the TypeScript guard.
    const e = buildTypedImport(await buildSheetMirrorSnapshot(new SheetsContentRepository(sheet), { sourceKey: 'synthetic_source' }), await importVersions(new SupabaseContentDb(options)), hash);
    await expect(query('select content_studio_import_run($1,$2,$3,$4,$5,$6,$7)', ['synthetic-db-epoch-import', e.snapshotHash, e.actorHash, e.counts, e.hashes, e.exceptions, e.rows])).rejects.toMatchObject({ code: '42501' });
    const version = (await query("select row_version from content_studio_posts where library_id='SYN-L001'")).rows[0]!.row_version;
    await expect(query('select content_studio_write_through($1,$2,$3,$4,$5,$6,$7)', ['synthetic-db-epoch-copy', hash, hash, 'library', 'SYN-L001', version, { current_hook: 'Sheet value' }])).rejects.toMatchObject({ code: '42501' });
    expect(await hook()).toBe(dbOnly);
    expect(await counts()).toEqual(before);
    expect((await query("select * from content_studio_operations where operation_id in ('synthetic-db-epoch-import','synthetic-db-epoch-copy')")).rows).toHaveLength(0);
  });
  it('R2 epoch import: imports before activation, Phase C db-read imports and write-through, and post-retirement reimports still work', async () => {
    // Before any epoch: the beforeEach import already succeeded; a repair import must too.
    await admitRead(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
    expect(await runConfiguredSheetMirror({ kind: 'owner', idempotencyKey: '66666666-6666-4666-8666-666666666666' })).toMatchObject({ status: 'completed' });
    await admitRead();
    await new ContentCutoverStore(options, build).activate('db-read');
    expect((await query('select mode from content_studio_cutover_authority')).rows[0]).toMatchObject({ mode: 'db-read' });
    // Phase C: epoch db-read, Sheet-first save copies through, and a repair import still runs.
    const services = mode('db-read'), first = (await services.repo.listLibrary())[0]!;
    const saved = await services.repo.updateLibrary({ operationId: 'synthetic-db-read-copy', actor: { role: 'owner', sub: 'synthetic-owner' }, target: { libraryId: first.value.libraryId }, expectedRevision: first.revision, patch: { currentHook: 'Synthetic Phase C copied hook' } });
    expect(saved.steps).toContainEqual(expect.objectContaining({ step: 'write_through', status: 'done' }));
    expect(await runConfiguredSheetMirror({ kind: 'owner', idempotencyKey: '77777777-7777-4777-8777-777777777777' })).toMatchObject({ status: 'completed' });
    expect((await query('select current_hook from content_studio_posts where library_id=$1', [first.value.libraryId])).rows[0]).toMatchObject({ current_hook: 'Synthetic Phase C copied hook' });
    // After retirement the Sheet is authoritative again and a reimport is the only way back.
    await query("update content_studio_cutover_authority set mode='sheet'");
    mode('db-shadow');
    expect(await runConfiguredSheetMirror({ kind: 'owner', idempotencyKey: '88888888-8888-4888-8888-888888888888' })).toMatchObject({ status: 'completed' });
  });
  it('R2 parity: inspection reloads a durable conflict into a fresh exporter without claiming or saving', async () => {
    await admitWrite(); const exporter = mode('db').contentCutover!.exporter; await exporter.run();
    sheet.externalEdit(SHEET_TABS.library.name, 2, 2, 'Synthetic external edit'); await exporter.run();
    const fresh = mode('db').contentCutover!.exporter;
    expect(fresh.journal.issues.size).toBe(0); transport.mockClear();
    await fresh.parity();
    expect(fresh.journal.issues.get('library\0SYN-L001')).toMatchObject({ reason: 'export_mismatch' });
    expect(transport.mock.calls.some(([url]) => /cutover_(claim|save)$/.test(String(url)))).toBe(false);
  });
  it('R2 activation: the operation identity binds its build even when an old UUID is replayed', async () => {
    await admitWrite(false); const store = new ContentCutoverStore(options, build);
    await store.operation('activate-db', token, () => store.activate('db'));
    const next = new ContentCutoverStore(options, 'c'.repeat(40)); const run = vi.fn(() => next.activate('db'));
    await expect(next.operation('activate-db', token, run)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(run).not.toHaveBeenCalled();
  });
  it('R2 Markdown completion: recovery drains an existing job during contract mismatch and freeze', async () => {
    await admitWrite(); vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'true');
    const writer = mode('db').contentCutover!.exporter.db as SupabaseContentDb;
    expect(await writer.applyPatch({ operationId: 'synthetic-before-contract-change', patchHash: hash, actorHash: hash, kind: 'library', id: 'SYN-L001', expectedVersion: '1', data: { draft_content: 'Synthetic recovery body' } })).toMatchObject({ ok: true });
    await query("update content_studio_cutover_authority set contract='schema-2:older-contract'");
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'false'); const services = mode('db');
    await services.markdownExport!.run();
    expect((await writer.pendingMarkdownExports()).length).toBe(0);
    expect(GoogleDriveGateway.prototype.writeText).toHaveBeenCalledTimes(1);
  });
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
    expect((await services.markdownExport!.status()).find(job => job.libraryId === 'SYN-L001')?.recovery).toBeUndefined();
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
    expect(report.items).toContainEqual(expect.objectContaining({ kind: 'markdown_missing', severity: 'blocking', action: expect.objectContaining({ label: 'Restore Drive link' }) }));
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

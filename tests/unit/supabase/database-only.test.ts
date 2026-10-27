import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../replies/support/db';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { GoogleSheetTransport } from '@/integrations/google/google-sheet';
import { GoogleDriveGateway } from '@/integrations/google/google-drive';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { buildTypedImport } from '@/application/content-import';
import { buildSheetMirrorSnapshot } from '@/application/sheet-mirror';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache } from '@/lib/env';
import { buildReconcileReport } from '@/application/reconcile';
import { loadBoard } from '@/application/board';
import { loadReviewQueue, parseReviewFilters } from '@/application/review';
import { loadReadyQueue } from '@/application/ready';
import { loadCalendar } from '@/application/schedule';
import { loadBacklogGroups } from '@/application/backlog';
import { libraryBacklogView } from '@/domain/library-backlog';
import { backlogReadiness } from '@/application/backlog-readiness';
import { repairContentExport } from '@/lib/content-maintenance';
import { runConfiguredSheetMirror } from '@/lib/sheet-mirror-operation';
import { ContentWorkerLease } from '@/integrations/supabase/content-worker-lease';
import { requireMutation } from '@/lib/auth';
import { POST as parity } from '@/app/api/ops/sheet-mirror/parity/route';
import { POST as draft } from '@/app/api/library/[libraryId]/draft/route';
import { fingerprint } from '@/domain/hash';
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: '100000000000000000001' } }) }));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), after: vi.fn() }));

let db: TestDatabase, sheet: FakeSheetTransport, transport: ReturnType<typeof vi.fn<typeof fetch>>;
const hash = 'b'.repeat(64), token = '11111111-1111-4111-8111-111111111111';
const options = { url: 'https://synthetic.supabase.co', serviceKey: 'synthetic-only-service-key' };
const env = { CS_DATA_MODE: 'live', CS_CONTENT_STORE: 'db',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com', GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'synthetic-not-a-key',
  CS_SHEET_ID: 'synthetic_workbook_0000000000', GOOGLE_WRITE_ENABLED: 'true', CS_CONTENT_READ_ENABLED: 'true',
  CS_CONTENT_DB_ENABLED: 'true', CS_CONTENT_WRITE_ENABLED: 'true',
  SUPABASE_READ_MODEL_URL: options.url, SUPABASE_READ_MODEL_SERVICE_KEY: options.serviceKey,
  AUTH_SECRET: 'synthetic-secret-for-tests-000000000000', CRON_SECRET: 'synthetic-cron-secret-000000' };
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
  // Seed a historical import before selecting the runtime DB-only mode.
  vi.stubEnv('CS_CONTENT_STORE', 'db-shadow');
  const e = buildTypedImport(await buildSheetMirrorSnapshot(new SheetsContentRepository(sheet), { sourceKey: 'synthetic_source' }), new Map(), hash);
  vi.stubEnv('CS_CONTENT_STORE', 'db'); resetEnvCache();
  e.operationId = 'owner:synthetic_source:22222222-2222-4222-8222-222222222222';
  await query('select content_studio_import_run($1,$2,$3,$4,$5,$6,$7)', [e.operationId, e.snapshotHash, e.actorHash, e.counts, e.hashes, e.exceptions, e.rows]);
  await query("insert into content_studio_shadow_events values($1,clock_timestamp(),'imported',$2)", [token, { snapshotAt: Date.now(), evidence: { snapshotHash: e.snapshotHash, counts: e.counts, hashes: e.hashes, exceptions: e.exceptions } }]);
  vi.spyOn(GoogleSheetTransport.prototype, 'readTab').mockRejectedValue(new Error('Sheet must never run'));
  vi.spyOn(GoogleSheetTransport.prototype, 'writeCells').mockRejectedValue(new Error('Sheet must never run'));
  vi.spyOn(GoogleSheetTransport.prototype, 'appendRow').mockRejectedValue(new Error('Sheet must never run'));
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

it('serves every content collection and reconcile with no Sheet, build, evidence, activation, waiver or source key', async () => {
  const s = getServices();
  expect(s.contentCutover).toBeUndefined(); expect(s.liveCutover).toBeUndefined();
  expect(s.importRepo).toBeUndefined(); expect(s.contentImport).toBeUndefined();
  await Promise.all([loadBoard(s.repo), loadReadyQueue(s.repo), loadCalendar(s.repo), loadBacklogGroups(s.repo), s.repo.queueSummary(), s.repo.workflowSettings()]);
  const report = await buildReconcileReport(s.repo, s.drive, undefined, { markdownExport: s.markdownExport });
  expect(report.unreadable).toEqual([]);
  expect(report.items.some(i => ['content_parity', 'export_parity', 'cutover_blocked'].includes(i.kind))).toBe(false);
  await expect(repairContentExport()).resolves.toEqual({ status: 'database_only' });
  await expect(runConfiguredSheetMirror({ kind: 'scheduled' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(GoogleSheetTransport.prototype.readTab).not.toHaveBeenCalled();
  expect(GoogleSheetTransport.prototype.writeCells).not.toHaveBeenCalled();
  expect(GoogleSheetTransport.prototype.appendRow).not.toHaveBeenCalled();
  expect(transport.mock.calls.some(([url]) => /cutover_(?:gate|authority|evidence|check|recovery)|import_runs|shadow_/.test(String(url)))).toBe(false);
});

it.each(['none', 'read', 'retired'])('keeps SQL CAS, replay, validation, owner auth and audit with %s historical epoch', async epoch => {
  if (epoch !== 'none') await query(`insert into content_studio_cutover_authority(singleton,mode,build,schema_version,contract)
    values(true,$1,$2,2,'obsolete-contract')`, [epoch === 'read' ? 'db-read' : 'sheet', 'a'.repeat(40)]);
  const { repo } = getServices(), row = await repo.getLibrary('SYN-L001');
  const input = { operationId: 'synthetic_db_only_save', actor: { role: 'owner' as const, sub: 'synthetic-owner' }, target: { libraryId: 'SYN-L001' },
    expectedRevision: row.revision, patch: { currentHook: 'Synthetic database-only hook' } };
  expect(await repo.updateLibrary({ ...input, actor: { ...input.actor, role: 'viewer' } })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await repo.updateLibrary({ ...input, patch: { sourceMarkdown: 'invalid source edit' } })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  expect(await repo.updateLibrary(input)).toMatchObject({ ok: true });
  expect(await repo.updateLibrary(input)).toMatchObject({ ok: true, replayed: true });
  expect(await repo.updateLibrary({ ...input, patch: { currentHook: 'Reused operation' } })).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(await repo.updateLibrary({ ...input, operationId: 'synthetic_stale_save', patch: { currentHook: 'Stale changed copy' } })).toMatchObject({ ok: false, code: 'STALE_READ' });
  expect((await query('select * from content_studio_audit_events where operation_id=$1', [input.operationId])).rows).toHaveLength(1);
  expect((await repo.listLibrary()).find(r => r.value.libraryId === 'SYN-L001')?.value.currentHook).toBe(input.patch.currentHook);
});

it('retains an explicit write freeze without a Google write flag', async () => {
  vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'false'); resetEnvCache(); resetServices();
  const { repo } = getServices(), row = await repo.getLibrary('SYN-L001');
  expect(repo.capability().state).toBe('read_only');
  expect(await repo.updateLibrary({ operationId: 'synthetic_frozen_save', actor: { sub: 'synthetic-owner', role: 'owner' },
    target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { currentHook: 'Frozen' } })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
});

function ownerRequest(path: string, body?: object) {
  for (const [key, value] of Object.entries({ AUTH_GOOGLE_ID: 'synthetic-client', AUTH_GOOGLE_SECRET: 'synthetic-google-secret',
    CS_OWNER_GOOGLE_SUB: '100000000000000000001', APP_BASE_URL: 'https://synthetic.example' })) vi.stubEnv(key, value);
  resetEnvCache();
  return new Request(`https://synthetic.example${path}`, { method: 'POST', headers: { origin: 'https://synthetic.example' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}

it('saves through the real authenticated live route with DB enabled alone and refuses legacy parity before any reads', async () => {
  for (const key of ['CS_CONTENT_WRITE_ENABLED', 'CS_CONTENT_READ_ENABLED', 'CS_SHEET_ID', 'CS_COMMIT_SHA', 'CS_CONTENT_BACKUP_FOLDER_ID', 'CS_BACKUP_GATE_WAIVED']) vi.stubEnv(key, undefined);
  resetEnvCache(); resetServices();
  const s = getServices(), row = await s.repo.getLibrary('SYN-L001');
  const result = await draft(ownerRequest('/api/library/SYN-L001/draft', { operationId: 'synthetic_live_route_save',
    expectedSheetRevision: row.revision, expectedSectionHash: fingerprint(row.value.draftContent), proposed: 'Synthetic DB-only API save' }),
    { params: Promise.resolve({ libraryId: 'SYN-L001' }) });
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ ok: true });
  expect((await s.repo.getLibrary('SYN-L001')).value.draftContent).toBe('Synthetic DB-only API save');
  const otherOrigin = ownerRequest('/api/library/SYN-L001/draft'); otherOrigin.headers.set('origin', 'https://other.example');
  await expect(requireMutation(otherOrigin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  vi.stubEnv('SUPABASE_READ_MODEL_MODE', 'shadow'); vi.stubEnv('SUPABASE_READ_MODEL_SOURCE_KEY', 'synthetic_source'); resetEnvCache();
  transport.mockClear();
  expect((await parity(ownerRequest('/api/ops/sheet-mirror/parity'))).status).toBe(403);
  expect(transport).not.toHaveBeenCalled();
  expect(GoogleSheetTransport.prototype.readTab).not.toHaveBeenCalled();
});

it('applies current-schema Schedule CAS and idempotent Replies Queue inserts, with browser-role denial', async () => {
  const { repo } = getServices(), row = (await repo.listSchedule())[0]!;
  expect(await repo.updateSchedule({ operationId: 'synthetic_db_schedule_patch', actor: { sub: 'synthetic-owner', role: 'owner' },
    target: { contentId: row.value.contentId }, expectedRevision: row.revision, patch: { hook: 'Synthetic schedule DB hook' } })).toMatchObject({ ok: true });
  const idea = { operationId: 'synthetic_db_replies_idea', actor: { sub: 'synthetic-owner', role: 'owner' as const }, libraryId: 'SYN-REPLY-001',
    sourcePlatform: 'X' as const, currentHook: 'Synthetic reply idea', draftContent: 'Synthetic explicit reply idea body' };
  expect(await repo.createQueueIdea(idea)).toMatchObject({ ok: true });
  expect(await repo.createQueueIdea(idea)).toMatchObject({ ok: true, replayed: true });
  expect((await repo.listQueue()).filter(r => r.value.libraryId === idea.libraryId)).toHaveLength(1);
  for (const role of ['anon', 'authenticated']) {
    await expect(db.raw.exec(`set role ${role}; select public.content_studio_apply_patch('x','${hash}','${hash}','library','SYN-L001',1,'{"current_hook":"invalid"}');`)).rejects.toMatchObject({ code: '42501' });
    await db.raw.exec('reset role');
  }
});

it('keeps independent Drive workers excluded and token-fenced without gate or epoch evidence', async () => {
  const first = new ContentWorkerLease(options), second = new ContentWorkerLease(options);
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const run = first.run(async () => { await first.fence(); entered(); await hold; });
  await ready;
  await expect(second.run(async () => { throw new Error('must not enter'); })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  release(); await run;
  await expect(first.fence()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await second.run(() => second.fence());
  expect(transport.mock.calls.some(([url]) => /cutover_(?:gate|check|recovery)/.test(String(url)))).toBe(false);
});

it('restores an unlinked Drive destination through the current guarded RPC without activation', async () => {
  await query("update content_studio_posts set source_markdown='',source_markdown_url='',source_master_file='',source_master_file_url='' where collection='library' and library_id='SYN-L001'");
  const row = (await query("select row_version from content_studio_posts where collection='library' and library_id='SYN-L001'")).rows[0]!;
  const restore = (op: string, version: unknown, url: string) => query('select content_studio_restore_markdown_link($1,$2,$3,$4,$5,$6) as result',
    [op, hash, hash, 'SYN-L001', version, url]).then(r => r.rows[0]!.result);
  await expect(restore('synthetic_restore_invalid', row.row_version, 'https://other.example/file')).rejects.toMatchObject({ code: '22023' });
  const url = 'https://drive.google.com/file/d/SYNTH_master_file_00000/view';
  expect(await restore('synthetic_restore_stale', 999, url)).toMatchObject({ ok: false, code: 'STALE_READ' });
  expect(await restore('synthetic_restore_link', row.row_version, url)).toMatchObject({ ok: true });
  expect(await restore('synthetic_restore_link', row.row_version, url)).toMatchObject({ ok: true, replayed: true });
  expect((await query("select * from content_studio_audit_events where operation_id='synthetic_restore_link'")).rows).toHaveLength(1);
});

it('measures warm application paths and coalesces reads without point-read N+1s', async () => {
  const { repo } = getServices();
  const backlog = async () => {
    const [library, ready, schedule] = await Promise.all([repo.listLibrary(), repo.listReadyQueue(), repo.listSchedule()]);
    backlogReadiness(library, ready, schedule);
    libraryBacklogView(library, {});
  };
  const paths = { Backlog: backlog, 'Next up': () => loadBoard(repo), Posts: () => Promise.all([loadReviewQueue(repo, parseReviewFilters({})), repo.queueSummary()]), Calendar: () => loadCalendar(repo) };
  const timings: Record<string, number> = {};
  for (const [name, run] of Object.entries(paths)) {
    await run();
    const start = performance.now();
    for (let i = 0; i < 10; i++) await run();
    timings[name] = (performance.now() - start) / 10;
    expect(timings[name]).toBeLessThan(1_000);
  }
  process.stdout.write(`DB-only PGlite warm application ms: ${JSON.stringify(timings)}\n`);
  const urls = transport.mock.calls.map(([url]) => String(url));
  expect(urls.filter(url => url.includes('/content_studio_schema_version?'))).toHaveLength(1);
  expect(urls.filter(url => url.includes('/content_studio_posts?'))).toHaveLength(1);
  expect(urls.filter(url => url.includes('/content_studio_schedule?'))).toHaveLength(1);
  expect(urls.filter(url => url.includes('/content_studio_workflow_settings?'))).toHaveLength(1);
});

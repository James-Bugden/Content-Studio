import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, expectRejection, sqlState, type TestDatabase } from '../../replies/support/db';

let db: TestDatabase;
let baseline: unknown[];
const catalog = () => db.raw.query("select 'relation' kind,relname name from pg_class where relnamespace='public'::regnamespace union all select 'function',oid::regprocedure::text from pg_proc where pronamespace='public'::regnamespace order by kind,name").then(r => r.rows);
const operation = 'owner:synthetic_source:11111111-1111-4111-8111-111111111111';
const other = 'scheduled:synthetic_source:22222222-2222-4222-8222-222222222222';
const token = '33333333-3333-4333-8333-333333333333', next = '44444444-4444-4444-8444-444444444444';
const hash = 'a'.repeat(64);
const migration = 'supabase/migrations/20261025000500_content_shadow_live.sql';
const query = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.asService(q => q.query<T>(sql, params));
const claim = (op = operation, t = token, h = hash) => query<{ r: { status: string; result?: unknown } }>('select content_studio_shadow_claim($1,$2,$3) as r', [op,h,t]).then(r => r.rows[0]!.r);
const sample = { at: 1000, collection: 'library', idsEqual: true, fields: 100, equal: 100, blocking: 0, lagMs: 100, facts: [] };
beforeAll(async () => {
  db = await createTestDatabase();
  await db.raw.exec(readFileSync('supabase/migrations/20260925030000_sheet_read_model.sql','utf8'));
  baseline = await catalog();
  // This rollback inventory belongs to DB-9; later authority preparation has
  // its own inventory/security tests and must not be dropped by DB-9 rollback.
  for (const file of readdirSync('supabase/migrations').filter(f => /^\d+_content_.*\.sql$/.test(f) && f < '20261025000600').sort()) {
    if (file.endsWith('_content_shadow_live.sql')) await db.raw.exec('alter default privileges in schema public grant all on tables to anon,authenticated;');
    await db.raw.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
},120_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.raw.exec('truncate content_studio_shadow_jobs,content_studio_shadow_lease,content_studio_shadow_events,content_studio_import_runs,content_studio_operations,content_studio_posts,content_studio_schedule,content_studio_workflow_settings,content_studio_audit_events,content_studio_row_history restart identity cascade'); });

describe('DB-9 unapplied migration / actual SQL fencing and durable evidence', () => {
  it('is additive and rerunnable; enables/forces RLS, has zero policies and denies browser roles for every object', async () => {
    const before = (await db.raw.query("select relname from pg_class where relnamespace='public'::regnamespace and relname not like 'content_studio_%' order by relname")).rows;
    await db.raw.exec(readFileSync(migration,'utf8'));
    expect((await db.raw.query("select relname from pg_class where relnamespace='public'::regnamespace and relname not like 'content_studio_%' order by relname")).rows).toEqual(before);
    const tables = ['shadow_jobs','shadow_lease','shadow_events'];
    for (const name of tables) {
      expect((await db.raw.query('select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass',[`content_studio_${name}`])).rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true});
      expect((await db.raw.query('select * from pg_policies where tablename=$1',[`content_studio_${name}`])).rows).toHaveLength(0);
      for (const role of ['anon','authenticated']) for (const verb of ['SELECT','INSERT','UPDATE','DELETE']) {
        expect((await db.raw.query<{ok:boolean}>('select has_table_privilege($1,$2,$3) as ok',[role,`content_studio_${name}`,verb])).rows[0]!.ok).toBe(false);
      }
      for (const run of [db.asAnon,db.asOwner]) expect(sqlState(await expectRejection(run(q => q.query(`select * from content_studio_${name}`))))).toBe('42501');
    }
    const functions = (await db.raw.query<{oid:string;prosecdef:boolean;proconfig:string[]}>('select oid::text,prosecdef,proconfig from pg_proc where proname like $1',['content_studio_shadow_%'])).rows;
    expect(functions).toHaveLength(5);
    for (const f of functions) {
      expect(f.prosecdef).toBe(false); expect(f.proconfig.join()).toContain('search_path=pg_catalog, public');
      for (const role of ['anon','authenticated']) expect((await db.raw.query<{ok:boolean}>('select has_function_privilege($1,$2::oid,$3) as ok',[role,f.oid,'EXECUTE'])).rows[0]!.ok).toBe(false);
    }
    for (const run of [db.asAnon,db.asOwner]) expect(sqlState(await expectRejection(run(q => q.query('select content_studio_shadow_history()'))))).toBe('42501');
  });
  it('single-flights different instances, conflicts on identity reuse, fences expired workers and permits recovery', async () => {
    expect(await claim()).toEqual({status:'acquired'});
    expect(await claim(other,next)).toEqual({status:'in_progress'});
    expect(await claim(operation,next)).toEqual({status:'in_progress'});
    expect(sqlState(await expectRejection(claim(operation,next,'b'.repeat(64))))).toBe('23505');
    await query("update content_studio_shadow_lease set expires_at=clock_timestamp()-interval '1 second'");
    const counts = {library:0,queue:0,schedule:0,workflow_settings:0}, hashes = Object.fromEntries(Object.keys(counts).map(k=>[k,hash]));
    expect(sqlState(await expectRejection(query('select content_studio_shadow_import($1,$2,$3,$4,$5,$6,$7,$8)',[operation,token,hash,hash,counts,hashes,[],[]])))).toBe('42501');
    expect(await claim(other,next)).toEqual({status:'acquired'});
    expect((await query('select kind from content_studio_shadow_events')).rows).toEqual([{kind:'failed'}]);
    expect(sqlState(await expectRejection(query('select content_studio_shadow_import($1,$2,$3,$4,$5,$6,$7,$8)',[operation,token,hash,hash,counts,hashes,[],[]])))).toBe('42501');
    expect((await query('select * from content_studio_import_runs')).rows).toHaveLength(0);
    await query('select content_studio_shadow_release($1,$2)',[operation,token]);
    expect((await query('select token from content_studio_shadow_lease')).rows[0]!.token).toBe(next);
  });
  it('commits import, durable run evidence, replay result and lease release atomically', async () => {
    await claim();
    const counts = {library:0,queue:0,schedule:0,workflow_settings:0}, hashes = Object.fromEntries(Object.keys(counts).map(k=>[k,hash]));
    const args = [operation,token,hash,hash,counts,hashes,[],[]];
    const imported = () => query<{r:{ok:boolean}}>('select content_studio_shadow_import($1,$2,$3,$4,$5,$6,$7,$8) as r', args);
    // Force a late evidence insert failure after the real import RPC.
    await db.raw.exec("create function public.synthetic_shadow_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic'; end $$; create trigger synthetic_shadow_failure before insert on content_studio_shadow_events for each row execute function public.synthetic_shadow_failure();");
    await expect(imported()).rejects.toThrow();
    expect((await query('select * from content_studio_import_runs')).rows).toHaveLength(0);
    expect((await query('select status from content_studio_shadow_jobs')).rows[0]!.status).toBe('running');
    await db.raw.exec('drop trigger synthetic_shadow_failure on content_studio_shadow_events; drop function public.synthetic_shadow_failure()');
    expect((await imported()).rows[0]!.r.ok).toBe(true);
    expect(await claim(operation,next)).toMatchObject({status:'replayed',result:{snapshotHash:hash,counts}});
    expect((await query('select * from content_studio_shadow_lease')).rows).toHaveLength(0);
    const event = (await query<{kind:string;payload:{snapshotAt:number;evidence:unknown}}>('select kind,payload from content_studio_shadow_events')).rows[0]!;
    expect(event.kind).toBe('imported'); expect(event.payload.snapshotAt).toBeGreaterThan(0);
    await query('select content_studio_shadow_release($1,$2)',[operation,token]);
    expect((await query('select * from content_studio_shadow_events')).rows).toHaveLength(1);
  });
  it('persists failed attempts and idempotent samples, detects changed payload conflicts', async () => {
    await claim(); await query('select content_studio_shadow_release($1,$2)',[operation,token]);
    await query('select content_studio_shadow_release($1,$2)',[operation,token]);
    expect((await query('select * from content_studio_shadow_events')).rows).toHaveLength(1);
    const record = (payload: unknown) => query('select content_studio_shadow_sample($1,$2)',[next,payload]);
    await record(sample); await record(sample);
    expect(sqlState(await expectRejection(record({...sample,equal:99})))).toBe('23505');
    expect((await query('select payload from content_studio_shadow_events where event_id=$1',[next])).rows[0]!.payload).toEqual(sample);
    expect(sqlState(await expectRejection(query('select content_studio_shadow_sample($1,$2)',[crypto.randomUUID(),{...sample,equal:101}])))).toBe('22023');
  });
  it('bounds lease lifetime to route maxDuration plus the five-second kill-recovery margin', async () => {
    await claim();
    const seconds = (await query<{ seconds: number }>('select extract(epoch from expires_at-clock_timestamp())::float8 as seconds from content_studio_shadow_lease')).rows[0]!.seconds;
    expect(seconds).toBeGreaterThan(60); expect(seconds).toBeLessThanOrEqual(65);
  });
  it('stale release cannot fail a reclaimed job with the SAME operation identity', async () => {
    await claim(); await query("update content_studio_shadow_lease set expires_at=clock_timestamp()-interval '1 second'");
    await claim(operation, next);
    await query('select content_studio_shadow_release($1,$2)', [operation, token]);
    expect((await query('select status,token from content_studio_shadow_jobs')).rows).toEqual([{ status: 'running', token: next }]);
    expect((await query('select token from content_studio_shadow_lease')).rows).toEqual([{ token: next }]);
  });
  it('import requires the claimed job to still be running even with a valid lease', async () => {
    await claim(); await query("update content_studio_shadow_jobs set status='failed' where operation_id=$1", [operation]);
    const counts = {library:0,queue:0,schedule:0,workflow_settings:0}, hashes = Object.fromEntries(Object.keys(counts).map(k=>[k,hash]));
    await expect(query('select content_studio_shadow_import($1,$2,$3,$4,$5,$6,$7,$8)', [operation,token,hash,hash,counts,hashes,[],[]])).rejects.toThrow();
    expect((await query('select * from content_studio_import_runs')).rows).toHaveLength(0);
  });
  it('measures all imported rows and fields, persists owner waiver audit, and exposes unexpected retained IDs', async () => {
    await claim();
    const counts = {library:1,queue:0,schedule:0,workflow_settings:0}, hashes = Object.fromEntries(Object.keys(counts).map(k=>[k,hash]));
    const rows = [{ target_kind: 'library', target_id: 'SYN-199', expected_version: null, row: { current_hook: 'Synthetic hook', source_sheet_row: 2 } }];
    await query('select content_studio_shadow_import($1,$2,$3,$4,$5,$6,$7,$8,$9)', [operation,token,hash,hash,counts,hashes,[],rows,'2026-10-25']);
    let result = (await claim(operation,next)).result;
    expect(result).toMatchObject({ fullParity: { rows: 1, fields: 2, equal: 2, idsEqual: true, unclassified: 0 }, windowWaiver: { by: 'owner', on: '2026-10-25', recordedAt: expect.any(String) } });
    const imported = (await query<{ payload: { evidence: unknown } }>("select payload from content_studio_shadow_events where kind='imported'")).rows[0]!;
    expect(imported.payload.evidence).toEqual(result);
    await claim(other,next);
    await query('select content_studio_shadow_import($1,$2,$3,$4,$5,$6,$7,$8)', [other,next,hash,hash,{...counts,library:0},hashes,[],[]]);
    result = (await claim(other,token)).result;
    expect(result).toMatchObject({ fullParity: { rows: 0, idsEqual: false }, windowWaiver: null });
  });
  it('detects stored-field changes across the full import instead of trusting submitted counts', async () => {
    await claim();
    // A trigger simulates a storage/projection defect after the importer writes.
    await db.raw.exec("create function public.synthetic_corrupt() returns trigger language plpgsql as $$ begin new.current_hook := 'Synthetic changed'; return new; end $$; create trigger synthetic_corrupt before insert on content_studio_posts for each row execute function public.synthetic_corrupt();");
    try {
      const counts = {library:1,queue:0,schedule:0,workflow_settings:0}, hashes = Object.fromEntries(Object.keys(counts).map(k=>[k,hash]));
      const rows = [{ target_kind: 'library', target_id: 'SYN-199', expected_version: null, row: { current_hook: 'Synthetic original' } }];
      await query('select content_studio_shadow_import($1,$2,$3,$4,$5,$6,$7,$8)', [operation,token,hash,hash,counts,hashes,[],rows]);
      expect((await claim(operation,next)).result).toMatchObject({ fullParity: { rows: 1, fields: 1, equal: 0, idsEqual: true, unclassified: 1 } });
    } finally { await db.raw.exec('drop trigger synthetic_corrupt on content_studio_posts; drop function public.synthetic_corrupt()'); }
  });
  it('subtracts classified source differences but preserves formula-display and blank-boolean equivalences', async () => {
    await claim();
    const counts = {library:1,queue:0,schedule:0,workflow_settings:0}, hashes = Object.fromEntries(Object.keys(counts).map(k=>[k,hash]));
    const rows = [{ target_kind: 'library', target_id: 'SYN-199', expected_version: null,
      row: { hook_score: 1, next_action: 'Synthetic', queue_for_schedule: false, has_image: 'No', content_angle: 2, review_status: 'Approved', current_hook: 'Synthetic' } }];
    const exceptions = [
      { class: 'number_formatting', collection: 'library', field: 'hook_score', hash },
      { class: 'trailing_whitespace', collection: 'library', field: 'next_action', hash },
      { class: 'blank_boolean', collection: 'library', field: 'queue_for_schedule', hash },
      { class: 'formula_display', collection: 'library', field: 'has_image', hash },
    ];
    await query('select content_studio_shadow_import($1,$2,$3,$4,$5,$6,$7,$8)', [operation,token,hash,hash,counts,hashes,exceptions,rows]);
    expect((await claim(operation,next)).result).toMatchObject({ fullParity: { rows: 1, fields: 7, equal: 5, idsEqual: true, unclassified: 0 } });
  });
  it('detects a missing imported ID even when a retained row keeps total counts equal', async () => {
    await claim();
    await db.raw.exec("create function public.synthetic_replace() returns trigger language plpgsql as $$ begin new.library_id := 'SYN-RETAINED'; return new; end $$; create trigger synthetic_replace before insert on content_studio_posts for each row execute function public.synthetic_replace();");
    try {
      const counts = {library:1,queue:0,schedule:0,workflow_settings:0}, hashes = Object.fromEntries(Object.keys(counts).map(k=>[k,hash]));
      const rows = [{ target_kind: 'library', target_id: 'SYN-199', expected_version: null, row: { current_hook: 'Synthetic' } }];
      await query('select content_studio_shadow_import($1,$2,$3,$4,$5,$6,$7,$8)', [operation,token,hash,hash,counts,hashes,[],rows]);
      expect((await query('select count(*)::int as n from content_studio_posts')).rows).toEqual([{ n: 1 }]);
      expect((await claim(operation,next)).result).toMatchObject({ fullParity: { rows: 1, fields: 1, equal: 0, idsEqual: false, unclassified: 1 } });
    } finally { await db.raw.exec('drop trigger synthetic_replace on content_studio_posts; drop function public.synthetic_replace()'); }
  });
  it.each(['2026-10-26', '', 'owner'])('rejects invalid SQL waiver %s before importing or recording evidence', async waiver => {
    await claim();
    const counts = {library:0,queue:0,schedule:0,workflow_settings:0}, hashes = Object.fromEntries(Object.keys(counts).map(k=>[k,hash]));
    expect(sqlState(await expectRejection(query('select content_studio_shadow_import($1,$2,$3,$4,$5,$6,$7,$8,$9)', [operation,token,hash,hash,counts,hashes,[],[],waiver])))).toBe('22023');
    expect((await query('select * from content_studio_import_runs')).rows).toHaveLength(0);
    expect((await query('select * from content_studio_shadow_events')).rows).toHaveLength(0);
    expect((await query('select status from content_studio_shadow_jobs')).rows).toEqual([{ status: 'running' }]);
  });
  it('history excludes old samples but preserves carry-in import/failure and limits the result', async () => {
    const insert = (kind: string, at: string) => query('insert into content_studio_shadow_events(event_id,at,kind,payload) values($1,$2,$3,$4)', [crypto.randomUUID(),at,kind,{}]);
    await insert('sample', '2020-01-01'); await insert('imported', '2020-01-01'); await insert('failed', '2020-01-02'); await insert('failed', '2020-01-03');
    await insert('sample', new Date().toISOString());
    const history = () => query<{ r: {kind:string}[] }>('select content_studio_shadow_history() as r').then(r => r.rows[0]!.r);
    expect((await history()).map(r => r.kind)).toEqual(['imported','failed','sample']);
    await query("insert into content_studio_shadow_events(event_id,kind,payload) select gen_random_uuid(),'sample','{}'::jsonb from generate_series(1,50005)");
    expect(await history()).toHaveLength(50001);
  });
  it('executes the exact documented rollback, preserving legacy mirror and Replies catalogs', async () => {
    const doc = readFileSync('docs/ops/database-shadow-live.md','utf8');
    const sql = [...doc.matchAll(/```sql\r?\n([\s\S]*?)```/g)].at(-1)?.[1];
    expect(sql).toContain('drop table if exists public.content_studio_shadow_jobs');
    await db.raw.exec(sql!);
    expect(await catalog()).toEqual(baseline);
  });
});

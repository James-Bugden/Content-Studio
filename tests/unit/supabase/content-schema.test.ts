import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertContentSchemaVersion, CONTENT_STUDIO_SCHEMA_VERSION } from '@/integrations/supabase/content-schema';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS } from '@/domain/sheet-schema';
import { createTestDatabase, expectRejection, sqlState, type QueryRunner, type TestDatabase } from '../../replies/support/db';

const MIGRATION = '20261024000100_content_authority.sql';
const hash = 'a'.repeat(64);
const actor = 'b'.repeat(64);
const otherHash = 'c'.repeat(64);
let db: TestDatabase;
let repliesBefore: unknown[];
let relationsBefore: string[];
const tables = ['posts', 'schedule', 'workflow_settings', 'operations', 'row_history', 'audit_events', 'schema_version', 'import_runs'];
const views = ['ready_queue', 'queue_summary'];
const sequences = ['row_history_history_id_seq', 'audit_events_event_id_seq'];
const functions = ['mutate', 'apply_patch', 'insert_queue_idea', 'write_through', 'import_run'];
type Result = { ok: boolean; code: string | null; steps: { state: string; reason?: string }[]; revision: number | null };

async function rpc(q: QueryRunner, name: string, params: unknown[]): Promise<Result> {
  const { rows } = await q.query<{ result: Result }>(
    `select public.content_studio_${name}(${params.map((_, i) => `$${i + 1}`).join(',')}) as result`, params,
  );
  return rows[0]!.result;
}
const patch = (op = 'patch-1', data: unknown = { draft_content: 'Synthetic new copy' }, version = 1, patchHash = hash, kind = 'library', id = 'SYN-L001') =>
  db.asService(q => rpc(q, 'apply_patch', [op, patchHash, actor, kind, id, version, data]));
const copy = (op: string, data: unknown, version: number | null = 1, kind = 'library', id = 'SYN-L001') =>
  db.asService(q => rpc(q, 'write_through', [op, hash, actor, kind, id, version, data]));
async function rows(table: string) {
  return (await db.asService(q => q.query(`select * from public.content_studio_${table}`))).rows;
}
async function seed() {
  await db.asService(q => q.query(`insert into public.content_studio_posts
    (collection,library_id,draft_content,sheet_revision) values ('library','SYN-L001','Synthetic original copy','1111111111111111')`));
}
const replyShape = () => db.raw.query(`select c.relname,a.attname,a.atttypid,a.attnotnull,a.attacl,c.relacl,c.relrowsecurity,c.relforcerowsecurity
  from pg_class c join pg_attribute a on a.attrelid=c.oid
  where c.relnamespace='public'::regnamespace and c.relkind='r' and a.attnum>0
    and c.relname not like 'content_studio_%' order by c.relname,a.attnum`).then(r => r.rows);

beforeAll(async () => {
  db = await createTestDatabase();
  repliesBefore = await replyShape();
  // Keep the established Replies harness and its explicit migration inventory
  // unchanged. Apply Content migrations to the SAME database for coexistence.
  for (const file of ['20260925030000_sheet_read_model.sql', MIGRATION]) {
    if (file === MIGRATION) {
      relationsBefore = (await db.raw.query<{ relname: string }>(`select relname from pg_class where relnamespace='public'::regnamespace`)).rows.map(r => r.relname);
    }
    await db.raw.exec(readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8'));
  }
}, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.raw.exec(`truncate ${tables.filter(t => t !== 'schema_version').map(t => `public.content_studio_${t}`).join(',')} restart identity cascade`);
});

describe('MIG-06 typed schema/version contract', () => {
  it('matches the compiled version; refuses missing, malformed and mismatched versions as SCHEMA_DRIFT', async () => {
    const version = (await rows('schema_version'))[0]!.version;
    expect(version).toBe(CONTENT_STUDIO_SCHEMA_VERSION);
    expect(() => assertContentSchemaVersion(version)).not.toThrow();
    for (const actual of [null, undefined, '1', 0, 2, {}, Number.NaN]) {
      expect(() => assertContentSchemaVersion(actual)).toThrowError(expect.objectContaining({ code: 'SCHEMA_DRIFT', details: expect.objectContaining({ kind: 'version' }) }));
    }
    const err = await expectRejection(db.raw.exec('insert into public.content_studio_schema_version (singleton,version) values (false,2)'));
    expect(sqlState(err)).toBe('23514');
    expect(sqlState(await expectRejection(db.raw.exec('insert into public.content_studio_schema_version (version) values (2)')))).toBe('23505');
    await db.raw.exec('update public.content_studio_schema_version set version=2');
    try {
      expect(() => assertContentSchemaVersion(undefined)).toThrowError(expect.objectContaining({ code: 'SCHEMA_DRIFT' }));
      const drift = (await rows('schema_version'))[0]!.version;
      expect(() => assertContentSchemaVersion(drift)).toThrowError(expect.objectContaining({ code: 'SCHEMA_DRIFT' }));
    } finally {
      await db.raw.exec('update public.content_studio_schema_version set version=1');
    }
  });

  it('maps every Sheet field to typed columns, keeps unknown vocabulary and passthrough, and preserves Replies', async () => {
    const snake = (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    for (const [table, headers] of [['posts', LIBRARY_HEADERS], ['schedule', SCHEDULE_HEADERS]] as const) {
      const { rows: columns } = await db.raw.query<{ column_name: string; data_type: string }>(
        'select column_name,data_type from information_schema.columns where table_schema=$1 and table_name=$2', ['public', `content_studio_${table}`]);
      const map = Object.fromEntries(columns.map(c => [c.column_name, c.data_type]));
      for (const name of Object.keys(headers)) expect(map).toHaveProperty(snake(name));
      expect(map.hook_score).toBe('integer');
      expect(map.row_version).toBe('bigint');
      expect(map.passthrough).toBe('jsonb');
    }
    await copy('seed', { review_status: 'Unknown future enum', passthrough: { 'Future field': 'Exact extra text  ' }, hook_score: null }, null);
    expect((await rows('posts'))[0]).toMatchObject({ row_version: 1, review_status: 'Unknown future enum', passthrough: { 'Future field': 'Exact extra text  ' } });
    expect(await replyShape()).toEqual(repliesBefore);
    const { rows: objects } = await db.raw.query<{ relname: string; relkind: string }>(`select relname,relkind from pg_class where relnamespace='public'::regnamespace`);
    const added = objects.filter(r => !relationsBefore.includes(r.relname));
    for (const object of added) expect(object.relname).toMatch(/^content_studio_/);
    expect(added.filter(r => ['r','v','S'].includes(r.relkind)).map(r => r.relname).sort())
      .toEqual([...tables,...views,...sequences].map(t => `content_studio_${t}`).sort());
  });

  it('enforces collection/lineage and stores Typefully timestamp/hash and metrics independently', async () => {
    expect(sqlState(await expectRejection(db.raw.exec(`insert into public.content_studio_posts(collection,library_id) values ('ready','SYN')`)))).toBe('23514');
    await copy('schedule', { final_content: 'Synthetic final', final_synced_at: '2026-10-24T00:00:00Z', final_synced_hash: '1234567890abcdef', views: 1234, posted: true }, null, 'schedule', 'SYN-X');
    expect((await rows('schedule'))[0]).toMatchObject({ final_content: 'Synthetic final', final_synced_hash: '1234567890abcdef', views: 1234, likes: null, posted: true });
    const error = await expectRejection(copy('missing-parent', { parent_content_id: 'SYN-MISSING' }, 1, 'schedule', 'SYN-X'));
    expect(sqlState(error)).toBe('23503');
    expect((await rows('schedule'))[0]!.row_version).toBe(1);
  });

  it('derives Ready Queue and per-source/master Queue Summary without persisting a second authority', async () => {
    await copy('library', { review_status: 'Approved', queue_for_schedule: true }, null);
    await copy('not-ready', { review_status: 'Pending', queue_for_schedule: true }, null, 'library', 'SYN-L002');
    for (const id of ['SYN-Q001','SYN-Q002']) {
      await copy(id, { content_source: 'Synthetic source', source_master_file_url: 'https://example.com/master' }, null, 'queue', id);
    }
    expect(await rows('ready_queue')).toHaveLength(1);
    expect(await rows('queue_summary')).toEqual([{ content_source: 'Synthetic source', master_link: 'https://example.com/master', count: 2 }]);
  });
});

describe('MIG-07 atomic CAS and durable ledger; MIG-08 redaction/history', () => {
  beforeEach(seed);
  it('changes one row, saves the full before-image and a content-free result/audit, then replays exactly', async () => {
    const result = await patch();
    expect(result).toEqual({ ok: true, code: null, steps: [{ state: 'applied' }], revision: 2 });
    expect(await patch()).toEqual(result);
    expect((await rows('posts'))[0]).toMatchObject({ draft_content: 'Synthetic new copy', row_version: 2, updated_by_op: 'patch-1' });
    const history = await rows('row_history');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ before_image: expect.objectContaining({ draft_content: 'Synthetic original copy', row_version: 1 }), row_version_before: 1, changed_fields: ['draft_content'] });
    const audit = await rows('audit_events');
    const ledger = await rows('operations');
    expect(audit).toHaveLength(1);
    expect(ledger).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_hash: actor, before_hash: expect.stringMatching(/^[a-f0-9]{64}$/), after_hash: expect.stringMatching(/^[a-f0-9]{64}$/), outcome: 'applied' });
    expect(audit[0]!.before_hash).not.toEqual(audit[0]!.after_hash);
    expect(JSON.stringify([audit, ledger])).not.toContain('Synthetic');
    expect(Object.keys(ledger[0]!.result as object).sort()).toEqual(['code','ok','revision','steps']);
  });

  it('conflicts on reused operation/hash or target and leaves the original result untouched', async () => {
    const result = await patch();
    expect(await patch('patch-1', { draft_content: 'Other synthetic text' }, 1, otherHash)).toMatchObject({ ok: false, code: 'CONFLICT', steps: [{ reason: 'operation_reused_with_different_patch' }] });
    expect(await patch('patch-1', { draft_content: 'Synthetic new copy' }, 1, hash, 'queue')).toMatchObject({ code: 'CONFLICT' });
    expect((await rows('operations'))[0]!.result).toEqual(result);
    expect(await rows('audit_events')).toHaveLength(1);
  });

  it('refuses stale versions with the current version and accepts a present patch without bump/history', async () => {
    await patch();
    expect(await patch('stale', { draft_content: 'Stale synthetic overwrite' })).toMatchObject({ ok: false, code: 'STALE_READ', steps: [{ state: 'stale' }], revision: 2 });
    expect(await patch('present')).toMatchObject({ ok: true, steps: [{ state: 'already_applied' }], revision: 2 });
    expect((await rows('posts'))[0]!.draft_content).toBe('Synthetic new copy');
    expect(await rows('row_history')).toHaveLength(1);
    expect(await rows('operations')).toHaveLength(3);
  });

  it('returns not_found, and does not treat a missing version as permission to insert via patch', async () => {
    expect(await patch('missing', { draft_content: 'Synthetic' }, 1, hash, 'library', 'SYN-NONE')).toMatchObject({ ok: false, code: 'NOT_FOUND', revision: null });
    expect(await rows('posts')).toHaveLength(1);
  });

  it.each(['history','audit','ledger'])('rolls back CAS and all partial rows when the %s write fails', async (stage) => {
    const table = { history: 'row_history', audit: 'audit_events', ledger: 'operations' }[stage]!;
    await db.raw.exec(`alter table public.content_studio_${table} add constraint content_studio_test_failure check (operation_id <> 'forced-fail')`);
    try {
      const error = await expectRejection(patch('forced-fail'));
      expect(sqlState(error)).toBe('23514');
      expect((await rows('posts'))[0]).toMatchObject({ draft_content: 'Synthetic original copy', row_version: 1, updated_by_op: null });
      for (const name of ['row_history','audit_events','operations']) expect(await rows(name)).toHaveLength(0);
    } finally {
      await db.raw.exec(`alter table public.content_studio_${table} drop constraint content_studio_test_failure`);
    }
    expect(await patch('forced-fail')).toMatchObject({ ok: true, revision: 2 });
  });

  it('serializes concurrent same-operation deliveries and competing versions', async () => {
    // PGlite serializes connection transactions; these prove real ledger/CAS
    // behavior for competing deliveries, not a multi-backend lock schedule.
    const duplicates = await Promise.all([patch(), patch()]);
    expect(duplicates[0]).toEqual(duplicates[1]);
    const competitors = await Promise.all([
      patch('writer-a', { draft_content: 'Writer A' }, 2),
      patch('writer-b', { draft_content: 'Writer B' }, 2),
    ]);
    expect(competitors.map(r => r.steps[0]!.state).sort()).toEqual(['applied','stale']);
    expect((await rows('posts'))[0]!.row_version).toBe(3);
    expect(await rows('row_history')).toHaveLength(2);
  });

  it.each([
    { row_version: 99 }, { library_id: 'SYN-OTHER' }, { collection: 'queue' },
    { created_at: '2026-10-01' }, { updated_by_op: 'other' }, { sheet_revision: 'other' },
    { draft_content: null }, { hook_score: 'invalid integer' }, { imaginary_column: 'x' },
    { source_platform: 'X' }, { draft_content: 'x'.repeat(50001) },
  ])('rejects invalid/protected patch fields %j', async data => {
    await expect(patch('invalid', data)).rejects.toThrow();
    expect((await rows('posts'))[0]!.row_version).toBe(1);
    expect(await rows('operations')).toHaveLength(0);
  });
});

describe('queue insertion, write-through and atomic typed import', () => {
  it('inserts queue ideas idempotently, records an insert history, and never replaces a colliding ID', async () => {
    const insert = (op = 'queue', patchHash = hash, data: unknown = { draft_content: 'Synthetic idea' }) =>
      db.asService(q => rpc(q, 'insert_queue_idea', [op, patchHash, actor, 'SYN-Q001', data]));
    const result = await insert();
    expect(result).toMatchObject({ ok: true, revision: 1 });
    expect(await insert()).toEqual(result);
    expect((await rows('row_history'))[0]).toMatchObject({ before_image: null, row_version_before: null });
    expect(await insert('queue-other', otherHash, { draft_content: 'Replacement' })).toMatchObject({ code: 'CONFLICT' });
    expect((await rows('posts'))[0]!.draft_content).toBe('Synthetic idea');
  });

  it('write-through keeps exact text/links/passthrough; identical copies preserve versions; stale copies lose', async () => {
    const data = { draft_content: '  Synthetic \n exact copy  ', source_markdown_url: 'https://example.com/source', passthrough: { 'Extra': 'Kept' }, sheet_revision: '1111111111111111', source_sheet_row: 2 };
    expect(await copy('copy-insert', data, null)).toMatchObject({ ok: true, revision: 1 });
    expect(await copy('copy-identical', data)).toMatchObject({ steps: [{ state: 'already_applied' }], revision: 1 });
    expect(await copy('copy-change', { ...data, draft_content: 'Changed synthetic copy', sheet_revision: '2222222222222222' })).toMatchObject({ revision: 2 });
    expect(await copy('copy-stale', data)).toMatchObject({ code: 'STALE_READ', revision: 2 });
    expect((await rows('posts'))[0]).toMatchObject({ passthrough: { Extra: 'Kept' }, sheet_revision: '2222222222222222' });
  });

  it('updates Sheet fingerprint/position metadata without invalidating an editor of identical content', async () => {
    await seed();
    expect(await copy('metadata', { sheet_revision: '2222222222222222', source_sheet_row: 5 })).toMatchObject({ ok: true, revision: 1 });
    expect((await rows('posts'))[0]).toMatchObject({ row_version: 1, sheet_revision: '2222222222222222', source_sheet_row: 5 });
    expect(await patch('editor-open-before-copy')).toMatchObject({ ok: true, revision: 2 });
  });

  const item = (id: string, row: unknown, version: number | null = null, kind = 'library') => ({ target_kind: kind, target_id: id, expected_version: version, row });
  const batch = (items: unknown[], op = 'import', exceptions: unknown[] = [], patchHash = hash) => {
    const counts = { library: 0, queue: 0, schedule: 0, workflow_settings: 0 };
    for (const row of items as { target_kind: keyof typeof counts }[]) counts[row.target_kind]++;
    const hashes = Object.fromEntries(Object.keys(counts).map(k => [k, hash]));
    return db.asService(q => rpc(q, 'import_run', [op, patchHash, actor, counts, hashes, exceptions, items]));
  };

  it('imports all typed collections atomically, supports child-before-parent and records redacted run evidence', async () => {
    const items = [item('SYN-L001', { draft_content: 'Synthetic imported' }),
      item('SYN-Q001', { content_source: 'Synthetic' }, null, 'queue'),
      item('SYN-CHILD', { parent_content_id: 'SYN-PARENT' }, null, 'schedule'),
      item('SYN-PARENT', { content: 'Synthetic schedule' }, null, 'schedule'),
      item('Synthetic setting', { value: 'Synthetic value', notes: 'Synthetic note' }, null, 'workflow_settings')];
    const exceptions = [{ class: 'trailing_whitespace', collection: 'library', field: 'draft_content', hash }];
    const result = await batch(items, 'import', exceptions);
    expect(result).toMatchObject({ ok: true });
    expect(await batch(items, 'import', exceptions)).toEqual(result);
    expect(await batch(items, 'import', exceptions, otherHash)).toMatchObject({ code: 'CONFLICT' });
    expect(await rows('row_history')).toHaveLength(5);
    expect(await rows('operations')).toHaveLength(1);
    for (const history of await rows('row_history')) expect(history.operation_id).toBe('import');
    expect((await rows('import_runs'))[0]).toMatchObject({ counts: { library: 1, queue: 1, schedule: 2, workflow_settings: 1 }, snapshot_hash: hash, exceptions });
    // A new identical run produces ledger evidence without invalidating editors.
    await batch(items, 'import-identical');
    expect(await rows('row_history')).toHaveLength(5);
    expect((await rows('posts'))[0]!.row_version).toBe(1);
  });

  it('rolls back earlier rows/history/ledger on a later invalid row or stale precondition', async () => {
    await seed();
    await expect(batch([item('SYN-NEW', { draft_content: 'Synthetic' }), item('SYN-L001', { draft_content: 'Stale copy' }, 9)])).rejects.toThrow('import row conflict');
    expect(await rows('posts')).toHaveLength(1);
    for (const table of ['operations','audit_events','row_history','import_runs']) expect(await rows(table)).toHaveLength(0);
    await expect(batch([item('SYN-NEW', { draft_content: 'Synthetic' }), item('SYN-BAD', { hook_score: 'bad' })])).rejects.toThrow();
    expect(await rows('posts')).toHaveLength(1);
    expect(await rows('operations')).toHaveLength(0);
  });

  it('rejects duplicates, unclassified exceptions and wrong counts before any row is written', async () => {
    const one = item('SYN-L001', { draft_content: 'Synthetic' });
    await expect(batch([one, one])).rejects.toThrow('duplicate');
    await expect(batch([one], 'exception', [{ class: 'unclassified' }])).rejects.toThrow('unclassified');
    await expect(db.asService(q => rpc(q, 'import_run', ['counts', hash, actor, { library: 0, queue: 0, schedule: 0, workflow_settings: 0 }, { library: hash, queue: hash, schedule: hash, workflow_settings: hash }, [], [one]]))).rejects.toThrow('count/hash mismatch');
    expect(await rows('posts')).toHaveLength(0);
  });
});

describe('MIG-04 every new object is server-only', () => {
  it('forces RLS with zero policies; views are invokers and every function pins search_path', async () => {
    const { rows: security } = await db.raw.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`select relname,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relname=any($1)`, [tables.map(t => `content_studio_${t}`)]);
    expect(security).toHaveLength(tables.length);
    for (const row of security) expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await db.raw.query(`select * from pg_policies where schemaname='public' and tablename=any($1)`, [tables.map(t => `content_studio_${t}`)])).rows).toHaveLength(0);
    const { rows: routines } = await db.raw.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>(`select proname,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname=any($1)`, [functions.map(f => `content_studio_${f}`)]);
    expect(routines).toHaveLength(functions.length);
    for (const f of routines) expect(f).toMatchObject({ prosecdef: false, proconfig: ['search_path=pg_catalog, public, pg_temp'] });
    const { rows: viewOptions } = await db.raw.query<{ reloptions: string[] }>(`select reloptions from pg_class where relname=any($1)`, [views.map(t => `content_studio_${t}`)]);
    for (const v of viewOptions) expect(v.reloptions).toContain('security_invoker=true');
  });

  it('RLS still denies rows if a table SELECT grant is accidentally added', async () => {
    await seed();
    await db.raw.exec('grant select on public.content_studio_posts to authenticated');
    try {
      expect((await db.asOwner(q => q.query('select * from public.content_studio_posts'))).rows).toHaveLength(0);
    } finally {
      await db.raw.exec('revoke select on public.content_studio_posts from authenticated');
    }
    expect(await rows('posts')).toHaveLength(1);
  });

  for (const role of ['anon', 'authenticated'] as const) {
    const asRole = <T>(fn: (q: QueryRunner) => Promise<T>) => role === 'anon' ? db.asAnon(fn) : db.asOwner(fn);
    it(`${role} cannot select/modify tables or views, use sequences, execute any RPC, or see them in information_schema`, async () => {
      await seed();
      const relations = [...tables,...views].map(t => `content_studio_${t}`);
      for (const name of relations) {
        expect(sqlState(await expectRejection(asRole(q => q.query(`select * from public.${name}`))))).toBe('42501');
        if (tables.map(t => `content_studio_${t}`).includes(name)) {
          expect(sqlState(await expectRejection(asRole(q => q.query(`delete from public.${name}`))))).toBe('42501');
        }
      }
      for (const name of sequences) expect(sqlState(await expectRejection(asRole(q => q.query(`select nextval('public.content_studio_${name}')`))))).toBe('42501');
      const calls: [string, unknown[]][] = [
        ['apply_patch', ['denied',hash,actor,'library','SYN-L001',1,{ draft_content: 'Denied' }]],
        ['insert_queue_idea', ['denied',hash,actor,'SYN-Q001',{ draft_content: 'Denied' }]],
        ['write_through', ['denied',hash,actor,'library','SYN-L001',1,{ draft_content: 'Denied' }]],
        ['import_run', ['denied',hash,actor,{}, {}, [], []]],
        ['mutate', ['patch','denied',hash,actor,'library','SYN-L001',1,{ draft_content: 'Denied' }]],
      ];
      for (const [name, params] of calls) expect(sqlState(await expectRejection(asRole(q => rpc(q, name, params))))).toBe('42501');
      await asRole(async q => {
        expect((await q.query(`select table_name from information_schema.tables where table_schema='public' and table_name=any($1)`, [relations])).rows).toHaveLength(0);
        expect((await q.query(`select routine_name from information_schema.routines where routine_schema='public' and routine_name=any($1)`, [functions.map(f => `content_studio_${f}`)])).rows).toHaveLength(0);
        const functionPrivileges = await q.query<{ allowed: boolean }>(`select has_function_privilege(current_user,p.oid,'EXECUTE') as allowed
          from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=any($1)`, [functions.map(f => `content_studio_${f}`)]);
        expect(functionPrivileges.rows).toHaveLength(functions.length);
        for (const p of functionPrivileges.rows) expect(p.allowed).toBe(false);
        const privileges = await q.query<{ allowed: boolean }>(`select has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as allowed
          from pg_class c where c.relnamespace='public'::regnamespace and c.relname=any($1)`, [relations]);
        expect(privileges.rows).toHaveLength(relations.length);
        for (const p of privileges.rows) expect(p.allowed).toBe(false);
      });
      expect((await rows('posts'))[0]!.draft_content).toBe('Synthetic original copy');
      expect(await rows('operations')).toHaveLength(0);
    });
  }
});

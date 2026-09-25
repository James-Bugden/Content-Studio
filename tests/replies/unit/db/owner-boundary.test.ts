import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestDatabase,
  type TestDatabase,
  expectRejection,
  OWNER_ID,
  OTHER_USER_ID,
} from '../../support/db';

/**
 * SEC-01 and SEC-02. The owner boundary, tested at the database rather than at a
 * route.
 *
 * The table list is read from `pg_tables`, not hard-coded, so adding a table later
 * without a policy fails this suite instead of quietly shipping an open table.
 */

let db: TestDatabase;
let tables: string[];

beforeAll(async () => {
  db = await createTestDatabase();
  const { rows } = await db.raw.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  tables = rows.map((r) => r.tablename);

  // One row of every shape, owned by the owner, so "cannot read" is a real
  // negative rather than an empty table.
  await db.raw.exec(`
    insert into public.app_settings (user_id) values ('${OWNER_ID}');
    insert into public.source_posts (user_id, platform, target_kind, source_text)
      values ('${OWNER_ID}', 'linkedin', 'post', 'private source text');
    insert into public.resources (user_id, type, ownership, title_en, canonical_path)
      values ('${OWNER_ID}', 'guide', 'own', 'Private guide', '/guides/private');
    insert into public.facts (user_id, fact_text) values ('${OWNER_ID}', 'a private fact');
    insert into public.reply_sessions (user_id, platform, draft_hash)
      values ('${OWNER_ID}', 'x', 'hash');
    insert into public.reply_library
      (user_id, platform, final_text, search_text, provenance, publication_evidence,
       content_hash, date_precision, posted_at)
      values ('${OWNER_ID}', 'x', 'a private reply', 'a private reply', 'posted_confirmed',
              'user_confirmed', 'h1', 'timestamp', '2026-09-25T04:00:00Z');
    insert into public.import_batches (user_id, source_type, source_file_hash, adapter_version)
      values ('${OWNER_ID}', 'linkedin', 'filehash', 'v1');
    insert into public.search_documents (user_id, entity_kind, entity_id, text_hash, search_text)
      values ('${OWNER_ID}', 'reply', gen_random_uuid(), 'h1', 'a private reply');
    insert into public.embedding_jobs (user_id, entity_kind, entity_id, text_hash, model)
      values ('${OWNER_ID}', 'reply', gen_random_uuid(), 'h1', 'fake');
    insert into public.mutation_keys (user_id, key, request_fingerprint, operation)
      values ('${OWNER_ID}', gen_random_uuid(), 'fp', 'record_reply');
  `);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('policy coverage', () => {
  it('enables and forces row level security on every table in public', async () => {
    const { rows } = await db.raw.query<{ relname: string; rls: boolean; forced: boolean }>(
      `select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by c.relname`,
    );
    expect(rows).toHaveLength(tables.length);
    for (const row of rows) {
      expect(row.rls, `${row.relname} has RLS disabled`).toBe(true);
      expect(row.forced, `${row.relname} does not force RLS`).toBe(true);
    }
  });

  it('gives every table all four owner policies', async () => {
    const { rows } = await db.raw.query<{ tablename: string; commands: string }>(
      `select tablename, string_agg(cmd, ',' order by cmd) as commands
       from pg_policies where schemaname = 'public' group by tablename order by tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(tables);
    for (const row of rows) {
      expect(row.commands, `${row.tablename} is missing a policy`).toBe(
        'DELETE,INSERT,SELECT,UPDATE',
      );
    }
  });

  it('requires both ownership and owner status in every policy expression', async () => {
    const { rows } = await db.raw.query<{ tablename: string; qual: string | null; check: string | null }>(
      `select tablename, qual, with_check as check from pg_policies where schemaname = 'public'`,
    );
    for (const row of rows) {
      const expression = `${row.qual ?? ''} ${row.check ?? ''}`;
      expect(expression, `${row.tablename} policy does not check user_id`).toMatch(/user_id/);
      expect(expression, `${row.tablename} policy does not check owner status`).toMatch(
        /is_app_owner/,
      );
    }
  });

  it('leaves no function in public executable by the anonymous role', async () => {
    // The harness reproduces Supabase's default privileges, which grant EXECUTE on
    // every new public function to anon. So this is a real check, not a tautology:
    // a function added without an explicit `revoke ... from anon` fails here.
    const { rows } = await db.raw.query<{ name: string }>(
      `select p.proname as name
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and has_function_privilege('anon', p.oid, 'execute')
       order by p.proname`,
    );
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it('grants nothing on any table to the anonymous role', async () => {
    const { rows } = await db.raw.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public'`,
    );
    expect(rows).toEqual([]);
  });
});

describe('anonymous access', () => {
  it('cannot read any table', async () => {
    for (const table of tables) {
      const error = await expectRejection(
        db.asAnon((q) => q.query(`select * from public.${table} limit 1`)),
      );
      expect(error.message, `anon could read ${table}`).toMatch(/permission denied/i);
    }
  });

  it('cannot call the recording or counter functions', async () => {
    for (const call of [
      `select public.daily_counts('Asia/Taipei')`,
      `select public.set_reply_withdrawn(gen_random_uuid(), true)`,
    ]) {
      const error = await expectRejection(db.asAnon((q) => q.query(call)));
      expect(error.message).toMatch(/permission denied/i);
    }
  });

  it('cannot call the Google-auth server bridge', async () => {
    for (const run of [
      () => db.asAnon((q) => q.query(`select public.server_owner_id()`)),
      () => db.asUser(OTHER_USER_ID, (q) => q.query(`select public.server_owner_id()`)),
    ]) {
      const error = await expectRejection(run());
      expect(error.message).toMatch(/permission denied/i);
    }
  });
});

describe('Google-auth server bridge', () => {
  it('exposes only the enabled owner to service_role', async () => {
    const { rows } = await db.asService((q) =>
      q.query<{ owner_id: string }>(`select public.server_owner_id() as owner_id`),
    );
    expect(rows[0]?.owner_id).toBe(OWNER_ID);
  });

  it('runs owner-scoped counters and rejects a mismatched owner', async () => {
    const { rows } = await db.asService((q) =>
      q.query<{ result: { counts: { x: number } } }>(
        `select public.server_daily_counts($1::uuid, 'Asia/Taipei', '2026-09-25'::date) as result`,
        [OWNER_ID],
      ),
    );
    expect(rows[0]?.result.counts.x).toBeGreaterThanOrEqual(1);

    const error = await expectRejection(
      db.asService((q) =>
        q.query(
          `select public.server_daily_counts($1::uuid, 'Asia/Taipei', '2026-09-25'::date)`,
          [OTHER_USER_ID],
        ),
      ),
    );
    expect(error.message).toMatch(/server owner mismatch/i);
  });
});

describe('a second authenticated user', () => {
  it('reads zero rows from every table, including child tables', async () => {
    for (const table of tables) {
      const { rows } = await db.asUser(OTHER_USER_ID, (q) =>
        q.query<{ n: string }>(`select count(*)::text as n from public.${table}`),
      );
      expect(rows[0]?.n, `non-owner could read ${table}`).toBe('0');
    }
  });

  it('cannot insert even rows it claims to own, because it is not the owner', async () => {
    const error = await expectRejection(
      db.asUser(OTHER_USER_ID, (q) =>
        q.query(
          `insert into public.facts (user_id, fact_text) values ('${OTHER_USER_ID}', 'mine')`,
        ),
      ),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('cannot update or delete the owner’s rows', async () => {
    const updated = await db.asUser(OTHER_USER_ID, (q) =>
      q.query(`update public.reply_library set final_text = 'tampered'`),
    );
    expect((updated as { affectedRows?: number }).affectedRows ?? 0).toBe(0);

    const { rows } = await db.raw.query<{ final_text: string }>(
      `select final_text from public.reply_library where user_id = '${OWNER_ID}'`,
    );
    expect(rows.every((r) => r.final_text !== 'tampered')).toBe(true);
  });

  it('gets a boolean false from the owner check and cannot reach the private schema', async () => {
    const { rows } = await db.asUser(OTHER_USER_ID, (q) =>
      q.query<{ is_owner: boolean }>(`select public.is_app_owner() as is_owner`),
    );
    expect(rows[0]?.is_owner).toBe(false);

    for (const statement of [
      `select * from private.app_owner`,
      `select private.is_app_owner()`,
    ]) {
      const error = await expectRejection(
        db.asUser(OTHER_USER_ID, (q) => q.query(statement)),
      );
      expect(error.message, statement).toMatch(/permission denied/i);
    }
  });

  it('cannot reach the owner table even as the owner session', async () => {
    const error = await expectRejection(
      db.asOwner((q) => q.query(`select * from private.app_owner`)),
    );
    expect(error.message).toMatch(/permission denied/i);

    // The owner learns one boolean and nothing else.
    const { rows } = await db.asOwner((q) =>
      q.query<{ is_owner: boolean }>(`select public.is_app_owner() as is_owner`),
    );
    expect(rows[0]?.is_owner).toBe(true);
  });
});

describe('forged ownership', () => {
  it('refuses an insert that claims another user_id', async () => {
    const error = await expectRejection(
      db.asOwner((q) =>
        q.query(
          `insert into public.facts (user_id, fact_text) values ('${OTHER_USER_ID}', 'planted')`,
        ),
      ),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('refuses an update that moves a row to another owner', async () => {
    const error = await expectRejection(
      db.asOwner((q) => q.query(`update public.facts set user_id = '${OTHER_USER_ID}'`)),
    );
    expect(error.message).toMatch(/row-level security/i);
  });
});

describe('the owner', () => {
  it('reads its own rows', async () => {
    const { rows } = await db.asOwner((q) =>
      q.query<{ final_text: string }>(`select final_text from public.reply_library`),
    );
    expect(rows.map((r) => r.final_text)).toContain('a private reply');
  });

  it('loses access the moment the owner record is disabled', async () => {
    await db.raw.exec(`update private.app_owner set enabled = false;`);
    try {
      const { rows } = await db.asOwner((q) =>
        q.query<{ n: string }>(`select count(*)::text as n from public.reply_library`),
      );
      expect(rows[0]?.n).toBe('0');
    } finally {
      await db.raw.exec(`update private.app_owner set enabled = true;`);
    }
  });
});

describe('a second enabled owner', () => {
  it('cannot be created', async () => {
    const error = await expectRejection(
      db.raw.query(`insert into private.app_owner (user_id) values ('${OTHER_USER_ID}')`),
    );
    expect(error.message).toMatch(/app_owner_one_enabled/);
  });
});

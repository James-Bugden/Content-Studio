import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Local database verification harness (DATA-01, SEC-01, SEC-02).
 *
 * PGlite is real Postgres, so constraints, triggers, policies, transactions and
 * plpgsql behave as they do in production. What it is not is *hosted Supabase*:
 * it has no GoTrue, no PostgREST and no pgvector in this build. So the harness
 * supplies the two things the migrations depend on — an `auth` schema with
 * `auth.uid()`, and the `anon` / `authenticated` roles — and skips any migration
 * that declares an extension this build lacks.
 *
 * The shim is small on purpose. Every line of it is a thing hosted Supabase also
 * provides; nothing here relaxes a policy or invents a permission. Migrations that
 * pass here are still re-verified against the hosted project before release.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const REQUIRES_EXTENSION = /^--\s*requires-extension:\s*(\S+)/m;

/** Extensions this local build can actually create. */
const AVAILABLE_EXTENSIONS = new Set(['pg_trgm', 'unaccent', 'pgcrypto', 'uuid-ossp']);

export const OWNER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';

export interface QueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

export interface TestDatabase {
  /** Superuser access. Use only to set up fixtures, never to assert a permission. */
  raw: PGlite;
  /** Migration files that were applied, in order. */
  applied: string[];
  /** Migration files that were skipped, with the reason. */
  skipped: { file: string; reason: string }[];
  /** Runs `fn` inside a transaction as the enabled owner. */
  asOwner<T>(fn: (q: QueryRunner) => Promise<T>): Promise<T>;
  /** Runs `fn` inside a transaction as a second, non-owner authenticated user. */
  asUser<T>(userId: string, fn: (q: QueryRunner) => Promise<T>): Promise<T>;
  /** Runs `fn` inside a transaction as the anonymous API role. */
  asAnon<T>(fn: (q: QueryRunner) => Promise<T>): Promise<T>;
  /** Runs `fn` as the server-only Supabase role used after Google owner auth. */
  asService<T>(fn: (q: QueryRunner) => Promise<T>): Promise<T>;
  /**
   * Empties every owned table. Creating a PGlite instance costs a few seconds, so
   * a suite shares one database and resets between cases instead.
   */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Everything hosted Supabase would already have. Written out rather than mocked so
 * that a reader can check it grants nothing the real platform does not.
 */
const AUTH_SHIM = `
  create schema if not exists auth;

  create table if not exists auth.users (
    id uuid primary key,
    email text,
    created_at timestamptz not null default now()
  );

  -- Mirrors Supabase's implementation: the subject claim of the verified JWT.
  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $shim$
    select nullif(
      coalesce(
        current_setting('request.jwt.claim.sub', true),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      ),
      ''
    )::uuid;
  $shim$;

  do $roles$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin noinherit bypassrls;
    end if;
  end;
  $roles$;

  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant select on auth.users to authenticated;

  -- Supabase's own default privileges, reproduced deliberately.
  --
  -- On a hosted project, every function created in \`public\` is granted EXECUTE to
  -- anon and authenticated automatically. Without this line the local harness is
  -- more permissive-looking than production in the one direction that matters:
  -- a \`revoke ... from public\` looks sufficient here while leaving the function
  -- callable by anon there. Found by running the hosted security advisor against
  -- a schema whose local tests were green.
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter(
      (f) =>
        (f.startsWith('2026092200') || f.includes('google_auth_service_rpcs')) &&
        f.endsWith('.sql'),
    )
    .sort();
}

export async function createTestDatabase(
  options: { seedOwner?: boolean } = {},
): Promise<TestDatabase> {
  const { seedOwner = true } = options;

  const pg = await PGlite.create({ extensions: { pg_trgm } });

  await pg.exec(AUTH_SHIM);
  await pg.exec(
    `insert into auth.users (id, email) values
       ('${OWNER_ID}', 'owner@example.com'),
       ('${OTHER_USER_ID}', 'intruder@example.com')
     on conflict (id) do nothing;`,
  );

  const applied: string[] = [];
  const skipped: { file: string; reason: string }[] = [];

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const required = REQUIRES_EXTENSION.exec(sql)?.[1];
    if (required && !AVAILABLE_EXTENSIONS.has(required)) {
      skipped.push({ file, reason: `requires the ${required} extension` });
      continue;
    }
    try {
      await pg.exec(sql);
    } catch (error) {
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    }
    applied.push(file);
  }

  if (seedOwner) {
    await pg.exec(`insert into private.app_owner (user_id) values ('${OWNER_ID}');`);
  }

  async function asRole<T>(
    role: 'anon' | 'authenticated' | 'service_role',
    userId: string | null,
    fn: (q: QueryRunner) => Promise<T>,
  ): Promise<T> {
    return pg.transaction(async (tx) => {
      const claims = userId ? JSON.stringify({ sub: userId, role }) : JSON.stringify({ role });
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
      await tx.exec(`set local role ${role}`);
      const runner: QueryRunner = {
        query: (sql, params) =>
          tx.query(sql, params as unknown[]) as Promise<{ rows: never[] }>,
        exec: (sql) => tx.exec(sql),
      };
      return fn(runner as QueryRunner);
    }) as Promise<T>;
  }

  async function reset(): Promise<void> {
    const { rows } = await pg.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public'`,
    );
    if (rows.length === 0) return;
    const list = rows.map((r) => `public."${r.tablename}"`).join(', ');
    await pg.exec(`truncate table ${list} restart identity cascade;`);
  }

  return {
    raw: pg,
    applied,
    skipped,
    reset,
    asOwner: (fn) => asRole('authenticated', OWNER_ID, fn),
    asUser: (userId, fn) => asRole('authenticated', userId, fn),
    asAnon: (fn) => asRole('anon', null, fn),
    asService: (fn) => asRole('service_role', null, fn),
    close: () => pg.close(),
  };
}

/**
 * Asserts that a query fails, and returns the error. Used instead of a bare
 * `rejects.toThrow()` so a test can check the SQLSTATE rather than the message.
 */
export async function expectRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the query to be rejected, but it succeeded');
}

export function sqlState(error: Error): string | undefined {
  return (error as Error & { code?: string }).code;
}

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDatabase, OTHER_USER_ID, type TestDatabase } from '../../support/db';
import { planVersionedUpdate } from '@/replies/lib/resources/repository';
import { isInsertable } from '@/replies/lib/resources/eligibility';
import type { Platform } from '@/replies/lib/contracts/vocabulary';

/**
 * RES-01/RES-02/SEC-02. Two kinds of coverage, kept deliberately separate.
 *
 * `repository.ts` is written against `@supabase/supabase-js`, a PostgREST-over-
 * HTTP client. PGlite is a real Postgres, but it has no PostgREST server in
 * front of it, so there is no practical way to point a genuine `supabase-js`
 * client at this harness (a hand-rolled fake query builder would just be
 * re-implementing PostgREST's SQL generation and testing that instead of the
 * real thing). Per the task brief's documented fallback, this file therefore:
 *
 *   1. Unit-tests `planVersionedUpdate`, the pure decision `updateResource`
 *      actually calls before it ever writes.
 *   2. Proves the database behaviour that decision and the rest of the
 *      repository's queries depend on, running the equivalent SQL directly
 *      against the same PGlite harness other suites use: RLS scoping (a
 *      different owner's row is invisible), a version-conditional UPDATE
 *      matching zero rows and preserving the newer row when the caller's
 *      version is stale, and disabling a row taking it out of the set
 *      `isInsertable` would call eligible.
 *
 * What this does NOT cover: `repository.ts`'s own `supabase-js` call sites
 * (`.from().select()/.insert()/.update()` and its `{ data, error }` handling)
 * are not executed by any test in this file. That gap is re-closed by manual
 * verification against the hosted Supabase project before release, per C10.
 */

describe('planVersionedUpdate (pure)', () => {
  it('applies and advances the version by exactly one when it matches', () => {
    expect(planVersionedUpdate(3, 3)).toEqual({ outcome: 'apply', nextVersion: 4 });
  });

  it('reports a conflict when the caller is behind the stored version', () => {
    expect(planVersionedUpdate(5, 3)).toEqual({ outcome: 'conflict' });
  });

  it('reports a conflict when the caller is somehow ahead of the stored version too', () => {
    // A version can never legitimately be ahead of the stored row, but the
    // function does not special-case that: any mismatch is a conflict.
    expect(planVersionedUpdate(3, 5)).toEqual({ outcome: 'conflict' });
  });
});

describe('resources: database behaviour repository.ts relies on', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await db.reset();
  });

  afterAll(async () => {
    await db?.close();
  });

  const insertOwned = async (overrides: { title?: string; path?: string; active?: boolean; verified?: boolean } = {}) =>
    db.asOwner(async (q) => {
      const { rows } = await q.query<{ id: string; version: number }>(
        `insert into public.resources
           (user_id, type, ownership, title_en, canonical_path, active, verified, version)
         values ((select auth.uid()), 'guide', 'own', $1, $2, $3, $4, 1)
         returning id, version`,
        [
          overrides.title ?? 'Interview prep guide',
          overrides.path ?? '/guides/interview-prep',
          overrides.active ?? true,
          overrides.verified ?? true,
        ],
      );
      return rows[0]!;
    });

  it('creates, lists and reads back a round trip', async () => {
    await insertOwned({ title: 'First guide' });
    await insertOwned({ title: 'Second guide', path: '/guides/second' });

    const { rows } = await db.asOwner((q) =>
      q.query<{ title_en: string }>(
        `select title_en from public.resources where user_id = (select auth.uid()) order by title_en`,
      ),
    );
    expect(rows.map((r) => r.title_en)).toEqual(['First guide', 'Second guide']);
  });

  it('a version-conditional update matching zero rows leaves the stored row unchanged (409 shape)', async () => {
    const created = await insertOwned({ title: 'Original title' });

    // Simulates repository.ts's updateResource with a stale expected_version:
    // the same predicate shape (id, user_id, version) it puts on its UPDATE.
    const stale = await db.asOwner((q) =>
      q.query(
        `update public.resources
           set title_en = 'Attempted overwrite', version = version + 1
         where id = $1 and user_id = (select auth.uid()) and version = $2
         returning id`,
        [created.id, created.version + 1], // wrong expected version, deliberately
      ),
    );
    expect(stale.rows).toHaveLength(0);

    const { rows } = await db.asOwner((q) =>
      q.query<{ title_en: string; version: number }>(
        `select title_en, version from public.resources where id = $1`,
        [created.id],
      ),
    );
    expect(rows[0]).toEqual({ title_en: 'Original title', version: 1 });
  });

  it('a version-conditional update matching the current version applies and advances it', async () => {
    const created = await insertOwned({ title: 'Original title' });

    const applied = await db.asOwner((q) =>
      q.query<{ title_en: string; version: number }>(
        `update public.resources
           set title_en = 'Updated title', version = version + 1
         where id = $1 and user_id = (select auth.uid()) and version = $2
         returning title_en, version`,
        [created.id, created.version],
      ),
    );
    expect(applied.rows[0]).toEqual({ title_en: 'Updated title', version: 2 });
  });

  it('disabling removes a resource from the insertable set immediately', async () => {
    const created = await insertOwned({ title: 'Toggle me' });

    const before = await db.asOwner((q) =>
      q.query<{ active: boolean; verified: boolean; allowed_platforms: Platform[] }>(
        `select active, verified, allowed_platforms from public.resources where id = $1`,
        [created.id],
      ),
    );
    expect(isInsertable(before.rows[0]!, 'linkedin')).toBe(true);

    await db.asOwner((q) =>
      q.query(`update public.resources set active = false where id = $1 returning id`, [created.id]),
    );

    const after = await db.asOwner((q) =>
      q.query<{ active: boolean; verified: boolean; allowed_platforms: Platform[] }>(
        `select active, verified, allowed_platforms from public.resources where id = $1`,
        [created.id],
      ),
    );
    expect(isInsertable(after.rows[0]!, 'linkedin')).toBe(false);
  });

  it('a resource row belonging to a different user is invisible to the owner', async () => {
    // Written with the superuser connection: the point being tested is what the
    // owner's own RLS-scoped session can see, not whether that insert itself
    // would ever happen through the app (it would not; every real row here has
    // user_id set to the single enabled owner).
    await db.raw.query(
      `insert into public.resources (user_id, type, ownership, title_en, canonical_path)
       values ($1, 'guide', 'own', 'Not yours', '/guides/not-yours')`,
      [OTHER_USER_ID],
    );

    const asOwnerResult = await db.asOwner((q) =>
      q.query<{ title_en: string }>(`select title_en from public.resources`),
    );
    expect(asOwnerResult.rows).toHaveLength(0);

    const asOtherResult = await db.asUser(OTHER_USER_ID, (q) =>
      q.query<{ title_en: string }>(`select title_en from public.resources`),
    );
    // OTHER_USER_ID is an authenticated session but not the enabled owner, so
    // is_app_owner() is false for them too: the row is invisible to everyone
    // except the single owner querying their own rows (C01).
    expect(asOtherResult.rows).toHaveLength(0);
  });

  it('a second authenticated user cannot see the owner’s own resources either', async () => {
    await insertOwned({ title: 'Owner-only guide' });

    const { rows } = await db.asUser(OTHER_USER_ID, (q) =>
      q.query<{ title_en: string }>(`select title_en from public.resources`),
    );
    expect(rows).toHaveLength(0);
  });

  it('anon has no access at all', async () => {
    await insertOwned({ title: 'Owner-only guide' });

    await expect(db.asAnon((q) => q.query(`select 1 from public.resources`))).rejects.toThrow();
  });
});


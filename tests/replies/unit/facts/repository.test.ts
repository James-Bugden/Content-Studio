import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listFacts,
  getFact,
  createFact,
  updateFact,
  approveFact,
  setFactActive,
} from '@/replies/lib/facts/repository';
import { isEligibleForGeneration } from '@/replies/lib/facts/eligibility';

/**
 * `createTestDatabase()` from `tests/support/db.ts` runs real Postgres via
 * PGlite, but it has no PostgREST in front of it, and this repository is
 * written against the `@supabase/supabase-js` query builder (per the ticket,
 * so it never imports the server client module and stays testable with any
 * client). Wiring `supabase-js` to talk to PGlite would mean standing up a
 * PostgREST-compatible HTTP layer, which is not an installed dependency here
 * and this task may not add one.
 *
 * So this file exercises `repository.ts` against a small hand-rolled fake that
 * implements the exact subset of the query-builder chain the repository calls
 * (`from/select/insert/update/eq/order/single/maybeSingle`), backed by a plain
 * in-memory array per table. That proves the repository's own logic: default
 * values, the atomic version-conflict check, and which tables a given call
 * touches. It does NOT prove anything Postgres itself would enforce, such as
 * RLS, the `facts_validity_ordered` check or the `version >= 1` constraint;
 * those are covered separately wherever this repo's schema tests run against
 * the real PGlite database.
 */

interface FakeRow extends Record<string, unknown> {
  id: string;
}

class FakeQueryBuilder implements PromiseLike<{ data: FakeRow[]; error: null }> {
  private filters: Array<(row: FakeRow) => boolean> = [];
  private orderSpec: { column: string; ascending: boolean } | null = null;
  private op: 'select' | 'insert' | 'update' = 'select';
  private insertPayload: Record<string, unknown> | null = null;
  private updatePayload: Record<string, unknown> | null = null;

  constructor(
    private readonly rows: FakeRow[],
    private readonly tableName: string,
    private readonly mutations: string[],
    private readonly idCounter: { n: number },
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  order(column: string, opts: { ascending: boolean }): this {
    this.orderSpec = { column, ascending: opts.ascending };
    return this;
  }

  insert(payload: Record<string, unknown>): this {
    this.op = 'insert';
    this.insertPayload = payload;
    return this;
  }

  update(payload: Record<string, unknown>): this {
    this.op = 'update';
    this.updatePayload = payload;
    return this;
  }

  async single(): Promise<{ data: FakeRow | null; error: { message: string; code: string } | null }> {
    const rows = this.run();
    if (rows.length === 0) {
      return { data: null, error: { message: 'no rows returned', code: 'PGRST116' } };
    }
    return { data: rows[0] ?? null, error: null };
  }

  async maybeSingle(): Promise<{ data: FakeRow | null; error: null }> {
    const rows = this.run();
    return { data: rows[0] ?? null, error: null };
  }

  // Awaiting `.eq(...).order(...)` directly (no `.single()`/`.maybeSingle()`)
  // is how `listFacts` reads its rows, so the builder itself must be thenable.
  then<TResult1 = { data: FakeRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: FakeRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const rows = this.run();
    return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
  }

  private run(): FakeRow[] {
    if (this.op === 'insert') {
      const now = new Date().toISOString();
      this.idCounter.n += 1;
      const row = {
        id: `fake-id-${this.idCounter.n}`,
        version: 1,
        created_at: now,
        updated_at: now,
        // Zod's `.nullish()` without a `.default()` omits the key entirely
        // when the input never mentioned it (verified directly against this
        // repo's zod version), so `factInputSchema.parse` never sets
        // `valid_from`/`valid_to` to anything when they are absent. The real
        // `facts` table still has to produce a value for that column, and a
        // nullable column with no DEFAULT clause is NULL, so the fake seeds
        // that same baseline before the caller's payload can override it.
        valid_from: null,
        valid_to: null,
        // A real insert travels through JSON, which drops an explicit
        // `undefined` (e.g. an omitted nullable field) before it ever reaches
        // Postgres; the column's own default, null here, fills the gap.
        // Skipping this step would leave a JS-only `undefined` in the row
        // that a real database row could never actually contain.
        ...normalizeUndefinedToNull(this.insertPayload ?? {}),
      } as FakeRow;
      this.rows.push(row);
      this.mutations.push(`insert:${this.tableName}:${row.id}`);
      // Callers must never see the same object twice: two reads of "the same
      // row" from a real client are always independently deserialised, so a
      // stale reference captured before a later mutation should not change
      // under the caller's feet.
      return [{ ...row }];
    }

    if (this.op === 'update') {
      const matches = this.rows.filter((row) => this.filters.every((f) => f(row)));
      const now = new Date().toISOString();
      const patch = normalizeUndefinedToNull(this.updatePayload ?? {});
      for (const row of matches) {
        Object.assign(row, patch, { updated_at: now });
        this.mutations.push(`update:${this.tableName}:${row.id}`);
      }
      return matches.map((row) => ({ ...row }));
    }

    let result = this.rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      result = [...result].sort((a, b) => {
        const cmp = String(a[column]).localeCompare(String(b[column]));
        return ascending ? cmp : -cmp;
      });
    }
    return result.map((row) => ({ ...row }));
  }
}

function normalizeUndefinedToNull(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, value === undefined ? null : value]),
  );
}

class FakeSupabase {
  readonly tables: Record<string, FakeRow[]> = {};
  readonly mutations: string[] = [];
  private readonly idCounter = { n: 0 };

  from(tableName: string): FakeQueryBuilder {
    this.tables[tableName] ??= [];
    return new FakeQueryBuilder(this.tables[tableName], tableName, this.mutations, this.idCounter);
  }
}

const OWNER_ID = 'owner-aaaaaaaa';

function asClient(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

describe('facts repository (owner-scoped CRUD)', () => {
  let fake: FakeSupabase;
  let supabase: SupabaseClient;

  beforeEach(() => {
    fake = new FakeSupabase();
    supabase = asClient(fake);
  });

  it('defaults a newly created fact to unapproved and private', async () => {
    const created = await createFact(supabase, OWNER_ID, {
      fact_text: 'Ran a synthetic pilot programme for a made-up client, Acme Robotics.',
      tags: ['pilot'],
    });

    expect(created.approved).toBe(false);
    expect(created.sensitivity).toBe('private_context_only');
    expect(created.active).toBe(true);
    expect(created.version).toBe(1);
    expect(created.user_id).toBe(OWNER_ID);
  });

  it('makes a fact eligible once it is approved, having been created public_safe', async () => {
    const created = await createFact(supabase, OWNER_ID, {
      fact_text: 'Rebuilt onboarding for a synthetic project, Widgetline.',
      tags: ['onboarding'],
      sensitivity: 'public_safe',
    });

    expect(isEligibleForGeneration(created, new Date())).toBe(false); // not_approved yet

    const approved = await approveFact(supabase, OWNER_ID, created.id, created.version);

    expect(approved.approved).toBe(true);
    expect(isEligibleForGeneration(approved, new Date())).toBe(true);
  });

  it('leaves fields the caller did not mention untouched by a partial update', async () => {
    // Regression guard for a real defect this task found: `factUpdateSchema`'s
    // partial `changes` schema re-applies each field's create-time default
    // for a key omitted from the update, in the zod version this project
    // pins. Naively writing the parsed `changes` object would silently reset
    // `sensitivity` and `tags` to their defaults every time only `approved`
    // was meant to change.
    const created = await createFact(supabase, OWNER_ID, {
      fact_text: 'Synthetic fact carrying tags that a partial update must not wipe.',
      tags: ['keep-me', 'also-keep-me'],
      sensitivity: 'public_safe',
    });

    const approved = await approveFact(supabase, OWNER_ID, created.id, created.version);

    expect(approved.approved).toBe(true);
    expect(approved.sensitivity).toBe('public_safe');
    expect(approved.tags).toEqual(['keep-me', 'also-keep-me']);
  });

  it('conflicts on a stale expected_version and preserves the newer row', async () => {
    const created = await createFact(supabase, OWNER_ID, {
      fact_text: 'Synthetic fact used only to exercise optimistic concurrency.',
      tags: [],
      sensitivity: 'public_safe',
    });

    // First writer succeeds and moves the fact from version 1 to version 2.
    const firstUpdate = await approveFact(supabase, OWNER_ID, created.id, created.version);
    expect(firstUpdate.version).toBe(2);

    // A second writer still holding the stale version 1 must be rejected...
    await expect(
      updateFact(supabase, OWNER_ID, created.id, created.version, { active: false }),
    ).rejects.toMatchObject({ code: 'version_conflict' });

    // ...and the row on record is still the first writer's, untouched by the
    // rejected attempt: it never got as far as "active: false".
    const stored = await getFact(supabase, OWNER_ID, created.id);
    expect(stored?.version).toBe(2);
    expect(stored?.approved).toBe(true);
    expect(stored?.active).toBe(true);
  });

  it('makes a revoked approval visible on the next read', async () => {
    const created = await createFact(supabase, OWNER_ID, {
      fact_text: 'Synthetic fact used to exercise revoking approval.',
      tags: [],
      sensitivity: 'public_safe',
      approved: true,
    });
    expect(created.approved).toBe(true);

    await updateFact(supabase, OWNER_ID, created.id, created.version, { approved: false });

    const stored = await getFact(supabase, OWNER_ID, created.id);
    expect(stored?.approved).toBe(false);
  });

  it('does not alter any existing reply_library row when a fact is disabled', async () => {
    const created = await createFact(supabase, OWNER_ID, {
      fact_text: 'Synthetic fact snapshotted into a past reply.',
      tags: [],
      sensitivity: 'public_safe',
      approved: true,
    });

    // A reply already recorded keeps its own exact text regardless of what
    // later happens to the fact it once drew on (C09). Seed one directly,
    // the way a recording function would have written it at the time.
    fake.tables.reply_library = [
      {
        id: 'library-row-1',
        user_id: OWNER_ID,
        final_text: `Thanks for asking! ${created.fact_text}`,
        recorded_fact_snapshot: created.fact_text,
      },
    ];
    const before = JSON.parse(JSON.stringify(fake.tables.reply_library));

    await setFactActive(supabase, OWNER_ID, created.id, created.version, false);

    expect(fake.tables.reply_library).toEqual(before);
    expect(fake.mutations.some((entry) => entry.includes('reply_library'))).toBe(false);
  });

  it('lists only the facts belonging to the requested owner', async () => {
    await createFact(supabase, OWNER_ID, { fact_text: 'Owner fact one.', tags: [] });
    // `createFact` above already touched `from('facts')`, so the table exists;
    // the non-null assertion just tells the compiler what the fake already did.
    fake.tables.facts!.push({
      id: 'intruder-fact',
      user_id: 'owner-bbbbbbbb',
      fact_text: 'Someone else entirely.',
      tags: [],
      approved: false,
      sensitivity: 'private_context_only',
      active: true,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const rows = await listFacts(supabase, OWNER_ID);

    expect(rows).toHaveLength(1);
    expect(rows.every((row) => row.user_id === OWNER_ID)).toBe(true);
  });

  it('returns null from getFact for a fact that does not exist', async () => {
    expect(await getFact(supabase, OWNER_ID, 'no-such-id')).toBeNull();
  });
});


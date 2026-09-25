import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { OWNER_ID, OTHER_USER_ID, type TestDatabase } from '../../support/db';
import { CORPUS, createRetrievalDatabase, seedReplies, type ReplySpec } from './harness';
import { searchReplies } from '@/replies/lib/retrieval/search';
import { eligibilityClause } from '@/replies/lib/retrieval/eligibility';
import type { SqlRunner } from '@/replies/lib/retrieval/runner';

/**
 * SEC-01, SEC-02 and the honesty rules in C05 and D04.
 *
 * These are the tests that stop the product telling the owner something untrue
 * about their own archive: that a withdrawn reply is still out there, that
 * someone else's writing is theirs, or that a model's draft is something they
 * once posted.
 */

let db: TestDatabase;

beforeAll(async () => {
  db = await createRetrievalDatabase();
}, 180_000);

beforeEach(async () => {
  await db.reset();
});

afterAll(async () => {
  await db?.close();
});

/** Runs as the database superuser, so row level security is not doing the work. */
function superuser(): SqlRunner {
  return { query: (sql, params) => db.raw.query(sql, params as unknown[]) };
}

const NEGOTIATION = 'recruiter salary negotiation';

describe('eligibility', () => {
  it('never returns a withdrawn reply, however the filters are set', async () => {
    const ids = await seedReplies(db, OWNER_ID, CORPUS);
    const withdrawn = ids.get('withdrawn-negotiation')!;

    const plain = await db.asOwner((q) => searchReplies(q, { query: NEGOTIATION, limit: 25 }));
    const withDrafts = await db.asOwner((q) =>
      searchReplies(q, { query: NEGOTIATION, includeAiDrafts: true, limit: 25 }),
    );
    const explicit = await db.asOwner((q) =>
      searchReplies(q, {
        query: NEGOTIATION,
        provenances: ['posted_confirmed', 'ai_draft', 'published_main_post'],
        limit: 25,
      }),
    );

    for (const response of [plain, withDrafts, explicit]) {
      expect(response.items.map((item) => item.id)).not.toContain(withdrawn);
    }
  });

  it('excludes another owner through the query itself, not only through RLS', async () => {
    const intruder: ReplySpec = {
      key: 'intruder',
      platform: 'linkedin',
      postedAt: '2026-09-21T09:00:00Z',
      ownerId: OTHER_USER_ID,
      text: 'Someone else wrote this about a recruiter, a salary range and a negotiation.',
    };
    const ids = await seedReplies(db, OWNER_ID, [...CORPUS, intruder]);

    const scoped = await searchReplies(superuser(), {
      query: NEGOTIATION,
      ownerId: OWNER_ID,
      limit: 25,
    });
    expect(scoped.items.map((item) => item.id)).not.toContain(ids.get('intruder'));
    expect(scoped.items.length).toBeGreaterThan(0);

    const asOwner = await db.asOwner((q) => searchReplies(q, { query: NEGOTIATION, limit: 25 }));
    expect(asOwner.items.map((item) => item.id)).not.toContain(ids.get('intruder'));
  });

  it('keeps an AI draft out of the default result and labels it when asked for', async () => {
    const ids = await seedReplies(db, OWNER_ID, CORPUS);
    const draft = ids.get('ai-draft-negotiation')!;

    const byDefault = await db.asOwner((q) =>
      searchReplies(q, { query: NEGOTIATION, limit: 25 }),
    );
    expect(byDefault.items.map((item) => item.id)).not.toContain(draft);

    const explicit = await db.asOwner((q) =>
      searchReplies(q, { query: NEGOTIATION, provenances: ['ai_draft'], limit: 25 }),
    );
    const found = explicit.items.find((item) => item.id === draft);
    expect(found?.provenance).toBe('ai_draft');
  });

  it('reports an AI-only history as empty rather than as past replies', async () => {
    await seedReplies(db, OWNER_ID, [
      {
        key: 'only-draft-a',
        platform: 'linkedin',
        postedAt: '2026-09-01T09:00:00Z',
        provenance: 'ai_draft',
        evidence: 'unknown',
        text: 'Generated draft about a recruiter, a salary band and an opening negotiation line.',
      },
      {
        key: 'only-draft-b',
        platform: 'linkedin',
        postedAt: '2026-09-02T09:00:00Z',
        provenance: 'ai_draft',
        evidence: 'unknown',
        text: 'Generated draft two, also about salary negotiation with a recruiter.',
      },
    ]);

    const response = await db.asOwner((q) => searchReplies(q, { query: NEGOTIATION, limit: 25 }));

    expect(response.state).toBe('empty');
    expect(response.items).toEqual([]);
  });

  it('returns a main post and an unconfirmed draft with their true provenance', async () => {
    const ids = await seedReplies(db, OWNER_ID, CORPUS);

    const response = await db.asOwner((q) =>
      searchReplies(q, { query: NEGOTIATION, limit: 25 }),
    );
    const byId = new Map(response.items.map((item) => [item.id, item]));

    expect(byId.get(ids.get('main-post-negotiation')!)?.provenance).toBe('published_main_post');
    expect(byId.get(ids.get('main-post-negotiation')!)?.publication_evidence).toBe(
      'platform_export',
    );
    expect(byId.get(ids.get('edited-draft-recruiter')!)?.provenance).toBe(
      'user_edited_unconfirmed',
    );
    expect(byId.get(ids.get('anchor-negotiation')!)?.provenance).toBe('posted_confirmed');
  });

  it('keeps an unknown posting date findable, and droppable on request', async () => {
    const ids = await seedReplies(db, OWNER_ID, [
      {
        key: 'undated',
        platform: 'x',
        postedAt: '2026-09-01T09:00:00Z',
        datePrecision: 'unknown',
        evidence: 'unknown',
        text: 'An imported reply about salary negotiation whose posting date was never recorded.',
      },
    ]);

    const included = await db.asOwner((q) => searchReplies(q, { query: NEGOTIATION }));
    expect(included.items[0]!.id).toBe(ids.get('undated'));
    expect(included.items[0]!.date_precision).toBe('unknown');
    expect(included.items[0]!.posted_at).toBeNull();

    const excluded = await db.asOwner((q) =>
      searchReplies(q, { query: NEGOTIATION, includeUnknownDates: false }),
    );
    expect(excluded.state).toBe('empty');
  });
});

describe('eligibilityClause', () => {
  it('filters before selection and passes every value as a parameter', () => {
    const fragment = eligibilityClause(
      { ownerId: OWNER_ID, platforms: ['threads'], provenances: ['ai_draft'] },
      3,
    );

    expect(fragment.sql).toContain('r.withdrawn_at is null');
    expect(fragment.sql).toContain('$3::uuid');
    expect(fragment.sql).toContain('$4::text[]');
    expect(fragment.sql).toContain('$5::text[]');
    expect(fragment.params).toEqual([OWNER_ID, ['threads'], ['ai_draft']]);
    // Nothing the owner typed is ever concatenated into the statement.
    expect(fragment.sql).not.toContain('threads');
  });

  it('drops AI drafts unless they were asked for', () => {
    const fallback = eligibilityClause({}, 1);
    expect(fallback.params).toEqual(['ai_draft']);
    expect(fallback.sql).toContain('r.provenance::text <> $1');

    const allowed = eligibilityClause({ includeAiDrafts: true }, 1);
    expect(allowed.params).toEqual([]);
  });
});


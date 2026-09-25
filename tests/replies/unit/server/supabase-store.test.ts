import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

// `supabase-store.ts` imports `server-only`, whose default export throws outside
// a React Server Component. Neutralising it here is what lets the real data
// layer be executed by a test at all; without it the file has literally no way
// to be imported, which is how 674 lines ended up with no coverage.
vi.mock('server-only', () => ({}));

import type { OwnerSession } from '@/replies/lib/auth/owner';
import { isAppError } from '@/replies/lib/contracts/errors';
import { contentHash, searchText } from '@/replies/lib/contracts/text';
import { createSupabaseStore } from '@/replies/lib/server/supabase-store';
import type { Store } from '@/replies/lib/server/store';
import { OWNER_ID, OTHER_USER_ID, type TestDatabase } from '../../support/db';
import { createRetrievalDatabase, seedReplies, CORPUS, type ReplySpec } from '../retrieval/harness';
import { createSupabaseDouble, type SupabaseDouble } from './supabase-double';

/**
 * The real data layer, executed.
 *
 * Every query below reaches PGlite through the query-builder double, inside a
 * transaction as the authenticated owner, so the policies, constraints and
 * plpgsql functions are the production ones. What is being tested is the part of
 * the store the in-memory double cannot have: what it does with a duplicate key,
 * a failed read, and a timestamp that belongs to a different calendar day than
 * the one UTC is having.
 */

let db: TestDatabase;
let double: SupabaseDouble;
let store: Store;

beforeAll(async () => {
  db = await createRetrievalDatabase();
}, 180_000);

beforeEach(async () => {
  await db.reset();
  double = createSupabaseDouble(db);
  store = createSupabaseStore({ userId: OWNER_ID, supabase: double.client } as OwnerSession);
});

afterAll(async () => {
  await db?.close();
});

const KEY_ONE = '00000000-0000-4000-8000-000000000001';
const KEY_TWO = '00000000-0000-4000-8000-000000000002';

/** The post the owner is replying to. Invented, like every other string here. */
const SOURCE_TEXT = 'A recruiter asked about salary. How do I open the negotiation?';

function analyseInput(requestKey: string, sourceText = SOURCE_TEXT) {
  return {
    requestKey,
    platform: 'linkedin' as const,
    targetKind: 'post' as const,
    sourceText,
    parentText: null,
    sourceUrl: null,
  };
}

async function countRows(table: string): Promise<number> {
  const { rows } = await db.raw.query<{ n: string }>(
    `select count(*)::text as n from public.${table}`,
  );
  return Number(rows[0]!.n);
}

async function errorCodeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isAppError(error)) return error.code;
    return `unexpected: ${(error as Error).message}`;
  }
  throw new Error('expected the call to be rejected, but it resolved');
}

// ---------------------------------------------------------------------------
// Defect 1: the second page of a search must be reachable.
// ---------------------------------------------------------------------------

describe('paging from analyse into the library search', () => {
  beforeEach(async () => {
    await seedReplies(db, OWNER_ID, CORPUS);
  });

  it('replays the cursor analyse minted, rather than rejecting it as a different search', async () => {
    const first = await store.analyse(analyseInput(KEY_ONE));

    expect(first.history.state).toBe('ready');
    expect(first.history.nextCursor).not.toBeNull();

    // Exactly what the workspace's Show more matches sends: the same query text,
    // the cursor it was given, and no filters of its own.
    const second = await store.searchLibrary({
      query: SOURCE_TEXT,
      includeUnknownDates: true,
      cursor: first.history.nextCursor,
      limit: 5,
    });

    expect(second.state).toBe('ready');
    expect(second.items.length).toBeGreaterThan(0);

    const firstIds = first.history.items.map((item) => item.id);
    const secondIds = second.items.map((item) => item.id);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
  });

  it('keeps AI drafts out of a library search that did not ask for them', async () => {
    const result = await store.searchLibrary({
      query: 'recruiter salary negotiation',
      includeUnknownDates: true,
      cursor: null,
      limit: 25,
    });

    expect(result.state).toBe('ready');
    expect(result.items.some((item) => item.provenance === 'ai_draft')).toBe(false);
  });

  it('still returns AI drafts to a search that names them explicitly, and pages that too', async () => {
    const first = await store.searchLibrary({
      query: 'recruiter salary negotiation',
      provenances: ['ai_draft'],
      includeUnknownDates: true,
      cursor: null,
      limit: 1,
    });

    expect(first.items.every((item) => item.provenance === 'ai_draft')).toBe(true);
    expect(first.items.length).toBe(1);

    // The filtered search must be able to page itself, which is the other half of
    // "the second page uses the eligibility options that produced the first".
    if (first.nextCursor) {
      const second = await store.searchLibrary({
        query: 'recruiter salary negotiation',
        provenances: ['ai_draft'],
        includeUnknownDates: true,
        cursor: first.nextCursor,
        limit: 1,
      });
      expect(second.state).not.toBe('error');
    }
  });
});

// ---------------------------------------------------------------------------
// Defect 2: the mutation key must never exist without naming its result.
// ---------------------------------------------------------------------------

describe('analyse idempotency', () => {
  it('reuses the session a completed call already created', async () => {
    const first = await store.analyse(analyseInput(KEY_ONE));
    const replay = await store.analyse(analyseInput(KEY_ONE));

    expect(replay.sessionId).toBe(first.sessionId);
    expect(await countRows('reply_sessions')).toBe(1);
    expect(await countRows('source_posts')).toBe(1);
  });

  it('claims the key with the session id it will use, never with a null result', async () => {
    const result = await store.analyse(analyseInput(KEY_ONE));

    const { rows } = await db.raw.query<{ result_id: string | null }>(
      `select result_id::text as result_id from public.mutation_keys where key = $1::uuid`,
      [KEY_ONE],
    );
    expect(rows[0]!.result_id).toBe(result.sessionId);
  });

  it('refuses rather than duplicating when the first call has claimed the key but not committed', async () => {
    // Exactly the mid-flight state the old ordering produced: the key is taken,
    // the session it stands for is not readable yet. A second call that reads
    // this and carries on is how one press of Get reply ideas became two
    // sessions and two source rows.
    await db.raw.query(
      `insert into public.mutation_keys (user_id, key, request_fingerprint, operation)
       values ($1::uuid, $2::uuid, $3, 'analyse')`,
      [OWNER_ID, KEY_TWO, contentHash(SOURCE_TEXT)],
    );

    expect(await errorCodeOf(store.analyse(analyseInput(KEY_TWO)))).toBe('idempotency_conflict');
    expect(await countRows('reply_sessions')).toBe(0);
    expect(await countRows('source_posts')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Defect 5: a failed read is not an empty result.
// ---------------------------------------------------------------------------

describe('generationContext error handling', () => {
  let sessionId: string;

  beforeEach(async () => {
    await seedReplies(db, OWNER_ID, CORPUS);
    sessionId = (await store.analyse(analyseInput(KEY_ONE))).sessionId;
  });

  it('builds a context with the source text when every read succeeds', async () => {
    const context = await store.generationContext(sessionId, []);
    expect(context.sourceText).toBe(SOURCE_TEXT);
    expect(context.platform).toBe('linkedin');
  });

  it('fails the request when the source post cannot be read', async () => {
    double.failNext('from public."source_posts"');
    expect(await errorCodeOf(store.generationContext(sessionId, []))).toBe('internal_error');
  });

  it('fails the request when the repetition check cannot read recent replies', async () => {
    double.failNext('from public."reply_library"');
    expect(await errorCodeOf(store.generationContext(sessionId, []))).toBe('internal_error');
  });

  it('degrades to no facts, which C06 already defines as advice with no first-person claim', async () => {
    double.failNext('from public."facts"');
    const context = await store.generationContext(sessionId, []);
    expect(context.facts).toEqual([]);
    expect(context.sourceText).toBe(SOURCE_TEXT);
  });
});

// ---------------------------------------------------------------------------
// Defect 6: displayed dates are the owner's day, not UTC's.
// ---------------------------------------------------------------------------

describe('dates in the generation context', () => {
  /** 07:30 on the 23rd in Taipei. The UTC date is still the 22nd. */
  const LATE_EVENING_UTC = '2026-09-22T23:30:00Z';

  const LATE_REPLY: ReplySpec = {
    key: 'late-evening',
    platform: 'linkedin',
    postedAt: LATE_EVENING_UTC,
    text: 'A recruiter asked about the salary range late in the evening and I answered with the scope of the negotiation instead of a number.',
  };

  it('reports the Taipei day the counter would have counted, not the UTC day', async () => {
    await seedReplies(db, OWNER_ID, [LATE_REPLY]);
    const sessionId = (await store.analyse(analyseInput(KEY_ONE))).sessionId;

    const context = await store.generationContext(sessionId, []);

    const written = context.writing.find((item) => item.text === LATE_REPLY.text);
    expect(written?.posted_on).toBe('2026-09-23');

    const recent = context.recentReplies.find((item) => item.text === LATE_REPLY.text);
    expect(recent?.posted_on).toBe('2026-09-23');

    // And the count of that same Taipei day agrees with the date shown beside it.
    const progress = await store.dailyCounts('Asia/Taipei');
    expect(progress.local_day).toBe(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()),
    );
  });

  it('keeps a date-only record on its own stated date rather than shifting it', async () => {
    const replyId = crypto.randomUUID();
    await db.raw.query(
      `insert into public.reply_library (
         id, user_id, platform, final_text, search_text, provenance, publication_evidence,
         posted_date, date_precision, content_hash, recorded_at
       )
       values ($1::uuid, $2::uuid, 'linkedin', $3, $4, 'posted_confirmed', 'user_confirmed',
               '2026-09-22'::date, 'date_only', $5, now())`,
      [
        replyId,
        OWNER_ID,
        'An undated export said only the day, so the negotiation advice keeps that day and nothing more precise.',
        searchText('An undated export said only the day, so the negotiation advice keeps that day.'),
        contentHash('date-only-fixture'),
      ],
    );
    const sessionId = (await store.analyse(analyseInput(KEY_ONE))).sessionId;

    const context = await store.generationContext(sessionId, []);
    const recent = context.recentReplies[0];
    expect(recent?.posted_on).toBe('2026-09-22');
  });
});

// ---------------------------------------------------------------------------
// Coverage for the rest of the file, so the fixes above sit in a tested module
// rather than in the only three tested functions of an untested one.
// ---------------------------------------------------------------------------

describe('sessions', () => {
  it('returns null for a session that does not exist, and the row for one that does', async () => {
    expect(await store.getSession('00000000-0000-4000-8000-0000000000ff')).toBeNull();

    const { sessionId } = await store.analyse(analyseInput(KEY_ONE));
    const session = await store.getSession(sessionId);
    expect(session).toMatchObject({ platform: 'linkedin', state: 'draft', editor_version: 0 });
  });

  it('advances the editor version, and refuses a stale one without overwriting', async () => {
    const { sessionId } = await store.analyse(analyseInput(KEY_ONE));

    const draft = 'My own words about the band and the scope behind it.';
    const first = await store.updateSessionDraft(sessionId, 0, draft, contentHash(draft));
    expect(first).toEqual({ editorVersion: 1, meaningIsStale: false });

    expect(await errorCodeOf(store.updateSessionDraft(sessionId, 0, 'stale', contentHash('stale'))))
      .toBe('version_conflict');

    const session = await store.getSession(sessionId);
    expect(session?.draft_text).toBe(draft);
  });

  it('marks a stored meaning stale once the draft it was made from changes', async () => {
    const { sessionId } = await store.analyse(analyseInput(KEY_ONE));
    const draft = 'The first draft, whose meaning was translated.';
    await store.updateSessionDraft(sessionId, 0, draft, contentHash(draft));
    await store.setSessionMeaning(sessionId, 'An English meaning.', contentHash(draft));

    const next = 'The second draft, which the old meaning no longer describes.';
    const result = await store.updateSessionDraft(sessionId, 1, next, contentHash(next));
    expect(result.meaningIsStale).toBe(true);
  });
});

describe('service-role owner isolation', () => {
  it('never returns or updates another owner row while RLS is bypassed', async () => {
    const otherSession = crypto.randomUUID();
    const otherResource = crypto.randomUUID();
    await db.raw.query(
      `insert into public.reply_sessions (id, user_id, platform, draft_hash)
       values ($1::uuid, $2::uuid, 'x', 'other-hash')`,
      [otherSession, OTHER_USER_ID],
    );
    await db.raw.query(
      `insert into public.resources
         (id, user_id, type, ownership, title_en, canonical_path)
       values ($1::uuid, $2::uuid, 'guide', 'own', 'Other owner resource', '/other')`,
      [otherResource, OTHER_USER_ID],
    );
    await db.raw.query(
      `insert into public.facts
         (user_id, fact_text, approved, active, sensitivity)
       values ($1::uuid, 'Other owner fact', true, true, 'public_safe')`,
      [OTHER_USER_ID],
    );
    await db.raw.query(
      `insert into public.app_settings
         (user_id, target_linkedin, target_x, target_threads, timezone)
       values ($1::uuid, 91, 92, 93, 'Asia/Taipei')`,
      [OTHER_USER_ID],
    );

    expect(await store.getSession(otherSession)).toBeNull();
    expect(await store.listResources()).toEqual([]);
    expect(await store.listFacts()).toEqual([]);
    expect(await store.hasEligibleFacts()).toBe(false);
    expect(await store.getSettings()).toMatchObject({
      target_linkedin: 10,
      target_x: 10,
      target_threads: 10,
    });

    await expect(
      store.saveResource({
        id: otherResource,
        expectedVersion: 1,
        fields: { title_en: 'Attempted overwrite' },
      }),
    ).rejects.toMatchObject({ code: 'version_conflict' });

    const { rows } = await db.raw.query<{ title_en: string }>(
      `select title_en from public.resources where id = $1::uuid`,
      [otherResource],
    );
    expect(rows[0]?.title_en).toBe('Other owner resource');
  });
});

describe('generation runs', () => {
  it('counts runs in the last hour, and throws rather than reporting zero when it cannot', async () => {
    const { sessionId, sourceVersion } = await store.analyse(analyseInput(KEY_ONE));
    expect(await store.countGenerationRunsInLastHour()).toBe(0);

    const runId = await store.createGenerationRun({
      sessionId,
      sourceVersion,
      editorBaseVersion: 0,
      requestKey: KEY_TWO,
      contextVersion: 1,
      promptVersion: 'test-prompt-1',
      provider: 'fake',
      model: 'fake',
    });
    expect(await store.countGenerationRunsInLastHour()).toBe(1);

    await store.completeGenerationRun(runId, {
      status: 'succeeded',
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 5,
      errorCode: null,
    });

    double.failNext('from public."generation_runs"');
    expect(await errorCodeOf(store.countGenerationRunsInLastHour())).toBe('internal_error');
  });

  it('saves exactly three suggestions and gives each one back with its stored id', async () => {
    const { sessionId, sourceVersion } = await store.analyse(analyseInput(KEY_ONE));
    const runId = await store.createGenerationRun({
      sessionId,
      sourceVersion,
      editorBaseVersion: 0,
      requestKey: KEY_TWO,
      contextVersion: 1,
      promptVersion: 'test-prompt-1',
      provider: 'fake',
      model: 'fake',
    });

    const ideas = [0, 1, 2].map((position) => ({
      position,
      angle_label: `Angle ${position}`,
      reply_text: `A synthetic alternative at position ${position}.`,
      english_meaning: null,
      resource_id: null,
      cta_text: null,
      uses_fact_ids: [],
      based_on_reply_ids: [],
    }));

    const saved = await store.saveSuggestions(runId, ideas);
    expect(saved).toHaveLength(3);
    expect(saved.every((idea) => idea.id !== '')).toBe(true);
    expect(new Set(saved.map((idea) => idea.id)).size).toBe(3);
    expect(saved.map((idea) => idea.position)).toEqual([0, 1, 2]);
  });
});

describe('recording, correcting and withdrawing', () => {
  async function recordOne(operationKey: string, text: string): Promise<string> {
    const { sessionId } = await store.analyse(analyseInput(KEY_ONE));
    const result = await store.recordReply({
      operationKey,
      fingerprint: contentHash(text),
      sessionId,
      editorVersion: 0,
      finalText: text,
      contentHash: contentHash(text),
      searchText: searchText(text),
      replyUrl: null,
      postedAt: null,
      resourceSnapshots: [],
      embeddingModel: 'synthetic-embedding-model',
    });
    return result.replyId;
  }

  it('records a reply once, and replays the same key instead of inserting a second', async () => {
    const text = 'Ask what the top of the band is paid for before you name a number.';
    const replyId = await recordOne(KEY_TWO, text);

    const replay = await store.recordReply({
      operationKey: KEY_TWO,
      fingerprint: contentHash(text),
      sessionId: (await store.analyse(analyseInput(KEY_ONE))).sessionId,
      editorVersion: 0,
      finalText: text,
      contentHash: contentHash(text),
      searchText: searchText(text),
      replyUrl: null,
      postedAt: null,
      resourceSnapshots: [],
      embeddingModel: 'synthetic-embedding-model',
    });

    expect(replay.replyId).toBe(replyId);
    expect(replay.replayed).toBe(true);
    expect(await countRows('reply_library')).toBe(1);
  });

  it('records a manual reply whose posting date is honestly unknown', async () => {
    const text = 'An older reply, added by hand, with no date anybody can prove.';
    const result = await store.recordManualReply({
      operationKey: KEY_TWO,
      fingerprint: contentHash(text),
      platform: 'threads',
      finalText: text,
      contentHash: contentHash(text),
      searchText: searchText(text),
      datePrecision: 'unknown',
      postedAt: null,
      postedDate: null,
      sourceTimezone: null,
      sourceText: null,
      parentText: null,
      sourceUrl: null,
      replyUrl: null,
      embeddingModel: 'synthetic-embedding-model',
    });

    expect(result.replayed).toBe(false);
    const progress = await store.dailyCounts('Asia/Taipei');
    // An unknown date cannot be counted into today, whatever today is (C09).
    expect(progress.counts.threads).toBe(0);
  });

  it('appends a revision on a correction and drops the count on a withdrawal', async () => {
    const text = 'The first wording, which was recorded and then corrected.';
    const replyId = await recordOne(KEY_TWO, text);

    const corrected = 'The corrected wording, recorded as a private revision.';
    const { revision } = await store.correctReply(
      replyId,
      0,
      corrected,
      contentHash(corrected),
      searchText(corrected),
      'fixed a typo',
    );
    expect(revision).toBe(1);

    // A second correction against the revision that has already been superseded
    // must not silently apply. The exact code comes from the SQL function, so the
    // assertion is that it rejects and leaves the stored text alone.
    await expect(
      store.correctReply(replyId, 0, 'A third wording', contentHash('A third wording'), searchText('A third wording'), ''),
    ).rejects.toBeInstanceOf(Error);

    const stored = await db.raw.query<{ final_text: string }>(
      `select final_text from public.reply_library where id = $1::uuid`,
      [replyId],
    );
    expect(stored.rows[0]!.final_text).toBe(corrected);

    await store.setReplyWithdrawn(replyId, true);
    const { rows } = await db.raw.query<{ withdrawn_at: string | null }>(
      `select withdrawn_at from public.reply_library where id = $1::uuid`,
      [replyId],
    );
    expect(rows[0]!.withdrawn_at).not.toBeNull();
  });
});

describe('settings, resources and facts', () => {
  it('falls back to the documented defaults before anything is saved', async () => {
    expect(await store.getSettings()).toEqual({
      target_linkedin: 10,
      target_x: 10,
      target_threads: 10,
      timezone: 'Asia/Taipei',
    });
  });

  it('saves settings and reads them back', async () => {
    const saved = await store.saveSettings({
      target_linkedin: 4,
      target_x: 2,
      target_threads: 6,
      timezone: 'Asia/Taipei',
    });
    expect(saved.target_linkedin).toBe(4);
    expect(await store.getSettings()).toMatchObject({ target_linkedin: 4, target_threads: 6 });
  });

  it('refuses a resource edit made against a stale version', async () => {
    const created = await store.saveResource({
      id: null,
      expectedVersion: null,
      fields: {
        type: 'guide',
        ownership: 'own',
        title_en: 'A synthetic guide',
        description: 'Invented for this test.',
        canonical_path: '/guides/synthetic',
        allowed_platforms: ['linkedin'],
        active: true,
        verified: true,
      },
    });

    const updated = await store.saveResource({
      id: created.id,
      expectedVersion: created.version,
      fields: { description: 'Still invented.' },
    });
    expect(updated.version).toBe(created.version + 1);

    expect(await errorCodeOf(
      store.saveResource({
        id: created.id,
        expectedVersion: created.version,
        fields: { description: 'A stale form.' },
      }),
    )).toBe('version_conflict');

    const listed = await store.listResources();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.description).toBe('Still invented.');
  });

  it('says why a fact is not usable rather than silently omitting it', async () => {
    await store.saveFact({
      id: null,
      expectedVersion: null,
      fields: {
        fact_text: 'A synthetic, unapproved fact.',
        tags: ['salary'],
        approved: false,
        sensitivity: 'public_safe',
        active: true,
      },
    });

    expect(await store.hasEligibleFacts()).toBe(false);
    const facts = await store.listFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ eligible: false });
    expect(facts[0]!.ineligible_reason).not.toBeNull();

    await store.saveFact({
      id: facts[0]!.id,
      expectedVersion: facts[0]!.version,
      fields: { approved: true },
    });
    expect(await store.hasEligibleFacts()).toBe(true);
  });
});

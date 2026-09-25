import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OWNER_ID, type TestDatabase } from '../../support/db';
import { createRetrievalDatabase } from './harness';
import { searchReplies } from '@/replies/lib/retrieval/search';
import { fullTextCandidates, trigramCandidates } from '@/replies/lib/retrieval/lexical';

/**
 * A measurement, not a claim.
 *
 * Issue #10 asks for recorded cold and warm latency on a ten thousand row
 * synthetic corpus. This test deliberately asserts no threshold: a number
 * invented to make a test green is worse than no number, and the figure below is
 * PGlite compiled to WebAssembly on one developer machine, which is not hosted
 * Postgres. Treat it as the shape of the cost, and re-measure on the hosted
 * project before making any statement about production latency.
 */

const ROWS = 10_000;

let db: TestDatabase;

beforeAll(async () => {
  db = await createRetrievalDatabase();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe('retrieval on a ten thousand row corpus', () => {
  it('records cold and warm durations', async () => {
    const seedStarted = performance.now();
    await db.raw.query(
      `insert into public.reply_library (
         user_id, platform, final_text, search_text, provenance, publication_evidence,
         posted_at, date_precision, content_hash, recorded_at
       )
       select $1::uuid,
              (array['linkedin','x','threads'])[1 + (g % 3)]::public.platform,
              'Synthetic reply ' || g || ' about ' || topic || ' written only to measure retrieval cost.',
              'synthetic reply ' || g || ' about ' || topic || ' written only to measure retrieval cost.',
              'posted_confirmed', 'user_confirmed',
              timestamptz '2025-01-01 00:00:00+00' + make_interval(mins => g),
              'timestamp',
              md5('synthetic-' || g),
              timestamptz '2025-01-01 00:00:00+00' + make_interval(mins => g)
       from generate_series(1, $2) g
       cross join lateral (
         select (array[
           'portfolio reviews','referral etiquette','cover letters','the interview loop',
           'pay bands','onboarding','promotion cases','feedback requests',
           'mentoring','relocation packages'
         ])[1 + (g % 10)] as topic
       ) t`,
      [OWNER_ID, ROWS],
    );
    await db.raw.query(
      `insert into public.search_documents (user_id, entity_kind, entity_id, text_hash, search_text)
       select user_id, 'reply', id, content_hash, search_text from public.reply_library`,
    );
    const seedMs = performance.now() - seedStarted;

    const { rows: counted } = await db.raw.query<{ n: string }>(
      `select count(*)::text as n from public.search_documents`,
    );
    expect(Number(counted[0]!.n)).toBe(ROWS);

    const query = 'referral etiquette';

    const coldStarted = performance.now();
    const cold = await db.asOwner((q) => searchReplies(q, { query }));
    const coldMs = performance.now() - coldStarted;

    const warmStarted = performance.now();
    const warm = await db.asOwner((q) => searchReplies(q, { query }));
    const warmMs = performance.now() - warmStarted;

    expect(cold.state).toBe('ready');
    expect(cold.items).toHaveLength(3);
    expect(warm.items.map((i) => i.id)).toEqual(cold.items.map((i) => i.id));

    // Split the cost between the two signals, because they are tuned separately:
    // full-text search can use its GIN index, while the trigram and containment
    // expressions cannot and are therefore the part worth watching.
    const ftsStarted = performance.now();
    await db.asOwner((q) => fullTextCandidates(q, { query }));
    const ftsMs = performance.now() - ftsStarted;

    const trgmStarted = performance.now();
    await db.asOwner((q) => trigramCandidates(q, { query }));
    const trgmMs = performance.now() - trgmStarted;

    console.log(
      `[retrieval measurement] rows=${ROWS} seed=${seedMs.toFixed(0)}ms ` +
        `cold=${coldMs.toFixed(0)}ms warm=${warmMs.toFixed(0)}ms ` +
        `fulltext=${ftsMs.toFixed(0)}ms trigram+containment=${trgmMs.toFixed(0)}ms ` +
        `query=${JSON.stringify(query)} engine=PGlite/wasm`,
    );
  }, 180_000);
});


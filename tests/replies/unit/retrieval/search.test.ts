import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { OWNER_ID, type TestDatabase } from '../../support/db';
import { CORPUS, createRetrievalDatabase, seedReplies } from './harness';
import { searchReplies, contextSnippets } from '@/replies/lib/retrieval/search';
import { trigramCandidates } from '@/replies/lib/retrieval/lexical';
import type { SqlRunner } from '@/replies/lib/retrieval/runner';

/**
 * RET-01 to RET-04: the queries an owner actually types.
 *
 * The corpus is built so that the obvious wrong implementation fails. Ranking by
 * recency would fail the first test; relying on English full-text search would
 * fail the Chinese and keyword tests; filtering after selecting a top-k would
 * fail the pagination test.
 */

let db: TestDatabase;
let ids: Map<string, string>;

beforeAll(async () => {
  db = await createRetrievalDatabase();
}, 180_000);

beforeEach(async () => {
  await db.reset();
  ids = await seedReplies(db, OWNER_ID, CORPUS);
});

afterAll(async () => {
  await db?.close();
});

function keyOf(id: string): string {
  for (const [key, value] of ids) if (value === id) return key;
  return `unknown:${id}`;
}

describe('searchReplies', () => {
  it('finds a relevant old reply that recency ranking would bury', async () => {
    const response = await db.asOwner((q) =>
      searchReplies(q, { query: 'recruiter salary negotiation' }),
    );

    expect(response.state).toBe('ready');
    expect(keyOf(response.items[0]!.id)).toBe('anchor-negotiation');

    // The refutation: the same candidate set, ordered the way a recency-first
    // implementation would order it, starts with something else entirely.
    const candidates = await db.asOwner((q) =>
      trigramCandidates(q, { query: 'recruiter salary negotiation' }),
    );
    const newestFirst = [...candidates].sort((a, b) =>
      a.recorded_at < b.recorded_at ? 1 : -1,
    );
    expect(candidates.length).toBeGreaterThan(5);
    expect(keyOf(newestFirst[0]!.id)).not.toBe('anchor-negotiation');

    // And the anchor really is old: everything else eligible was written later.
    const anchor = response.items[0]!;
    expect(anchor.posted_at!.startsWith('2024')).toBe(true);
  });

  it('finds Traditional Chinese writing, which English stemming cannot reach', async () => {
    const response = await db.asOwner((q) => searchReplies(q, { query: '面試', limit: 5 }));

    expect(response.state).toBe('ready');
    expect(response.items.length).toBeGreaterThanOrEqual(3);
    for (const item of response.items) {
      expect(item.full_text).toContain('面試');
      expect(item.platform).toBe('threads');
    }
  });

  it('finds a Chinese phrase that sits inside a longer unspaced run', async () => {
    const response = await db.asOwner((q) => searchReplies(q, { query: '薪資', limit: 5 }));

    expect(response.state).toBe('ready');
    const keys = response.items.map((item) => keyOf(item.id));
    expect(keys).toContain('zh-salary-talk');
  });

  it('works for a two-character English keyword', async () => {
    const response = await db.asOwner((q) => searchReplies(q, { query: 'cv', limit: 5 }));

    expect(response.state).toBe('ready');
    // The three replies that literally contain "cv" lead. Lower down, the 0.08
    // trigram floor in RETRIEVAL admits weak fuzzy matches, which is the floor
    // behaving as specified rather than a ranking error.
    const leading = response.items.slice(0, 3).map((item) => keyOf(item.id));
    expect(leading.sort()).toEqual(['cover-letter', 'eight-seconds', 'weekly-note']);
  });

  it('answers a bilingual query with writing in both languages', async () => {
    const response = await db.asOwner((q) =>
      searchReplies(q, { query: 'interview 面試', limit: 10 }),
    );

    expect(response.state).toBe('ready');
    const texts = response.items.map((item) => item.full_text);
    expect(texts.some((text) => text.toLowerCase().includes('interview'))).toBe(true);
    expect(texts.some((text) => text.includes('面試'))).toBe(true);
  });

  it('returns three matches and a cursor, and never repeats a row across pages', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const page: Awaited<ReturnType<typeof searchReplies>> = await db.asOwner((q) =>
        searchReplies(q, { query: 'interview', cursor }),
      );
      expect(page.state).toBe('ready');
      expect(page.items.length).toBeLessThanOrEqual(3);
      if (pages === 0) {
        expect(page.items).toHaveLength(3);
        // Every one of the first three literally contains the word.
        for (const item of page.items) {
          expect(item.full_text.toLowerCase()).toContain('interview');
        }
      }
      seen.push(...page.items.map((item) => item.id));
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor && pages < 20);

    expect(cursor).toBeNull();
    expect(pages).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(seen.length);

    // All seven replies containing the word are reachable by paging.
    const reachable = new Set(seen.map(keyOf));
    for (const spec of CORPUS.filter((s) => s.text.toLowerCase().includes('interview'))) {
      expect(reachable.has(spec.key)).toBe(true);
    }
  });

  it('returns the same first page twice, so a cursor is stable', async () => {
    const first = await db.asOwner((q) => searchReplies(q, { query: 'interview' }));
    const again = await db.asOwner((q) => searchReplies(q, { query: 'interview' }));

    expect(again.items.map((i) => i.id)).toEqual(first.items.map((i) => i.id));
    expect(again.next_cursor).toBe(first.next_cursor);
  });

  it('refuses a cursor minted for a different query rather than interleaving two sets', async () => {
    const first = await db.asOwner((q) => searchReplies(q, { query: 'interview' }));
    expect(first.next_cursor).not.toBeNull();

    await expect(
      db.asOwner((q) => searchReplies(q, { query: 'referral', cursor: first.next_cursor })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('separates a search that found nothing from a search that did not run', async () => {
    const empty = await db.asOwner((q) => searchReplies(q, { query: 'zzqqxxvv' }));
    expect(empty).toEqual({ state: 'empty', items: [], next_cursor: null });

    const broken: SqlRunner = {
      query: () => Promise.reject(new Error('connection reset')),
    };
    const failed = await searchReplies(broken, { query: 'interview' });
    expect(failed).toEqual({ state: 'error', items: [], next_cursor: null });
  });

  it('carries the exact recorded text alongside the excerpt', async () => {
    const response = await db.asOwner((q) => searchReplies(q, { query: '面試', limit: 3 }));
    const item = response.items[0]!;
    const spec = CORPUS.find((s) => s.key === keyOf(item.id))!;

    expect(item.full_text).toBe(spec.text);
    expect(item.date_precision).toBe('timestamp');
  });
});

describe('contextSnippets', () => {
  it('never returns more than the generation ceiling', async () => {
    const snippets = await db.asOwner((q) =>
      contextSnippets(q, { query: 'interview', limit: 50 }),
    );

    expect(snippets.length).toBeLessThanOrEqual(7);
    expect(snippets.every((s) => s.provenance !== 'ai_draft')).toBe(true);
  });

  it('returns nothing rather than throwing when retrieval fails', async () => {
    const broken: SqlRunner = { query: () => Promise.reject(new Error('down')) };
    await expect(contextSnippets(broken, { query: 'interview' })).resolves.toEqual([]);
  });
});


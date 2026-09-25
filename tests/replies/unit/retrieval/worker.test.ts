import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { QueryRunner, TestDatabase } from '../../support/db';
import { createRetrievalDatabase } from './harness';
import { contentHash, searchText } from '@/replies/lib/contracts/text';
import { EMBEDDING, embeddingBackoffSeconds } from '@/replies/lib/contracts/limits';
import { searchReplies } from '@/replies/lib/retrieval/search';
import {
  createEmbedder,
  fakeEmbedder,
  unconfiguredEmbedder,
  type Embedder,
} from '@/replies/lib/embeddings/provider';
import { claimEmbeddingJobs, processEmbeddingJobs } from '@/replies/lib/embeddings/worker';

/**
 * SAVE-04 and the outbox properties from C05.
 *
 * The question every test here asks is the same one: after this goes wrong, can
 * the owner still find what they wrote? Saving must never wait on an embedding,
 * and no embedding outcome may take a reply out of lexical search.
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

const OPERATION_KEY = 'aaaaaaaa-0000-4000-8000-00000000a001';
const MODEL = 'synthetic-embedding-model';
const REPLY_TEXT =
  'A recruiter asked about my salary expectations and I answered with the scope of the role.';

async function recordReply(q: QueryRunner, text = REPLY_TEXT): Promise<string> {
  const session = await q.query<{ id: string }>(
    `insert into public.reply_sessions (user_id, platform, draft_hash, editor_version, draft_text)
     values ((select auth.uid()), 'linkedin', 'draft-hash', 3, $1)
     returning id::text as id`,
    [text],
  );
  const { rows } = await q.query<{ result: { reply_id: string } }>(
    `select public.record_reply($1::uuid, $2, $3::uuid, 3, $4, $5, $6, null, null, '[]'::jsonb, $7) as result`,
    [
      OPERATION_KEY,
      'fingerprint-1',
      session.rows[0]!.id,
      text,
      contentHash(text),
      searchText(text),
      MODEL,
    ],
  );
  return rows[0]!.result.reply_id;
}

interface JobRow {
  status: string;
  attempts: number;
  next_attempt_at: string;
  last_error_code: string | null;
  text_hash: string;
}

/**
 * The database's own clock, not the test runner's.
 *
 * `record_reply` stamps `next_attempt_at` with the transaction's `now()`, so a
 * worker clock pinned to a hard-coded literal would sit in the past and claim
 * nothing. Basing the injected clock on the row's own time keeps the test about
 * lease and backoff behaviour rather than about whose wall clock is ahead.
 */
async function databaseNow(q: QueryRunner): Promise<number> {
  const { rows } = await q.query<{ at: string }>(
    `select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
  );
  return Date.parse(rows[0]!.at) + 1000;
}

async function jobs(q: QueryRunner): Promise<JobRow[]> {
  const { rows } = await q.query<JobRow>(
    `select status::text as status, attempts,
            to_char(next_attempt_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as next_attempt_at,
            last_error_code, text_hash
     from public.embedding_jobs order by created_at, text_hash`,
  );
  return rows;
}

const failingEmbedder: Embedder = {
  mode: 'live',
  model: MODEL,
  embed: async () => ({
    status: 'failed',
    model: MODEL,
    code: 'provider_unavailable',
    retryable: true,
  }),
};

describe('embedding worker', () => {
  it('leaves a just-saved reply findable while no provider is configured', async () => {
    await db.asOwner(async (q) => {
      await recordReply(q);
      const at = new Date(await databaseNow(q));

      const report = await processEmbeddingJobs(q, unconfiguredEmbedder(MODEL), {
        now: () => at,
      });

      expect(report).toMatchObject({ claimed: 1, released: 1, dead: 0, retried: 0 });

      // The attempt is handed back: an unconfigured provider is not a failure.
      const [job] = await jobs(q);
      expect(job).toMatchObject({ status: 'pending', attempts: 0, last_error_code: null });

      const found = await searchReplies(q, { query: 'recruiter salary' });
      expect(found.state).toBe('ready');
      expect(found.items[0]!.full_text).toBe(REPLY_TEXT);
    });
  });

  it('does not let a stale job overwrite a corrected reply', async () => {
    const corrected = 'A recruiter asked about my salary expectations and I named a band instead.';

    await db.asOwner(async (q) => {
      const replyId = await recordReply(q);

      await q.query(`select public.correct_reply($1::uuid, 0, $2, $3, $4, 'typo', $5)`, [
        replyId,
        corrected,
        contentHash(corrected),
        searchText(corrected),
        MODEL,
      ]);

      const at = new Date(await databaseNow(q));
      const report = await processEmbeddingJobs(q, fakeEmbedder(MODEL), { now: () => at });

      // Two jobs exist: the original and the correction's. Only one of them is
      // still describing the text that is actually indexed.
      expect(report.claimed).toBe(2);
      expect(report.superseded).toBe(1);

      const rows = await jobs(q);
      const stale = rows.find((row) => row.text_hash === contentHash(REPLY_TEXT))!;
      expect(stale.status).toBe('done');
      expect(stale.last_error_code).toBe('superseded_by_newer_text');

      const document = await q.query<{ text_hash: string; search_text: string }>(
        `select text_hash, search_text from public.search_documents where entity_id = $1::uuid`,
        [replyId],
      );
      expect(document.rows[0]!.text_hash).toBe(contentHash(corrected));
      expect(document.rows[0]!.search_text).toBe(searchText(corrected));

      const found = await searchReplies(q, { query: 'named a band' });
      expect(found.items[0]!.full_text).toBe(corrected);
    });
  });

  it('retries with growing backoff, then goes dead without losing lexical search', async () => {
    await db.asOwner(async (q) => {
      await recordReply(q);

      const start = await databaseNow(q);
      const deltas: number[] = [];
      let elapsedSeconds = 0;

      for (let attempt = 1; attempt <= EMBEDDING.maxAttempts; attempt += 1) {
        const at = new Date(start + elapsedSeconds * 1000);
        const report = await processEmbeddingJobs(q, failingEmbedder, { now: () => at });
        expect(report.claimed).toBe(1);

        const [job] = await jobs(q);
        const scheduled = (Date.parse(job!.next_attempt_at) - at.getTime()) / 1000;
        if (attempt < EMBEDDING.maxAttempts) {
          expect(report.retried).toBe(1);
          expect(job!.status).toBe('retry');
          deltas.push(scheduled);
          elapsedSeconds += scheduled;
        } else {
          expect(report.dead).toBe(1);
          expect(job!.status).toBe('dead');
          expect(job!.last_error_code).toBe('provider_unavailable');
        }
      }

      expect(deltas).toEqual([1, 2, 3, 4].map((n) => embeddingBackoffSeconds(n)));
      expect(deltas).toEqual([15, 30, 60, 120]);

      // Dead means "stop trying automatically", not "forget the reply".
      const found = await searchReplies(q, { query: 'recruiter salary' });
      expect(found.state).toBe('ready');
      expect(found.items[0]!.full_text).toBe(REPLY_TEXT);
    });
  });

  it('will not claim a job that another worker still holds a lease on', async () => {
    await db.asOwner(async (q) => {
      await recordReply(q);
      const at = new Date(await databaseNow(q));

      const first = await claimEmbeddingJobs(q, { now: () => at });
      expect(first).toHaveLength(1);
      expect(first[0]!.attempts).toBe(1);

      const second = await claimEmbeddingJobs(q, { now: () => at });
      expect(second).toHaveLength(0);

      // Once the lease has run out the job is reclaimable, so a worker that died
      // mid-job does not strand it forever.
      const later = new Date(at.getTime() + (EMBEDDING.leaseSeconds + 1) * 1000);
      const third = await claimEmbeddingJobs(q, { now: () => later });
      expect(third).toHaveLength(1);
      expect(third[0]!.attempts).toBe(2);
    });
  });

  it('scopes claims to one owner when the worker is told which owner to serve', async () => {
    await db.asOwner(async (q) => {
      await recordReply(q);
      const at = new Date(await databaseNow(q));

      const wrongOwner = await claimEmbeddingJobs(q, {
        now: () => at,
        ownerId: '22222222-2222-4222-8222-222222222222',
      });
      expect(wrongOwner).toHaveLength(0);
    });
  });

  it('reports that this database cannot store a vector rather than claiming it did', async () => {
    await db.asOwner(async (q) => {
      const replyId = await recordReply(q);
      const at = new Date(await databaseNow(q));

      const report = await processEmbeddingJobs(q, fakeEmbedder(MODEL), { now: () => at });

      // pgvector is absent from this build, so there is nowhere to put the
      // vector. The job finishes and the row keeps no embedding metadata.
      expect(report).toMatchObject({ claimed: 1, storageUnavailable: 1, applied: 0 });

      const { rows } = await q.query<{ embedded_at: string | null; embedding_model: string | null }>(
        `select embedded_at, embedding_model from public.search_documents where entity_id = $1::uuid`,
        [replyId],
      );
      expect(rows[0]).toMatchObject({ embedded_at: null, embedding_model: null });
    });
  });
});

describe('createEmbedder', () => {
  it('returns an unconfigured embedder when no key is present, and does not throw', async () => {
    const embedder = createEmbedder({
      generation: { mode: 'unconfigured', provider: 'anthropic', model: 'x' },
      embedding: { mode: 'unconfigured', provider: 'openai', model: 'text-embedding-3-small' },
    });

    expect(embedder.mode).toBe('unconfigured');
    await expect(embedder.embed(['anything'])).resolves.toMatchObject({
      status: 'not_configured',
    });
  });

  it('produces the same vector for the same text, at the indexed dimension', async () => {
    const embedder = createEmbedder({
      generation: { mode: 'fake', provider: 'fake', model: 'fake' },
      embedding: { mode: 'fake', provider: 'fake', model: 'fake' },
    });

    const first = await embedder.embed(['面試準備', 'salary negotiation']);
    const second = await embedder.embed(['面試準備', 'salary negotiation']);

    expect(first.status).toBe('ok');
    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('unreachable');
    expect(first.vectors).toHaveLength(2);
    expect(first.vectors[0]).toHaveLength(EMBEDDING.dimensions);
    expect(first.vectors).toEqual(second.vectors);
    expect(first.vectors[0]).not.toEqual(first.vectors[1]);
  });

  it('rejects a provider vector of the wrong dimension instead of reshaping it', async () => {
    const embedder = createEmbedder(
      {
        generation: { mode: 'unconfigured', provider: 'anthropic', model: 'x' },
        embedding: { mode: 'live', provider: 'openai', model: MODEL, apiKey: 'synthetic-key' },
      },
      {
        fetch: async () =>
          new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
    );

    await expect(embedder.embed(['one input'])).resolves.toMatchObject({
      status: 'failed',
      code: 'provider_invalid_response',
      retryable: false,
    });
  });

  it('accepts a well-formed provider response', async () => {
    const vector = Array.from({ length: EMBEDDING.dimensions }, (_, i) => i / EMBEDDING.dimensions);
    let requestedUrl = '';
    const embedder = createEmbedder(
      {
        generation: { mode: 'unconfigured', provider: 'anthropic', model: 'x' },
        embedding: { mode: 'live', provider: 'openai', model: MODEL, apiKey: 'synthetic-key' },
      },
      {
        baseUrl: 'https://embeddings.example.com',
        fetch: async (url) => {
          requestedUrl = String(url);
          return new Response(JSON.stringify({ data: [{ embedding: vector }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    );

    const result = await embedder.embed(['one input']);
    expect(requestedUrl).toBe('https://embeddings.example.com/v1/embeddings');
    expect(result).toMatchObject({ status: 'ok', model: MODEL });
  });

  it('turns a rate limit into a retryable failure rather than an exception', async () => {
    const embedder = createEmbedder(
      {
        generation: { mode: 'unconfigured', provider: 'anthropic', model: 'x' },
        embedding: { mode: 'live', provider: 'openai', model: MODEL, apiKey: 'synthetic-key' },
      },
      { fetch: async () => new Response('', { status: 429 }) },
    );

    await expect(embedder.embed(['one input'])).resolves.toMatchObject({
      status: 'failed',
      code: 'rate_limited',
      retryable: true,
    });
  });
});


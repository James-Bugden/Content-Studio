import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { contentHash, searchText } from '@/replies/lib/contracts/text';
import type { Embedder } from '@/replies/lib/embeddings/provider';
import { resolveOwnerScope, runOwnerScopedPass } from '@/replies/lib/embeddings/worker';
import type { SqlRunner } from '@/replies/lib/retrieval/runner';
import { OWNER_ID, OTHER_USER_ID, type TestDatabase } from '../../support/db';
import { createRetrievalDatabase, seedReplies } from '../retrieval/harness';

/**
 * The worker's owner predicate (C01).
 *
 * `db.raw` is used deliberately throughout. It is the superuser connection, so
 * row-level security is not the boundary, which is exactly the situation a
 * background worker is in: it holds an administrative credential and there is no
 * session behind it. Anything it does not scope for itself, nothing else will.
 *
 * Every string below is invented. The second user is a synthetic intruder, and
 * the point of the test is that their writing never leaves the database.
 */

let db: TestDatabase;

beforeAll(async () => {
  db = await createRetrievalDatabase();
}, 180_000);

beforeEach(async () => {
  await db.reset();
  await db.raw.exec(`delete from private.app_owner;`);
  await db.raw.query(`insert into private.app_owner (user_id) values ($1::uuid)`, [OWNER_ID]);
});

afterAll(async () => {
  await db?.close();
});

const MODEL = 'synthetic-embedding-model';

const OWNER_TEXT =
  'My own note about asking a recruiter what the top of the band is paid for.';
const INTRUDER_TEXT =
  'Another account private note that this worker has no business reading at all.';

/** Records what it was asked to embed. It is the evidence, not a stub. */
function recordingEmbedder(seen: string[][]): Embedder {
  return {
    mode: 'fake',
    model: MODEL,
    async embed(texts) {
      seen.push([...texts]);
      return { status: 'ok', model: MODEL, vectors: texts.map(() => [0]) };
    },
  };
}

/** Queues a job for a search document that `seedReplies` already wrote. */
async function queueJob(userId: string, text: string): Promise<void> {
  await db.raw.query(
    `insert into public.embedding_jobs (user_id, entity_kind, entity_id, text_hash, model)
     select d.user_id, d.entity_kind, d.entity_id, d.text_hash, $3
     from public.search_documents d
     where d.user_id = $1::uuid and d.text_hash = $2`,
    [userId, contentHash(text), MODEL],
  );
}

async function seedBothOwners(): Promise<void> {
  await seedReplies(db, OWNER_ID, [
    { key: 'owner', platform: 'linkedin', postedAt: '2026-09-01T09:00:00Z', text: OWNER_TEXT },
  ]);
  await seedReplies(db, OTHER_USER_ID, [
    {
      key: 'intruder',
      platform: 'linkedin',
      postedAt: '2026-09-01T09:00:00Z',
      text: INTRUDER_TEXT,
      ownerId: OTHER_USER_ID,
    },
  ]);
  await queueJob(OWNER_ID, OWNER_TEXT);
  await queueJob(OTHER_USER_ID, INTRUDER_TEXT);
}

async function jobStatus(userId: string): Promise<{ status: string; attempts: number }> {
  const { rows } = await db.raw.query<{ status: string; attempts: number }>(
    `select status::text as status, attempts from public.embedding_jobs where user_id = $1::uuid`,
    [userId],
  );
  return rows[0]!;
}

describe('the embedding worker over an administrative connection', () => {
  it('embeds the owner and never reads the other account, whose rows RLS is not hiding here', async () => {
    await seedBothOwners();
    const seen: string[][] = [];

    const outcome = await runOwnerScopedPass(db.raw as SqlRunner, recordingEmbedder(seen));

    expect(outcome.status).toBe('ran');
    if (outcome.status !== 'ran') return;
    expect(outcome.ownerId).toBe(OWNER_ID);
    expect(outcome.report.claimed).toBe(1);

    const embedded = seen.flat();
    expect(embedded).toContain(searchText(OWNER_TEXT));
    expect(embedded).not.toContain(searchText(INTRUDER_TEXT));

    // The other account's job is untouched: not claimed, not attempted, not
    // released with an error code that would need explaining later.
    expect(await jobStatus(OTHER_USER_ID)).toEqual({ status: 'pending', attempts: 0 });
  });

  it('refuses the whole pass when no owner is enabled, rather than serving everybody', async () => {
    await seedBothOwners();
    await db.raw.exec(`delete from private.app_owner;`);
    const seen: string[][] = [];

    const outcome = await runOwnerScopedPass(db.raw as SqlRunner, recordingEmbedder(seen));

    expect(outcome).toEqual({ status: 'refused', reason: 'no_enabled_owner' });
    expect(seen).toEqual([]);
    expect(await jobStatus(OWNER_ID)).toEqual({ status: 'pending', attempts: 0 });
    expect(await jobStatus(OTHER_USER_ID)).toEqual({ status: 'pending', attempts: 0 });
  });

  it('refuses when the owner table cannot be read at all', async () => {
    const broken: SqlRunner = {
      query: async () => {
        throw new Error('permission denied for schema private');
      },
    };
    expect(await resolveOwnerScope(broken)).toEqual({
      ok: false,
      reason: 'owner_lookup_failed',
    });
  });

  it('resolves the single enabled owner when there is one', async () => {
    expect(await resolveOwnerScope(db.raw as SqlRunner)).toEqual({
      ok: true,
      ownerId: OWNER_ID,
    });
  });
});


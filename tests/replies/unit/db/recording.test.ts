import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  createTestDatabase,
  type TestDatabase,
  type QueryRunner,
  expectRejection,
} from '../../support/db';

/**
 * SAVE-02, SAVE-03, DAY-01 and DAY-02: the recording transaction and the derived
 * counters.
 *
 * Every assertion here is about a thing that goes wrong in the real world — a
 * double click, a lost response, a retry from a second tab, a correction, midnight
 * in Taipei — rather than about the happy path being happy.
 */

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

const KEY_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const KEY_B = 'bbbbbbbb-0000-4000-8000-000000000002';

async function newSession(q: QueryRunner, platform = 'linkedin'): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `insert into public.reply_sessions (user_id, platform, draft_hash, editor_version, draft_text)
     values ((select auth.uid()), $1, 'draft-hash', 3, 'the draft')
     returning id`,
    [platform],
  );
  return rows[0]!.id;
}

function recordCall(
  q: QueryRunner,
  args: {
    key: string;
    fingerprint: string;
    sessionId: string;
    editorVersion?: number;
    text: string;
    hash?: string;
  },
) {
  return q.query<{ result: { reply_id: string; replayed: boolean } }>(
    `select public.record_reply($1::uuid, $2, $3::uuid, $4, $5, $6, $7) as result`,
    [
      args.key,
      args.fingerprint,
      args.sessionId,
      args.editorVersion ?? 3,
      args.text,
      args.hash ?? `hash:${args.text}`,
      args.text.toLowerCase(),
    ],
  );
}

async function countReplies(): Promise<number> {
  const { rows } = await db.raw.query<{ n: string }>(
    `select count(*)::text as n from public.reply_library`,
  );
  return Number(rows[0]!.n);
}

describe('record_reply', () => {
  it('records one reply, marks the session recorded and queues the index work', async () => {
    const result = await db.asOwner(async (q) => {
      const sessionId = await newSession(q);
      const { rows } = await recordCall(q, {
        key: KEY_A,
        fingerprint: 'fp-1',
        sessionId,
        text: 'Thanks, this is the reply I posted.',
      });
      const session = await q.query<{ state: string }>(
        `select state from public.reply_sessions where id = $1`,
        [sessionId],
      );
      const search = await q.query<{ n: string }>(
        `select count(*)::text as n from public.search_documents where entity_id = $1`,
        [rows[0]!.result.reply_id],
      );
      const jobs = await q.query<{ n: string }>(
        `select count(*)::text as n from public.embedding_jobs where entity_id = $1`,
        [rows[0]!.result.reply_id],
      );
      return {
        replayed: rows[0]!.result.replayed,
        state: session.rows[0]!.state,
        search: search.rows[0]!.n,
        jobs: jobs.rows[0]!.n,
      };
    });

    expect(result).toEqual({ replayed: false, state: 'recorded', search: '1', jobs: '1' });
    expect(await countReplies()).toBe(1);
  });

  it('records the submitted text byte for byte', async () => {
    const exact = '謝謝分享 🙏\n\n  第二段落  \t';
    const stored = await db.asOwner(async (q) => {
      const sessionId = await newSession(q, 'threads');
      const { rows } = await recordCall(q, {
        key: KEY_A,
        fingerprint: 'fp-exact',
        sessionId,
        text: exact,
      });
      const reply = await q.query<{ final_text: string }>(
        `select final_text from public.reply_library where id = $1`,
        [rows[0]!.result.reply_id],
      );
      return reply.rows[0]!.final_text;
    });
    expect(stored).toBe(exact);
  });

  it('replays the same key with the same payload instead of inserting twice', async () => {
    const outcome = await db.asOwner(async (q) => {
      const sessionId = await newSession(q);
      const first = await recordCall(q, {
        key: KEY_A,
        fingerprint: 'fp-1',
        sessionId,
        text: 'Same text',
      });
      const second = await recordCall(q, {
        key: KEY_A,
        fingerprint: 'fp-1',
        sessionId,
        text: 'Same text',
      });
      return { first: first.rows[0]!.result, second: second.rows[0]!.result };
    });

    expect(outcome.second.replayed).toBe(true);
    expect(outcome.second.reply_id).toBe(outcome.first.reply_id);
    expect(await countReplies()).toBe(1);
  });

  it('conflicts when the same key arrives with a different payload', async () => {
    const error = await expectRejection(
      db.asOwner(async (q) => {
        const sessionId = await newSession(q);
        await recordCall(q, { key: KEY_A, fingerprint: 'fp-1', sessionId, text: 'First' });
        await recordCall(q, { key: KEY_A, fingerprint: 'fp-2', sessionId, text: 'Changed' });
      }),
    );
    expect(error.message).toMatch(/different payload/);
  });

  it('returns the existing record when a second key retries an already-recorded session', async () => {
    const outcome = await db.asOwner(async (q) => {
      const sessionId = await newSession(q);
      const first = await recordCall(q, {
        key: KEY_A,
        fingerprint: 'fp-1',
        sessionId,
        text: 'Recorded once',
      });
      const second = await recordCall(q, {
        key: KEY_B,
        fingerprint: 'fp-2',
        sessionId,
        text: 'Recorded once',
      });
      return { first: first.rows[0]!.result, second: second.rows[0]!.result };
    });

    expect(outcome.second.replayed).toBe(true);
    expect(outcome.second.reply_id).toBe(outcome.first.reply_id);
    expect(await countReplies()).toBe(1);
  });

  it('refuses a second key that would record different text for a recorded session', async () => {
    const error = await expectRejection(
      db.asOwner(async (q) => {
        const sessionId = await newSession(q);
        await recordCall(q, { key: KEY_A, fingerprint: 'fp-1', sessionId, text: 'Original' });
        await recordCall(q, { key: KEY_B, fingerprint: 'fp-2', sessionId, text: 'Different' });
      }),
    );
    expect(error.message).toMatch(/already recorded with different text/);
    expect(await countReplies()).toBe(0); // the whole transaction rolled back
  });

  it('refuses a stale editor version', async () => {
    const error = await expectRejection(
      db.asOwner(async (q) => {
        const sessionId = await newSession(q);
        await recordCall(q, {
          key: KEY_A,
          fingerprint: 'fp-1',
          sessionId,
          editorVersion: 2,
          text: 'Stale',
        });
      }),
    );
    expect(error.message).toMatch(/editor version is stale/);
  });

  it('refuses a session that does not exist or is not owned', async () => {
    const error = await expectRejection(
      db.asOwner((q) =>
        recordCall(q, {
          key: KEY_A,
          fingerprint: 'fp-1',
          sessionId: '99999999-9999-4999-8999-999999999999',
          text: 'Nope',
        }),
      ),
    );
    expect(error.message).toMatch(/session not found/);
  });

  it('rolls back every write when any part of the transaction fails', async () => {
    const error = await expectRejection(
      db.asOwner(async (q) => {
        const sessionId = await newSession(q);
        // An all-whitespace reply trips the database check after the mutation key,
        // the session lock and the key claim have already happened.
        await recordCall(q, { key: KEY_A, fingerprint: 'fp-1', sessionId, text: '   ' });
      }),
    );
    expect(error.message).toMatch(/reply_library_text_nonblank/);

    const leftovers = await db.raw.query<{ keys: string; replies: string; jobs: string }>(
      `select (select count(*)::text from public.mutation_keys) as keys,
              (select count(*)::text from public.reply_library) as replies,
              (select count(*)::text from public.embedding_jobs) as jobs`,
    );
    expect(leftovers.rows[0]).toEqual({ keys: '0', replies: '0', jobs: '0' });
  });
});

describe('daily counts (DAY-01)', () => {
  async function seedAt(instants: { platform: string; at: string }[]) {
    await db.asOwner(async (q) => {
      for (const [index, row] of instants.entries()) {
        await q.query(
          `insert into public.reply_library
             (user_id, platform, final_text, search_text, provenance, publication_evidence,
              content_hash, date_precision, posted_at)
           values ((select auth.uid()), $1, $2, $2, 'posted_confirmed', 'user_confirmed',
                   $3, 'timestamp', $4::timestamptz)`,
          [row.platform, `reply ${index}`, `hash-${index}`, row.at],
        );
      }
    });
  }

  async function countsFor(day: string) {
    const { rows } = await db.asOwner((q) =>
      q.query<{ result: { counts: Record<string, number>; local_day: string } }>(
        `select public.daily_counts('Asia/Taipei', $1::date) as result`,
        [day],
      ),
    );
    return rows[0]!.result;
  }

  it('puts 23:59:59 and 00:00:00 Taipei on the days the owner would call them', async () => {
    // Taipei is UTC+8 with no daylight saving.
    await seedAt([
      { platform: 'x', at: '2026-03-10T15:59:59Z' }, // 2026-03-10 23:59:59 Taipei
      { platform: 'x', at: '2026-03-10T16:00:00Z' }, // 2026-03-11 00:00:00 Taipei
    ]);

    expect((await countsFor('2026-03-10')).counts.x).toBe(1);
    expect((await countsFor('2026-03-11')).counts.x).toBe(1);
  });

  it('is unaffected by the process timezone', async () => {
    await seedAt([{ platform: 'linkedin', at: '2026-03-10T16:30:00Z' }]);
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      expect((await countsFor('2026-03-11')).counts.linkedin).toBe(1);
    } finally {
      process.env.TZ = original;
    }
  });

  it('reports 11 against a target of 10 rather than clamping', async () => {
    await seedAt(
      Array.from({ length: 11 }, () => ({ platform: 'threads', at: '2026-03-10T16:30:00Z' })),
    );
    const result = await countsFor('2026-03-11');
    expect(result.counts.threads).toBe(11);
  });

  it('ignores drafts, main posts, AI drafts and withdrawn records', async () => {
    await db.asOwner(async (q) => {
      for (const [index, provenance] of [
        'user_edited_unconfirmed',
        'published_main_post',
        'ai_draft',
      ].entries()) {
        await q.query(
          `insert into public.reply_library
             (user_id, platform, final_text, search_text, provenance, publication_evidence,
              content_hash, date_precision, posted_at)
           values ((select auth.uid()), 'x', $1, $1, $2::public.provenance, 'unknown',
                   $3, 'timestamp', '2026-03-10T16:30:00Z')`,
          [`row ${index}`, provenance, `h${index}`],
        );
      }
      await q.query(
        `insert into public.reply_library
           (user_id, platform, final_text, search_text, provenance, publication_evidence,
            content_hash, date_precision, posted_at, withdrawn_at)
         values ((select auth.uid()), 'x', 'withdrawn', 'withdrawn', 'posted_confirmed',
                 'user_confirmed', 'hw', 'timestamp', '2026-03-10T16:30:00Z', now())`,
      );
    });

    expect((await countsFor('2026-03-11')).counts.x).toBe(0);
  });

  it('never counts an unknown date, and never counts an unproven local day', async () => {
    await db.asOwner(async (q) => {
      await q.query(
        `insert into public.reply_library
           (user_id, platform, final_text, search_text, provenance, publication_evidence,
            content_hash, date_precision)
         values ((select auth.uid()), 'linkedin', 'undated', 'undated', 'posted_confirmed',
                 'user_confirmed', 'h-undated', 'unknown')`,
      );
      // A date-only record whose own timezone is not the counting timezone: its
      // Taipei day is a guess, so it stays out of a precise count.
      await q.query(
        `insert into public.reply_library
           (user_id, platform, final_text, search_text, provenance, publication_evidence,
            content_hash, date_precision, posted_date, source_timezone)
         values ((select auth.uid()), 'linkedin', 'elsewhere', 'elsewhere', 'posted_confirmed',
                 'user_confirmed', 'h-elsewhere', 'date_only', '2026-03-11', 'America/New_York')`,
      );
      // A date-only record recorded in Taipei does count: its local day is proven.
      await q.query(
        `insert into public.reply_library
           (user_id, platform, final_text, search_text, provenance, publication_evidence,
            content_hash, date_precision, posted_date, source_timezone)
         values ((select auth.uid()), 'linkedin', 'taipei', 'taipei', 'posted_confirmed',
                 'user_confirmed', 'h-taipei', 'date_only', '2026-03-11', 'Asia/Taipei')`,
      );
    });

    expect((await countsFor('2026-03-11')).counts.linkedin).toBe(1);
  });

  it('importing last year does not move today', async () => {
    await seedAt([{ platform: 'x', at: '2025-03-10T16:30:00Z' }]);
    expect((await countsFor('2026-03-11')).counts.x).toBe(0);
    expect((await countsFor('2025-03-11')).counts.x).toBe(1);
  });
});

describe('corrections and withdrawal (DAY-02)', () => {
  it('a correction appends a revision and adds no reply event', async () => {
    const outcome = await db.asOwner(async (q) => {
      const sessionId = await newSession(q);
      const { rows } = await recordCall(q, {
        key: KEY_A,
        fingerprint: 'fp-1',
        sessionId,
        text: 'Original text',
      });
      const replyId = rows[0]!.result.reply_id;

      await q.query(`select public.correct_reply($1::uuid, 0, $2, $3, $4, $5)`, [
        replyId,
        'Corrected text',
        'hash-corrected',
        'corrected text',
        'fixed a typo',
      ]);

      const reply = await q.query<{ final_text: string; revision: number }>(
        `select final_text, revision from public.reply_library where id = $1`,
        [replyId],
      );
      const revisions = await q.query<{ text: string; revision_number: number }>(
        `select text, revision_number from public.reply_revisions where reply_id = $1`,
        [replyId],
      );
      return { reply: reply.rows[0]!, revisions: revisions.rows };
    });

    expect(outcome.reply.final_text).toBe('Corrected text');
    expect(outcome.reply.revision).toBe(1);
    expect(outcome.revisions).toEqual([{ text: 'Original text', revision_number: 1 }]);
    expect(await countReplies()).toBe(1);
  });

  it('a stale revision number is refused', async () => {
    const error = await expectRejection(
      db.asOwner(async (q) => {
        const sessionId = await newSession(q);
        const { rows } = await recordCall(q, {
          key: KEY_A,
          fingerprint: 'fp-1',
          sessionId,
          text: 'Original',
        });
        await q.query(`select public.correct_reply($1::uuid, 7, 'x', 'h', 'x', '')`, [
          rows[0]!.result.reply_id,
        ]);
      }),
    );
    expect(error.message).toMatch(/revision is stale/);
  });

  it('withdrawing removes the count without deleting the record', async () => {
    const counts = await db.asOwner(async (q) => {
      const sessionId = await newSession(q, 'x');
      const { rows } = await recordCall(q, {
        key: KEY_A,
        fingerprint: 'fp-1',
        sessionId,
        text: 'Posted reply',
      });
      const replyId = rows[0]!.result.reply_id;

      const before = await q.query<{ result: { counts: Record<string, number> } }>(
        `select public.daily_counts('Asia/Taipei') as result`,
      );
      await q.query(`select public.set_reply_withdrawn($1::uuid, true)`, [replyId]);
      const after = await q.query<{ result: { counts: Record<string, number> } }>(
        `select public.daily_counts('Asia/Taipei') as result`,
      );
      const stillThere = await q.query<{ n: string }>(
        `select count(*)::text as n from public.reply_library where id = $1`,
        [replyId],
      );
      return {
        before: before.rows[0]!.result.counts.x,
        after: after.rows[0]!.result.counts.x,
        stillThere: stillThere.rows[0]!.n,
      };
    });

    expect(counts).toEqual({ before: 1, after: 0, stillThere: '1' });
  });
});

describe('manual capture (D11)', () => {
  it('defaults an unknown date to unknown, not to today', async () => {
    const stored = await db.asOwner(async (q) => {
      const { rows } = await q.query<{ result: { reply_id: string } }>(
        `select public.record_manual_reply($1::uuid, 'fp', 'x', $2, 'h', $3, 'unknown') as result`,
        [KEY_A, 'A reply written elsewhere', 'a reply written elsewhere'],
      );
      const reply = await q.query<{
        posted_at: string | null;
        posted_date: string | null;
        date_precision: string;
        publication_evidence: string;
      }>(
        `select posted_at, posted_date, date_precision, publication_evidence
         from public.reply_library where id = $1`,
        [rows[0]!.result.reply_id],
      );
      return reply.rows[0]!;
    });

    expect(stored.posted_at).toBeNull();
    expect(stored.posted_date).toBeNull();
    expect(stored.date_precision).toBe('unknown');
    expect(stored.publication_evidence).toBe('user_confirmed');
  });

  it('is idempotent on the same operation key', async () => {
    await db.asOwner(async (q) => {
      for (let i = 0; i < 2; i += 1) {
        await q.query(
          `select public.record_manual_reply($1::uuid, 'fp', 'x', $2, 'h', $3, 'unknown')`,
          [KEY_A, 'Repeated submit', 'repeated submit'],
        );
      }
    });
    expect(await countReplies()).toBe(1);
  });
});


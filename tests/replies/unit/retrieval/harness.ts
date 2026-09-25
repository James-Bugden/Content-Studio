import { contentHash, searchText } from '@/replies/lib/contracts/text';
import type {
  Platform,
  Provenance,
  PublicationEvidence,
} from '@/replies/lib/contracts/vocabulary';
import { createTestDatabase, type TestDatabase } from '../../support/db';

/**
 * Shared fixtures for the retrieval suite.
 *
 * Every piece of text below is invented for these tests. None of it is anything
 * the owner wrote, and no identifier here belongs to a real account: the
 * repository is public and a corpus fixture is exactly the kind of file that
 * leaks private writing (C10).
 */

/**
 * Hosted Supabase grants USAGE on `extensions` to anon and authenticated as part
 * of its bootstrap, before any migration runs. The local harness builds a plain
 * Postgres, where `create schema if not exists extensions` produces a schema with
 * no grants at all, so `extensions.similarity(...)` fails for the authenticated
 * role with "permission denied for schema extensions".
 *
 * This line reproduces the platform's own grant so the tests exercise the real
 * query. It is a harness shim, not a fix: see the note in the final report about
 * the migration that should carry this grant itself, so a non-Supabase Postgres
 * is not silently different from the one these tests prove.
 */
const EXTENSIONS_GRANT = `grant usage on schema extensions to anon, authenticated, service_role;`;

export async function createRetrievalDatabase(): Promise<TestDatabase> {
  const db = await createTestDatabase();
  await db.raw.exec(EXTENSIONS_GRANT);
  return db;
}

export interface ReplySpec {
  /** A stable handle for assertions. Never stored. */
  key: string;
  text: string;
  platform: Platform;
  /** ISO-8601. Also used as recorded_at so both orderings agree. */
  postedAt: string;
  provenance?: Provenance;
  evidence?: PublicationEvidence;
  withdrawn?: boolean;
  ownerId?: string;
  /** `unknown` stores no date at all, the way an import with no date must. */
  datePrecision?: 'timestamp' | 'unknown';
}

/**
 * Inserts replies and their search rows with the superuser connection.
 *
 * Seeding bypasses row level security deliberately: a fixture for another owner
 * cannot be written through the owner's own session, and that other-owner row is
 * the only way to prove the explicit owner predicate does its job rather than
 * leaning on RLS to hide the mistake.
 */
export async function seedReplies(
  db: TestDatabase,
  ownerId: string,
  specs: readonly ReplySpec[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const spec of specs) {
    const exact = spec.text;
    const dateKnown = spec.datePrecision !== 'unknown';
    const { rows } = await db.raw.query<{ id: string }>(
      `insert into public.reply_library (
         user_id, platform, final_text, search_text, provenance, publication_evidence,
         posted_at, date_precision, content_hash, recorded_at, withdrawn_at
       )
       values ($1::uuid, $2::public.platform, $3, $4, $5::public.provenance,
               $6::public.publication_evidence, $7::timestamptz,
               $10::public.date_precision, $8, $11::timestamptz, $9::timestamptz)
       returning id::text as id`,
      [
        spec.ownerId ?? ownerId,
        spec.platform,
        exact,
        searchText(exact),
        spec.provenance ?? 'posted_confirmed',
        spec.evidence ?? 'user_confirmed',
        dateKnown ? spec.postedAt : null,
        contentHash(exact),
        spec.withdrawn === true ? spec.postedAt : null,
        dateKnown ? 'timestamp' : 'unknown',
        spec.postedAt,
      ],
    );

    const id = rows[0]!.id;
    ids.set(spec.key, id);

    await db.raw.query(
      `insert into public.search_documents (user_id, entity_kind, entity_id, text_hash, search_text)
       values ($1::uuid, 'reply', $2::uuid, $3, $4)`,
      [spec.ownerId ?? ownerId, id, contentHash(exact), searchText(exact)],
    );
  }

  return ids;
}

/**
 * The judgement corpus.
 *
 * Its shape is the point, not its size. `anchor-negotiation` is the oldest row in
 * the set and the only eligible one containing all three of "recruiter",
 * "salary" and "negotiation"; everything dated 2026 is deliberately about
 * something else. A ranking that preferred recent writing would bury it, which is
 * what the anti-recency test in `search.test.ts` checks.
 */
export const CORPUS: readonly ReplySpec[] = [
  {
    key: 'anchor-negotiation',
    platform: 'linkedin',
    postedAt: '2024-01-05T09:00:00Z',
    text: 'A recruiter once opened with a salary range and I treated the negotiation as a conversation about scope. Ask what the top of the band is paid for, then show the work that sits there.',
  },

  // Recent English writing about other things. None of it matches the anchor
  // query, and all of it is newer.
  {
    key: 'portfolio',
    platform: 'linkedin',
    postedAt: '2026-09-18T09:00:00Z',
    text: 'Your portfolio does more work than your cover letter. Show three projects and what changed because of them.',
  },
  {
    key: 'referral',
    platform: 'linkedin',
    postedAt: '2026-09-17T09:00:00Z',
    text: 'A referral is not a favour. Give the person something concrete they can forward without rewriting it.',
  },
  {
    key: 'advert-wishlist',
    platform: 'x',
    postedAt: '2026-09-16T09:00:00Z',
    text: 'Most job adverts describe a wish list. Answer the first three lines, not the last twenty.',
  },
  {
    key: 'networking',
    platform: 'linkedin',
    postedAt: '2026-09-15T09:00:00Z',
    text: 'Networking is following up on purpose. One message a week beats twenty in a single afternoon.',
  },
  {
    key: 'recruiter-first-line',
    platform: 'linkedin',
    postedAt: '2026-09-14T09:00:00Z',
    text: 'A recruiter reads the first line and the last line. Put the result in both of them.',
  },
  {
    key: 'pay-transparency',
    platform: 'x',
    postedAt: '2026-09-13T09:00:00Z',
    text: 'Salary transparency rules changed what you are allowed to ask for before the first call.',
  },
  {
    key: 'interview-nerves',
    platform: 'linkedin',
    postedAt: '2026-09-12T09:00:00Z',
    text: 'Interview nerves are mostly an unrehearsed opening. Say your first sentence out loud three times.',
  },
  {
    key: 'ship-monthly',
    platform: 'x',
    postedAt: '2026-09-11T09:00:00Z',
    text: 'Ship a small thing publicly every month. It compounds faster than a rewritten summary ever will.',
  },
  {
    key: 'interview-loop',
    platform: 'linkedin',
    postedAt: '2026-09-10T09:00:00Z',
    text: 'Ask for the interview loop in advance. It is a normal request and the answer tells you a great deal.',
  },
  {
    key: 'cover-letter',
    platform: 'linkedin',
    postedAt: '2026-09-09T09:00:00Z',
    text: 'A cover letter that repeats the cv wastes the only free page anyone gives you.',
  },
  {
    key: 'quantify',
    platform: 'linkedin',
    postedAt: '2026-09-08T09:00:00Z',
    text: 'Quantify one result per role. Two numbers beat a paragraph of adjectives every time.',
  },
  {
    key: 'final-round',
    platform: 'linkedin',
    postedAt: '2026-09-07T09:00:00Z',
    text: 'Rejection after a final interview round usually means fit, not capability. Ask for the specific gap.',
  },
  {
    key: 'weekly-note',
    platform: 'x',
    postedAt: '2026-09-06T09:00:00Z',
    text: 'Keep a weekly note of what you shipped. It becomes your cv without any archaeology later.',
  },
  {
    key: 'contract-work',
    platform: 'linkedin',
    postedAt: '2026-09-05T09:00:00Z',
    text: 'Contract work counts. Write it up exactly the way you write a permanent role.',
  },
  {
    key: 'first-quarter',
    platform: 'linkedin',
    postedAt: '2026-09-04T09:00:00Z',
    text: 'A hiring manager wants to know what you will own in the first quarter, in plain words.',
  },
  {
    key: 'follow-up-once',
    platform: 'x',
    postedAt: '2026-09-03T09:00:00Z',
    text: 'Follow up once, specifically, with something new. Then let it go and carry on.',
  },
  {
    key: 'eight-seconds',
    platform: 'linkedin',
    postedAt: '2026-09-02T09:00:00Z',
    text: 'Your cv is read in eight seconds by a person who is tired. Design the page for that reader.',
  },
  {
    key: 'career-change',
    platform: 'linkedin',
    postedAt: '2026-09-01T09:00:00Z',
    text: 'Career changers should lead with the transferable result, never with an apology for the change.',
  },
  {
    key: 'take-home',
    platform: 'linkedin',
    postedAt: '2026-08-31T09:00:00Z',
    text: 'An interview take home task deserves a time box. Say what you cut and why you cut it.',
  },
  {
    key: 'references',
    platform: 'linkedin',
    postedAt: '2026-08-30T09:00:00Z',
    text: 'References are a stage, not a formality. Brief the people you name before you name them.',
  },
  {
    key: 'remote-band',
    platform: 'x',
    postedAt: '2026-08-29T09:00:00Z',
    text: 'Remote roles still sit in a local pay band. Ask early which band applies to you.',
  },
  {
    key: 'last-question',
    platform: 'linkedin',
    postedAt: '2026-08-28T09:00:00Z',
    text: 'The best interview question at the end is about the last person who did this job.',
  },
  {
    key: 'panel-prep',
    platform: 'linkedin',
    postedAt: '2026-08-27T09:00:00Z',
    text: 'A panel interview is four separate conversations. Find out who is in the room beforehand.',
  },
  {
    key: 'screening-call',
    platform: 'x',
    postedAt: '2026-08-26T09:00:00Z',
    text: 'The screening interview is a filter, not a test. Be short, specific and easy to pass along.',
  },

  // Traditional Chinese writing on Threads.
  {
    key: 'zh-interview-breakdown',
    platform: 'threads',
    postedAt: '2026-07-20T09:00:00Z',
    text: '面試前先把職缺描述拆成三個重點，一個一個準備例子，不要背稿。',
  },
  {
    key: 'zh-resume-first-line',
    platform: 'threads',
    postedAt: '2026-07-19T09:00:00Z',
    text: '履歷的第一行要寫結果，不要寫責任範圍，因為責任範圍每個人都一樣。',
  },
  {
    key: 'zh-salary-talk',
    platform: 'threads',
    postedAt: '2026-07-18T09:00:00Z',
    text: '薪資談判不是吵架，是把你的價值講清楚，然後讓對方有台階可以下。',
  },
  {
    key: 'zh-interview-story',
    platform: 'threads',
    postedAt: '2026-07-17T09:00:00Z',
    text: '面試準備最有效的方法，是先把自己的故事講一遍給別人聽，看對方哪裡聽不懂。',
  },
  {
    key: 'zh-feedback',
    platform: 'threads',
    postedAt: '2026-07-16T09:00:00Z',
    text: '被拒絕之後可以禮貌地問回饋，多數主管其實願意講一兩句實話。',
  },
  {
    key: 'zh-career-change',
    platform: 'threads',
    postedAt: '2026-07-15T09:00:00Z',
    text: '轉職的時候，先找三個你真的想做的題目，再去找做這些題目的公司。',
  },
  {
    key: 'zh-last-question',
    platform: 'threads',
    postedAt: '2026-07-14T09:00:00Z',
    text: '面試的最後一個問題，可以問上一個做這份工作的人後來去了哪裡。',
  },
  {
    key: 'zh-remote-band',
    platform: 'threads',
    postedAt: '2026-07-13T09:00:00Z',
    text: '遠端職缺也有在地的薪資區間，記得在第一通電話就問清楚。',
  },
  {
    key: 'zh-reference',
    platform: 'threads',
    postedAt: '2026-07-12T09:00:00Z',
    text: '推薦人要提前三週開口，給對方足夠的時間想要講什麼。',
  },
  {
    key: 'zh-weekly-note',
    platform: 'threads',
    postedAt: '2026-07-11T09:00:00Z',
    text: '把每週做完的事情記下來，履歷就不用在換工作的那一週重寫。',
  },
  {
    key: 'zh-english-interview',
    platform: 'threads',
    postedAt: '2026-07-10T09:00:00Z',
    text: '英文面試可以先寫下開場的兩句話，練到很順，後面就沒那麼緊張。',
  },
  {
    key: 'zh-contract',
    platform: 'threads',
    postedAt: '2026-07-09T09:00:00Z',
    text: '合約工作也算資歷，寫法跟正職一樣，重點還是你做出了什麼。',
  },

  // Labelled writing that is not a confirmed posted reply.
  {
    key: 'main-post-negotiation',
    platform: 'linkedin',
    postedAt: '2026-08-20T09:00:00Z',
    provenance: 'published_main_post',
    evidence: 'platform_export',
    text: 'Main post: what I have learned about salary negotiation after a decade of hiring.',
  },
  {
    key: 'edited-draft-recruiter',
    platform: 'linkedin',
    postedAt: '2026-08-19T09:00:00Z',
    provenance: 'user_edited_unconfirmed',
    evidence: 'unknown',
    text: 'Saved draft: ask the recruiter for the band before the first call, politely and once.',
  },
  {
    key: 'ai-draft-negotiation',
    platform: 'linkedin',
    postedAt: '2026-09-19T09:00:00Z',
    provenance: 'ai_draft',
    evidence: 'unknown',
    text: 'Generated draft: thank the recruiter for the salary range and open the negotiation with a question about scope.',
  },

  // Excluded before candidate selection, not after.
  {
    key: 'withdrawn-negotiation',
    platform: 'linkedin',
    postedAt: '2026-09-20T09:00:00Z',
    withdrawn: true,
    text: 'Withdrawn: a recruiter asked about salary and I started the negotiation badly.',
  },
];

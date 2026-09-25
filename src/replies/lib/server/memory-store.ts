import 'server-only';
import { randomUUID } from 'node:crypto';
import { contentHash, searchText } from '@/replies/lib/contracts/text';
import { APP, RETRIEVAL, RESOURCES as RESOURCE_LIMITS } from '@/replies/lib/contracts/limits';
import { AppError } from '@/replies/lib/contracts/errors';
import type { PastReply, Progress, QualifiedResource, ReplyIdea } from '@/replies/lib/contracts/api';
import type { Platform, Provenance } from '@/replies/lib/contracts/vocabulary';
import type {
  AdminFact,
  AdminResource,
  AdminSettings,
  AnalyseInput,
  AnalyseResult,
  GenerationRunInput,
  LibrarySearchInput,
  ManualReplyInput,
  RecordReplyInput,
  RecordResult,
  SessionRow,
  Store,
} from './store';

/**
 * The in-memory store used by the deterministic browser journeys (T1).
 *
 * It is a test double. It is reachable only when `SR_TEST_MODE=e2e`, it holds
 * obviously synthetic seed data, and it is never bundled into a request path that
 * a real owner can reach.
 *
 * It implements the *rules* rather than approximating them, because a double that
 * is lenient where the database is strict turns a browser journey into a test of
 * the double. So the idempotency ledger, the editor version check, the one reply
 * per session rule and the "a day only counts when it is proven" rule are all here
 * in the same shape the SQL uses.
 */

interface MemoryReply {
  id: string;
  platform: Platform;
  finalText: string;
  searchText: string;
  provenance: Provenance;
  postedAt: string | null;
  postedDate: string | null;
  datePrecision: 'timestamp' | 'date_only' | 'unknown';
  sourceTimezone: string | null;
  contentHash: string;
  sessionId: string | null;
  withdrawnAt: string | null;
  revision: number;
  recordedAt: string;
}

interface MemoryResource {
  id: string;
  version: number;
  type: 'guide' | 'tool' | 'article' | 'book';
  ownership: 'own' | 'book';
  title: string;
  url: string | null;
  tags: string[];
  description: string;
  allowedPlatforms: Platform[];
  active: boolean;
  verified: boolean;
  cta: string;
}

interface MemoryFact {
  id: string;
  version: number;
  fact_text: string;
  tags: string[];
  approved: boolean;
  sensitivity: 'public_safe' | 'private_context_only';
  active: boolean;
  valid_from: string | null;
  valid_to: string | null;
}

interface MutationRecord {
  fingerprint: string;
  replyId: string;
  recordedAt: string;
}

/** Obviously synthetic. Nothing here resembles a real person's writing. */
const SEED_REPLIES: Omit<MemoryReply, 'id' | 'recordedAt'>[] = [
  {
    platform: 'linkedin',
    finalText:
      'Example past reply. Most hiring managers skim the opening line, so put the problem you solved first.',
    searchText: 'example past reply most hiring managers skim the opening line so put the problem you solved first',
    provenance: 'posted_confirmed',
    postedAt: '2026-01-14T02:00:00.000Z',
    postedDate: null,
    datePrecision: 'timestamp',
    sourceTimezone: null,
    contentHash: 'seed-1',
    sessionId: null,
    withdrawnAt: null,
    revision: 0,
  },
  {
    platform: 'linkedin',
    finalText:
      'Example past reply. A cover letter earns its place when it answers the one question the advert is really asking.',
    searchText:
      'example past reply a cover letter earns its place when it answers the one question the advert is really asking',
    provenance: 'posted_confirmed',
    postedAt: null,
    postedDate: null,
    datePrecision: 'unknown',
    sourceTimezone: null,
    contentHash: 'seed-2',
    sessionId: null,
    withdrawnAt: null,
    revision: 0,
  },
  {
    platform: 'threads',
    finalText: '範例回覆。履歷的第一行最好直接寫出你解決過的問題。',
    searchText: '範例回覆。履歷的第一行最好直接寫出你解決過的問題。',
    provenance: 'posted_confirmed',
    postedAt: '2026-02-03T05:00:00.000Z',
    postedDate: null,
    datePrecision: 'timestamp',
    sourceTimezone: null,
    contentHash: 'seed-3',
    sessionId: null,
    withdrawnAt: null,
    revision: 0,
  },
  {
    platform: 'x',
    finalText: 'Example AI draft that was never posted. It must never be shown as something the owner said.',
    searchText: 'example ai draft that was never posted it must never be shown as something the owner said',
    provenance: 'ai_draft',
    postedAt: null,
    postedDate: null,
    datePrecision: 'unknown',
    sourceTimezone: null,
    contentHash: 'seed-4',
    sessionId: null,
    withdrawnAt: null,
    revision: 0,
  },
];

/**
 * Seeds are a template, never the live rows.
 *
 * `createMemoryStore` copies these. Using the module array directly would mean a
 * reset handed back a "fresh" store over data a previous test had already edited,
 * so a suite would pass file by file and fail as a whole, which is exactly the
 * shape of bug the reset exists to remove.
 */
const SEED_RESOURCES: readonly MemoryResource[] = [
  {
    id: '55555555-5555-4555-8555-000000000001',
    version: 1,
    type: 'guide',
    ownership: 'own',
    title: 'Example cover letter guide',
    url: 'https://resources.example.com/guides/cover-letters',
    tags: ['cover letter', 'application', 'opening line'],
    description: 'How to open a cover letter so it answers the advert.',
    allowedPlatforms: ['linkedin', 'x', 'threads'],
    active: true,
    verified: true,
    cta: 'I wrote something on this.',
  },
  {
    id: '55555555-5555-4555-8555-000000000002',
    version: 1,
    type: 'book',
    ownership: 'book',
    title: 'Example book with no approved link',
    url: null,
    tags: ['interview', 'preparation'],
    description: 'A book recommendation with no verified URL.',
    allowedPlatforms: ['linkedin', 'x', 'threads'],
    active: true,
    verified: true,
    cta: 'Worth reading if you want more on this.',
  },
];

function localDay(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function createMemoryStore(): Store {
  const replies: MemoryReply[] = SEED_REPLIES.map((seed) => ({
    ...seed,
    id: randomUUID(),
    recordedAt: new Date().toISOString(),
  }));
  const sessions = new Map<string, SessionRow & { sourceText: string; parentText: string | null }>();
  const mutations = new Map<string, MutationRecord>();
  const runs: { id: string; sessionId: string; createdAt: number }[] = [];
  const resources: MemoryResource[] = SEED_RESOURCES.map((seed) => ({
    ...seed,
    tags: [...seed.tags],
    allowedPlatforms: [...seed.allowedPlatforms],
  }));
  const facts: MemoryFact[] = [];
  const analyseKeys = new Map<string, string>();
  let settings: AdminSettings = {
    target_linkedin: APP.defaultDailyTarget,
    target_x: APP.defaultDailyTarget,
    target_threads: APP.defaultDailyTarget,
    timezone: APP.defaultTimezone,
  };
  const suggestions = new Map<string, ReplyIdea[]>();

  function toPastReply(reply: MemoryReply): PastReply {
    return {
      id: reply.id,
      platform: reply.platform,
      excerpt: reply.finalText.length > 160 ? `${reply.finalText.slice(0, 160)}...` : reply.finalText,
      full_text: reply.finalText,
      provenance: reply.provenance,
      publication_evidence: reply.provenance === 'posted_confirmed' ? 'user_confirmed' : 'unknown',
      posted_at: reply.postedAt,
      posted_date: reply.postedDate,
      date_precision: reply.datePrecision,
    };
  }

  /**
   * English stopwords, dropped before matching.
   *
   * Postgres full-text search drops these, so a double that keeps them is more
   * lenient than production: a query of pure nonsense would still "match" every
   * reply containing the word "the", and a journey asserting the no-match state
   * would pass for the wrong reason. A test double that is kinder than the real
   * thing is worse than no double at all.
   */
  const STOPWORDS = new Set([
    'the', 'and', 'that', 'for', 'with', 'you', 'your', 'are', 'was', 'this', 'but',
    'not', 'all', 'any', 'can', 'has', 'have', 'from', 'they', 'what', 'when', 'who',
    'how', 'why', 'its', 'about', 'into', 'than', 'then', 'there', 'their', 'them',
  ]);

  function lexicalMatches(query: string, includeAiDrafts: boolean): MemoryReply[] {
    const needle = searchText(query);
    const terms = needle
      .split(' ')
      .filter((t) => t.length > 2 && !STOPWORDS.has(t));

    return replies
      .filter((reply) => reply.withdrawnAt === null)
      .filter((reply) => includeAiDrafts || reply.provenance !== 'ai_draft')
      .map((reply) => {
        const hay = reply.searchText;
        const hits = terms.filter((term) => hay.includes(term)).length;
        // Chinese has no spaces, so a substring check is the only signal that works.
        // Whole-phrase containment, which is the signal that finds Chinese.
        const substring = needle.length >= 2 && hay.includes(needle) ? 1 : 0;
        return { reply, score: hits + substring };
      })
      .filter((scored) => scored.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((scored) => scored.reply);
  }

  function qualifyResources(query: string, platform: Platform): QualifiedResource[] {
    const needle = searchText(query);
    return resources.filter((r) => r.active && r.verified && r.allowedPlatforms.includes(platform))
      .filter((r) => r.tags.some((tag) => needle.includes(tag)) || needle.includes(searchText(r.title)))
      .slice(0, RESOURCE_LIMITS.maxQualified)
      .map((r) => ({
        id: r.id,
        version: r.version,
        type: r.type,
        ownership: r.ownership,
        title: r.title,
        url: r.url,
        locale: platform === 'threads' ? ('zh-TW' as const) : ('en' as const),
        english_fallback: platform === 'threads',
        why_it_fits: `It covers ${r.tags[0] ?? 'this topic'}, which the post is asking about.`,
        access_notes: null,
        cta_text: r.cta,
      }));
  }

  return {
    kind: 'memory',

    async dailyCounts(timezone) {
      const today = localDay(new Date(), timezone);
      const counts = { linkedin: 0, x: 0, threads: 0 };

      for (const reply of replies) {
        if (reply.provenance !== 'posted_confirmed' || reply.withdrawnAt !== null) continue;
        const proven =
          (reply.datePrecision === 'timestamp' &&
            reply.postedAt !== null &&
            localDay(new Date(reply.postedAt), timezone) === today) ||
          (reply.datePrecision === 'date_only' &&
            reply.postedDate === today &&
            reply.sourceTimezone === timezone);
        if (proven) counts[reply.platform] += 1;
      }

      const target = APP.defaultDailyTarget;
      return {
        local_day: today,
        timezone,
        counts,
        targets: { linkedin: target, x: target, threads: target },
      } satisfies Progress;
    },

    async getSession(sessionId) {
      return sessions.get(sessionId) ?? null;
    },

    async updateSessionDraft(sessionId, expectedEditorVersion, draftText, draftHash) {
      const session = sessions.get(sessionId);
      if (!session) throw new AppError('not_found', 'That is not available.');
      if (session.state !== 'draft') {
        throw new AppError('version_conflict', 'This reply was already recorded.');
      }
      if (session.editor_version !== expectedEditorVersion) {
        throw new AppError(
          'version_conflict',
          'This changed somewhere else. Check the latest version before saving.',
        );
      }
      session.editor_version += 1;
      session.draft_text = draftText;
      session.draft_hash = draftHash;
      return {
        editorVersion: session.editor_version,
        meaningIsStale:
          session.meaning_source_hash !== null && session.meaning_source_hash !== draftHash,
      };
    },

    async setSessionMeaning(sessionId, meaning, sourceHash) {
      const session = sessions.get(sessionId);
      if (!session) throw new AppError('not_found', 'That is not available.');
      session.english_meaning = meaning;
      session.meaning_source_hash = sourceHash;
    },

    async analyse(input: AnalyseInput): Promise<AnalyseResult> {
      // A replayed key returns the session that already exists, untouched. Writing
      // a fresh one over it would reset the editor version and throw away whatever
      // the owner had already typed, which is the opposite of what idempotency is
      // for.
      const replayedId = analyseKeys.get(input.requestKey);
      const existing = replayedId ? sessions.get(replayedId) : undefined;
      const sessionId = existing?.id ?? randomUUID();

      if (!existing) {
        analyseKeys.set(input.requestKey, sessionId);
        sessions.set(sessionId, {
          id: sessionId,
          platform: input.platform,
          source_post_id: null,
          source_version: 1,
          editor_version: 0,
          draft_text: '',
          draft_hash: contentHash(''),
          state: 'draft',
          english_meaning: null,
          meaning_source_hash: null,
          sourceText: input.sourceText,
          parentText: input.parentText,
        });
      }
      const session = sessions.get(sessionId)!;

      const matches = lexicalMatches(input.sourceText, false);
      const qualified = qualifyResources(input.sourceText, input.platform);

      return {
        sessionId,
        sourcePostId: null,
        sourceVersion: session.source_version,
        contextVersion: 1,
        editorVersion: session.editor_version,
        history: {
          state: matches.length > 0 ? 'ready' : 'empty',
          items: matches.slice(0, RETRIEVAL.initialResults).map(toPastReply),
          nextCursor: matches.length > RETRIEVAL.initialResults ? 'page-2' : null,
          reason: matches.length > 0 ? null : 'no_match',
        },
        resources: {
          state: qualified.length > 0 ? 'ready' : 'empty',
          items: qualified,
          reason: qualified.length > 0 ? null : 'no_match',
        },
      };
    },

    async generationContext(sessionId, seedReplyIds) {
      const session = sessions.get(sessionId);
      if (!session) throw new AppError('not_found', 'That is not available.');

      const writing = lexicalMatches(session.sourceText, false)
        .slice(0, RETRIEVAL.maxContextSnippets)
        .map((reply) => ({
          id: reply.id,
          platform: reply.platform,
          text: reply.finalText,
          posted_on: reply.postedAt ? reply.postedAt.slice(0, 10) : reply.postedDate,
        }));

      const seeds = seedReplyIds
        .map((id) => replies.find((r) => r.id === id))
        .filter((r): r is MemoryReply => Boolean(r))
        .map((reply) => ({
          id: reply.id,
          platform: reply.platform,
          text: reply.finalText,
          posted_on: reply.postedAt ? reply.postedAt.slice(0, 10) : reply.postedDate,
        }));

      const merged = [...seeds, ...writing.filter((w) => !seeds.some((s) => s.id === w.id))];

      return {
        platform: session.platform,
        sourceText: session.sourceText,
        parentText: session.parentText,
        writing: merged.slice(0, RETRIEVAL.maxContextSnippets),
        // Seed data deliberately contains no approved facts: "no suitable fact"
        // is the state the journeys need to exercise most.
        facts: [],
        resources: qualifyResources(session.sourceText, session.platform).map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          description: r.why_it_fits,
        })),
        recentReplies: replies
          .filter((r) => r.provenance === 'posted_confirmed')
          .slice(0, 10)
          .map((r) => ({
            text: r.finalText,
            posted_on: r.postedAt ? r.postedAt.slice(0, 10) : r.postedDate,
          })),
      };
    },

    async countGenerationRunsInLastHour() {
      const cutoff = Date.now() - 3_600_000;
      return runs.filter((run) => run.createdAt >= cutoff).length;
    },

    async createGenerationRun(input: GenerationRunInput) {
      const id = randomUUID();
      runs.push({ id, sessionId: input.sessionId, createdAt: Date.now() });
      return id;
    },

    async completeGenerationRun() {
      // Usage accounting has no observable effect in the double.
    },

    async saveSuggestions(runId, ideas) {
      const withIds = ideas.map((idea) => ({ ...idea, id: randomUUID() }));
      suggestions.set(runId, withIds);
      return withIds;
    },

    async recordReply(input: RecordReplyInput): Promise<RecordResult> {
      const existing = mutations.get(input.operationKey);
      if (existing) {
        if (existing.fingerprint !== input.fingerprint) {
          throw new AppError('idempotency_conflict', 'This save was already handled with different text.');
        }
        return { replyId: existing.replyId, replayed: true, recordedAt: existing.recordedAt };
      }

      const session = sessions.get(input.sessionId);
      if (!session) throw new AppError('not_found', 'That is not available.');

      if (session.state === 'recorded') {
        const already = replies.find((r) => r.sessionId === input.sessionId);
        if (already && already.contentHash === input.contentHash) {
          mutations.set(input.operationKey, {
            fingerprint: input.fingerprint,
            replyId: already.id,
            recordedAt: already.recordedAt,
          });
          return { replyId: already.id, replayed: true, recordedAt: already.recordedAt };
        }
        throw new AppError('version_conflict', 'This reply was already recorded.');
      }

      if (session.editor_version !== input.editorVersion) {
        throw new AppError(
          'version_conflict',
          'This changed somewhere else. Check the latest version before saving.',
        );
      }

      const recordedAt = new Date().toISOString();
      const reply: MemoryReply = {
        id: randomUUID(),
        platform: session.platform,
        finalText: input.finalText,
        searchText: input.searchText,
        provenance: 'posted_confirmed',
        postedAt: input.postedAt ?? recordedAt,
        postedDate: null,
        datePrecision: 'timestamp',
        sourceTimezone: null,
        contentHash: input.contentHash,
        sessionId: input.sessionId,
        withdrawnAt: null,
        revision: 0,
        recordedAt,
      };
      replies.unshift(reply);
      session.state = 'recorded';
      mutations.set(input.operationKey, {
        fingerprint: input.fingerprint,
        replyId: reply.id,
        recordedAt,
      });

      return { replyId: reply.id, replayed: false, recordedAt };
    },

    async recordManualReply(input: ManualReplyInput): Promise<RecordResult> {
      const existing = mutations.get(input.operationKey);
      if (existing) {
        if (existing.fingerprint !== input.fingerprint) {
          throw new AppError('idempotency_conflict', 'This save was already handled with different text.');
        }
        return { replyId: existing.replyId, replayed: true, recordedAt: existing.recordedAt };
      }

      const recordedAt = new Date().toISOString();
      const reply: MemoryReply = {
        id: randomUUID(),
        platform: input.platform,
        finalText: input.finalText,
        searchText: input.searchText,
        provenance: 'posted_confirmed',
        postedAt: input.postedAt,
        postedDate: input.postedDate,
        datePrecision: input.datePrecision,
        sourceTimezone: input.sourceTimezone,
        contentHash: input.contentHash,
        sessionId: null,
        withdrawnAt: null,
        revision: 0,
        recordedAt,
      };
      replies.unshift(reply);
      mutations.set(input.operationKey, {
        fingerprint: input.fingerprint,
        replyId: reply.id,
        recordedAt,
      });

      return { replyId: reply.id, replayed: false, recordedAt };
    },

    async setReplyWithdrawn(replyId, withdrawn) {
      const reply = replies.find((r) => r.id === replyId);
      if (!reply) throw new AppError('not_found', 'That is not available.');
      reply.withdrawnAt = withdrawn ? new Date().toISOString() : null;
    },

    async correctReply(replyId, expectedRevision, finalText, hash, search) {
      const reply = replies.find((r) => r.id === replyId);
      if (!reply) throw new AppError('not_found', 'That is not available.');
      if (reply.revision !== expectedRevision) {
        throw new AppError('version_conflict', 'This changed somewhere else.');
      }
      reply.finalText = finalText;
      reply.contentHash = hash;
      reply.searchText = search;
      reply.revision += 1;
      return { revision: reply.revision };
    },

    async searchLibrary(input: LibrarySearchInput) {
      let matches =
        input.query.trim() === ''
          ? replies.filter((r) => r.withdrawnAt === null)
          : lexicalMatches(input.query, true);

      if (input.platforms?.length) {
        matches = matches.filter((r) => input.platforms!.includes(r.platform));
      }
      if (input.provenances?.length) {
        matches = matches.filter((r) => input.provenances!.includes(r.provenance));
      }
      if (!input.includeUnknownDates) {
        matches = matches.filter((r) => r.datePrecision !== 'unknown');
      }

      const start = input.cursor ? Number(input.cursor) : 0;
      const page = matches.slice(start, start + input.limit);

      return {
        state: (matches.length > 0 ? 'ready' : 'empty') as 'ready' | 'empty',
        items: page.map(toPastReply),
        nextCursor: start + input.limit < matches.length ? String(start + input.limit) : null,
      };
    },

    async hasEligibleFacts() {
      return facts.some((f) => f.approved && f.active && f.sensitivity === 'public_safe');
    },

    async listResources(): Promise<AdminResource[]> {
      return resources.map((r) => ({
        id: r.id,
        version: r.version,
        type: r.type,
        ownership: r.ownership,
        title_en: r.title,
        title_zh_tw: null,
        description: r.description,
        tags: r.tags,
        aliases: [],
        canonical_path: r.ownership === 'own' ? '/guides/cover-letters' : null,
        zh_tw_path: null,
        external_url: r.url && r.ownership === 'book' ? r.url : null,
        cta_en: r.cta,
        cta_zh_tw: null,
        allowed_platforms: r.allowedPlatforms,
        access_notes: null,
        active: r.active,
        verified: r.verified,
      }));
    },

    async saveResource({ id, expectedVersion, fields }) {
      const existing = resources.find((r) => r.id === id);
      if (id !== null && !existing) throw new AppError('not_found', 'That is not available.');
      if (existing && existing.version !== expectedVersion) {
        throw new AppError('version_conflict', 'This changed somewhere else. Reload before saving.');
      }
      const target = existing ?? {
        id: randomUUID(),
        version: 0,
        type: 'guide' as const,
        ownership: 'own' as const,
        title: '',
        url: null,
        tags: [],
        description: '',
        allowedPlatforms: ['linkedin', 'x', 'threads'] as Platform[],
        active: true,
        verified: false,
        cta: '',
      };
      if (!existing) resources.push(target);

      target.version += 1;
      if (typeof fields.title_en === 'string') target.title = fields.title_en;
      if (typeof fields.description === 'string') target.description = fields.description;
      if (Array.isArray(fields.tags)) target.tags = fields.tags as string[];
      if (typeof fields.active === 'boolean') target.active = fields.active;
      if (typeof fields.cta_en === 'string') target.cta = fields.cta_en;

      return { id: target.id, version: target.version };
    },

    async listFacts(): Promise<AdminFact[]> {
      return facts.map((f) => {
        const eligible = f.approved && f.active && f.sensitivity === 'public_safe';
        return {
          ...f,
          eligible,
          ineligible_reason: eligible
            ? null
            : !f.approved
              ? 'not_approved'
              : !f.active
                ? 'inactive'
                : 'private_only',
        };
      });
    },

    async saveFact({ id, expectedVersion, fields }) {
      const existing = facts.find((f) => f.id === id);
      if (id !== null && !existing) throw new AppError('not_found', 'That is not available.');
      if (existing && existing.version !== expectedVersion) {
        throw new AppError('version_conflict', 'This changed somewhere else. Reload before saving.');
      }

      const target: MemoryFact = existing ?? {
        id: randomUUID(),
        version: 0,
        fact_text: '',
        tags: [],
        // A new fact is unapproved and private. Creating one is not approving it.
        approved: false,
        sensitivity: 'private_context_only',
        active: true,
        valid_from: null,
        valid_to: null,
      };
      if (!existing) facts.push(target);

      target.version += 1;
      if (typeof fields.fact_text === 'string') target.fact_text = fields.fact_text;
      if (Array.isArray(fields.tags)) target.tags = fields.tags as string[];
      if (typeof fields.approved === 'boolean') target.approved = fields.approved;
      if (fields.sensitivity === 'public_safe' || fields.sensitivity === 'private_context_only') {
        target.sensitivity = fields.sensitivity;
      }
      if (typeof fields.active === 'boolean') target.active = fields.active;

      return { id: target.id, version: target.version };
    },

    async getSettings() {
      return settings;
    },

    async saveSettings(next) {
      settings = { ...next };
      return settings;
    },
  };
}


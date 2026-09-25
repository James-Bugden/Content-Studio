import 'server-only';
import { randomUUID } from 'node:crypto';
import type { OwnerSession } from '@/replies/lib/auth/owner';
import { AppError } from '@/replies/lib/contracts/errors';
import { APP, RETRIEVAL, RESOURCES as RESOURCE_LIMITS } from '@/replies/lib/contracts/limits';
import { contentHash, searchText } from '@/replies/lib/contracts/text';
import { selectRelevantFacts } from '@/replies/lib/facts/selection';
import { buildFactContext } from '@/replies/lib/facts/context';
import { isInsertable } from '@/replies/lib/resources/eligibility';
import { resolveResourceUrl } from '@/replies/lib/resources/resolve';
import { buildCta } from '@/replies/lib/resources/cta';
import { publicConfig, serverConfig } from '@/replies/lib/config/env';
import { searchReplies, type SearchOptions } from '@/replies/lib/retrieval/search';
import { rpcCandidateSource } from '@/replies/lib/retrieval/candidates';
import type { PastReply, Progress, QualifiedResource, ReplyIdea } from '@/replies/lib/contracts/api';
import type { Platform } from '@/replies/lib/contracts/vocabulary';
import { eligibilityReason, isEligibleForGeneration } from '@/replies/lib/facts/eligibility';
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
 * The real data layer.
 *
 * Every call goes through the caller's own Supabase session, so row-level security
 * applies to all of it. There is no service-role client in this file and no way to
 * obtain one from here: an ordinary request cannot bypass the owner boundary even
 * if a route forgot to check it (C01).
 *
 * The composite operations that must be atomic, meaning recording a reply,
 * correcting one and withdrawing one, are RPC calls into the SQL functions rather
 * than several round
 * trips, because a partial write here would leave a reply saved with no search
 * row, or a count that disagrees with the library.
 */

interface RpcResult<T> {
  data: T | null;
  error: { code?: string; message?: string } | null;
}

function unwrap<T>(result: RpcResult<T>): T {
  if (result.error) {
    const error = new Error('database operation failed') as Error & { code?: string };
    error.code = result.error.code ?? 'XX000';
    throw error;
  }
  if (result.data === null) {
    const error = new Error('database returned no result') as Error & { code?: string };
    error.code = 'XX000';
    throw error;
  }
  return result.data;
}

/**
 * The eligibility half of every library-facing search, in one place.
 *
 * The cursor a search mints is bound to the exact options that produced it, and
 * analyse pages its history through the same library search endpoint. So if the
 * first page and the second page disagree about a single eligibility flag, the
 * second page is rejected as belonging to a different search and "Show more
 * matches" fails for the whole life of the feature. Making both pages call this
 * one function is what keeps them provably identical; a caller that wants
 * different filters says so in `input`, which is then part of the cursor too.
 *
 * AI drafts are included only when the caller has named `ai_draft` explicitly.
 * C05 keeps drafts searchable on an explicit filter and out of everything else,
 * so an unconditional `includeAiDrafts: true` was both wider than the contract
 * allows and the reason the two pages could never agree.
 */
function librarySearchOptions(input: LibrarySearchInput): SearchOptions {
  return {
    query: input.query,
    ...(input.platforms ? { platforms: input.platforms } : {}),
    ...(input.provenances ? { provenances: input.provenances } : {}),
    includeAiDrafts: input.provenances?.includes('ai_draft') ?? false,
    includeUnknownDates: input.includeUnknownDates,
    cursor: input.cursor,
    limit: input.limit,
  };
}

/**
 * The history search analyse runs, expressed through the library search options.
 *
 * Analyse returns the first page and the workspace asks the library endpoint for
 * the second, so the two must be the same search. Routing both through
 * `librarySearchOptions` makes that a fact about the code rather than a pair of
 * object literals someone has to remember to keep in step.
 */
function historyOptions(query: string, limit: number = RETRIEVAL.initialResults): SearchOptions {
  return librarySearchOptions({ query, includeUnknownDates: true, cursor: null, limit });
}

/**
 * The owner's local calendar day for an instant.
 *
 * `posted_at` is a UTC instant and slicing its first ten characters yields the
 * UTC day. Taipei is eight hours ahead, so everything posted between 16:00 and
 * 24:00 UTC renders as the day before. The counter already computes the Taipei
 * day in SQL (C09), so a UTC date here would contradict the number displayed
 * beside it during exactly the 00:00 to 08:00 window the counter exists to get
 * right. The exact instant is never discarded: it travels on `posted_at` in the
 * retrieval rows, so the display layer never has to reconstruct it from this.
 */
function localDay(instant: string, timeZone: string): string | null {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

export function createSupabaseStore(session: OwnerSession): Store {
  const { supabase, userId } = session;
  // An ordinary request reaches retrieval through PostgREST, so it calls the two
  // candidate functions by name rather than sending SQL. Ranking, fusion and the
  // cursor stay in TypeScript, shared with the verification harness.
  const candidates = rpcCandidateSource(supabase as unknown as Parameters<typeof rpcCandidateSource>[0]);
  const config = serverConfig();
  const embeddingModel = config.embedding.mode === 'live' ? config.embedding.model : 'unconfigured';
  // The same zone the counter uses, so a displayed date and a count of the same
  // day can never be computed against two different clocks.
  const timezone = publicConfig().timezone;

  async function qualifiedResourcesFor(text: string, platform: Platform): Promise<{
    items: QualifiedResource[];
    reason: 'no_match' | 'empty_catalog' | 'lookup_failed' | null;
  }> {
    const { data, error } = await supabase
      .from('resources')
      .select(
        'id, version, type, ownership, title_en, title_zh_tw, description, tags, aliases, canonical_path, zh_tw_path, external_url, cta_en, cta_zh_tw, allowed_platforms, access_notes, active, verified',
      )
      .eq('user_id', userId);

    // A failed lookup is not "nothing worth linking". Turning a timeout into
    // confident silence is the exact mistake RES-03 is written to prevent.
    if (error) return { items: [], reason: 'lookup_failed' };
    if (!data || data.length === 0) return { items: [], reason: 'empty_catalog' };

    const locale = platform === 'threads' ? ('zh-TW' as const) : ('en' as const);
    const needle = searchText(text);

    const qualified = data
      .filter((row) => isInsertable(row as never, platform))
      .map((row) => {
        const tags: string[] = [...(row.tags ?? []), ...(row.aliases ?? [])];
        const hits = tags.filter((tag) => tag && needle.includes(searchText(tag))).length;
        return { row, hits };
      })
      // Relevance qualifies first. A low-relevance owned guide must not displace
      // genuinely useful advice-only output simply because it is owned (C06).
      .filter((scored) => scored.hits > 0)
      .sort((a, b) => {
        if (b.hits !== a.hits) return b.hits - a.hits;
        // Only among equally relevant items does ownership break the tie.
        return (a.row.ownership === 'own' ? 0 : 1) - (b.row.ownership === 'own' ? 0 : 1);
      })
      .slice(0, RESOURCE_LIMITS.maxQualified)
      .map(({ row }) => {
        const resolved = resolveResourceUrl(row as never, {
          locale,
          ...(config.resourceBaseUrl ? { resourceBaseUrl: config.resourceBaseUrl } : {}),
        });
        return {
          id: row.id,
          version: row.version,
          type: row.type,
          ownership: row.ownership,
          title: locale === 'zh-TW' && row.title_zh_tw ? row.title_zh_tw : row.title_en,
          url: resolved.url,
          locale: resolved.locale,
          english_fallback: resolved.englishFallback,
          why_it_fits: (row.description ?? '').trim() || 'It covers what the post is asking about.',
          access_notes: row.access_notes ?? null,
          cta_text: buildCta(row as never, resolved.locale, resolved.url),
        } satisfies QualifiedResource;
      });

    return { items: qualified, reason: qualified.length > 0 ? null : 'no_match' };
  }

  return {
    kind: 'supabase',

    async dailyCounts(timezone) {
      return unwrap<Progress>(
        await supabase.rpc('server_daily_counts', { p_owner_id: userId, p_timezone: timezone }),
      );
    },

    async getSession(sessionId) {
      const { data, error } = await supabase
        .from('reply_sessions')
        .select(
          'id, platform, source_post_id, source_version, editor_version, draft_text, draft_hash, state, english_meaning, meaning_source_hash',
        )
        .eq('user_id', userId)
        .eq('id', sessionId)
        .maybeSingle();
      if (error) throw new AppError('internal_error', 'Something went wrong. Your text is still here.');
      return (data as SessionRow | null) ?? null;
    },

    async updateSessionDraft(sessionId, expectedEditorVersion, draftText, draftHash) {
      const current = await this.getSession(sessionId);
      if (!current) throw new AppError('not_found', 'That is not available.');
      if (current.state !== 'draft') {
        throw new AppError('version_conflict', 'This reply was already recorded.');
      }

      const { data, error } = await supabase
        .from('reply_sessions')
        .update({
          draft_text: draftText,
          draft_hash: draftHash,
          editor_version: expectedEditorVersion + 1,
        })
        .eq('user_id', userId)
        .eq('id', sessionId)
        // The version predicate is what makes this safe under concurrency: a second
        // tab that already incremented will not match, so nothing is overwritten.
        .eq('editor_version', expectedEditorVersion)
        .select('editor_version')
        .maybeSingle();

      if (error || !data) {
        throw new AppError(
          'version_conflict',
          'This changed somewhere else. Check the latest version before saving.',
        );
      }

      return {
        editorVersion: data.editor_version,
        meaningIsStale:
          current.meaning_source_hash !== null && current.meaning_source_hash !== draftHash,
      };
    },

    async setSessionMeaning(sessionId, meaning, sourceHash) {
      const { error } = await supabase
        .from('reply_sessions')
        .update({ english_meaning: meaning, meaning_source_hash: sourceHash })
        .eq('user_id', userId)
        .eq('id', sessionId);
      if (error) throw new AppError('internal_error', 'Something went wrong.');
    },

    async analyse(input: AnalyseInput): Promise<AnalyseResult> {
      // The session id is minted here and claimed *with* the key, in one insert.
      //
      // Claiming the key first and filling in `result_id` after both inserts
      // leaves a window in which a concurrent or retried call finds the key
      // taken, reads `result_id = null`, concludes there is no session to reuse,
      // and creates a second session and a second source row. That is precisely
      // the duplicate the key exists to prevent (C09), so the key is never
      // written without the id of the thing it stands for.
      const sessionId = randomUUID();
      const { data: claimed } = await supabase
        .from('mutation_keys')
        .insert({
          user_id: userId,
          key: input.requestKey,
          request_fingerprint: contentHash(input.sourceText),
          operation: 'analyse',
          result_id: sessionId,
        })
        .select('key')
        .maybeSingle();

      if (!claimed) {
        const { data: existing } = await supabase
          .from('mutation_keys')
          .select('result_id')
          .eq('user_id', userId)
          .eq('key', input.requestKey)
          .maybeSingle();
        const existingSession = existing?.result_id
          ? await this.getSession(existing.result_id)
          : null;
        if (existingSession) {
          const [history, resources] = await Promise.all([
            searchReplies(candidates, historyOptions(input.sourceText)).catch(() => ({
              state: 'error' as const,
              items: [] as PastReply[],
              next_cursor: null,
            })),
            qualifiedResourcesFor(input.sourceText, input.platform).catch(() => ({
              items: [] as QualifiedResource[],
              reason: 'lookup_failed' as const,
            })),
          ]);
          return {
            sessionId: existingSession.id,
            sourcePostId: existingSession.source_post_id,
            sourceVersion: existingSession.source_version,
            contextVersion: 1,
            editorVersion: existingSession.editor_version,
            history: {
              state: history.state,
              items: history.items,
              nextCursor: history.next_cursor,
              reason:
                history.state === 'error'
                  ? 'lookup_failed'
                  : history.items.length === 0
                    ? 'no_match'
                    : null,
            },
            resources: {
              state:
                resources.reason === 'lookup_failed'
                  ? 'error'
                  : resources.items.length > 0
                    ? 'ready'
                    : 'empty',
              items: resources.items,
              reason: resources.reason,
            },
          };
        }

        // The key is taken but names no readable session, so the first call is
        // still in flight. Inserting now would create the duplicate above by a
        // slower route; a conflict the caller can retry is the honest answer.
        throw new AppError(
          'idempotency_conflict',
          'That request is still being processed. Try again in a moment.',
        );
      }

      const { data: sourceRow, error: sourceError } = await supabase
        .from('source_posts')
        .insert({
          user_id: userId,
          platform: input.platform,
          target_kind: input.targetKind,
          source_text: input.sourceText,
          parent_text: input.parentText,
          source_url: input.sourceUrl,
        })
        .select('id')
        .single();
      if (sourceError || !sourceRow) {
        throw new AppError('internal_error', 'Something went wrong. Your text is still here.');
      }

      const { data: sessionRow, error: sessionError } = await supabase
        .from('reply_sessions')
        .insert({
          id: sessionId,
          user_id: userId,
          platform: input.platform,
          source_post_id: sourceRow.id,
          draft_hash: contentHash(''),
        })
        .select('id, source_version, editor_version')
        .single();
      if (sessionError || !sessionRow) {
        throw new AppError('internal_error', 'Something went wrong. Your text is still here.');
      }

      // Retrieval and resource qualification are independent, so a failure in one
      // never blanks the other (FR-05, D04).
      const [history, resources] = await Promise.all([
        searchReplies(candidates, historyOptions(input.sourceText)).catch(() => ({
          state: 'error' as const,
          items: [] as PastReply[],
          next_cursor: null,
        })),
        qualifiedResourcesFor(input.sourceText, input.platform).catch(() => ({
          items: [] as QualifiedResource[],
          reason: 'lookup_failed' as const,
        })),
      ]);

      return {
        sessionId: sessionRow.id,
        sourcePostId: sourceRow.id,
        sourceVersion: sessionRow.source_version,
        contextVersion: 1,
        editorVersion: sessionRow.editor_version,
        history: {
          state: history.state,
          items: history.items,
          nextCursor: history.next_cursor,
          reason:
            history.state === 'error' ? 'lookup_failed' : history.items.length === 0 ? 'no_match' : null,
        },
        resources: {
          state:
            resources.reason === 'lookup_failed'
              ? 'error'
              : resources.items.length > 0
                ? 'ready'
                : 'empty',
          items: resources.items,
          reason: resources.reason,
        },
      };
    },

    async generationContext(sessionId, seedReplyIds) {
      const session = await this.getSession(sessionId);
      if (!session) throw new AppError('not_found', 'That is not available.');

      // Each read below decides for itself whether a failure is fatal, and says
      // why. Destructuring `data` alone and letting `error` fall on the floor is
      // what turned an unreadable source post into an empty <source> fence.
      if (!session.source_post_id) {
        throw new AppError('not_found', 'That is not available.');
      }

      const { data: sourceRow, error: sourceError } = await supabase
        .from('source_posts')
        .select('source_text, parent_text')
        .eq('user_id', userId)
        .eq('id', session.source_post_id)
        .maybeSingle();

      // Fatal. Generating from an empty source produces three confident ideas
      // about a post the application never read, and nothing downstream can tell
      // that apart from a genuinely short post (C08).
      if (sourceError) {
        throw new AppError('internal_error', 'Something went wrong. Your text is still here.');
      }
      const sourceText = (sourceRow?.source_text ?? '').trim() === '' ? null : sourceRow?.source_text;
      if (!sourceText) {
        throw new AppError('not_found', 'That is not available.');
      }

      const history = await searchReplies(
        candidates,
        historyOptions(sourceText, RETRIEVAL.maxContextSnippets),
      ).catch(() => ({ state: 'error' as const, items: [] as PastReply[], next_cursor: null }));

      const { data: factRows, error: factError } = await supabase
        .from('facts')
        .select('id, version, fact_text, tags, approved, active, sensitivity, valid_from, valid_to')
        .eq('user_id', userId);

      // Not fatal, and deliberately so. C06's fallback for having no suitable
      // fact is practical advice with no first-person claim, which is exactly
      // what an empty list produces. Unreadable facts can only make the reply
      // more cautious, never less grounded.
      const now = new Date();
      const eligible = (factError ? [] : (factRows ?? [])).filter((row) =>
        isEligibleForGeneration(row as never, now),
      );
      const relevant = selectRelevantFacts(eligible as never, { queryText: sourceText, limit: 3 }, now);

      const resources = await qualifiedResourcesFor(sourceText, session.platform);

      const { data: recent, error: recentError } = await supabase
        .from('reply_library')
        .select('final_text, posted_at, posted_date, date_precision')
        .eq('user_id', userId)
        .eq('provenance', 'posted_confirmed')
        .is('withdrawn_at', null)
        .order('recorded_at', { ascending: false })
        .limit(10);

      // Fatal, for the same reason `countGenerationRunsInLastHour` throws: this
      // list is the only input to the near-verbatim repetition check, and an
      // unreadable guard must not quietly become a disabled one (AI-04).
      if (recentError) {
        throw new AppError('internal_error', 'Something went wrong.');
      }

      const seeds = history.items.filter((item) => seedReplyIds.includes(item.id));
      const rest = history.items.filter((item) => !seedReplyIds.includes(item.id));

      return {
        platform: session.platform,
        sourceText: String(sourceText),
        parentText: (sourceRow?.parent_text as string | null) ?? null,
        writing: [...seeds, ...rest].slice(0, RETRIEVAL.maxContextSnippets).map((item) => ({
          id: item.id,
          platform: item.platform,
          text: item.full_text,
          // The owner's local day, not the UTC one (see localDay).
          posted_on: item.posted_at ? localDay(item.posted_at, timezone) : item.posted_date,
        })),
        // buildFactContext throws if an ineligible fact reaches it, which is the
        // last line before private material would leave for a third party.
        // buildFactContext throws if an ineligible fact reaches it. Its shape is
        // renamed here rather than in either module, because the fact bank and the
        // generation boundary are separate contracts and neither should bend to the
        // other's field names.
        facts: buildFactContext(relevant, { now }).map((entry) => ({
          id: entry.fact_id,
          version: entry.version,
          text: entry.fact_text,
        })),
        resources: resources.items.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          description: r.why_it_fits,
        })),
        recentReplies: (recent ?? []).map((row) => ({
          text: row.final_text,
          posted_on: row.posted_at ? localDay(String(row.posted_at), timezone) : row.posted_date,
        })),
      };
    },

    async countGenerationRunsInLastHour() {
      const since = new Date(Date.now() - 3_600_000).toISOString();
      const { count, error } = await supabase
        .from('generation_runs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', since);
      // An unreadable counter must not become an unlimited one.
      if (error) throw new AppError('internal_error', 'Something went wrong.');
      return count ?? 0;
    },

    async createGenerationRun(input: GenerationRunInput) {
      const { data, error } = await supabase
        .from('generation_runs')
        .insert({
          user_id: userId,
          session_id: input.sessionId,
          source_version: input.sourceVersion,
          editor_base_version: input.editorBaseVersion,
          request_key: input.requestKey,
          context_version: input.contextVersion,
          prompt_version: input.promptVersion,
          provider: input.provider,
          model: input.model,
        })
        .select('id')
        .single();
      if (error || !data) throw new AppError('internal_error', 'Something went wrong.');
      return data.id;
    },

    async completeGenerationRun(runId, outcome) {
      await supabase
        .from('generation_runs')
        .update({
          status: outcome.status,
          input_tokens: outcome.inputTokens,
          output_tokens: outcome.outputTokens,
          duration_ms: outcome.durationMs,
          error_code: outcome.errorCode,
        })
        .eq('user_id', userId)
        .eq('id', runId);
    },

    async saveSuggestions(runId, ideas) {
      const { data, error } = await supabase
        .from('reply_suggestions')
        .insert(
          ideas.map((idea) => ({
            user_id: userId,
            generation_run_id: runId,
            position: idea.position,
            angle_label: idea.angle_label,
            reply_text: idea.reply_text,
            english_meaning: idea.english_meaning,
            resource_id: idea.resource_id,
            cta_text: idea.cta_text,
            fact_ids: idea.uses_fact_ids,
            based_on_reply_ids: idea.based_on_reply_ids,
          })),
        )
        .select('id, position');
      if (error || !data) throw new AppError('internal_error', 'Something went wrong.');

      return ideas.map((idea) => ({
        ...idea,
        id: data.find((row) => row.position === idea.position)?.id ?? '',
      })) as ReplyIdea[];
    },

    async recordReply(input: RecordReplyInput): Promise<RecordResult> {
      const result = unwrap<{ reply_id: string; replayed: boolean; recorded_at: string }>(
        await supabase.rpc('server_record_reply', {
          p_owner_id: userId,
          p_operation_key: input.operationKey,
          p_fingerprint: input.fingerprint,
          p_session_id: input.sessionId,
          p_editor_version: input.editorVersion,
          p_final_text: input.finalText,
          p_content_hash: input.contentHash,
          p_search_text: input.searchText,
          p_reply_url: input.replyUrl,
          p_posted_at: input.postedAt,
          p_resource_snapshots: input.resourceSnapshots,
          p_embedding_model: input.embeddingModel || embeddingModel,
        }),
      );
      return { replyId: result.reply_id, replayed: result.replayed, recordedAt: result.recorded_at };
    },

    async recordManualReply(input: ManualReplyInput): Promise<RecordResult> {
      const result = unwrap<{ reply_id: string; replayed: boolean; recorded_at: string }>(
        await supabase.rpc('server_record_manual_reply', {
          p_owner_id: userId,
          p_operation_key: input.operationKey,
          p_fingerprint: input.fingerprint,
          p_platform: input.platform,
          p_final_text: input.finalText,
          p_content_hash: input.contentHash,
          p_search_text: input.searchText,
          p_date_precision: input.datePrecision,
          p_posted_at: input.postedAt,
          p_posted_date: input.postedDate,
          p_source_timezone: input.sourceTimezone,
          p_source_text: input.sourceText,
          p_parent_text: input.parentText,
          p_source_url: input.sourceUrl,
          p_reply_url: input.replyUrl,
          p_embedding_model: input.embeddingModel || embeddingModel,
        }),
      );
      return { replyId: result.reply_id, replayed: result.replayed, recordedAt: result.recorded_at };
    },

    async setReplyWithdrawn(replyId, withdrawn) {
      unwrap(
        await supabase.rpc('server_set_reply_withdrawn', {
          p_owner_id: userId,
          p_reply_id: replyId,
          p_withdrawn: withdrawn,
        }),
      );
    },

    async correctReply(replyId, expectedRevision, finalText, hash, search, reason) {
      const result = unwrap<{ revision: number }>(
        await supabase.rpc('server_correct_reply', {
          p_owner_id: userId,
          p_reply_id: replyId,
          p_expected_revision: expectedRevision,
          p_final_text: finalText,
          p_content_hash: hash,
          p_search_text: search,
          p_reason: reason,
          p_embedding_model: embeddingModel,
        }),
      );
      return { revision: result.revision };
    },

    async searchLibrary(input: LibrarySearchInput) {
      const result = await searchReplies(candidates, librarySearchOptions(input));
      return {
        state: result.state,
        items: result.items,
        nextCursor: result.next_cursor,
      };
    },

    async hasEligibleFacts() {
      const { data } = await supabase
        .from('facts')
        .select('id, version, fact_text, tags, approved, active, sensitivity, valid_from, valid_to')
        .eq('user_id', userId)
        .eq('approved', true)
        .eq('active', true)
        .eq('sensitivity', 'public_safe')
        .limit(20);
      const now = new Date();
      return (data ?? []).some((row) => isEligibleForGeneration(row as never, now));
    },

    async listResources(): Promise<AdminResource[]> {
      const { data, error } = await supabase
        .from('resources')
        .select('*')
        .eq('user_id', userId)
        .order('title_en', { ascending: true });
      if (error) throw new AppError('internal_error', 'Something went wrong.');
      return (data ?? []) as AdminResource[];
    },

    async saveResource({ id, expectedVersion, fields }) {
      if (id === null) {
        const { data, error } = await supabase
          .from('resources')
          .insert({ ...fields, user_id: userId })
          .select('id, version')
          .single();
        if (error || !data) throw new AppError('validation_failed', 'That resource could not be saved.');
        return { id: data.id, version: data.version };
      }

      // The version predicate is the conflict check: a stale form does not match,
      // so the newer row survives untouched rather than being overwritten (UTIL-01).
      const { data, error } = await supabase
        .from('resources')
        .update({ ...fields, version: (expectedVersion ?? 0) + 1 })
        .eq('user_id', userId)
        .eq('id', id)
        .eq('version', expectedVersion)
        .select('id, version')
        .maybeSingle();
      if (error || !data) {
        throw new AppError('version_conflict', 'This changed somewhere else. Reload before saving.');
      }
      return { id: data.id, version: data.version };
    },

    async listFacts(): Promise<AdminFact[]> {
      const { data, error } = await supabase
        .from('facts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw new AppError('internal_error', 'Something went wrong.');

      const now = new Date();
      return (data ?? []).map((row) => {
        const reason = eligibilityReason(row as never, now);
        return {
          ...(row as unknown as AdminFact),
          eligible: reason === 'eligible',
          ineligible_reason: reason === 'eligible' ? null : reason,
        };
      });
    },

    async saveFact({ id, expectedVersion, fields }) {
      if (id === null) {
        const { data, error } = await supabase
          .from('facts')
          .insert({ ...fields, user_id: userId })
          .select('id, version')
          .single();
        if (error || !data) throw new AppError('validation_failed', 'That fact could not be saved.');
        return { id: data.id, version: data.version };
      }

      const { data, error } = await supabase
        .from('facts')
        .update({ ...fields, version: (expectedVersion ?? 0) + 1 })
        .eq('user_id', userId)
        .eq('id', id)
        .eq('version', expectedVersion)
        .select('id, version')
        .maybeSingle();
      if (error || !data) {
        throw new AppError('version_conflict', 'This changed somewhere else. Reload before saving.');
      }
      return { id: data.id, version: data.version };
    },

    async getSettings(): Promise<AdminSettings> {
      const { data } = await supabase
        .from('app_settings')
        .select('target_linkedin, target_x, target_threads, timezone')
        .eq('user_id', userId)
        .maybeSingle();
      return (
        (data as AdminSettings | null) ?? {
          target_linkedin: APP.defaultDailyTarget,
          target_x: APP.defaultDailyTarget,
          target_threads: APP.defaultDailyTarget,
          timezone: APP.defaultTimezone,
        }
      );
    },

    async saveSettings(settings) {
      const { error } = await supabase
        .from('app_settings')
        .upsert({ ...settings, user_id: userId }, { onConflict: 'user_id' });
      if (error) throw new AppError('validation_failed', 'Those settings could not be saved.');
      return settings;
    },
  };
}

export const DEFAULT_TIMEZONE = APP.defaultTimezone;

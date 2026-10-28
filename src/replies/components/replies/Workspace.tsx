'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from './AppHeader';
import { SourceInput } from './SourceInput';
import { PastRepliesSection } from './PastRepliesSection';
import { ResourcesSection } from './ResourcesSection';
import { IdeasSection } from './IdeasSection';
import { FinalReplyEditor, FINAL_EDITOR_ID } from './FinalReplyEditor';
import { ActionStrip } from './ActionStrip';
import { ImageSuggestionsSection } from './ImageSuggestionsSection';
import { SourcesPanel, type SourceItem } from './SourcesPanel';
import { EDITOR, SOURCES } from '@/replies/lib/workspace/copy';
import {
  addSource,
  canAdd,
  commit,
  currentSources,
  delta,
  emptySelection,
  moreSuggestions,
  removeSource,
  type SourceSelection,
} from '@/replies/lib/suggestions/used';
import { initialState, isEditedSinceCopy, workspaceReducer } from '@/replies/lib/workspace/reducer';
import { api, ApiError, newOperationKey } from '@/replies/lib/workspace/client';
import { forgetDraft, recallDraft, rememberDraft } from '@/replies/lib/workspace/recovery';
import { contentHash } from '@/replies/lib/contracts/text';
import type { Platform } from '@/replies/lib/contracts/vocabulary';
import type {
  Progress,
  QualifiedResource,
  ReplyIdea,
  SuggestedFact,
  SuggestedImage,
  SuggestedPost,
} from '@/replies/lib/contracts/api';

/** Facts, earlier posts and images that fit the pasted post (#245). */
interface SuggestionPool {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  facts: SuggestedFact[];
  posts: SuggestedPost[];
  images: SuggestedImage[];
}

const NO_SUGGESTIONS: SuggestionPool = { status: 'idle', facts: [], posts: [], images: [] };

/** The editor's own sources scope. Ideas use their own id. */
const DRAFT_SCOPE = 'draft';

function withoutScope(selections: Record<string, SourceSelection>, scope: string): Record<string, SourceSelection> {
  const { [scope]: _dropped, ...rest } = selections;
  return rest;
}

/**
 * The workspace (D01, D04, UX-03).
 *
 * DOM order is source, history, resources, ideas, editor, and it stays that way at
 * every width. At 1100 px and above the editor may sit in a second column, which is
 * a change of presentation only: the order screen readers and keyboards traverse
 * does not move.
 *
 * All the race handling lives in the reducer. What this component owns is the part
 * that cannot be pure: abort controllers for superseded requests, a debounced draft
 * save, and one stable operation key per save attempt.
 */

export interface WorkspaceProps {
  initialPlatform?: Platform;
  initialProgress?: Progress | null;
  /** True when an eligible approved public-safe fact exists for this owner. */
  hasEligibleFacts?: boolean;
}

export function Workspace({
  initialPlatform = 'linkedin',
  initialProgress = null,
  hasEligibleFacts = false,
}: WorkspaceProps) {
  const [state, dispatch] = useReducer(workspaceReducer, initialPlatform, initialState);
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineNotice, setRefineNotice] = useState<string | null>(null);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [ideaSave, setIdeaSave] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const router = useRouter();

  const [suggestions, setSuggestions] = useState<SuggestionPool>(NO_SUGGESTIONS);
  const [selections, setSelections] = useState<Record<string, SourceSelection>>({});
  const [sourceBusy, setSourceBusy] = useState<string | null>(null);
  const [sourceNotice, setSourceNotice] = useState<{ scope: string; text: string } | null>(null);
  /** The source change whose rewrite preview is on screen, if any. */
  const pendingSources = useRef<{ scope: string; selection: SourceSelection } | null>(null);

  const generationAbort = useRef<AbortController | null>(null);
  const lastSyncedDraft = useRef<string>('');
  const operationKey = useRef<string | null>(null);

  const draftHash = useMemo(() => contentHash(state.draft), [state.draft]);

  useEffect(() => {
    if (initialProgress) dispatch({ type: 'progress_refreshed', progress: initialProgress });
  }, [initialProgress]);

  /**
   * Put the reply back after a trip to a utility page.
   *
   * This component unmounts on navigation, so without this, opening Resources to
   * add the very link the owner wanted discarded what they had written. Runs once,
   * before anything else can change the draft.
   */
  useEffect(() => {
    const recovered = recallDraft();
    if (!recovered) return;
    dispatch({
      type: 'restore_draft',
      sessionId: recovered.sessionId,
      platform: recovered.platform,
      targetKind: recovered.targetKind,
      sourceText: recovered.sourceText,
      parentText: recovered.parentText,
      sourceUrl: recovered.sourceUrl,
      draft: recovered.draft,
      editorVersion: recovered.editorVersion,
      sourceVersion: recovered.sourceVersion,
      contextVersion: recovered.contextVersion,
    });
    lastSyncedDraft.current = recovered.draft;
  }, []);

  // Kept current so a navigation at any moment has something to come back to.
  useEffect(() => {
    if (!state.sessionId) return;
    rememberDraft({
      sessionId: state.sessionId,
      platform: state.platform,
      targetKind: state.targetKind,
      sourceText: state.sourceText,
      parentText: state.parentText,
      sourceUrl: state.sourceUrl,
      draft: state.draft,
      editorVersion: state.editorVersion,
      sourceVersion: state.sourceVersion,
      contextVersion: state.contextVersion,
    });
  }, [
    state.sessionId,
    state.platform,
    state.targetKind,
    state.sourceText,
    state.parentText,
    state.sourceUrl,
    state.draft,
    state.editorVersion,
    state.sourceVersion,
    state.contextVersion,
  ]);

  // The local day rolls over at Taipei midnight and the window may have been in the
  // background for hours, so the count is refetched on focus rather than trusted.
  useEffect(() => {
    function refresh() {
      api
        .progress()
        .then((progress) => dispatch({ type: 'progress_refreshed', progress }))
        .catch(() => {
          // A stale counter is a cosmetic problem. It must not surface as an error
          // over the top of the owner's work.
        });
    }
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  /**
   * Looks up facts, earlier posts and images. It is a search, so it costs nothing
   * and runs on the same click as the ideas. A failure leaves the rest of the screen
   * exactly as it was: suggestions are an extra, never a dependency.
   */
  const loadSuggestions = useCallback(async (sessionId: string, factIds: string[], reset: boolean) => {
    if (reset) setSuggestions({ ...NO_SUGGESTIONS, status: 'loading' });
    try {
      const found = await api.suggestions({
        session_id: sessionId,
        ...(factIds.length > 0 ? { fact_ids: factIds } : {}),
      });
      setSuggestions((previous) => {
        const known = reset ? [] : previous.facts;
        const merged = [...known, ...found.facts.filter((fact) => !known.some((k) => k.id === fact.id))];
        return { status: 'ready', facts: merged, posts: found.posts, images: found.images };
      });
    } catch {
      setSuggestions((previous) => (previous.status === 'loading' ? { ...previous, status: 'failed' } : previous));
    }
  }, []);

  const runGeneration = useCallback(
    async (sessionId: string, sourceVersion: number, contextVersion: number, seedReplyIds: string[]) => {
      generationAbort.current?.abort();
      const controller = new AbortController();
      generationAbort.current = controller;

      dispatch({ type: 'generate_started', sourceVersion });
      try {
        const result = await api.generate(
          {
            session_id: sessionId,
            source_version: sourceVersion,
            context_version: contextVersion,
            request_key: newOperationKey(),
            ...(seedReplyIds.length > 0 ? { seed_reply_ids: seedReplyIds } : {}),
          },
          controller.signal,
        );
        dispatch({
          type: 'generate_succeeded',
          sourceVersion,
          ideas: result.ideas,
          suggestedIndex: result.suggested_index,
          warnings: result.repetition_warning ? [result.repetition_warning] : [],
        });
        // The facts an idea cites need their text to be shown under "Used".
        const cited = [...new Set(result.ideas.flatMap((idea) => idea.uses_fact_ids))];
        if (cited.length > 0) void loadSuggestions(sessionId, cited, false);
      } catch (error) {
        if (controller.signal.aborted) return;
        const code =
          error instanceof ApiError
            ? error.envelope.code === 'rate_limited'
              ? 'rate_limited'
              : error.envelope.code === 'not_configured'
                ? 'not_configured'
                : // The guards rejecting a response is not the provider failing,
                  // and the owner is told which it was.
                  error.envelope.code === 'withheld_unsafe'
                  ? 'withheld'
                  : 'failed'
            : 'failed';
        dispatch({
          type: 'generate_failed',
          sourceVersion,
          code,
          ...(error instanceof ApiError && error.envelope.retry_after_seconds
            ? { retryAfterSeconds: error.envelope.retry_after_seconds }
            : {}),
        });
      }
    },
    [loadSuggestions],
  );

  const analyse = useCallback(async () => {
    setBusy(true);
    dispatch({ type: 'analyse_started' });
    try {
      const result = await api.analyse({
        request_key: newOperationKey(),
        platform: state.platform,
        target_kind: state.targetKind,
        source_text: state.sourceText,
        ...(state.parentText ? { parent_text: state.parentText } : {}),
        ...(state.sourceUrl ? { source_url: state.sourceUrl } : {}),
      });

      dispatch({
        type: 'analyse_succeeded',
        sessionId: result.session_id,
        sourceVersion: result.source_version,
        contextVersion: result.context_version,
        editorVersion: result.editor_version,
        history: {
          state: result.history.state,
          items: result.history.items,
          nextCursor: result.history.next_cursor ?? null,
          reason: (result.history.reason ?? null) as never,
        },
        resources: {
          state: result.resources.state,
          items: result.resources.items,
          reason: (result.resources.reason ?? null) as never,
        },
      });

      // A new post is a new set of sources: nothing from the last one carries over.
      pendingSources.current = null;
      setSelections({});
      setSourceNotice(null);
      void loadSuggestions(result.session_id, [], true);

      // Retrieval renders first; generation follows for a post or comment target.
      // A model outage from here on cannot remove what has already been shown.
      if (result.generation_expected) {
        void runGeneration(result.session_id, result.source_version, result.context_version, []);
      }
    } catch {
      dispatch({ type: 'analyse_failed' });
    } finally {
      setBusy(false);
    }
  }, [
    state.platform,
    state.targetKind,
    state.sourceText,
    state.parentText,
    state.sourceUrl,
    runGeneration,
    loadSuggestions,
  ]);

  const onDraftChange = useCallback((value: string) => {
    // Typing makes a pending rewrite preview stale (the reducer drops it), so the
    // source change that preview carried is dropped with it.
    const pending = pendingSources.current;
    if (pending) {
      pendingSources.current = null;
      setSelections((previous) => withoutScope(previous, pending.scope));
    }
    dispatch({ type: 'edit_draft', value, hash: contentHash(value) });
  }, []);

  /**
   * Keeps the server draft level with the editor, whatever moved it.
   *
   * This used to hang off the textarea's onChange, which meant the server only
   * ever saw text the owner had *typed*. Using an idea, accepting a rewrite,
   * inserting a resource and Undo all change the draft without a keystroke, so
   * the server kept an older version, and everything that reads it worked on
   * text the owner was no longer looking at: Shorter and Warmer were dead until
   * the first keystroke, and a second rewrite was computed from the draft the
   * owner had already replaced.
   *
   * Watching the draft itself catches every one of those paths, including any
   * added later.
   */
  useEffect(() => {
    if (!state.sessionId) return;
    if (state.draft === lastSyncedDraft.current) return;

    const sessionId = state.sessionId;
    const value = state.draft;
    const version = state.editorVersion;

    const timer = setTimeout(() => {
      api
        .saveDraft({ session_id: sessionId, expected_editor_version: version, draft_text: value })
        .then((result) => {
          lastSyncedDraft.current = value;
          dispatch({ type: 'draft_saved_to_server', editorVersion: result.editor_version });
        })
        .catch(() => {
          // Never shown. The text is on screen, and "Draft saved" is not claimed
          // for text that only exists in memory (D12).
        });
    }, 600);

    return () => clearTimeout(timer);
  }, [state.draft, state.sessionId, state.editorVersion]);

  const onRefine = useCallback(
    async (action: 'shorter' | 'more_direct' | 'warmer' | 'add_personal_example') => {
      if (!state.sessionId) return;
      setRefining(true);
      setRefineNotice(null);
      const baseVersion = state.editorVersion;
      try {
        const result = await api.refine({
          session_id: state.sessionId,
          expected_editor_version: baseVersion,
          action,
          request_key: newOperationKey(),
        });
        // If the owner typed while this was running, the reducer drops it.
        dispatch({
          type: 'propose',
          proposal: {
            text: result.proposed_text,
            baseEditorVersion: result.base_editor_version,
            origin: 'refine',
            ideaId: null,
          },
        });
      } catch (error) {
        // A failed refinement changes nothing, but silence is its own bug: the
        // owner presses Shorter, nothing happens, and they cannot tell whether it
        // is slow, broken, or refused.
        setRefineNotice(
          error instanceof ApiError && error.envelope.code === 'withheld_unsafe'
            ? EDITOR.rewriteWithheld
            : EDITOR.rewriteFailed,
        );
      } finally {
        setRefining(false);
      }
    },
    [state.sessionId, state.editorVersion],
  );

  const onRefreshMeaning = useCallback(async () => {
    if (!state.sessionId) return;
    const hashAtRequest = draftHash;
    dispatch({ type: 'meaning_requested' });
    try {
      const result = await api.meaning({
        session_id: state.sessionId,
        text_hash: hashAtRequest,
        request_key: newOperationKey(),
      });
      // No currentHash is passed: this handler closed over the draft when the
      // owner clicked, so anything it computes describes the old text. The
      // reducer compares against the live draft instead.
      dispatch({
        type: 'meaning_received',
        text: result.english_meaning,
        sourceHash: result.source_hash,
      });
    } catch {
      dispatch({ type: 'meaning_failed' });
    }
  }, [state.sessionId, draftHash]);

  const onMarkPosted = useCallback(async () => {
    if (!state.sessionId) return;
    // One key per save action, reused by every retry of that same action.
    operationKey.current ??= newOperationKey();
    dispatch({ type: 'save_started' });
    try {
      const result = await api.markPosted(
        {
          session_id: state.sessionId,
          editor_version: state.editorVersion,
          final_text: state.draft,
          resource_snapshots: state.insertedResource
            ? [
                {
                  resource_id: state.insertedResource.resourceId,
                  version: state.insertedResource.version,
                  url: null,
                  inserted_text: state.insertedResource.insertedText,
                },
              ]
            : [],
        },
        operationKey.current,
      );
      dispatch({ type: 'save_succeeded', replyId: result.reply_id, progress: result.progress });
      operationKey.current = null;
    } catch {
      dispatch({ type: 'save_failed' });
    }
  }, [state.sessionId, state.editorVersion, state.draft, state.insertedResource]);

  const onUseIdea = useCallback(
    (idea: ReplyIdea) => {
      // A pristine editor is filled directly, so the reply now draws on what the
      // idea drew on. A dirty one gets a preview, and this is decided on Apply.
      if (!state.dirty && state.draft.trim() === '') {
        setSelections((previous) => ({
          ...withoutScope(previous, idea.id),
          [DRAFT_SCOPE]: emptySelection({ facts: idea.uses_fact_ids }),
        }));
      }
      dispatch({ type: 'use_idea', idea });
    },
    [state.dirty, state.draft],
  );

  const onAcceptProposal = useCallback(() => {
    const pending = pendingSources.current;
    if (pending) {
      // The rewrite that was previewed becomes the reply, so its sources are now
      // what the reply draws on.
      pendingSources.current = null;
      setSelections((previous) => ({
        ...withoutScope(previous, pending.scope),
        [DRAFT_SCOPE]: commit(pending.selection),
      }));
    } else if (state.proposal?.origin === 'idea' && state.proposal.ideaId) {
      const proposedId = state.proposal.ideaId;
      const idea = state.ideas.status === 'ready' ? state.ideas.ideas.find((candidate) => candidate.id === proposedId) : null;
      if (idea) {
        setSelections((previous) => ({
          ...previous,
          [DRAFT_SCOPE]: emptySelection({ facts: idea.uses_fact_ids }),
        }));
      }
    }
    dispatch({ type: 'accept_proposal', hash: draftHash });
  }, [state.proposal, state.ideas, draftHash]);

  const onRejectProposal = useCallback(() => {
    const pending = pendingSources.current;
    if (pending) {
      // Keep my reply: the change of sources was only ever a proposal.
      pendingSources.current = null;
      setSelections((previous) => withoutScope(previous, pending.scope));
    }
    dispatch({ type: 'reject_proposal' });
  }, []);

  /**
   * An x or a + under an idea or the editor (#245).
   *
   * Either click asks the existing rewrite endpoint for a preview with the changed
   * set of sources. The editor is not touched. If the request fails, the selection
   * goes back to what it was and the owner is told, so the panel never shows a state
   * the reply does not have.
   */
  const changeSources = useCallback(
    async (scope: string, idea: ReplyIdea | null, previous: SourceSelection, next: SourceSelection) => {
      if (!state.sessionId || sourceBusy !== null) return;
      setSelections((current) => ({ ...current, [scope]: next }));
      setSourceBusy(scope);
      setSourceNotice(null);
      const changed = delta(next);
      try {
        const result = await api.refine({
          session_id: state.sessionId,
          expected_editor_version: state.editorVersion,
          action: 'use_sources',
          request_key: newOperationKey(),
          ...(changed.extra_fact_ids.length > 0 ? { extra_fact_ids: changed.extra_fact_ids } : {}),
          ...(changed.extra_post_ids.length > 0 ? { extra_post_ids: changed.extra_post_ids } : {}),
          ...(changed.excluded_fact_ids.length > 0 ? { excluded_fact_ids: changed.excluded_fact_ids } : {}),
          ...(idea ? { idea_id: idea.id } : {}),
        });
        // The reducer drops a proposal computed from an older editor version. If
        // that is about to happen, say so instead of leaving a change nobody can see.
        if (result.base_editor_version !== state.editorVersion) throw new Error('stale');
        pendingSources.current = { scope, selection: next };
        dispatch({
          type: 'propose',
          proposal: {
            text: result.proposed_text,
            baseEditorVersion: result.base_editor_version,
            origin: idea ? 'idea' : 'refine',
            ideaId: idea?.id ?? null,
          },
        });
      } catch (error) {
        setSelections((current) => ({ ...current, [scope]: previous }));
        const code = error instanceof ApiError ? error.envelope.code : null;
        setSourceNotice({
          scope,
          text:
            code === 'withheld_unsafe'
              ? SOURCES.withheld
              : code === 'monthly_ai_limit_reached'
                ? SOURCES.limit
                : SOURCES.failed,
        });
      } finally {
        setSourceBusy(null);
      }
    },
    [state.sessionId, state.editorVersion, sourceBusy],
  );

  const onSaveAsContentIdea = useCallback(async () => {
    if (state.save.status !== 'saved') return;
    setIdeaSave('saving');
    try {
      await api.saveContentIdea({
        operationId: `idea_${state.save.replyId.replace(/-/g, '')}`,
        replyId: state.save.replyId,
      });
      setIdeaSave('saved');
    } catch {
      setIdeaSave('failed');
    }
  }, [state.save]);

  /**
   * Undo recorded status.
   *
   * This was a no-op for a while, which is the worst thing a control like this
   * can be: the owner presses it believing they have reversed a recording, the
   * count does not move, and the reply stays eligible as voice evidence. It
   * withdraws this app's record only; the reply on the social platform is
   * untouched and the copy says so.
   */
  const onUndoRecorded = useCallback(async () => {
    if (state.save.status !== 'saved') return;
    const replyId = state.save.replyId;
    try {
      await api.libraryPatch(replyId, { action: 'withdraw', withdrawn: true });
      const progress = await api.progress();
      dispatch({ type: 'undo_recorded', progress });
    } catch {
      dispatch({ type: 'undo_recorded_failed' });
    }
  }, [state.save]);

  const loadMoreHistory = useCallback(async () => {
    if (!state.history.nextCursor) return;
    try {
      const page = await api.librarySearch({
        query: state.sourceText,
        cursor: state.history.nextCursor,
        limit: 5,
        include_unknown_dates: true,
      });
      // Paging never touches the editor or the current selection (D05).
      dispatch({ type: 'history_page', items: page.items, nextCursor: page.next_cursor });
    } catch {
      // Failing to fetch more leaves what is already on screen exactly as it is.
    }
  }, [state.history.nextCursor, state.sourceText]);

  const onAddResource = useCallback(
    (resource: QualifiedResource) => {
      const insertion = resource.url
        ? `\n\n${resource.cta_text} ${resource.url}`
        : `\n\n${resource.cta_text}`;
      dispatch({ type: 'insert_resource', resource, insertedText: insertion, hash: draftHash });
    },
    [draftHash],
  );

  const factsById = useMemo(() => new Map(suggestions.facts.map((fact) => [fact.id, fact])), [suggestions.facts]);
  const postsById = useMemo(() => new Map(suggestions.posts.map((post) => [post.id, post])), [suggestions.posts]);

  const factItem = useCallback(
    (id: string): SourceItem => {
      const fact = factsById.get(id);
      return { kind: 'fact', id, text: fact?.text ?? SOURCES.unknownFact, isPrivate: fact?.private ?? false };
    },
    [factsById],
  );
  const postItem = useCallback(
    (id: string): SourceItem => {
      const post = postsById.get(id);
      return {
        kind: 'post',
        id,
        text: post?.title ?? id,
        openHref: `/review/${encodeURIComponent(id)}`,
        ...(post ? { copyText: post.text } : {}),
      };
    },
    [postsById],
  );

  const selectionFor = useCallback(
    (scope: string, base: { facts?: string[] }): SourceSelection => selections[scope] ?? emptySelection(base),
    [selections],
  );

  const suggestionsLoading = suggestions.status === 'loading';

  /** The panel under an idea. Guides are inserted from the editor, not from here. */
  const renderIdeaSources = (idea: ReplyIdea) => {
    if (suggestions.status === 'idle') return null;
    const selection = selectionFor(idea.id, { facts: idea.uses_fact_ids });
    const used = currentSources(selection);
    const more = moreSuggestions({ facts: suggestions.facts, posts: suggestions.posts }, used);
    const change = (next: SourceSelection) => void changeSources(idea.id, idea, selection, next);
    return (
      <SourcesPanel
        scopeLabel={idea.angle_label}
        used={[...used.facts.map(factItem), ...used.posts.map(postItem)]}
        more={[...more.facts.map((fact) => factItem(fact.id)), ...more.posts.map((post) => postItem(post.id))]}
        busy={sourceBusy !== null}
        loadingMore={suggestionsLoading}
        notice={sourceNotice?.scope === idea.id ? sourceNotice.text : null}
        onRemove={(item) => item.kind !== 'guide' && change(removeSource(selection, item.kind, item.id))}
        onAdd={(item) => {
          if (item.kind !== 'guide' && canAdd(selection, item.kind)) change(addSource(selection, item.kind, item.id));
        }}
      />
    );
  };

  /** The panel under the editor: the reply as it stands, including an inserted guide. */
  const renderDraftSources = () => {
    if (!state.sessionId || suggestions.status === 'idle') return null;
    const selection = selectionFor(DRAFT_SCOPE, {});
    const used = currentSources(selection);
    const more = moreSuggestions({ facts: suggestions.facts, posts: suggestions.posts }, used);
    const inserted = state.insertedResource;
    const guideTitle = (id: string) => state.resources.items.find((resource) => resource.id === id)?.title ?? SOURCES.guide;
    const otherGuides = state.resources.items.filter((resource) => resource.id !== inserted?.resourceId);
    const change = (next: SourceSelection) => void changeSources(DRAFT_SCOPE, null, selection, next);
    return (
      <SourcesPanel
        scopeLabel={EDITOR.heading}
        used={[
          ...(inserted ? [{ kind: 'guide' as const, id: inserted.resourceId, text: guideTitle(inserted.resourceId) }] : []),
          ...used.facts.map(factItem),
          ...used.posts.map(postItem),
        ]}
        more={[
          ...more.facts.map((fact) => factItem(fact.id)),
          ...more.posts.map((post) => postItem(post.id)),
          ...otherGuides.map((resource): SourceItem => ({ kind: 'guide', id: resource.id, text: resource.title })),
        ]}
        busy={sourceBusy !== null}
        loadingMore={suggestionsLoading}
        notice={sourceNotice?.scope === DRAFT_SCOPE ? sourceNotice.text : null}
        onRemove={(item) => {
          if (item.kind === 'guide') dispatch({ type: 'remove_resource', hash: draftHash });
          else change(removeSource(selection, item.kind, item.id));
        }}
        onAdd={(item) => {
          if (item.kind === 'guide') {
            // The link goes in the text, by the one convention Add to reply uses.
            const resource = state.resources.items.find((candidate) => candidate.id === item.id);
            if (resource) onAddResource(resource);
          } else if (canAdd(selection, item.kind)) {
            change(addSource(selection, item.kind, item.id));
          }
        }}
      />
    );
  };

  return (
    <>
      <AppHeader progress={state.progress} />

      <div
        aria-label="Reply workspace"
        className="mx-auto max-w-[750px] px-4 py-4 xl:max-w-[1100px]"
        style={{ paddingBottom: 'calc(var(--sr-action-strip-height) + 16px)' }}
      >
        <SourceInput
          platform={state.platform}
          targetKind={state.targetKind}
          sourceText={state.sourceText}
          parentText={state.parentText}
          sourceUrl={state.sourceUrl}
          busy={busy}
          collapsed={state.sessionId !== null && !sourceExpanded}
          onPlatformChange={(platform) => dispatch({ type: 'set_platform', platform })}
          onTargetKindChange={(targetKind) => dispatch({ type: 'set_target_kind', targetKind })}
          onFieldChange={(field, value) => dispatch({ type: 'edit_source', field, value })}
          onSubmit={analyse}
          onExpandToggle={() => setSourceExpanded((value) => !value)}
        />

        <PastRepliesSection
          section={state.history}
          onRetry={analyse}
          onMore={loadMoreHistory}
          onUse={(reply) => {
            if (state.sessionId) {
              void runGeneration(state.sessionId, state.sourceVersion, state.contextVersion, [reply.id]);
            }
          }}
          onCopy={(reply) => {
            void navigator.clipboard.writeText(reply.full_text).catch(() => undefined);
          }}
        />

        <ResourcesSection
          section={state.resources}
          addedResourceId={state.insertedResource?.resourceId ?? null}
          onAdd={onAddResource}
          onCopyLink={(resource) => {
            if (resource.url) void navigator.clipboard.writeText(resource.url).catch(() => undefined);
          }}
          onRetry={analyse}
          onOpenResources={() => {
            // Client-side navigation keeps the draft in memory, which matters here:
            // the owner is being sent away mid-reply to add a resource (D14).
            router.push('/replies/resources');
          }}
        />

        <IdeasSection
          state={state.ideas}
          platform={state.platform}
          resources={state.resources.items}
          renderSources={renderIdeaSources}
          onUse={onUseIdea}
          onRetry={() => {
            if (state.sessionId) {
              void runGeneration(state.sessionId, state.sourceVersion, state.contextVersion, []);
            }
          }}
        />

        <FinalReplyEditor
          platform={state.platform}
          draft={state.draft}
          proposal={state.proposal}
          meaning={state.meaning}
          canUndo={state.previousDraft !== null}
          hasInsertedResource={state.insertedResource !== null}
          canAddPersonalExample={hasEligibleFacts}
          refining={refining}
          notice={refineNotice}
          onChange={onDraftChange}
          onRefine={onRefine}
          sources={renderDraftSources()}
          onAcceptProposal={onAcceptProposal}
          onRejectProposal={onRejectProposal}
          onRemoveResource={() => dispatch({ type: 'remove_resource', hash: draftHash })}
          onUndo={() => dispatch({ type: 'undo' })}
          onRefreshMeaning={onRefreshMeaning}
        />

        {state.sessionId && suggestions.status !== 'idle' ? (
          <ImageSuggestionsSection
            status={suggestions.status}
            images={suggestions.images}
            platform={state.platform}
            sourceText={state.sourceText}
            onCreated={() => {
              if (state.sessionId) void loadSuggestions(state.sessionId, [], false);
            }}
          />
        ) : null}

        <div className="mb-4">
          <a href="#your-reply" className="text-meta text-ink-soft underline">
            {EDITOR.jumpTo}
          </a>
        </div>
      </div>

      <ActionStrip
        platform={state.platform}
        draft={state.draft}
        save={state.save}
        editedSinceCopy={isEditedSinceCopy(state, draftHash)}
        selectTargetId={FINAL_EDITOR_ID}
        onCopied={() => dispatch({ type: 'copied', hash: draftHash })}
        onMarkPosted={onMarkPosted}
        onUndoRecorded={onUndoRecorded}
        ideaSave={ideaSave}
        onSaveAsContentIdea={onSaveAsContentIdea}
        onNextReply={() => {
          // Recorded, and the owner has moved on, so the local copy has nothing
          // left to protect.
          forgetDraft();
          lastSyncedDraft.current = '';
          setIdeaSave('idle');
          pendingSources.current = null;
          setSelections({});
          setSuggestions(NO_SUGGESTIONS);
          setSourceNotice(null);
          dispatch({ type: 'next_reply' });
        }}
      />
    </>
  );
}

import { contentHash } from '@/replies/lib/contracts/text';
import type { Platform, SectionState, TargetKind } from '@/replies/lib/contracts/vocabulary';
import type { PastReply, QualifiedResource, ReplyIdea, Progress } from '@/replies/lib/contracts/api';

/**
 * The workspace state machine (D08, D09, D10, UX-03, UX-04).
 *
 * Everything difficult about this screen is a race. The owner is typing while a
 * generation request is in flight, a translation is being refreshed for text that
 * has since changed, and a save may or may not have committed before the response
 * was lost. So the rules are expressed here, as pure transitions over versioned
 * state, where they can be tested without a browser.
 *
 * Four invariants, and every action below is written to preserve them:
 *
 *   1. No asynchronous result ever replaces editor text. It may *propose*
 *      a replacement; only an explicit user action applies it.
 *   2. A result that belongs to an older version of the source or the editor is
 *      discarded, not applied late.
 *   3. The English meaning is tied to the exact Chinese text that produced it. Any
 *      change to that text makes it stale immediately, not on the next request.
 *   4. Nothing claims a save succeeded until the server has said it committed.
 */

export interface HistorySection {
  state: SectionState;
  items: PastReply[];
  nextCursor: string | null;
  reason: 'no_match' | 'lookup_failed' | null;
}

export interface ResourceSection {
  state: SectionState;
  items: QualifiedResource[];
  reason: 'no_match' | 'empty_catalog' | 'lookup_failed' | null;
}

export type IdeasState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; ideas: ReplyIdea[]; suggestedIndex: number; warnings: string[] }
  | {
      status: 'failed';
      code: 'failed' | 'rate_limited' | 'not_configured' | 'withheld';
      retryAfterSeconds: number | null;
    };

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'failed'; canRetry: true }
  | { status: 'saved'; replyId: string; progress: Progress; undoFailed?: boolean };

export interface ProposalState {
  /** What would replace the editor if the owner accepts. */
  text: string;
  /** The editor version this proposal was computed from. */
  baseEditorVersion: number;
  origin: 'idea' | 'refine' | 'library';
  /** Present when the proposal came from a specific idea card. */
  ideaId: string | null;
}

export interface InsertedResource {
  resourceId: string;
  version: number;
  /** The exact text inserted, so removal can be exact rather than approximate. */
  insertedText: string;
}

export interface MeaningState {
  text: string | null;
  /** The hash of the Chinese text this meaning describes. */
  sourceHash: string | null;
  status: 'idle' | 'loading' | 'stale' | 'ready' | 'failed';
}

export interface WorkspaceState {
  platform: Platform;
  targetKind: TargetKind;
  sourceText: string;
  parentText: string;
  sourceUrl: string;

  sessionId: string | null;
  sourceVersion: number;
  contextVersion: number;
  editorVersion: number;

  /** The exact text in the editor. Never rewritten by anything asynchronous. */
  draft: string;
  /** True once the owner has typed. A pristine editor may be filled silently. */
  dirty: boolean;
  /** One step of undo, kept across a replacement or an applied rewrite. */
  previousDraft: string | null;

  history: HistorySection;
  resources: ResourceSection;
  ideas: IdeasState;
  proposal: ProposalState | null;
  insertedResource: InsertedResource | null;
  /** What `insertedResource` becomes if the pending proposal is accepted. */
  pendingResource: InsertedResource | null;
  meaning: MeaningState;

  copiedHash: string | null;
  save: SaveState;
  progress: Progress | null;
}

export type WorkspaceAction =
  | { type: 'set_platform'; platform: Platform }
  | { type: 'set_target_kind'; targetKind: TargetKind }
  | { type: 'edit_source'; field: 'sourceText' | 'parentText' | 'sourceUrl'; value: string }
  | { type: 'analyse_started' }
  | {
      type: 'analyse_succeeded';
      sessionId: string;
      sourceVersion: number;
      contextVersion: number;
      editorVersion: number;
      history: HistorySection;
      resources: ResourceSection;
    }
  | { type: 'analyse_failed' }
  | { type: 'history_page'; items: PastReply[]; nextCursor: string | null }
  | { type: 'generate_started'; sourceVersion: number }
  | {
      type: 'generate_succeeded';
      sourceVersion: number;
      ideas: ReplyIdea[];
      suggestedIndex: number;
      warnings: string[];
    }
  | {
      type: 'generate_failed';
      sourceVersion: number;
      code: 'failed' | 'rate_limited' | 'not_configured' | 'withheld';
      retryAfterSeconds?: number;
    }
  | { type: 'edit_draft'; value: string; hash: string }
  | { type: 'draft_saved_to_server'; editorVersion: number }
  | { type: 'use_idea'; idea: ReplyIdea }
  | { type: 'propose'; proposal: ProposalState }
  | { type: 'accept_proposal'; hash: string }
  | { type: 'reject_proposal' }
  | { type: 'insert_resource'; resource: QualifiedResource; insertedText: string; hash: string }
  | { type: 'remove_resource'; hash: string }
  | { type: 'meaning_requested' }
  | { type: 'meaning_received'; text: string; sourceHash: string }
  | { type: 'meaning_failed' }
  | { type: 'copied'; hash: string }
  | { type: 'copy_failed' }
  | { type: 'save_started' }
  | { type: 'save_succeeded'; replyId: string; progress: Progress }
  | { type: 'save_failed' }
  | { type: 'undo' }
  | { type: 'next_reply' }
  | {
      type: 'restore_draft';
      sessionId: string;
      platform: Platform;
      targetKind: TargetKind;
      sourceText: string;
      parentText: string;
      sourceUrl: string;
      draft: string;
      editorVersion: number;
      sourceVersion: number;
      contextVersion: number;
    }
  | { type: 'undo_recorded'; progress: Progress }
  | { type: 'undo_recorded_failed' }
  | { type: 'progress_refreshed'; progress: Progress };

export function initialState(platform: Platform = 'linkedin'): WorkspaceState {
  return {
    platform,
    targetKind: 'post',
    sourceText: '',
    parentText: '',
    sourceUrl: '',
    sessionId: null,
    sourceVersion: 0,
    contextVersion: 0,
    editorVersion: 0,
    draft: '',
    dirty: false,
    previousDraft: null,
    history: { state: 'empty', items: [], nextCursor: null, reason: null },
    resources: { state: 'empty', items: [], reason: null },
    ideas: { status: 'idle' },
    proposal: null,
    insertedResource: null,
    pendingResource: null,
    meaning: { text: null, sourceHash: null, status: 'idle' },
    copiedHash: null,
    save: { status: 'idle' },
    progress: null,
  };
}

/** Changing the Chinese text invalidates its English meaning immediately (D09). */
function invalidateMeaning(meaning: MeaningState): MeaningState {
  if (meaning.text === null) return meaning;
  return { ...meaning, status: 'stale' };
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'set_platform':
      // The platform preference survives; the draft does not silently change.
      return { ...state, platform: action.platform, meaning: invalidateMeaning(state.meaning) };

    case 'set_target_kind':
      return { ...state, targetKind: action.targetKind };

    case 'edit_source':
      return { ...state, [action.field]: action.value };

    case 'analyse_started':
      return {
        ...state,
        history: { state: 'loading', items: [], nextCursor: null, reason: null },
        resources: { state: 'loading', items: [], reason: null },
        ideas: { status: 'idle' },
      };

    case 'analyse_succeeded':
      return {
        ...state,
        sessionId: action.sessionId,
        sourceVersion: action.sourceVersion,
        contextVersion: action.contextVersion,
        // A fresh session starts the editor version where the server says it is.
        editorVersion: action.editorVersion,
        history: action.history,
        resources: action.resources,
      };

    case 'analyse_failed':
      return {
        ...state,
        history: { state: 'error', items: [], nextCursor: null, reason: 'lookup_failed' },
        resources: { state: 'error', items: [], reason: 'lookup_failed' },
      };

    case 'history_page':
      // Paginating must not disturb the editor or the current selection.
      return {
        ...state,
        history: {
          ...state.history,
          items: [...state.history.items, ...action.items],
          nextCursor: action.nextCursor,
        },
      };

    case 'generate_started':
      if (action.sourceVersion !== state.sourceVersion) return state;
      return { ...state, ideas: { status: 'loading' } };

    case 'generate_succeeded':
      // A response for a source the owner has already moved on from is discarded.
      if (action.sourceVersion !== state.sourceVersion) return state;
      return {
        ...state,
        ideas: {
          status: 'ready',
          ideas: action.ideas,
          suggestedIndex: action.suggestedIndex,
          warnings: action.warnings,
        },
      };

    case 'generate_failed':
      if (action.sourceVersion !== state.sourceVersion) return state;
      return {
        ...state,
        ideas: {
          status: 'failed',
          code: action.code,
          retryAfterSeconds: action.retryAfterSeconds ?? null,
        },
      };

    case 'edit_draft':
      return {
        ...state,
        draft: action.value,
        dirty: true,
        meaning: invalidateMeaning(state.meaning),
        // Typing makes any pending proposal stale: it was computed from older text.
        proposal: null,
        // A save that failed can be retried, but the text has moved on, so the
        // previous failure is no longer the current state.
        save: state.save.status === 'failed' ? { status: 'idle' } : state.save,
      };

    case 'draft_saved_to_server':
      // Optimistic version tracking. A lower version from a late response is ignored.
      return action.editorVersion > state.editorVersion
        ? { ...state, editorVersion: action.editorVersion }
        : state;

    case 'use_idea': {
      const text = action.idea.reply_text;
      // A pristine editor is filled directly. A dirty one gets a preview (D08).
      if (!state.dirty && state.draft.trim() === '') {
        return {
          ...state,
          draft: text,
          previousDraft: state.draft,
          meaning: action.idea.english_meaning
            ? { text: action.idea.english_meaning, sourceHash: null, status: 'ready' }
            : invalidateMeaning(state.meaning),
        };
      }
      return {
        ...state,
        proposal: {
          text,
          baseEditorVersion: state.editorVersion,
          origin: 'idea',
          ideaId: action.idea.id,
        },
      };
    }

    case 'propose':
      // A proposal computed from an older editor version is already stale.
      if (action.proposal.baseEditorVersion !== state.editorVersion) return state;
      return { ...state, proposal: action.proposal };

    case 'accept_proposal': {
      if (!state.proposal) return state;
      return {
        ...state,
        draft: state.proposal.text,
        previousDraft: state.draft,
        dirty: true,
        proposal: null,
        // A proposal that swapped the attached resource carries the new one.
        ...(state.pendingResource ? { insertedResource: state.pendingResource } : {}),
        pendingResource: null,
        meaning: invalidateMeaning(state.meaning),
      };
    }

    case 'reject_proposal':
      // Keep my reply preserves the exact text, byte for byte, and the resource
      // that would have been swapped in is forgotten along with the proposal.
      return { ...state, proposal: null, pendingResource: null };

    case 'insert_resource': {
      if (state.insertedResource?.resourceId === action.resource.id) {
        // Re-adding the same resource is a no-op (D06).
        return state;
      }
      if (state.insertedResource) {
        // A different resource previews a replacement rather than accumulating
        // links. If the owner has edited the previous block it can no longer be
        // removed exactly, so the preview appends instead and shows them the
        // result: two links they chose beats one edit silently deleted.
        const previous = state.insertedResource.insertedText;
        const withoutPrevious = state.draft.includes(previous)
          ? state.draft.replace(previous, '').trimEnd()
          : state.draft;

        return {
          ...state,
          // The proposal carries which resource it would attach, so accepting it
          // updates the record of what is in the text. Without this the session
          // still claimed the *previous* resource: the reply got recorded with a
          // snapshot naming a link that was no longer in it, and Remove resource
          // became a no-op because it searched for text that had been replaced.
          pendingResource: {
            resourceId: action.resource.id,
            version: action.resource.version,
            insertedText: action.insertedText,
          },
          proposal: {
            text: withoutPrevious.concat(action.insertedText),
            baseEditorVersion: state.editorVersion,
            origin: 'refine',
            ideaId: null,
          },
        };
      }
      return {
        ...state,
        draft: state.draft.concat(action.insertedText),
        previousDraft: state.draft,
        dirty: true,
        insertedResource: {
          resourceId: action.resource.id,
          version: action.resource.version,
          insertedText: action.insertedText,
        },
        meaning: invalidateMeaning(state.meaning),
      };
    }

    case 'remove_resource': {
      const inserted = state.insertedResource;
      if (!inserted) return state;
      if (!state.draft.includes(inserted.insertedText)) {
        // The owner edited the inserted block. Removing it blindly would delete
        // their writing, so this needs an explicit preview instead.
        return {
          ...state,
          proposal: {
            text: state.draft,
            baseEditorVersion: state.editorVersion,
            origin: 'refine',
            ideaId: null,
          },
        };
      }
      return {
        ...state,
        draft: state.draft.replace(inserted.insertedText, ''),
        previousDraft: state.draft,
        dirty: true,
        insertedResource: null,
        meaning: invalidateMeaning(state.meaning),
      };
    }

    case 'meaning_requested':
      return { ...state, meaning: { ...state.meaning, status: 'loading' } };

    case 'meaning_received': {
      // The comparison is made against the draft *now*, read from state, not
      // against a hash the caller passes in.
      //
      // The caller is an async handler that closed over the draft when the owner
      // clicked, so anything it computes describes the text at click time. Asking
      // it "is this still current?" always answered yes, which made this guard
      // look present and do nothing: the English of the old Chinese was shown as
      // current, on the one screen whose job is checking what is about to be
      // posted. The reducer holds the live draft, so it is the only thing that
      // can answer honestly.
      if (action.sourceHash !== contentHash(state.draft)) {
        return { ...state, meaning: { ...state.meaning, status: 'stale' } };
      }
      return {
        ...state,
        meaning: { text: action.text, sourceHash: action.sourceHash, status: 'ready' },
      };
    }

    case 'meaning_failed':
      // Translation failure never blocks copying or saving.
      return { ...state, meaning: { ...state.meaning, status: 'failed' } };

    case 'copied':
      // Copying is not posting and changes no count.
      return { ...state, copiedHash: action.hash };

    case 'copy_failed':
      return { ...state, copiedHash: null };

    case 'save_started':
      return { ...state, save: { status: 'saving' } };

    case 'save_succeeded':
      // The text stays on screen until Next reply, so a wrong save can be undone
      // and the final text is still recoverable.
      return {
        ...state,
        save: { status: 'saved', replyId: action.replyId, progress: action.progress },
        progress: action.progress,
      };

    case 'save_failed':
      return { ...state, save: { status: 'failed', canRetry: true } };

    case 'undo':
      if (state.previousDraft === null) return state;
      return {
        ...state,
        draft: state.previousDraft,
        previousDraft: null,
        dirty: true,
        meaning: invalidateMeaning(state.meaning),
      };

    case 'next_reply': {
      // Clears working text only once the save is resolved, and keeps the platform.
      if (state.save.status === 'saving') return state;
      const fresh = initialState(state.platform);
      return { ...fresh, progress: state.progress };
    }

    case 'restore_draft':
      // Coming back from a utility page. The text is restored exactly, and the
      // editor is marked dirty because it is: these are words the owner wrote.
      // Retrieval and ideas are deliberately not restored, because they belong to
      // a request that is over; the owner can ask again, and showing stale
      // results as current would be the same lie this app exists to avoid.
      return {
        ...state,
        sessionId: action.sessionId,
        platform: action.platform,
        targetKind: action.targetKind,
        sourceText: action.sourceText,
        parentText: action.parentText,
        sourceUrl: action.sourceUrl,
        draft: action.draft,
        dirty: action.draft !== '',
        editorVersion: action.editorVersion,
        sourceVersion: action.sourceVersion,
        contextVersion: action.contextVersion,
      };

    case 'undo_recorded':
      // The app's record is withdrawn and the count follows. The reply on the
      // social platform is untouched, which is why the session goes back to a
      // plain draft rather than to some "unposted" state that implies otherwise.
      return {
        ...state,
        save: { status: 'idle' },
        progress: action.progress,
      };

    case 'undo_recorded_failed':
      // Nothing changed, so the recorded state stands. Saying so beats leaving a
      // button that looks like it worked.
      return { ...state, save: { ...state.save, undoFailed: true } as SaveState };

    case 'progress_refreshed':
      return { ...state, progress: action.progress };

    default:
      return state;
  }
}

/** Whether the owner has copied the exact text now in the editor (D10). */
export function isEditedSinceCopy(state: WorkspaceState, currentHash: string): boolean {
  return state.copiedHash !== null && state.copiedHash !== currentHash;
}

/** The English meaning is offered only where the reply is written in Chinese. */
export function meaningApplies(state: WorkspaceState): boolean {
  return state.platform === 'threads';
}


import { describe, it, expect } from 'vitest';
import {
  initialState,
  workspaceReducer,
  isEditedSinceCopy,
  type WorkspaceAction,
  type WorkspaceState,
} from '@/replies/lib/workspace/reducer';
import type { ReplyIdea, QualifiedResource, Progress } from '@/replies/lib/contracts/api';
import { contentHash } from '@/replies/lib/contracts/text';

/**
 * UX-03, UX-04, ZH-01, RES-04 and D10.
 *
 * These are the races. Each test describes a thing the owner actually does while
 * something else is in flight, and asserts that their text survives it.
 */

function run(state: WorkspaceState, ...actions: WorkspaceAction[]): WorkspaceState {
  return actions.reduce(workspaceReducer, state);
}

const idea = (overrides: Partial<ReplyIdea> = {}): ReplyIdea => ({
  id: '11111111-1111-4111-8111-000000000001',
  position: 0,
  angle_label: 'Direct answer',
  reply_text: 'The suggested reply text.',
  english_meaning: null,
  resource_id: null,
  cta_text: null,
  uses_fact_ids: [],
  based_on_reply_ids: [],
  ...overrides,
});

const resource = (overrides: Partial<QualifiedResource> = {}): QualifiedResource => ({
  id: '22222222-2222-4222-8222-000000000002',
  version: 1,
  type: 'guide',
  ownership: 'own',
  title: 'Cover letter guide',
  url: 'https://resources.example.com/guides/cover-letters',
  locale: 'en',
  english_fallback: false,
  why_it_fits: 'It covers the opening line the post is asking about.',
  access_notes: null,
  cta_text: 'I wrote something on this.',
  ...overrides,
});

const progress: Progress = {
  local_day: '2026-03-11',
  timezone: 'Asia/Taipei',
  counts: { linkedin: 3, x: 0, threads: 0 },
  targets: { linkedin: 10, x: 10, threads: 10 },
};

const analysed = (platform: 'linkedin' | 'threads' = 'linkedin'): WorkspaceState =>
  run(initialState(platform), {
    type: 'analyse_succeeded',
    sessionId: '33333333-3333-4333-8333-000000000003',
    sourceVersion: 1,
    contextVersion: 1,
    editorVersion: 0,
    history: { state: 'ready', items: [], nextCursor: null, reason: null },
    resources: { state: 'ready', items: [], reason: null },
  });

describe('a pristine editor versus a dirty one (D08)', () => {
  it('fills an empty editor directly', () => {
    const next = run(analysed(), { type: 'use_idea', idea: idea() });

    expect(next.draft).toBe('The suggested reply text.');
    expect(next.proposal).toBeNull();
  });

  it('proposes rather than replaces once the owner has typed', () => {
    const typed = run(analysed(), {
      type: 'edit_draft',
      value: 'My own words.',
      hash: contentHash('My own words.'),
    });
    const next = run(typed, { type: 'use_idea', idea: idea() });

    expect(next.draft).toBe('My own words.');
    expect(next.proposal?.text).toBe('The suggested reply text.');
  });

  it('Keep my reply preserves the exact text, byte for byte', () => {
    const exact = '  My own words, with trailing spaces.   ';
    const typed = run(analysed(), { type: 'edit_draft', value: exact, hash: contentHash(exact) });
    const next = run(typed, { type: 'use_idea', idea: idea() }, { type: 'reject_proposal' });

    expect(next.draft).toBe(exact);
    expect(next.proposal).toBeNull();
  });

  it('Replace reply applies the proposal and keeps one step of undo', () => {
    const typed = run(analysed(), {
      type: 'edit_draft',
      value: 'My own words.',
      hash: contentHash('My own words.'),
    });
    const replaced = run(
      typed,
      { type: 'use_idea', idea: idea() },
      { type: 'accept_proposal', hash: contentHash('The suggested reply text.') },
    );

    expect(replaced.draft).toBe('The suggested reply text.');

    const undone = run(replaced, { type: 'undo' });
    expect(undone.draft).toBe('My own words.');
  });
});

describe('late responses cannot overwrite newer work (UX-03)', () => {
  it('discards ideas that belong to an older source version', () => {
    const state = { ...analysed(), sourceVersion: 2 };
    const next = run(state, {
      type: 'generate_succeeded',
      sourceVersion: 1,
      ideas: [idea()],
      suggestedIndex: 0,
      warnings: [],
    });

    expect(next.ideas.status).toBe('idle');
  });

  it('discards a failure that belongs to an older source version', () => {
    const state = { ...analysed(), sourceVersion: 2, ideas: { status: 'loading' } as const };
    const next = run(state, { type: 'generate_failed', sourceVersion: 1, code: 'failed' });

    expect(next.ideas.status).toBe('loading');
  });

  it('drops a pending proposal the moment the owner types', () => {
    const typed = run(analysed(), {
      type: 'edit_draft',
      value: 'First words.',
      hash: contentHash('First words.'),
    });
    const withProposal = run(typed, { type: 'use_idea', idea: idea() });
    expect(withProposal.proposal).not.toBeNull();

    const typedAgain = run(withProposal, {
      type: 'edit_draft',
      value: 'First words, extended.',
      hash: contentHash('First words, extended.'),
    });
    expect(typedAgain.proposal).toBeNull();
  });

  it('ignores a proposal computed from a stale editor version', () => {
    const state = { ...analysed(), editorVersion: 5 };
    const next = run(state, {
      type: 'propose',
      proposal: { text: 'Stale rewrite.', baseEditorVersion: 4, origin: 'refine', ideaId: null },
    });

    expect(next.proposal).toBeNull();
  });

  it('ignores a server editor version lower than the one already held', () => {
    const state = { ...analysed(), editorVersion: 7 };
    const next = run(state, { type: 'draft_saved_to_server', editorVersion: 5 });

    expect(next.editorVersion).toBe(7);
  });

  it('paginating history leaves the editor and the draft alone', () => {
    const typed = run(analysed(), {
      type: 'edit_draft',
      value: 'Mid-sentence',
      hash: contentHash('Mid-sentence'),
    });
    const next = run(typed, { type: 'history_page', items: [], nextCursor: 'cursor-2' });

    expect(next.draft).toBe('Mid-sentence');
    expect(next.history.nextCursor).toBe('cursor-2');
  });
});

describe('the English meaning is tied to exact Chinese (ZH-01)', () => {
  const chinese = '大部分的招募人員只會快速掃過。';
  const edited = '大部分的招募人員只會快速掃過前兩行。';

  function withMeaning(): WorkspaceState {
    return run(
      analysed('threads'),
      { type: 'edit_draft', value: chinese, hash: contentHash(chinese) },
      { type: 'meaning_requested' },
      {
        type: 'meaning_received',
        text: 'Most recruiters only skim it.',
        sourceHash: contentHash(chinese),
      },
    );
  }

  it('is ready when it matches the current text', () => {
    expect(withMeaning().meaning.status).toBe('ready');
  });

  it('becomes stale the moment the Chinese changes', () => {
    const next = run(withMeaning(), {
      type: 'edit_draft',
      value: edited,
      hash: contentHash(edited),
    });

    expect(next.meaning.status).toBe('stale');
    // Refreshing changes the English. It never touches the Chinese.
    expect(next.draft).toBe(edited);
  });

  it('becomes stale when a resource is inserted', () => {
    const next = run(withMeaning(), {
      type: 'insert_resource',
      resource: resource(),
      insertedText: '\n\nhttps://resources.example.com/guides/cover-letters',
      hash: 'irrelevant',
    });

    expect(next.meaning.status).toBe('stale');
  });

  it('becomes stale when a rewrite is accepted', () => {
    const state = withMeaning();
    const next = run(
      state,
      {
        type: 'propose',
        proposal: {
          text: '更短的版本。',
          baseEditorVersion: state.editorVersion,
          origin: 'refine',
          ideaId: null,
        },
      },
      { type: 'accept_proposal', hash: contentHash('更短的版本。') },
    );

    expect(next.meaning.status).toBe('stale');
  });

  it('discards a translation that arrived for text that has since changed', () => {
    // The reducer reads the live draft rather than trusting a hash the caller
    // computed. The caller closed over the draft at click time, so the old
    // version of this guard could never see a difference and never fired.
    const state = run(withMeaning(), {
      type: 'edit_draft',
      value: edited,
      hash: contentHash(edited),
    });
    const next = run(state, {
      type: 'meaning_received',
      text: 'A translation of the old text.',
      sourceHash: contentHash(chinese),
    });

    expect(next.meaning.status).toBe('stale');
    expect(next.meaning.text).not.toBe('A translation of the old text.');
  });

  it('a translation failure does not disable copying or saving', () => {
    const next = run(withMeaning(), { type: 'meaning_failed' });

    expect(next.meaning.status).toBe('failed');
    expect(next.draft).toBe(chinese);
    expect(next.save.status).toBe('idle');
  });
});

describe('resource insertion preserves human text (RES-04)', () => {
  const inserted = '\n\nI wrote something on this. https://resources.example.com/guides/cover-letters';

  function withResource(): WorkspaceState {
    return run(
      analysed(),
      { type: 'edit_draft', value: 'My reply.', hash: contentHash('My reply.') },
      { type: 'insert_resource', resource: resource(), insertedText: inserted, hash: 'h' },
    );
  }

  it('appends without rewriting what was already there', () => {
    const next = withResource();
    expect(next.draft).toBe(`My reply.${inserted}`);
    expect(next.insertedResource?.resourceId).toBe(resource().id);
  });

  it('adding the same resource again does nothing', () => {
    const once = withResource();
    const twice = run(once, {
      type: 'insert_resource',
      resource: resource(),
      insertedText: inserted,
      hash: 'h',
    });

    expect(twice.draft).toBe(once.draft);
  });

  it('adding a different resource previews a replacement instead of stacking links', () => {
    const next = run(withResource(), {
      type: 'insert_resource',
      resource: resource({ id: '44444444-4444-4444-8444-000000000004', title: 'Interview guide' }),
      insertedText: '\n\nAnother link.',
      hash: 'h',
    });

    expect(next.proposal).not.toBeNull();
    // The editor itself is untouched until the owner accepts.
    expect(next.draft).toBe(`My reply.${inserted}`);
  });

  it('replaces cleanly when the previous block is untouched', () => {
    const next = run(withResource(), {
      type: 'insert_resource',
      resource: resource({ id: '44444444-4444-4444-8444-000000000004' }),
      insertedText: '\n\nAnother link.',
      hash: 'h',
    });

    // Exactly one resource block in the proposal, not two.
    expect(next.proposal?.text).toBe('My reply.\n\nAnother link.');
  });

  it('appends rather than deleting an edited block, and shows the result first', () => {
    const edited = run(withResource(), {
      type: 'edit_draft',
      value: 'My reply.\n\nI wrote something on this, have a look.',
      hash: 'h2',
    });
    const next = run(edited, {
      type: 'insert_resource',
      resource: resource({ id: '44444444-4444-4444-8444-000000000004' }),
      insertedText: '\n\nAnother link.',
      hash: 'h2',
    });

    // The owner's edited words survive, and the outcome is visible before it
    // happens rather than applied silently.
    expect(next.draft).toBe('My reply.\n\nI wrote something on this, have a look.');
    expect(next.proposal?.text).toContain('have a look.');
    expect(next.proposal?.text).toContain('Another link.');
  });

  it('removes an untouched inserted block exactly', () => {
    const next = run(withResource(), { type: 'remove_resource', hash: 'h' });

    expect(next.draft).toBe('My reply.');
    expect(next.insertedResource).toBeNull();
  });

  it('previews instead of deleting when the owner edited the inserted block', () => {
    const edited = run(withResource(), {
      type: 'edit_draft',
      value: 'My reply.\n\nI wrote something on this, have a look.',
      hash: 'h2',
    });
    const next = run(edited, { type: 'remove_resource', hash: 'h2' });

    expect(next.draft).toBe('My reply.\n\nI wrote something on this, have a look.');
    expect(next.proposal).not.toBeNull();
  });
});

describe('copy, save and next (D10)', () => {
  it('copying changes no count', () => {
    const next = run(analysed(), { type: 'copied', hash: 'h' });

    expect(next.progress).toBeNull();
    expect(next.save.status).toBe('idle');
  });

  it('reports edited-since-copy without blocking anything', () => {
    const state = run(analysed(), { type: 'copied', hash: contentHash('one') });

    expect(isEditedSinceCopy(state, contentHash('one'))).toBe(false);
    expect(isEditedSinceCopy(state, contentHash('two'))).toBe(true);
  });

  it('keeps the text after a failed save and allows a retry', () => {
    const state = run(
      analysed(),
      { type: 'edit_draft', value: 'Final text.', hash: contentHash('Final text.') },
      { type: 'save_started' },
      { type: 'save_failed' },
    );

    expect(state.draft).toBe('Final text.');
    expect(state.save).toEqual({ status: 'failed', canRetry: true });
  });

  it('keeps the saved text on screen until Next reply', () => {
    const saved = run(
      analysed(),
      { type: 'edit_draft', value: 'Final text.', hash: contentHash('Final text.') },
      { type: 'save_started' },
      { type: 'save_succeeded', replyId: 'r1', progress },
    );

    expect(saved.draft).toBe('Final text.');
    expect(saved.progress?.counts.linkedin).toBe(3);

    const next = run(saved, { type: 'next_reply' });
    expect(next.draft).toBe('');
    expect(next.platform).toBe('linkedin');
    expect(next.progress?.counts.linkedin).toBe(3);
  });

  it('refuses to clear while a save is still in flight', () => {
    const saving = run(
      analysed(),
      { type: 'edit_draft', value: 'Final text.', hash: contentHash('Final text.') },
      { type: 'save_started' },
      { type: 'next_reply' },
    );

    expect(saving.draft).toBe('Final text.');
    expect(saving.save.status).toBe('saving');
  });
});

describe('platform changes', () => {
  it('never silently rewrites the draft', () => {
    const typed = run(analysed(), {
      type: 'edit_draft',
      value: 'Half a sentence',
      hash: contentHash('Half a sentence'),
    });
    const next = run(typed, { type: 'set_platform', platform: 'threads' });

    expect(next.draft).toBe('Half a sentence');
    expect(next.platform).toBe('threads');
  });
});

describe('section states stay distinct (D12)', () => {
  it('separates a failed lookup from an empty result', () => {
    const failed = run(analysed(), { type: 'analyse_failed' });

    expect(failed.resources.state).toBe('error');
    expect(failed.resources.reason).toBe('lookup_failed');
    expect(failed.history.state).toBe('error');
  });
});

describe('Undo recorded status (DAY-02)', () => {
  const saved = (): WorkspaceState =>
    run(
      analysed(),
      { type: 'edit_draft', value: 'Recorded by mistake.', hash: contentHash('Recorded by mistake.') },
      { type: 'save_started' },
      { type: 'save_succeeded', replyId: 'reply-1', progress },
    );

  it('clears the recorded state and takes the new count from the server', () => {
    const after: Progress = {
      ...progress,
      counts: { ...progress.counts, linkedin: progress.counts.linkedin - 1 },
    };
    const next = run(saved(), { type: 'undo_recorded', progress: after });

    expect(next.save.status).toBe('idle');
    expect(next.progress?.counts.linkedin).toBe(progress.counts.linkedin - 1);
    // The text is still there: undoing a record is not discarding the reply.
    expect(next.draft).toBe('Recorded by mistake.');
  });

  it('says so when the undo did not happen, rather than looking like it worked', () => {
    const next = run(saved(), { type: 'undo_recorded_failed' });

    expect(next.save.status).toBe('saved');
    expect(next.save.status === 'saved' && next.save.undoFailed).toBe(true);
    // The count has not moved, because nothing was withdrawn.
    expect(next.progress?.counts.linkedin).toBe(progress.counts.linkedin);
  });
});

describe('replacing an attached resource (RES-04)', () => {
  const inserted = '\n\nFirst link.';

  function withFirst(): WorkspaceState {
    return run(
      analysed(),
      { type: 'edit_draft', value: 'My reply.', hash: contentHash('My reply.') },
      { type: 'insert_resource', resource: resource(), insertedText: inserted, hash: 'h' },
    );
  }

  it('attaches the new resource once the replacement is accepted', () => {
    const second = resource({ id: '44444444-4444-4444-8444-000000000004', version: 3 });
    const next = run(
      withFirst(),
      { type: 'insert_resource', resource: second, insertedText: '\n\nSecond link.', hash: 'h' },
      { type: 'accept_proposal', hash: 'h2' },
    );

    // Without this the session still claimed the FIRST resource, so the reply was
    // recorded with a snapshot naming a link that was no longer in the text, and
    // Remove resource searched for text that had already been replaced.
    expect(next.insertedResource?.resourceId).toBe(second.id);
    expect(next.insertedResource?.version).toBe(3);
    expect(next.draft).toContain('Second link.');
    expect(next.draft).not.toContain('First link.');
  });

  it('keeps the original attached when the replacement is rejected', () => {
    const next = run(
      withFirst(),
      {
        type: 'insert_resource',
        resource: resource({ id: '44444444-4444-4444-8444-000000000004' }),
        insertedText: '\n\nSecond link.',
        hash: 'h',
      },
      { type: 'reject_proposal' },
    );

    expect(next.insertedResource?.resourceId).toBe(resource().id);
    expect(next.draft).toBe(`My reply.${inserted}`);
  });

  it('then removes the new block exactly', () => {
    const second = resource({ id: '44444444-4444-4444-8444-000000000004' });
    const next = run(
      withFirst(),
      { type: 'insert_resource', resource: second, insertedText: '\n\nSecond link.', hash: 'h' },
      { type: 'accept_proposal', hash: 'h2' },
      { type: 'remove_resource', hash: 'h3' },
    );

    expect(next.draft).toBe('My reply.');
    expect(next.insertedResource).toBeNull();
  });
});


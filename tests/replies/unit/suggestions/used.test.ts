import { describe, expect, it } from 'vitest';
import {
  addSource,
  canAdd,
  commit,
  currentSources,
  delta,
  emptySelection,
  isChanged,
  moreSuggestions,
  removeSource,
} from '@/replies/lib/suggestions/used';
import { REFINE_SOURCE_LIMITS, refineRequestSchema } from '@/replies/lib/contracts/api';

const F1 = '11111111-1111-4111-8111-000000000001';
const F2 = '11111111-1111-4111-8111-000000000002';
const F3 = '11111111-1111-4111-8111-000000000003';

describe('Used in this reply: insert and remove (#245)', () => {
  it('starts from what the reply already draws on, unchanged', () => {
    const selection = emptySelection({ facts: [F1, F1] });
    expect(currentSources(selection)).toEqual({ facts: [F1], posts: [] });
    expect(isChanged(selection)).toBe(false);
    expect(delta(selection)).toEqual({ extra_fact_ids: [], extra_post_ids: [], excluded_fact_ids: [] });
  });

  it('x on a fact the reply used excludes it', () => {
    const next = removeSource(emptySelection({ facts: [F1, F2] }), 'fact', F1);
    expect(currentSources(next).facts).toEqual([F2]);
    expect(delta(next)).toMatchObject({ excluded_fact_ids: [F1], extra_fact_ids: [] });
  });

  it('+ on a suggestion adds it, and x on it straight after is a clean undo', () => {
    const added = addSource(emptySelection(), 'fact', F3);
    expect(delta(added).extra_fact_ids).toEqual([F3]);
    const undone = removeSource(added, 'fact', F3);
    expect(isChanged(undone)).toBe(false);
  });

  it('+ on a fact just removed puts it back without asking for it as new', () => {
    const removed = removeSource(emptySelection({ facts: [F1] }), 'fact', F1);
    const back = addSource(removed, 'fact', F1);
    expect(isChanged(back)).toBe(false);
    expect(currentSources(back).facts).toEqual([F1]);
  });

  it('adding something already used is a no-op', () => {
    const selection = emptySelection({ facts: [F1] });
    expect(addSource(selection, 'fact', F1)).toBe(selection);
    expect(removeSource(selection, 'fact', F2)).toBe(selection);
  });

  it('earlier posts are added and dropped, never excluded', () => {
    const added = addSource(emptySelection(), 'post', 'LIB-1');
    expect(delta(added)).toMatchObject({ extra_post_ids: ['LIB-1'], excluded_fact_ids: [] });
    expect(delta(removeSource(added, 'post', 'LIB-1'))).toEqual({
      extra_fact_ids: [],
      extra_post_ids: [],
      excluded_fact_ids: [],
    });
  });

  it('a change becomes the new starting point only when committed', () => {
    const changed = addSource(removeSource(emptySelection({ facts: [F1] }), 'fact', F1), 'fact', F2);
    const committed = commit(changed);
    expect(isChanged(committed)).toBe(false);
    expect(currentSources(committed)).toEqual({ facts: [F2], posts: [] });
    // An uncommitted selection (preview rejected) keeps its original base.
    expect(changed.base.facts).toEqual([F1]);
  });

  it('refuses a + beyond what one rewrite may carry, so the request stays valid', () => {
    let selection = emptySelection();
    for (let index = 0; index < REFINE_SOURCE_LIMITS.facts; index += 1) {
      expect(canAdd(selection, 'fact')).toBe(true);
      selection = addSource(selection, 'fact', `00000000-0000-4000-8000-00000000000${index}`);
    }
    expect(canAdd(selection, 'fact')).toBe(false);
  });

  it('always produces a delta the refine contract accepts', () => {
    const selection = addSource(removeSource(emptySelection({ facts: [F1] }), 'fact', F1), 'post', 'LIB-1');
    const parsed = refineRequestSchema.safeParse({
      session_id: '22222222-2222-4222-8222-000000000001',
      expected_editor_version: 0,
      action: 'use_sources',
      request_key: 'k',
      ...delta(selection),
    });
    expect(parsed.success).toBe(true);
  });
});

describe('More suggestions', () => {
  const all = {
    facts: [
      { id: F1, text: 'one', private: false },
      { id: F2, text: 'two', private: true },
    ],
    posts: [{ id: 'LIB-1', title: 't', excerpt: 'e', text: 'e', platform: 'LinkedIn' }],
  };

  it('lists everything suggested that the reply is not using', () => {
    const more = moreSuggestions(all, { facts: [F1], posts: [] });
    expect(more.facts.map((fact) => fact.id)).toEqual([F2]);
    expect(more.posts.map((post) => post.id)).toEqual(['LIB-1']);
  });

  it('moves a source between the two rows as it is added and removed', () => {
    let selection = emptySelection({ facts: [F1] });
    selection = removeSource(selection, 'fact', F1);
    expect(moreSuggestions(all, currentSources(selection)).facts.map((fact) => fact.id)).toEqual([F1, F2]);
    selection = addSource(selection, 'fact', F2);
    expect(moreSuggestions(all, currentSources(selection)).facts.map((fact) => fact.id)).toEqual([F1]);
  });
});

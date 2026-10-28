import { REFINE_SOURCE_LIMITS, type SuggestedFact, type SuggestedPost } from '@/replies/lib/contracts/api';

/**
 * "Used in this reply" and "More suggestions" (#245), as pure logic.
 *
 * A selection starts from what a reply already draws on (`base`). Clicking an x
 * drops a source; clicking a + adds one. Nothing is rewritten until the owner has
 * seen the preview and applied it, so a selection is a *proposal about sources*:
 * `delta` is what the rewrite request carries, and `commit` is what the selection
 * becomes once the rewrite is applied. Rejecting the preview discards the selection.
 */

export interface SourceSet {
  facts: string[];
  posts: string[];
}

export interface SourceSelection {
  base: SourceSet;
  added: SourceSet;
  /** Fact ids dropped from `base`. Posts are only ever added, so they are never "removed". */
  removed: string[];
}

export type SourceKind = 'fact' | 'post';

export interface SourceDelta {
  extra_fact_ids: string[];
  extra_post_ids: string[];
  excluded_fact_ids: string[];
}

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

export function emptySelection(base: Partial<SourceSet> = {}): SourceSelection {
  return {
    base: { facts: unique(base.facts ?? []), posts: unique(base.posts ?? []) },
    added: { facts: [], posts: [] },
    removed: [],
  };
}

/** What the reply will draw on if the pending change is applied. */
export function currentSources(selection: SourceSelection): SourceSet {
  const removed = new Set(selection.removed);
  return {
    facts: unique([...selection.base.facts.filter((id) => !removed.has(id)), ...selection.added.facts]),
    posts: unique([...selection.base.posts, ...selection.added.posts]),
  };
}

/** x: drop a source. Dropping something just added simply undoes the add. */
export function removeSource(selection: SourceSelection, kind: SourceKind, id: string): SourceSelection {
  if (kind === 'post') {
    return {
      ...selection,
      base: { ...selection.base, posts: selection.base.posts.filter((p) => p !== id) },
      added: { ...selection.added, posts: selection.added.posts.filter((p) => p !== id) },
    };
  }
  if (selection.added.facts.includes(id)) {
    return { ...selection, added: { ...selection.added, facts: selection.added.facts.filter((f) => f !== id) } };
  }
  if (selection.base.facts.includes(id) && !selection.removed.includes(id)) {
    return { ...selection, removed: [...selection.removed, id] };
  }
  return selection;
}

/** +: add a source. Adding back something just dropped simply undoes the drop. */
export function addSource(selection: SourceSelection, kind: SourceKind, id: string): SourceSelection {
  const now = currentSources(selection);
  if (kind === 'post') {
    if (now.posts.includes(id)) return selection;
    return { ...selection, added: { ...selection.added, posts: [...selection.added.posts, id] } };
  }
  if (now.facts.includes(id)) return selection;
  if (selection.removed.includes(id)) {
    return { ...selection, removed: selection.removed.filter((f) => f !== id) };
  }
  return { ...selection, added: { ...selection.added, facts: [...selection.added.facts, id] } };
}

export function isChanged(selection: SourceSelection): boolean {
  return selection.added.facts.length + selection.added.posts.length + selection.removed.length > 0;
}

/** The changed set a refine request carries, already inside the contract's bounds. */
export function delta(selection: SourceSelection): SourceDelta {
  return {
    extra_fact_ids: selection.added.facts.slice(0, REFINE_SOURCE_LIMITS.facts),
    extra_post_ids: selection.added.posts.slice(0, REFINE_SOURCE_LIMITS.posts),
    excluded_fact_ids: selection.removed.slice(0, REFINE_SOURCE_LIMITS.excluded),
  };
}

/** After the rewrite is applied, the changed set becomes the new starting point. */
export function commit(selection: SourceSelection): SourceSelection {
  return emptySelection(currentSources(selection));
}

/** Whether another + would exceed what one rewrite may carry. */
export function canAdd(selection: SourceSelection, kind: SourceKind): boolean {
  return kind === 'fact'
    ? selection.added.facts.length < REFINE_SOURCE_LIMITS.facts
    : selection.added.posts.length < REFINE_SOURCE_LIMITS.posts;
}

export interface MoreSuggestions {
  facts: SuggestedFact[];
  posts: SuggestedPost[];
}

/** Everything suggested that the reply is not already using. */
export function moreSuggestions(
  all: { facts: readonly SuggestedFact[]; posts: readonly SuggestedPost[] },
  used: SourceSet,
): MoreSuggestions {
  return {
    facts: all.facts.filter((fact) => !used.facts.includes(fact.id)),
    posts: all.posts.filter((post) => !used.posts.includes(post.id)),
  };
}

import 'server-only';
import type { Board } from '@/domain/board';
import { splitTasks } from '@/domain/display';
import type { ContentRepository } from './ports';
import type { ReconcileReport } from './reconcile';

type Name = 'nextUp' | 'fixIssues';
type Entry = { count: number | null; snapshots: readonly number[]; expiresAt: number };
// Keep metadata with the shared repository, including across Next module graphs.
const KEY = Symbol.for('content-studio.navigation-counts');
type CountRepository = ContentRepository & { [KEY]?: Partial<Record<Name, Entry>> };

export function nextUpCount(board: Pick<Board, 'tasks'>): number {
  return splitTasks(board.tasks, 12).now.length;
}

export function fixIssuesCount(report: Pick<ReconcileReport, 'items' | 'unreadable'>): number | null {
  return report.unreadable.length ? null : report.items.filter((item) => item.severity === 'blocking').length;
}

/** Called only by existing read models, after their normal provider reads. */
export function rememberNavigationCount(repo: ContentRepository, name: Name, count: number | null, expected = repo.navigationSnapshots?.()): void {
  const snapshots = repo.navigationSnapshots?.();
  const entries = (repo as CountRepository)[KEY] ??= {};
  delete entries[name];
  if (snapshots && expected && expected.sources.every((value, i) => value === snapshots.sources[i])) {
    entries[name] = { count, snapshots: snapshots.sources, expiresAt: Math.min(expected.expiresAt, snapshots.expiresAt) };
  }
}

/** No fallback to a loader or provider, including on cold start or expiry. */
export function cachedNavigationCounts(repo: ContentRepository): Record<Name, number | null> & { expiresAt: number } {
  const snapshots = repo.navigationSnapshots?.();
  const entries = (repo as CountRepository)[KEY];
  const read = (name: Name) => {
    const entry = entries?.[name];
    return entry && snapshots && Date.now() < entry.expiresAt &&
      entry.snapshots.length === snapshots.sources.length && entry.snapshots.every((value, i) => value === snapshots.sources[i])
      ? entry : undefined;
  };
  const nextUp = read('nextUp');
  const fixIssues = read('fixIssues');
  // Identical source refreshes must not renew the lifetime of an older total.
  const known = [nextUp, fixIssues].filter((entry) => entry && entry.count !== null);
  return {
    nextUp: nextUp?.count ?? null,
    fixIssues: fixIssues?.count ?? null,
    expiresAt: Math.min(snapshots?.expiresAt ?? Date.now(), ...known.map((entry) => entry!.expiresAt)),
  };
}

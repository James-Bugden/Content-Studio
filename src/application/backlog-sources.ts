import 'server-only';
import type { ContentRepository } from './ports';

/** In DB authority the Ready view is derived from the very same Library rows.
 * Reuse that snapshot instead of transferring and mapping the queued bodies a
 * second time. Legacy modes still read their independent view to detect drift. */
export async function readBacklogSources(repo: ContentRepository) {
  const library = repo.listLibrary();
  const queue = repo.draftBodyAuthority?.() === 'db'
    ? library.then(rows => rows.filter(r => r.value.reviewStatus.ok && r.value.reviewStatus.value === 'Approved' && r.value.queueForSchedule === true))
    : repo.listReadyQueue().catch(() => null);
  return Promise.all([library, queue, repo.listSchedule().catch(() => null)]);
}

/**
 * Background sync of the Published page (#247). Pure selection and a small bounded
 * queue; the component does the fetching. Final copy is re-synced after 24 hours,
 * analytics after 6, newest rows first, a handful of rows per visit.
 */
export const FINAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ANALYTICS_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const MAX_ROWS_PER_VISIT = 20;
export const SYNC_CONCURRENCY = 3;

export type SyncAction = 'sync-final' | 'analytics';
export type SyncCandidate = {
  contentId: string;
  revision: string;
  /** Typefully Draft ID: nothing to sync without one. */
  draftId: string;
  /** Typefully Status as shown; analytics only exist for Published rows. */
  status: string;
  finalSyncAt: string | null;
  analyticsSyncAt: string | null;
};
export type SyncJob = { contentId: string; revision: string; actions: SyncAction[] };

/** Never synced, unreadable or older than the limit. A time in the future counts as fresh. */
export function isDue(syncedAt: string | null, now: number, maxAgeMs: number): boolean {
  if (!syncedAt || !syncedAt.trim()) return true;
  const ms = Date.parse(syncedAt);
  return Number.isNaN(ms) || now - ms > maxAgeMs;
}

/**
 * Rows are taken in the order given (the page lists newest first). `attempts` maps
 * "contentId:action" to the last automatic try, so an unchanged sync that writes
 * no new time is not repeated on every visit.
 */
export function selectSyncJobs(
  rows: readonly SyncCandidate[],
  now: number,
  attempts: Readonly<Record<string, number>> = {},
  limits: { maxRows?: number; finalMaxAgeMs?: number; analyticsMaxAgeMs?: number } = {},
): SyncJob[] {
  const { maxRows = MAX_ROWS_PER_VISIT, finalMaxAgeMs = FINAL_MAX_AGE_MS, analyticsMaxAgeMs = ANALYTICS_MAX_AGE_MS } = limits;
  const jobs: SyncJob[] = [];
  for (const row of rows) {
    if (jobs.length >= maxRows) break;
    if (!row.draftId.trim()) continue;
    const actions: SyncAction[] = [];
    const tried = (action: SyncAction, maxAge: number) => now - (attempts[`${row.contentId}:${action}`] ?? 0) < maxAge;
    if (isDue(row.finalSyncAt, now, finalMaxAgeMs) && !tried('sync-final', finalMaxAgeMs)) actions.push('sync-final');
    if (row.status === 'Published' && isDue(row.analyticsSyncAt, now, analyticsMaxAgeMs) && !tried('analytics', analyticsMaxAgeMs)) actions.push('analytics');
    if (actions.length) jobs.push({ contentId: row.contentId, revision: row.revision, actions });
  }
  return jobs;
}

export type SyncCall = (contentId: string, action: SyncAction, revision: string) => Promise<{ ok: true; revision: string } | { ok: false; code: string }>;

/** Runs the jobs with at most `concurrency` rows in flight; one row's actions run in order on its newest revision. */
export async function runSyncJobs(
  jobs: readonly SyncJob[],
  call: SyncCall,
  opts: { concurrency?: number; onRow?: (finished: number, total: number) => void; onAttempt?: (contentId: string, action: SyncAction) => void } = {},
): Promise<{ rows: number; failedRows: number }> {
  const { concurrency = SYNC_CONCURRENCY, onRow, onAttempt } = opts;
  let next = 0;
  let finished = 0;
  let failedRows = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      let revision = job.revision;
      let failed = false;
      for (const action of job.actions) {
        onAttempt?.(job.contentId, action);
        let res: Awaited<ReturnType<SyncCall>>;
        try { res = await call(job.contentId, action, revision); } catch { res = { ok: false, code: 'UNKNOWN' }; }
        if (res.ok) { revision = res.revision; continue; }
        failed = true;
        if (res.code === 'STALE_READ' || res.code === 'AUTH_REQUIRED' || res.code === 'FORBIDDEN') break;
      }
      if (failed) failedRows++;
      finished++;
      onRow?.(finished, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return { rows: jobs.length, failedRows };
}

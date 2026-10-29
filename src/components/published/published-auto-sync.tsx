'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { runSyncJobs, selectSyncJobs, type SyncAction, type SyncCall, type SyncCandidate } from '@/domain/published-sync';
import { newOperationId, postJson } from '@/lib/client/api';

/**
 * Quiet background sync when Published opens (#247). Rows come in page order
 * (newest first). Only stale rows are synced, three at a time, through the same
 * guarded owner endpoints as the manual buttons (same-origin session, a fresh
 * idempotency key and the row revision per call). It never blocks the page; the
 * rows refresh once when it is done, and any failure is one quiet line.
 */
const ATTEMPTS_KEY = 'cs:published-autosync';

type Attempts = Record<string, number>;

function readAttempts(): Attempts {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ATTEMPTS_KEY) ?? '{}') as Attempts;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeAttempts(attempts: Attempts) {
  try { window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts)); } catch { /* optional */ }
}

export const syncCall: SyncCall = async (contentId, action: SyncAction, revision) => {
  const res = await postJson<{ ok: true; revision: string } | { ok: false; code: string }>(
    `/api/schedule/${encodeURIComponent(contentId)}/typefully/${action}`,
    { operationId: newOperationId(action === 'analytics' ? 'tfa' : 'tfs'), expectedRevision: revision },
  );
  const body = res.body as { ok: boolean; revision?: string; code?: string };
  return body.ok && body.revision ? { ok: true, revision: body.revision } : { ok: false, code: res.status === 401 ? 'AUTH_REQUIRED' : (body.code ?? 'UNKNOWN') };
};

export function PublishedAutoSync({ rows }: { rows: SyncCandidate[] }) {
  const router = useRouter();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const now = Date.now();
    const attempts = readAttempts();
    const jobs = selectSyncJobs(rows, now, attempts);
    if (jobs.length === 0) return;
    // Deferred so the first paint is never delayed.
    setTimeout(() => {
      setProgress({ done: 0, total: jobs.length });
      void runSyncJobs(jobs, syncCall, {
        onAttempt: (contentId, action) => { attempts[`${contentId}:${action}`] = Date.now(); writeAttempts(attempts); },
        onRow: (done, total) => setProgress({ done, total }),
      }).then(({ failedRows }) => {
        setProgress(null);
        setFailed(failedRows > 0);
        router.refresh();
      });
    }, 0);
    // Once per visit: the rows prop changes after the refresh and must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div aria-live="polite" className="text-xs text-ink-soft empty:hidden">
      {progress ? <p role="status">Syncing {Math.min(progress.done + 1, progress.total)} of {progress.total}…</p> : null}
      {!progress && failed ? <p>Some rows could not sync. Use Sync on the card.</p> : null}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { approvalBlockers } from '@/domain/approval';
import type { Gate } from '@/domain/gates';
import { newOperationId, postJson } from '@/lib/client/api';
import type { ReviewCard } from '@/domain/views';
import { buttonClass } from '../button-styles';
import { InlineResult } from '../inline-result';

/**
 * Approve / request changes next to the editor (CS-049). The editor page used to
 * say "Review and approve" with no way to do it there; this uses the same guarded
 * transition API as the post panel and review cards, with the editor's current
 * Sheet revision, so a post that changed underneath is refused rather than
 * overwritten. Approval waits for unsaved edits to be saved first, because the
 * approval stamp covers the saved copy, not the text in the box.
 */
type Action = 'approve' | 'approve_and_queue' | 'request_changes';
type Outcome = { ok: true; card: ReviewCard } | { ok: false; code: string; message?: string; blockers?: Gate[] };

const DONE: Record<Action, string> = {
  approve: 'Approved. The Sheet now holds this approval.',
  approve_and_queue: 'Approved and queued for scheduling.',
  request_changes: 'Changes requested.',
};

export function ReviewActions({ libraryId, reviewStatus, blockers, sheetRevision, dirty, onDone }: {
  libraryId: string;
  reviewStatus: string;
  blockers: readonly Gate[];
  /** The revision the editor last loaded or saved; the server refuses a stale one. */
  sheetRevision: string;
  dirty: boolean;
  /** Called after any successful transition so the caller can reload its model. */
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [result, setResult] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const blocking = approvalBlockers(blockers);
  const approved = reviewStatus === 'Approved';

  async function run(action: Action) {
    setBusy(action);
    setResult(null);
    const res = await postJson<Outcome>('/api/review/transition', { operationId: newOperationId('review'), libraryId, expectedRevision: sheetRevision, action });
    setBusy(null);
    const body = res.body as Outcome;
    if (body.ok) {
      setResult({ tone: 'success', text: DONE[action] });
      onDone();
      return;
    }
    const why = body.blockers?.map((b) => b.message).join(' ');
    setResult({
      tone: body.code === 'STALE_READ' ? 'warning' : 'error',
      text: body.code === 'STALE_READ' ? 'This post changed in the Sheet. Reload it, check the latest version and try again.' : why || body.message || 'Not done. Nothing was written.',
    });
  }

  return (
    <section aria-labelledby={`review-actions-${libraryId}`} className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3">
      <h3 id={`review-actions-${libraryId}`} className="text-sm font-semibold">
        Review
      </h3>
      {approved ? (
        <p className="text-sm">
          <span aria-hidden="true" className="font-semibold text-green">✓ </span>Approved.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass('approve', 'sm')} disabled={busy !== null || dirty || blocking.length > 0} onClick={() => void run('approve_and_queue')}>
            {busy === 'approve_and_queue' ? 'Approving…' : 'Approve and queue'}
          </button>
          <button type="button" className={buttonClass('secondary', 'sm')} disabled={busy !== null || dirty || blocking.length > 0} onClick={() => void run('approve')}>
            {busy === 'approve' ? 'Approving…' : 'Approve only'}
          </button>
          <button type="button" className={buttonClass('secondary', 'sm')} disabled={busy !== null || dirty} onClick={() => void run('request_changes')}>
            {busy === 'request_changes' ? 'Saving…' : 'Request changes'}
          </button>
        </div>
      )}
      {!approved && dirty ? <p className="text-xs text-ink-soft">Save the draft first; approval covers the saved copy.</p> : null}
      {!approved && !dirty && blocking.length > 0 ? (
        <p className="text-xs text-ink-soft">Approval opens once these are fixed: {blocking.map((b) => b.message).join(' ')}</p>
      ) : null}
      {result ? <InlineResult tone={result.tone}>{result.text}</InlineResult> : null}
    </section>
  );
}

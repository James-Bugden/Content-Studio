'use client';

import { useState } from 'react';
import type { Gate } from '@/domain/gates';
import type { ReviewCard as Card } from '@/domain/views';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { ConflictDialog } from '../conflict-dialog';
import { GuardedLink } from '../guarded-link';
import { InlineResult } from '../inline-result';
import { GateChip, NextAction, StatusBadge } from '../status';

/**
 * One review card (CS-007). Shows the single next action and every blocker in
 * words, and offers explicit per-item transitions only: there is no bulk approve.
 * Buttons are a convenience; the server re-runs every gate and refuses anything
 * the UI might have shown by mistake (REV-04). A stale row opens a comparison
 * instead of overwriting (REV-06).
 */
type Action = 'approve' | 'approve_and_queue' | 'queue' | 'unqueue' | 'skip' | 'request_changes' | 'reopen';

type Outcome =
  | { ok: true; card: Card; replayed: boolean }
  | { ok: false; code: string; message?: string; blockers?: Gate[]; current?: Card };

const DONE: Record<Action, string> = {
  approve: 'Approved. The Sheet now holds this approval.',
  approve_and_queue: 'Approved and queued for scheduling.',
  queue: 'Queued for scheduling.',
  unqueue: 'Removed from the scheduling queue.',
  skip: 'Skipped.',
  request_changes: 'Changes requested.',
  reopen: 'Reopened for review.',
};

const APPROVAL_BLOCKING = new Set([
  'UNRECOGNISED_VALUE',
  'MISSING_IDENTITY',
  'COPYRIGHT_REWORK',
  'COPYRIGHT_UNCHECKED',
  'DUPLICATE_CHECK',
  'DUPLICATE_CONFIRMED',
  'DUPLICATE_UNCHECKED',
  'MISSING_COPY',
  'MISSING_SOURCE_LINK',
  'MARKDOWN_MISMATCH',
  'HOOK_MISSING',
  'REVIEW_SKIPPED',
  'VISUAL_UNDECIDED',
  'VISUAL_INVALID',
  'SCREENSHOT_REUSED',
  'SCREENSHOT_UNCERTAIN',
]);

/** Show the Sheet's own words, not the canonical enum names. */
const REVIEW_LABEL: Record<string, string> = { Pending: 'Not reviewed' };
const COPYRIGHT_LABEL: Record<string, string> = { PASS: 'Cleared', Unchecked: 'Not checked' };
const DUPLICATE_LABEL: Record<string, string> = { PASS: 'No flag', Unchecked: 'Not checked' };

export function ReviewCard({ initial, canEdit }: { initial: Card; canEdit: boolean }) {
  const [card, setCard] = useState(initial);
  const [busy, setBusy] = useState<Action | null>(null);
  const [result, setResult] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [pendingOp, setPendingOp] = useState<{ action: Action; id: string } | null>(null);
  const [conflict, setConflict] = useState<{ seen: Card; current: Card } | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const approvalBlockers = card.gates.blockers.filter((g) => APPROVAL_BLOCKING.has(g.code));
  const status = card.reviewStatus;
  const approved = status === 'Approved';
  const stale = card.gates.blockers.some((g) => g.code === 'APPROVAL_STALE');

  async function run(action: Action) {
    // Reuse the operation id when retrying the same action after a failure.
    const opId = pendingOp && pendingOp.action === action ? pendingOp.id : newOperationId('review');
    setPendingOp({ action, id: opId });
    setBusy(action);
    setResult(null);
    const res = await postJson<Outcome>('/api/review/transition', {
      operationId: opId,
      libraryId: card.libraryId,
      expectedRevision: card.revision,
      action,
      ...(action === 'request_changes' && note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(null);
    const body = res.body as Outcome;
    if (body.ok) {
      setPendingOp(null);
      setCard(body.card);
      setNoteOpen(false);
      setNote('');
      setResult({ tone: 'success', text: body.replayed ? `${DONE[action]} (It had already been saved.)` : DONE[action] });
      return;
    }
    if (body.code === 'STALE_READ' && body.current) {
      setPendingOp(null);
      setConflict({ seen: card, current: body.current });
      setResult({ tone: 'warning', text: 'This item changed in the Sheet after you loaded it. Nothing was written.' });
      return;
    }
    if (body.code === 'GATE_BLOCKED') {
      setPendingOp(null);
      if (body.current) setCard(body.current);
      const names = (body.blockers ?? []).map((b) => b.message).join(' ');
      setResult({ tone: 'warning', text: `Not done: ${names || 'a release gate is not met.'}` });
      return;
    }
    setResult({ tone: 'error', text: body.message ?? 'That did not complete. Nothing is confirmed as written; try again.' });
  }

  const extraBlockers = card.gates.blockers.slice(1);

  return (
    <article aria-labelledby={`card-${card.libraryId}`} className="rounded-lg border border-line bg-card p-4 shadow-[0_1px_0_rgba(23,32,35,0.04)]">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`card-${card.libraryId}`} className="text-base font-semibold">
            <GuardedLink href={`/review/${encodeURIComponent(card.libraryId)}`} className="underline decoration-line underline-offset-4 hover:decoration-ink">
              {card.slug || card.libraryId}
            </GuardedLink>
          </h3>
          <p className="mt-0.5 text-xs text-ink-soft">
            <span className="font-mono">{card.libraryId}</span> · {card.targetPlatform}
            {card.sourcePlatform && card.sourcePlatform !== card.targetPlatform ? ` from ${card.sourcePlatform}` : ''} · {card.source}
          </p>
        </div>
        <StatusBadge status={card.gates.status} />
      </header>

      {card.hook ? <p className="copy mt-3 font-semibold">{card.hook}</p> : <p className="mt-3 text-sm text-ink-soft">No hook yet.</p>}
      {card.preview ? <p className="copy mt-2 line-clamp-5 text-sm text-ink-soft">{card.preview}</p> : null}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
        <Fact label="Review" value={REVIEW_LABEL[card.reviewStatus] ?? card.reviewStatus} />
        <Fact label="Copyright" value={COPYRIGHT_LABEL[card.copyrightQa] ?? card.copyrightQa} />
        <Fact label="Duplicate" value={DUPLICATE_LABEL[card.duplicateQa] ?? card.duplicateQa} />
        <Fact label="Queue" value={card.queued === true ? 'Queued' : card.queued === false ? 'Not queued' : 'Unreadable'} />
        <Fact label="Visual" value={card.visual} />
      </dl>

      <div className="mt-3">
        <NextAction gate={card.gates.next} />
      </div>
      {extraBlockers.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-ink-soft">
            {extraBlockers.length} more {extraBlockers.length === 1 ? 'blocker' : 'blockers'}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {extraBlockers.map((g, i) => (
              <li key={`${g.code}-${i}`}>
                <GateChip gate={g} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {card.gates.warnings.map((g, i) => (
        <div key={`w-${g.code}-${i}`} className="mt-2">
          <GateChip gate={g} />
        </div>
      ))}

      {result ? (
        <div className="mt-3">
          <InlineResult tone={result.tone}>{result.text}</InlineResult>
        </div>
      ) : null}

      {canEdit ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {!approved || stale ? (
            <>
              <button type="button" className={buttonClass('primary')} disabled={busy !== null || approvalBlockers.length > 0} onClick={() => run('approve_and_queue')}>
                {busy === 'approve_and_queue' ? 'Approving…' : 'Approve and queue'}
              </button>
              <button type="button" className={buttonClass()} disabled={busy !== null || approvalBlockers.length > 0} onClick={() => run('approve')}>
                {busy === 'approve' ? 'Approving…' : 'Approve only'}
              </button>
            </>
          ) : card.queued ? (
            <button type="button" className={buttonClass()} disabled={busy !== null} onClick={() => run('unqueue')}>
              Remove from queue
            </button>
          ) : (
            <button type="button" className={buttonClass('primary')} disabled={busy !== null} onClick={() => run('queue')}>
              Queue for scheduling
            </button>
          )}
          {status === 'Skipped' || status === 'Changes Requested' ? (
            <button type="button" className={buttonClass()} disabled={busy !== null} onClick={() => run('reopen')}>
              Reopen for review
            </button>
          ) : (
            <>
              <button type="button" className={buttonClass()} disabled={busy !== null} onClick={() => setNoteOpen((v) => !v)} aria-expanded={noteOpen}>
                Request changes
              </button>
              <button type="button" className={buttonClass()} disabled={busy !== null} onClick={() => run('skip')}>
                Skip
              </button>
            </>
          )}
          <GuardedLink href={`/review/${encodeURIComponent(card.libraryId)}`} className={buttonClass()}>
            Open editor
          </GuardedLink>
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink-soft">Read-only access: review actions are hidden.</p>
      )}

      {canEdit && approvalBlockers.length > 0 && (!approved || stale) ? (
        <p className="mt-2 text-xs text-ink-soft">Approval is unavailable until: {approvalBlockers.map((g) => g.nextAction.toLowerCase()).join('; ')}.</p>
      ) : null}

      {noteOpen ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run('request_changes');
          }}
        >
          <label htmlFor={`note-${card.libraryId}`} className="text-sm font-medium">
            What should change? (optional, saved to Next Action)
          </label>
          <input
            id={`note-${card.libraryId}`}
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-11 rounded-md border border-line bg-card px-3 text-sm"
          />
          <div>
            <button type="submit" className={buttonClass('danger')} disabled={busy !== null}>
              {busy === 'request_changes' ? 'Saving…' : 'Request changes'}
            </button>
          </div>
        </form>
      ) : null}

      {conflict ? (
        <ConflictDialog
          open
          onClose={() => setConflict(null)}
          title="This item changed after you opened it"
          description="Nothing was written. Compare what you saw with what the Sheet holds now, then review the latest version."
          current={`${conflict.current.hook}\n\n${conflict.current.preview}`}
          proposed={`${conflict.seen.hook}\n\n${conflict.seen.preview}`}
          actions={[
            {
              label: 'Review the latest version',
              variant: 'primary',
              onSelect: () => {
                setCard(conflict.current);
                setConflict(null);
              },
            },
          ]}
        />
      ) : null}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}

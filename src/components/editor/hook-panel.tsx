'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ErrorCode } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import type { HookAlternative, HookScores } from '@/domain/hook-frameworks';
import type { StepResult } from '@/domain/mutation';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { InlineResult } from '../inline-result';
import { RecoveryPanel } from '../recovery-panel';
import { StateView } from '../state-view';
import { AiErrorView, asErrorCode } from './ai-error';

/**
 * Hook review panel (CS-010 HOOK-01..05).
 *
 * The current hook is always kept and always selectable. Generation proposes
 * exactly three alternatives and writes nothing. Choosing is explicit and bound to
 * the draft the alternatives were generated for and to the revisions the editor
 * holds; a partial saga shows its steps and retries with the same operation id.
 */
export const SCORE_LABELS: { key: keyof HookScores; label: string }[] = [
  { key: 'specificity', label: 'Specificity' },
  { key: 'tension', label: 'Tension and curiosity' },
  { key: 'audienceFit', label: 'Audience and platform fit' },
  { key: 'credibility', label: 'Credibility and evidence' },
  { key: 'valuePromise', label: 'Value promise' },
];

export const STALE_HOOK_MESSAGE = 'The draft changed; generate again.';

type Proposal = { id: string; draftHash: string; currentHook: string; platform: string; alternatives: HookAlternative[] };
type GenResponse = { ok: true; proposal: Proposal } | { ok: false; code: string };
type SelectResponse =
  | { ok: true; replayed: boolean; steps: StepResult[] }
  | { ok: false; code: string; message?: string; steps?: StepResult[]; details?: { reason?: string } };

type Gen = { kind: 'idle' } | { kind: 'loading' } | { kind: 'cancelled' } | { kind: 'error'; code: ErrorCode } | { kind: 'done' };
type Sel =
  | { kind: 'idle' }
  | { kind: 'saving'; choice: 'current' | number }
  | { kind: 'done'; choice: 'current' | 'alternative' }
  | { kind: 'stale' }
  | { kind: 'partial'; steps: StepResult[]; operationId: string; choice: 'current' | number }
  | { kind: 'error'; message: string };

export type HookPanelProps = {
  libraryId: string;
  platform: string;
  currentHook: string;
  text: string;
  dirty: boolean;
  markdownOk: boolean;
  sheetRevision: string;
  sectionHash: string;
  canEdit: boolean;
  /** Called after a successful choice so the editor reloads the hook and the draft together. */
  onChanged: () => Promise<void> | void;
};

export function HookPanel(props: HookPanelProps) {
  const { libraryId, platform, currentHook, text, dirty, markdownOk, sheetRevision, sectionHash, canEdit, onChanged } = props;
  const headingId = useId();
  const groupName = useId();
  const [gen, setGen] = useState<Gen>({ kind: 'idle' });
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [picked, setPicked] = useState<'current' | number>('current');
  const [sel, setSel] = useState<Sel>({ kind: 'idle' });
  const controller = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const opRef = useRef<{ key: string; id: string } | null>(null);
  const currentHash = useMemo(() => fingerprint(text), [text]);
  const stale = proposal !== null && proposal.draftHash !== currentHash;

  useEffect(() => () => controller.current?.abort(), []);

  async function generate() {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const mine = ++seq.current;
    setGen({ kind: 'loading' });
    setSel({ kind: 'idle' });
    try {
      const res = await postJson<GenResponse>(`/api/library/${encodeURIComponent(libraryId)}/hooks`, { draft: text, draftHash: fingerprint(text) }, ctrl.signal);
      if (mine !== seq.current) return;
      const body = res.body as GenResponse;
      if (!body.ok) {
        setGen({ kind: 'error', code: res.status === 401 ? 'AUTH_REQUIRED' : asErrorCode(body.code) });
        return;
      }
      setProposal(body.proposal);
      setPicked('current');
      opRef.current = null;
      setGen({ kind: 'done' });
    } catch {
      if (mine === seq.current) setGen({ kind: 'cancelled' });
    }
  }

  function cancel() {
    seq.current += 1;
    controller.current?.abort();
    setGen({ kind: 'cancelled' });
  }

  async function choose(choice: 'current' | number) {
    if (!proposal || stale) {
      setSel({ kind: 'stale' });
      return;
    }
    const key = `${proposal.id}:${choice}`;
    const op = opRef.current && opRef.current.key === key ? opRef.current : { key, id: newOperationId('hook') };
    opRef.current = op;
    setSel({ kind: 'saving', choice });
    const res = await postJson<SelectResponse>(`/api/library/${encodeURIComponent(libraryId)}/hooks/select`, {
      operationId: op.id,
      expectedSheetRevision: sheetRevision,
      expectedSectionHash: sectionHash,
      generationDraftHash: proposal.draftHash,
      choice: choice === 'current' ? { kind: 'current' } : { kind: 'alternative', index: choice, alternative: proposal.alternatives[choice] },
      alternatives: proposal.alternatives,
    });
    const body = res.body as SelectResponse;
    if (body.ok) {
      opRef.current = null;
      setProposal(null);
      setPicked('current');
      setSel({ kind: 'done', choice: choice === 'current' ? 'current' : 'alternative' });
      await onChanged();
      return;
    }
    if (body.code === 'PARTIAL_FAILURE' && body.steps) {
      setSel({ kind: 'partial', steps: body.steps, operationId: op.id, choice });
      return;
    }
    opRef.current = null;
    if (body.code === 'STALE_READ') {
      setSel({ kind: 'stale' });
      return;
    }
    if (body.code === 'CONFLICT') {
      setSel({
        kind: 'error',
        message:
          body.details?.reason === 'opening_mismatch'
            ? 'The draft no longer opens with the current hook, so the opening cannot be swapped safely. Edit the opening by hand, save, then generate again.'
            : 'The Sheet and the Markdown disagree, so nothing was written. Reconcile the draft first, then generate again.',
      });
      return;
    }
    setSel({ kind: 'error', message: res.status === 401 ? 'You were signed out. Nothing was written. Sign in again, then choose.' : (body.message ?? 'The choice was not saved. Nothing is confirmed as written.') });
  }

  const blockedReason = !markdownOk
    ? 'Choosing a hook is off because the master Markdown section could not be loaded.'
    : dirty
      ? 'Save or undo your draft changes first: choosing a hook rewrites the opening and saves the draft through the same checked save.'
      : null;
  const busy = sel.kind === 'saving';

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          Hook review
        </h2>
        {canEdit ? (
          gen.kind === 'loading' ? (
            <button type="button" className={buttonClass()} onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button type="button" className={buttonClass()} onClick={() => void generate()} disabled={text.trim() === '' || busy}>
              {proposal ? 'Suggest three new hooks' : 'Suggest three hooks'}
            </button>
          )
        ) : null}
      </div>
      <p className="text-sm text-ink-soft">
        Your current hook stays unless you choose another. Each suggestion names its framework and scores five things out of 2.
        {platform === 'LinkedIn' ? ' LinkedIn suggestions also check audience, role or keyword, and direct relevance.' : ''}
      </p>
      {!canEdit ? <p className="text-sm text-ink-soft">Read-only access: only the owner can generate or choose hooks.</p> : null}

      {gen.kind === 'loading' ? <StateView kind="loading" title="Writing three hook options" detail="Nothing is written while this runs." nextStep={null} /> : null}
      {gen.kind === 'cancelled' ? <InlineResult tone="info">Cancelled. Nothing was changed.</InlineResult> : null}
      {gen.kind === 'error' ? <AiErrorView code={gen.code} what="Hook suggestions" onRetry={canEdit ? () => void generate() : undefined} /> : null}

      {sel.kind === 'done' ? (
        <InlineResult tone="success">
          {sel.choice === 'alternative'
            ? 'Hook updated: the Sheet hook fields and the opening of the draft were saved together.'
            : 'Kept the current hook. The three suggestions were recorded as alternatives in the Sheet.'}
        </InlineResult>
      ) : null}
      {sel.kind === 'stale' || (proposal && stale) ? (
        <div role="status" className="rounded-md border-2 border-block bg-block-soft p-3 text-sm">
          <p className="font-semibold">{STALE_HOOK_MESSAGE}</p>
          <p className="mt-1">These suggestions were made for an earlier version of the draft, so they cannot be used. Nothing was written.</p>
        </div>
      ) : null}
      {sel.kind === 'error' ? <InlineResult tone="error">{sel.message}</InlineResult> : null}
      {sel.kind === 'partial' ? (
        <RecoveryPanel operationId={sel.operationId} steps={sel.steps.map((s) => ({ step: s.step, status: s.status, provider: s.provider }))} onRetry={() => void choose(sel.choice)} />
      ) : null}

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="sr-only">Choose a hook</legend>
        <label className={`flex min-w-0 gap-3 rounded-md border p-3 text-sm ${picked === 'current' && proposal ? 'border-2 border-ink' : 'border-line'}`} data-hook-card="current">
          {proposal ? (
            <input type="radio" name={groupName} className="mt-1 size-4 shrink-0" checked={picked === 'current'} onChange={() => setPicked('current')} disabled={!canEdit || busy} />
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-ink-soft">Current hook (kept unless you choose another)</span>
            <span className="copy mt-1 block">{currentHook || 'No hook yet'}</span>
          </span>
        </label>
        {proposal
          ? proposal.alternatives.map((a, i) => (
              <label
                key={`${proposal.id}-${i}`}
                className={`flex min-w-0 gap-3 rounded-md border p-3 text-sm ${picked === i ? 'border-2 border-ink' : 'border-line'}`}
                data-hook-card={i}
                data-total={a.total}
              >
                <input type="radio" name={groupName} className="mt-1 size-4 shrink-0" checked={picked === i} onChange={() => setPicked(i)} disabled={!canEdit || busy || stale} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-ink-soft">
                    Option {i + 1} · {a.template} · Framework: {a.framework} · Hook type: {a.hookType}
                  </span>
                  <span className="copy mt-1 block text-base">{a.text}</span>
                  <span className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-xs">
                    {SCORE_LABELS.map((s) => (
                      <span key={s.key} className="contents" data-score={s.key}>
                        <span>{s.label}</span>
                        <span className="text-right font-mono" data-value={a.scores[s.key]}>
                          {a.scores[s.key]} of 2
                        </span>
                      </span>
                    ))}
                    <span className="font-semibold">Total</span>
                    <span className="text-right font-mono font-semibold" data-role="total">
                      {a.total} of 10
                    </span>
                  </span>
                  {a.linkedinChecks ? (
                    <span className="mt-2 block text-xs" data-role="linkedin-checks">
                      <span className="font-semibold">LinkedIn check: </span>
                      Audience: {a.linkedinChecks.audience ? 'yes' : 'no'} · Role or keyword: {a.linkedinChecks.roleOrKeyword ? 'yes' : 'no'} · Direct relevance:{' '}
                      {a.linkedinChecks.directRelevance ? 'yes' : 'no'}
                      {a.linkedinChecks.notes ? <span className="block text-ink-soft">{a.linkedinChecks.notes}</span> : null}
                    </span>
                  ) : null}
                </span>
              </label>
            ))
          : null}
      </fieldset>

      {proposal && canEdit ? (
        <div className="flex flex-col gap-2">
          {blockedReason ? <p className="text-sm text-block">{blockedReason}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass('primary')} disabled={picked === 'current' || !!blockedReason || busy || stale} onClick={() => void choose(picked)}>
              {sel.kind === 'saving' && sel.choice !== 'current' ? 'Saving…' : 'Use this hook'}
            </button>
            <button type="button" className={buttonClass()} disabled={!!blockedReason || busy || stale} onClick={() => void choose('current')}>
              {sel.kind === 'saving' && sel.choice === 'current' ? 'Saving…' : 'Keep current hook'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

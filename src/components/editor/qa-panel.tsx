'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ErrorCode } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import { applyFinding, QA_CATEGORIES, type QaCategory, type QaFinding, type QaProposal, type QaSeverity } from '@/domain/proposals';
import { postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { InlineResult } from '../inline-result';
import { StateView } from '../state-view';
import { AiErrorView, asErrorCode } from './ai-error';

/**
 * English QA panel (CS-009 ENQA-01..03, AI-01).
 *
 * Findings are proposals bound to the fingerprint of the exact text that was
 * checked. Accepting one applies only its range to the editor text (not saved:
 * the normal Save flow persists it). Any other change to the text makes the
 * proposal stale, and a stale proposal cannot apply.
 */
export const CATEGORY_LABEL: Record<QaCategory, string> = {
  spelling: 'Spelling',
  grammar: 'Grammar',
  punctuation: 'Punctuation',
  banned_word: 'Banned words',
  clarity: 'Clarity',
  voice: 'Voice',
  factual_consistency: 'Factual consistency',
  platform_fit: 'Platform fit',
};

export const SEVERITY_LABEL: Record<QaSeverity, string> = { must: 'Must fix', should: 'Should fix', consider: 'Consider' };

export const STALE_QA_MESSAGE = 'The draft changed since this check; run it again.';

type QaResponse = { ok: true; proposal: QaProposal } | { ok: false; code: string; message?: string };

type Run = { kind: 'idle' } | { kind: 'loading' } | { kind: 'cancelled' } | { kind: 'error'; code: ErrorCode } | { kind: 'done' };

export function QaPanel({ libraryId, text, canEdit, onApply }: { libraryId: string; text: string; canEdit: boolean; onApply: (next: string) => void }) {
  const headingId = useId();
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const [proposal, setProposal] = useState<QaProposal | null>(null);
  const [summary, setSummary] = useState('');
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const currentHash = useMemo(() => fingerprint(text), [text]);
  const stale = proposal !== null && proposal.draftHash !== currentHash;

  useEffect(() => () => controller.current?.abort(), []);

  async function check() {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const mine = ++seq.current;
    setRun({ kind: 'loading' });
    setNotice(null);
    try {
      const res = await postJson<QaResponse>(`/api/library/${encodeURIComponent(libraryId)}/qa`, { draft: text, draftHash: fingerprint(text) }, ctrl.signal);
      if (mine !== seq.current) return;
      const body = res.body as QaResponse;
      if (!body.ok) {
        setRun({ kind: 'error', code: res.status === 401 ? 'AUTH_REQUIRED' : asErrorCode(body.code) });
        return;
      }
      setProposal({ id: body.proposal.id, draftHash: body.proposal.draftHash, findings: body.proposal.findings, summary: body.proposal.summary });
      setSummary(body.proposal.summary);
      setDismissed(new Set());
      setRun({ kind: 'done' });
    } catch {
      if (mine === seq.current) setRun({ kind: 'cancelled' });
    }
  }

  function cancel() {
    seq.current += 1;
    controller.current?.abort();
    setRun({ kind: 'cancelled' });
  }

  function accept(f: QaFinding) {
    if (!proposal) return;
    const result = applyFinding(text, currentHash, proposal, f.id);
    if (!result.ok) {
      setNotice({
        tone: 'warning',
        text:
          result.code === 'STALE_READ'
            ? STALE_QA_MESSAGE
            : result.reason === 'no_replacement'
              ? 'This finding has no automatic fix. Change the wording in the draft yourself.'
              : 'That finding is no longer available. Run the check again.',
      });
      return;
    }
    onApply(result.draft);
    setProposal(result.proposal);
    setNotice({ tone: 'success', text: 'Change applied to the draft. It is not saved yet: use Save draft to keep it.' });
  }

  function dismiss(f: QaFinding) {
    setDismissed((prev) => new Set(prev).add(f.id));
  }

  const visible = proposal ? proposal.findings.filter((f) => !dismissed.has(f.id)) : [];
  const groups = QA_CATEGORIES.map((c) => ({ category: c, items: visible.filter((f) => f.category === c) })).filter((g) => g.items.length > 0);
  const dismissedCount = proposal ? proposal.findings.filter((f) => dismissed.has(f.id)).length : 0;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          English check
        </h2>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {run.kind === 'loading' ? (
              <button type="button" className={buttonClass()} onClick={cancel}>
                Cancel check
              </button>
            ) : (
              <button type="button" className={buttonClass()} onClick={() => void check()} disabled={text.trim() === ''}>
                {proposal ? 'Check English again' : 'Check English'}
              </button>
            )}
          </div>
        ) : null}
      </div>
      <p className="text-sm text-ink-soft">
        Checks spelling, grammar, punctuation, banned words, clarity, British English, voice, facts and platform fit. Findings are suggestions only: nothing changes unless you accept
        one.
      </p>
      {!canEdit ? <p className="text-sm text-ink-soft">Read-only access: only the owner can run checks.</p> : null}

      {run.kind === 'loading' ? <StateView kind="loading" title="Checking the English" detail="Your draft stays editable while this runs." nextStep={null} /> : null}
      {run.kind === 'cancelled' ? <InlineResult tone="info">Check cancelled. Nothing was changed.</InlineResult> : null}
      {run.kind === 'error' ? <AiErrorView code={run.code} what="The English check" onRetry={canEdit ? () => void check() : undefined} /> : null}

      {proposal && stale ? (
        <div role="status" className="rounded-md border-2 border-warn bg-warn-soft p-3 text-sm">
          <p className="font-semibold">Out of date: {STALE_QA_MESSAGE}</p>
          <p className="mt-1">These findings were made for an earlier version of the text, so they cannot be applied.</p>
        </div>
      ) : null}
      {notice ? <InlineResult tone={notice.tone}>{notice.text}</InlineResult> : null}

      {proposal && run.kind !== 'loading' ? (
        <div className="flex flex-col gap-3" data-testid="qa-results">
          {summary ? <p className="text-sm">{summary}</p> : null}
          {visible.length === 0 ? (
            <p className="text-sm">{proposal.findings.length === 0 && dismissedCount === 0 ? 'No findings left for this version of the draft.' : 'No findings left to review.'}</p>
          ) : null}
          {groups.map((g) => (
            <div key={g.category}>
              <h3 className="text-sm font-semibold">
                {CATEGORY_LABEL[g.category]} <span className="font-normal text-ink-soft">({g.items.length})</span>
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {g.items.map((f) => (
                  <li key={f.id} className="rounded-md border border-line p-3 text-sm" data-finding={f.id} aria-label={`Finding: ${CATEGORY_LABEL[f.category]}, ${SEVERITY_LABEL[f.severity]}`}>
                    <p>
                      <span className={`mr-2 inline-block rounded-sm border px-1.5 text-xs font-semibold ${f.severity === 'must' ? 'border-block text-block' : 'border-line text-ink'}`}>
                        {SEVERITY_LABEL[f.severity]}
                      </span>
                      {f.explanation}
                    </p>
                    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                      <dt className="text-ink-soft">Current</dt>
                      <dd>
                        <span className="copy rounded-sm bg-paper px-1 font-mono [overflow-wrap:anywhere]" data-role="original">
                          {f.original}
                        </span>
                      </dd>
                      <dt className="text-ink-soft">Proposed</dt>
                      <dd>
                        {f.replacement === null ? (
                          <span className="text-ink-soft">No automatic fix: needs your wording</span>
                        ) : f.replacement === '' ? (
                          <span className="text-ink-soft">Remove it</span>
                        ) : (
                          <mark className="copy rounded-sm bg-focal px-1 font-mono text-ink [overflow-wrap:anywhere]" data-role="replacement">
                            {f.replacement}
                          </mark>
                        )}
                      </dd>
                    </dl>
                    {canEdit ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {f.replacement !== null ? (
                          <button type="button" className={buttonClass()} onClick={() => accept(f)}>
                            Accept
                          </button>
                        ) : null}
                        <button type="button" className={buttonClass()} onClick={() => dismiss(f)}>
                          Dismiss
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {dismissedCount > 0 ? (
            <p className="text-xs text-ink-soft">
              {dismissedCount} dismissed for this session.{' '}
              <button type="button" className="underline" onClick={() => setDismissed(new Set())}>
                Show them again
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

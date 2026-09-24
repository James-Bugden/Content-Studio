'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ErrorCode } from '@/domain/errors';
import type { ZhAdaptationState } from '@/domain/gates';
import type { AdaptationView } from '@/domain/views';
import type { ZhAdaptationOutput } from '@/domain/zh-terms';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { AiErrorView, asErrorCode } from '../editor/ai-error';
import { InlineResult } from '../inline-result';
import { StateView } from '../state-view';

/**
 * X to Threads zh-TW adaptation (CS-011 ZHTW-01..05).
 *
 * Generation writes nothing. The adapted copy stays editable until James saves it
 * for Chinese review; saving is bound to the exact X copy it was made from.
 * Approval is a separate explicit step, offered only for a fresh adaptation that
 * is awaiting review. Every state has a visible word, never colour alone.
 */
export const ZH_STATE_LOOK: Record<ZhAdaptationState, { label: string; glyph: string; className: string }> = {
  not_required: { label: 'Not required', glyph: '–', className: 'border-line text-ink-soft' },
  missing: { label: 'Not adapted yet', glyph: '○', className: 'border-line text-ink' },
  draft: { label: 'Draft, not sent for review', glyph: '✎', className: 'border-line text-ink' },
  awaiting_review: { label: 'Awaiting Chinese review', glyph: '→', className: 'border-line text-ink' },
  approved: { label: 'Chinese copy approved', glyph: '✓', className: 'border-green text-green' },
  stale: { label: 'Stale: the X copy changed', glyph: '✕', className: 'border-block text-block border-2' },
  ambiguous: { label: 'Threads row unclear', glyph: '?', className: 'border-block text-block' },
};

const QA_LABELS: { key: 'meaning' | 'naturalness' | 'terminology' | 'lineBreaks' | 'taiwanUsage'; label: string }[] = [
  { key: 'meaning', label: 'Meaning' },
  { key: 'naturalness', label: 'Naturalness' },
  { key: 'terminology', label: 'Terminology' },
  { key: 'lineBreaks', label: 'Line breaks' },
  { key: 'taiwanUsage', label: 'Taiwan usage' },
];

type Proposal = ZhAdaptationOutput & {
  id: string;
  sourceContentId: string;
  sourceHook: string;
  sourceContent: string;
  threadsContentId: string;
  threadsRevision: string;
};
type GenResponse = { ok: true; proposal: Proposal } | { ok: false; code: string };
type WriteResponse = { ok: true; value: { revision: string } } | { ok: false; code: string; message?: string; details?: { reason?: string; state?: string } };

type Gen = { kind: 'idle' } | { kind: 'loading' } | { kind: 'cancelled' } | { kind: 'error'; code: ErrorCode };
type Write = { kind: 'idle' } | { kind: 'saving' } | { kind: 'approving' } | { kind: 'done'; message: string } | { kind: 'error'; message: string };

export function StateBadge({ state }: { state: ZhAdaptationState }) {
  const look = ZH_STATE_LOOK[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-sm font-semibold ${look.className}`} data-zh-state={state}>
      <span aria-hidden="true">{look.glyph}</span>
      {look.label}
    </span>
  );
}

function writeError(body: Extract<WriteResponse, { ok: false }>, status: number): string {
  if (status === 401) return 'You were signed out. Nothing was saved. Sign in again, then retry.';
  if (body.code === 'STALE_READ' && body.details?.reason === 'source_changed') return 'The X copy changed after this adaptation was generated. Nothing was saved. Generate again.';
  if (body.code === 'STALE_READ') return 'The Threads row changed after this page loaded. Nothing was saved. Reload the page and try again.';
  if (body.code === 'GATE_BLOCKED') return 'This cannot be done in the current state. Nothing was saved. Check the state and blockers on this page.';
  if (body.code === 'VALIDATION_FAILED' && body.details?.reason === 'simplified_characters') return 'The copy contains Simplified Chinese characters. Use Traditional characters, then save again.';
  if (body.code === 'GATE_BLOCKED' && body.details?.reason === 'threads_row_in_use')
    return 'This Threads row has already been sent to Typefully, scheduled or published, so it is not overwritten. Reconcile it from the schedule detail page instead.';
  if (body.code === 'CONFLICT' && body.details?.reason === 'takeover_needs_confirmation')
    return 'This Threads row already holds copy that is not linked to this X post. Nothing was saved. Use "Use this row anyway" only if that copy can be replaced.';
  if (body.code === 'VALIDATION_FAILED' && body.details?.reason === 'copy_length') return 'The Chinese hook and content cannot be empty. Nothing was saved.';
  return body.message ?? 'Nothing is confirmed as saved. Try again.';
}

export function AdaptationWorkspace({ initial, canEdit }: { initial: AdaptationView; canEdit: boolean }) {
  const ids = useId();
  const [view, setView] = useState(initial);
  const [gen, setGen] = useState<Gen>({ kind: 'idle' });
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [hook, setHook] = useState('');
  const [content, setContent] = useState('');
  const [takeover, setTakeover] = useState(false);
  const [write, setWrite] = useState<Write>({ kind: 'idle' });
  const controller = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const saveOp = useRef<{ key: string; id: string } | null>(null);
  const approveOp = useRef<{ key: string; id: string } | null>(null);
  const api = `/api/schedule/${encodeURIComponent(view.source.contentId)}/zh`;

  useEffect(() => () => controller.current?.abort(), []);

  const eligible = view.blockers.length === 0;
  const threads = view.threads;
  const canGenerate = canEdit && eligible && threads.kind === 'found';
  const busy = write.kind === 'saving' || write.kind === 'approving';

  async function reload() {
    try {
      const res = await fetch(api, { credentials: 'same-origin', cache: 'no-store' });
      const body = (await res.json()) as { ok: boolean; view?: AdaptationView };
      if (res.ok && body.ok && body.view) setView(body.view);
    } catch {
      // The write result already told the truth; a failed refresh only leaves the page older.
    }
  }

  async function generate() {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const mine = ++seq.current;
    setGen({ kind: 'loading' });
    setWrite({ kind: 'idle' });
    try {
      const res = await postJson<GenResponse>(api, {}, ctrl.signal);
      if (mine !== seq.current) return;
      const body = res.body as GenResponse;
      if (!body.ok) {
        setGen({ kind: 'error', code: res.status === 401 ? 'AUTH_REQUIRED' : asErrorCode(body.code) });
        return;
      }
      setProposal(body.proposal);
      setHook(body.proposal.hook);
      setContent(body.proposal.content);
      saveOp.current = null;
      setGen({ kind: 'idle' });
    } catch {
      if (mine === seq.current) setGen({ kind: 'cancelled' });
    }
  }

  function cancel() {
    seq.current += 1;
    controller.current?.abort();
    setGen({ kind: 'cancelled' });
  }

  async function save(confirmTakeover = false) {
    if (!proposal) return;
    const key = JSON.stringify([proposal.id, hook, content]);
    const op = saveOp.current && saveOp.current.key === key ? saveOp.current : { key, id: newOperationId('zhsave') };
    saveOp.current = op;
    setWrite({ kind: 'saving' });
    const res = await postJson<WriteResponse>(`${api}/save`, {
      operationId: op.id,
      threadsContentId: proposal.threadsContentId,
      expectedRevision: proposal.threadsRevision,
      sourceHook: proposal.sourceHook,
      sourceContent: proposal.sourceContent,
      hook,
      content,
      ...(confirmTakeover ? { confirmTakeover: true } : {}),
    });
    const body = res.body as WriteResponse;
    if (body.ok) {
      saveOp.current = null;
      setTakeover(false);
      setProposal(null);
      setWrite({ kind: 'done', message: `Saved to ${proposal.threadsContentId} for Chinese review. Read it through, then approve it below.` });
      await reload();
      return;
    }
    if (body.code !== 'PROVIDER_UNAVAILABLE' && body.code !== 'RATE_LIMITED') saveOp.current = null;
    setTakeover(body.code === 'CONFLICT' && body.details?.reason === 'takeover_needs_confirmation');
    setWrite({ kind: 'error', message: writeError(body, res.status) });
  }

  async function approve() {
    if (threads.kind !== 'found') return;
    const key = threads.revision;
    const op = approveOp.current && approveOp.current.key === key ? approveOp.current : { key, id: newOperationId('zhapprove') };
    approveOp.current = op;
    setWrite({ kind: 'approving' });
    const res = await postJson<WriteResponse>(`${api}/approve`, { operationId: op.id, threadsContentId: threads.contentId, expectedRevision: threads.revision });
    const body = res.body as WriteResponse;
    if (body.ok) {
      approveOp.current = null;
      setWrite({ kind: 'done', message: 'Chinese copy approved. The Threads row is now Ready.' });
      await reload();
      return;
    }
    if (body.code !== 'PROVIDER_UNAVAILABLE' && body.code !== 'RATE_LIMITED') approveOp.current = null;
    setWrite({ kind: 'error', message: writeError(body, res.status) });
  }

  const approvalNote =
    view.state === 'awaiting_review'
      ? null
      : view.state === 'stale'
        ? 'Approval is unavailable: the adaptation is stale because the X copy changed after translation.'
        : view.state === 'approved'
          ? 'Already approved for this version of the X copy.'
          : view.state === 'ambiguous'
            ? 'Approval is unavailable until exactly one Threads row is linked.'
            : 'Approval becomes available after an adaptation is saved for Chinese review.';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-soft">Adaptation state</span>
        <StateBadge state={view.state} />
      </div>

      {view.state === 'stale' ? (
        <div role="alert" className="rounded-lg border-2 border-block bg-block-soft p-4 text-sm" data-testid="stale-banner">
          <p className="font-semibold text-block">The X copy changed after this translation.</p>
          <p className="mt-1 text-ink">
            The saved Chinese copy was made from an older version of the X post, so any Chinese or visual approval for it is no longer valid. Generate a new adaptation, review it,
            then approve it.
          </p>
        </div>
      ) : null}

      {!eligible ? (
        <StateView
          kind="blocked"
          title="This X post cannot be adapted yet"
          detail={
            <ul className="list-disc pl-5" aria-label="Blockers">
              {view.blockers.map((b) => (
                <li key={b.code} data-blocker={b.code}>
                  {b.message}
                </li>
              ))}
            </ul>
          }
          nextStep="Resolve these in the Sheet, then reload this page."
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby={`${ids}-src`} className="min-w-0 rounded-lg border border-line bg-card p-4">
          <h2 id={`${ids}-src`} className="text-lg font-semibold">
            X source (read only)
          </h2>
          <p className="mt-1 text-xs text-ink-soft">
            <span className="font-mono">{view.source.contentId}</span> · {view.source.date || 'No date'} · {view.source.slot || 'No slot'} · Stage: {view.source.stage || 'not set'}
          </p>
          <h3 className="mt-3 text-sm font-semibold">Hook</h3>
          <p className="copy mt-1 text-sm" lang="en-GB">
            {view.source.hook || <span className="text-ink-soft">Empty</span>}
          </p>
          <h3 className="mt-3 text-sm font-semibold">Content</h3>
          <pre className="copy mt-1 rounded-md bg-paper p-3 font-sans text-sm" lang="en-GB" data-testid="x-source">
            {view.source.content || 'Empty'}
          </pre>
        </section>

        <section aria-labelledby={`${ids}-th`} className="min-w-0 rounded-lg border border-line bg-card p-4">
          <h2 id={`${ids}-th`} className="text-lg font-semibold">
            Threads row
          </h2>
          {threads.kind === 'found' ? (
            <>
              <p className="mt-1 text-xs text-ink-soft">
                <span className="font-mono">{threads.contentId}</span> · {threads.date || 'No date'} · {threads.slot || 'No slot'} · Stage: {threads.stage || 'not set'}
              </p>
              <h3 className="mt-3 text-sm font-semibold">Saved Chinese copy</h3>
              {threads.chineseContent.trim() ? (
                <>
                  <p className="copy mt-1 text-sm" lang="zh-Hant-TW">
                    {threads.hook}
                  </p>
                  <pre className="copy mt-1 rounded-md bg-paper p-3 font-sans text-sm" lang="zh-Hant-TW" data-testid="saved-zh">
                    {threads.chineseContent}
                  </pre>
                </>
              ) : (
                <p className="mt-1 text-sm text-ink-soft">None yet.</p>
              )}
            </>
          ) : threads.kind === 'ambiguous' ? (
            <div className="mt-2 text-sm">
              <p className="font-semibold">More than one Threads row could belong to this X post.</p>
              <p className="mt-1">Content Studio will not guess. A human must choose in the Sheet: set Parent Content ID on exactly one of these rows, then reload.</p>
              <ul className="mt-2 flex flex-col gap-1" aria-label="Candidate Threads rows">
                {threads.candidates.map((c) => (
                  <li key={c.contentId} className="rounded-md border border-line px-3 py-2">
                    <span className="font-mono">{c.contentId}</span> · {c.date || 'No date'} · {c.slot || 'No slot'}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-sm">There is no Threads row for this X post. Add one in the Sheet with Parent Content ID set to {view.source.contentId}, then reload.</p>
          )}
        </section>
      </div>

      <section aria-labelledby={`${ids}-gen`} className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${ids}-gen`} className="text-lg font-semibold">
            Taiwan Traditional Chinese adaptation
          </h2>
          {canEdit ? (
            gen.kind === 'loading' ? (
              <button type="button" className={buttonClass()} onClick={cancel}>
                Cancel
              </button>
            ) : (
              <button type="button" className={buttonClass()} onClick={() => void generate()} disabled={!canGenerate || busy}>
                {proposal ? 'Generate again' : 'Generate adaptation'}
              </button>
            )
          ) : null}
        </div>
        <p className="text-sm text-ink-soft">An adaptation for Taiwan readers, not a literal translation. Nothing is written until you save it for Chinese review.</p>
        {!canEdit ? <p className="text-sm text-ink-soft">Read-only access: only the owner can generate, save or approve.</p> : null}

        {gen.kind === 'loading' ? <StateView kind="loading" title="Adapting the X copy" detail="Nothing is written while this runs." nextStep={null} /> : null}
        {gen.kind === 'cancelled' ? <InlineResult tone="info">Cancelled. Nothing was changed.</InlineResult> : null}
        {gen.kind === 'error' ? <AiErrorView code={gen.code} what="The adaptation" onRetry={canGenerate ? () => void generate() : undefined} /> : null}

        {proposal ? (
          <div className="flex flex-col gap-4" data-testid="zh-proposal">
            <div>
              <label htmlFor={`${ids}-hook`} className="text-sm font-medium">
                Chinese hook <span className="font-normal text-ink-soft">(edit before saving if needed)</span>
              </label>
              <textarea
                id={`${ids}-hook`}
                lang="zh-Hant-TW"
                value={hook}
                onChange={(e) => setHook(e.target.value)}
                rows={2}
                className="copy mt-1 w-full rounded-md border border-line bg-card p-3 font-sans text-base"
              />
            </div>
            <div>
              <label htmlFor={`${ids}-content`} className="text-sm font-medium">
                Chinese content <span className="font-normal text-ink-soft">(line breaks are kept as typed)</span>
              </label>
              <textarea
                id={`${ids}-content`}
                lang="zh-Hant-TW"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={Math.min(16, Math.max(5, content.split('\n').length + 1))}
                className="copy mt-1 w-full rounded-md border border-line bg-card p-3 font-sans text-base leading-relaxed"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">Chinese QA self-check</h3>
                <p className="text-xs text-ink-soft">Advisory only: you approve.</p>
                <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label="Chinese QA checks">
                  {QA_LABELS.map((q) => {
                    const pass = proposal.qa[q.key] === 'pass';
                    return (
                      <li key={q.key} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-1.5" data-qa={q.key} data-result={proposal.qa[q.key]}>
                        <span>{q.label}</span>
                        <span className={`font-semibold ${pass ? 'text-green' : 'text-ink-soft'}`}>
                          <span aria-hidden="true">{pass ? '✓ ' : '○ '}</span>
                          {pass ? 'Pass' : 'Check'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {proposal.qa.notes.length ? (
                  <ul className="mt-2 list-disc pl-5 text-xs">
                    {proposal.qa.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div>
                <h3 className="text-sm font-semibold">Terminology notes</h3>
                {proposal.terminologyNotes.length ? (
                  <ul className="mt-2 list-disc pl-5 text-sm" lang="zh-Hant-TW">
                    {proposal.terminologyNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-ink-soft">No pinned terms in this post.</p>
                )}
              </div>
            </div>
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass('primary')} disabled={busy || hook.trim() === '' || content.trim() === ''} onClick={() => void save()}>
                  {write.kind === 'saving' ? 'Saving…' : 'Save for Chinese review'}
                </button>
                {takeover ? (
                  <button type="button" className={buttonClass('danger')} disabled={busy} onClick={() => void save(true)}>
                    Use this row anyway
                  </button>
                ) : null}
                <button
                  type="button"
                  className={buttonClass()}
                  disabled={busy}
                  onClick={() => {
                    setProposal(null);
                    setWrite({ kind: 'idle' });
                  }}
                >
                  Discard this adaptation
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {write.kind === 'done' ? <InlineResult tone="success">{write.message}</InlineResult> : null}
      {write.kind === 'error' ? <InlineResult tone="error">{write.message}</InlineResult> : null}

      <section aria-labelledby={`${ids}-ap`} className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4">
        <h2 id={`${ids}-ap`} className="text-lg font-semibold">
          Chinese approval
        </h2>
        {approvalNote ? <p className="text-sm">{approvalNote}</p> : <p className="text-sm">The saved adaptation matches the current X copy and is waiting for your review.</p>}
        {canEdit && view.state === 'awaiting_review' && threads.kind === 'found' ? (
          <div>
            <button type="button" className={buttonClass('approve')} disabled={busy || !!proposal} onClick={() => void approve()}>
              {write.kind === 'approving' ? 'Approving…' : 'Approve Chinese copy'}
            </button>
            {proposal ? <p className="mt-1 text-xs text-ink-soft">Save or discard the new adaptation above first.</p> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

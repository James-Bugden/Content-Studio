'use client';

import { useEffect, useRef, useState } from 'react';
import type { ErrorCode } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import type { HookAlternative } from '@/domain/hook-frameworks';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { AiErrorView, asErrorCode } from './ai-error';

/**
 * One-click AI check for a single post (#242), above the text on the left.
 *
 * Runs two advisory calls on the exact text in the box: does the post need an
 * image, and three hook options. The image verdict is written through the guarded
 * Visual Studio decision (only while the post has no decision yet and the text was
 * not edited meanwhile); hooks are only offered. Both calls go through the AI
 * gateway, so they count against the monthly cap and stop when it is reached.
 */
type Verdict = { verdict: 'needs_image' | 'no_image'; reason: string };
type Recorded = { kind: 'idle' } | { kind: 'saved'; label: string } | { kind: 'skipped' } | { kind: 'failed' };
type Phase = { kind: 'idle' } | { kind: 'running' } | { kind: 'cancelled' } | { kind: 'done' };
type Failure = { what: string; code: ErrorCode };

type ImageResponse = ({ ok: true } & Verdict) | { ok: false; code: string };
type HookResponse = { ok: true; proposal: { alternatives: HookAlternative[] } } | { ok: false; code: string };
type DecideResponse = { ok: true; item: { revision: string } } | { ok: false; code: string };

export function AiAssist({ libraryId, text, canEdit, decided, dirty, revision, onUseHook, onDecided }: {
  libraryId: string;
  text: string;
  canEdit: boolean;
  /** The post already has an image decision, which the check never overwrites. */
  decided: boolean;
  /** Unsaved changes: the decision is a separate guarded write, so it waits for a save. */
  dirty: boolean;
  revision: string;
  onUseHook: (hook: string) => void;
  /** The decision was written; the editor carries on from the new revision. */
  onDecided: (decision: 'Text only' | 'Original graphic', revision: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [image, setImage] = useState<Verdict | null>(null);
  const [recorded, setRecorded] = useState<Recorded>({ kind: 'idle' });
  const [hooks, setHooks] = useState<HookAlternative[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef({ text, dirty, decided, revision });
  useEffect(() => { latest.current = { text, dirty, decided, revision }; });
  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const draft = text;
    const draftHash = fingerprint(draft);
    setPhase({ kind: 'running' });
    setImage(null); setHooks([]); setFailures([]); setRecorded({ kind: 'idle' });
    try {
      const base = `/api/library/${encodeURIComponent(libraryId)}`;
      const [img, hk] = await Promise.all([
        postJson<ImageResponse>(`${base}/image-need`, { draft, draftHash }, ctrl.signal),
        postJson<HookResponse>(`${base}/hooks`, { draft, draftHash }, ctrl.signal),
      ]);
      if (ctrl.signal.aborted) return;
      const problems: Failure[] = [];
      const imageBody = img.body as ImageResponse;
      const hookBody = hk.body as HookResponse;
      if (imageBody.ok) {
        setImage({ verdict: imageBody.verdict, reason: imageBody.reason });
        await record(imageBody.verdict, draft, ctrl.signal);
      } else problems.push({ what: 'Image check', code: img.status === 401 ? 'AUTH_REQUIRED' : asErrorCode(imageBody.code) });
      if (hookBody.ok) setHooks(hookBody.proposal.alternatives.slice(0, 3));
      else problems.push({ what: 'Hook suggestions', code: hk.status === 401 ? 'AUTH_REQUIRED' : asErrorCode(hookBody.code) });
      // The spend cap stops both calls at once; say so once.
      setFailures(problems.some((p) => p.code === 'AI_LIMIT_REACHED') ? problems.filter((p) => p.code === 'AI_LIMIT_REACHED').slice(0, 1) : problems);
      setPhase({ kind: 'done' });
    } catch {
      if (!ctrl.signal.aborted) setPhase({ kind: 'cancelled' });
    }
  }

  async function record(verdict: Verdict['verdict'], draft: string, signal: AbortSignal) {
    const now = latest.current;
    if (now.decided || !canEdit) return;
    // Only a decision for the exact text that was checked, on a saved row.
    if (now.dirty || now.text !== draft) { setRecorded({ kind: 'skipped' }); return; }
    const decision = verdict === 'no_image' ? 'text_only' : 'original_graphic';
    const res = await postJson<DecideResponse>(`/api/library/${encodeURIComponent(libraryId)}/visual`, {
      action: 'decide', operationId: newOperationId('imgneed'), libraryId, expectedRevision: now.revision, decision,
    }, signal);
    const body = res.body as DecideResponse;
    if (body.ok) {
      const label = decision === 'text_only' ? 'Text only' : 'Original graphic';
      onDecided(label, body.item.revision);
      setRecorded({ kind: 'saved', label });
    } else setRecorded({ kind: 'failed' });
  }

  function cancel() {
    controller.current?.abort();
    setPhase({ kind: 'cancelled' });
  }

  const running = phase.kind === 'running';
  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-2">
      {canEdit ? (
        running ? (
          <button type="button" className={buttonClass()} onClick={cancel}>Cancel</button>
        ) : (
          <button type="button" className={buttonClass('secondary')} disabled={text.trim() === ''} onClick={() => void run()}>
            <span aria-hidden="true">✧</span> Check with AI
          </button>
        )
      ) : null}
      {running ? <p role="status" className="inline-flex items-center gap-2 text-sm"><span aria-hidden="true" className="size-3 rounded-full border-2 border-ink border-t-transparent motion-safe:animate-spin" />Checking image and writing hooks…</p> : null}
      {phase.kind === 'cancelled' ? <p role="status" className="text-sm">Cancelled.</p> : null}

      {image ? (
        <p role="status" className="min-w-0 text-sm" data-image-verdict={image.verdict}>
          <strong>{image.verdict === 'needs_image' ? 'Needs an image' : 'No image needed'}</strong>
          {' · '}{image.reason}
          {recorded.kind === 'saved' ? <span className="text-ink-soft"> Recorded as {recorded.label}.</span> : null}
          {recorded.kind === 'skipped' ? <span className="text-ink-soft"> Save the draft to record it.</span> : null}
          {recorded.kind === 'failed' ? <span className="font-semibold text-block"> Not recorded.</span> : null}
        </p>
      ) : null}

      {hooks.length > 0 ? (
        <ol className="flex w-full min-w-0 flex-col gap-2" aria-label="Hook options">
          {hooks.map((h, i) => (
            <li key={`${i}-${h.text}`} className="flex min-w-0 items-start gap-3 rounded-md border border-line bg-card p-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-baseline gap-1.5 text-xs text-ink-soft"><span className="shrink-0 font-semibold tabular-nums text-ink">{h.total}/10</span><span className="break-words">{h.template}</span></p>
                <p className="copy break-words text-sm">{h.text}</p>
              </div>
              {canEdit ? <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => onUseHook(h.text)} aria-label={`Use hook option ${i + 1}`}>Use this</button> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {failures.map((f) => <div key={f.what} className="w-full"><AiErrorView code={f.code} what={f.what} onRetry={canEdit ? () => void run() : undefined} /></div>)}
    </div>
  );
}

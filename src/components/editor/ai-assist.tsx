'use client';

import { useEffect, useRef, useState } from 'react';
import type { ErrorCode } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import type { HookAlternative } from '@/domain/hook-frameworks';
import type { QaProposal } from '@/domain/proposals';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { AiErrorView } from './ai-error';
import { AI_PART_LABEL, collapseFailures, runCombinedAiCheck, type AiPart, type ImageVerdict, type PartResult } from './combined-ai-check';

/**
 * One-click AI check for a single post (#242, #247), above the text on the left.
 *
 * Runs three advisory calls in parallel on the exact text in the box: the English
 * check, three hook options and the image need. The image verdict is written
 * through the guarded Visual Studio decision (only while the post has no decision
 * yet and the text was not edited meanwhile); the English findings are handed to
 * the English check panel and hooks are only offered. All calls go through the AI
 * gateway, so each counts against the monthly cap and stops when it is reached.
 */
type Verdict = ImageVerdict;
type Recorded = { kind: 'idle' } | { kind: 'saved'; label: string } | { kind: 'skipped' } | { kind: 'failed' };
type Phase = { kind: 'idle' } | { kind: 'running' } | { kind: 'cancelled' } | { kind: 'done' };
type Failure = { part: AiPart; code: ErrorCode };

type DecideResponse = { ok: true; item: { revision: string } } | { ok: false; code: string };

const PARTS: AiPart[] = ['qa', 'hooks', 'image'];

export function AiAssist({ libraryId, text, canEdit, decided, dirty, revision, onUseHook, onDecided, onQaResult }: {
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
  /** The English check finished; the English check panel shows its findings. */
  onQaResult?: (proposal: QaProposal) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [pending, setPending] = useState<AiPart[]>([]);
  const [image, setImage] = useState<Verdict | null>(null);
  const [qa, setQa] = useState<QaProposal | null>(null);
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
    setPhase({ kind: 'running' });
    setPending(PARTS);
    setImage(null); setHooks([]); setQa(null); setFailures([]); setRecorded({ kind: 'idle' });
    const failed: Failure[] = [];
    const recordings: Promise<void>[] = [];
    const onPart = (r: PartResult) => {
      setPending((p) => p.filter((x) => x !== r.part));
      if (!r.ok) { failed.push({ part: r.part, code: r.code }); return; }
      if (r.part === 'qa') { setQa(r.proposal); onQaResult?.(r.proposal); }
      else if (r.part === 'hooks') setHooks(r.alternatives);
      else { setImage(r.image); recordings.push(record(r.image.verdict, draft, ctrl.signal).catch(() => {})); }
    };
    try {
      await runCombinedAiCheck({ libraryId, draft, draftHash: fingerprint(draft), signal: ctrl.signal, onPart });
      await Promise.all(recordings);
      if (ctrl.signal.aborted) return;
      setFailures(collapseFailures(failed));
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
    setPending([]);
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
      {running ? <p role="status" className="inline-flex items-center gap-2 text-sm"><span aria-hidden="true" className="size-3 rounded-full border-2 border-ink border-t-transparent motion-safe:animate-spin" />Checking {pending.map((p) => AI_PART_LABEL[p].toLowerCase()).join(', ') || 'results'}…</p> : null}
      {phase.kind === 'cancelled' ? <p role="status" className="text-sm">Cancelled.</p> : null}

      {qa ? <QaChips proposal={qa} stale={qa.draftHash !== fingerprint(text)} /> : null}

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

      {failures.map((f) => <div key={f.part} className="w-full"><AiErrorView code={f.code} what={AI_PART_LABEL[f.part]} onRetry={canEdit ? () => void run() : undefined} /></div>)}
    </div>
  );
}

/** English check result as chips; the findings themselves are in the English check panel. */
function QaChips({ proposal, stale }: { proposal: QaProposal; stale: boolean }) {
  const count = (s: 'must' | 'should' | 'consider') => proposal.findings.filter((f) => f.severity === s).length;
  const chips = ([['must', 'must fix'], ['should', 'should fix'], ['consider', 'to consider']] as const).filter(([s]) => count(s) > 0);
  return (
    <p role="status" className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm" data-qa-chips>
      <strong>English</strong>
      {chips.length === 0 ? <span className="rounded-sm border border-line px-1.5 text-xs font-semibold">No issues</span>
        : chips.map(([s, label]) => <span key={s} className={`rounded-sm border px-1.5 text-xs font-semibold ${s === 'must' ? 'border-block text-block' : 'border-line'}`}>{count(s)} {label}</span>)}
      {chips.length > 0 ? <span className="text-ink-soft">Details in English check.</span> : null}
      {stale ? <span className="text-ink-soft">Out of date: the text changed.</span> : null}
    </p>
  );
}

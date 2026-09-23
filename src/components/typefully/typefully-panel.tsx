'use client';

import { useRef, useState } from 'react';
import {
  formatTaipei,
  type CandidateView,
  type CopyComparison,
  type RowDiscriminators,
  type TypefullyDetailView,
} from '@/domain/typefully-view';
import { getJson, newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { ConflictDialog } from '../conflict-dialog';
import { GuardedLink } from '../guarded-link';
import { InlineResult, type ResultTone } from '../inline-result';
import { ERROR_STATE_KIND, StateView } from '../state-view';
import { ZH_WORDS, reasonText, type Failure } from './reason-text';

/**
 * Typefully reconciliation panel for one Schedule row (CS-015).
 *
 * The five states look and read differently (TYPE-01). Nothing links or creates
 * on its own: a single match needs "Link this draft", ambiguous candidates need
 * an explicit pick (TYPE-03), and creation uses one operation id per intent that
 * survives retries and double clicks, so the server can find an earlier attempt
 * instead of creating a second draft (TYPE-02). Sync direction is always an
 * explicit button, and a conflict opens a comparison where the owner chooses
 * (TYPE-04/05). Status is words and glyphs, never colour alone.
 */
type Success = { ok: true; replayed: boolean; revision: string; typefullyStatus?: string };
type Action = 'link' | 'create' | 'sync-final' | 'push';

const RETRY_SAME_OP = new Set(['PROVIDER_UNAVAILABLE', 'PARTIAL_FAILURE', 'RATE_LIMITED', 'UNKNOWN']);

const NEWER_WORDS: Record<CopyComparison['newer'], string> = {
  same: 'Final Content and Typefully match exactly.',
  typefully: 'Typefully is newer: its text changed after the last sync.',
  sheet: 'The Sheet is newer: Final Content was edited after the last sync.',
  both: 'Both changed after the last sync. Compare them and choose explicitly.',
  unknown: 'There is no sync record yet, so which is newer is unknown. Compare before choosing.',
};

function when(iso: string | null): string {
  if (!iso) return 'Not set';
  return formatTaipei(iso) ?? iso;
}

function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function Pane({ label, hint, text }: { label: string; hint: string; text: string }) {
  return (
    <section aria-label={label} className="flex min-w-0 flex-col rounded-md border border-line bg-card">
      <h4 className="border-b border-line bg-paper px-3 py-2 text-sm font-semibold">
        {label} <span className="font-normal text-ink-soft">({hint})</span>
      </h4>
      <div className="copy min-h-20 px-3 py-2 text-sm" data-pane={label}>
        {text === '' ? <span className="text-ink-soft">Empty</span> : text}
      </div>
    </section>
  );
}

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium text-ink-soft">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function candidateFacts(c: CandidateView, row: RowDiscriminators): [string, React.ReactNode][] {
  return [
    ['Draft', <span key="d" className="font-mono">{c.draftId}</span>],
    ['Date', c.date ?? 'No date in Typefully'],
    ['Time (Taipei)', c.time ?? 'No time in Typefully'],
    ['Slot', c.slot ?? 'No matching slot'],
    ['Platform', c.multiPlatform ? `${c.platforms.join(' and ')} (more than one)` : c.platform],
    ['Status in Typefully', c.status],
    ['Planned time', row.plannedAt ? `${when(row.plannedAt)}${c.deltaMinutes !== null ? ` (${c.deltaMinutes === 0 ? 'same time' : `${c.deltaMinutes} min apart`})` : ''}` : 'Not set on the row'],
    ['Text similarity', percent(c.similarity)],
  ];
}

export function TypefullyPanel({ initial, canEdit }: { initial: TypefullyDetailView; canEdit: boolean }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<Action | 'refresh' | null>(null);
  const [result, setResult] = useState<{ tone: ResultTone; text: string; adaptLink?: boolean } | null>(null);
  const [conflict, setConflict] = useState<{ direction: 'sync' | 'push'; comparison: CopyComparison } | null>(null);
  const busyRef = useRef(false);
  /** One operation id per intent, kept until a definitive answer so a retry is the same operation. */
  const ops = useRef<Partial<Record<string, string>>>({});
  const { row, panel } = view;
  const base = `/api/schedule/${encodeURIComponent(row.contentId)}/typefully`;

  async function refresh(): Promise<void> {
    const res = await getJson<{ ok: true; view: TypefullyDetailView } | Failure>(base);
    if (res.body.ok) setView(res.body.view);
  }

  async function recheck(): Promise<void> {
    setBusy('refresh');
    setResult(null);
    await refresh();
    setBusy(null);
  }

  async function run(action: Action, opKey: string, extra: Record<string, unknown>, done: (s: Success) => string): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    setResult(null);
    const operationId = (ops.current[opKey] ??= newOperationId(action === 'create' ? 'tfc' : 'tf'));
    try {
      const res = await postJson<Success | Failure>(`${base}/${action}`, { operationId, expectedRevision: view.row.revision, ...extra });
      const body = res.body as Success | Failure;
      if (body.ok) {
        delete ops.current[opKey];
        setConflict(null);
        setResult({ tone: 'success', text: done(body) });
        await refresh();
        return;
      }
      if (!RETRY_SAME_OP.has(body.code)) delete ops.current[opKey];
      const comparison = body.details?.comparison;
      const reason = body.details?.reason;
      if (body.code === 'CONFLICT' && comparison && (reason === 'sheet_final_edited' || reason === 'no_sync_baseline' || reason === 'typefully_edited' || reason === 'typefully_changed_during_push')) {
        setConflict({ direction: action === 'push' ? 'push' : 'sync', comparison });
        setResult({ tone: 'warning', text: 'Both versions are kept. Nothing was overwritten. Choose which text to keep.' });
        return;
      }
      if (body.details?.reconciliation) setView((v) => ({ ...v, panel: body.details!.reconciliation! }));
      if (body.code === 'STALE_READ') await refresh();
      setResult({
        tone: body.code === 'CONFLICT' || body.code === 'AMBIGUOUS_MATCH' || body.code === 'GATE_BLOCKED' ? 'warning' : 'error',
        text: reasonText(body, view.row.platform),
        adaptLink: reason === 'zh_adaptation_not_approved',
      });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const syncFinal = (resolve?: 'take_typefully') =>
    run('sync-final', resolve ? 'sync-final:resolve' : 'sync-final', resolve ? { resolve } : {}, (s) =>
      s.replayed ? 'Final Content already matched Typefully. Nothing needed writing.' : 'Typefully’s exact text is now in Final Content. Content was not changed.',
    );
  const push = (resolve?: 'take_sheet') =>
    run('push', resolve ? 'push:resolve' : 'push', resolve ? { resolve } : {}, (s) => (s.replayed ? 'Typefully already had this text. Nothing needed sending.' : 'The Sheet text was sent to Typefully.'));
  const link = (draftId: string) =>
    run('link', `link:${draftId}`, { draftId }, (s) => (s.replayed ? 'This draft was already linked.' : `Linked Typefully draft ${draftId} to ${row.contentId}.`));
  const create = () =>
    run('create', 'create', { timing: 'plan' }, (s) =>
      s.replayed ? 'An earlier attempt had already created the draft. It is now linked; no second draft was made.' : 'Created a planned draft in Typefully and linked it to this row.',
    );

  const readOnlyNote = canEdit ? null : <p className="text-sm text-ink-soft">Read only: only the owner can link, create or sync Typefully drafts.</p>;
  const zhNote =
    row.zh && row.zh.state !== 'approved' ? (
      <InlineResult tone="warning">
        The Chinese adaptation is {ZH_WORDS[row.zh.state]}.{' '}
        <GuardedLink href={`/schedule/${encodeURIComponent(row.zh.xContentId)}/adapt`} className="underline">
          Open the Threads adaptation
        </GuardedLink>
      </InlineResult>
    ) : null;

  return (
    <section aria-labelledby="tf-h" className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4" data-typefully-state={panel.kind}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="tf-h" className="text-lg font-semibold">
          Typefully
        </h2>
        <button type="button" className="text-sm underline" onClick={() => void recheck()} disabled={busy !== null}>
          {busy === 'refresh' ? 'Checking Typefully' : 'Check again'}
        </button>
      </div>

      {result ? (
        <InlineResult tone={result.tone}>
          {result.text}
          {result.adaptLink && row.zh ? (
            <>
              {' '}
              <GuardedLink href={`/schedule/${encodeURIComponent(row.zh.xContentId)}/adapt`} className="underline">
                Open the Threads adaptation
              </GuardedLink>
            </>
          ) : null}
        </InlineResult>
      ) : null}

      {panel.kind === 'linked' ? (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green bg-green-soft px-2.5 py-0.5 font-semibold text-green">
              <span aria-hidden="true">✓</span> Linked
            </span>
            <span>
              Draft <span className="font-mono">{panel.draft.draftId}</span> · {panel.draft.status} in Typefully
              {panel.draft.scheduledAt ? ` · planned for ${when(panel.draft.scheduledAt)} Taipei` : ''}
            </span>
          </p>
          {panel.platformMismatch ? <InlineResult tone="error">This draft is not enabled for {row.platformRaw}. Relink the row in the Sheet.</InlineResult> : null}
          <p className="text-sm" data-newer={panel.comparison.newer}>
            <span className="font-semibold">Which is newer: </span>
            {NEWER_WORDS[panel.comparison.newer]}
          </p>
          <p className="text-xs text-ink-soft">
            Last sync: {panel.comparison.lastSyncAt ? `${when(panel.comparison.lastSyncAt)} Taipei` : 'never'} · Typefully last edited: {when(panel.comparison.typefullyUpdatedAt)} Taipei
          </p>
          <div className="grid gap-3 lg:grid-cols-3">
            <Pane label="Sheet working copy" hint={row.platform === 'Threads' ? 'Chinese Content' : 'Content'} text={panel.comparison.sheetWorking} />
            <Pane label="Sheet final copy" hint="Final Content" text={panel.comparison.sheetFinal} />
            <Pane label="Typefully current text" hint="in Typefully now" text={panel.comparison.typefully} />
          </div>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass('primary')} disabled={busy !== null} onClick={() => void syncFinal()}>
                {busy === 'sync-final' ? 'Copying from Typefully' : 'Take Typefully’s text into Final Content'}
              </button>
              <button type="button" className={buttonClass('secondary')} disabled={busy !== null || panel.draft.status === 'Published'} onClick={() => void push()}>
                {busy === 'push' ? 'Sending to Typefully' : 'Send the Sheet text to Typefully'}
              </button>
            </div>
          ) : null}
          {canEdit ? <p className="text-xs text-ink-soft">Taking Typefully&apos;s text writes it exactly into Final Content and never changes Content. Sending the Sheet text uses Final Content, or the working copy when Final Content is empty.</p> : null}
        </div>
      ) : null}

      {panel.kind === 'single_match' ? (
        <div className="flex flex-col gap-3">
          <StateView kind="no_match" title="One Typefully draft matches this slot" detail="It is not linked yet. Check the preview, then link it." nextStep={null} />
          <article aria-label={`Candidate ${panel.candidate.draftId}`} className="flex flex-col gap-3 rounded-md border border-line p-3">
            <Facts items={candidateFacts(panel.candidate, panel.row)} />
            <Pane label="Typefully text" hint="candidate" text={panel.candidate.text} />
            {canEdit ? (
              <div>
                <button type="button" className={buttonClass('primary')} disabled={busy !== null} onClick={() => void link(panel.candidate.draftId)}>
                  {busy === 'link' ? 'Linking' : 'Link this draft'}
                </button>
              </div>
            ) : null}
          </article>
        </div>
      ) : null}

      {panel.kind === 'ambiguous' ? (
        <div className="flex flex-col gap-3">
          <StateView
            kind="conflict"
            title={`${panel.candidates.length} Typefully drafts could match this slot`}
            detail="None is linked or created automatically. Compare the date, slot, platform, planned time and similarity, then pick one."
            nextStep={canEdit ? 'Link the right draft, or fix the drafts in Typefully and check again.' : null}
          />
          <ul className="flex flex-col gap-3">
            {panel.candidates.map((c) => (
              <li key={c.draftId}>
                <article aria-label={`Candidate ${c.draftId}`} className="flex flex-col gap-3 rounded-md border border-line p-3">
                  <Facts items={candidateFacts(c, panel.row)} />
                  {c.linkedToContentId ? <p className="text-sm">⊘ Already linked to {c.linkedToContentId}.</p> : null}
                  <Pane label="Typefully text" hint="candidate" text={c.text} />
                  {canEdit ? (
                    <div>
                      <button type="button" className={buttonClass('secondary')} disabled={busy !== null || Boolean(c.linkedToContentId)} onClick={() => void link(c.draftId)}>
                        Link this draft
                      </button>
                    </div>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {panel.kind === 'no_match' ? (
        panel.searched ? (
          <div className="flex flex-col gap-3">
            <StateView
              kind="empty"
              title="No Typefully draft matches this slot"
              detail={`Searched ${row.platformRaw} drafts within 90 minutes of ${when(panel.row.plannedAt)} Taipei. Nothing is linked yet.`}
              nextStep={null}
            />
            {zhNote}
            {canEdit ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm">
                  This creates one <span className="font-semibold">planned</span> draft dated {when(panel.row.plannedAt)} Taipei with the {row.platform === 'Threads' ? 'Chinese Content' : 'Content'} text. A planned draft does not publish automatically; you schedule it in Typefully.
                </p>
                <div>
                  <button type="button" className={buttonClass('primary')} disabled={busy !== null} onClick={() => void create()}>
                    {busy === 'create' ? 'Creating in Typefully' : 'Create a planned draft in Typefully'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <StateView kind="blocked" title="No planned date and time" detail="The row has no readable date or Publish Time (Taipei), so Typefully cannot be searched or a draft planned." nextStep="Set the slot time in the Sheet." />
        )
      ) : null}

      {panel.kind === 'invalid_row' ? (
        <StateView kind="blocked" title="Platform not recognised" detail="This row's Platform cell is blank or not X, Threads or LinkedIn, so it cannot be matched to Typefully." nextStep="Fix the Platform cell in the Sheet." />
      ) : null}

      {panel.kind === 'provider_error' ? (
        <StateView
          kind={ERROR_STATE_KIND[panel.code]}
          title={panel.code === 'CONFIG_MISSING' ? 'Typefully is not configured' : panel.provider === 'sheet' ? 'The Sheet could not be read' : 'Typefully could not be checked'}
          detail="Nothing was linked, created or changed. Review and scheduling keep working without Typefully."
          nextStep={panel.code === 'CONFIG_MISSING' ? 'Add the Typefully key and social set, then reload.' : 'Check again in a moment.'}
        />
      ) : null}

      {panel.kind !== 'no_match' ? zhNote : null}
      {readOnlyNote}

      {conflict ? (
        <ConflictDialog
          open
          onClose={() => setConflict(null)}
          title={conflict.direction === 'sync' ? 'Final Content was edited in the Sheet' : 'Typefully was edited'}
          description={
            conflict.direction === 'sync'
              ? 'Current is the Sheet’s Final Content now; proposed is Typefully’s text. Nothing was overwritten. Choose explicitly.'
              : 'Current is Typefully’s text now; proposed is the Sheet text. Nothing was overwritten. Choose explicitly.'
          }
          current={conflict.direction === 'sync' ? conflict.comparison.sheetFinal : conflict.comparison.typefully}
          proposed={conflict.direction === 'sync' ? conflict.comparison.typefully : conflict.comparison.sheetFinal || conflict.comparison.sheetWorking}
          actions={[
            { label: 'Take Typefully’s text into Final Content', variant: 'primary', onSelect: () => void syncFinal('take_typefully') },
            { label: 'Send the Sheet text to Typefully', onSelect: () => void push('take_sheet') },
          ]}
        />
      ) : null}
    </section>
  );
}

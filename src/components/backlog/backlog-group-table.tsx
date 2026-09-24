'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { OpenPanelLink, panelHref } from '../panel/open-panel-link';
import { EditableHookCell, type HookSaveOutcome } from './editable-hook-cell';

/**
 * One Backlog source group as a dense, directly editable table (spreadsheet-
 * style Backlog): row number, monospace Library ID, the hook edited in place,
 * and the next action done in place (Approve / Skip) with a smaller Open link
 * into the full side panel. A row with no hook yet offers Start drafting, which
 * opens the same panel. Clicking anywhere else on a row also opens the panel.
 *
 * Every write goes through POST /api/backlog/edit with the same envelope the
 * queue panel uses (operation id, expected revision, patch); the row keeps the
 * revision the server returns so a second edit never trips over the first.
 * A STALE_READ answer asks the owner to reload rather than overwrite.
 *
 * Same responsive split as the Posts table: a real table from md up, stacked
 * rows on phones. Both carry `data-library-id` so tests can address either.
 */
export type BacklogRow = {
  libraryId: string;
  revision: string;
  hook: string;
  reviewStatus: 'Pending' | 'Approved' | 'Skipped' | 'Changes Requested' | null;
  pesto: string;
  platform: string | null;
  hookTemplate: string;
};

type Decision = 'Approved' | 'Skipped';
type RowState = { revision: string; hook: string; decided: Decision | null; busy: boolean; note: string | null };

function initialDecision(status: BacklogRow['reviewStatus']): Decision | null {
  return status === 'Approved' || status === 'Skipped' ? status : null;
}
type EditOutcome = { ok: true; item: { revision: string; hook: string }; revision: string; replayed: boolean } | { ok: false; code: string; message?: string };

const STALE_TEXT = 'This idea changed elsewhere. Reload the page to see the latest version; nothing was overwritten.';

function failureText(body: Extract<EditOutcome, { ok: false }>): string {
  if (body.code === 'STALE_READ') return STALE_TEXT;
  if (body.code === 'FORBIDDEN') return 'Not saved: this account cannot edit the backlog.';
  return body.message || 'Not saved. Nothing was written.';
}

export function BacklogGroupTable({ source, items, canEdit }: { source: string; items: BacklogRow[]; canEdit: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(items.map((i) => [i.libraryId, { revision: i.revision, hook: i.hook, decided: initialDecision(i.reviewStatus), busy: false, note: null }])),
  );

  function patchRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  }

  async function edit(id: string, patch: { currentHook?: string; reviewStatus?: Decision }): Promise<EditOutcome> {
    const res = await postJson<EditOutcome>('/api/backlog/edit', {
      operationId: newOperationId('backlog'),
      libraryId: id,
      expectedRevision: rows[id]!.revision,
      patch,
    });
    const body = res.body as EditOutcome;
    if (body.ok) patchRow(id, { revision: body.revision, hook: body.item.hook });
    return body;
  }

  async function saveHook(id: string, next: string): Promise<HookSaveOutcome> {
    const body = await edit(id, { currentHook: next });
    if (body.ok) return { ok: true, note: body.replayed ? 'Already saved' : undefined };
    return { ok: false, message: failureText(body) };
  }

  async function decide(id: string, decision: Decision) {
    patchRow(id, { busy: true, note: null });
    const body = await edit(id, { reviewStatus: decision });
    if (body.ok) patchRow(id, { busy: false, decided: decision });
    else patchRow(id, { busy: false, note: failureText(body) });
  }

  function openPanel(id: string) {
    router.replace(panelHref(pathname, params, { queue: id }), { scroll: false });
  }

  function onRowClick(e: React.MouseEvent<HTMLElement>, id: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, button, a, textarea, [role="status"]')) return;
    if (window.getSelection()?.toString()) return;
    openPanel(id);
  }

  function nextAction(id: string, size: 'sm' | 'md' = 'sm') {
    const r = rows[id]!;
    const open =
      r.hook.trim() === '' ? null : (
        <OpenPanelLink target={{ queue: id }} label={`Open ${id} in the panel`} className="inline-flex min-h-8 items-center text-xs text-primary underline underline-offset-2">
          Open
        </OpenPanelLink>
      );
    // Fixed two-row shape (primary control, then Open on its own line) so Open sits
    // in the same place for every row regardless of how wide the primary control is.
    let primary: React.ReactNode;
    if (r.hook.trim() === '') {
      primary = (
        <OpenPanelLink target={{ queue: id }} className={`${buttonClass('secondary', size)}`}>
          Start drafting
        </OpenPanelLink>
      );
    } else if (r.decided) {
      primary = (
        <span role="status" className={r.decided === 'Approved' ? 'font-semibold text-green' : 'text-ink-soft'} data-decided={r.decided}>
          {r.decided === 'Approved' ? <span aria-hidden="true">✓ </span> : null}
          {r.decided}
        </span>
      );
    } else if (!canEdit) {
      primary = null;
    } else {
      primary = (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <button type="button" className={`${buttonClass('approve', size)}`} disabled={r.busy} onClick={() => void decide(id, 'Approved')}>
            Approve
          </button>
          <button type="button" className={`${buttonClass('secondary', size)}`} disabled={r.busy} onClick={() => void decide(id, 'Skipped')}>
            Skip
          </button>
        </span>
      );
    }
    return (
      <span className="flex flex-col items-start gap-1 text-xs">
        {primary}
        {open}
        {r.busy ? (
          <span role="status" className="text-ink-soft">
            Saving…
          </span>
        ) : r.note ? (
          <span role="status" className="font-semibold text-block">
            {r.note}
          </span>
        ) : null}
      </span>
    );
  }

  function approvedCell(id: string) {
    const decided = rows[id]!.decided;
    if (decided === 'Approved') return <span className="font-semibold text-green">✓ Approved</span>;
    if (decided === 'Skipped') return <span className="text-ink-soft">Skipped</span>;
    return <span className="text-ink-soft">Not yet</span>;
  }

  const cell = 'border-l border-line px-2 py-1 first:border-l-0';

  return (
    <>
      {/* Wide screens: a dense sheet-like table, no card padding, thin gridlines, striped and hover rows. */}
      <div role="region" aria-label={`${source} ideas`} tabIndex={0} className="hidden overflow-x-auto border-t border-line md:block">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-paper text-left text-xs text-ink-soft">
              <th scope="col" className={`${cell} w-10 text-right font-medium tabular-nums`}>
                #
              </th>
              <th scope="col" className={`${cell} w-36 font-medium whitespace-nowrap`}>
                Library ID
              </th>
              <th scope="col" className={`${cell} w-24 font-medium whitespace-nowrap`}>
                Platform
              </th>
              <th scope="col" className={`${cell} w-28 font-medium whitespace-nowrap`}>
                PESTO
              </th>
              <th scope="col" className={`${cell} w-40 font-medium whitespace-nowrap`}>
                Hook template
              </th>
              <th scope="col" className={`${cell} font-medium`}>
                Hook
              </th>
              <th scope="col" className={`${cell} w-28 font-medium whitespace-nowrap`}>
                Approved
              </th>
              <th scope="col" className={`${cell} w-56 font-medium whitespace-nowrap`}>
                Next action
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr
                key={item.libraryId}
                data-library-id={item.libraryId}
                onClick={(e) => onRowClick(e, item.libraryId)}
                className="cursor-pointer border-b border-line align-top last:border-b-0 even:bg-paper/60"
              >
                <td className={`${cell} text-right text-xs text-ink-soft tabular-nums`}>{index + 1}</td>
                <td className={`${cell} font-mono text-xs text-ink-soft whitespace-nowrap`}>{item.libraryId}</td>
                <td className={`${cell} text-xs text-ink-soft whitespace-nowrap`}>{item.platform ?? '—'}</td>
                <td className={`${cell} text-xs text-ink-soft whitespace-nowrap`}>{item.pesto || '—'}</td>
                <td className={`${cell} max-w-40 truncate text-xs text-ink-soft`} title={item.hookTemplate || undefined}>
                  {item.hookTemplate || '—'}
                </td>
                <td className={`${cell} max-w-0`}>
                  <EditableHookCell value={rows[item.libraryId]!.hook} canEdit={canEdit} libraryId={item.libraryId} onSave={(next) => saveHook(item.libraryId, next)} />
                </td>
                <td className={`${cell} text-xs whitespace-nowrap`}>{approvedCell(item.libraryId)}</td>
                <td className={`${cell} w-56`}>{nextAction(item.libraryId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: the same rows stacked, with the row number and ID on one line. */}
      <ul className="flex flex-col divide-y divide-line border-t border-line md:hidden">
        {items.map((item, index) => (
          <li key={item.libraryId} data-library-id={item.libraryId} onClick={(e) => onRowClick(e, item.libraryId)} className="flex cursor-pointer flex-col gap-1.5 px-3 py-2 even:bg-paper/60">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-ink-soft">
              <span className="tabular-nums">{index + 1}</span>
              <span className="font-mono">{item.libraryId}</span>
              {item.platform ? <span>{item.platform}</span> : null}
              {item.pesto ? <span>{item.pesto}</span> : null}
            </p>
            <EditableHookCell value={rows[item.libraryId]!.hook} canEdit={canEdit} libraryId={item.libraryId} onSave={(next) => saveHook(item.libraryId, next)} />
            <p className="text-xs">{approvedCell(item.libraryId)}</p>
            <div>{nextAction(item.libraryId, 'md')}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

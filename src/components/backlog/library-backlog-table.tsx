import type { LibraryRecord } from '@/domain/records';
import { readableTitle } from '@/domain/display';
import { libraryBacklogStatus, type BacklogReadiness } from '@/domain/library-backlog';
import { OpenPanelLink } from '../panel/open-panel-link';
import { PillarTag } from '../pillar-tag';

function statusTone(status: BacklogReadiness): string {
  if (status.tone === 'good') return 'bg-green-soft text-green';
  if (status.tone === 'blocked') return 'bg-block-soft text-block';
  if (status.tone === 'neutral') return 'bg-paper text-ink-soft';
  return 'bg-attention-soft text-attention';
}

function fallbackStatus(status: string): BacklogReadiness {
  return { label: status, reason: `Review stage: ${status}.`, tone: status === 'Rejected' || status === 'Needs changes' ? 'blocked' : status === 'Approved' ? 'good' : 'attention' };
}

function ReadinessExplanation({ status }: { status: BacklogReadiness }) {
  return <details name="backlog-readiness" className="group text-left text-xs">
    <summary aria-label={`${status.label}: show reason`} className={`inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-full px-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden ${statusTone(status)}`}>
      {status.label}<span aria-hidden="true" className="group-open:rotate-180">⌄</span>
    </summary>
    <p className="max-w-64 whitespace-normal break-words py-2 text-xs font-normal leading-relaxed text-ink">{status.reason}</p>
  </details>;
}

/** Bounded rows, keeping the page light even when the Sheet holds thousands of posts. */
export function LibraryBacklogTable({ rows, statuses = {}, compact = true, showHooks = true }: { rows: Pick<LibraryRecord, 'row' | 'value'>[]; statuses?: Record<string, BacklogReadiness>; compact?: boolean; showHooks?: boolean }) {
  const cell = compact ? 'px-2 py-2' : 'px-3 py-4';
  return (
    <div role="region" aria-label="Content Library posts" tabIndex={0} className="overflow-x-auto rounded-lg border border-line bg-card">
      <table className={`hidden w-full table-fixed border-collapse text-left text-sm md:table ${showHooks ? 'min-w-[68rem]' : 'min-w-[52rem]'}`}>
        <colgroup>
          <col className="w-9" /><col className="w-32" /><col className="w-[4.5rem]" />
          <col className="w-24" />{showHooks ? <><col className="w-36" /><col className="w-36" /></> : null}
          <col /><col className="w-36" /><col className="w-20" />
        </colgroup>
        <thead className="sticky top-0 bg-paper text-xs text-ink-soft">
          <tr className="border-b border-line">
            {['#', 'Content Source', 'Platform', 'PESTO', ...(showHooks ? ['Hook Template', 'Hook Alternatives'] : []), 'Content', 'Status', ''].map((label) =>
              <th key={label} scope="col" className={`${cell} font-medium ${label === '' ? 'sticky right-0 z-10 bg-paper' : label === 'Status' ? 'sticky right-20 z-10 bg-paper' : ''}`}>{label}</th>,
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((record) => {
            const item = record.value;
            const status = statuses[item.libraryId] ?? fallbackStatus(libraryBacklogStatus(record));
            const title = item.currentHook || readableTitle(item.slug) || item.libraryId;
            return (
              <tr key={item.libraryId} data-backlog-id={item.libraryId} className="border-b border-line align-top last:border-0 hover:bg-paper">
                <td className={`${cell} tabular-nums text-ink-soft`}>{record.row}</td>
                <td className={`max-w-48 ${cell} font-medium`}>{item.contentSource || 'Uncategorised'}</td>
                <td className={cell}>{item.targetPlatform.ok ? item.targetPlatform.value : '—'}</td>
                <td className={cell}><PillarTag value={item.pesto} /></td>
                {showHooks ? <><td className={`max-w-44 ${cell} break-words`}>{item.hookTemplate || '—'}</td>
                <td className={`max-w-48 ${cell} whitespace-pre-line break-words text-ink-soft`}>{item.hookAlternatives || '—'}</td></> : null}
                <td className={`min-w-64 max-w-md ${cell}`}>
                  <p className="line-clamp-3 whitespace-pre-line break-words text-ink">
                    {item.draftContent || 'Open to read and edit the source post.'}
                  </p>
                </td>
                <td className={`sticky right-20 z-10 border-l border-line bg-card ${cell}`}><ReadinessExplanation status={status} /></td>
                <td className={`sticky right-0 z-10 border-l border-line bg-card ${cell}`}><OpenPanelLink target={{ post: item.libraryId }} label={`Edit ${title}`} className="inline-flex min-h-11 items-center whitespace-nowrap font-semibold text-primary underline underline-offset-2">Edit post</OpenPanelLink></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">
        {rows.map((record) => {
          const item = record.value;
          const title = item.currentHook || readableTitle(item.slug) || item.libraryId;
          const status = statuses[item.libraryId] ?? fallbackStatus(libraryBacklogStatus(record));
          return <li key={item.libraryId} data-backlog-id={item.libraryId} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2 text-xs"><span className="font-semibold text-ink-soft">{item.contentSource || 'Uncategorised'}</span><ReadinessExplanation status={status} /></div>
            <p className="text-base font-semibold">{title}</p>
            <p className="line-clamp-3 whitespace-pre-line text-sm text-ink-soft">{item.draftContent || 'Open to read and edit the source post.'}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft"><span>{item.targetPlatform.ok ? item.targetPlatform.value : '—'}</span><PillarTag value={item.pesto} /><span>Hook template: {item.hookTemplate || '—'}</span></div>
            {item.hookAlternatives ? <p className="line-clamp-2 whitespace-pre-line text-xs text-ink-soft">Alternatives: {item.hookAlternatives}</p> : null}
            <OpenPanelLink target={{ post: item.libraryId }} label={`Edit ${title}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-2">Edit post</OpenPanelLink>
          </li>;
        })}
      </ul>
    </div>
  );
}

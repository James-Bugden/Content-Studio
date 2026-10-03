import { Fragment } from 'react';
import type { LibraryRecord } from '@/domain/records';
import { readableTitle } from '@/domain/display';
import { groupBacklogRows, libraryBacklogStatus, type BacklogDirection, type BacklogGroup, type BacklogReadiness, type BacklogSort } from '@/domain/library-backlog';
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

type Row = Pick<LibraryRecord, 'row' | 'value'>;
type Column = { label: string; sort?: BacklogSort; className?: string };

/** Group heading text. The whole-result total is primary; the page count is named so it is not misread as the total. */
function GroupCount({ label, shown, total }: { label: string; shown: number; total?: number }) {
  const whole = total ?? shown;
  return <><span className="font-semibold text-ink">{label}</span> <span className="text-ink-soft">· {whole} {whole === 1 ? 'post' : 'posts'}{whole !== shown ? ` (${shown} on this page)` : ''}</span></>;
}

/** Bounded rows, keeping the page light even when the Sheet holds thousands of posts. */
export function LibraryBacklogTable({ rows, statuses = {}, compact = true, showHooks = true, sort = 'sheet', dir = 'asc', group, groupTotals = {}, onSort }: {
  rows: Row[]; statuses?: Record<string, BacklogReadiness>; compact?: boolean; showHooks?: boolean;
  sort?: BacklogSort; dir?: BacklogDirection; group?: BacklogGroup; groupTotals?: Record<string, number>;
  /** Header click; the caller sorts the whole inventory server-side (CS-043). */
  onSort?: (key: BacklogSort) => void;
}) {
  const cell = compact ? 'px-2 py-2' : 'px-3 py-4';
  const columns: Column[] = [
    { label: '#', sort: 'sheet' }, { label: 'Content Source', sort: 'source' }, { label: 'Platform', sort: 'platform' }, { label: 'PESTO', sort: 'pesto' },
    ...(showHooks ? [{ label: 'Hook Template', sort: 'hookTemplate' as const }, { label: 'Hook Alternatives' }] : []),
    { label: 'Content' }, { label: 'Status', sort: 'status', className: 'sticky right-20 z-10 bg-paper' }, { label: '', className: 'sticky right-0 z-10 bg-paper' },
  ];
  const groups = groupBacklogRows(rows, group, (r) => statuses[r.value.libraryId]?.label);
  const statusOf = (record: Row) => statuses[record.value.libraryId] ?? fallbackStatus(libraryBacklogStatus(record));
  return (
    <div role="region" aria-label="Content Library posts" tabIndex={0} className="overflow-x-auto rounded-lg border border-line bg-card">
      <table className={`hidden w-full table-fixed border-collapse text-left text-sm md:table ${showHooks ? 'min-w-[68rem]' : 'min-w-[52rem]'}`}>
        <colgroup>
          <col className="w-12" /><col className="w-36" /><col className="w-24" />
          <col className="w-24" />{showHooks ? <><col className="w-36" /><col className="w-36" /></> : null}
          <col /><col className="w-36" /><col className="w-20" />
        </colgroup>
        <thead className="sticky top-0 bg-paper text-xs text-ink-soft">
          <tr className="border-b border-line">
            {columns.map((column) => {
              const active = column.sort !== undefined && column.sort === sort;
              const sortKey = column.sort;
              return <th key={column.label} scope="col" aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : undefined} className={`${cell} font-medium whitespace-nowrap ${column.className ?? ''}`}>
                {sortKey && onSort ? <button type="button" onClick={() => onSort(sortKey)} title={`Sort by ${column.label === '#' ? 'Sheet order' : column.label}`}
                  className={`inline-flex min-h-8 items-center gap-1 rounded text-left font-medium hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${active ? 'text-ink' : ''}`}>
                  {column.label}<span aria-hidden="true" className={active ? '' : 'opacity-30'}>{active && dir === 'desc' ? '↓' : '↑'}</span>
                </button> : column.label}
              </th>;
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map((run) => <Fragment key={`group-${run.key}`}>
            {group ? <tr data-backlog-group={run.key} className="border-b border-line bg-paper">
              <th scope="colgroup" colSpan={columns.length} className={`${cell} text-left text-sm font-normal`}><GroupCount label={run.label} shown={run.rows.length} total={groupTotals[run.key]} /></th>
            </tr> : null}
            {run.rows.map((record) => {
              const item = record.value;
              const status = statusOf(record);
              const title = readableTitle(item.slug) || item.currentHook || item.libraryId;
              return (
                <tr key={item.libraryId} data-backlog-id={item.libraryId} className="border-b border-line align-top last:border-0 hover:bg-paper">
                  <td className={`${cell} tabular-nums text-ink-soft`}>{record.row}</td>
                  <td className={`max-w-48 ${cell} font-medium`}><span title={item.contentSource || 'Uncategorised'} className="block truncate">{item.contentSource || 'Uncategorised'}</span></td>
                  <td className={cell}>{item.targetPlatform.ok ? item.targetPlatform.value : '—'}</td>
                  <td className={cell}><PillarTag value={item.pesto} /></td>
                  {showHooks ? <><td className={`max-w-44 ${cell} break-words`}>{item.hookTemplate || '—'}</td>
                  <td className={`max-w-48 ${cell} whitespace-pre-line break-words text-ink-soft`}>{item.hookAlternatives || '—'}</td></> : null}
                  <td className={`min-w-64 max-w-md ${cell}`}>
                    <p className="line-clamp-2 break-words font-semibold text-ink">{title}</p>
                    <p className="mt-1 line-clamp-2 whitespace-pre-line break-words text-ink-soft">
                      {item.draftContent || 'Open to read and edit the source post.'}
                    </p>
                  </td>
                  <td className={`sticky right-20 z-10 border-l border-line bg-card ${cell}`}><ReadinessExplanation status={status} /></td>
                  <td className={`sticky right-0 z-10 border-l border-line bg-card ${cell}`}><OpenPanelLink target={{ post: item.libraryId }} label={`Edit ${title}`} className="inline-flex min-h-11 items-center whitespace-nowrap font-semibold text-primary underline underline-offset-2">Edit post</OpenPanelLink></td>
                </tr>
              );
            })}
          </Fragment>)}
        </tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">
        {groups.map((run) => <Fragment key={`group-${run.key}`}>
          {group ? <li data-backlog-group={run.key} className="bg-paper px-4 py-2 text-sm"><GroupCount label={run.label} shown={run.rows.length} total={groupTotals[run.key]} /></li> : null}
          {run.rows.map((record) => {
            const item = record.value;
            const title = readableTitle(item.slug) || item.currentHook || item.libraryId;
            const status = statusOf(record);
            return <li key={item.libraryId} data-backlog-id={item.libraryId} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2 text-xs"><span className="font-semibold text-ink-soft">{item.contentSource || 'Uncategorised'}</span><ReadinessExplanation status={status} /></div>
              <p className="text-base font-semibold">{title}</p>
              <p className="line-clamp-3 whitespace-pre-line text-sm text-ink-soft">{item.draftContent || 'Open to read and edit the source post.'}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft"><span>{item.targetPlatform.ok ? item.targetPlatform.value : '—'}</span><PillarTag value={item.pesto} /><span>Hook template: {item.hookTemplate || '—'}</span></div>
              {item.hookAlternatives ? <p className="line-clamp-2 whitespace-pre-line text-xs text-ink-soft">Alternatives: {item.hookAlternatives}</p> : null}
              <OpenPanelLink target={{ post: item.libraryId }} label={`Edit ${title}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-2">Edit post</OpenPanelLink>
            </li>;
          })}
        </Fragment>)}
      </ul>
    </div>
  );
}

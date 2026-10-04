import { Fragment } from 'react';
import type { LibraryRecord } from '@/domain/records';
import { readableTitle } from '@/domain/display';
import { groupBacklogRows, libraryBacklogStatus, type BacklogDirection, type BacklogGroup, type BacklogReadiness, type BacklogSort } from '@/domain/library-backlog';
import { parseHookAlternatives } from '@/domain/hook-alternatives';
import { OpenPanelLink } from '../panel/open-panel-link';
import { PillarTag } from '../pillar-tag';
import { LibraryPestoField } from './library-pesto-field';

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

type Row = Pick<LibraryRecord, 'row' | 'value'> & { revision?: string };

/**
 * Post copy in a row (CS-054): the opening lines, then "Show full post" to read
 * the rest in place, so long posts are never silently cut off. A native
 * <details> keeps it keyboard operable without extra ARIA.
 */
function PostContent({ text }: { text: string }) {
  if (!text.trim()) return <p className="mt-1 text-ink-soft">Open to read and edit the source post.</p>;
  const long = text.length > 280 || text.split('\n').length > 5;
  if (!long) return <p className="mt-1 whitespace-pre-line break-words text-ink-soft">{text}</p>;
  return <details className="group mt-1">
    <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
      <span className="line-clamp-5 whitespace-pre-line break-words text-ink-soft group-open:hidden">{text}</span>
      <span className="inline-flex min-h-9 items-center text-xs font-medium text-primary underline underline-offset-2"><span className="group-open:hidden">Show full post</span><span className="hidden group-open:inline">Show less</span></span>
    </summary>
    <p className="whitespace-pre-line break-words text-ink-soft">{text}</p>
  </details>;
}

/**
 * Hook Alternatives as a short list (CS-054): score and template on one muted
 * line, the hook itself clamped to two lines. The full text stays in the title
 * tooltip and in the post editor, so the row height stays close to its neighbours.
 */
function HookAlternativesList({ raw }: { raw: string }) {
  const items = parseHookAlternatives(raw);
  if (items.length === 0) return <span className="text-ink-soft">—</span>;
  return <ol className="flex flex-col gap-2">
    {items.map((alt, i) => <li key={i} title={[alt.score, alt.template, alt.hook].filter(Boolean).join(' · ')} className="min-w-0">
      {alt.score || alt.template ? <p className="flex min-w-0 items-baseline gap-1.5 text-xs text-ink-soft">
        {alt.score ? <span className="shrink-0 font-semibold tabular-nums text-ink">{alt.score}</span> : null}
        {alt.template ? <span className="truncate">{alt.template}</span> : null}
      </p> : null}
      <p className="line-clamp-2 break-words text-ink">{alt.hook}</p>
    </li>)}
  </ol>;
}
type Column = { label: string; sort?: BacklogSort; className?: string };

/** Group heading text. The whole-result total is primary; the page count is named so it is not misread as the total. */
function GroupCount({ label, shown, total }: { label: string; shown: number; total?: number }) {
  const whole = total ?? shown;
  return <><span className="font-semibold text-ink">{label}</span> <span className="text-ink-soft">· {whole} {whole === 1 ? 'post' : 'posts'}{whole !== shown ? ` (${shown} on this page)` : ''}</span></>;
}

/** Bounded rows, keeping the page light even when the Sheet holds thousands of posts. */
export function LibraryBacklogTable({ rows, statuses = {}, compact = true, showHooks = true, sort = 'sheet', dir = 'asc', group, groupTotals = {}, onSort, canEdit = false, pestoOptions = [] }: {
  rows: Row[]; statuses?: Record<string, BacklogReadiness>; compact?: boolean; showHooks?: boolean;
  /** Owner edits PESTO in place (CS-054); needs each row's revision. */
  canEdit?: boolean; pestoOptions?: readonly string[];
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
      {/* CS-054 widths: # fits four digits, Source and Hook Template read without
          clipping, and Hook Alternatives gets room for its formatted list. */}
      <table className={`hidden w-full table-fixed border-collapse text-left text-sm md:table ${showHooks ? 'min-w-[96rem]' : 'min-w-[68rem]'}`}>
        <colgroup>
          <col className="w-16" /><col className="w-40" /><col className="w-24" />
          <col className="w-32" />{showHooks ? <><col className="w-44" /><col className="w-72" /></> : null}
          {/* Content takes whatever is left; the table's minimum keeps it at least ~24rem. */}
          <col /><col className="w-36" /><col className="w-24" />
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
                  <td className={`${cell} font-medium`}><span title={item.contentSource || 'Uncategorised'} className="line-clamp-2 break-words">{item.contentSource || 'Uncategorised'}</span></td>
                  <td className={cell}>{item.targetPlatform.ok ? item.targetPlatform.value : '—'}</td>
                  <td className={cell}>{canEdit && record.revision
                    ? <LibraryPestoField libraryId={item.libraryId} value={item.pesto} revision={record.revision} canEdit suggestions={pestoOptions} />
                    : <PillarTag value={item.pesto} />}</td>
                  {showHooks ? <><td className={cell}><span title={item.hookTemplate || undefined} className="line-clamp-3 break-words">{item.hookTemplate || '—'}</span></td>
                  <td className={cell}><HookAlternativesList raw={item.hookAlternatives} /></td></> : null}
                  <td className={cell}>
                    <p className="line-clamp-2 break-words font-semibold text-ink">{title}</p>
                    <PostContent text={item.draftContent} />
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
              <div className="text-sm"><PostContent text={item.draftContent} /></div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft"><span>{item.targetPlatform.ok ? item.targetPlatform.value : '—'}</span>
                {canEdit && record.revision ? <LibraryPestoField libraryId={item.libraryId} value={item.pesto} revision={record.revision} canEdit suggestions={pestoOptions} /> : <PillarTag value={item.pesto} />}
                <span>Hook template: {item.hookTemplate || '—'}</span></div>
              {showHooks && item.hookAlternatives ? <details className="text-xs"><summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-ink-soft">Hook alternatives ({parseHookAlternatives(item.hookAlternatives).length})</summary><div className="pt-1 text-sm"><HookAlternativesList raw={item.hookAlternatives} /></div></details> : null}
              <OpenPanelLink target={{ post: item.libraryId }} label={`Edit ${title}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-2">Edit post</OpenPanelLink>
            </li>;
          })}
        </Fragment>)}
      </ul>
    </div>
  );
}

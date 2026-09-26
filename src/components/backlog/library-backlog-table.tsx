import type { LibraryRecord } from '@/domain/records';
import { readableTitle } from '@/domain/display';
import { libraryBacklogStatus } from '@/domain/library-backlog';
import { OpenPanelLink } from '../panel/open-panel-link';
import { PillarTag } from '../pillar-tag';

/** Bounded rows, keeping the page light even when the Sheet holds thousands of posts. */
export function LibraryBacklogTable({ rows }: { rows: LibraryRecord[] }) {
  return (
    <div role="region" aria-label="Content Library posts" tabIndex={0} className="overflow-x-auto rounded-lg border border-line bg-card">
      <table className="hidden w-full min-w-[78rem] table-fixed border-collapse text-left text-sm md:table">
        <colgroup>
          <col className="w-12" /><col className="w-40" /><col className="w-24" />
          <col className="w-28" /><col className="w-44" /><col className="w-44" />
          <col /><col className="w-40" /><col className="w-24" />
        </colgroup>
        <thead className="sticky top-0 bg-paper text-xs text-ink-soft">
          <tr className="border-b border-line">
            {['#', 'Content Source', 'Platform', 'PESTO', 'Hook Template', 'Hook Alternatives', 'Content', 'Status', ''].map((label) =>
              <th key={label} scope="col" className={`px-3 py-2 font-medium ${label === '' ? 'sticky right-0 bg-paper' : ''}`}>{label}</th>,
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((record) => {
            const item = record.value;
            const status = libraryBacklogStatus(record);
            const title = item.currentHook || readableTitle(item.slug) || item.libraryId;
            return (
              <tr key={item.libraryId} data-backlog-id={item.libraryId} className="border-b border-line align-top last:border-0 hover:bg-paper">
                <td className="px-3 py-3 tabular-nums text-ink-soft">{record.row}</td>
                <td className="max-w-48 px-3 py-3 font-medium">{item.contentSource || 'Uncategorised'}</td>
                <td className="px-3 py-3">{item.targetPlatform.ok ? item.targetPlatform.value : '—'}</td>
                <td className="px-3 py-3"><PillarTag value={item.pesto} /></td>
                <td className="max-w-44 px-3 py-3 break-words">{item.hookTemplate || '—'}</td>
                <td className="max-w-48 px-3 py-3 whitespace-pre-line break-words text-ink-soft">{item.hookAlternatives || '—'}</td>
                <td className="min-w-64 max-w-md px-3 py-3">
                  <p className="line-clamp-3 whitespace-pre-line break-words text-ink">
                    {item.draftContent || 'Open to read and edit the source post.'}
                  </p>
                </td>
                <td className="whitespace-nowrap px-3 py-3"><span className={
                  `rounded-full px-2 py-1 text-xs font-semibold ${status === 'Rejected' || status === 'Needs changes' ? 'bg-block-soft text-block' : status === 'Approved' || status === 'Queued for scheduling' ? 'bg-green-soft text-green' : status === 'Drafting' || status === 'Needs review' ? 'bg-attention-soft text-attention' : 'bg-paper text-ink-soft'}`
                }>{status}</span></td>
                <td className="sticky right-0 border-l border-line bg-card px-3 py-3"><OpenPanelLink target={{ post: item.libraryId }} label={`Edit ${title}`} className="inline-flex min-h-11 items-center whitespace-nowrap font-semibold text-primary underline underline-offset-2">Edit post</OpenPanelLink></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">
        {rows.map((record) => {
          const item = record.value;
          const title = item.currentHook || readableTitle(item.slug) || item.libraryId;
          return <li key={item.libraryId} data-backlog-id={item.libraryId} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2 text-xs"><span className="font-semibold text-ink-soft">{item.contentSource || 'Uncategorised'}</span><span className="shrink-0 rounded-full bg-paper px-2 py-1">{libraryBacklogStatus(record)}</span></div>
            <p className="text-base font-semibold">{title}</p>
            <p className="line-clamp-3 whitespace-pre-line text-sm text-ink-soft">{item.draftContent || 'Open to read and edit the source post.'}</p>
            <p className="text-xs text-ink-soft">{item.targetPlatform.ok ? item.targetPlatform.value : '—'} · Hook template: {item.hookTemplate || '—'}</p>
            {item.hookAlternatives ? <p className="line-clamp-2 whitespace-pre-line text-xs text-ink-soft">Alternatives: {item.hookAlternatives}</p> : null}
            <OpenPanelLink target={{ post: item.libraryId }} label={`Edit ${title}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-2">Edit post</OpenPanelLink>
          </li>;
        })}
      </ul>
    </div>
  );
}

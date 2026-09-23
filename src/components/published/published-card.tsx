import { METRIC_UNAVAILABLE, formatTaipei, type PublishedRowView, type SyncFreshness } from '@/domain/typefully-view';
import { GuardedLink } from '../guarded-link';
import { SourceLink } from '../source-link';
import { PublishedActions } from './published-actions';

/**
 * One published Schedule row (CS-016 PUB-01/02/04). Exact Final Content,
 * pre-wrapped and untouched; one platform per card, so X and Threads are never
 * combined. A blank metric reads "Not available from Typefully"; zero reads 0.
 * Sheet-side disagreements are listed for reconciliation, never corrected here.
 */
function syncWords(label: string, s: SyncFreshness): string {
  if (s.state === 'never') return `${label}: never synced`;
  if (s.state === 'unreadable') return `${label}: recorded time is not readable`;
  const at = s.at ? (formatTaipei(s.at) ?? s.at) : '';
  return s.state === 'stale' ? `${label}: ${at} Taipei, stale (over 48 hours ago)` : `${label}: ${at} Taipei`;
}

export function PublishedCard({ row, canEdit, detailLink = true }: { row: PublishedRowView; canEdit: boolean; detailLink?: boolean }) {
  const stale = row.finalSync.state !== 'fresh' || row.analyticsSync.state !== 'fresh';
  return (
    <article aria-label={`${row.platformRaw || 'Unknown platform'} ${row.contentId}`} className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4" data-platform={row.platformRaw}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mono text-sm font-semibold">{row.contentId}</h3>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-sm font-semibold">
          <span aria-hidden="true">{row.typefullyStatus === 'Published' ? '●' : '◐'}</span>
          {row.typefullyStatus}
        </span>
      </header>
      <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="font-medium text-ink-soft">Platform</dt>
        <dd>{row.platformRaw || 'Blank'}</dd>
        <dt className="font-medium text-ink-soft">Parent</dt>
        <dd className="font-mono">{row.parentContentId || 'None'}</dd>
        <dt className="font-medium text-ink-soft">Published</dt>
        <dd>{row.publishedAtTaipei ? `${row.publishedAtTaipei} Taipei` : row.publishedAt || 'Not recorded'}</dd>
        <dt className="font-medium text-ink-soft">Post link</dt>
        <dd className="min-w-0 break-all">{row.postLink ? <SourceLink href={row.postLink} label="Open the post" /> : 'Not recorded'}</dd>
        <dt className="font-medium text-ink-soft">Visual version</dt>
        <dd>{row.visualVersion || 'None recorded'}</dd>
      </dl>
      <ul className="text-sm" aria-label="Sync freshness">
        <li>
          {row.finalSync.state === 'fresh' ? '✓ ' : '! '}
          {syncWords('Final copy synced', row.finalSync)}
        </li>
        <li>
          {row.analyticsSync.state === 'fresh' ? '✓ ' : '! '}
          {syncWords('Analytics synced', row.analyticsSync)}
        </li>
      </ul>
      {stale ? <p className="text-xs text-ink-soft">Values shown may be out of date until the next sync.</p> : null}
      <section aria-label="Final Content" className="rounded-md border border-line">
        <h4 className="border-b border-line bg-paper px-3 py-2 text-sm font-semibold">Final Content</h4>
        <div className="copy px-3 py-2 text-sm">{row.finalContent === '' ? <span className="text-ink-soft">Empty</span> : row.finalContent}</div>
      </section>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[16rem] text-left text-sm">
          <caption className="sr-only">Metrics for {row.contentId}</caption>
          <tbody>
            {row.metrics.map((m) => (
              <tr key={m.key} className="border-t border-line" data-metric={m.key}>
                <th scope="row" className="py-1 pr-3 font-medium">
                  {m.label}
                </th>
                <td className={`py-1 tabular-nums ${m.value === null ? 'text-ink-soft' : ''}`}>{m.value === null ? METRIC_UNAVAILABLE : m.value.toLocaleString('en-GB')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {row.problems.length > 0 ? (
        <div role="note" className="rounded-md border border-warn border-l-4 bg-warn-soft px-3 py-2 text-sm">
          <p className="font-semibold">⇄ Needs reconciliation. Nothing was corrected automatically.</p>
          <ul className="mt-1 list-disc pl-5">
            {row.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? <PublishedActions contentId={row.contentId} revision={row.revision} linked={row.draftId !== ''} /> : null}
        {detailLink ? (
          <GuardedLink href={`/published/${encodeURIComponent(row.contentId)}`} className="text-sm underline" aria-label={`Published details for ${row.contentId}`}>
            Details
          </GuardedLink>
        ) : null}
        <GuardedLink href={`/schedule/${encodeURIComponent(row.contentId)}`} className="text-sm underline" aria-label={`Typefully panel for ${row.contentId}`}>
          Typefully panel
        </GuardedLink>
      </div>
    </article>
  );
}

import { InlineResult } from '../inline-result';

/** Display metadata from the same bounded snapshot as the read-only rows. */
export function StaleBacklogBanner({ readAt, retryHref }: { readAt: number; retryHref: string }) {
  const asOf = new Date(readAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
  return <div className="mb-4"><InlineResult tone="warning">
    Google Sheet could not be refreshed. Showing the last good read (as of {asOf} Taipei), which may be out of date.
    {' '}Editing and saving are disabled until a fresh read succeeds.
    {' '}<a href={retryHref} className="inline-flex min-h-11 items-center font-semibold underline">Retry</a>
  </InlineResult></div>;
}

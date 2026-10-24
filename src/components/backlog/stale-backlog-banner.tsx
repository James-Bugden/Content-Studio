'use client';

import { useLayoutEffect } from 'react';
import { InlineResult } from '../inline-result';
import { useBacklogNavigation } from './backlog-navigation';

/** Keep URL-opened panels blocked as well as the visible list controls. */
export function StaleBacklogBanner() {
  const { setReadOnly } = useBacklogNavigation();
  useLayoutEffect(() => {
    setReadOnly(true);
    return () => setReadOnly(false);
  }, [setReadOnly]);
  return <div className="mb-4"><InlineResult tone="warning">
    Google Sheet could not be refreshed. Showing the last good read, which may be out of date.
    {' '}Editing and saving are disabled until a fresh read succeeds.
    {' '}<a href="/backlog" className="inline-flex min-h-11 items-center font-semibold underline">Retry</a>
  </InlineResult></div>;
}

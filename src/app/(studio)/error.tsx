'use client';

import { ErrorState, ERROR_TITLES } from '@/components/state-view';
import { PageHeader } from '@/components/page-header';
import { buttonClass } from '@/components/button-styles';

/** Last resort for an unexpected route failure; never display provider payloads. */
export default function StudioError({ retry }: { retry: () => void }) {
  return <><PageHeader title={ERROR_TITLES.UNKNOWN} /><ErrorState code="UNKNOWN" action={<button type="button" className={buttonClass()} onClick={retry}>Try again</button>} /></>;
}

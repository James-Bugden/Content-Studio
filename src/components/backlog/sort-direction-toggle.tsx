'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { buttonClass } from '../button-styles';
import { useLeaveConfirmation } from '../leave-confirm';

/**
 * Ascending/descending as one small toggle beside Sort (CS-050), replacing the
 * separate Direction select so the Backlog toolbar fits on one row. Same URL
 * contract as before (`dir=desc`, absent = ascending), the same reset to page 1,
 * and the same dirty-editor guard as the filter selects.
 */
export function SortDirectionToggle() {
  const router = useRouter();
  const pathname = usePathname() ?? '/backlog';
  const searchParams = useSearchParams();
  const { guard, dialog } = useLeaveConfirmation();
  const descending = searchParams?.get('dir') === 'desc';

  function flip() {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (descending) params.delete('dir');
    else params.set('dir', 'desc');
    params.delete('page');
    const query = params.toString();
    guard(() => router.push(`${pathname}${query ? `?${query}` : ''}`, { scroll: false }));
  }

  return (
    <>
      <button
        type="button"
        onClick={flip}
        aria-label={`Order: ${descending ? 'descending' : 'ascending'}. Switch to ${descending ? 'ascending' : 'descending'}.`}
        title={descending ? 'Descending (Z to A, newest row first). Click for ascending.' : 'Ascending (A to Z). Click for descending.'}
        className={`${buttonClass('secondary', 'sm')} max-md:min-h-11`}
      >
        <span aria-hidden="true">{descending ? '↓ Desc' : '↑ Asc'}</span>
      </button>
      {dialog}
    </>
  );
}

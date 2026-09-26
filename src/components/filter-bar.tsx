'use client';

import { useId } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLeaveConfirmation } from './leave-confirm';
import { buttonClass } from './button-styles';

/**
 * URL-addressable filters (CS-006, SEC-10, UX-04).
 *
 * The URL only ever carries enum values or IDs taken from the option lists the
 * page supplies. A value that is not in the list, whether typed into the address
 * bar or produced by a stale link, is ignored on read and dropped on the next
 * write, so free text (and therefore post copy) can never reach the URL through
 * this control. Changing a filter while an editor is dirty asks first.
 */
export type FilterOption = { value: string; label: string };
export type FilterDef = { key: string; label: string; options: FilterOption[]; allLabel?: string };

/** Only values present in the option list survive. */
export function sanitiseFilterValue(filter: FilterDef, value: string | null): string {
  if (value === null) return '';
  return filter.options.some((o) => o.value === value) ? value : '';
}

/** Builds the next query string, keeping unrelated params and dropping invalid filter values. */
export function nextFilterQuery(filters: FilterDef[], current: URLSearchParams, change: { key: string; value: string } | 'clear'): string {
  const params = new URLSearchParams(current.toString());
  for (const filter of filters) {
    const incoming = change !== 'clear' && change.key === filter.key ? change.value : change === 'clear' ? null : params.get(filter.key);
    const clean = sanitiseFilterValue(filter, incoming);
    params.delete(filter.key);
    if (clean) params.set(filter.key, clean);
  }
  params.delete('page');
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function FilterBar({ filters }: { filters: FilterDef[] }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const current = new URLSearchParams(searchParams?.toString() ?? '');
  const { guard, dialog } = useLeaveConfirmation();
  const baseId = useId();

  const active = filters.filter((f) => sanitiseFilterValue(f, current.get(f.key)) !== '');

  const go = (change: { key: string; value: string } | 'clear') => {
    const url = `${pathname}${nextFilterQuery(filters, current, change)}`;
    guard(() => router.push(url, { scroll: false }));
  };

  return (
    <div role="group" aria-label="Filters" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-card p-3">
      {filters.map((filter) => {
        const id = `${baseId}-${filter.key}`;
        return (
          <div key={filter.key} className="flex min-w-0 flex-[1_1_10rem] flex-col gap-1">
            <label htmlFor={id} className="text-sm font-medium">
              {filter.label}
            </label>
            <select
              id={id}
              value={sanitiseFilterValue(filter, current.get(filter.key))}
              onChange={(event) => go({ key: filter.key, value: event.target.value })}
              className="min-h-11 w-full min-w-0 rounded-md border border-line bg-card px-2 text-sm"
            >
              <option value="">{filter.allLabel ?? 'All'}</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      <button type="button" className={buttonClass('secondary')} onClick={() => go('clear')} disabled={active.length === 0}>
        Clear filters
      </button>
      <p className="sr-only" aria-live="polite">
        {active.length === 0 ? 'No filters applied' : `${active.length} ${active.length === 1 ? 'filter' : 'filters'} applied`}
      </p>
      {dialog}
    </div>
  );
}

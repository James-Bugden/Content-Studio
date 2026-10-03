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

/**
 * `toolbar` (CS-046) lays the same controls out as one compact Linear-style row
 * of "Label value" chips instead of a boxed grid of full-width selects. Labels
 * stay real <label> elements, and controls keep a 44px touch height on phones.
 */
export function FilterBar({ filters, variant = 'panel', trailing }: { filters: FilterDef[]; variant?: 'panel' | 'toolbar'; /** Extra controls placed after the selects, e.g. a sort-direction toggle. */ trailing?: React.ReactNode }) {
  const toolbar = variant === 'toolbar';
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
    <div
      role="group"
      aria-label="Filters"
      className={toolbar ? 'mb-3 flex flex-wrap items-center gap-2' : 'mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-card p-3'}
    >
      {filters.map((filter) => {
        const id = `${baseId}-${filter.key}`;
        return (
          <div
            key={filter.key}
            className={
              toolbar
                ? `inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md border bg-card pl-2.5 text-sm md:min-h-9 ${
                    sanitiseFilterValue(filter, current.get(filter.key)) ? 'border-ink/40' : 'border-line'
                  }`
                : 'flex min-w-0 flex-[1_1_10rem] flex-col gap-1'
            }
          >
            <label htmlFor={id} className={toolbar ? 'whitespace-nowrap text-ink-soft' : 'text-sm font-medium'}>
              {filter.label}
            </label>
            <select
              id={id}
              value={sanitiseFilterValue(filter, current.get(filter.key))}
              onChange={(event) => go({ key: filter.key, value: event.target.value })}
              className={
                toolbar
                  ? 'field-sizing-content min-h-11 max-w-40 min-w-0 cursor-pointer truncate rounded-md bg-transparent pr-1 font-medium text-ink md:min-h-9'
                  : 'min-h-11 w-full min-w-0 rounded-md border border-line bg-card px-2 text-sm'
              }
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
      {trailing}
      {toolbar && active.length === 0 ? null : (
        <button type="button" className={toolbar ? `${buttonClass('secondary', 'sm')} max-md:min-h-11` : buttonClass('secondary')} onClick={() => go('clear')} disabled={active.length === 0}>
          Clear filters
        </button>
      )}
      <p className="sr-only" aria-live="polite">
        {active.length === 0 ? 'No filters applied' : `${active.length} ${active.length === 1 ? 'filter' : 'filters'} applied`}
      </p>
      {dialog}
    </div>
  );
}

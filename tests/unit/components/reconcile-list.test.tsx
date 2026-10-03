// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/reconcile',
  useSearchParams: () => new URLSearchParams(),
}));

import { groupByKind, ReconcileList, type ReconcileItemView } from '@/components/reconcile/reconcile-list';

afterEach(cleanup);

const item = (id: string, kind: string, severity: 'blocking' | 'attention'): ReconcileItemView => ({
  id, kind, severity, title: `${id} title`, facts: ['A synthetic fact.'], stableIds: [id], action: { label: 'Review', href: `/review/${id}` },
});

describe('Fix issues grouping (CS-048)', () => {
  it('groups by kind, keeps report order within a group, and lists blocking groups first', () => {
    const groups = groupByKind([
      item('A', 'markdown_missing', 'attention'),
      item('B', 'stale_approval', 'blocking'),
      item('C', 'markdown_missing', 'attention'),
    ]);
    expect(groups.map((g) => [g.kind, g.blocking, g.items.map((i) => i.id)])).toEqual([
      ['stale_approval', true, ['B']],
      ['markdown_missing', false, ['A', 'C']],
    ]);
  });

  it('shows one plain-words heading per kind with its count, and folds long attention groups', () => {
    const many = ['A', 'B', 'C', 'D'].map((id) => item(id, 'markdown_missing', 'attention'));
    const { container } = render(<ReconcileList items={[item('X', 'stale_approval', 'blocking'), ...many]} />);
    expect(screen.getByText('Approval out of date')).toBeTruthy();
    expect(screen.getByText('Markdown section missing or duplicated')).toBeTruthy();
    const missing = container.querySelector('details[data-reconcile-kind="markdown_missing"]') as HTMLDetailsElement;
    const blocking = container.querySelector('details[data-reconcile-kind="stale_approval"]') as HTMLDetailsElement;
    expect(missing.open).toBe(false);
    expect(blocking.open).toBe(true);
    expect(missing.textContent).toContain('4 · needs attention');
  });
});

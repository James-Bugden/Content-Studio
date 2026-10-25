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
  it('CS-066: shows the owner waiver beside blocking export failures', () => {
    const { container } = render(<ReconcileList items={[
      { ...item('waiver', 'backup_waived', 'attention'), title: 'Backup gate waived by owner',
        facts: ['Owner decision on 2026-10-25; recorded 2026-10-25T00:00:00Z. Supabase daily plan backups plus Sheet export; no independent archive of history or ledger.'] },
      { ...item('export', 'export_mismatch', 'blocking'), title: 'Sheet export differs; row preserved' },
    ]} />);
    expect(screen.getByRole('heading', { name: 'Backup gate waived by owner' })).toBeTruthy();
    expect(screen.getByText(/Owner decision on 2026-10-25/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sheet export differs; row preserved' })).toBeTruthy();
    expect(container.querySelector('details[data-reconcile-kind="export_mismatch"]')?.hasAttribute('open')).toBe(true);
  });
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


it('keeps the operation ID in a closed support disclosure and the full-page action', () => {
  render(<ReconcileList items={[{ ...item('A', 'partial_mutation', 'blocking'), operationId: 'op_synthetic_support' }]} />);
  const operation = screen.getByText('op_synthetic_support');
  expect(operation.closest('details')?.open).toBe(false);
  expect(screen.getByRole('link', { name: 'Review' }).getAttribute('href')).toBe('/review/A');
});

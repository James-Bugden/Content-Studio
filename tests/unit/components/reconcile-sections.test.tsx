// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/reconcile', useSearchParams: () => new URLSearchParams() }));

import { Section } from '@/components/reconcile/sections';
import { SectionError, SectionSkeleton } from '@/components/reconcile/section-status';
import type { SlowSection } from '@/application/reconcile';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const props = { id: 'drive-check-h', title: 'Drive Markdown vs database', what: 'Drive files', source: 'Drive', clear: 'Drive matches the database' };
const item = { id: 'i1', kind: 'markdown_export_lag' as const, severity: 'attention' as const, title: 'SYN-L001: Drive could not be checked', facts: ['A synthetic fact.'], stableIds: ['SYN-L001'], action: { label: 'Retry' as const, href: '/review/SYN-L001' } };
const section = (over: Partial<SlowSection> = {}): SlowSection => ({ items: [], unreadable: [], failed: 0, checked: 3, ...over });

describe('Fix issues streamed sections (CS #250)', () => {
  it('the skeleton announces one busy status under its own heading', () => {
    render(<SectionSkeleton id="drive-check-h" title="Drive Markdown vs database" what="Drive" />);
    expect(screen.getByRole('heading', { name: 'Drive Markdown vs database' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Checking Drive');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a clean result says so, with the count', async () => {
    render(await Section({ ...props, promise: Promise.resolve(section()) }));
    expect(screen.getByText('Drive matches the database')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Drive Markdown vs database/ }).textContent).toContain('(0)');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a rejected check shows a per-section error with Retry, not an all-clear', async () => {
    render(await Section({ ...props, promise: Promise.reject(new Error('synthetic')) }));
    expect(screen.getByText('Some sources could not be read')).toBeTruthy();
    expect(screen.getByText(/Couldn't check Drive/)).toBeTruthy();
    expect(screen.queryByText('Drive matches the database')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(router.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/reconcile\?fresh=\d+$/));
  });

  it('partial provider failure keeps the findings and adds the error with the failed count', async () => {
    render(await Section({ ...props, promise: Promise.resolve(section({ items: [item], failed: 2, checked: 5 })) }));
    expect(screen.getByText('Some sources could not be read')).toBeTruthy();
    expect(screen.getByText(/Couldn't check Drive/)).toBeTruthy();
    expect(screen.getByText(/2 of 5 Drive files could not be read in time/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'SYN-L001: Drive could not be checked' })).toBeTruthy();
    expect(screen.queryByText('Drive matches the database')).toBeNull();
  });

  it('SectionError names the source, says unknown, and offers a retry', async () => {
    render(<SectionError what="Typefully" />);
    expect(screen.getByText('Some sources could not be read')).toBeTruthy();
    expect(screen.getByText(/Couldn't check Typefully/)).toBeTruthy();
    expect(screen.getByText(/Unknown, not clear/)).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(router.replace).toHaveBeenCalledOnce();
  });
});

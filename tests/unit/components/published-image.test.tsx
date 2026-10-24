// @vitest-environment jsdom
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PublishedCard } from '@/components/published/published-card';
import type { PublishedRowView } from '@/domain/typefully-view';

vi.mock('@/components/guarded-link', () => ({ GuardedLink: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
afterEach(cleanup);

const row: PublishedRowView = {
  contentId: '2026-10-01-MAIN-X', parentContentId: '', platform: 'X', platformRaw: 'X',
  typefullyStatus: 'Published', draftId: '', finalContent: 'Synthetic final copy.',
  visualVersion: '', imageSrc: '/api/schedule/2026-10-01-MAIN-X/asset', imageAlt: 'Synthetic saved image',
  publishedAt: '', publishedAtTaipei: null, postLink: '',
  finalSync: { state: 'never', at: null }, analyticsSync: { state: 'never', at: null },
  metrics: [], problems: [], revision: 'synthetic-revision',
};

it('renders no image or transfer actions in Published list cards', () => {
  render(<PublishedCard row={row} canEdit={false} />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByRole('group', { name: 'Image actions' })).toBeNull();
  expect(screen.getByRole('link', { name: `Published details for ${row.contentId}` })).toBeTruthy();
});

it('keeps the Schedule image and one action group on the existing detail page', () => {
  render(<PublishedCard row={row} canEdit={false} detailLink={false} />);
  expect(screen.getByRole('img').getAttribute('src')).toBe(row.imageSrc);
  expect(screen.getAllByRole('group', { name: 'Image actions' })).toHaveLength(1);
});

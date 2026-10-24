// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import Home from '@/app/(studio)/loading';
import Backlog from '@/app/(studio)/backlog/loading';
import Posts from '@/app/(studio)/review/loading';
import Ready from '@/app/(studio)/ready/loading';
import Calendar from '@/app/(studio)/schedule/loading';
import Published from '@/app/(studio)/published/loading';
import Reconcile from '@/app/(studio)/reconcile/loading';
import Replies from '@/app/(studio)/replies/loading';
import Visuals from '@/app/(studio)/visuals/loading';

afterEach(cleanup);

it.each([
  ['Next up', Home], ['Backlog', Backlog], ['Posts', Posts], ['Ready queue', Ready],
  ['Calendar', Calendar], ['Published', Published], ['Fix issues', Reconcile], ['Replies', Replies], ['Visual studio', Visuals],
] as const)('%s fallback announces loading once and hides the decorative skeletons', (title, Loading) => {
  const { container } = render(<Loading />);
  expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
  const status = screen.getByRole('status');
  expect(status.getAttribute('aria-busy')).toBe('true');
  expect(status.textContent).toContain('Nothing is changed while this loads.');
  const skeleton = container.querySelector('[aria-hidden="true"].motion-safe\\:animate-pulse');
  expect(skeleton?.children).toHaveLength(4);
  expect(screen.queryByRole('button')).toBeNull();
});

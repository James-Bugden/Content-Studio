// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AiUsageMeter } from '@/components/ai-usage-meter';
import { AiErrorView } from '@/components/editor/ai-error';
import { AccountAiUsage } from '@/components/account-ai-usage';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows amount, accessible progress, monthly reset, and the 80% warning', () => {
  render(<AiUsageMeter usage={{ spentMicros: 16_000_000, capMicros: 20_000_000, resetsAt: '2026-10-31T16:00:00Z' }} />);
  expect(screen.getByText('$16.00 / $20.00')).toBeTruthy();
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('80');
  expect(screen.getByText(/Resets on the 1st/)).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('80% of monthly AI limit used');
});
it.each([0, 20_000_000])('zero-cap and over-cap meters stay within accessible bounds (%s)', capMicros => {
  render(<AiUsageMeter usage={{ spentMicros: 30_000_000, capMicros, resetsAt: '2026-10-31T16:00:00Z' }} />);
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  expect(screen.getByText('Monthly AI limit reached')).toBeTruthy();
});
it('cap refusal keeps manual editing available and links to the limit', () => {
  render(<AiErrorView code="AI_LIMIT_REACHED" what="The English check" />);
  expect(screen.getByText('Monthly AI limit reached')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'AI usage' }).getAttribute('href')).toBe('/ai-usage');
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});
it('closes the account popover on the history link so it cannot cover the mobile form', () => {
  render(<details open><summary>Account menu</summary><AccountAiUsage /></details>);
  const link = screen.getByRole('link', { name: 'Usage and monthly limit' });
  fireEvent.click(link);
  expect(link.closest('details')?.open).toBe(false);
});

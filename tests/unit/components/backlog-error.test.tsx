// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AppError } from '@/domain/errors';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/application/container', () => ({ getServices: () => ({ repo: {
  listLibrary: mocks.read, listQueue: mocks.read,
  listReadyQueue: async () => [], listSchedule: async () => [],
} }) }));
vi.mock('@/lib/auth', () => ({ requireActor: async () => ({ role: 'owner' }) }));
import BacklogPage from '@/app/(studio)/backlog/page';

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it.each([{}, { view: 'ideas' }])('Backlog rejects an unbranded code-shaped provider value: %s', async params => {
  mocks.read.mockRejectedValue({ code: 'RATE_LIMITED' });
  render(await BacklogPage({ searchParams: Promise.resolve(params) }));
  expect(document.querySelector('[data-state="provider_error"]')).toBeTruthy();
  expect(document.querySelector('[data-state="rate_limited"]')).toBeNull();
});

it('Backlog preserves an independently loaded branded error', async () => {
  vi.resetModules();
  const { AppError: ForeignError } = await import('@/domain/errors');
  const error = new ForeignError('RATE_LIMITED');
  expect(error).not.toBeInstanceOf(AppError);
  mocks.read.mockRejectedValue(error);
  render(await BacklogPage({ searchParams: Promise.resolve({}) }));
  expect(document.querySelector('[data-state="rate_limited"]')).toBeTruthy();
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ERROR_CATALOGUE, ERROR_CODES } from '@/domain/errors';
import { PromoteConfirm } from '@/components/schedule/promote-confirm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function confirm(result: object) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, ...result }))));
  render(<PromoteConfirm libraryId="SYN-L005" contentId="2026-10-01-MAIN-LI" slotLabel="Synthetic slot" libraryRevision="library-rev" scheduleRevision="slot-rev" />);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and write to Synthetic slot' }));
  const region = await screen.findByRole('code' in result && result.code === 'STALE_READ' ? 'status' : 'alert');
  return region.querySelector('.text-ink')!.textContent;
}

it.each(ERROR_CODES)('CS-059j: %s keeps the previous problem-first rendering', async code => {
  const next = code === 'STALE_READ' ? ' Reload this page to see the new preview.' : '';
  expect(await confirm({ code, problems: ['Synthetic promotion problem.'], message: ERROR_CATALOGUE[code].message }))
    .toBe(`${code === 'STALE_READ' ? 'Check' : 'Error'}: Synthetic promotion problem.${next}`);
});

it.each(ERROR_CODES)('CS-059j: %s without problems retains its exact catalogue message', async code => {
  const next = code === 'STALE_READ' ? ' Reload this page to see the new preview.' : '';
  expect(await confirm({ code, message: ERROR_CATALOGUE[code].message }))
    .toBe(`${code === 'STALE_READ' ? 'Check' : 'Error'}: ${ERROR_CATALOGUE[code].message}${next}`);
});

it.each([
  ['STALE_READ', 'The slot row changed after the preview. Review the new preview.', 'Check: The slot row changed after the preview. Review the new preview. Reload this page to see the new preview.'],
  ['STALE_READ', 'The Library item changed after the preview. Review the new preview.', 'Check: The Library item changed after the preview. Review the new preview. Reload this page to see the new preview.'],
  ['CONFLICT', 'Already scheduled as 2026-10-01-MAIN-LI.', 'Error: Already scheduled as 2026-10-01-MAIN-LI.'],
  ['CONFLICT', 'The slot row is missing or its Content ID is duplicated.', 'Error: The slot row is missing or its Content ID is duplicated.'],
  ['NOT_FOUND', 'The slot row is missing or its Content ID is duplicated.', 'Error: The slot row is missing or its Content ID is duplicated.'],
  ['NOT_FOUND', 'Only Content Library items can be promoted.', 'Error: Only Content Library items can be promoted.'],
] as const)('CS-059j: route-shaped %s error renders only applicable recovery (%s)', async (code, problem, expected) => {
  expect(await confirm({ code, problems: [problem], message: ERROR_CATALOGUE[code].message })).toBe(expected);
});

it('CS-059j: only elapsed-slot validation appends server safety text and slot recovery', async () => {
  expect(await confirm({ code: 'VALIDATION_FAILED', problems: ['This slot cannot be used.'], message: ERROR_CATALOGUE.VALIDATION_FAILED.message }))
    .toBe('Error: This slot cannot be used. Some input was not valid. Nothing was changed. Choose another slot.');
});
it('CS-059j: a missing server message uses the existing generic fallback', async () => {
  expect(await confirm({ code: 'UNKNOWN' })).toBe('Error: Not scheduled. Nothing was written.');
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContentParityJournal } from '@/application/content-parity';
import { resetEnvCache } from '@/lib/env';
const mocks = vi.hoisted(() => ({ parity: undefined as unknown, role: 'owner', refresh: vi.fn(), unreadable: [] as string[], reportError: false }));
vi.mock('@/application/container', () => ({ getServices: () => ({ contentParity: mocks.parity }) }));
vi.mock('@/application/reconcile', () => ({ buildReconcileReport: async () => {
  if (mocks.reportError) throw new Error('Synthetic report failure');
  return { checkedAt: new Date(0).toISOString(), capabilities: [], alerts: [], unreadable: mocks.unreadable, items: [], events: [] };
} }));
vi.mock('@/lib/auth', () => ({ requireActor: async () => ({ role: mocks.role }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/components/reconcile/database-switch-panel', () => ({ DatabaseSwitchPanel: ({ importsBlocked }: { importsBlocked?: boolean }) => <section aria-label="Database switch" data-imports-blocked={importsBlocked}>Database switch</section> }));
import Page from '@/app/(studio)/reconcile/page';
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); sessionStorage.clear(); mocks.role = 'owner'; mocks.unreadable = []; mocks.reportError = false; resetEnvCache(); });
it.each(['db-shadow', 'db-read'])('keeps the existing visible import control and completion status in %s', async store => {
  vi.stubEnv('CS_CONTENT_STORE', store); resetEnvCache();
  mocks.parity = new ContentParityJournal();
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, status: 'completed' }));
  vi.stubGlobal('fetch', fetcher);
  render(await Page());
  const report = screen.getByRole('region', { name: 'Content import and parity' });
  const button = within(report).getByRole('button', { name: 'Run content import' });
  expect(button.closest('details')).toBeNull();
  expect(button.closest('[hidden]')).toBeNull();
  expect(button).toHaveProperty('disabled', false);
  expect(screen.getByRole('region', { name: 'Database switch' }).getAttribute('data-imports-blocked')).toBe('false');
  await userEvent.click(button);
  expect((await within(report).findByRole('status')).textContent).toBe('Content import completed.');
  expect(fetcher).toHaveBeenCalledWith('/api/ops/sheet-mirror', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'Idempotency-Key': expect.stringMatching(/^[0-9a-f-]{36}$/),
  } });
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
it.each(['inactive', 'viewer', 'db'])('does not expose the existing import control for %s', async mode => {
  vi.stubEnv('CS_CONTENT_STORE', mode === 'db' ? 'db' : 'db-shadow'); resetEnvCache();
  mocks.role = mode === 'viewer' ? 'viewer' : 'owner';
  mocks.parity = mode === 'inactive' || mode === 'db' ? undefined : new ContentParityJournal();
  render(await Page());
  expect(screen.queryByRole('button', { name: 'Run content import' })).toBeNull();
});
it.each(['Sheet', 'Drive', 'Typefully', 'report failure'])('blocks panel imports during %s faults while preserving the existing recovery control', async source => {
  vi.stubEnv('CS_CONTENT_STORE', 'db-shadow'); resetEnvCache();
  mocks.parity = new ContentParityJournal();
  if (source === 'report failure') mocks.reportError = true;
  else mocks.unreadable = [source];
  render(await Page());
  expect(screen.getByRole('region', { name: 'Database switch' }).getAttribute('data-imports-blocked')).toBe('true');
  if (source !== 'report failure') expect(screen.getByRole('button', { name: 'Run content import' })).toHaveProperty('disabled', false);
});
it.each([true,false])('renders durable scope and honest insufficient/unavailable gates: %s', async available => {
  vi.stubEnv('CS_CONTENT_STORE','db-shadow'); resetEnvCache();
  class Durable extends ContentParityJournal { override readonly scope = 'durable database history'; }
  const journal = new Durable(); journal.available = available; mocks.parity=journal;
  render(await Page());
  const region = screen.getByRole('region',{name:'Content import and parity'});
  expect(region.textContent).toContain('durable database history; measurements survive server restarts.');
  expect(region.textContent).toContain(available ? 'Shadow thresholds not yet met.' : 'Durable measurements unavailable; thresholds unknown.');
  expect(region.textContent).toContain('not measured');
  expect(region.textContent).not.toContain('a restart loses');
  expect(region.textContent).not.toContain('Shadow thresholds met.');
});

it('shows the owner waiver, measured failures and named gaps without hiding a failed gate', async () => {
  vi.stubEnv('CS_PARITY_WINDOW_WAIVED', '2026-10-25'); resetEnvCache();
  const j = new ContentParityJournal(); mocks.parity = j;
  j.lastRun = { counts: { library: 1, queue: 0, schedule: 0, workflow_settings: 0 }, hashes: { library: 'a', queue: 'a', schedule: 'a', workflow_settings: 'a' }, snapshotHash: 'a', exceptions: [], fullParity: { rows: 1, fields: 1, equal: 0, idsEqual: true, unclassified: 1 }, windowWaiver: { by: 'owner', on: '2026-10-25', recordedAt: '2026-10-25T00:00:00.000Z' } };
  j.gap = 'CONFIG_MISSING'; j.available = false;
  j.record({ at: Date.now(), collection: 'library', fields: 0, equal: 0, idsEqual: false, blocking: 1, lagMs: null, facts: [{ collection: 'library', field: 'provider', kind: 'changed', fingerprint: 'a'.repeat(16) }] });
  render(await Page());
  const text = screen.getByRole('region', { name: 'Content import and parity' }).textContent;
  expect(text).toContain('Window waived by owner on 2026-10-25');
  expect(text).toContain('CONFIG_MISSING'); expect(text).toContain('1 provider failure samples');
  expect(text).toContain('1 unclassified differences'); expect(text).not.toContain('Shadow thresholds met.');
});

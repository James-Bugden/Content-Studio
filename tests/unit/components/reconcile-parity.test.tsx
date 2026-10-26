// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ContentParityJournal } from '@/application/content-parity';
import { resetEnvCache } from '@/lib/env';
const mocks = vi.hoisted(() => ({ parity: undefined as unknown }));
vi.mock('@/application/container', () => ({ getServices: () => ({ contentParity: mocks.parity }) }));
vi.mock('@/application/reconcile', () => ({ buildReconcileReport: async () => ({ checkedAt: new Date(0).toISOString(), capabilities: [], alerts: [], unreadable: [], items: [], events: [] }) }));
vi.mock('@/lib/auth', () => ({ requireActor: async () => ({ role: 'owner' }) }));
vi.mock('@/components/reconcile/content-import-button', () => ({ ContentImportButton: () => <button>Run content import</button> }));
vi.mock('@/components/reconcile/database-switch-panel', () => ({ DatabaseSwitchPanel: () => <section aria-label="Database switch">Database switch</section> }));
import Page from '@/app/(studio)/reconcile/page';
afterEach(() => { cleanup(); vi.unstubAllEnvs(); resetEnvCache(); });
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

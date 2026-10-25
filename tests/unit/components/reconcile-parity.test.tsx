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

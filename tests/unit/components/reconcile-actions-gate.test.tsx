// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/reconcile', useSearchParams: () => new URLSearchParams() }));

import { GATE_FAILED, GATE_WAITING, ReconcileActionsProvider, SectionGate, gateFor, useActionsGate, type SectionCheckState } from '@/components/reconcile/actions-gate';
import { DatabaseSwitchPanel } from '@/components/reconcile/database-switch-panel';
import { Section, STREAMED_SECTIONS } from '@/components/reconcile/sections';
import { SectionSkeleton } from '@/components/reconcile/section-status';
import type { SlowSection } from '@/application/reconcile';
import { cutoverBuild, cutoverStatus } from '../../fixtures/cutover';

const SECTIONS = ['drive', 'typefully'] as const;

function Probe() {
  const gate = useActionsGate();
  return <button type="button" disabled={!gate.enabled} title={gate.reason ?? ''}>Sync now</button>;
}
function Gated({ drive, typefully }: { drive?: SectionCheckState; typefully?: SectionCheckState }) {
  return (
    <ReconcileActionsProvider sections={SECTIONS}>
      <Probe />
      {drive ? <SectionGate id="drive" state={drive} /> : null}
      {typefully ? <SectionGate id="typefully" state={typefully} /> : null}
    </ReconcileActionsProvider>
  );
}
const button = () => screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement;
const checks = () => document.querySelector('[data-reconcile-checks]')?.getAttribute('data-reconcile-checks');

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); sessionStorage.clear(); });

describe('Fix issues write-action gate (CS #250)', () => {
  it('pure gate: loading waits, any failure blocks, all ok opens', () => {
    expect(gateFor(SECTIONS, {})).toMatchObject({ enabled: false, reason: GATE_WAITING, state: 'checking' });
    expect(gateFor(SECTIONS, { drive: 'ok' })).toMatchObject({ enabled: false, state: 'checking' });
    expect(gateFor(SECTIONS, { drive: 'ok', typefully: 'failed' })).toMatchObject({ enabled: false, reason: GATE_FAILED, state: 'blocked' });
    expect(gateFor(SECTIONS, { drive: 'loading', typefully: 'failed' })).toMatchObject({ enabled: false, reason: GATE_FAILED });
    expect(gateFor(SECTIONS, { drive: 'ok', typefully: 'ok' })).toMatchObject({ enabled: true, reason: null, state: 'ready' });
  });

  it('loading -> disabled, ok -> enabled, failed -> disabled, retry ok -> re-enabled', () => {
    const view = render(<Gated />);
    expect(button().disabled).toBe(true);
    expect(button().title).toBe(GATE_WAITING);
    expect(checks()).toBe('checking');
    view.rerender(<Gated drive="ok" />);
    expect(button().disabled).toBe(true);
    view.rerender(<Gated drive="ok" typefully="ok" />);
    expect(button().disabled).toBe(false);
    expect(checks()).toBe('ready');
    view.rerender(<Gated drive="ok" typefully="failed" />);
    expect(button().disabled).toBe(true);
    expect(button().title).toBe(GATE_FAILED);
    expect(checks()).toBe('blocked');
    view.rerender(<Gated drive="ok" typefully="ok" />);
    expect(button().disabled).toBe(false);
  });

  it('a section that unmounts (re-check in flight) returns to waiting', () => {
    const view = render(<Gated drive="ok" typefully="ok" />);
    expect(button().disabled).toBe(false);
    view.rerender(<Gated drive="ok" />);
    expect(button().disabled).toBe(true);
    expect(button().title).toBe(GATE_WAITING);
  });

  it('outside the Fix issues provider actions are not gated', () => {
    render(<Probe />);
    expect(button().disabled).toBe(false);
  });
});

describe('Fix issues page actions with latency fakes (CS #250)', () => {
  beforeEach(() => {
    const status = cutoverStatus();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, status })));
  });
  const props = { what: 'Drive files', clear: 'All clear' };
  const ok = (): SlowSection => ({ items: [], unreadable: [], failed: 0, checked: 2 });
  const later = <T,>(value: T | Error, ms = 30) => new Promise<T>((resolve, reject) => setTimeout(() => (value instanceof Error ? reject(value) : resolve(value)), ms));
  const drive = (promise: Promise<SlowSection>) => Section({ ...props, id: 'drive-check-h', gate: 'drive', title: 'Drive', source: 'Drive', promise });
  const typefully = (promise: Promise<SlowSection>) => Section({ ...props, id: 'typefully-check-h', gate: 'typefully', title: 'Typefully', source: 'Typefully', promise });
  const page = (sections: React.ReactNode) => (
    <ReconcileActionsProvider sections={STREAMED_SECTIONS}><DatabaseSwitchPanel />{sections}</ReconcileActionsProvider>
  );
  const skeletons = <>
    <SectionSkeleton id="drive-check-h" gate="drive" title="Drive" what="Drive" />
    <SectionSkeleton id="typefully-check-h" gate="typefully" title="Typefully" what="Typefully" />
  </>;
  const importNow = () => screen.getByRole('button', { name: 'Import now' }) as HTMLButtonElement;

  it('keeps imports and cutover steps disabled while checks stream, enables them once all are ok', async () => {
    const view = render(page(skeletons));
    await screen.findByText(cutoverBuild);
    expect(importNow().disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Backup check' })).toHaveProperty('disabled', true);
    expect(screen.getAllByText(GATE_WAITING).length).toBeGreaterThan(0);
    const [d, t] = await Promise.all([drive(later(ok(), 20)), typefully(later(ok(), 40))]);
    view.rerender(page(<>{d}{t}</>));
    await waitFor(() => expect(importNow().disabled).toBe(false));
    expect(screen.getByRole('button', { name: 'Backup check' })).toHaveProperty('disabled', false);
    expect(screen.queryByText(GATE_WAITING)).toBeNull();
  });

  it.each(['rejected', 'partial'] as const)('a %s provider section shows the banner and keeps actions disabled until a successful retry', async (fault) => {
    const view = render(page(skeletons));
    await screen.findByText(cutoverBuild);
    const failing = fault === 'rejected' ? later<SlowSection>(new Error('synthetic')) : later({ ...ok(), failed: 1, unreadable: ['Typefully drafts'] });
    const [d, t] = await Promise.all([drive(later(ok())), typefully(failing)]);
    view.rerender(page(<>{d}{t}</>));
    expect(screen.getByText('Some sources could not be read')).toBeTruthy();
    expect(importNow().disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Backup check' })).toHaveProperty('disabled', true);
    expect(screen.getAllByText(GATE_FAILED).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('link', { name: 'Retry' }));
    expect(router.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/reconcile\?fresh=\d+$/));
    const [d2, t2] = await Promise.all([drive(later(ok())), typefully(later(ok()))]);
    view.rerender(page(<>{d2}{t2}</>));
    await waitFor(() => expect(importNow().disabled).toBe(false));
    expect(screen.queryByText('Some sources could not be read')).toBeNull();
  });
});

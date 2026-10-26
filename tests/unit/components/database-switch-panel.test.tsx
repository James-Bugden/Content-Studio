// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { DatabaseSwitchPanel } from '@/components/reconcile/database-switch-panel';
import { cutoverRetrySlot } from '@/components/reconcile/cutover-retry';
import { cutoverBuild, cutoverStatus } from '../../fixtures/cutover';
import type { CutoverStatus, SwitchAction } from '@/domain/cutover';

let current: CutoverStatus, fetcher: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>, posts: RequestInit[], nextStatus: (() => CutoverStatus) | null;
const label = (action: SwitchAction) => action === 'activate-read' ? 'Switch reads to database' : 'Switch to database';
beforeEach(() => {
  sessionStorage.clear(); current = cutoverStatus(); posts = []; nextStatus = null;
  fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(init);
      const { action } = JSON.parse(String(init.body));
      return Response.json({ ok: true, result: { mode: action === 'activate-read' ? 'db-read' : 'db', build: current.build, contract: current.contract } });
    }
    return Response.json({ ok: true, status: nextStatus ? nextStatus() : current });
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function panel() { render(<DatabaseSwitchPanel />); await screen.findByText(cutoverBuild); }
async function open(action: SwitchAction) {
  await panel(); await userEvent.click(screen.getByRole('button', { name: label(action) }));
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(within(dialog).getByLabelText('Type ACTIVATE exactly to continue')).toHaveProperty('disabled', false));
  return dialog;
}

it.each(['activate-read', 'activate-db'] as const)('requires exact typed confirmation and re-fetches status twice for %s', async action => {
  const dialog = await open(action), input = within(dialog).getByLabelText('Type ACTIVATE exactly to continue');
  expect(dialog.textContent).toContain(cutoverBuild); expect(dialog.textContent).toContain('roll back');
  const confirm = within(dialog).getByRole('button', { name: 'Confirm switch' });
  for (const value of ['', 'activate', 'ACTIVATE ', ' ACTIVATE', 'YES']) {
    fireEvent.change(input, { target: { value } }); expect(confirm).toHaveProperty('disabled', true);
    fireEvent.click(confirm); expect(posts).toHaveLength(0);
  }
  fireEvent.change(input, { target: { value: 'ACTIVATE' } }); expect(confirm).toHaveProperty('disabled', false);
  await userEvent.click(confirm);
  await screen.findByText(/Switch recorded for this exact build/);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole('button', { name: label(action) }));
  expect(posts).toHaveLength(1);
  expect(JSON.parse(String(posts[0]!.body))).toEqual({ action, expectedBuild: cutoverBuild });
  expect((posts[0]!.headers as Record<string,string>)['Idempotency-Key']).toMatch(/^[a-f0-9-]{36}$/);
  expect(fetcher.mock.calls.filter(c => c[1]?.method !== 'POST').length).toBeGreaterThanOrEqual(3);
  expect(sessionStorage.getItem(cutoverRetrySlot(action))).toBeNull();
});
it('the handler independently refuses inexact confirmation even if a caller bypasses the disabled DOM control', async () => {
  const dialog=await open('activate-db');
  fireEvent.change(within(dialog).getByLabelText('Type ACTIVATE exactly to continue'),{target:{value:'activate'}});
  const button=within(dialog).getByRole('button',{name:'Confirm switch'});
  // Call the actual wired handler, bypassing the DOM disabled guard deliberately.
  // This defense test must fail when only the handler's typed guard is removed.
  const propKey=Object.keys(button).find(k=>k.startsWith('__reactProps'))!;
  const props=(button as unknown as Record<string,{onClick:()=>void}>)[propKey]!;
  await act(async()=>{ props.onClick(); });
  expect(posts).toHaveLength(0);
});
it('disables an open confirmation with a plain reason when the import countdown expires', async () => {
  current.lastImportAgeMs=899_000;
  const dialog=await open('activate-db');
  fireEvent.change(within(dialog).getByLabelText('Type ACTIVATE exactly to continue'),{target:{value:'ACTIVATE'}});
  const confirm=within(dialog).getByRole('button',{name:'Confirm switch'});
  expect(confirm).toHaveProperty('disabled',false);
  await waitFor(()=>expect(confirm).toHaveProperty('disabled',true),{timeout:2500});
  expect(within(dialog).getByRole('alert').textContent).toContain('15 minutes old'); expect(posts).toHaveLength(0);
});
it('shows plain readiness, waiver state, evidence ages and the 15-minute import countdown', async () => {
  await panel(); const region = screen.getByRole('region', { name: 'Database switch' });
  expect(region.textContent).toContain('14m 59s left'); expect(region.textContent).toContain('Unavailable for this build and import');
  expect(region.textContent).toContain('Recorded owner decision applies'); expect(region.textContent).toContain('Sheet remains authoritative');
});
it('keeps every cutover action disabled in the synthetic preview while leaving the existing import flow available', async () => {
  current.synthetic=true;
  await panel();expect(screen.getByText(/Synthetic preview. Live cutover checks/)).toBeTruthy();
  for(const name of ['Measure','Backup check','Rehearse rollback','Export check','Switch reads to database','Switch to database']) {
    expect(screen.getByRole('button',{name})).toHaveProperty('disabled',true);
  }
  expect(screen.getByRole('button',{name:'Import now'})).toHaveProperty('disabled',false);expect(posts).toHaveLength(0);
});
it('reuses the existing import request and completion status for Import now, then refreshes readiness', async () => {
  await panel();
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) => url === '/api/ops/sheet-mirror'
    ? Response.json({ ok: true, status: 'completed' }) : original(url, init));
  const readsBefore = fetcher.mock.calls.filter(([url]) => url === '/api/ops/content-cutover').length;
  await userEvent.click(screen.getByRole('button', { name: 'Import now' }));
  await waitFor(() => expect(screen.getAllByRole('status').some(status => status.textContent === 'Content import completed.')).toBe(true));
  expect(fetcher).toHaveBeenCalledWith('/api/ops/sheet-mirror', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'Idempotency-Key': expect.stringMatching(/^[0-9a-f-]{36}$/),
  } });
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url === '/api/ops/content-cutover').length).toBeGreaterThan(readsBefore));
  expect(sessionStorage.getItem(cutoverRetrySlot('import'))).toBeNull();
  expect(posts).toHaveLength(0);
});
it('blocks Import now with a recovery reason when reconcile sources are unreadable, then enables it after recovery', async () => {
  const view = render(<DatabaseSwitchPanel importsBlocked />);
  await screen.findByText(cutoverBuild);
  const button = screen.getByRole('button', { name: 'Import now' });
  expect(button).toHaveProperty('disabled', true);
  expect(screen.getByText(/Some content sources could not be checked/)).toBeTruthy();
  await userEvent.click(button);
  expect(fetcher.mock.calls.some(([url]) => url === '/api/ops/sheet-mirror')).toBe(false);
  view.rerender(<DatabaseSwitchPanel importsBlocked={false} />);
  expect(button).toHaveProperty('disabled', false);
  expect(screen.queryByText(/Some content sources could not be checked/)).toBeNull();
});
it.each(['red','expired','unknown-age','malformed'] as const)('disables switches with a plain reason for %s readiness', async fault => {
  if (fault === 'red') current.gates.db = { ok: false, reasons: ['write_proof_missing'] };
  if (fault === 'expired') current.lastImportAgeMs = 900_000;
  if (fault === 'unknown-age') current.lastImportAgeMs = null;
  if (fault === 'malformed') current.gates.db = { ok: true, reasons: ['write_proof_missing'] };
  render(<DatabaseSwitchPanel />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh status' })).toHaveProperty('disabled', false));
  expect(screen.getByRole('button', { name: 'Switch to database' })).toHaveProperty('disabled', true);
  if (fault === 'red') expect(screen.getAllByText('The database write checks have not been recorded.').length).toBeGreaterThan(0);
  if (fault === 'malformed') expect(screen.getByRole('alert').textContent).toContain('status is unavailable');
  expect(posts).toHaveLength(0);
});
it.each(['build','gate','other-gate','deployment','epoch','freeze','waiver','expired'] as const)('refuses changed %s after typing, before POST', async fault => {
  const dialog = await open('activate-db');
  fireEvent.change(within(dialog).getByLabelText('Type ACTIVATE exactly to continue'), { target: { value: 'ACTIVATE' } });
  if (fault === 'build') current.build = 'b'.repeat(40);
  if (fault === 'gate') current.gates.db = { ok: false, reasons: ['write_proof_expired'] };
  if (fault === 'other-gate') current.gates['db-read'] = { ok: false, reasons: ['parity_not_green'] };
  if (fault === 'deployment') current.deploymentId = 'dpl_changed';
  if (fault === 'epoch') current.epoch = 'read';
  if (fault === 'freeze') current.writesDisabled = false;
  if (fault === 'waiver') current.waivers.backup.audited = false;
  if (fault === 'expired') current.lastImportAgeMs = 900_000;
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm switch' }));
  await within(dialog).findByRole('alert'); expect(posts).toHaveLength(0);
  expect(within(dialog).getByRole('button', { name: 'Confirm switch' })).toHaveProperty('disabled', true);
});
it('refuses a changed build while opening the dialog', async () => {
  await panel(); current.build = 'b'.repeat(40);
  await userEvent.click(screen.getByRole('button', { name: 'Switch reads to database' }));
  const dialog = screen.getByRole('dialog'); await within(dialog).findByRole('alert');
  expect(within(dialog).getByRole('button', { name: 'Confirm switch' })).toHaveProperty('disabled', true); expect(posts).toHaveLength(0);
});
it('retains pending UUID through timeout and remount, rotates only after verified completion', async () => {
  await panel(); const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) => {
    if (init?.method === 'POST') { posts.push(init); throw new Error('SYNTHETIC_PRIVATE_ERROR'); }
    return original(url, init);
  });
  await userEvent.click(screen.getByRole('button', { name: 'Backup check' }));
  await screen.findByText(/Completion is unconfirmed. The pending request is kept./);
  const firstKey = (posts[0]!.headers as Record<string,string>)['Idempotency-Key'];
  cleanup(); await panel();
  fetcher.mockImplementation(async (url,init) => {
    if (init?.method === 'POST') { posts.push(init); return Response.json({ ok:true, result: {status:'verified', manifestHash:'c'.repeat(64)} }); }
    return original(url,init);
  });
  await userEvent.click(screen.getByRole('button', { name: 'Backup check' })); await screen.findByText('Backup check verified.');
  expect((posts[1]!.headers as Record<string,string>)['Idempotency-Key']).toBe(firstKey);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Backup check' })).toHaveProperty('disabled', false));
  await userEvent.click(screen.getByRole('button', { name: 'Backup check' }));
  await waitFor(() => expect(posts).toHaveLength(3));
  expect((posts[2]!.headers as Record<string,string>)['Idempotency-Key']).not.toBe(firstKey);
});
it('never replaces a pending activation for another build', async () => {
  sessionStorage.setItem(cutoverRetrySlot('activate-db'), JSON.stringify({ key: '11111111-1111-4111-8111-111111111111', build: 'b'.repeat(40) }));
  const dialog = await open('activate-db'); fireEvent.change(within(dialog).getByLabelText('Type ACTIVATE exactly to continue'), { target: { value: 'ACTIVATE' } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm switch' }));
  await screen.findByText(/Completion is unconfirmed. The pending request is kept./); expect(posts).toHaveLength(0);
  expect(JSON.parse(sessionStorage.getItem(cutoverRetrySlot('activate-db'))!).build).toBe('b'.repeat(40));
});
it('keeps UUID pending on HTTP success with an invalid receipt and suppresses raw provider text', async () => {
  await panel(); const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url,init) => init?.method === 'POST' ? Response.json({ ok:true, result: {status:'verified', manifestHash:'private copy'} }) : original(url,init));
  await userEvent.click(screen.getByRole('button', { name: 'Backup check' }));
  await screen.findByText(/Completion is unconfirmed. Ask the coordinator/);
  expect(sessionStorage.getItem(cutoverRetrySlot('backup'))).not.toBeNull(); expect(document.body.textContent).not.toContain('private copy');
});
it('cancels without a POST and disables mode-dependent actions', async () => {
  const dialog = await open('activate-read'); await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(posts).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Export check' })).toHaveProperty('disabled', true);
  current.store = 'db'; await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import now' })).toHaveProperty('disabled', true));
  expect(screen.getByRole('button', { name: 'Measure' })).toHaveProperty('disabled', true);
});

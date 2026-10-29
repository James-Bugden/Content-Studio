// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { BackupCard } from '@/components/reconcile/backup-card';
import type { BackupRunView, BackupStatus } from '@/domain/weekly-backup';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockClear(); });
const NOW = Date.parse('2026-11-05T00:00:00Z');
const run = (over: Partial<BackupRunView> = {}): BackupRunView => ({
  id: 'r1', trigger: 'cron', status: 'success', startedAt: '2026-11-01T19:00:00Z', finishedAt: '2026-11-01T19:01:00Z',
  fileName: 'content-studio-backup-2026-11-02-0300.json.gz', sizeBytes: 2.5 * 1024 * 1024, rowCounts: { posts: 2 }, errorMessage: null, ...over,
});
const ok: BackupStatus = { lastRun: run(), lastSuccess: run() };

it('shows the last backup date and size, with no warning when healthy', () => {
  render(<BackupCard status={ok} now={NOW} isOwner />);
  expect(screen.getByRole('heading', { name: 'Backup' })).toBeTruthy();
  expect(screen.getByText(/Last backup: 2 Nov 2026/)).toBeTruthy();
  expect(screen.getByText(/2\.5 MB/)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
it('shows a clear warning when the last success is older than 8 days', () => {
  render(<BackupCard status={ok} now={Date.parse('2026-11-12T00:00:00Z')} isOwner />);
  expect(screen.getByRole('alert').textContent).toMatch(/10 days old/);
});
it('shows the failure and keeps the last good backup visible', () => {
  const failed = run({ id: 'r2', status: 'failure', finishedAt: '2026-11-04T19:01:00Z', errorMessage: 'CONFLICT: verify_checksum' });
  render(<BackupCard status={{ lastRun: failed, lastSuccess: run() }} now={NOW} isOwner />);
  expect(screen.getByRole('alert').textContent).toMatch(/last backup run failed/i);
  expect(screen.getByText(/CONFLICT: verify_checksum/)).toBeTruthy();
  expect(screen.getByText(/Last backup: 2 Nov 2026/)).toBeTruthy();
});
it('says so when there has never been a backup', () => {
  render(<BackupCard status={{ lastRun: null, lastSuccess: null }} now={NOW} isOwner />);
  expect(screen.getByText('Last backup: none yet')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toMatch(/No successful backup yet/);
});
it('warns when the folder is not configured or the status is unreadable, and hides the button', () => {
  render(<BackupCard status={null} now={NOW} isOwner folderConfigured={false} unavailable />);
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Back up now' })).toBeNull();
});
it('does not offer the action to a viewer', () => {
  render(<BackupCard status={ok} now={NOW} isOwner={false} />);
  expect(screen.queryByRole('button', { name: 'Back up now' })).toBeNull();
});
it('posts with a UUID idempotency key, reuses it after a lost response, then clears it on success', async () => {
  const keys: string[] = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    keys.push((init!.headers as Record<string, string>)['Idempotency-Key']!);
    if (keys.length === 1) throw new Error('network');
    return Response.json({ ok: true, status: 'success' });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<BackupCard status={ok} now={NOW} isOwner />);
  const button = screen.getByRole('button', { name: 'Back up now' });
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/could not be confirmed/));
  fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/finished and verified/));
  expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(fetcher.mock.calls[0]![0]).toBe('/api/ops/backup');
  expect((fetcher.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  expect(refresh).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
  await waitFor(() => expect(keys).toHaveLength(3));
  expect(keys[2]).not.toBe(keys[0]);
});
it('reports a failed run without claiming success', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, status: 'failure', errorMessage: 'CONFLICT' }, { status: 502 })));
  render(<BackupCard status={ok} now={NOW} isOwner />);
  fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Backup failed/));
});

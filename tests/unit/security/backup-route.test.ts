import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ env: {} as Record<string, string | undefined>, requireMutation: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/env', () => ({ serverEnv: () => mocks.env }));
vi.mock('@/lib/auth', () => ({ requireMutation: mocks.requireMutation }));
vi.mock('@/lib/weekly-backup', async () => {
  const actual = await vi.importActual<typeof import('@/lib/weekly-backup')>('@/lib/weekly-backup');
  return { ...actual, runConfiguredBackup: mocks.run };
});
import { GET, POST } from '@/app/api/ops/backup/route';
import { cronBackupId, manualBackupId } from '@/lib/weekly-backup';
import { AppError } from '@/domain/errors';

const SECRET = 'synthetic-cron-secret-0123456789';
const KEY = '123e4567-e89b-42d3-a456-426614174000';
const ok = { status: 'success', warnings: 0, run: { id: KEY, fileName: 'content-studio-backup-2026-11-02-0300.json.gz', sizeBytes: 10, rowCounts: { posts: 2 }, status: 'success' } };
const cron = (authorization?: string) => new Request('http://localhost:3000/api/ops/backup', { headers: authorization ? { authorization } : {} });
const manual = (headers: Record<string, string> = {}) => new Request('http://localhost:3000/api/ops/backup', { method: 'POST', headers: { Origin: 'http://localhost:3000', ...headers } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env = { CRON_SECRET: SECRET };
  mocks.run.mockResolvedValue(ok);
  mocks.requireMutation.mockResolvedValue({ sub: 'synthetic-owner', role: 'owner' });
});

describe('GET /api/ops/backup (cron)', () => {
  it('fails closed when CRON_SECRET is not configured, even with a bearer header', async () => {
    mocks.env = {};
    expect((await GET(cron('Bearer undefined'))).status).toBe(403);
    expect((await GET(cron(`Bearer ${SECRET}`))).status).toBe(403);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([undefined, 'Bearer wrong-secret-value-0123456789', SECRET, 'bearer ' + SECRET])('refuses a missing or wrong bearer (%s)', async header => {
    expect((await GET(cron(header))).status).toBe(403);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('runs the backup for the right bearer and returns counts only', async () => {
    const response = await GET(cron(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith('cron', cronBackupId());
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, status: 'success', rowCounts: { posts: 2 } });
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it('reports a failed run as a non-2xx so the cron shows red', async () => {
    mocks.run.mockResolvedValue({ status: 'failure', errorMessage: 'CONFLICT: verify_checksum' });
    expect((await GET(cron(`Bearer ${SECRET}`))).status).toBe(502);
  });
  it('uses one deterministic run id per UTC day', () => {
    expect(cronBackupId(Date.parse('2026-11-01T19:00:00Z'))).toBe(cronBackupId(Date.parse('2026-11-01T23:59:00Z')));
    expect(cronBackupId(Date.parse('2026-11-01T19:00:00Z'))).not.toBe(cronBackupId(Date.parse('2026-11-08T19:00:00Z')));
    expect(cronBackupId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('POST /api/ops/backup (Back up now)', () => {
  it('requires the owner/same-origin guard before anything runs', async () => {
    mocks.requireMutation.mockRejectedValue(new AppError('FORBIDDEN', { reason: 'cross_origin' }));
    expect((await POST(manual({ 'Idempotency-Key': KEY }))).status).toBe(403);
    mocks.requireMutation.mockRejectedValue(new AppError('AUTH_REQUIRED'));
    expect((await POST(manual({ 'Idempotency-Key': KEY }))).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([undefined, '', 'not-a-uuid', '123e4567-e89b-12d3-a456-426614174000'])('requires a UUID v4 idempotency key (%s)', async key => {
    const response = await POST(manual(key === undefined ? {} : { 'Idempotency-Key': key }));
    expect(response.status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('runs once with the client key as the run id', async () => {
    const response = await POST(manual({ 'Idempotency-Key': KEY.toUpperCase() }));
    expect(response.status).toBe(200);
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith('manual', KEY);
  });
  it('answers 202 when a backup is already running, 502 on failure', async () => {
    mocks.run.mockResolvedValueOnce({ status: 'busy', run: {} });
    expect((await POST(manual({ 'Idempotency-Key': KEY }))).status).toBe(202);
    mocks.run.mockResolvedValueOnce({ status: 'failure', errorMessage: 'UNKNOWN: unexpected error' });
    expect((await POST(manual({ 'Idempotency-Key': KEY }))).status).toBe(502);
  });
  it('manualBackupId validates strictly', () => {
    expect(() => manualBackupId(null)).toThrow();
    expect(manualBackupId(KEY)).toBe(KEY);
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { ContentShadowStore } from '@/integrations/supabase/content-shadow-store';
import { SupabaseContentParityJournal } from '@/integrations/supabase/content-parity-journal';
import { ContentParityJournal, PARITY_COLLECTIONS, shadowContentRepository, type ParitySample } from '@/application/content-parity';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { recentEvents, setTelemetrySink } from '@/observability/events';

const serviceKey = 'synthetic-sensitive-service-key-199';
const options = { url: 'https://synthetic.supabase.co', serviceKey };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const day = 86400_000, now = Date.UTC(2026, 9, 25);
const sample = (at = now, collection: ParitySample['collection'] = 'library'): ParitySample => ({ at, collection, idsEqual: true, fields: 10000, equal: 10000, blocking: 0, lagMs: 100, facts: [] });
const counts = { library: 1, queue: 1, schedule: 1, workflow_settings: 1 };
const evidence = { snapshotHash: 'a'.repeat(64), counts, hashes: { library: 'a'.repeat(64), queue: 'a'.repeat(64), schedule: 'a'.repeat(64), workflow_settings: 'a'.repeat(64) }, exceptions: [] };
const event = (kind: string, at: number, payload: unknown) => ({ event_id: crypto.randomUUID(), kind, at: new Date(at).toISOString(), payload });
function green(n = 200, days = 7) {
  const j = new ContentParityJournal();
  for (let i = 0; i < n; i++) j.record(sample(now - (i % days + 1) * day + i, PARITY_COLLECTIONS[i % 6]!));
  // Ensure each of the complete days contains all collections.
  j.samples.forEach((s, i) => { s.at = now - (Math.floor(i / 6) % days + 1) * day + i; });
  j.imported(now);
  j.lastRun = { ...evidence, fullParity: { rows: 4, fields: 4, equal: 4, idsEqual: true, unclassified: 0 } };
  return j;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); setTelemetrySink(null); });

it('pins Authorization, API key, no-store and the configured abort deadline at the REST boundary', async () => {
  const request = vi.fn<typeof fetch>(async (_, init) => {
    const signal = init?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    return new Promise<Response>((_, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
  });
  const deadline = vi.spyOn(AbortSignal, 'timeout');
  await expect(new ContentShadowStore({ ...options, timeoutMs: 10, fetch: request }).rpc('history', {})).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', details: { reason: 'network' } });
  expect(deadline).toHaveBeenCalledWith(10);
  expect(request.mock.calls[0]![1]?.headers).toMatchObject({ apikey: serviceKey, Authorization: `Bearer ${serviceKey}` });
  expect(request.mock.calls[0]![1]?.cache).toBe('no-store');
  expect(request.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
});
it.each([[401, 'FORBIDDEN'], [403, 'FORBIDDEN'], [409, 'CONFLICT'], [429, 'RATE_LIMITED'], [500, 'PROVIDER_UNAVAILABLE']])('maps HTTP %s without leaking bodies/credentials to errors, telemetry or logs', async (status, code) => {
  const body = 'Synthetic private provider response';
  const logs: unknown[] = [], telemetry: unknown[] = [];
  vi.spyOn(console, 'error').mockImplementation((...v) => { logs.push(v); });
  vi.spyOn(console, 'warn').mockImplementation((...v) => { logs.push(v); });
  vi.spyOn(console, 'log').mockImplementation((...v) => { logs.push(v); });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  setTelemetrySink(e => telemetry.push(e));
  const request = vi.fn<typeof fetch>(async () => json({ body, key: serviceKey, code: '42501' }, Number(status)));
  let error: unknown;
  try { await new ContentShadowStore({ ...options, fetch: request }).rpc('sample', {}); } catch (e) { error = e; }
  expect(error).toMatchObject({ code, details: { provider: 'db', httpStatus: status } });
  const captured = JSON.stringify({ error, message: String(error), stack: (error as Error).stack, logs, telemetry, recent: recentEvents(), stdout: vi.mocked(process.stdout.write).mock.calls, stderr: vi.mocked(process.stderr.write).mock.calls });
  expect(captured).not.toContain(body); expect(captured).not.toContain(serviceKey);
});
it('persists EVERY sample with its exact payload before accepting it as evidence', async () => {
  const request = vi.fn<typeof fetch>(async () => json({ ok: true }));
  const j = new SupabaseContentParityJournal({ ...options, fetch: request });
  for (const c of PARITY_COLLECTIONS) await j.record(sample(now, c));
  expect(request).toHaveBeenCalledTimes(6);
  const ids = new Set<string>();
  request.mock.calls.forEach(([url, init], i) => {
    expect(String(url)).toBe(`${options.url}/rest/v1/rpc/content_studio_shadow_sample`);
    const p = JSON.parse(String(init?.body));
    expect(p.p_sample).toEqual(sample(now, PARITY_COLLECTIONS[i]!));
    expect(p.p_event_id).toMatch(/^[a-f0-9-]{36}$/); ids.add(p.p_event_id);
  });
  expect(ids.size).toBe(6); expect(j.samples).toHaveLength(6);
});
it('a failed sample RPC preserves the Sheet response but names a persistence gap, never a pass', async () => {
  const j = new SupabaseContentParityJournal({ ...options, fetch: async () => json({}, 500) });
  const repo = new SheetsContentRepository(new FakeSheetTransport());
  const expected = await repo.listLibrary();
  expect(await shadowContentRepository(repo, repo, j, () => true).listLibrary()).toEqual(expected);
  expect(j.samples).toHaveLength(0);
  expect(j.summary()).toMatchObject({ ready: false, available: false, gap: 'SAMPLE_PERSISTENCE_FAILED' });
});
it('reload is idempotent, uses capture lag, loads prepare and reconstructs failures across restarts', async () => {
  const rows = [event('imported', now - 1000, { snapshotAt: now - 900000, evidence: { ...evidence, fullParity: { rows: 4, fields: 4, equal: 4, idsEqual: true, unclassified: 0 } } }), event('sample', now, sample()), event('failed', now - 3600001, {})];
  const request = vi.fn<typeof fetch>(async url => String(url).includes('/rpc/') ? json([...rows].sort((a,b) => a.at.localeCompare(b.at))) : json([rows[0]]));
  const j = new SupabaseContentParityJournal({ ...options, fetch: request });
  await j.prepare(); expect(j.lastImport).toBe(now - 900000);
  await j.refresh(); await j.refresh();
  expect(j.samples).toHaveLength(1);
  expect(j.summary(now)).toMatchObject({ lagMs: 900000, failureSince: null });
  // Failed event repaired by completion: the >1h repaired interval still gates.
  rows[0]!.at = new Date(now).toISOString();
  await j.refresh();
  const g = green(); j.samples.splice(0, j.samples.length, ...g.samples); j.lastImport = now;
  expect(j.summary(now).ready).toBe(false);
  rows.splice(2, 1); await j.refresh(); j.samples.splice(0, j.samples.length, ...g.samples); j.lastImport = now;
  expect(j.summary(now).ready).toBe(true);
  rows.push(event('failed', now, {})); await j.refresh();
  expect(j.failureSince).toBe(now);
  request.mockImplementation(async () => { throw new Error('offline'); }); await j.refresh();
  expect(j.summary(now)).toMatchObject({ available: false, gap: 'HISTORY_UNAVAILABLE', sampleCount: 0, failureSince: null, lastRun: null });
  request.mockImplementation(async () => json([])); await j.refresh();
  j.samples.push(...g.samples); j.lastImport = now; j.lastRun = g.lastRun;
  expect(j.summary(now).ready).toBe(true); // no stale repaired failures survive a failed reload
});
it('refuses a history overflow sentinel instead of passing a truncated window', async () => {
  const j = new SupabaseContentParityJournal({ ...options, fetch: async () => json(Array.from({ length: 50001 }, () => event('sample', now, sample()))) });
  await j.refresh(); expect(j.summary(now)).toMatchObject({ available: false, ready: false, gap: 'HISTORY_UNAVAILABLE' });
});
it.each([[199, false], [200, true]])('pins sample count %s => %s', (n, ready) => { expect(green(n).summary(now).ready).toBe(ready); });
it.each([[6, false], [7, true]])('pins complete calendar days %s => %s', (days, ready) => { expect(green(210, days).summary(now).ready).toBe(ready); });
it.each([[9989, false], [9990, true]])('pins 99.89/99.9 percent equality: %s', (equal, ready) => {
  const j = green();
  j.samples.push({ ...sample(), fields: 1000000000, equal: equal * 100000 });
  expect(j.summary(now).ready).toBe(ready);
});
it.each([[900000, true], [900001, false]])('pins lag p95 15min +/-1ms: %s', (lag, ready) => {
  const j = green(); j.samples.push(...Array.from({ length: 200 }, () => ({ ...sample(), lagMs: lag })));
  expect(j.summary(now).ready).toBe(ready);
});
it.each([[3600000, true], [3600001, false]])('pins one-hour repaired failure duration %s', (duration, ready) => {
  const j = green(); j.failed(now - duration); j.imported(now); expect(j.summary(now).ready).toBe(ready);
});
it('owner waiver requires durable audit and full-import measurements, preserves every measured gate', () => {
  vi.stubEnv('CS_PARITY_WINDOW_WAIVED', '2026-10-25');
  const j = new ContentParityJournal();
  j.record(sample());
  const fullParity = { rows: 4, idsEqual: true, fields: 10000, equal: 10000, unclassified: 0 };
  j.lastRun = { ...evidence, fullParity };
  expect(j.summary(now).ready).toBe(false); // switch alone is not evidence
  j.lastRun.windowWaiver = { by: 'owner', on: '2026-10-25', recordedAt: new Date(now).toISOString() };
  expect(j.summary(now)).toMatchObject({ ready: true, daysGreen: 0, sampleCount: 1, windowWaiver: { by: 'owner', on: '2026-10-25' } });
  // Outlier >15 minutes does not veto p95; neither does a named timeout.
  j.samples.push(...Array.from({ length: 99 }, () => sample()), { ...sample(), lagMs: 910000 }, { ...sample(), lagMs: null, blocking: 1, idsEqual: false, facts: [{ collection: 'library', field: 'provider', kind: 'changed', fingerprint: 'a'.repeat(16) }] });
  expect(j.summary(now)).toMatchObject({ ready: true, providerFailures: 1, lagP95: 100 });
  j.failed(now - 3600001); expect(j.summary(now).ready).toBe(false);
  j.failureSince = now - 3600000; expect(j.summary(now).ready).toBe(true);
  j.failureSince = null;
  for (const patch of [{ idsEqual: false }, { unclassified: 1 }, { equal: 9989 }, { rows: 3 }]) {
    j.lastRun.fullParity = { ...fullParity, ...patch }; expect(j.summary(now).ready).toBe(false);
  }
  j.lastRun.fullParity = { ...fullParity, equal: 9990 }; expect(j.summary(now).ready).toBe(true);
  const changed = { ...sample(), idsEqual: false }; j.samples.push(changed); expect(j.summary(now).ready).toBe(false); j.samples.pop();
  j.samples.forEach(s => { s.lagMs = 900000; }); expect(j.summary(now).ready).toBe(true);
  j.samples.forEach(s => { s.lagMs = 900001; }); expect(j.summary(now).ready).toBe(false);
  j.samples.length = 0; expect(j.summary(now).ready).toBe(false);
  j.record(sample()); j.lastRun.fullParity = undefined; expect(j.summary(now).ready).toBe(false);
  j.lastRun.fullParity = fullParity; j.gap = 'SAMPLE_PERSISTENCE_FAILED'; expect(j.summary(now).ready).toBe(false);
  j.gap = null; vi.stubEnv('CS_PARITY_WINDOW_WAIVED', undefined); expect(j.summary(now).ready).toBe(false);
});

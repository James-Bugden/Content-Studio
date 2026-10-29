import { describe, expect, it } from 'vitest';
import { isDue, runSyncJobs, selectSyncJobs, type SyncAction, type SyncCandidate } from '@/domain/published-sync';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const H = 3_600_000;
const row = (id: string, o: Partial<SyncCandidate> = {}): SyncCandidate => ({
  contentId: id, revision: `r-${id}`, draftId: `d-${id}`, status: 'Published',
  finalSyncAt: new Date(NOW - H).toISOString(), analyticsSyncAt: new Date(NOW - H).toISOString(), ...o,
});

describe('sync staleness (#247)', () => {
  it('treats never, unreadable and old times as due', () => {
    expect(isDue(null, NOW, H)).toBe(true);
    expect(isDue('garbage', NOW, H)).toBe(true);
    expect(isDue(new Date(NOW - 2 * H).toISOString(), NOW, H)).toBe(true);
    expect(isDue(new Date(NOW - H / 2).toISOString(), NOW, H)).toBe(false);
  });

  it('picks final after 24 h and analytics after 6 h, skipping unlinked rows', () => {
    const jobs = selectSyncJobs([
      row('fresh'),
      row('analytics-old', { analyticsSyncAt: new Date(NOW - 7 * H).toISOString() }),
      row('final-old', { finalSyncAt: new Date(NOW - 25 * H).toISOString() }),
      row('never', { finalSyncAt: null, analyticsSyncAt: null }),
      row('unlinked', { draftId: '', finalSyncAt: null }),
      row('not-published', { status: 'Scheduled', finalSyncAt: null, analyticsSyncAt: null }),
    ], NOW);
    expect(jobs).toEqual([
      { contentId: 'analytics-old', revision: 'r-analytics-old', actions: ['analytics'] },
      { contentId: 'final-old', revision: 'r-final-old', actions: ['sync-final'] },
      { contentId: 'never', revision: 'r-never', actions: ['sync-final', 'analytics'] },
      { contentId: 'not-published', revision: 'r-not-published', actions: ['sync-final'] },
    ]);
  });

  it('caps rows per visit in the given (newest first) order and skips recent automatic tries', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`R${i}`, { finalSyncAt: null }));
    const jobs = selectSyncJobs(rows, NOW, { 'R0:sync-final': NOW - H });
    expect(jobs).toHaveLength(20);
    expect(jobs[0]!.contentId).toBe('R1');
    expect(selectSyncJobs(rows, NOW, {}, { maxRows: 2 }).map((j) => j.contentId)).toEqual(['R0', 'R1']);
  });
});

describe('sync queue (#247)', () => {
  it('never runs more than three rows at once and chains revisions within a row', async () => {
    let active = 0;
    let peak = 0;
    const seen: string[] = [];
    const actions: SyncAction[] = ['sync-final', 'analytics'];
    const jobs = Array.from({ length: 8 }, (_, i) => ({ contentId: `R${i}`, revision: 'v0', actions }));
    const progress: number[] = [];
    const result = await runSyncJobs(jobs, async (id, action, revision) => {
      active++;
      peak = Math.max(peak, active);
      seen.push(`${id}:${action}:${revision}`);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return { ok: true as const, revision: `${revision}+` };
    }, { onRow: (done) => progress.push(done) });
    expect(peak).toBe(3);
    expect(result).toEqual({ rows: 8, failedRows: 0 });
    expect(seen).toContain('R0:sync-final:v0');
    expect(seen).toContain('R0:analytics:v0+');
    expect(progress.at(-1)).toBe(8);
  });

  it('counts failed rows, stops a row on a stale read, and survives a throw', async () => {
    const calls: string[] = [];
    const actions: SyncAction[] = ['sync-final', 'analytics'];
    const jobs = ['A', 'B', 'C'].map((contentId) => ({ contentId, revision: 'v', actions }));
    const result = await runSyncJobs(jobs, async (id, action) => {
      calls.push(`${id}:${action}`);
      if (id === 'A') return { ok: false as const, code: 'STALE_READ' };
      if (id === 'B') throw new Error('network');
      return { ok: true as const, revision: 'v2' };
    });
    expect(result).toEqual({ rows: 3, failedRows: 2 });
    expect(calls).toContain('B:analytics');
    expect(calls).not.toContain('A:analytics');
  });
});

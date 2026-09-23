import { afterEach, describe, expect, it } from 'vitest';
import { setTelemetrySink } from '@/observability/events';
import { compareCopy, pushToTypefully, reconcile, syncAnalytics, syncFromTypefully } from '@/application/typefully';
import { SCHEDULE_SYNC_FIELDS } from '@/domain/sheet-schema';
import { NOW, captureTelemetry, owner, setup, writtenFields } from './harness';

afterEach(() => setTelemetrySink(null));

const X2 = '2026-10-02-MAIN-X';
const X1 = '2026-10-01-MAIN-X';
const TH1 = '2026-10-01-MAIN-TH';
const EXOTIC = '談薪水不是吵架 🙂\r\n\r\n  – their budget  \n\tyour market value  \n\nEnd with a question.   ';

describe('TYPE-04: exact Typefully text lands in Final Content; working Content is unchanged', () => {
  it('CJK, emoji, CRLF, tabs, NBSP and trailing spaces survive byte for byte', async () => {
    captureTelemetry();
    const { repo, tf, row, input } = setup();
    tf.editExternally('SYNTH-TF-1003', EXOTIC);
    const before = await row(X2);
    const r = await syncFromTypefully(repo, tf, owner, await input(X2, 'op_sync_exotic'), { now: NOW });
    expect(r.ok).toBe(true);
    const after = await row(X2);
    expect(after.cells.finalContent).toBe(EXOTIC);
    expect(after.cells.content).toBe(before.cells.content);
    expect(after.cells.chineseContent).toBe(before.cells.chineseContent);
    expect(after.cells.finalSyncedAt).toMatch(/^2026-09-30T08:00:00\+08:00 #[0-9a-f]{8}$/);
    expect(after.cells.typefullyStatus).toBe('Scheduled');
  });

  it('a repeated sync is idempotent: nothing is written the second time', async () => {
    captureTelemetry();
    const { repo, tf, sheet, input } = setup();
    await syncFromTypefully(repo, tf, owner, await input(X2, 'op_sync_first'), { now: NOW });
    const writes = sheet.writes.length;
    const again = await syncFromTypefully(repo, tf, owner, await input(X2, 'op_sync_second'), { now: NOW });
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(sheet.writes.length).toBe(writes);
  });

  it('sync writes only publication fields, never Content or Chinese Content', async () => {
    captureTelemetry();
    const { repo, tf, sheet, input } = setup();
    const mark = sheet.writes.length;
    await syncFromTypefully(repo, tf, owner, await input(X2, 'op_sync_fields'), { now: NOW });
    const fields = writtenFields(sheet, mark);
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) expect(SCHEDULE_SYNC_FIELDS).toContain(f);
  });
});

describe('TYPE-05: concurrent Typefully and Sheet edits never silently overwrite', () => {
  async function syncedThenBothEdited() {
    const ctx = setup();
    await syncFromTypefully(ctx.repo, ctx.tf, owner, await ctx.input(X2, 'op_sync_base'), { now: NOW });
    await ctx.edit(X2, 'finalContent', 'Sheet edit after the sync.');
    ctx.tf.editExternally('SYNTH-TF-1003', 'Typefully edit after the sync.');
    return ctx;
  }

  it('comparison shows both sides and reports both as newer', async () => {
    captureTelemetry();
    const { repo, tf } = await syncedThenBothEdited();
    const r = await reconcile(repo, tf, X2);
    expect(r.kind).toBe('linked');
    if (r.kind !== 'linked') return;
    expect(r.comparison).toMatchObject({ sheetFinal: 'Sheet edit after the sync.', typefully: 'Typefully edit after the sync.', newer: 'both', typefullyEditedSinceSync: true, sheetFinalEditedSinceSync: true });
  });

  it('Typefully to Sheet refuses; Final Content keeps the Sheet edit', async () => {
    captureTelemetry();
    const { repo, tf, row, input } = await syncedThenBothEdited();
    const r = await syncFromTypefully(repo, tf, owner, await input(X2, 'op_sync_conflict'), { now: NOW });
    expect(r).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'sheet_final_edited' } });
    expect((await row(X2)).cells.finalContent).toBe('Sheet edit after the sync.');
  });

  it('Sheet to Typefully refuses; Typefully keeps its edit', async () => {
    captureTelemetry();
    const { repo, tf, input } = await syncedThenBothEdited();
    const r = await pushToTypefully(repo, tf, owner, await input(X2, 'op_push_conflict'), { now: NOW });
    expect(r).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'typefully_edited' } });
    expect((await tf.getDraft('SYNTH-TF-1003')).text).toBe('Typefully edit after the sync.');
  });

  it('an explicit direction choice resolves the conflict', async () => {
    captureTelemetry();
    const { repo, tf, row, input } = await syncedThenBothEdited();
    const r = await syncFromTypefully(repo, tf, owner, { ...(await input(X2, 'op_sync_take_tf')), resolve: 'take_typefully' }, { now: NOW });
    expect(r.ok).toBe(true);
    expect((await row(X2)).cells.finalContent).toBe('Typefully edit after the sync.');
  });

  it('push is allowed when only the Sheet changed since the last sync, and restamps the baseline', async () => {
    captureTelemetry();
    const { repo, tf, row, edit, input } = setup();
    await syncFromTypefully(repo, tf, owner, await input(X2, 'op_sync_base2'), { now: NOW });
    await edit(X2, 'finalContent', 'Sheet-only edit  ');
    const r = await pushToTypefully(repo, tf, owner, await input(X2, 'op_push_ok'), { now: NOW });
    expect(r.ok).toBe(true);
    expect((await tf.getDraft('SYNTH-TF-1003')).text).toBe('Sheet-only edit  ');
    const after = await row(X2);
    const cmp = compareCopy(after.value, await tf.getDraft('SYNTH-TF-1003'));
    expect(cmp).toMatchObject({ identical: true, typefullyEditedSinceSync: false, sheetFinalEditedSinceSync: false, newer: 'same' });
  });

  it('never-synced row: Typefully edited after create blocks a push', async () => {
    captureTelemetry();
    const { repo, tf, input } = setup();
    const r = await pushToTypefully(repo, tf, owner, await input(X2, 'op_push_unsynced'), { now: NOW });
    expect(r).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'typefully_edited' } });
  });

  it('a Typefully edit racing the push is a CONFLICT from the provider precondition', async () => {
    captureTelemetry();
    const { repo, tf, edit, input } = setup();
    await syncFromTypefully(repo, tf, owner, await input(X2, 'op_sync_base3'), { now: NOW });
    await edit(X2, 'finalContent', 'Sheet change');
    tf.failNext('CONFLICT', 'updateDraft');
    const r = await pushToTypefully(repo, tf, owner, await input(X2, 'op_push_race'), { now: NOW });
    expect(r).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'typefully_changed_during_push' } });
  });

  it('a legacy sync stamp with no hash is treated as no baseline: differing Final Content is a conflict', async () => {
    captureTelemetry();
    const { repo, tf, edit, input } = setup();
    await edit(X1, 'finalContent', 'Edited in the Sheet at some point.');
    const r = await syncFromTypefully(repo, tf, owner, await input(X1, 'op_sync_legacy'), { now: NOW });
    expect(r).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'no_sync_baseline' } });
  });
});

describe('PUB-04: publication conflicts need reconciliation, not inference', () => {
  it('a different Post Link in the Sheet is a conflict for both syncs and nothing is written', async () => {
    captureTelemetry();
    const { repo, tf, sheet, edit, input } = setup();
    await edit(X1, 'postLink', 'https://x.com/example/status/1000000000000000999');
    const mark = sheet.writes.length;
    expect(await syncFromTypefully(repo, tf, owner, await input(X1, 'op_pub_link_a'), { now: NOW })).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'post_link_mismatch' } });
    expect(await syncAnalytics(repo, tf, owner, await input(X1, 'op_pub_link_b'), { now: NOW })).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'post_link_mismatch' } });
    expect(sheet.writes.length).toBe(mark);
  });

  it('a different Published At instant is a conflict; the same instant in another offset is not', async () => {
    captureTelemetry();
    const { repo, tf, edit, input } = setup();
    expect((await syncAnalytics(repo, tf, owner, await input(X1, 'op_pub_same_instant'), { now: NOW })).ok).toBe(true);
    await edit(X1, 'publishedAt', '2026-10-01T09:00:00+08:00');
    expect(await syncAnalytics(repo, tf, owner, await input(X1, 'op_pub_time'), { now: NOW })).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'published_at_mismatch' } });
  });

  it('a row marked Published that Typefully reports as not published is a conflict', async () => {
    captureTelemetry();
    const { repo, tf, edit, input } = setup();
    await edit(X2, 'typefullyStatus', 'Published');
    expect(await syncFromTypefully(repo, tf, owner, await input(X2, 'op_pub_status'), { now: NOW })).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'status_regressed' } });
  });
});

describe('PUB-01/02/03: per-platform analytics, blank versus zero, idempotent', () => {
  it('matching provider metrics produce no write at all (idempotent)', async () => {
    captureTelemetry();
    const { repo, tf, sheet, input } = setup();
    const mark = sheet.writes.length;
    const r = await syncAnalytics(repo, tf, owner, await input(X1, 'op_an_same'), { now: NOW });
    expect(r).toMatchObject({ ok: true, replayed: true });
    expect(r.steps.at(-1)?.status).toBe('skipped_already_applied');
    expect(sheet.writes.length).toBe(mark);
  });

  it('zero stays zero, unavailable stays blank, a recorded value is never erased', async () => {
    captureTelemetry();
    const { repo, tf, row, input } = setup();
    tf.setMetrics('SYNTH-TF-1001', { views: 1600, likes: 0, reposts: 6, replies: 0 });
    const r = await syncAnalytics(repo, tf, owner, await input(X1, 'op_an_update'), { now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.unavailable).toEqual(['bookmarks', 'newFollowers']);
    const c = (await row(X1)).cells;
    expect([c.views, c.likes, c.replies, c.bookmarks, c.newFollowers]).toEqual(['1600', '0', '0', '11', '']);
    expect(c.analyticsSyncedAt).toBe('2026-09-30T08:00:00+08:00');
  });

  it('analytics sync writes only sync fields and never Final Content, even when Typefully text differs', async () => {
    captureTelemetry();
    const { repo, tf, sheet, row, input } = setup();
    tf.editExternally('SYNTH-TF-1001', 'Changed in Typefully after publishing.');
    tf.setMetrics('SYNTH-TF-1001', { views: 2000 });
    const mark = sheet.writes.length;
    await syncAnalytics(repo, tf, owner, await input(X1, 'op_an_fields'), { now: NOW });
    const fields = writtenFields(sheet, mark);
    expect(fields).toEqual(expect.arrayContaining(['views', 'analyticsSyncedAt']));
    expect(fields).not.toContain('finalContent');
    for (const f of fields) expect(SCHEDULE_SYNC_FIELDS).toContain(f);
    expect((await row(X1)).cells.finalContent).toBe('Your first offer is a draft.\n\nTreat it like one.');
  });

  it('Threads row keeps its own figures and never receives X metrics', async () => {
    captureTelemetry();
    const { repo, tf, row, input } = setup();
    const r = await syncAnalytics(repo, tf, owner, await input(TH1, 'op_an_threads'), { now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.supplied).toEqual([]);
    const c = (await row(TH1)).cells;
    expect([c.views, c.likes, c.reposts]).toEqual(['830', '21', '']);
    expect(c.postLink).toBe('https://www.threads.net/@example/post/SYNTHpost1002');
    expect((await row(X1)).cells.views).toBe('1520');
  });

  it('a draft that is not published is reported as such, not as zero metrics', async () => {
    captureTelemetry();
    const { repo, tf, input } = setup();
    expect(await syncAnalytics(repo, tf, owner, await input(X2, 'op_an_unpublished'), { now: NOW })).toMatchObject({ ok: false, code: 'GATE_BLOCKED', details: { reason: 'not_published' } });
  });

  it('provider failure during analytics is distinct from unavailable metrics', async () => {
    captureTelemetry();
    const { repo, tf, input } = setup();
    tf.failNext('RATE_LIMITED', 'getPublication');
    expect(await syncAnalytics(repo, tf, owner, await input(X1, 'op_an_limited'), { now: NOW })).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});

describe('OBS-04: provider status, duration, rate limit and outcome are recorded without copy', () => {
  it('sentinel text, draft ids and Content IDs never appear in telemetry', async () => {
    const events = captureTelemetry();
    const SENTINEL = 'CS_COPY_SENTINEL_7Q2X';
    const { repo, tf, edit, input } = setup([
      { id: 'SYNTH-TF-1201', platform: 'X', text: `${SENTINEL} candidate`, status: 'Planned', scheduledAt: '2026-10-03T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z' },
    ]);
    tf.editExternally('SYNTH-TF-1003', `${SENTINEL} typefully text`);
    await edit(X2, 'finalContent', `${SENTINEL} sheet text`);
    await reconcile(repo, tf, X2);
    await reconcile(repo, tf, '2026-10-03-MAIN-X');
    await syncFromTypefully(repo, tf, owner, await input(X2, 'op_obs_sync'), { now: NOW });
    await pushToTypefully(repo, tf, owner, await input(X2, 'op_obs_push'), { now: NOW });
    tf.failNext('RATE_LIMITED', 'getPublication');
    await syncAnalytics(repo, tf, owner, await input(X1, 'op_obs_rate'), { now: NOW });
    await syncAnalytics(repo, tf, owner, await input(X1, 'op_obs_ok'), { now: NOW });

    const dump = JSON.stringify(events);
    expect(dump).not.toContain(SENTINEL);
    expect(dump).not.toMatch(/SYNTH-TF-/);
    expect(dump).not.toContain(X2);
    expect(dump).not.toContain('2026-10-03-MAIN-X');

    const calls = events.filter((e) => e.name.startsWith('typefully.call.'));
    expect(calls.length).toBeGreaterThan(0);
    for (const e of calls) {
      expect(typeof e.latencyMs).toBe('number');
      expect(e.targetHash).toMatch(/^[0-9a-f]{8}$/);
      expect(typeof e.facts?.rateLimited).toBe('boolean');
    }
    expect(calls.some((e) => e.code === 'RATE_LIMITED' && e.facts?.rateLimited === true)).toBe(true);
    const kinds = events.filter((e) => e.name === 'typefully.reconcile').map((e) => e.facts?.kind);
    expect(kinds).toEqual(['linked', 'ambiguous']);
  });
});

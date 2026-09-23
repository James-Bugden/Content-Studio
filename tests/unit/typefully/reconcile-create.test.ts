import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTelemetrySink } from '@/observability/events';
import { createDraft, createIdempotencyKey, linkDraft, reconcile } from '@/application/typefully';
import { NOW, captureTelemetry, owner, setup, viewer } from './harness';

beforeEach(() => {
  captureTelemetry();
});
afterEach(() => setTelemetrySink(null));

const X3 = '2026-10-03-MAIN-X';
const X3_TEXT = 'Recruiters read the first line.\n\nMake it about the job seeker, not the salary.';
const LI2 = '2026-10-02-MAIN-LI';

describe('TYPE-01: reconciliation states are distinct', () => {
  it('existing Typefully Draft ID is fetched first and reported as linked with a comparison', async () => {
    const { repo, tf } = setup();
    const r = await reconcile(repo, tf, '2026-10-02-MAIN-X');
    expect(r.kind).toBe('linked');
    if (r.kind !== 'linked') return;
    expect(r.draft.id).toBe('SYNTH-TF-1003');
    expect(r.comparison.sheetWorking).toContain('(edited)');
    expect(r.comparison.typefully).toContain('before you name a number');
    expect(tf.calls.map((c) => c.op)).toEqual(['getDraft']);
  });

  it('no candidate in the window is no_match (searched)', async () => {
    const { repo, tf } = setup();
    const r = await reconcile(repo, tf, X3);
    expect(r).toMatchObject({ kind: 'no_match', searched: true, row: { plannedAt: '2026-10-03T08:00:00+08:00', platform: 'X', slot: 'Main' } });
  });

  it('one exact candidate (same platform, time match, similarity >= 0.9) is single_match with discriminators', async () => {
    const { repo, tf } = setup([
      { id: 'SYNTH-TF-1101', platform: 'X', text: X3_TEXT, status: 'Planned', scheduledAt: '2026-10-03T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z' },
    ]);
    const r = await reconcile(repo, tf, X3);
    expect(r.kind).toBe('single_match');
    if (r.kind !== 'single_match') return;
    expect(r.discriminators).toMatchObject({ draftId: 'SYNTH-TF-1101', platform: 'X', date: '2026-10-03', time: '08:00', slot: 'Main', deltaMinutes: 0, similarity: 1, timeMatch: true, exact: true });
  });

  it('two candidates, or one uncertain candidate, are ambiguous with date/slot/platform/time/similarity per candidate', async () => {
    const { repo, tf } = setup([
      { id: 'SYNTH-TF-1101', platform: 'X', text: X3_TEXT, status: 'Planned', scheduledAt: '2026-10-03T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z' },
      { id: 'SYNTH-TF-1102', platform: 'X', text: 'Something else entirely about offers.', status: 'Typefully Draft', scheduledAt: '2026-10-03T01:00:00Z', updatedAt: '2026-09-29T00:00:00Z' },
      // Other platform in the same window is never a candidate.
      { id: 'SYNTH-TF-1103', platform: 'LinkedIn', text: X3_TEXT, status: 'Planned', scheduledAt: '2026-10-03T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z' },
    ]);
    const r = await reconcile(repo, tf, X3);
    expect(r.kind).toBe('ambiguous');
    if (r.kind !== 'ambiguous') return;
    expect(r.discriminators.map((d) => d.draftId)).toEqual(['SYNTH-TF-1101', 'SYNTH-TF-1102']);
    expect(r.discriminators[1]).toMatchObject({ platform: 'X', date: '2026-10-03', time: '09:00', slot: null, deltaMinutes: 60, timeMatch: false, exact: false });
    expect(r.discriminators[1]!.similarity).toBeLessThan(0.9);
  });

  it('a lone candidate that is only similar, or off-time, is ambiguous, not a match', async () => {
    const { repo, tf } = setup([
      { id: 'SYNTH-TF-1101', platform: 'X', text: X3_TEXT, status: 'Planned', scheduledAt: '2026-10-03T00:30:00Z', updatedAt: '2026-09-29T00:00:00Z' },
    ]);
    const r = await reconcile(repo, tf, X3);
    expect(r.kind).toBe('ambiguous');
  });

  it('a candidate already linked to another row is never an exact match', async () => {
    const { repo, tf, edit } = setup([
      { id: 'SYNTH-TF-1101', platform: 'X', text: X3_TEXT, status: 'Planned', scheduledAt: '2026-10-03T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z' },
    ]);
    await edit('2026-10-03-2ND-X', 'typefullyDraftId', 'SYNTH-TF-1101');
    const r = await reconcile(repo, tf, X3);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.discriminators[0]!.linkedToContentId).toBe('2026-10-03-2ND-X');
  });

  it('provider failure is provider_error with its own code, distinct from no_match', async () => {
    const { repo, tf } = setup();
    tf.failNext('PROVIDER_UNAVAILABLE', 'listDrafts');
    expect(await reconcile(repo, tf, X3)).toEqual({ kind: 'provider_error', provider: 'typefully', code: 'PROVIDER_UNAVAILABLE' });
    tf.failNext('RATE_LIMITED', 'getDraft');
    expect(await reconcile(repo, tf, '2026-10-02-MAIN-X')).toEqual({ kind: 'provider_error', provider: 'typefully', code: 'RATE_LIMITED' });
  });
});

describe('TYPE-03: ambiguity never links or creates', () => {
  it('create refuses with AMBIGUOUS_MATCH, creates nothing and leaves the row untouched', async () => {
    const { repo, tf, edit, row, input, sheet } = setup([
      { id: 'SYNTH-TF-1101', platform: 'X', text: X3_TEXT, status: 'Planned', scheduledAt: '2026-10-03T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z' },
      { id: 'SYNTH-TF-1102', platform: 'X', text: X3_TEXT, status: 'Planned', scheduledAt: '2026-10-03T00:02:00Z', updatedAt: '2026-09-29T00:00:00Z' },
    ]);
    await edit(X3, 'contentStage', 'Ready');
    const before = tf.all().length;
    const writes = sheet.writes.length;
    const r = await createDraft(repo, tf, owner, await input(X3, 'op_create_ambiguous'), { now: NOW });
    expect(r).toMatchObject({ ok: false, code: 'AMBIGUOUS_MATCH' });
    if (!r.ok) expect((r.details?.reconciliation as { discriminators: unknown[] }).discriminators).toHaveLength(2);
    expect(tf.all()).toHaveLength(before);
    expect(sheet.writes.length).toBe(writes);
    expect((await row(X3)).value.typefullyDraftId).toBe('');
  });

  it('a single exact match also blocks create; the human links it explicitly', async () => {
    const { repo, tf, edit, row, input } = setup([
      { id: 'SYNTH-TF-1101', platform: 'X', text: X3_TEXT, status: 'Planned', scheduledAt: '2026-10-03T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z' },
    ]);
    await edit(X3, 'contentStage', 'Ready');
    const refused = await createDraft(repo, tf, owner, await input(X3, 'op_create_single'), { now: NOW });
    expect(refused).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'existing_match' } });
    const linked = await linkDraft(repo, tf, owner, { ...(await input(X3, 'op_link_single')), draftId: 'SYNTH-TF-1101' });
    expect(linked.ok).toBe(true);
    expect((await row(X3)).value).toMatchObject({ typefullyDraftId: 'SYNTH-TF-1101' });
    expect((await row(X3)).cells.typefullyStatus).toBe('Planned');
  });

  it('link refuses a draft already linked to another row', async () => {
    const { repo, tf, input } = setup();
    const r = await linkDraft(repo, tf, owner, { ...(await input(X3, 'op_link_elsewhere')), draftId: 'SYNTH-TF-1003' });
    expect(r).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'linked_elsewhere' } });
  });
});

describe('TYPE-02: at most one provider draft and one linked row', () => {
  it('creates once, writes ID and status in the same row, planned at the Taipei slot time', async () => {
    const { repo, tf, row, input } = setup();
    const before = tf.all().length;
    const r = await createDraft(repo, tf, owner, await input(LI2, 'op_create_li2'), { now: NOW });
    expect(r.ok).toBe(true);
    const created = tf.all().slice(before);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ platform: 'LinkedIn', text: 'Old post using a screenshot.', status: 'Planned', scheduledAt: '2026-10-02T13:00:00.000Z' });
    const after = await row(LI2);
    expect(after.value.typefullyDraftId).toBe(created[0]!.id);
    expect(after.cells.typefullyStatus).toBe('Planned');
  });

  it('double click (concurrent, same operation) makes one draft', async () => {
    const { repo, tf, input } = setup();
    const before = tf.all().length;
    const i = await input(LI2, 'op_create_double');
    const [a, b] = await Promise.all([createDraft(repo, tf, owner, i, { now: NOW }), createDraft(repo, tf, owner, i, { now: NOW })]);
    expect(a.ok && b.ok).toBe(true);
    expect(tf.all().length - before).toBe(1);
  });

  it('a sequential retry of a finished operation replays without a second draft', async () => {
    const { repo, tf, input } = setup();
    const before = tf.all().length;
    const i = await input(LI2, 'op_create_twice');
    const first = await createDraft(repo, tf, owner, i, { now: NOW });
    const second = await createDraft(repo, tf, owner, i, { now: NOW });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(tf.all().length - before).toBe(1);
  });

  it('timeout after create, then retry of the same operation, links the existing draft instead of creating another', async () => {
    const { repo, tf, row, input } = setup();
    const before = tf.all().length;
    const i = await input(LI2, 'op_create_lost');
    tf.timeoutAfterCreateNext();
    const lost = await createDraft(repo, tf, owner, i, { now: NOW });
    expect(lost).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE', details: { reason: 'create_outcome_unknown' } });
    expect(tf.all().length - before).toBe(1);
    expect((await row(LI2)).value.typefullyDraftId).toBe('');

    const retry = await createDraft(repo, tf, owner, i, { now: NOW });
    expect(retry).toMatchObject({ ok: true, replayed: true });
    expect(retry.steps.find((s) => s.provider === 'typefully' && s.step.startsWith('create'))?.status).toBe('skipped_already_applied');
    expect(tf.all().length - before).toBe(1);
    expect((await row(LI2)).value.typefullyDraftId).toBe(tf.all().at(-1)!.id);
  });

  it('after a lost response, a NEW operation finds the orphan by slot and text and refuses to create', async () => {
    const { repo, tf, input } = setup();
    const before = tf.all().length;
    tf.timeoutAfterCreateNext();
    await createDraft(repo, tf, owner, await input(LI2, 'op_create_orphan'), { now: NOW });
    const other = await createDraft(repo, tf, owner, await input(LI2, 'op_create_other'), { now: NOW });
    expect(other).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'existing_match' } });
    expect(tf.all().length - before).toBe(1);
  });

  it('Sheet write failure after provider success is PARTIAL_FAILURE with the draft id; retry links, never re-creates', async () => {
    const { repo, tf, sheet, row, input } = setup();
    const before = tf.all().length;
    const i = await input(LI2, 'op_create_partial');
    sheet.failNext({ op: 'write', code: 'PROVIDER_UNAVAILABLE' });
    const partial = await createDraft(repo, tf, owner, i, { now: NOW });
    expect(partial).toMatchObject({ ok: false, code: 'PARTIAL_FAILURE' });
    const draftId = !partial.ok ? (partial.details?.draftId as string) : '';
    expect(draftId).toMatch(/^SYNTH-TF-/);
    const retry = await createDraft(repo, tf, owner, i, { now: NOW });
    expect(retry.ok).toBe(true);
    expect((await row(LI2)).value.typefullyDraftId).toBe(draftId);
    expect(tf.all().length - before).toBe(1);
  });

  it('the idempotency key comes from operation and Content ID only, and the fake does not dedupe on it (API has no key)', async () => {
    const key = createIdempotencyKey('op_same_operation', LI2);
    expect(key).toBe(createIdempotencyKey('op_same_operation', LI2));
    expect(key).not.toBe(createIdempotencyKey('op_other_operation', LI2));
    expect(key).toMatch(/^cs[0-9a-f]{16}$/);
    const { tf } = setup();
    const before = tf.all().length;
    await tf.createDraft({ platform: 'X', text: 'a', idempotencyKey: key });
    await tf.createDraft({ platform: 'X', text: 'a', idempotencyKey: key });
    expect(tf.all().length - before).toBe(2);
  });
});

describe('create gates', () => {
  it('X row not at Ready is blocked', async () => {
    const { repo, tf, input } = setup();
    expect(await createDraft(repo, tf, owner, await input(X3, 'op_gate_stage'), { now: NOW })).toMatchObject({ ok: false, code: 'GATE_BLOCKED', details: { reason: 'stage_not_ready' } });
  });

  it('Threads row with a stale zh-TW adaptation is blocked even at Ready', async () => {
    const { repo, tf, input, edit } = setup();
    await edit('2026-10-02-MAIN-TH', 'contentStage', 'Ready');
    expect(await createDraft(repo, tf, owner, await input('2026-10-02-MAIN-TH', 'op_gate_zh'), { now: NOW })).toMatchObject({
      ok: false,
      code: 'GATE_BLOCKED',
      details: { reason: 'zh_adaptation_not_approved', state: 'stale' },
    });
  });

  it('an already-linked row, a viewer and a bad operation id are refused before any provider call', async () => {
    const { repo, tf, input } = setup();
    expect(await createDraft(repo, tf, viewer, await input(LI2, 'op_viewer_try'), { now: NOW })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await createDraft(repo, tf, owner, { ...(await input(LI2, 'x')) }, { now: NOW })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(tf.calls).toHaveLength(0);
    const { repo: r2, tf: t2, edit, input: in2 } = setup();
    await edit('2026-10-01-MAIN-X', 'contentStage', 'Ready');
    expect(await createDraft(r2, t2, owner, await in2('2026-10-01-MAIN-X', 'op_linked_row'), { now: NOW })).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'already_linked' } });
  });
});

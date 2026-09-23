import { z } from 'zod';
import { getServices, resetServices } from '@/application/container';
import { PLATFORMS } from '@/domain/enums';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS, SHEET_TABS } from '@/domain/sheet-schema';
import { ERROR_CODES } from '@/domain/errors';
import { testAuthEnabled } from '@/lib/auth/policy';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * E2E-only control surface for deterministic journeys (T1). Exists only when
 * CS_DATA_MODE=fake and CS_TEST_MODE=e2e outside production; everywhere else it
 * is a 404. It can reset the synthetic fakes, inject a provider failure, or make
 * an "external" edit to simulate James changing the Sheet or Drive directly, or make
 * the fake AI fail or return malformed output, or drive the fake Typefully
 * (fault injection, an edit made in Typefully, extra candidate drafts).
 */
const metric = z.number().int().min(0).max(1_000_000_000).optional();
const typefullyAction = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('fail'),
    code: z.enum(ERROR_CODES),
    op: z.enum(['getDraft', 'listDrafts', 'findByIdempotencyKey', 'createDraft', 'updateDraft', 'getPublication']).optional(),
  }),
  z.object({ type: z.literal('timeout_after_create') }),
  z.object({ type: z.literal('edit'), draftId: z.string().max(64), text: z.string().max(5000) }),
  z.object({ type: z.literal('add'), platform: z.enum(PLATFORMS), text: z.string().max(5000), scheduleAt: z.string().max(40) }),
  z.object({
    type: z.literal('set_metrics'),
    draftId: z.string().max(64),
    metrics: z.object({ views: metric, likes: metric, reposts: metric, replies: metric, bookmarks: metric, newFollowers: metric }).nullable(),
  }),
  z.object({ type: z.literal('list') }),
]);

const bodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reset') }),
  z.object({
    kind: z.literal('fail'),
    provider: z.enum(['sheet', 'drive']),
    op: z.enum(['read', 'write', 'meta']),
    code: z.enum(ERROR_CODES),
    tab: z.string().max(40).optional(),
    times: z.number().int().min(1).max(10).optional(),
  }),
  z.object({
    kind: z.literal('sheet_edit'),
    libraryId: z.string().max(64),
    header: z.string().max(60),
    value: z.string().max(5000),
  }),
  z.object({ kind: z.literal('drive_replace'), fileId: z.string().max(200), find: z.string().max(2000), replace: z.string().max(2000) }),
  z.object({ kind: z.literal('ai_fail'), code: z.enum(ERROR_CODES).optional(), malformed: z.number().int().min(1).max(10).optional() }),
  z.object({ kind: z.literal('schedule_edit'), contentId: z.string().max(64), header: z.string().max(60), value: z.string().max(5000) }),
  z.object({ kind: z.literal('typefully'), action: typefullyAction }),
]);

export async function POST(request: Request) {
  if (!testAuthEnabled()) return new Response('Not found', { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false }, { status: 400 });
  const body = parsed.data;
  if (body.kind === 'reset') {
    resetServices();
    getServices();
    return json({ ok: true });
  }
  const fakes = getServices().fakes;
  if (!fakes) return new Response('Not found', { status: 404 });
  if (body.kind === 'fail') {
    if (body.provider === 'sheet' && body.op !== 'meta') fakes.sheet.failNext({ op: body.op, code: body.code, ...(body.tab ? { tab: body.tab } : {}), times: body.times ?? 1 });
    if (body.provider === 'drive') fakes.drive.failNext({ op: body.op, code: body.code, times: body.times ?? 1 });
    return json({ ok: true });
  }
  if (body.kind === 'ai_fail') {
    if (!fakes.ai) return new Response('Not found', { status: 404 });
    if (body.code) fakes.ai.failNext(body.code);
    if (body.malformed) fakes.ai.malformedNext(body.malformed);
    return json({ ok: true });
  }
  if (body.kind === 'typefully') {
    const tf = fakes.typefully;
    if (!tf) return new Response('Not found', { status: 404 });
    const a = body.action;
    if (a.type === 'fail') tf.failNext(a.code, a.op);
    if (a.type === 'timeout_after_create') tf.timeoutAfterCreateNext();
    if (a.type === 'edit') tf.editExternally(a.draftId, a.text);
    if (a.type === 'set_metrics') tf.setMetrics(a.draftId, a.metrics ? (Object.fromEntries(Object.entries(a.metrics).filter(([, v]) => v !== undefined)) as Record<string, number>) : undefined);
    if (a.type === 'add') {
      const d = await tf.createDraft({ platform: a.platform, text: a.text, idempotencyKey: 'e2e-seed', scheduleAt: a.scheduleAt, timing: 'plan' });
      return json({ ok: true, draftId: d.id });
    }
    if (a.type === 'list') {
      return json({ ok: true, drafts: tf.all().map((d) => ({ id: d.id, platform: d.platform, text: d.text, status: d.status, scheduledAt: d.scheduledAt ?? null })) });
    }
    return json({ ok: true });
  }
  if (body.kind === 'schedule_edit') {
    const grid = fakes.sheet.rawTab(SHEET_TABS.schedule.name);
    const headerRow = grid.findIndex((r) => r.some((c) => c.value === SCHEDULE_HEADERS.contentId));
    const header = grid[headerRow]?.map((c) => c.value) ?? [];
    const idCol = header.indexOf(SCHEDULE_HEADERS.contentId);
    const col = header.indexOf(body.header);
    const row = grid.findIndex((r, i) => i > headerRow && r[idCol]?.value === body.contentId);
    if (headerRow < 0 || col < 0 || row < 0) return json({ ok: false }, { status: 404 });
    fakes.sheet.externalEdit(SHEET_TABS.schedule.name, row + 1, col, body.value);
    return json({ ok: true });
  }
  if (body.kind === 'sheet_edit') {
    const grid = fakes.sheet.rawTab(SHEET_TABS.library.name);
    const header = grid[0]?.map((c) => c.value) ?? [];
    const idCol = header.indexOf(LIBRARY_HEADERS.libraryId);
    const col = header.indexOf(body.header);
    const row = grid.findIndex((r) => r[idCol]?.value === body.libraryId);
    if (col < 0 || row < 1) return json({ ok: false }, { status: 404 });
    fakes.sheet.externalEdit(SHEET_TABS.library.name, row + 1, col, body.value);
    return json({ ok: true });
  }
  const text = fakes.drive.textOf(body.fileId);
  fakes.drive.externalEdit(body.fileId, text.replace(body.find, body.replace));
  return json({ ok: true });
}

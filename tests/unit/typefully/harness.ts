import { setTelemetrySink, type TelemetryEvent } from '@/observability/events';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeTypefullyGateway } from '@/integrations/typefully/fake-gateway';
import { SHEET_TABS, type ScheduleField } from '@/domain/sheet-schema';
import type { Actor } from '@/domain/mutation';
import type { ScheduleRecord } from '@/domain/records';
import { SCHEDULE_ORDER, SYNTH_TYPEFULLY_DRAFTS, type SyntheticTypefullyDraft } from '@/fixtures/synthetic';

export const owner: Actor = { sub: '100000000000000000001', role: 'owner' };
export const viewer: Actor = { sub: '100000000000000000002', role: 'viewer' };
export const SCHEDULE = SHEET_TABS.schedule.name;
/** Before every synthetic slot, so planned times are in the future. */
export const NOW = () => new Date('2026-09-30T00:00:00Z');

export function setup(extra: SyntheticTypefullyDraft[] = []) {
  const sheet = new FakeSheetTransport();
  const repo = new SheetsContentRepository(sheet);
  const tf = new FakeTypefullyGateway([...SYNTH_TYPEFULLY_DRAFTS, ...extra], NOW);
  const row = (id: string): Promise<ScheduleRecord> => repo.getSchedule(id);
  const edit = async (contentId: string, field: ScheduleField, value: string) => {
    const r = await row(contentId);
    sheet.externalEdit(SCHEDULE, r.row, SCHEDULE_ORDER.indexOf(field), value);
  };
  const input = async (contentId: string, operationId: string) => ({ operationId, contentId, expectedRevision: (await row(contentId)).revision });
  return { sheet, repo, tf, row, edit, input };
}

/** Columns a list of Schedule writes touched, as field names. */
export function writtenFields(sheet: FakeSheetTransport, since = 0): ScheduleField[] {
  return sheet.writes
    .slice(since)
    .filter((w) => w.tab === SCHEDULE)
    .flatMap((w) => w.writes.map((c) => SCHEDULE_ORDER[c.column]!));
}

/** Captures redacted telemetry for the current test instead of printing it. */
export function captureTelemetry(): (TelemetryEvent & { at: string })[] {
  const events: (TelemetryEvent & { at: string })[] = [];
  setTelemetrySink((e) => events.push(e));
  return events;
}

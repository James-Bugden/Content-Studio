import { PLATFORMS, SLOTS, type Platform, type Slot } from './enums';
import type { QueueSummaryRow, SlotPolicy, WorkflowSettings } from './records';

/**
 * Workflow Settings parsing (SCHED-01). The live tab is `Setting | Value | Notes`.
 * Active forward-looking slots are X/Threads Main + 2nd and LinkedIn Main.
 * Legacy X/Threads 3rd settings are still parsed so historical rows remain readable,
 * but schedule-domain rules prevent them from receiving new content.
 * A missing or malformed slot never falls back to a guessed time.
 */
const SLOT_KEY = /^(X|Threads|LinkedIn)\s+(Main|2nd|3rd)$/i;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseWorkflowSettings(rows: readonly (readonly unknown[])[]): WorkflowSettings {
  const raw: Record<string, string> = {};
  const problems: string[] = [];
  const slots: SlotPolicy[] = [];
  const headerAt = rows.findIndex((r) => String(r[0] ?? '').trim() === 'Setting' && String(r[1] ?? '').trim() === 'Value');
  if (headerAt < 0) {
    return { timezone: 'Asia/Taipei', slots: [], raw, problems: ['Workflow Settings has no Setting/Value header'] };
  }
  for (const row of rows.slice(headerAt + 1)) {
    const key = String(row[0] ?? '').trim();
    const value = String(row[1] ?? '').trim();
    if (!key) continue;
    raw[key] = value;
    const m = SLOT_KEY.exec(key);
    if (!m) continue;
    const platform = PLATFORMS.find((p) => p.toLowerCase() === m[1]!.toLowerCase()) as Platform;
    const slot = SLOTS.find((s) => s.toLowerCase() === m[2]!.toLowerCase()) as Slot;
    if (slots.some((s) => s.platform === platform && s.slot === slot)) {
      problems.push(`Duplicate slot setting: ${platform} ${slot}`);
      continue;
    }
    if (value.toUpperCase() === 'TBD') slots.push({ platform, slot, time: 'TBD' });
    else if (TIME.test(value)) slots.push({ platform, slot, time: value });
    else problems.push(`Slot ${platform} ${slot} has an unreadable time`);
  }
  const tz = raw['Timezone'] ?? 'Asia/Taipei';
  if (tz !== 'Asia/Taipei') problems.push('Only Asia/Taipei is supported');
  return { timezone: 'Asia/Taipei', slots, raw, problems };
}

export function slotPolicy(settings: WorkflowSettings, platform: Platform, slot: Slot): SlotPolicy | null {
  return settings.slots.find((s) => s.platform === platform && s.slot === slot) ?? null;
}

/**
 * Content Queue Summary: the first row with a `Content Source` header defines the
 * columns; numeric columns become counts. Counts come from the Sheet, never from
 * client-side guesses (REV spec).
 */
export function parseQueueSummary(rows: readonly { values: readonly unknown[]; links?: readonly (string | null | undefined)[] }[]): QueueSummaryRow[] {
  const headerAt = rows.findIndex((r) => String(r.values[0] ?? '').trim() === 'Content Source');
  if (headerAt < 0) return [];
  const header = rows[headerAt]!.values.map((v) => String(v ?? '').trim());
  const out: QueueSummaryRow[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    const source = String(row.values[0] ?? '').trim();
    if (!source) continue;
    const counts: Record<string, number | null> = {};
    let masterLink = '';
    header.forEach((name, i) => {
      if (i === 0 || !name) return;
      const text = String(row.values[i] ?? '').trim();
      if (/master/i.test(name)) {
        masterLink = row.links?.[i] ?? '';
        return;
      }
      const n = Number(text.replace(/,/g, ''));
      counts[name] = text === '' ? null : Number.isFinite(n) ? n : null;
    });
    out.push({ source, counts, masterLink });
  }
  return out;
}

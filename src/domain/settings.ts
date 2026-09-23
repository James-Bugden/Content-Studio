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
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const PILLARS = ['Personal story', 'Expertise', 'Social proof', 'Trending', 'Opinions', 'Build in public (Soar)'] as const;

type DayCadence = { morning: string; evening: string; linkedin: string };

function parseCadence(value: string, note: string): DayCadence | null {
  const x = /^X\/Threads AM:\s*(.+?)\s*\|\s*PM:\s*(.+)$/.exec(value.trim());
  const li = /^LinkedIn:\s*(.+)$/.exec(note.trim());
  if (!x || !li) return null;
  const morning = x[1]!.trim();
  const evening = x[2]!.trim();
  const linkedin = li[1]!.trim();
  if (![morning, evening, linkedin].every((v) => (PILLARS as readonly string[]).includes(v))) return null;
  return { morning, evening, linkedin };
}

/** Reads the day/slot pillar from the live Workflow Settings rows. */
export function scheduledPillar(settings: WorkflowSettings, isoDate: string, platform: Platform, slot: Slot): string | null {
  if (slot === '3rd' || (platform === 'LinkedIn' && slot !== 'Main') || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const day = DAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()]!;
  const key = `${day} cadence`;
  const cadence = parseCadence(settings.raw[key] ?? '', settings.rawNotes[key] ?? '');
  if (!cadence) return null;
  if (platform === 'LinkedIn') return cadence.linkedin;
  return slot === 'Main' ? cadence.morning : cadence.evening;
}

export function parseWorkflowSettings(rows: readonly (readonly unknown[])[]): WorkflowSettings {
  const raw: Record<string, string> = {};
  const rawNotes: Record<string, string> = {};
  const problems: string[] = [];
  const slots: SlotPolicy[] = [];
  const headerAt = rows.findIndex((r) => String(r[0] ?? '').trim() === 'Setting' && String(r[1] ?? '').trim() === 'Value');
  if (headerAt < 0) {
    return { timezone: 'Asia/Taipei', slots: [], raw, rawNotes, problems: ['Workflow Settings has no Setting/Value header'] };
  }
  for (const row of rows.slice(headerAt + 1)) {
    const key = String(row[0] ?? '').trim();
    const value = String(row[1] ?? '').trim();
    const note = String(row[2] ?? '').trim();
    if (!key) continue;
    raw[key] = value;
    rawNotes[key] = note;
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
  for (const day of DAYS) {
    const key = `${day} cadence`;
    if (!parseCadence(raw[key] ?? '', rawNotes[key] ?? '')) problems.push(`Cadence setting is missing or unreadable: ${key}`);
  }
  const tz = raw['Timezone'] ?? 'Asia/Taipei';
  if (tz !== 'Asia/Taipei') problems.push('Only Asia/Taipei is supported');
  return { timezone: 'Asia/Taipei', slots, raw, rawNotes, problems };
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

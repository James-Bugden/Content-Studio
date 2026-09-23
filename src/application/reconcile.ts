import 'server-only';
import { evaluateLibraryGates } from '@/domain/gates';
import { shortHash } from '@/domain/hash';
import { findSection } from '@/domain/markdown';
import type { LibraryRecord, ScheduleRecord } from '@/domain/records';
import { adaptationState } from '@/domain/zh-state';
import { evaluateAlerts, summariseEvents, THRESHOLDS, type Alert, type EventSummary } from '@/observability/alerts';
import { recentEvents, targetHash } from '@/observability/events';
import type { Capability } from '@/domain/capability';
import { capabilities } from './capabilities';
import { markdownFileId } from './markdown-source';
import { finalEditedSinceSync } from '@/domain/typefully-view';
import { addDays, parseContentId } from '@/domain/schedule';
import type { ContentRepository, DriveGateway, TypefullyGateway } from './ports';
import { today } from './schedule';
import { reconcileRecord } from './typefully';

/**
 * Reconciliation centre (CS-017).
 *
 * Every item is recomputed from the authorities on every load: a Sheet or Drive
 * re-read, never a stored list. So an item disappears only when the sources
 * actually agree again (REV-09). Items carry safe facts, stable ids, the
 * operation id when there is one, and one explicit recovery action.
 */
export type ReconcileKind =
  | 'schema_drift'
  | 'provider_config'
  | 'markdown_mismatch'
  | 'markdown_missing'
  | 'stale_approval'
  | 'stale_visual_approval'
  | 'zh_stale'
  | 'zh_ambiguous'
  | 'stale_published_sync'
  | 'typefully_ambiguous'
  | 'typefully_sync_conflict'
  | 'partial_mutation';

export type ReconcileItem = {
  id: string;
  kind: ReconcileKind;
  severity: 'blocking' | 'attention';
  title: string;
  facts: string[];
  stableIds: string[];
  operationId?: string;
  action: { label: 'Compare' | 'Retry' | 'Relink' | 'Fix in the Sheet' | 'Configure' | 'Review'; href?: string };
};

export type ReconcileReport = {
  items: ReconcileItem[];
  alerts: Alert[];
  events: EventSummary[];
  capabilities: Capability[];
  checkedAt: string;
  /** Sources that could not be read; their items are unknown, not absent. */
  unreadable: string[];
};

function item(kind: ReconcileKind, severity: ReconcileItem['severity'], title: string, facts: string[], stableIds: string[], action: ReconcileItem['action'], operationId?: string): ReconcileItem {
  return { id: shortHash(JSON.stringify([kind, stableIds, facts])), kind, severity, title, facts, stableIds, action, ...(operationId ? { operationId } : {}) };
}

const SYNC_FRESH_MS = THRESHOLDS.staleSyncMs;

export function stalePublishedRows(schedule: ScheduleRecord[], now = Date.now()): ScheduleRecord[] {
  return schedule.filter((r) => {
    const v = r.value;
    if (!v.typefullyStatus.ok || v.typefullyStatus.value !== 'Published') return false;
    const last = Math.min(Date.parse(v.finalSyncedAt) || 0, Date.parse(v.analyticsSyncedAt) || 0);
    return now - last > SYNC_FRESH_MS;
  });
}

/** How far ahead the Typefully scan looks for Ready rows without a Draft ID. */
export const TYPEFULLY_SCAN_DAYS = 7;

export async function buildReconcileReport(
  repo: ContentRepository,
  drive: DriveGateway,
  now = Date.now(),
  options: { typefully?: TypefullyGateway; today?: string } = {},
): Promise<ReconcileReport> {
  const items: ReconcileItem[] = [];
  const unreadable: string[] = [];

  const caps = capabilities();
  for (const c of caps) {
    if (c.state === 'not_configured' || c.state === 'unavailable') {
      const facts = [c.detail ?? 'Configuration is missing.'];
      if (c.provider === 'typefully') facts.push('Typefully linking, draft creation and sync are off. Review and scheduling keep working.');
      items.push(item('provider_config', c.provider === 'sheet' || c.provider === 'auth' ? 'blocking' : 'attention', `${c.provider} is ${c.state.replace('_', ' ')}`, facts, [c.provider], { label: 'Configure' }));
    }
  }

  const schema = await repo.schema().catch(() => null);
  if (!schema) unreadable.push('Sheet schema');
  for (const t of schema?.tabs ?? []) {
    if (!t.ok) {
      items.push(
        item(
          'schema_drift',
          'blocking',
          `${t.tab} columns do not match the mapping`,
          t.problems.map((p) => (p.kind === 'missing' ? `Missing or renamed: ${p.header}` : `Duplicated: ${p.header}`)),
          [t.tab],
          { label: 'Fix in the Sheet' },
        ),
      );
    }
  }

  let library: LibraryRecord[] = [];
  let schedule: ScheduleRecord[] = [];
  try {
    library = await repo.listLibrary();
  } catch {
    unreadable.push('Content Library');
  }
  try {
    schedule = await repo.listSchedule();
  } catch {
    unreadable.push('Content Schedule');
  }

  // Sheet vs Markdown, reading each master file once.
  const byFile = new Map<string, LibraryRecord[]>();
  for (const r of library) {
    const id = markdownFileId(r);
    if (id) byFile.set(id, [...(byFile.get(id) ?? []), r]);
  }
  for (const [fileId, rows] of byFile) {
    let text: string;
    try {
      text = (await drive.readText(fileId)).text;
    } catch {
      unreadable.push(`Markdown file ${shortHash(fileId)}`);
      continue;
    }
    for (const r of rows) {
      const found = findSection(text, r.value.libraryId);
      if (!found.ok) {
        // Rows without a section are only a problem once they are in review or approved.
        if (r.value.draftContent.trim() === '') continue;
        items.push(
          item('markdown_missing', 'attention', found.reason === 'duplicate' ? `${r.value.libraryId} has more than one Markdown section` : `${r.value.libraryId} has no Markdown section`, [found.reason === 'duplicate' ? `${found.count} sections claim this Library ID.` : 'No heading carries this Library ID.'], [r.value.libraryId], { label: 'Fix in the Sheet' }),
        );
      } else if (found.section.body !== r.value.draftContent) {
        items.push(item('markdown_mismatch', 'blocking', `${r.value.libraryId}: Sheet draft and Markdown differ`, ['The Markdown section is canonical; the Sheet mirror is out of date or edited directly.'], [r.value.libraryId], { label: 'Compare', href: `/review/${encodeURIComponent(r.value.libraryId)}` }));
      }
    }
  }

  // Stale approvals.
  for (const r of library) {
    const codes = evaluateLibraryGates(r.value, { purpose: 'review' }).blockers.map((g) => g.code);
    if (codes.includes('APPROVAL_STALE')) {
      items.push(item('stale_approval', 'blocking', `${r.value.libraryId}: approval no longer matches the copy`, ['The copy, hook or visual changed after approval.'], [r.value.libraryId], { label: 'Review', href: `/review/${encodeURIComponent(r.value.libraryId)}` }));
    }
    if (codes.includes('VISUAL_STALE')) {
      items.push(item('stale_visual_approval', 'blocking', `${r.value.libraryId}: image approval is out of date`, ['The brief, file, alt text or version changed after the image was approved.'], [r.value.libraryId], { label: 'Review', href: `/visuals/${encodeURIComponent(r.value.libraryId)}` }));
    }
  }

  // zh-TW lineage.
  const posts = schedule.map((r) => r.value);
  for (const r of schedule) {
    const v = r.value;
    if (!(v.platform?.ok && v.platform.value === 'X') || !v.hook) continue;
    const state = adaptationState(v, posts);
    if (state === 'stale') {
      items.push(item('zh_stale', 'blocking', `${v.contentId}: Threads adaptation is out of date`, ['The X copy changed after the zh-TW adaptation was made.'], [v.contentId], { label: 'Review', href: `/schedule/${encodeURIComponent(v.contentId)}/adapt` }));
    } else if (state === 'ambiguous') {
      items.push(item('zh_ambiguous', 'blocking', `${v.contentId}: several Threads rows claim this post`, ['Parent Content ID links more than one Threads row.'], [v.contentId], { label: 'Relink', href: `/schedule/${encodeURIComponent(v.contentId)}/adapt` }));
    }
  }

  // Published rows whose final copy or analytics have not synced recently.
  const stale = stalePublishedRows(schedule, now);
  for (const r of stale) {
    items.push(item('stale_published_sync', 'attention', `${r.value.contentId}: published but not synced for over 48 hours`, [`Final synced: ${r.value.finalSyncedAt || 'never'}; analytics synced: ${r.value.analyticsSyncedAt || 'never'}.`], [r.value.contentId], { label: 'Retry', href: `/published/${encodeURIComponent(r.value.contentId)}` }));
  }

  // Typefully: Final Content edited in the Sheet after the last sync (TYPE-05). Pure; no provider call.
  for (const r of schedule) {
    const v = r.value;
    if (!v.typefullyDraftId || finalEditedSinceSync(v) !== true) continue;
    items.push(
      item('typefully_sync_conflict', 'attention', `${v.contentId}: Final Content changed in the Sheet after the last Typefully sync`, ['The Sheet and Typefully may now disagree. Nothing is overwritten until you choose a direction.'], [v.contentId], {
        label: 'Compare',
        href: `/schedule/${encodeURIComponent(v.contentId)}`,
      }),
    );
  }

  // Typefully: Ready rows with no Draft ID in the next days whose candidates are ambiguous (TYPE-03).
  const tf = options.typefully;
  const tfReady = tf ? tf.capability().state : null;
  if (tf && (tfReady === 'ready' || tfReady === 'read_only' || tfReady === 'degraded')) {
    const from = options.today ?? today();
    const until = addDays(from, TYPEFULLY_SCAN_DAYS);
    const due = schedule.filter((r) => {
      const v = r.value;
      const parsed = parseContentId(v.contentId);
      return !v.typefullyDraftId && v.contentStage?.ok && v.contentStage.value === 'Ready' && parsed && parsed.isoDate >= from && parsed.isoDate <= until;
    });
    for (const r of due) {
      const rec = await reconcileRecord(repo, tf, schedule, r);
      if (rec.kind === 'provider_error') {
        unreadable.push('Typefully drafts');
        break;
      }
      if (rec.kind !== 'ambiguous') continue;
      items.push(
        item('typefully_ambiguous', 'attention', `${r.value.contentId}: ${rec.candidates.length} Typefully drafts could match`, ['None is linked or created automatically. Pick the right draft by date, slot, platform, planned time and similarity.'], [r.value.contentId], {
          label: 'Review',
          href: `/schedule/${encodeURIComponent(r.value.contentId)}`,
        }),
      );
    }
  }

  // Partial mutations seen by this server instance, mapped back to ids by hash.
  const libraryIds = new Set(library.map((r) => r.value.libraryId));
  const idByHash = new Map<string, string>();
  for (const r of library) idByHash.set(targetHash(r.value.libraryId), r.value.libraryId);
  for (const r of schedule) if (r.value.contentId) idByHash.set(targetHash(r.value.contentId), r.value.contentId);
  const events = recentEvents();
  const seenOps = new Set<string>();
  for (const e of [...events].reverse()) {
    if (!e.operationId || seenOps.has(e.operationId)) continue;
    seenOps.add(e.operationId);
    if (e.outcome !== 'partial') continue;
    const id = e.targetHash ? idByHash.get(e.targetHash) : undefined;
    items.push(
      item(
        'partial_mutation',
        'blocking',
        `Operation ${e.operationId} finished only some steps`,
        [`Step group: ${e.name}.`, id ? `Target: ${id}.` : 'Target could not be matched to a current row.'],
        id ? [id] : [],
        { label: 'Retry', ...(id && libraryIds.has(id) ? { href: `/review/${encodeURIComponent(id)}` } : id ? { href: `/schedule/${encodeURIComponent(id)}/adapt` } : {}) },
        e.operationId,
      ),
    );
  }

  const order: Record<ReconcileItem['severity'], number> = { blocking: 0, attention: 1 };
  items.sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind));
  return {
    items,
    alerts: evaluateAlerts(events, stale.length, now),
    events: summariseEvents(events),
    capabilities: caps,
    checkedAt: new Date(now).toISOString(),
    unreadable,
  };
}

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
import type { ContentParityJournal } from './content-parity';
import { fixIssuesCount, rememberNavigationCount } from './navigation-counts';
import type { ContentWriteCutover, ExportIssue } from './content-export';
import { exportKey } from './content-export';
import type { BackupJournal } from './content-backup';
import type { MarkdownExporter } from './markdown-export';
import { isAppError } from '@/domain/errors';
import { mapLimitSettled, withTimeout } from '@/lib/concurrency';
import type { LiveCutoverOps } from './live-content-cutover';

/**
 * Reconciliation centre (CS-017).
 *
 * Every item is recomputed from the authorities on every load: a database or
 * Drive re-read, never a stored list. So an item disappears only when the sources
 * actually agree again (REV-09). Items carry safe facts, stable ids, the
 * operation id when there is one, and one explicit recovery action.
 *
 * CS #250: the database checks and the two slow provider checks (Drive, Typefully)
 * are separate parts so a page can show the first immediately and stream the rest.
 */
export type ReconcileKind =
  | 'schema_drift'
  | 'cutover_blocked'
  | 'refresh_pending'
  | 'import_lag'
  | 'content_parity'
  | 'export_lag'
  | 'export_mismatch'
  | 'export_parity'
  | 'backup_fresh'
  | 'backup_waived'
  | 'provider_config'
  | 'markdown_export_lag'
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
  action: { label: 'Compare' | 'Retry' | 'Relink' | 'Restore Drive link' | 'Fix mapping' | 'Add section' | 'Configure' | 'Review'; href?: string };
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
/** At most this many rows are sent to Typefully per run, newest first. */
export const TYPEFULLY_SCAN_MAX = 50;
/** Provider reads run this many at a time. */
export const PROVIDER_CONCURRENCY = 5;
/** One provider call that takes longer than this counts as failed, not slow. */
export const PROVIDER_TIMEOUT_MS = 8_000;
/** How long the slow checks (Drive, Typefully) may be reused by a refresh or the nav badge. */
export const SLOW_CACHE_TTL_MS = 60_000;

export type ReconcileOptions = {
  typefully?: TypefullyGateway;
  today?: string;
  contentParity?: ContentParityJournal;
  contentCutover?: ContentWriteCutover;
  backupJournal?: BackupJournal;
  markdownExport?: MarkdownExporter;
  liveCutover?: LiveCutoverOps;
  /** Reuse slow results for `ttlMs`; `fresh` skips the cache and replaces it. Off by default. */
  cache?: { ttlMs: number; fresh?: boolean };
  concurrency?: number;
  providerTimeoutMs?: number;
};

/** A slow, provider-backed check. It never throws for one failing call: it reports `failed`. */
export type SlowSection = {
  items: ReconcileItem[];
  unreadable: string[];
  /** Provider calls that failed or timed out; their rows are unknown, not clear. */
  failed: number;
  /** Provider calls made. */
  checked: number;
};

const emptySection = (): SlowSection => ({ items: [], unreadable: [], failed: 0, checked: 0 });

type Context = {
  now: number;
  items: ReconcileItem[];
  unreadable: string[];
  caps: Capability[];
  library: LibraryRecord[];
  schedule: ScheduleRecord[];
  dbBody: boolean;
  queuedMarkdown: Set<string>;
  editedMarkdown: Set<string>;
  byFile: Map<string, LibraryRecord[]>;
  navigationSnapshots: ReturnType<NonNullable<ContentRepository['navigationSnapshots']>> | undefined;
};

/** Database-only checks plus the Sheet-era ones when their options are passed. No Drive or Typefully call. */
async function loadContext(repo: ContentRepository, options: ReconcileOptions, now: number): Promise<Context> {
  const items: ReconcileItem[] = [];
  const unreadable: string[] = [];
  let backupWaived = false;
  if (options.liveCutover) {
    const status = await options.liveCutover.status().catch(() => ({ blocking: 'cutover_admission_unavailable' }));
    if (status.blocking) items.push(item('cutover_blocked', 'blocking', 'Content writes are blocked',
      [status.blocking, 'Deploy the recorded compatible contract or run the owner rollback procedure. Private backup and rollback remain available while database authority exists.'], [], { label: 'Review' }));
    if ('backupWaiver' in status && status.backupWaiver) {
      backupWaived = true;
      items.push(item('backup_waived', 'attention', 'Backup gate waived by owner',
        [`Owner decision on ${status.backupWaiver.on}; recorded ${status.backupWaiver.recordedAt}. Recovery relies on Supabase daily plan backups and the exact one-way Sheet export. No independent archive of history or ledger exists outside the project. Rollback and all measured gates still apply.`], [], { label: 'Review' }));
      if (status.backupFailure) items.push(item('backup_fresh', 'attention', 'Verified backup needs attention',
        ['A previous private backup attempt failed. The owner waiver does not erase this failure.'], [], { label: 'Review' }));
    }
  }
  if (options.contentCutover) {
    const exporter = options.contentCutover.exporter;
    const mismatches = new Map<string, ExportIssue>();
    try {
      // Fresh inspection does not write. A hand edit appears even before repair.
      const parity = await exporter.parity();
      for (const issue of parity.differences) {
        if (exporter.journal.issues.get(exportKey(issue.kind, issue.id))?.reason === 'export_lag') continue;
        mismatches.set(exportKey(issue.kind, issue.id), { ...issue, recovery: exporter.journal.issues.get(exportKey(issue.kind, issue.id))?.recovery });
      }
      const comparison = exporter.comparison(now, options.contentCutover.mutationCount);
      items.push(item('export_parity', parity.exact ? 'attention' : 'blocking', parity.exact ? 'Sheet export matches the database' : 'Sheet export parity is blocked',
        [`${Object.values(parity.counts).reduce((n, c) => n + c, 0)} rows; exact fields: ${parity.exact}. ${comparison.daily.filter(d => d.green).length}/14 complete days green; ${comparison.mutationCount}/50 mutations. Daily lag p95 must be at most 15 minutes; no failure may remain for an hour. Export observations do not change authority.`], [], { label: 'Review' }));
    } catch (error) {
      unreadable.push('Sheet export parity');
      if (isAppError(error) && error.details.reason === 'duplicate_export_id') items.push(item('export_mismatch', 'blocking', 'Duplicate Sheet export IDs',
        [`${error.details.kind}: duplicate stable IDs prevent export and rollback. Fix the duplicate in the Sheet.`], [], { label: 'Review' }));
    }
    for (const [key, issue] of exporter.journal.issues) if (issue.reason === 'export_mismatch' && !mismatches.has(key)) mismatches.set(key, issue);
    for (const issue of mismatches.values()) {
      const valueFields = exporter.journal.issues.get(exportKey(issue.kind, issue.id))?.fields ?? [];
      const needsDirection = issue.recovery !== 'change_authoritative_value' || issue.fields.some(field => !valueFields.includes(field));
      items.push(item('export_mismatch', 'blocking', 'Sheet export differs; row preserved',
      [`${issue.kind}: ${issue.fields.join(', ')}. ${issue.recovery === 'change_authoritative_value' ? 'Change authoritative value: use the normal audited DB patch to choose text without a leading equals sign, then retry export. See the cutover runbook. ' : ''}${needsDirection ? 'Review the direction in the cutover runbook; no automatic overwrite.' : ''}`.trim()], [issue.id], { label: 'Review' }));
    }
    for (const issue of exporter.journal.issues.values()) {
      const since = issue.reason === 'export_lag' ? issue.since : issue.lagSince;
      if (since === undefined) continue;
      const age = now - since;
      if (age >= 900_000) items.push(item('export_lag', age >= 3600_000 ? 'blocking' : 'attention', 'Sheet export is behind',
        [`${Math.floor(age / 60000)} minutes since the first failed export.`], [issue.id], { label: 'Retry' }));
    }
    const last = options.backupJournal?.lastVerified;
    if ((!backupWaived && (!last || now - last.verifiedAt > 36 * 3600_000)) || options.backupJournal?.failureSince != null) items.push(item('backup_fresh', 'attention', 'Verified backup needs attention',
      [last ? 'Last verified backup is older than 36 hours or a later backup failed.' : 'No verified backup has been recorded. Supabase plan backups still require owner confirmation.'], [], { label: 'Review' }));
  }

  const caps = capabilities();
  for (const c of caps) {
    if (c.state === 'not_configured' || c.state === 'unavailable') {
      const facts = [c.detail ?? 'Configuration is missing.'];
      if (c.provider === 'typefully') facts.push('Typefully linking, draft creation and sync are off. Review and scheduling keep working.');
      items.push(item('provider_config', c.provider === 'sheet' || c.provider === 'auth' ? 'blocking' : 'attention', `${c.provider} is ${c.state.replace('_', ' ')}`, facts, [c.provider], { label: 'Configure' }));
    }
  }

  // The four independent database reads run together.
  const [schema, libraryRead, scheduleRead] = await Promise.all([
    repo.schema().catch(() => null),
    repo.listLibrary().then((value) => ({ value }), () => null),
    repo.listSchedule().then((value) => ({ value }), () => null),
  ]);
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
          { label: 'Fix mapping' },
        ),
      );
    }
  }
  const library: LibraryRecord[] = libraryRead?.value ?? [];
  if (!libraryRead) unreadable.push('Content Library');
  const schedule: ScheduleRecord[] = scheduleRead?.value ?? [];
  if (!scheduleRead) unreadable.push('Content Schedule');

  const navigationSnapshots = repo.navigationSnapshots?.();

  const dbBody = repo.draftBodyAuthority?.() === 'db';
  const queuedMarkdown = new Set<string>();
  const editedMarkdown = new Set<string>();
  if (dbBody && options.markdownExport) {
    try {
      for (const id of await options.markdownExport.editedLibraryIds()) editedMarkdown.add(id);
      for (const job of await options.markdownExport.status()) {
        queuedMarkdown.add(job.libraryId);
        items.push(item(job.reason === 'markdown_missing' ? 'markdown_missing' : job.reason === 'markdown_mismatch' ? 'markdown_mismatch' : 'markdown_export_lag', ['NOT_FOUND', 'CONFLICT', 'STALE_READ', 'VALIDATION_FAILED'].includes(job.code ?? '') || now - job.since >= 3600_000 ? 'blocking' : 'attention', `${job.libraryId}: Drive export is behind`,
          [job.reason === 'queued_body_stale' ? 'The queued body differs from the saved draft. Save the intended draft with a new operation, then retry export. Rollback is blocked.'
            : job.code === 'CONFLICT' || job.code === 'STALE_READ' ? 'Drive changed or export could not be verified. Compare the master with the saved database draft before retrying.'
            : job.code === 'VALIDATION_FAILED' ? 'The draft cannot be exported safely. Remove section headings or close code fences, save again, then retry export.'
            : job.recovery === 'restore_markdown_link' ? 'Restore Drive link: give this Library ID one section with the exact saved database body, then ask the coordinator to restore its link and retry export.'
            : job.code === 'NOT_FOUND' ? 'The master or its unique section could not be found. Restore the link and give this Library ID one section, then retry export.'
            : job.code ? 'Drive export is unavailable. The database draft is saved. Retry export when Drive is available.'
            : 'Awaiting verified Drive export. The database draft is saved.'], [job.libraryId], { label: job.recovery === 'restore_markdown_link' ? 'Restore Drive link' : 'Review', href: `/review/${encodeURIComponent(job.libraryId)}` }));
      }
    } catch { unreadable.push('Markdown export queue'); }
  }
  // Group rows by master file so each file is read once.
  const byFile = new Map<string, LibraryRecord[]>();
  for (const r of library) {
    const id = markdownFileId(r);
    if (!id && dbBody && !queuedMarkdown.has(r.value.libraryId) && (r.value.draftContent || editedMarkdown.has(r.value.libraryId))) items.push(item('markdown_missing', editedMarkdown.has(r.value.libraryId) ? 'blocking' : 'attention', `${r.value.libraryId}: no Drive master link`, ['No usable master link. Restore the link before exporting a database edit.'], [r.value.libraryId], { label: 'Review', href: `/review/${encodeURIComponent(r.value.libraryId)}` }));
    if (id) byFile.set(id, [...(byFile.get(id) ?? []), r]);
  }
  return { now, items, unreadable, caps, library, schedule, dbBody, queuedMarkdown, editedMarkdown, byFile, navigationSnapshots };
}

/** Drive Markdown versus the database draft. One read per file, bounded concurrency, per-call timeout. */
async function checkDrive(drive: DriveGateway, ctx: Context, options: ReconcileOptions): Promise<SlowSection> {
  const section = emptySection();
  const { dbBody, queuedMarkdown, editedMarkdown } = ctx;
  const files = [...ctx.byFile];
  const reads = await mapLimitSettled(files, options.concurrency ?? PROVIDER_CONCURRENCY, ([fileId]) =>
    withTimeout(() => drive.readText(fileId), options.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS));
  section.checked = files.length;
  files.forEach(([fileId, rows], index) => {
    const read = reads[index]!;
    if (read.status === 'rejected') {
      section.failed++;
      if (dbBody) for (const r of rows.filter(r => !queuedMarkdown.has(r.value.libraryId))) section.items.push(item('markdown_export_lag', 'attention', `${r.value.libraryId}: Drive could not be checked`, ['Drive could not be read. The database draft is saved. Retry when Drive is available.'], [r.value.libraryId], { label: 'Retry', href: `/review/${encodeURIComponent(r.value.libraryId)}` }));
      else section.unreadable.push(`Markdown file ${shortHash(fileId)}`);
      return;
    }
    const text = read.value.text;
    for (const r of rows) {
      const found = findSection(text, r.value.libraryId);
      if (dbBody) {
        if (!queuedMarkdown.has(r.value.libraryId)) {
          if (!found.ok && (r.value.draftContent || editedMarkdown.has(r.value.libraryId))) section.items.push(item('markdown_missing', editedMarkdown.has(r.value.libraryId) ? 'blocking' : 'attention', `${r.value.libraryId}: ${found.reason === 'duplicate' ? 'duplicate Drive sections' : 'no Drive section'}`,
            [editedMarkdown.has(r.value.libraryId) ? 'Give this Library ID one section and export the exact saved body before rollback.' : 'Give this Library ID one section before exporting a database edit. This legacy section warning does not block rollback.'], [r.value.libraryId], { label: 'Review', href: `/review/${encodeURIComponent(r.value.libraryId)}` }));
          else if (found.ok && found.section.body !== r.value.draftContent) section.items.push(item('markdown_export_lag', 'blocking', `${r.value.libraryId}: Drive export is behind`,
            ['The database is authoritative. A conflicting Drive body is preserved; preview Import Markdown master to choose a direction.'], [r.value.libraryId], { label: 'Review', href: `/review/${encodeURIComponent(r.value.libraryId)}` }));
        }
        continue;
      }
      if (!found.ok) {
        // Rows without a section are only a problem once they are in review or approved.
        if (r.value.draftContent.trim() === '') continue;
        section.items.push(
          item('markdown_missing', 'attention', found.reason === 'duplicate' ? `${r.value.libraryId} has more than one Markdown section` : `${r.value.libraryId} has no Markdown section`, [found.reason === 'duplicate' ? `${found.count} sections claim this Library ID.` : 'No heading carries this Library ID.'], [r.value.libraryId], { label: 'Add section', href: `/review/${encodeURIComponent(r.value.libraryId)}` }),
        );
      } else if (found.section.body !== r.value.draftContent) {
        section.items.push(item('markdown_mismatch', 'blocking', `${r.value.libraryId}: saved draft and Markdown differ`, ['The Markdown section is canonical; the saved draft is out of date or was edited directly.'], [r.value.libraryId], { label: 'Compare', href: `/review/${encodeURIComponent(r.value.libraryId)}` }));
      }
    }
  });
  return section;
}

/** Ready rows with no Draft ID in the next days that Typefully may match (TYPE-03), newest first, capped. */
function typefullyDue(ctx: Context, options: ReconcileOptions): ScheduleRecord[] {
  const tf = options.typefully;
  const state = tf ? tf.capability().state : null;
  if (!tf || !(state === 'ready' || state === 'read_only' || state === 'degraded')) return [];
  const from = options.today ?? today();
  const until = addDays(from, TYPEFULLY_SCAN_DAYS);
  return ctx.schedule
    .map((r) => ({ r, parsed: parseContentId(r.value.contentId) }))
    .filter(({ r, parsed }) => !r.value.typefullyDraftId && r.value.contentStage?.ok && r.value.contentStage.value === 'Ready' && parsed && parsed.isoDate >= from && parsed.isoDate <= until)
    .sort((a, b) => (a.parsed!.isoDate < b.parsed!.isoDate ? 1 : a.parsed!.isoDate > b.parsed!.isoDate ? -1 : 0))
    .slice(0, TYPEFULLY_SCAN_MAX)
    .map(({ r }) => r);
}

async function checkTypefully(repo: ContentRepository, ctx: Context, options: ReconcileOptions, due: ScheduleRecord[]): Promise<SlowSection> {
  const section = emptySection();
  const tf = options.typefully;
  if (!tf || due.length === 0) return section;
  const results = await mapLimitSettled(due, options.concurrency ?? PROVIDER_CONCURRENCY, (r) =>
    withTimeout(() => reconcileRecord(repo, tf, ctx.schedule, r), options.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS));
  section.checked = due.length;
  due.forEach((r, index) => {
    const result = results[index]!;
    if (result.status === 'rejected' || result.value.kind === 'provider_error') {
      section.failed++;
      if (!section.unreadable.includes('Typefully drafts')) section.unreadable.push('Typefully drafts');
      return;
    }
    const rec = result.value;
    if (rec.kind !== 'ambiguous') return;
    section.items.push(
      item('typefully_ambiguous', 'attention', `${r.value.contentId}: ${rec.candidates.length} Typefully drafts could match`, ['None is linked or created automatically. Pick the right draft by date, slot, platform, planned time and similarity.'], [r.value.contentId], {
        label: 'Review',
        href: `/schedule/${encodeURIComponent(r.value.contentId)}`,
      }),
    );
  });
  return section;
}

type Fast = { items: ReconcileItem[]; unreadable: string[]; alerts: Alert[]; events: EventSummary[] };

/** Everything else from the database: approvals, zh-TW lineage, sync age, partial operations. */
async function finishFast(repo: ContentRepository, ctx: Context, options: ReconcileOptions): Promise<Fast> {
  const { now, library, schedule } = ctx;
  const items: ReconcileItem[] = [];
  const unreadable: string[] = [];

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

  // Typefully: Final Content edited after the last sync (TYPE-05). Pure; no provider call.
  for (const r of schedule) {
    const v = r.value;
    if (!v.typefullyDraftId || finalEditedSinceSync(v) !== true) continue;
    items.push(
      item('typefully_sync_conflict', 'attention', `${v.contentId}: Final Content changed after the last Typefully sync`, ['The saved post and Typefully may now disagree. Nothing is overwritten until you choose a direction.'], [v.contentId], {
        label: 'Compare',
        href: `/schedule/${encodeURIComponent(v.contentId)}`,
      }),
    );
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

  // Sheet-era import comparison; only runs when the caller passes the journal (never in db mode).
  if (options.contentParity) {
    await options.contentParity.refresh();
    const parity = options.contentParity.summary(Math.max(now, options.contentParity.samples.at(-1)?.at ?? now));
    if (parity.lagMs === null || parity.lagMs >= 900_000 || parity.failureSince !== null) {
      const blocking = parity.lagMs === null || parity.lagMs >= 3600_000 || parity.failureSince !== null && now - parity.failureSince >= 3600_000;
      items.push(item('import_lag', blocking ? 'blocking' : 'attention', 'Content import needs attention',
        [parity.lagMs === null ? 'No completed typed import recorded.' : `Last imported snapshot: ${Math.floor(parity.lagMs / 60000)} minutes ago.`, 'Retry the scheduled import; the Sheet remains authoritative.'], [], { label: 'Configure' }));
    }
    if (parity.collections.some(c => c.blocking > 0)) items.push(item('content_parity', 'blocking', 'Sheet and database comparison found differences',
      parity.collections.filter(c => c.blocking).map(c => `${c.collection}: ${c.blocking} blocking differences.`), [], { label: 'Review' }));
  }
  let pendingRows: Awaited<ReturnType<NonNullable<ContentRepository['refreshPending']>>> = [];
  try { pendingRows = await repo.refreshPending?.() ?? []; } catch { unreadable.push('Database refresh status'); }
  for (const pending of pendingRows) {
    items.push(item('refresh_pending', pending.refusal ? 'blocking' : 'attention', `${pending.id}: database refresh pending`,
      [pending.source === 'save' ? 'Saved in the Sheet.' : 'The database copy is behind the Sheet.',
        pending.refusal ? `Copy refused (${pending.refusal}). Review the Sheet value or copy limits; imports continue for other rows.`
          : 'A fresh import can refresh this copy.'], [pending.id], { label: 'Review' }, pending.operationId));
  }
  return { items, unreadable, alerts: evaluateAlerts(events, stale.length, now), events: summariseEvents(events) };
}

const bySeverity: Record<ReconcileItem['severity'], number> = { blocking: 0, attention: 1 };
const sortItems = (items: ReconcileItem[]) => items.sort((a, b) => bySeverity[a.severity] - bySeverity[b.severity] || a.kind.localeCompare(b.kind));

// ------------------------------------------------------------------ brief reuse of slow results

type CacheEntry = { key: string; at: number; value: Promise<SlowSection> };
const slowCache = new WeakMap<object, Map<string, CacheEntry>>();

/** Reuse a slow check while its inputs are unchanged and it is younger than ttl. Failures are never kept. */
function cachedSection(repo: ContentRepository, name: string, key: string, cache: ReconcileOptions['cache'], run: () => Promise<SlowSection>): Promise<SlowSection> {
  if (!cache) return run();
  const entries = slowCache.get(repo) ?? new Map<string, CacheEntry>();
  slowCache.set(repo, entries);
  const hit = entries.get(name);
  if (!cache.fresh && hit && hit.key === key && Date.now() - hit.at < cache.ttlMs) return hit.value;
  const entry: CacheEntry = { key, at: Date.now(), value: run() };
  entries.set(name, entry);
  const drop = () => { if (entries.get(name) === entry) entries.delete(name); };
  entry.value.then((v) => { if (v.failed > 0 || v.unreadable.length > 0) drop(); }, drop);
  return entry.value;
}

export type ReconcileStart = {
  /** Resolves after the database-only checks. Drive and Typefully are not waited for. */
  fast: Promise<ReconcileReport>;
  drive: Promise<SlowSection>;
  typefully: Promise<SlowSection>;
  /** Everything, assembled. Also records the navigation badge count. */
  report: Promise<ReconcileReport>;
};

/**
 * Start every check at once. The database checks resolve first (`fast`); the
 * Drive and Typefully checks are separate promises so a page can stream each.
 * The navigation badge count is recorded only when all parts are known.
 */
export function startReconcile(repo: ContentRepository, drive: DriveGateway, now = Date.now(), options: ReconcileOptions = {}): ReconcileStart {
  rememberNavigationCount(repo, 'fixIssues', null);
  const loaded = loadContext(repo, options, now);
  const fastPart = loaded.then((ctx) => finishFast(repo, ctx, options));
  const driveP = loaded.then((ctx) => cachedSection(repo, 'drive', shortHash(JSON.stringify([ctx.dbBody, ctx.library.map((r) => [r.value.libraryId, r.revision]), [...ctx.queuedMarkdown], [...ctx.editedMarkdown]])), options.cache, () => checkDrive(drive, ctx, options)));
  const tfP = loaded.then((ctx) => {
    const due = typefullyDue(ctx, options);
    return cachedSection(repo, 'typefully', shortHash(JSON.stringify([options.today ?? today(), due.map((r) => [r.value.contentId, r.revision])])), options.cache, () => checkTypefully(repo, ctx, options, due));
  });

  const fast = Promise.all([loaded, fastPart]).then(([ctx, f]): ReconcileReport => ({
    items: sortItems([...ctx.items, ...f.items]),
    alerts: f.alerts,
    events: f.events,
    capabilities: ctx.caps,
    checkedAt: new Date(now).toISOString(),
    unreadable: [...ctx.unreadable, ...f.unreadable],
  }));
  const report = Promise.all([loaded, fastPart, driveP, tfP]).then(([ctx, f, d, t]): ReconcileReport => {
    const full: ReconcileReport = {
      // Original order: queue and link items, Drive items, database checks, Typefully scan.
      items: sortItems([...ctx.items, ...d.items, ...f.items, ...t.items]),
      alerts: f.alerts,
      events: f.events,
      capabilities: ctx.caps,
      checkedAt: new Date(now).toISOString(),
      unreadable: [...ctx.unreadable, ...d.unreadable, ...f.unreadable, ...t.unreadable],
    };
    rememberNavigationCount(repo, 'fixIssues', fixIssuesCount(full), ctx.navigationSnapshots);
    return full;
  });
  // Callers await the part they need; none of these may surface as an unhandled rejection.
  for (const p of [fast, driveP, tfP, report]) p.catch(() => undefined);
  return { fast, drive: driveP, typefully: tfP, report };
}

/** Whole report, awaited. Same signature as before; the checks now run in parallel. */
export async function buildReconcileReport(
  repo: ContentRepository,
  drive: DriveGateway,
  now = Date.now(),
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  return startReconcile(repo, drive, now, options).report;
}

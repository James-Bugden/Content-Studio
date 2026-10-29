import { StatusBanner } from '@/components/shell-status';
import { MarkdownImport } from '@/components/reconcile/markdown-import';
import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { SLOW_CACHE_TTL_MS, startReconcile, type ReconcileReport, type ReconcileStart } from '@/application/reconcile';
import { CapabilityBanner, ErrorState, PageHeader, StateView } from '@/components';
import { ReconcileList } from '@/components/reconcile/reconcile-list';
import { isAppError } from '@/domain/errors';
import { requireActor } from '@/lib/auth';
import { summariseBacklogTimings } from '@/observability/alerts';
import { recentEvents } from '@/observability/events';
import { serverEnv } from '@/lib/env';
import { DatabaseSwitchPanel } from '@/components/reconcile/database-switch-panel';
import { ContentImportButton } from '@/components/reconcile/content-import-button';
import { DriveSection, TypefullySection } from '@/components/reconcile/sections';

export const metadata: Metadata = { title: 'Reconcile | Content Studio' };
export const dynamic = 'force-dynamic';

/**
 * Reconciliation centre and health (CS-017). Rebuilt from the database, Drive,
 * Typefully and this instance's redacted telemetry on every load. Nothing here
 * stores content.
 *
 * CS #250: the page waits only for the database checks. The Drive and Typefully
 * checks stream in as their own sections, so a slow provider delays only itself.
 * `?fresh=` (the Retry button) skips the short result cache.
 */
export default async function ReconcilePage({ searchParams }: { searchParams?: Promise<{ fresh?: string }> } = {}) {
  const actor = await requireActor('viewer');
  const databaseOnly = serverEnv().CS_CONTENT_STORE === 'db';
  const sources = databaseOnly ? 'the database, Drive and Typefully' : 'the Sheet, Drive and Typefully';
  const fresh = Boolean((await searchParams)?.fresh);
  let report: ReconcileReport;
  let start: ReconcileStart;
  try {
    const { repo, reconcileRepo, drive, typefully, contentParity, contentCutover, contentBackup, markdownExport, liveCutover } = getServices();
    // Sheet-era evidence (backup, cutover, export parity, import parity) is not read in db mode.
    if (!databaseOnly) await contentBackup?.prepare?.().catch(() => { /* Invalid/unavailable evidence is marked unverified by the adapter. */ });
    start = startReconcile(reconcileRepo ?? repo, drive, undefined, {
      typefully, markdownExport, cache: { ttlMs: SLOW_CACHE_TTL_MS, fresh },
      ...(databaseOnly ? {} : { contentParity, contentCutover, backupJournal: contentBackup?.journal, liveCutover }),
    });
    report = await start.fast;
  } catch (error) {
    return (
      <>
        <PageHeader title="Fix issues" description={`Everything that disagrees between ${sources}, with the safe next step.`} />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} />
        {!databaseOnly && actor.role === 'owner' ? <DatabaseSwitchPanel importsBlocked /> : null}
      </>
    );
  }
  const checked = new Date(report.checkedAt).toLocaleString('en-GB', { timeZone: 'Asia/Taipei' });
  const parity = databaseOnly ? undefined : getServices().contentParity?.summary();

  return (
    <>
      <PageHeader title="Fix issues" description={`Everything that disagrees between ${sources}, with the safe next step. Checked ${checked} Taipei.`} />
      <div className="mt-4 flex flex-col gap-6">
        <StatusBanner kind="capability"><CapabilityBanner capabilities={report.capabilities} /></StatusBanner>
        {!databaseOnly && actor.role === 'owner' ? <DatabaseSwitchPanel importsBlocked={report.unreadable.length > 0} /> : null}
        {databaseOnly ? <p>Store mode: db. Database is the only content store.</p> : <section aria-labelledby="content-parity-h" className="rounded-lg border border-line bg-card p-4">
          <h2 id="content-parity-h" className="text-lg font-semibold">Content import and parity</h2>
          <p>Store mode: {serverEnv().CS_CONTENT_STORE}. {serverEnv().CS_CONTENT_STORE === 'db' ? 'Database is authoritative; Sheet is a one-way comparison export.' : 'Sheet remains authoritative.'}</p>
          {parity ? <>
            <p>{parity.sampleCount} compared requests · {parity.daysGreen} complete days green · import lag p95: {parity.lagP95 === null ? 'not measured' : `${Math.round(parity.lagP95 / 60000)} min`}.</p>
            <p>{!parity.available ? 'Durable measurements unavailable; thresholds unknown.' : parity.ready ? 'Shadow thresholds met.' : 'Shadow thresholds not yet met.'} Evidence covers {parity.scope}{parity.scope === 'this server instance' ? '; a restart loses this measurement window.' : '; measurements survive server restarts.'} This is not permission to switch reads; durable deployment evidence and the phase gates are still required.</p>
            {parity.gap ? <p>Shadow gap: {parity.gap}. Sheet remains available; readiness is blocked.</p> : null}
            {parity.windowWaiver ? <p>Window waived by owner on {parity.windowWaiver.on}; recorded {parity.windowWaiver.recordedAt}. Equality, exceptions and lag checks still apply.</p> : null}
            <p>{parity.providerFailures} provider failure samples. Full-import parity: {parity.fullParity ? `${parity.fullParity.rows} rows; IDs ${parity.fullParity.idsEqual ? 'equal' : 'differ'}; fields ${parity.fullParity.fields ? (100 * parity.fullParity.equal / parity.fullParity.fields).toFixed(2) + '% equal' : 'n/a (empty import)'}; ${parity.fullParity.unclassified} unclassified differences` : 'not measured'}.</p>
            <ul>{parity.collections.map(c => <li key={c.collection}>{c.collection}: ID sets {c.idsEqual === null ? 'not measured' : c.idsEqual ? 'equal' : 'differ'}; fields {c.fieldsNA ? 'n/a (empty collection)' : c.fieldEquality === null ? 'not measured' : `${c.fieldEquality.toFixed(2)}% equal`}; {c.samples} samples{c.blankBooleans ? `; ${c.blankBooleans} named blank-checkbox equivalents` : ''}.</li>)}</ul>
            {parity.lastRun ? <details className="mt-3"><summary className="cursor-pointer py-2">Last import counts, hashes and exceptions</summary>
              <p className="break-all text-sm">Snapshot: {parity.lastRun.snapshotHash}</p>
              <ul className="text-sm">{Object.entries(parity.lastRun.counts).map(([collection, count]) => <li key={collection} className="break-all">{collection}: {count} rows · {parity.lastRun!.hashes[collection as keyof typeof parity.lastRun.hashes]}</li>)}</ul>
              <p>{parity.lastRun.exceptions.length} classified exceptions.</p>
              <div role="region" aria-label="Import exception ledger" tabIndex={0} className="max-h-64 overflow-y-auto">
                <ul className="text-sm">{parity.lastRun.exceptions.map((e, i) => <li key={i} className="break-all">{e.collection}.{e.field}: {e.class} · {e.hash}</li>)}</ul>
              </div>
            </details> : null}
            {actor.role === 'owner' ? <ContentImportButton /> : null}
          </> : <p>Typed import and shadow comparison are inactive. No parity measurements recorded.</p>}
        </section>}

        {serverEnv().CS_CONTENT_STORE === 'db' && actor.role === 'owner' ? <MarkdownImport /> : null}

        {report.alerts.length > 0 ? (
          <section aria-labelledby="alerts-h">
            <h2 id="alerts-h" className="text-lg font-semibold">
              Alerts
            </h2>
            <ul className="mt-2 flex flex-col gap-2">
              {report.alerts.map((a) => (
                <li key={a.id}>
                  <StateView kind={a.severity === 'page' ? 'provider_error' : 'blocked'} title={a.message} detail={`Count: ${a.count}. See the runbook for thresholds and steps.`} nextStep={null} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {report.unreadable.length > 0 ? (
          <StateView
            kind="provider_error"
            title="Some sources could not be read"
            detail={`Unknown, not clear: ${report.unreadable.join(', ')}. Items depending on them are not listed.`}
            nextStep="Reload in a moment."
          />
        ) : null}

        <section aria-labelledby="items-h">
          <h2 id="items-h" className="text-lg font-semibold">
            Database checks <span className="text-sm font-normal text-ink-soft">({report.items.length})</span>
          </h2>
          {report.items.length === 0 ? report.unreadable.length > 0 ? null : (
            <div className="mt-2">
              <StateView kind="empty" title="Database checks agree" detail="Approvals, zh-TW lineage and sync age match for every readable source. Drive and Typefully are checked below." nextStep={null} />
            </div>
          ) : (
            <div className="mt-2">
              <ReconcileList items={report.items} />
            </div>
          )}
        </section>

        <DriveSection promise={start.drive} />
        <TypefullySection promise={start.typefully} />

        {/* CS-048: engineering diagnostics stay available but out of the way. */}
        <details className="rounded-lg border border-line bg-card px-4 py-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-ink-soft">Diagnostics</summary>
          <div className="flex flex-col gap-6 pt-2 pb-3">
        <section aria-labelledby="health-h">
          <h3 id="health-h" className="font-semibold">
            Adapter health (this server instance)
          </h3>
          {report.events.length === 0 ? (
            <div className="mt-2"><StateView kind="empty" title="No provider calls recorded yet in this instance." nextStep={null} /></div>
          ) : (
            <div tabIndex={0} role="region" aria-label="Adapter health table (scrolls sideways)" className="mt-2 overflow-x-auto rounded-lg border border-line bg-card">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <caption className="sr-only">Calls, errors and latency by adapter</caption>
                <thead className="bg-paper">
                  <tr>
                    {['Adapter', 'Calls', 'Errors', 'Conflicts', 'p50 ms', 'p95 ms'].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.events.map((e) => (
                    <tr key={e.adapter} className="border-t border-line">
                      <th scope="row" className="px-3 py-2 font-medium">
                        {e.adapter}
                      </th>
                      <td className="px-3 py-2 tabular-nums">{e.total}</td>
                      <td className="px-3 py-2 tabular-nums">{e.errors}</td>
                      <td className="px-3 py-2 tabular-nums">{e.conflicts}</td>
                      <td className="px-3 py-2 tabular-nums">{e.p50 ?? 'n/a'}</td>
                      <td className="px-3 py-2 tabular-nums">{e.p95 ?? 'n/a'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="backlog-timing-h">
          <h3 id="backlog-timing-h" className="font-semibold">Backlog timings (this server instance)</h3>
          <p className="text-sm text-ink-soft">Recent successful requests only. Durations include provider reads; no post text or search terms are recorded.</p>
          <div tabIndex={0} role="region" aria-label="Backlog timing table" className="mt-2 overflow-x-auto rounded-lg border border-line bg-card">
            <table className="w-full min-w-[24rem] text-left text-sm">
              <thead className="bg-paper"><tr>{['Action', 'Samples', 'p50 ms', 'p95 ms'].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}</tr></thead>
              <tbody>{summariseBacklogTimings(recentEvents()).map((e) => <tr key={e.name} className="border-t border-line"><th scope="row" className="px-3 py-2 font-medium">{e.name}</th><td className="px-3 py-2">{e.samples}</td><td className="px-3 py-2">{e.p50 ?? 'n/a'}</td><td className="px-3 py-2">{e.p95 ?? 'n/a'}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
          </div>
        </details>
      </div>
    </>
  );
}

import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { buildReconcileReport, type ReconcileReport } from '@/application/reconcile';
import { CapabilityBanner, ErrorState, PageHeader, StateView } from '@/components';
import { ReconcileList } from '@/components/reconcile/reconcile-list';
import { isAppError } from '@/domain/errors';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Reconcile | Content Studio' };
export const dynamic = 'force-dynamic';

/**
 * Reconciliation centre and health (CS-017). Rebuilt from the Sheet, Drive and
 * this instance's redacted telemetry on every load. Nothing here stores content.
 */
export default async function ReconcilePage() {
  await requireActor('viewer');
  let report: ReconcileReport;
  try {
    const { repo, drive } = getServices();
    report = await buildReconcileReport(repo, drive);
  } catch (error) {
    return (
      <>
        <PageHeader title="Reconcile" description="Everything that disagrees between the Sheet, Drive and Typefully, with the safe next step." />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} />
      </>
    );
  }
  const checked = new Date(report.checkedAt).toLocaleString('en-GB', { timeZone: 'Asia/Taipei' });

  return (
    <>
      <PageHeader title="Reconcile" description={`Everything that disagrees between the Sheet, Drive and Typefully, with the safe next step. Checked ${checked} Taipei.`} />
      <div className="mt-4 flex flex-col gap-6">
        <CapabilityBanner capabilities={report.capabilities} />

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
            Items to reconcile <span className="text-sm font-normal text-ink-soft">({report.items.length})</span>
          </h2>
          {report.items.length === 0 ? (
            <div className="mt-2">
              <StateView kind="empty" title="Everything agrees" detail="The Sheet, Markdown and schedule lineage match for every readable source." nextStep={null} />
            </div>
          ) : (
            <div className="mt-2">
              <ReconcileList items={report.items} />
            </div>
          )}
        </section>

        <section aria-labelledby="health-h">
          <h2 id="health-h" className="text-lg font-semibold">
            Adapter health (this server instance)
          </h2>
          {report.events.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">No provider calls recorded yet in this instance.</p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-card">
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
      </div>
    </>
  );
}

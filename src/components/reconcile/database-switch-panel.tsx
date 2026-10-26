'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cutoverReasonText, cutoverStatusSchema, sameCutoverDecision, verifiedCutoverResult,
  type CutoverAction, type CutoverStatus, type SwitchAction } from '@/domain/cutover';
import { buttonClass } from '../button-styles';
import { ModalDialog } from '../modal-dialog';
import { ContentImportButton } from './content-import-button';
import { completeCutover, pendingCutover } from './cutover-retry';

const labels: Record<CutoverAction, string> = { measure: 'Measure', backup: 'Backup check', rollback: 'Rehearse rollback',
  export: 'Export check', 'activate-read': 'Switch reads to database', 'activate-db': 'Switch to database' };
const modeText = { sheet: 'Sheet is authoritative', 'db-shadow': 'Sheet is authoritative; database is being compared',
  'db-read': 'Database serves reads; Sheet remains authoritative', db: 'Database is authoritative; Sheet is a comparison export' };
const epochText = { none: 'No database switch recorded', read: 'Database reads admitted', db: 'Database authority admitted', retired: 'Sheet authority restored' };
const evidenceText = { parity: 'Full comparison', 'phase-c': 'Read and write checks', rehearsal: 'Rollback rehearsal', backup: 'Verified backup' };

function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
async function fetchStatus(): Promise<CutoverStatus> {
  const response = await fetch('/api/ops/content-cutover', { credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(65_000), headers: { Accept: 'application/json' } });
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error('status');
  return cutoverStatusSchema.parse(body.status);
}

export function DatabaseSwitchPanel() {
  const [snapshot, setSnapshot] = useState<{ status: CutoverStatus; at: number } | null>(null);
  const [now, setNow] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [statusError, setStatusError] = useState('');
  const [dialog, setDialog] = useState<{ action: SwitchAction; status: CutoverStatus } | null>(null);
  const [typed, setTyped] = useState('');
  const [checking, setChecking] = useState(false);
  const [refused, setRefused] = useState('');
  const running = useRef(false);
  const switchOpener = useRef<HTMLElement | null>(null);
  const status = snapshot?.status;
  const elapsed = snapshot ? Math.max(0, now - snapshot.at) : 0;
  const importAge = status?.lastImportAgeMs === null || !status ? null : status.lastImportAgeMs + elapsed;
  const acceptStatus = useCallback((status: CutoverStatus) => {
    const at = Date.now(); setSnapshot({ status, at }); setNow(at);
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await fetchStatus();
      acceptStatus(status); setStatusError('');
    } catch {
      setSnapshot(null); setStatusError('Database switch status is unavailable. Refresh status before continuing.');
    } finally { setLoading(false); }
  }, [acceptStatus]);
  useEffect(() => {
    queueMicrotask(() => void refresh());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  function blocked(action: CutoverAction): string | null {
    if (!status) return 'Refresh status first.';
    if (status.synthetic) return 'Live cutover operations are unavailable in this synthetic preview.';
    if (action === 'activate-read' || action === 'activate-db') {
      const gate = status.gates[action === 'activate-read' ? 'db-read' : 'db'];
      if (!gate.ok) return gate.reasons.map(r => cutoverReasonText[r]).join(' ');
      if (importAge === null) return 'The last import age is unavailable. Import and measure again.';
      if (importAge >= 900_000) return 'The import is over 15 minutes old. Import and measure again.';
    }
    if (action === 'measure' && status.store === 'db') return 'Imports and Sheet-first measurements stop after database authority.';
    if (action === 'export' && status.store !== 'db') return 'Export checks are available after database authority.';
    if (action === 'rollback' && (status.store === 'db-shadow' || !status.writesDisabled)) return 'The coordinator must select the rehearsal mode and freeze every writer first.';
    return null;
  }

  async function openSwitch(action: SwitchAction) {
    if (!status || running.current || blocked(action)) return;
    running.current = true; setChecking(true); setRefused(''); setTyped(''); setDialog({ action, status });
    try {
      const latest = await fetchStatus();
      acceptStatus(latest);
      if (!sameCutoverDecision(status, latest)) setRefused('The build or readiness changed. Close this dialog, review the new status and start again.');
    } catch { setRefused('Readiness could not be checked. Close this dialog and refresh status.'); }
    finally { running.current = false; setChecking(false); }
  }

  async function run(action: CutoverAction) {
    // Keep the handler guard as well as disabled controls: scripted/repeated
    // events cannot bypass deliberate, exact confirmation or an in-flight call.
    const switching = action === 'activate-read' || action === 'activate-db';
    if (running.current || !status || blocked(action)) return;
    if (switching && (!dialog || dialog.action !== action || typed !== 'ACTIVATE' || refused || checking)) return;
    running.current = true; setBusy(true); setMessage(`${labels[action]} is running. This may take a minute. Keep this tab open; an interrupted request can be retried safely.`);
    let completed = false;
    try {
      const latest = switching ? await fetchStatus() : status;
      if (switching && (!sameCutoverDecision(dialog!.status, latest) || latest.lastImportAgeMs === null || latest.lastImportAgeMs >= 900_000)) {
        acceptStatus(latest);
        setRefused('The build or readiness changed. Close this dialog, review the new status and start again.');
        setMessage('Switch refused because readiness changed.'); return;
      }
      const pending = pendingCutover(action, switching ? latest.build : null);
      const response = await fetch('/api/ops/content-cutover', { method: 'POST', credentials: 'same-origin', redirect: 'error',
        signal: AbortSignal.timeout(65_000), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key },
        body: JSON.stringify({ action, ...(switching ? { expectedBuild: latest.build } : {}) }) });
      const body = await response.json();
      if (!response.ok || body.ok !== true || !verifiedCutoverResult(action, body.result, latest.build)) {
        const advice = response.status === 401 || response.status === 403 ? 'Sign in as the owner and ask the coordinator to check permissions and gates.'
          : response.status === 409 ? 'Ask the coordinator to check the build, revisions and pending operation before retrying.'
          : response.status === 429 ? 'Wait before retrying.' : 'Ask the coordinator to check readiness before retrying.';
        setMessage(`Completion is unconfirmed. ${advice} The pending request is kept for a safe retry.`);
        if (switching) setRefused('The server refused or could not confirm the switch. Close this dialog and refresh status before retrying.');
        return;
      }
      completeCutover(action);
      setMessage(action === 'rollback' ? 'Rollback rehearsal verified. The coordinator must still complete the ordered deployment steps.'
        : switching ? 'Switch recorded for this exact build. The coordinator must still change deployment settings and verify the deployed app.'
        : action === 'backup' && body.result.status === 'backup_waived' ? 'Backup waiver verified against the recorded owner decision. No archive was created.'
        : `${labels[action]} verified.`);
      completed = true;
    } catch {
      setMessage('Completion is unconfirmed. The pending request is kept. Retry the same action after the coordinator checks it is safe. If the build changed or browser storage is unavailable, ask the coordinator to inspect the pending request.');
      if (switching) setRefused('The switch could not be confirmed. Close this dialog and refresh status before retrying.');
    } finally {
      await refresh(); running.current = false; setBusy(false);
      if (completed) { setDialog(null); setTyped(''); }
    }
  }

  const dialogBlock = dialog ? blocked(dialog.action) : null;
  return <section aria-labelledby="database-switch-h" className="min-w-0 rounded-lg border border-line bg-card p-4">
    <h2 id="database-switch-h" className="text-lg font-semibold">Database switch</h2>
    <p className="mt-1 text-sm text-ink-soft">Use these steps with the coordinator after they verify the ordered cutover checks. Switching records permission for this build; deployment settings still need the coordinator.</p>
    {status?.synthetic ? <p className="mt-3 text-sm">Synthetic preview. Live cutover checks and switches are unavailable.</p> : null}
    <button type="button" className={`${buttonClass()} mt-3`} disabled={loading || busy || checking} onClick={() => void refresh()}>{loading ? 'Checking status…' : 'Refresh status'}</button>
    {statusError ? <p role="alert" className="mt-3">{statusError}</p> : null}
    {status ? <>
      <table className="mt-4 w-full table-fixed text-left text-sm">
        <caption className="sr-only">Database switch status</caption>
        <tbody>
          {[
            ['Deployed build', <code key="build" className="break-all">{status.build}</code>],
            ['Store mode', modeText[status.store]], ['Switch record', epochText[status.epoch]],
            ['Writes on this instance', status.writesDisabled ? 'Frozen. Other instances and external writers must be checked separately.' : 'Not frozen. The coordinator must freeze and drain every writer before rehearsal.'],
            ...(['db-read', 'db'] as const).map(target => [target === 'db-read' ? 'Read switch readiness' : 'Database switch readiness',
              status.gates[target].ok ? 'Ready according to the server checks.' : status.gates[target].reasons.map(r => cutoverReasonText[r]).join(' ')]),
            ...Object.entries(status.evidenceAgesMs).map(([key, age]) => [evidenceText[key as keyof typeof evidenceText], age === null ? 'Unavailable for this build and import' : `${duration(age + elapsed)} ago`]),
            ['Calendar wait waiver', status.waivers.calendar.audited ? 'Recorded owner decision applies. Measurements still required.' : 'No applicable recorded waiver'],
            ['Backup waiver', status.waivers.backup.audited ? 'Recorded owner decision applies. Exact export and rollback checks still required.' : 'No applicable recorded waiver'],
            ['Last import', importAge === null ? 'Unavailable' : `${duration(importAge)} ago. ${importAge >= 900_000 ? '15-minute freshness window expired.' : `${duration(900_000 - importAge)} left in the 15-minute freshness window.`}`],
          ].map(([label, value]) => <tr key={String(label)} className="border-b border-line"><th scope="row" className="w-2/5 py-3 pr-3 align-top font-medium">{label}</th><td className="break-words py-3 align-top">{value}</td></tr>)}
        </tbody>
      </table>
    </> : null}
    <ContentImportButton label="Import now" disabled={busy || checking || status?.store === 'db'} onPending={pending => { running.current = pending; setBusy(pending); }} onComplete={() => void refresh()} />
    {status?.store === 'db' ? <p className="text-sm text-ink-soft">Imports stop after database authority.</p> : null}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {(Object.keys(labels) as CutoverAction[]).map(action => {
        const reason = blocked(action);
        return <div key={action}>
          <button type="button" className={`${buttonClass()} w-full`} disabled={busy || checking || loading || !!reason}
            aria-describedby={reason ? `${action}-reason` : undefined}
            onClick={event => {
              if (action.startsWith('activate-')) { switchOpener.current = event.currentTarget; void openSwitch(action as SwitchAction); }
              else void run(action);
            }}>{labels[action]}</button>
          {reason ? <p id={`${action}-reason`} className="mt-1 text-sm text-ink-soft">{reason}</p> : null}
        </div>;
      })}
    </div>
    <p className="mt-3 text-sm text-ink-soft">Rehearsal and export may repair Sheet and Drive copies. Run them only at the coordinator’s ordered step. Failed or interrupted operations keep their request number in this tab, including after reload; completed operations get a new number next time.</p>
    <p role="status" aria-live="polite" aria-busy={busy} className="mt-3 text-sm">{message}</p>
    <ModalDialog open={!!dialog} onClose={() => { if (!busy && !checking) { setDialog(null); setTyped(''); } }}
      phoneSheet returnFocusTo={switchOpener} tone="warning" title={dialog ? labels[dialog.action] : 'Confirm database switch'}
      description="This records an authority decision for the exact build below. The server checks every gate again."
      footer={<><button type="button" className={buttonClass()} disabled={busy || checking} onClick={() => { setDialog(null); setTyped(''); }}>Cancel</button>
        <button type="button" className={buttonClass('primary')} disabled={typed !== 'ACTIVATE' || busy || checking || !!refused || !!dialogBlock}
          onClick={() => dialog && void run(dialog.action)}>{busy || checking ? 'Checking readiness…' : 'Confirm switch'}</button></>}>
      {dialog ? <div className="space-y-4 text-sm">
        <p>{dialog.action === 'activate-read' ? 'Reads will be admitted from the database. The Sheet remains authoritative. The coordinator must then deploy the read settings.'
          : 'The database will be admitted as the source for Content edits. The Sheet becomes a one-way comparison export. The coordinator must then deploy the database settings.'}</p>
        <p>Exact deployed build: <code className="break-all">{dialog.status.build}</code></p>
        <p>{dialog.action === 'activate-read' ? 'To roll back, the coordinator redeploys Sheet mode while the Sheet remains authoritative.'
          : 'To roll back, the coordinator freezes and drains every writer, runs Rehearse rollback, checks exact Sheet and Drive parity, then redeploys Sheet mode before resuming writes.'}</p>
        {refused || dialogBlock ? <p role="alert">{refused || dialogBlock}</p> : null}
        <label className="block" htmlFor="cutover-confirm">Type ACTIVATE exactly to continue</label>
        <input id="cutover-confirm" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false}
          disabled={busy || checking || !!refused} className="min-h-11 w-full rounded-md border border-line bg-card px-3 text-base" />
      </div> : null}
    </ModalDialog>
  </section>;
}

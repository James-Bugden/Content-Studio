import 'server-only';
import type { TelemetryEvent } from './events';

/**
 * Alert rules (CS-017 OBS-08). Evaluated over redacted telemetry and Schedule
 * facts only; thresholds are documented in docs/ops/runbook.md. The same rules
 * run in the reconciliation centre and can be wired to a log-based alert on the
 * hosting platform, because every event is a single JSON line on stdout.
 */
export type Alert = { id: 'schema_drift' | 'auth_refresh' | 'provider_write' | 'stale_published_sync'; severity: 'page' | 'warn'; message: string; count: number };

export const THRESHOLDS = {
  /** Any schema drift blocks writes, so one event is enough. */
  schemaDrift: 1,
  /** Consecutive Google token refresh failures. */
  authRefreshConsecutive: 3,
  /** Provider write failures within the window. */
  providerWriteFailures: 3,
  providerWriteWindowMs: 15 * 60 * 1000,
  /** A published row whose analytics or final copy has not synced for this long. */
  staleSyncMs: 48 * 60 * 60 * 1000,
} as const;

type Ev = TelemetryEvent & { at: string };

export function evaluateAlerts(events: readonly Ev[], staleSyncRows: number, now = Date.now()): Alert[] {
  const alerts: Alert[] = [];
  const drift = events.filter((e) => e.code === 'SCHEMA_DRIFT').length;
  if (drift >= THRESHOLDS.schemaDrift) {
    alerts.push({ id: 'schema_drift', severity: 'page', count: drift, message: 'The Sheet columns changed. Writes are blocked until the headers match the mapping.' });
  }
  const refresh = [...events].reverse().filter((e) => e.name === 'google.token_refresh_failed');
  const consecutive = refresh.length > 0 ? Math.max(...refresh.map((e) => Number(e.facts?.consecutive ?? 1))) : 0;
  if (consecutive >= THRESHOLDS.authRefreshConsecutive) {
    alerts.push({ id: 'auth_refresh', severity: 'page', count: consecutive, message: 'Google credentials failed to refresh repeatedly. Check the service account key.' });
  }
  const writeFailures = events.filter(
    (e) => e.outcome === 'error' && /\.(write|update|create|push|sync)/.test(e.name) && now - Date.parse(e.at) <= THRESHOLDS.providerWriteWindowMs,
  ).length;
  if (writeFailures >= THRESHOLDS.providerWriteFailures) {
    alerts.push({ id: 'provider_write', severity: 'page', count: writeFailures, message: 'Several provider writes failed in the last 15 minutes.' });
  }
  if (staleSyncRows > 0) {
    alerts.push({ id: 'stale_published_sync', severity: 'warn', count: staleSyncRows, message: 'Published posts have not synced final copy or analytics for over 48 hours.' });
  }
  return alerts;
}

export type EventSummary = { adapter: string; total: number; errors: number; conflicts: number; p50: number | null; p95: number | null };

export function summariseEvents(events: readonly Ev[]): EventSummary[] {
  const by = new Map<string, Ev[]>();
  for (const e of events) by.set(e.adapter, [...(by.get(e.adapter) ?? []), e]);
  return [...by.entries()]
    .map(([adapter, list]) => {
      const lat = list
        .map((e) => e.latencyMs)
        .filter((n): n is number => typeof n === 'number')
        .sort((a, b) => a - b);
      const q = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]! : null);
      return {
        adapter,
        total: list.length,
        errors: list.filter((e) => e.outcome === 'error').length,
        conflicts: list.filter((e) => e.outcome === 'conflict').length,
        p50: q(0.5),
        p95: q(0.95),
      };
    })
    .sort((a, b) => a.adapter.localeCompare(b.adapter));
}

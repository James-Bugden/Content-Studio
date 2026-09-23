# Content Studio runbook

Operational reference for CS-017 (observability and recovery) and CS-019 (deployment). Values here are names and thresholds only; no private identifiers.

## Where to look first

1. **Reconcile** (`/reconcile`): every disagreement between the Sheet, Drive, schedule lineage and recent operations, rebuilt from the sources on each load, plus active alerts and per-adapter call, error and latency figures for the current server instance.
2. **Health** (`/api/health`): commit SHA, data mode and capability state per provider. No content, ids or secrets.
3. **Runtime logs** (Vercel project logs): one JSON line per telemetry event. Fields are a closed schema: `name`, `adapter`, `outcome`, `operationId`, `latencyMs`, `retries`, `targetHash` (hash of the Sheet id, never the id), `code`, `httpStatus`, `facts` (short tokens only; URLs, paths and long digit runs are redacted).

Telemetry vendor and retention: Vercel runtime logs only. Retention depends on the Vercel plan and is **unverified** until CS-019 records it from the live project settings. No third-party telemetry service is used.

## Alert thresholds (OBS-08)

| Alert | Rule | Severity | First response |
| --- | --- | --- | --- |
| `schema_drift` | 1 or more `SCHEMA_DRIFT` events | page | A Sheet header was renamed, removed or duplicated. Writes are already blocked. Restore the header text exactly (see MASTER-SPEC section 5), then reload `/reconcile`. |
| `auth_refresh` | 3 consecutive Google token refresh failures | page | Check the service account key in Vercel env, key rotation, and that the Sheet and Drive folder are still shared with the service account. |
| `provider_write` | 3 or more failed provider writes in 15 minutes | page | Check `/reconcile` for partial operations; check Google or Typefully status; retry from the item (retries reuse the original operation id). |
| `stale_published_sync` | Published rows not synced (final copy or analytics) for 48 hours | warn | Run the sync from the Published view; if Typefully is down, leave as is: missing metrics stay blank. |

Log-based alerts on the hosting platform should match `"code":"SCHEMA_DRIFT"`, `"name":"google.token_refresh_failed"` and `"outcome":"error"` on `*.write.*` / `*.update.*` events with the same thresholds.

## Failure-injection catalogue

Each failure below is reproducible in fake mode (unit tests or `/api/test-control` in e2e mode) and has a documented, tested outcome.

| Failure | How it is injected | Expected outcome | Evidence |
| --- | --- | --- | --- |
| Sheet read outage | `FakeSheetTransport.failNext({ op: 'read', code: 'PROVIDER_UNAVAILABLE' })` | Provider error screen, never an empty list | `tests/unit/application/review.test.ts`, `tests/e2e/review.spec.ts` |
| Sheet rate limit | `failNext({ code: 'RATE_LIMITED' })` | `RATE_LIMITED`, bounded read retries | `tests/unit/google/sheets-repository.test.ts` |
| Header renamed | `externalEdit(tab, 1, col, 'Review state')` | `SCHEMA_DRIFT`, no write, blocking reconcile item | `sheets-repository.test.ts`, `reconcile.test.ts` |
| Concurrent Sheet edit | `externalEdit` after load | `STALE_READ`, comparison dialog, nothing written | `review.spec.ts`, `editor.spec.ts`, `schedule.test.ts` |
| Drive section edited elsewhere | `drive_replace` | `STALE_READ` three-way comparison | `editor.spec.ts`, `drive-saga.test.ts` |
| Drive write fails | `FakeDriveGateway.failNext({ op: 'write' })` | Error or `PARTIAL_FAILURE` when Sheet already mirrored | `drive-saga.test.ts` |
| Sheet write fails after Drive write | `sheet.failNext({ op: 'write' })` | `PARTIAL_FAILURE`, steps shown, retry with the same operation id completes without a second Drive write | `drive-saga.test.ts`, `editor.spec.ts`, `reconcile.test.ts` |
| Lost response on a Sheet write | Replay the same operation on a fresh repository | `skipped_already_applied`, no duplicate write | `sheets-repository.test.ts` |
| Formula cell targeted | Patch a formula column | `VALIDATION_FAILED` (`formula_cell`), no write | `sheets-repository.test.ts`, `review.test.ts` |
| Screenshot reuse cannot be checked | Schedule read fails | `SCREENSHOT_UNCERTAIN` blocks approval | `review.test.ts` |
| Google token refresh fails | Token endpoint 4xx | `CONFIG_MISSING`, `google.token_refresh_failed` event with consecutive count | `google-transport.test.ts` |
| AI malformed or unavailable | `FakeAiGateway.malformedNext` / `failNext` | One bounded repair, then `VALIDATION_FAILED`; editor stays usable | `tests/unit/ai/*` |
| Double promotion | Two confirms with one preview | One slot written; second is a replay | `schedule.test.ts`, `schedule.spec.ts` |

## Recovery rules

- **Retry** always reuses the original operation id and expected target. A step whose target already holds the value is reported as `skipped_already_applied`; nothing is written twice.
- **Compare** opens base, current and proposed side by side. Nothing is auto-merged.
- **Dismiss as reviewed** hides an item in the current tab only. It never resolves the item; it returns if its facts change and disappears for good only when the sources agree.
- Drive keeps its own revision history. If the documented residual race (see `docs/implementation/atomicity.md`) ever loses an edit to another section, restore it from Drive's version history.
- Durable audit evidence is provider revision history (Sheet version history, Drive revisions, Typefully) plus these redacted logs. An append-only audit tab in the workbook is a separate, owner-approved enhancement and is not created automatically.

## Rollback (CS-019)

Rollback restores the previous verified **app deployment and configuration** only. It never deletes, restores or rewrites Sheet, Drive or Typefully content. Steps are recorded in CS-019 once the Vercel project exists.

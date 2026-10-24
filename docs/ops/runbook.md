# Content Studio runbook

Operational reference for CS-017 (observability and recovery) and CS-019 (deployment). Values here are names and thresholds only; no private identifiers.

## Where to look first

1. **Fix issues** (`/reconcile`): every disagreement between the Sheet, Drive, schedule lineage and recent operations, rebuilt from the sources on each load, plus active alerts and per-adapter call, error and latency figures for the current server instance.
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

`POST /api/test-auth` and `POST /api/test-control` return HTTP 404 in production. Both
handlers are guarded by `testAuthEnabled`: fake data, `CS_TEST_MODE=e2e`, and
`VERCEL_ENV` other than `production`. The production route exclusions and the
policy's fake/e2e production denial are asserted in `tests/unit/auth/policy.test.ts`.

The existing CI workflow also runs weekly on `main` (Monday 03:17 UTC). Inspect the
scheduled run's verify and browser job results in GitHub Actions for dependency or
test rot. This uses synthetic providers without secrets; it does not probe live
provider health. See [ci.yml](../../.github/workflows/ci.yml).

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

## Typed import and shadow parity (CS-058 / DB-4)

DB-4 is preparation only: `CS_CONTENT_STORE` still defaults to `sheet`;
live database modes remain rejected by environment validation. Production does
not construct the typed import client. Do not apply migrations, enable a live
importer or advance a phase on the strength of synthetic evidence.

In `CS_DATA_MODE=fake` with `CS_CONTENT_STORE=db-shadow`, the existing owner
POST `/api/ops/sheet-mirror` and cron GET
`/api/ops/sheet-mirror/reconcile` run the typed importer. Cron requires the
existing `Authorization: Bearer <CRON_SECRET>` check; the owner route requires
owner authorization and same origin. `/reconcile` offers **Run content import**
and displays the last run's counts, collection hashes and named exceptions.
Existing Sheet-mode mirror behavior is unchanged. No schedule is registered by
this change; the future approved schedule is every 15 minutes (see deploy.md).

Every run captures database versions before reading the Sheet, builds one
complete `buildSheetMirrorSnapshot`, then submits one atomic `import_run`.
The canonical SHA-256 binds counts, collection hashes, typed rows (including
version preconditions) and exceptions. Failed reads never submit a batch;
failed imports retry from fresh versions and a new complete snapshot on the
next run. A delivery retry of an existing envelope retains its operation ID
and hash. DB-1 upserts only: absent rows are retained and reported as extra
IDs, never silently retired, including on incomplete reads. Retirement needs
a separately reviewed protocol before any real-data phase gate.

Import ledger classes are only `formula_display`, `number_formatting` and
`trailing_whitespace`. Formula display text is preserved, including links;
the formula marker does not excuse different text. Numeric text such as
`1,234` becomes integer 1234. Other conversion failures block the run. Unknown
Sheet columns retain header, column position, value, formula and link in
passthrough. Workflow settings preserve original values, notes and Sheet row
positions while the normal settings parser still supplies normalized views.

Shadow list requests sample with `Math.random() < 0.1`; `/reconcile` forces
comparison of its existing Library and Schedule reads. No extra Sheet reads
are made for comparison. Other collections are measured when their list is
requested (or during import snapshot construction). DB work starts alongside
the Sheet read, with a 500 ms comparison budget; failure/timeout records an
unknown/blocking comparison and still returns the Sheet result. The current
read port cannot cancel a timed-out DB request; the explicit live client's
per-request network timeout remains a second bound before future wiring.

Compare stable-ID sets, revision-independent cells, links and domain values.
Ready Queue revisions intentionally differ and are excluded. A Sheet summary
source with no Queue rows is named `zero_row_source`; it still fails the ID-set
gate. No summary equality is inferred from synthetic agreement with the SQL
view. Any unclassified difference is blocking. Telemetry differences contain
only collection, field, kind and a short fingerprint, without copy, IDs or URLs.

`import_lag` is attention at 15 minutes and blocking at 60 minutes; a missing
successful import is blocking/unknown. An unrepaired import failure becomes
blocking after one hour. Lag is measured from the completed snapshot's read
start, not the end of its upload. Reports calculate ID equality, per-collection
field equality, compared-list sample count, nearest-rank lag p95 and complete
UTC days green from recorded samples. Metrics cover seven completed days plus
today, or the latest 200 requests when that is longer. Repaired failures over
an hour remain red in that measurement window. Unmeasured collections remain unknown.
Phase B requires **both** seven consecutive green days and 200 compared
requests: 100% ID sets, at least 99.9% fields per collection, no unclassified
differences, lag p95 no more than 15 minutes, no unrepaired failure over an hour.

Current fake telemetry is bounded to 10,000 samples / 30 days and scoped to one
server instance; a restart discards it. It is explicitly labelled on the page
and cannot evidence a production phase exit. Durable cross-instance telemetry,
three full real-data Phase A imports, real summary parity and hosted security
checks remain prerequisites to live enablement. Rollback is `CS_CONTENT_STORE=sheet`;
the Sheet remains authoritative throughout this work.

## Rollback (CS-019)

Rollback restores the previous verified **app deployment and configuration** only. It never deletes, restores or rewrites Sheet, Drive or Typefully content. Follow the rollback steps in [the deployment guide](deploy.md#rollback-dep-07).

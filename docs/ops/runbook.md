# Content Studio runbook

DB-6 remains **pending cutover**. See [write-cutover, backups and exact rollback](database-write-cutover.md)
for Phase D/E gates and the local-only implementation boundary.

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
## Phase C Content read cutover (DB-5 / MIG-11)

This build defaults to `CS_CONTENT_STORE=sheet`. All live database modes are
refused by `serverEnv`; the production composition has no live typed client.
The following is the exact owner/live rehearsal and rollout checklist, **not
evidence that a cutover or any measurement has passed**. DB-1 through DB-5
migrations must not be applied to production as part of local verification.

## Authority and local recovery

In `db-read`, Content reads use the imported `sheet_revision`, never a DB
version token. Library, Queue, Schedule and new Queue ideas write to the Sheet
first with its existing authentication, allowlists, operation replay, fresh
revision comparison and read-back. Only that read-back is converted and sent
to `content_studio_write_through`; its separate deterministic operation ID is
derived from the Sheet operation ID. The version observed before the Sheet
mutation protects the derived copy against an overlapping import/copy. The DB
is never a precondition for accepting a Sheet mutation.

Copy failures, including conversion failures for nonrepresentable Sheet cells,
return success plus a `refresh_pending` step. The editor keeps the saved text
and revision. An instance-local overlay supplies that record on subsequent
reads until the DB has that Sheet fingerprint or a fingerprint matching the
current Sheet row. The pre-save DB version is retained; a version advance alone
does not prove repair. Pending checks use a fresh full-tab Sheet read to locate
the row, at most once per saved overlay and successfully checked DB
`(row_version, sheet_revision, latest completed import operation ID)` tuple.
Any token changing triggers a new check, including an import that changes no
row data after a hand revert. Concurrent checks share one in-flight promise.
A rate-limited Sheet check waits 60 seconds before retrying, even if an import
completes in that window; other failed reads stay immediately retryable.
A new save discards that cache.
Phase C measurement must include a rate limit immediately before an import:
the old overlay can remain for the full 60-second backoff and a save in that
window can return `STALE_READ`. Measure the duration and refusals on the copied
workbook/branch before deciding the backoff trade-off (#183); local tests do not
accept it for live use.
A successful later copy or typed import repairs representable values.
In db-read, `refused_numeric` and `refused_size` rows are excluded from accepted
import counts and counted in the named exception ledger; other rows continue.
These appear as blocking pending items: correct the source value/copy limit
before retrying. An import alone cannot repair a refused value. Unknown
conversion/integrity failures and CAS conflicts still abort the batch.
`/reconcile` reconstructs pending items by comparing
the three authoritative Sheet collections with the DB, including after an
instance restart, without installing a read overlay or claiming an app save
for ordinary lag. A failed scan is labelled unknown, not clear. Normal page
reads do not perform this full Sheet scan. The Sheet cache in the Phase C composition
is three seconds; the DB reader has no retained read cache.

The overlay is disposable and is not a durable authority or cross-instance
cache. After a restart, or on a different instance, a failed copy can be served
stale until import/reconciliation. Its Sheet token still causes `STALE_READ`
instead of lost data. The editor save saga checks the fresh Sheet before Drive
and propagates pending-copy steps. Drive remains canonical; no export, DB write
authority, or Drive-authority change is included here. Typed conversion uses
DB-4's exception rules; a Sheet value the integer/timestamp/size constraints
cannot represent remains saved in Sheet and needs explicit repair, never
silent coercion. Replaying an older successful Sheet operation never copies
its historical result over a newer Sheet/DB row.

## Immediate Phase C rollback

1. Record the deployed SHA, environment, current store mode, last completed
   import, pending items and failure times in private operations evidence.
2. Through the repository-supported deployment/configuration process set
   **only `CS_CONTENT_STORE=sheet`**, then redeploy/restart that runtime so all
   service instances pick up the flag. Do not change data mode, credentials,
   workbook target, or write permissions. Stop the typed import scheduler for
   that environment; an in-flight copy/import can affect only derived DB data.
3. Check authenticated health and `/reconcile` on the exact deployed SHA:
   mode is `sheet`, Sheet capability is ready (or deliberately read-only),
   typed import is inactive. DB network access may be denied to prove it is
   ignored. No DB read, comparison, ledger, export or final copy is required.
4. Read every synthetic row saved during the rehearsal, including the save
   whose DB copy failed, and compare exact copy, hyperlinks, unknown columns
   and Sheet revision with the private pre-rollback inventory. Save one new
   synthetic edit and confirm the Sheet read-back and Markdown saga.
5. Run the unchanged browser journeys at 375 and 1280 pixels against the
   rolled-back build. Check Backlog totals/filters, schedule, Typefully scan,
   read-your-writes and conflict recovery. Record commands, environment and SHA.
   Only after positive results can MIG-11's live rollback part be called passed.

Rollback never exports or copies DB values to Sheet, never truncates a table,
and never discards an authoritative mutation. Re-enable read cutover only
after repair, exact parity and all entry gates have been evidenced again.

## T3 copied-workbook / Supabase branch rehearsal — OWNER/LIVE GATED

Use a private synthetic copied workbook and a disposable Supabase branch, never
production data. A later explicitly reviewed owner-gate change must first wire
the live client; this build deliberately cannot start that mode.

1. Pin code SHA, migration list/schema version, deployment ID and environment;
   keep branch/workbook identifiers and credentials in private evidence only.
   Confirm preview contains no production service key, owner auth denies other
   identities and `anon`/`authenticated` cannot access any Content object/RPC.
2. **Before any apply**, inspect that branch's migration history and catalog.
   DB-1 (`20261024000100_content_authority.sql`) and DB-3
   (`20261025000100_content_writes.sql`) were edited in place during local DB-5
   review. Confirm neither version/name was applied there, and check that the
   authority schema-version table and write RPCs do not already exist (manual
   SQL applies may not appear in migration history). Record the check time and
   file hashes in private rehearsal evidence. If either was applied, stop and
   prepare a new forward migration; never replay the edited file over it.
   Apply reviewed migrations only to the disposable branch with explicit owner
   authority. Import the synthetic workbook three times. Record stable-ID sets,
   counts, hashes, exception classes, unchanged-row versions, audit/history and
   durable replay. Include child-before-parent Schedule lineage, blank booleans,
   hyperlinks, formula displays, passthrough, numeric and timestamp formatting.
3. With `db-shadow`, meet and privately record Phase B's 7 days **and** 200
   compared requests, exact ID sets, >=99.9% fields per collection, no
   unclassified differences, import lag p95 <=15 minutes and no failure older
   than one hour. A short synthetic rehearsal cannot satisfy the time gate.
4. With owner approval and the gated runtime, select `db-read`; prove health
   mode and DB reads. Save synthetic Library, Queue, Schedule and Queue idea
   records from DB-served tokens. Check Sheet first, exact Sheet read-back in DB,
   operation replay/different-patch conflict, content-identical version guard,
   history/audit, and immediate read-your-writes. Run editor, hook, review,
   Backlog filters/counts, calendar and `/reconcile` Typefully scan journeys.
5. Edit the copied Sheet after import while an editor is open. Assert
   `STALE_READ`, unchanged external Sheet value and unchanged Drive preflight.
   Exercise a concurrent copy/import and require derived CAS refusal, never a
   veto or overwrite of the authoritative Sheet save. Use independent database
   backends to exercise overlapping requests/retries; PGlite cannot prove this.
6. Deny the DB copy request after a successful Sheet write. Require successful
   mutation, returned saved record, visible pending state and reconcile item.
   Restart one server and use a second instance: pending lag must remain
   discoverable. Run the next scheduled import from **Sheet**, verify exact
   fingerprint parity and disappearance of the item. Repeat with a malformed
   numeric/timestamp cell and demonstrate explicit repair without coercion.
7. Execute all immediate rollback steps above with the DB unreachable. Run
   every unchanged journey in Sheet mode; compare the complete synthetic
   authority inventory before/after, including failed-copy saves and Queue
   appends. Record MIG-11 separately from MIG-12/13 (DB-6 export/restore work).

## T4 exact deployed commit smoke — OWNER/LIVE GATED

On the exact SHA produced by the gated deployment, sign in as owner in a real
browser. Record health build/mode and capability, open a synthetic record,
perform one mutation, inspect its private Sheet result and DB copy/history/audit,
verify the returned record in the UI, inspect Backlog/calendar/reconcile and
exercise the Sheet rollback once on preview. Repeat required phone/browser
checks. Synthetic browser emulation and screenshots are T1/T2, not T3/T4.

## Phase C exit measurement ledger — NOT MEASURED IN THIS LOCAL BUILD

For each observation retain exact SHA, deployment/environment, store mode,
window start/end, counts, sampling definitions and private raw evidence. Collect
across **all** runtime instances, not only the disposable process event buffer.

| Acceptance measurement | Required exit | Current local status |
| --- | --- | --- |
| Observation duration | 7 consecutive days in `db-read` | Not measured; owner/live gated |
| Sheet read `RATE_LIMITED` events | 0 across all Content read flows, including reconciliation/import | Not measured; owner/live gated |
| Lag-caused `STALE_READ` | 0 refusals with served `sheet_revision` older than last completed import at request time | Not measured; owner/live gated |
| Backlog warm p95 server time | <1000 ms | Not measured; owner/live gated |
| Backlog cold p95 server time | <2500 ms | Not measured; owner/live gated |
| Failed-copy reconciliation | Successful Sheet save; next completed import clears pending | Local fake/PGlite evidence in CODEX_REPORT.md; live rehearsal gated |

Measure warm requests after priming the exact build; cold requests from fresh
instances with cleared disposable caches. Capture the server's `backlog.load`
durations separately and calculate nearest-rank p95 over each recorded sample
set. Count read-rate-limit events by provider and read operation; do not mix
write failures into that metric. For each stale refusal, privately correlate
target, served Sheet token, request timestamp, latest completed import at that
timestamp and that import's token for the same target. Attribute a refusal to
lag only when the served token predates that imported target; separately count
genuine edits after import and unresolved/unknown attribution. Unknown cases
block the zero-lag claim. Export only synthetic or aggregate evidence publicly.
The in-process parity/timing display alone cannot satisfy a seven-day gate.

No live exit number is inferred from unit or browser test counts. Missing,
skipped or failed observations are not passes; Phase C and production MIG-11
remain incomplete until the above private owner/live evidence exists.
### Review follow-up flake watch (#183)

`sweep-fault-375` once failed on `/reconcile` with a CONFLICT fault during
Drive reads in #180, then passed when only failed jobs were rerun. This is
Sheet-mode behavior; it is not evidence against or for DB-read acceptance.
Watch the next applicable CI runs. If it recurs, retain the exact SHA, browser
trace and fault seed, reproduce and diagnose before rerunning; a rerun alone
does not resolve recurrence. No speculative flake fix is included here.

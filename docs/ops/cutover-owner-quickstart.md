# Owner cutover quickstart

Status: owner panel, terminal runner and server status contract implemented and tested offline.
Production still requires reviewed deployment, the new status migration and all
ordered live gates. This page does not record a production cutover.

## In the app: Database switch (recommended)

Sign in with the existing owner account, open **Fix issues** (`/reconcile`),
then find **Database switch**. No terminal or secret is needed. Viewers cannot
see the panel or call its operations. Wait for the coordinator to verify the
reviewed build, deployment, migration and ordered live checks in
[the coordinator runbook](cutover.md). This panel does not waive those checks.

1. Select **Refresh status**. Compare the complete 40-character deployed build
   with the coordinator's reviewed SHA. The table explains the current authority,
   switch record, readiness blockers, evidence ages and applicable recorded
   waivers. The last-import countdown shows the remaining 15-minute freshness
   window; unavailable or expired evidence blocks switching. Local write freeze
   does not prove that other instances or external writers are frozen.
2. At the coordinator's ordered step, select **Import now**, then **Measure**.
   Resolve the plain-language blockers before continuing. **Backup check**
   verifies an archive or the existing audited backup waiver. A waiver result
   does not mean an archive was created.
3. Run **Rehearse rollback** and **Export check** only when instructed. These
   operations may repair derived Sheet/Drive copies. Rehearsal requires the
   correct store mode and frozen/drained writers; export is available in database
   authority mode. They retain the same server guards as the terminal runner.
4. When the coordinator confirms this exact build is ready, select **Switch
   reads to database** or, at the later write-cutover step, **Switch to database**.
   The dialog explains the change and rollback procedure and displays the exact
   build. Type exactly `ACTIVATE` (uppercase, no spaces). Status is checked when
   opening and again after confirmation. A changed build, deployment, authority,
   waiver or gate refuses the switch: close the dialog, review the refreshed
   status and start again. The server still checks the build before claiming a
   request and checks the atomic SQL gate at activation.
5. A verified switch records an epoch. The coordinator must still change the
   ordered deployment settings and verify the deployed app. To return to Sheet
   reads, the coordinator redeploys Sheet mode. After database write authority,
   first freeze/drain all writers, rehearse exact Sheet/Drive rollback, then
   redeploy Sheet mode and verify it before resuming writes.

Operations show an in-progress message. If a request is interrupted or completion
is unconfirmed, keep this tab and ask the coordinator to inspect before retrying
the same action. Its UUID is saved **before** sending in this origin's tab-local
`sessionStorage`, survives reload, and is reused with server idempotency. Only a
verified result clears it. New completed operations get new UUIDs. An activation
pending against another SHA, invalid retry state or unavailable browser storage
refuses another POST; preserve it for coordinator inspection. Do not clear browser
storage or open another tab to force a new request. Closing the tab can lose this
local retry identity; the coordinator must inspect durable operations before
recovery. The app never automatically retries or changes deployment settings.

## Terminal runner (alternative)

The owner runs secret-bearing commands in their own terminal. The coordinator
prepares migrations, SQL proofs, reviews, deployments and recovery. Never paste
the cron secret, terminal transcript, private logs or source content into an
agent conversation or GitHub.

1. **Wait for the coordinator's ready message.** They must supply the reviewed
   full 40-character Git SHA and verify the production origin. They also check
   all-instance freeze/drain, imports, backup/restore, rehearsal and CI as required
   by [the coordinator runbook](cutover.md). Do not invent or shorten the SHA.
   The coordinator verifies the deployed status endpoint and its read migration
   before calling activation ready. Health capabilities alone never prove the
   cutover gates.

2. **Open PowerShell in this checkout.** Keep this terminal private. Set the
   verified production origin (replace the example with the coordinator's URL):

   ```powershell
   $env:APP_BASE_URL = 'https://your-verified-production-origin.example.com'
   npm run cutover -- status
   ```

   PowerShell, cmd and Git Bash can all run `npm run cutover -- ...`. In cmd or
   Git Bash use `--base-url https://your-verified-production-origin.example.com`
   on each command instead of the PowerShell setting. The runner never loads
   `.env` files and has no guessed production URL.

   It asks for `CRON_SECRET`. Enter the existing secret privately: typing and
   paste are hidden. Press Enter. Expect rows in the form `step | PASS/FAIL |
   reason`, including the deployed SHA. Do not send this secret to the coordinator.
   Status also shows deployment ID (or `unreported`), store, epoch, whether
   this instance is frozen, calendar/backup audit booleans, evidence ages in
   milliseconds and both gate verdicts. Missing evidence says `unavailable for
   this build/import`. A PASS on a state/age/waiver row means the value was read;
   admission is shown by the gate rows. Default input is always a hidden prompt. To read the password field of your
   existing, unlocked LastPass CLI entry instead, append `--from lastpass`:

   ```text
   npm run cutover -- status --from lastpass
   ```

   LastPass is read only; the runner never creates or rotates secrets. A process
   that intentionally supplies `CS_CUTOVER_BEARER` may use `--from env`; the
   runner removes that variable before children can start. Do not type the
   secret in a shell command, assign it in shell history, put it in a URL, or
   store it in a file. Non-interactive runs require explicit `--from env`;
   activation always requires an interactive terminal as well.

3. **Run the preparation command when instructed.**

   ```text
   npm run cutover -- all-prepare
   ```

   This checks status, measures every collection, then checks the gate verdict
   again. Every request goes through the app's authenticated operation routes.
   A red/missing status remains a failure even if measurement passes. If an older
   deployment returns HTTP 405, stop and have the coordinator deploy the reviewed
   endpoint and verify its migration. Do not bypass the status check. To run only the measurement when instructed:

   ```text
   npm run cutover -- measure
   ```

4. **Activate only when the coordinator says this exact build is ready.** Replace
   `REVIEWED_FULL_SHA` below with the full SHA supplied by the coordinator:

   ```text
   npm run cutover -- activate-read --sha REVIEWED_FULL_SHA
   ```

   The runner verifies deployed SHA and server gates, explains the epoch change
   and prints rollback instructions. It asks you to type exactly `ACTIVATE`
   (case sensitive, no spaces); input is hidden. Anything else cancels. Gates
   and SHA are checked again after confirmation. Successful activation records
   an epoch; the coordinator still performs the ordered flag change/deployment.
   Later, after the coordinator has completed every write gate, they may ask for:

   ```text
   npm run cutover -- activate-db --sha REVIEWED_FULL_SHA
   ```

   Missing, malformed, contradictory, unknown or red target gate verdicts block
   activation before a POST. The app checks the gate atomically again on POST.
   The runner also sends your `--sha` as `expectedBuild`. If the hostname reaches
   a different build after the last status read, the server refuses before any
   epoch or operation record is written. `cutover_build_mismatch` means stop and
   have the coordinator verify the deployment; preserve the pending retry state.

5. **Run backup, rehearsal and export only at their ordered runbook step.**

   ```text
   npm run cutover -- backup
   npm run cutover -- rollback
   npm run cutover -- export
   ```

   Backup requires a verified manifest hash. `backup_waived` is accepted only
   with `waiver.audited: true`, the exact current build and a SHA-256 audit hash
   derived from the durable owner decision for this build and latest import.
   Removing the environment switch or audit revokes the result; a configured
   backup folder retains the normal verified-archive path. The calendar-wait waiver is not a
   backup waiver. To exercise the daily backup reconcile route in DB mode:

   ```text
   npm run cutover -- backup --scheduled
   ```

   Rollback is a rehearsal/repair operation: it may export through the app to
   Sheet/Drive, requires the coordinator's freeze/drain, and never changes
   Vercel. Success means `readyToFlip: sheet`, with exact parity. Only the
   coordinator can perform the subsequent ordered deployment steps. Export
   likewise can repair derived Sheet/Drive copies through the app; do not run
   it as a read-only check.

6. **Check the deployed build when instructed.**

   ```text
   npm run cutover -- smoke --sha REVIEWED_FULL_SHA
   ```

   Expect live health, matching full SHA and required read capabilities to pass.
   This command sends only read-only health requests. It proves configuration
   and HTTP availability, not authenticated content reads, save/replay/stale
   behavior, provider access or T4. The coordinator arranges those separate
   owner checks on the exact deployed build.

7. **If any row fails, stop at that step.** The command exits non-zero. Share only
   the fixed failure code/reason with the coordinator, not secrets or private
   logs. For `401/403`, they inspect bearer configuration and gate proofs. For
   `409`, they inspect revisions, mode and operation identity. For `429`, wait
   before retrying. For timeout/network/5xx, completion is unknown: rerun the
   identical command with the same URL and SHA after they verify it is safe.
   The pending UUID is reused; after verified completion, the next run gets a
   fresh UUID. Do not erase retry state to force an operation through.

   Private state and timestamped logs live under `artifacts/cutover-owner/` in
   this checkout, which Git ignores. Files contain request UUIDs, SHA and
   aggregate counts/hashes, never the secret or copy. The runner applies owner
   permissions (protected ACL on Windows; directory 0700/files 0600 on POSIX).
   Existing explicit grants to other accounts/groups, inherited root/deny
   entries or unparseable ACL output are refused. Existing retry/log files
   are checked too; they may inherit the verified owner grant. Keep the checkout in an
   owner-controlled folder. Another process or an
   interrupted run holds `run.lock`: ask the coordinator to prove the old
   process has stopped before removing only that lock. Preserve state/logs.
   Local file failure also exits non-zero. Health reports the exact build and
   Vercel deployment ID when provided. The runner binds status to both, records
   the ID in private logs, and shows `unreported` when the platform supplies none.

## Server integration contract

GET `/api/ops/content-cutover` accepts the existing constant-time CRON_SECRET
bearer check or the same owner identity and same-origin/CSRF guard as other owner
mutations. Both GET and POST require that guard for cookie sessions, including
`Sec-Fetch-Site: same-origin` when Origin is absent. A supplied Authorization
header always takes the bearer path; an invalid bearer never falls back to a
cookie. Owner maintenance is available during a Content freeze, while all
operation-specific mode, freeze, admission and provider gates still apply. The
cron backup/export routes remain bearer-only. Responses retain private/no-store
headers on success and failure. GET takes no
query/body content and needs no idempotency key. The server supplies this shape:

```json
{
  "ok": true,
  "status": {
    "build": "<40-character deployed SHA>",
    "deploymentId": "dpl_example123",
    "store": "db-shadow",
    "contract": "schema-2:cutover-1",
    "epoch": "none",
    "writesDisabled": true,
    "gates": {
      "db-read": { "ok": true, "reasons": [] },
      "db": { "ok": false, "reasons": ["write_proof_missing"] }
    },
    "evidenceAgesMs": { "parity": 1200, "phase-c": null, "rehearsal": null, "backup": null },
    "waivers": { "calendar": { "audited": false }, "backup": { "audited": false } }
  }
}
```

For owner sessions only, status also includes `lastImportAgeMs` (a nonnegative
integer or null). It reads only the latest completed import timestamp; read
failure is shown as unavailable. This age is explanatory and never substitutes
for SQL admission. Bearer status bytes and provider reads are unchanged.

`deploymentId` is null when unavailable (health omits the optional field).
`store` is the configured store; epoch is `none`, `read`, `db` or `retired`.
Freeze is the effective local app write boundary; it cannot prove all other
instances or external writers are frozen/drained. Evidence ages refer only to
the current build and latest import; missing or mismatched evidence is null.
Waiver booleans require both the appropriate environment switch and durable
audit. Calendar audit also matches the latest import snapshot; backup audit
matches the build/import. Neither waiver invents a measurement or backup.

The new **UNAPPLIED** migration `20261025000800_content_cutover_status.sql`
contains read-only, service-role-only invoker functions. The status function
calls the existing SQL gate once per target, returning its first named blocker
for each. Resolve it and rerun to see the next blocker. It never changes gate
thresholds, leases, evidence or authority. Named reasons are:
`full_parity_required`, `parity_not_green`, `backup_waiver_export_not_exact`,
`write_proof_missing`, `write_proof_expired`, `phase_c_proof_missing`,
`rollback_proof_missing`, `backup_proof_missing`, `invalid_gate`, and
`gate_unavailable` (unexpected SQL error, with text suppressed).
A valid status request cannot normally produce `invalid_gate`.

The atomic activation operation remains the final authority, including epoch
and contract checks beyond the measured gate. A green GET is an observation,
not a reservation. Activation binds the caller's full SHA to the executing
server before any claim, replay or activation. Use the verified immutable
deployment URL and avoid deployment changes during the run; this SHA guard does
not reserve a deployment ID or its configuration.

POST uses `{action: "activate-read"|"activate-db", expectedBuild: "<40 lowercase hex SHA>"}`
for activation, and `{action: "measure"|"backup"|"rollback"|"export"}` for preparation.
Bodies are strict: extra keys, missing/malformed/uppercase/short/padded builds
refuse activation with HTTP 422, `cutover_expected_build_invalid`. A different
server build refuses with HTTP 409, `cutover_build_mismatch`. No normalization,
prefix matching, operation claim, audit write or epoch change occurs on either
refusal. The server reads `VERCEL_GIT_COMMIT_SHA` (or `CS_COMMIT_SHA` when absent)
once per request and binds that exact value to the SQL store's gate/activation
build before executing. The same UUID with a changed expected build cannot
replay an earlier success, including after redeployment to that new build.
The UUID `Idempotency-Key`, either authentication method and `{ok:true,result}`
remain required. The new export POST wraps the existing repair in the same
operation claims; completed export retries still reverify current providers,
like rollback. The existing private job result now contains an audit envelope
whose actor is `owner_session` or `cron_bearer`; legacy job results remain
replayable. HTTP receipts unwrap it. Operation telemetry also records only the
actor class, action and UUID, including failures, never the owner subject or
cookie. Owner receipts project fixed aggregate fields only; export differences
keep a fixed blocker marker without private row IDs, field names or content.
The terminal runner and its bearer result shapes are unchanged.
A waived backup returns
`{status:"backup_waived",waiver:{audited:true,build:"<exact SHA>",auditHash:"<SHA-256>"}}`
inside `result` (at top level beside `ok` for scheduled backup). The hash
identifies the durable audit without returning its actor, operation/import IDs,
private references or timestamps. Calendar waiver never creates this result.

The scheduled backup and export reconcile routes are GETs. They receive a
persisted client UUID header, but do not implement client-key replay: export
uses its durable checkpoints/leases, scheduled backup uses its server-generated
daily UUID. The CLI cannot add server idempotency or claim exactly-once effects
on those routes. It does not automatically retry any request.

`APP_BASE_URL` already belongs to the app manifest. `CS_CUTOVER_BEARER` is only
a CLI input, not an app/Vercel setting. The manifest drift test compares exactly
against the app Zod schema, so the CLI variable is documented here rather than
added to `scripts/env-manifest.json`. No app defaults change; Sheet remains the
default authority. Never configure the bearer as a Production app setting.
Windows `SystemRoot` selects native System32 permission tools (Git Bash's
`whoami` does not support Windows SID flags); this OS variable is also a local
CLI concern, not an app setting. The shared launcher uses the OS `PATH`.

# Owner cutover quickstart

Status: local runner prepared; production activation is blocked by a missing
server status contract. This page does not record a production cutover.

The owner runs secret-bearing commands in their own terminal. The coordinator
prepares migrations, SQL proofs, reviews, deployments and recovery. Never paste
the cron secret, terminal transcript, private logs or source content into an
agent conversation or GitHub.

1. **Wait for the coordinator's ready message.** They must supply the reviewed
   full 40-character Git SHA and verify the production origin. They also check
   all-instance freeze/drain, imports, backup/restore, rehearsal and CI as required
   by [the coordinator runbook](cutover.md). Do not invent or shorten the SHA.
   The current server has no read-only cutover status endpoint: the coordinator
   must resolve that separately before they can call activation ready. Health
   capabilities alone never prove the cutover gates.

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
   Default input is always a hidden prompt. To read the password field of your
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
   A red/missing status remains a failure even if measurement passes. Today,
   expect `HTTP 405: deployed read-only cutover status route is unavailable`.
   Stop activation and ask the coordinator to resolve that API prerequisite.
   Do not try to bypass it. To run only the measurement when instructed:

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

   The current POST-only server blocks both activation commands before any
   activation request. This protection must not be removed to finish a cutover.

5. **Run backup, rehearsal and export only at their ordered runbook step.**

   ```text
   npm run cutover -- backup
   npm run cutover -- rollback
   npm run cutover -- export
   ```

   Backup requires a verified manifest hash. `backup_waived` is accepted only
   with an explicit server-audited, build-bound waiver hash; the merged server
   currently implements no such waiver. The calendar-wait waiver is not a
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
   Local file failure also exits non-zero. Deployment ID is explicitly
   `unreported` because the current health route does not expose it; the
   coordinator retains verified Vercel identity separately in private evidence.

## Coordinator integration prerequisite

The merged `src/app/api/ops/content-cutover/route.ts` exports only POST with
`{action: measure|backup|rollback|activate-read|activate-db}`, UUID
`Idempotency-Key`, cron bearer, and `{ok:true,result}`. Neither health nor the
reconcile routes expose activation gate verdicts. No server routes or gates
are changed by this CLI issue.

For an independently reviewed follow-up, the CLI reserves GET on the same
cutover path for a read-only, bearer-authenticated, private/no-store response:

```json
{
  "ok": true,
  "status": {
    "build": "<full deployed SHA>",
    "contract": "schema-2:cutover-1",
    "gates": {
      "db-read": { "ok": false, "reasons": ["stale_parity"] },
      "db": { "ok": false, "reasons": ["import_lag"] }
    }
  }
}
```

This is a **proposed integration contract**, exercised by mocks, not an endpoint
that exists in the merged build. Reasons must come from the server gate and
remain content-free; missing/unknown/contradictory verdicts block activation.
The server's atomic activation gate remains the final authority. The SHA check
and a second status read cannot pin a mutable domain between requests: the
coordinator must use the verified immutable deployment URL for activation and
avoid deployment changes during the run.

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

# DB-10: measured live cutover in one coordinator session

Implementation preparation only. No migration, live provider request, deployment,
or authority flip was performed by the builder. Issue [#198](https://github.com/James-Bugden/Content-Studio/issues/198)
is stacked on [#199](https://github.com/James-Bugden/Content-Studio/pull/199).
Do not run this until both exact commits have independent Opus approval and all
required CI is positively green. Do not merge an unreviewed stack replacement.

The owner waived calendar waits on 2026-10-25, **not measurements**. This runbook
supersedes the seven/fourteen-day admission waits in the earlier DB-5/6/9
runbooks for this cutover only. It does not authorize Phase E, Sheet retirement,
data deletion, new billing, public backup sharing, or editing authority notes.
Keep the Sheet and the one-way export. Record actual production cutover in a
separate PR only after the final deployed smoke succeeds.

## Private evidence and environment

Use a private coordinator session. Service accounts cannot own files or use personal Drive storage; use a private shared-drive folder and verify both drive membership and inherited folder/file ACLs ([Google Drive documentation](https://developers.google.com/workspace/drive/api/guides/about-shareddrives)). Never paste keys, real IDs, source text,
manifests, row fingerprints, parity hashes or screenshots into GitHub. Every
step records UTC time, environment, full 40-character SHA, deployment ID, input
and output counts/hashes, classified exceptions, expected/actual outcome and
private evidence location. Failed, missing, skipped and unknown are blocking.
All six collection comparisons read **all rows**, including unknown fields,
Ready Queue, Queue Summary and Workflow Settings. There is no random sample in
the cutover measurement. IDs must match 100%, field equality >=99.9% in each
collection, zero unclassified differences, measured import lag <=15 minutes.
Empty measured collections are allowed; an absent collection is not.

Set these **Vercel Production target only** variables through project settings
or `vercel env update NAME production` (interactive input; never shell history):

| Variable | Required setting |
| --- | --- |
| `CS_DATA_MODE` | `live` |
| `CS_CONTENT_STORE` | ordered `sheet`, `db-shadow`, `db-read`, `db` below |
| `CS_CONTENT_READ_ENABLED` | `true` only after the first full measured gate |
| `CS_CONTENT_DB_ENABLED` | `true` only after every write gate below |
| `CS_CONTENT_WRITE_ENABLED` | `false` while frozen; `true` only at explicit resume |
| `CS_CONTENT_BACKUP_FOLDER_ID` | private folder in a shared drive with individually approved users/service account only; no anyone/domain/group sharing |
| `GOOGLE_WRITE_ENABLED` | `true` for Sheet authority/export and Drive export; `CS_CONTENT_WRITE_ENABLED=false` freezes app authority writes in db-read/db, **not repairs** |
| `SUPABASE_READ_MODEL_MODE` | `off`; disable legacy import schedule |
| `SUPABASE_READ_MODEL_URL`, `SUPABASE_READ_MODEL_SERVICE_KEY` | existing approved shared Career project's server-only credentials |
| `SUPABASE_READ_MODEL_SOURCE_KEY` | existing stable opaque source alias |
| `AUTH_SECRET`, `CRON_SECRET` | existing stable private secrets; do not rotate during measurement |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `CS_SHEET_ID` | existing approved private Google configuration |
| `APP_BASE_URL`, Auth.js owner configuration | existing Production URL/owner, unchanged |
| `VERCEL_GIT_COMMIT_SHA` | Vercel-provided exact reviewed 40-character Git SHA; never invent or shorten it |

Outside Vercel only, use `CS_COMMIT_SHA` for the exact reviewed SHA when the
platform does not provide `VERCEL_GIT_COMMIT_SHA`. Preview stays `fake`; never
copy Production provider credentials into Preview. Flags admit construction;
the repository and every live SQL write/worker check durable gate evidence.
Changing a flag alone cannot pass. Evidence is bound to the latest committed
typed import and full SHA; a new import/build needs new measurements.

For the command examples, privately set PowerShell `$cutoverBase` to the actual
deployment URL and `$cutoverCron` to its existing cron secret; do not print them.
The authenticated coordinator operations use a bearer secret, accept no
caller-supplied content, and return private, no-store responses. Keep each UUID for retries; use a fresh UUID for a new measurement/backup. Rollback retries always reverify fresh provider parity:

```powershell
$cutoverHeaders = @{ Authorization = "Bearer $cutoverCron" }
function Invoke-Cutover([string] $action, [string] $operationId = [guid]::NewGuid().ToString()) {
  Invoke-RestMethod -Method Post -Uri "$cutoverBase/api/ops/content-cutover" -Headers (@{ Authorization = "Bearer $cutoverCron"; 'Idempotency-Key' = $operationId }) -ContentType 'application/json' -Body (@{action=$action} | ConvertTo-Json)
}
```

For every flag change below, run this deployment procedure from a clean
checkout of the reviewed SHA, linked to the existing **Content Studio** project.
`vercel link` is needed only if that private link is absent; select the existing
project and verify the team/project before proceeding. Do not create a project.
For a variable absent from Production use `vercel env add NAME production`
once; for subsequent changes use `update`. Enter the value from the ordered
step interactively. Environment changes require a new deployment; promoting an
old deployment does not inject new flags. ([Vercel env](https://vercel.com/docs/cli/env),
[deploy](https://vercel.com/docs/cli/deploy), [inspect](https://vercel.com/docs/cli/inspect).)

```powershell
git status --porcelain # must be empty
git rev-parse HEAD     # must equal the full independently reviewed SHA
vercel project inspect
vercel env update CS_CONTENT_STORE production
vercel env update CS_CONTENT_WRITE_ENABLED production
# Also add/update the per-mode enable flag named by the current step.
# CLI deployments must have CS_COMMIT_SHA set to this exact reviewed SHA if
# VERCEL_GIT_COMMIT_SHA is not supplied by the Git-integrated deployment.
vercel deploy --prod
# Set cutoverBase to the newly returned deployment URL before these checks.
vercel inspect $cutoverBase --wait
Invoke-RestMethod -Uri "$cutoverBase/api/health"
```

Verify the full deployment Git identity in Vercel and health's displayed
SHA/store. The same procedure implements each rollback command below: supply
the stated mode/write flag rather than reusing an old deployment environment.

## Ordered commands, checks and rollback

1. **Prepare while Sheet remains authoritative.** Keep store `sheet`. Disable
   typed and legacy schedules. Take the current private Sheet/Drive backup.
   Confirm the shared project and daily plan backups are actually enabled;
   record a restorable plan backup, not just the tier name. Confirm existing
   account permissions and the private service-account backup folder. Repeat
   the entire sequence on a copied synthetic workbook and Supabase branch,
   with independent SQL backends, before Production. Measure the 60-second
   rate-limit/backoff window and old-overlay duration; no calendar wait.
   **Rollback:** retain `CS_CONTENT_STORE=sheet`, redeploy the same SHA, smoke;
   no SQL drops, Sheet clearing or reverse imports.

2. **Apply only the seven reviewed, still-unapplied migrations via Supabase
   MCP `apply_migration`, one call per file, exact file contents in `query` and
   the timestamp/name as `name`, using the privately verified project ID.**
   Inspect migration history and definitions first. If a file was applied in
   another form, stop for an additive repair. Never repository-wide `db push`.

   ```text
   20261024000100_content_authority.sql
   20261024000200_content_summary_reads.sql
   20261025000100_content_writes.sql
   20261025000200_content_import_runs_at_index.sql
   20261025000400_content_markdown_export.sql
   20261025000500_content_shadow_live.sql
   20261025000600_content_cutover_live.sql
   ```

   Run every denial/catalog query from [DB-9](database-shadow-live.md), including
   the three `content_studio_cutover_*` tables and eight cutover RPCs. All tables
   force zero-policy RLS; every function is invoker with pinned search_path.
   Prove anon/authenticated denial through hosted REST, and run security/database
   advisors. Replies inventory must be identical. **Rollback:** keep `sheet`
   and disable jobs; leave additive objects in place. Do not drop authority
   tables or restore over existing data.

3. **First import and full measurement.** Deploy exact SHA in `db-shadow`, with
   both authority-enable flags still false. Use the existing owner action
   `/reconcile` -> Import Sheet, with a fresh UUID Idempotency-Key; capture its
   private counts, hashes and named exception ledger. Repeat with two fresh
   keys to prove three complete imports; same-key replay must perform no Sheet
   capture. Then run:

   ```powershell
   $fullParity = Invoke-Cutover 'measure'
   ```

   Require its six collection reports green, full coverage and zero refused
   numeric/size/unclassified differences. Check durable `parity` evidence via
   Supabase MCP `execute_sql`:

   ```sql
   select name,build,import_id,at,payload
   from public.content_studio_cutover_evidence where name='parity';
   -- Bind the full actual SHA as a parameter/private literal, not this label:
   select public.content_studio_cutover_gate('db-read', '<reviewed-full-sha>');
   ```

   A failure must be corrected at the existing authority, reimported, and
   measured again. Do not relabel mismatches or hand-write parity numbers.
   **Rollback:** `CS_CONTENT_STORE=sheet`, redeploy and smoke; DB is ignored.

4. **Read flip and immediate measured Phase C.** Set
   `CS_CONTENT_READ_ENABLED=true`, `CS_CONTENT_STORE=db-read`,
   `CS_CONTENT_WRITE_ENABLED=true`; redeploy exact SHA. Prove health/build/store
   identity, owner login, Library/Backlog, Queue/Ready counts, Schedule, draft
   Drive saga and Typefully sync fields. On a copied synthetic row, test save,
   exact same-key replay, same-key/different-patch refusal, concurrent edit stale
   refusal and Queue append. A successful Sheet save must have a completed
   `write_through` step and matching stored `sheet_revision`; inject a failed
   derived copy on the rehearsal branch, see `refresh_pending`, repair by
   import, and verify it disappears after restart. Measure warm Backlog p95
   <1000ms, cold p95 <2500ms, zero Sheet-read 429s and zero lag-caused stale
   refusals across every serving instance; retain raw request samples and
   attribution. Run T4 on this exact deployed SHA. No invented zero counters.
   **Rollback:** set store `sheet`, redeploy, smoke stale/replay/save/append;
   Sheet is still the sole write authority. Flip back to `db-read`, redeploy,
   verify the same inventory, and record this actual flag round trip.

5. **Freeze, final import, backup and exact rollback preparation.** Record the
   owner's written workbook freeze and the design section 4 Phase D acceptance
   of the Sheet provider's residual read/write race (or stronger enforced edit
   controls). Existing fingerprint/read-back checks cannot prevent a same-cell
   external edit inside Google's non-CAS window. Never claim otherwise.
   Set `CS_CONTENT_WRITE_ENABLED=false` in `db-read`, redeploy, stop other
   writers, drain all old deployments/in-flight sagas, prove write refusals.
   Run final owner import, then `Invoke-Cutover 'measure'` again. Stop **both**
   typed and legacy imports/schedules now. Verify no active shadow lease.

   ```powershell
   $privateBackup = Invoke-Cutover 'backup'
   $rollbackProof = Invoke-Cutover 'rollback'
   ```

   Backup reads all six authority/history tables in one SQL statement snapshot,
   writes six gzip JSONL files plus manifest privately, and re-reads every hash.
   It refuses pending Markdown jobs. Record trusted manifest hash separately;
   restore to an empty matching-schema branch with
   `SqlContentRestoreBranch` / `restoreContentBackup` from the reviewed build,
   using a branch-admin transaction port, never runtime sequence grants.
   Compare all six counts/hashes against the **backup-time** snapshot, test
   ledger replay and sequence advancement; follow [the DB-6 restore drill](database-write-cutover.md).
   Do not guess an outbox baseline on restore: the verified snapshot has zero
   pending jobs. Preserve original DB/outbox and export checkpoints privately
   for any later production recovery; never delete pending jobs.

   Rollback operation drains/verifies Markdown then runs final Sheet export and
   a separate fresh exact inventory, requiring IDs/counts/fields/links/types,
   equal SHA-256 and zero issues. It records durable `rehearsal` hashes; it
   returns `readyToFlip: sheet`, **does not change Vercel**. Execute the actual
   Sheet flag flip, redeploy/smoke, then flip back to frozen `db-read` and smoke.
   This is the measured rollback rehearsal, executed once and retained privately.
   Repeat measurement if a new import/build was introduced.
   **Rollback on any failure:** remain frozen `db-read`; if no DB-only save
   has ever occurred, `sheet` is safe. Preserve every hand edit byte-for-byte;
   repair never force-overwrites it. Resolve differences deliberately using
   ordinary audited patches and privately backed-up source text, then retry.

6. **Record external measured proofs, then admit write authority.** These are
   coordinator attestations backed by raw private evidence, not values inferred
   from local tests. Using Supabase MCP `execute_sql`, call the following with
   actual build/import identity and measured numbers. Do not use sample values
   as evidence. The record RPC checks latest import identity; the gate validates
   all fields, numeric limits and generated parity/backup/rehearsal records.

   ```sql
   select public.content_studio_cutover_record(
     'phase-c','<reviewed-full-sha>','<latest-import-operation-id>',
     jsonb_build_object(
       'smoke',true,'t4',true,'writeThrough',true,'freeze',true,
       'dailyPlanBackup',true,'restoreExact',true,'importsStopped',true,
       'flagRoundTrip',true,'hostedSecurity',true,'independentConcurrency',true,
       'sheetRaceAccepted',true,'privateEvidence','<private-evidence-reference>',
       'sheetRead429',0,'lagStale',0,
       'warmP95Ms',<measured-number>,'coldP95Ms',<measured-number>));
   select public.content_studio_cutover_gate('db','<reviewed-full-sha>');
   ```

   Require `{ok:true}`. Set `CS_CONTENT_DB_ENABLED=true`, store `db`, keep writes
   false and deploy exact SHA. Prove DB revisions/DB body authority, read-only
   mutation refusals, full Sheet parity and outbox state. **Rollback:** while
   frozen, `Invoke-Cutover 'rollback'`; only after its success set store `sheet`
   and redeploy/smoke. Never flip first after DB-only saves begin.

7. **Resume, export, rehearse DB rollback, final smoke.** Set
   `CS_CONTENT_WRITE_ENABLED=true`, deploy same SHA. Exercise one agreed
   synthetic canary through save/replay/stale/Queue append, section export,
   Typefully field rendering. Never mutate real copy for a smoke test. Invoke:

   ```powershell
   Invoke-RestMethod -Uri "$cutoverBase/api/ops/content-export/reconcile" -Headers $cutoverHeaders
   ```

   Require exact export parity and no pending Markdown jobs. On the synthetic
   rehearsal workbook inject Sheet 429/5xx, Drive failure, DB timeout/RLS denial,
   concurrent DB saves and Sheet hand edits; preserve the entire hand-edited row
   byte-for-byte, skip it and show blocking `export_mismatch`. A committed DB
   save remains committed on export failure. Export workers use durable
   non-expiring locks/checkpoints; see recovery below.

   Freeze/drain **all** instances again (`CS_CONTENT_WRITE_ENABLED=false`, store
   `db`, redeploy), run backup and `Invoke-Cutover 'rollback'`. Retain generated
   exact hashes, then actually flip to `sheet`, redeploy/smoke; flip back to `db`
   frozen and verify. Do not run imports during this round trip: Sheet received
   no authority writes, so DB ledger/history/outbox remain the sole authority.
   Resume only after the final db deployment's T4 owner smoke, exact parity,
   health/build identity, backup freshness, read/save/replay/stale/append and
   Markdown/Typefully checks pass. **Rollback:** same freeze -> backup ->
   rollback operation -> exact parity -> Sheet flag -> deployed smoke order.

8. **Schedule and close evidence.** Configure only export repair every 15
   minutes (`/api/ops/content-export/reconcile`) and private backup daily
   19:00 UTC (`/api/ops/content-backup/reconcile`), preserving other project cron
   jobs. Both use the existing cron bearer; confirm actual scheduled runs and
   permitted plan frequency. Keep typed/legacy import schedules off; `db` also
   refuses imports in code. Keep export comparisons, failure intervals and
   checkpoint cells private and durable. No Phase E retirement. Only now prepare
   a separate authority-notes PR with actual flip date and evidence reference.

## Worker interruption and safe recovery

`content_studio_cutover_state` persists full cells/formulas/links, issues,
reports and lag samples. Checkpoint and `exported_sheet_revision` updates share
one SQL transaction without changing Content row_version. A lost save/Google
response cannot authorize another overwrite: ambiguous checkpoints block and
require inspection. Locks **never expire automatically**. This trades automated
crash recovery for avoiding concurrent delayed Google writes.

For a locked worker: keep DB read-only; stop the schedule and every old
deployment/worker, wait for all owned provider requests to finish, back up the
private state row and inspect DB/Sheet/Drive. Do not clear checkpoints or
outbox. Only after proving no worker can continue, use Supabase MCP with the
exact observed token:

```sql
select name,token,updated_at from public.content_studio_cutover_state;
select public.content_studio_cutover_release('<observed-name>','<observed-token>'::uuid);
```

Retry repair. If the Sheet already received a write but its checkpoint did not,
the row blocks rather than treating equality as permission. Resolve deliberately
with private before/after evidence; do not invent a baseline or force repair.
Persistent failures keep DB authority read-only; no automatic rollback or write
resume. Backups never delete archives; retain at least 30 daily and the first
monthly archive for twelve months. No source or Sheet is deleted or cleared.

Coordinator operations retain durable UUID request/result records. A crashed
unfinished request stays in progress: after the drain and state inspection use
a new UUID, retaining the original audit record. Never erase an idempotency
record to make a retry look new. Scheduled backups use a deterministic daily
UUID and replay a completed archive; manual new backup requests use new UUIDs.
Legacy `/reconcile` soak summaries remain historical diagnostics, not DB-10
admission: the durable `content_studio_cutover_gate` is the admission decision.

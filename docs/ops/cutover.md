# DB-10: measured live cutover in one coordinator session

Implementation preparation only. No migration, live provider request, deployment,
or authority flip was performed by the builder. Issue [#198](https://github.com/James-Bugden/Content-Studio/issues/198)
follows merged [#199](https://github.com/James-Bugden/Content-Studio/pull/199).
Do not run this until the exact cutover commit has independent Opus approval
and every required CI context is positively green.

The owner waived calendar waits on 2026-10-25, **not measurements**. This runbook
supersedes the seven/fourteen-day admission waits in the earlier DB-5/6/9
runbooks for this cutover only. It does not authorize Phase E, Sheet retirement,
data deletion, new billing, public backup sharing, or editing authority notes.
Keep the Sheet and the one-way export. Record actual production cutover in a
separate PR only after the final deployed smoke succeeds.

## Private evidence and environment

Use a private coordinator session. Owner decision 2026-10-25 (#204) waives the
private Drive archive gate only, with the switch and audited action below. A
personal Gmail account has no shared drives; a service account cannot own files
in My Drive. Recovery then relies on Supabase daily Pro plan backups plus the
exact one-way Sheet export. There is **no independent archive of history/ledger
outside the project**; project-level loss relies on those plan backups and the
Sheet export, which does not contain the complete history/ledger. Exact rollback
rehearsal remains mandatory. If a folder is configured, use a private shared-drive
folder and verify both drive membership and inherited folder/file ACLs ([Google Drive documentation](https://developers.google.com/workspace/drive/api/guides/about-shareddrives)). Never paste keys, real IDs, source text,
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
| `CS_BACKUP_GATE_WAIVED` | optional `2026-10-25`; coordinator sets explicitly; env-setup never sets it. Effective only with the durable owner audit; removing it revokes the waiver |
| `CS_CONTENT_BACKUP_FOLDER_ID` | optional only under the audited waiver; if configured, still requires a private folder in a shared drive with only the configured CS_OWNER_EMAIL and GOOGLE_SERVICE_ACCOUNT_EMAIL; no anyone/domain/group sharing |
| `GOOGLE_WRITE_ENABLED` | `true` for Sheet authority/export and Drive export; `CS_CONTENT_WRITE_ENABLED=false` freezes app authority writes in every store mode, **not repairs** |
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
flip admission checks the latest typed import and exact deployed SHA. Parity
evidence expires after 15 minutes; other flip proofs expire after 24 hours.
Under the backup waiver, SQL admission also requires the latest completed Sheet
export report within 15 minutes: exact, equal valid hashes, no differences and
no retained issues. A newer failed report blocks even with an exact rehearsal.
Every `activate-db` action (including a completed-operation retry) additionally
reads fresh Sheet parity without writing Sheet cells. Unequal hashes, unexpected
IDs, retained conflicts or unavailable provider reads refuse activation. SQL
checks the durable journal again at the flip; do not replace this action with
a direct SQL activation based only on a historical provider observation.
Changing a flag alone cannot create DB authority. Explicit activation records
a private epoch containing the admitted SHA, schema version and compiled
`CUTOVER_CONTRACT` (`schema-2:cutover-1`). Compatible later deployments use this
epoch without new Sheet imports or SHA evidence. Phase C measurements must
remain fresh; stale/red evidence blocks writes and shows a blocking item.
Activation is an authority decision, so never replay it against a different SHA.

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
   account permissions and either the audited waiver or the private
   service-account backup folder. The waiver does not attest plan backups. Repeat
   the entire sequence on a copied synthetic workbook and Supabase branch,
   with independent SQL backends, before Production. Measure the 60-second
   rate-limit/backoff window and old-overlay duration; no calendar wait.
   **Rollback:** retain `CS_CONTENT_STORE=sheet`, redeploy the same SHA, smoke;
   no SQL drops, Sheet clearing or reverse imports.

2. **Apply only the eight reviewed, still-unapplied migrations via Supabase
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
   20261025000700_content_backup_gate_waiver.sql
   ```

   Run every denial/catalog query from [DB-9](database-shadow-live.md), including
   the four `content_studio_cutover_*` tables, append-only
   `content_studio_backup_waivers` and every cutover RPC (including
   `waive_backup` / `backup_waiver`). Verify service_role cannot UPDATE/DELETE
   waiver records. Check gate/activate have only their new defaulted signatures. All tables
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

4. **Read flip and immediate measured Phase C.** On the measured deployed SHA,
   run `Invoke-Cutover 'activate-read'` with a fresh UUID and require success.
   This records the read epoch; it does not change deployment flags. Set
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

   **With the owner waiver:** explicitly set `CS_BACKUP_GATE_WAIVED=2026-10-25`
   on Production and redeploy this reviewed SHA. After the final import, use
   authenticated private Supabase MCP `execute_sql` to record the decision:

   ```sql
   select public.content_studio_cutover_waive_backup(
     '<fresh-operation-uuid>','<reviewed-full-sha>','<latest-import-operation-id>',
     '2026-10-25','<sha256-of-verified-owner-identity>');
   ```

   The coordinator verifies the owner decision in chat dated 2026-10-25 and
   hashes the verified owner identity privately (no raw identifier in GitHub).
   Retain UUID, actor hash, build, import, by/on and server `recordedAt` privately.
   Same UUID/identical action replays; changed identity/build/import conflicts.
   A new final import/build needs a fresh audited action and UUID.
   No env-only or audit-only waiver is admitted. SQL cannot read Vercel env:
   the server supplies the switch to each gate/activation call. A private direct
   SQL check must explicitly supply that current deployed value as argument 3;
   two-argument `content_studio_cutover_gate('db',sha)` remains conservative
   and requires an archive. Do not supply the waiver argument when a folder is
   configured. Removing the switch revokes it; never delete audit history.

   With no folder, `backup` and its scheduled route return `backup_waived`,
   never a fabricated manifest/verification. `/reconcile` shows **Backup gate
   waived by owner**, date/time and the recovery limitation, alongside every
   failed check. A configured folder keeps the existing verification and
   failure behavior. A present red/expired/mismatched backup proof is never
   skipped by the waiver. Do not delete failed proofs to make admission pass;
   fix/reverify the configured backup.

   ```powershell
   $privateBackup = Invoke-Cutover 'backup'
   $rollbackProof = Invoke-Cutover 'rollback'
   ```

   **Without the waiver (or with a configured folder):** backup reads all six authority/history tables in one SQL statement snapshot,
   writes six gzip JSONL files plus manifest privately, and re-reads every hash.
   Pending Markdown jobs do not block backup: DB bodies and history are the
   authoritative snapshot. Record trusted manifest hash separately;
   restore to an empty matching-schema branch with
   `SqlContentRestoreBranch` / `restoreContentBackup` from the reviewed build,
   using a branch-admin transaction port, never runtime sequence grants.
   Compare all six counts/hashes against the **backup-time** snapshot, test
   ledger replay and sequence advancement; follow [the DB-6 restore drill](database-write-cutover.md).
   The six-table archive includes exact DB bodies/history, not the derived
   Drive outbox or export checkpoints. Keep the original outbox/checkpoints
   privately for operational recovery. After restoring an archive, keep export
   and authority writes disabled until Drive destinations/baselines are compared
   explicitly; never infer a baseline or resume export over external Drive edits.

   Rollback operation drains/verifies Markdown then runs final Sheet export and
   a separate fresh exact inventory, requiring IDs/counts/fields/links/types,
   equal SHA-256 and zero issues. It records durable `rehearsal` hashes; it
   returns `readyToFlip: sheet`, **does not change Vercel**. Execute the actual
   Sheet flag flip, redeploy/smoke, then flip back to frozen `db-read` and smoke.
   This is the measured rollback rehearsal, executed once and retained privately.
   It is required with or without the archive waiver: IDs/counts/fields/links/
   entered types exact, equal hashes, zero differences/issues, same build/import,
   and no older than 24 hours at activation. Repeat on staleness or any change.
   The waiver never permits skipping or relabelling this check.
   Repeat measurement if a new import/build was introduced.
   **Rollback on any failure:** remain frozen `db-read`; if no DB-only save
   has ever occurred, `sheet` is safe. Preserve every hand edit byte-for-byte;
   repair never force-overwrites it. A hand-edit mismatch clears only by
   restoring the exact checkpoint Sheet bytes (including formulas, links and
   types) from private before/after evidence, then retrying export. An audited
   DB patch equal to the hand edit does not reset the checkpoint. Only the
   separate leading-equals export refusal clears via an ordinary audited DB
   patch to exportable text. No live force overwrite or baseline reset exists.

6. **Record external measured proofs, then admit write authority.** These are
   coordinator attestations backed by raw private evidence, not values inferred
   from local tests. Using Supabase MCP `execute_sql`, call the following with
   actual build/import identity and measured numbers. Do not use sample values
   as evidence. The record RPC checks latest import identity; the gate validates
   all fields, numeric limits and generated parity/backup/rehearsal records.
   `dailyPlanBackup:true` and a `privateEvidence` JSON string of 1–2048 characters
   containing at least one non-whitespace character must attest
   actual daily Pro plan backup configuration and a restorable backup; a plan
   name alone is insufficient. `restoreExact:true` still needs a proven restore
   (use the plan backup restore evidence on the waiver path). The owner waiver
   only accepts the absence of the Drive manifest; all Phase C fields, freeze,
   parity/lag and exact rehearsal remain mandatory.

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
   -- Use argument 3 ONLY when the deployed switch is set and no folder exists.
   select public.content_studio_cutover_gate('db','<reviewed-full-sha>',
     '2026-10-25');
   -- Otherwise omit argument 3: the original verified archive gate applies.
   ```

   Require `{ok:true}`. On this deployed SHA run `Invoke-Cutover 'activate-db'`
   with a fresh UUID, retaining its build/contract/epoch evidence. This checks
   every proof again atomically and records DB authority. Only then set `CS_CONTENT_DB_ENABLED=true`, store `db`, keep writes
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
   two-minute token-fenced leases/checkpoints; see recovery below.

   Freeze/drain **all** instances again (`CS_CONTENT_WRITE_ENABLED=false`, store
   `db`, redeploy), run backup and `Invoke-Cutover 'rollback'`. Retain generated
   exact hashes, then actually flip to `sheet`, redeploy/smoke; flip back to `db`
   frozen and verify. Do not run imports during this round trip: Sheet received
   no authority writes, so DB ledger/history/outbox remain the sole authority.
   Resume only after the final db deployment's T4 owner smoke, exact parity,
   health/build identity, backup freshness (or displayed audited waiver plus
   plan-backup evidence), read/save/replay/stale/append and
   Markdown/Typefully checks pass. **Rollback:** same freeze -> backup ->
   rollback operation -> exact parity -> Sheet flag -> deployed smoke order.

8. **Schedule and close evidence.** Configure only export repair every 15
   minutes (`/api/ops/content-export/reconcile`) and private backup daily
   19:00 UTC (`/api/ops/content-backup/reconcile`), preserving other project cron
   jobs. With the audited waiver and no folder, the backup job truthfully reports
   `backup_waived`; do not record it as a verified archive. Both use the existing cron bearer; confirm actual scheduled runs and
   permitted plan frequency. Keep typed/legacy import schedules off; `db` also
   refuses imports in code. Keep export comparisons, failure intervals and
   checkpoint cells private and durable. No Phase E retirement. Only now prepare
   a separate authority-notes PR with actual flip date and evidence reference.

## Every deployment after DB activation

**Never use Vercel instant rollback, or promote a pre-db/Sheet/`db-shadow`/db-read
deployment, while a DB epoch is active.** Its embedded flags/code can resume
Sheet-first writes, run Sheet imports or omit the epoch checks. `db-shadow`
imports must stay OFF during a DB epoch: keep typed and legacy import
schedules disabled and never start an owner import. The database refuses
`content_studio_import_run` and `content_studio_write_through` inside the
transaction while the recorded epoch mode is `db` (error 42501, nothing
recorded), so a wrong flag or an old import cron fails closed instead of
replacing DB-only saves. Imports remain valid before activation, in the
`db-read` Phase C epoch and after a retire, where the new import is required
before re-activation. To roll back code safely, retain
`CS_CONTENT_STORE=db` and freeze writes, then redeploy forward from a reviewed
epoch-compatible commit with the current Production flags. Verify the deployed
SHA and DB epoch before resuming. To roll back authority, follow the full
freeze/drain -> backup -> exact rollback -> frozen Sheet redeploy -> retire ->
resume sequence below. Changing a flag without redeploying is insufficient.

Merges to main deploy Production, including the authority-notes PR. Keep store
`db`, both authority flags and the deliberate write freeze/resume setting.
Inspect the deployed SHA, read epoch and compiled `CUTOVER_CONTRACT`; compatible
builds continue reading/writing from the recorded DB epoch. Do **not** generate
Sheet imports, invent measurements or reactivate just because the SHA changed.
Run health, owner read/save/replay/stale smoke, export parity and backup checks
on that deployed build. A changed contract/schema version blocks writes, reports
`cutover_contract_mismatch` in Fix issues and leaves owner backup/rollback
available. Deploy the compatible code again or follow the verified rollback
sequence. A contract migration needs its own reviewed migration/cutover plan.

For a **permanent** return to Sheet authority, first complete the verified
rollback operation and deploy/smoke `sheet` with writes still frozen. Before
enabling Sheet writes, retire the old DB epoch via Supabase MCP `execute_sql`:

```sql
select public.content_studio_cutover_retire(
  '<new-operation-uuid>'::uuid, '<actual-rollback-build-sha>',
  '<dbHash-from-the-successful-rollback-response>');
```

Use the generated exact rehearsal hash within **15 minutes**. Retirement
refuses a rehearsal older than that, any non-exact rehearsal, and any post or
Schedule write after the rehearsal. If deployment/smoke takes longer, repeat
the frozen rollback operation and use its new hash before retiring. This idempotent,
audited operation marks the epoch `sheet`; stale DB deployments then refuse
instead of serving a database that has missed new Sheet writes. Only after
retirement may Sheet writes resume. A later DB cutover requires a **new import
after retirement**, new full measurement and explicit activation; old proofs
cannot reactivate the retired epoch. Frozen Sheet-to-DB flag rehearsals with
zero intervening authority writes deliberately keep their DB epoch.

The emergency backup/rollback paths check that DB authority exists, not fresh
parity/Phase C/SHA evidence. Backup still verifies private ACLs and every archive
hash. Rollback still requires the all-instance freeze/drain, exact current Sheet
parity and required linked Markdown sections. It never disables an enabled local
write boundary permanently on a refusal. Do not flip to Sheet until readiness
succeeds. A DB body on a row without a Markdown destination is named
`markdown_missing` with a relink/restore action; it creates no impossible outbox
job and rolls back through its exact Sheet body. The named coordinator recovery
**Restore Drive link** (`restore_markdown_link`) clears this item in db mode:
privately restore one unique Library-ID section containing the exact saved DB
body, verify its Drive revision, then call the existing service-role
`content_studio_restore_markdown_link` RPC with a fresh operation ID, SHA-256
request and actor hashes, the stable Library ID, the freshly read `row_version`,
and that verified Drive URL. This fixed-field RPC refuses invalid URLs, missing
rows and rows already linked; normal patches still cannot edit source identity.
It preserves the other source fields. Never patch tables directly, import over DB
authority, erase history, or invent an export baseline. The RPC rechecks the
epoch inside its transaction and records the before-image/audit. A stale
version refuses and the same operation replays without a second write. Run
Markdown repair and Sheet export; require no pending job, exact linked body,
and disappearance of that Library ID's `markdown_missing` item. The Review link
opens the affected post; this is a coordinator recovery procedure, not a new
browser link editor. Missing/duplicate/externally
edited *linked* sections remain named blockers for dependent Markdown recovery;
backups continue even while these jobs are pending. Restore the unique section
and exact expected body from private evidence, then retry export. No external
Drive content is overwritten to clear a blocker.

Preparation rollback in `db-read` deliberately performs an export while app
writes are frozen. It can normalize the documented import equivalents (blank
checkbox to FALSE, number formatting, non-copy trailing whitespace). Back up the
workbook first, retain before/after evidence, and remeasure before the flip;
never run this preparation while other Sheet writers are active. Post-copy
whitespace is never an allowed normalization.

## Worker interruption and safe recovery

`content_studio_cutover_state` persists cells/formulas/links and blocking issues.
Checkpoint and changed `exported_sheet_revision` updates share one transaction
without changing content row versions. Read-only parity never claims or saves
an export lease. Workers release in `finally` on settled failures. A lost claim
or release response cannot strand a lock forever: leases expire in two minutes.
A stale/expired token cannot renew, persist or release a newer worker's lease.
The worker rechecks/renews its token immediately before a Google write.
Sheet writes/appends have a **30-second client timeout**, below the two-minute
lease; a timeout is ambiguous and is never automatically retried.
Independent-backend tests must retain Google's
residual non-CAS race acceptance, including a process paused across a provider
request. Token fencing cannot cancel a Google write already accepted upstream.

On interruption stop/drain old writers, inspect the private state and exact
DB/Sheet/Drive bytes, and retry after release/expiry. Do not clear checkpoints,
conflicts or outbox rows. An ambiguous write blocks on the fresh precondition;
restore the exact Sheet checkpoint bytes from private evidence before retrying.
Diagnostic history is bounded to 2,048 parity/failure records and 4,096 lag
samples; checkpoints/issues are never silently dropped. A 20,000-entry/64 MiB
state cap refuses further export for inspection. Archive retention remains at
least 30 daily and the first monthly archive for twelve months; automatic
archive deletion remains unwired.

Failed coordinator operations release their request claim for the same UUID
retry. Abandoned requests have two-minute leases and token fencing; completed
backups replay the verified archive. Their request identity binds action, mode
and contract, so a compatible redeploy can retry the deterministic daily backup
UUID. Rollback retries always inspect current providers rather than replaying
historical readiness. Use a new UUID for a new backup/measurement/activation;
never erase an operation record. Legacy soak summaries are diagnostics; only
explicit activation runs the SHA-bound admission gate.

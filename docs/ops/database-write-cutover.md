# DB-6 write cutover, private backups and rollback

DB-10 follow-up: live composition and the owner's measured-gate replacement for
calendar waits are specified in [cutover.md](cutover.md). The historical local
status below describes DB-6, not DB-10 admission. Production remains pending;
all live evidence must be collected by the coordinator on the reviewed SHA.

Status: **pending cutover**. This build implements fake/PGlite behavior only.
`CS_CONTENT_STORE` defaults to `sheet`; live data refuses `db-read` and `db`
before provider construction. DB-9 separately prepares live `db-shadow` only
([Phase A runbook](database-shadow-live.md)); write authority stays fake-only. No live SQL,
workbook, Drive folder, flags or schedule were changed. This runbook does not
authorize bypassing that refusal. Follow all gates in
[the design](../implementation/database-migration.md) and
[ADR-0002 including NOTES](../decisions/0002-content-authority-in-postgres.md).
DB-5 follow-ups remain separate [#179](https://github.com/James-Bugden/Content-Studio/issues/179) work.

## Owner-waived private Drive gate (CS-066 / #204)

Owner decision in chat, 2026-10-25: the private Drive archive requirement may
be skipped because a personal Gmail account has no shared drives and a service
account cannot own files in My Drive. Follow [cutover steps 5-6](cutover.md):
explicit Production `CS_BACKUP_GATE_WAIVED=2026-10-25` **and** the idempotent
`content_studio_cutover_waive_backup` coordinator action (verified owner hash,
server timestamp, full build/import identity) are both required. Env-setup never
sets this switch. Removing it revokes the waiver; audit history remains.

This waives only absent Drive archive evidence. Step 6 plan-backup attestation
`dailyPlanBackup:true` with its private evidence reference, every Phase C proof,
freeze, fresh parity/lag, and a fresh exact rollback rehearsal (equal hashes,
IDs/counts/fields/links/types and zero issues; 24-hour flip bound) remain mandatory.
With a configured folder, archive verification is unchanged. A failed backup
proof or other failed check is never converted to success. `/reconcile` displays
**Backup gate waived by owner** and retained failures; backup cron/worker return
`backup_waived` when no folder exists, without a manifest or verification time.
Waived admission also requires a completed exact Sheet export report no older
than 15 minutes, equal valid hashes, zero differences and zero retained issues.
The activation action reads current Sheet parity again, including on retries;
it never exports over a hand edit to make admission pass. SQL rechecks the
retained journal at activation. The Phase C private evidence reference must be
a JSON string of 1–2048 characters containing a visible printable character
after removing Unicode whitespace, invisible characters and format controls.
The shared SQL reference validator preserves the original padded reference.

Recovery is Supabase daily Pro plan backups plus the one-way exact Sheet export.
There is **no independent archive of history/ledger outside the project**.
Project-level loss relies on the plan backups plus Sheet export; the latter
cannot reconstruct the complete history/ledger. Emergency backup (when a folder
is configured) and exact rollback remain available; rollback ordering below is
unchanged. No Phase E authority, billing change, production flip or SQL application
is performed by this PR. The new migration is UNAPPLIED and coordinator-only.

## Gates before separately reviewed live enablement

1. Confirm the migration files were never applied in an earlier form (#179).
   Apply only reviewed additive migrations, never repository-wide db push.
   Evidence hosted MIG-04 denial/security-advisor checks for every new object.
2. Phase A: three complete imports with exact IDs/counts and fields except named
   exception-ledger entries; no unclassified mismatch.
3. Phase B: seven complete days **and** 200 comparisons; 100% IDs, >=99.9% fields
   per collection, no unclassified mismatch, import lag p95 <=15 minutes, no
   unrepaired failure older than one hour. Missing measurements never pass.
4. Phase C: preview smoke on the exact build, seven days of zero Sheet read
   rate limits, zero lag-caused stale refusals, warm Backlog p95 <1 s and cold
   <2.5 s. Evidence must span every deployed instance.
5. James confirms the workbook freeze **in writing**. The fingerprint check
   remains mandatory even after that assurance.
6. James confirms the shared Supabase project, paid plan/billing and that
   **daily plan backups are actually enabled**. Do not assume plan backups
   exist. Record private configuration evidence and a restorable backup. PITR
   is recommended and requires his billing choice.
7. Unless the audited owner waiver above is active, owner shares a private backup Drive folder with the service account and
   confirms no public/link sharing. Production credentials and CRON_SECRET
   stay Production-only; preview uses synthetic data.
8. Separately review and wire durable checkpoints/decisions/measurements,
   consistent SQL backup snapshots and the private Drive port. Current maps
   and fake folder are local evidence only. Checkpoints must privately persist
   full exported cells/links/formulas, exported_sheet_revision and DB version
   atomically, without bumping content revisions. Cross-instance leases and
   durable decision/idempotency records are mandatory; instance mutexes alone
   cannot authorize live operation. No such live client is constructed here.
9. Unless the audited owner waiver above is active, scheduled private backup must run once, with manifest and six file hashes
   re-read and verified. Restore into an empty Supabase branch with exact
   six-table parity. Keep the trusted manifest hash separately.
10. Complete the copied synthetic workbook/Supabase-branch rehearsal below,
    including independent SQL backends, rollback and exact deployed SHA smoke.
11. After the written freeze, final import must show exact parity. Stop and
    verify **both typed and legacy imports are off before** write authority
    flips. Enable export-only scheduling: `/api/ops/content-export/reconcile`
    every 15 minutes, `/api/ops/content-backup/reconcile` daily 19:00 UTC
    (03:00 Taipei). Both require `Authorization: Bearer <CRON_SECRET>`.
    Owner configures cron frequency/plan and confirms an observed scheduled
    run. This change installs no schedule.

For every gate record SHA, environment, timestamp, expected/actual result and
private evidence location. Failed/skipped/unknown is not green. The DB-7 delegated choice is option (b); see
[its gated preparation and extra rollback checks](database-draft-authority.md).

## Export and conflicts

All four repository mutations (Library, Queue, Schedule, Replies Queue insert)
export after a successful DB write. Export failure leaves that success intact.
Repair writes changed rows by stable ID; a new Queue idea appends once. Missing
exported rows, duplicate IDs, missing headers and bounded-read exhaustion fail
closed. Unknown columns retain exact values/formulas/links. Writes use RAW and
never replace formulas. A formula/rich-link display RAW cannot reproduce stays
blocking, not exact. Ordinary repair uses one inventory read per collection
plus fresh reads/read-back for changed rows; unchanged repairs write nothing.

Checkbox updates and appends share the Sheet repository's RAW serializer:
`Queue for Schedule` and `Posted` are booleans, never the text `TRUE`/`FALSE`.
Export parity and the fake transport retain that entered type, so identical
formatted checkbox text alone cannot pass. A DB-origin Replies idea has no
ownership of unknown Queue columns it never carried; these are excluded from
that row's comparison projection. Imported rows still compare every retained
passthrough column, including blanks and lost values. Checkpoints still cover
the whole exported Sheet row so later unknown-column hand edits block writes
and exact parity, even when the owned-field projection hashes still match.

Recovery action **Change authoritative value** (`change_authoritative_value`):
Text starting with `=` is currently refused by export as a named blocking
`export_mismatch` before any cells in that row are written. RAW prevents formula
evaluation, but the current formula projection cannot distinguish entered text
from formula syntax reliably. Resolve/change that authoritative value through
the normal audited patch flow; do not prepend an apostrophe to the DB copy or
claim byte-equal export. Preview the affected fields privately, use the ordinary
authenticated, revision-checked, idempotent DB patch with a new operation ID to
choose replacement text without a leading `=`, and retry export. Confirm the
blocking item clears and fresh parity is exact. If the exact leading `=` text
must be retained, leave the row blocked; this action does not authorize changing
the meaning of the content. Supporting this text requires a separately tested
entered-value representation at the transport boundary.

Before writing a changed row, compare its fresh Sheet fingerprint against the
checkpoint. A mismatch skips the **whole row**, preserving all Sheet cells,
and raises blocking `export_mismatch` with the stable ID and differing header
names. Repeated repair never clears it by overwriting. The design's one-round-
trip Sheet race remains; read-back and fresh parity are required. A hand edit
to the **same cell** between the fresh read and write can be silently overwritten;
read-back cannot detect that lost edit. Before Phase D, record the owner's
decision whether the 14-day comparison window must measure and explicitly accept
this race, or require a stronger transport/freeze control. This remains an open
live/product gate, not local acceptance. A lost export
response still fails closed if the checkpoint cannot confirm the new bytes.

Resolution is an explicit owner decision, never part of repair:

1. Privately preview differing fields, full current Sheet fingerprint and DB
   version; retain a new decision operation ID.
2. **Export DB value:** `ContentExporter.resolveMismatch` takes owner actor,
   operation ID, stable target and both preview tokens. A changed token refuses
   as STALE_READ. Viewer/invalid/reused-different decisions refuse. It records
   actor hash, differing fields and direction. Replaying a decision never grants
   permission to overwrite another later edit. The local helper has no live/UI
   action endpoint; durable live wiring is gated above.
3. **Copy Sheet value into DB:** use a normal validated repository patch, new
   operation ID and DB expectedRevision so history/audit retain the deliberate
   change. Protected/unrepresentable fields refuse. Re-preview and explicitly
   authorize the export baseline as in step 2. Never run imports in `db` mode.

Persist checkpoints before restart. Discarding them is not conflict recovery.
Provider failures preserve a known blocking mismatch and its field names while
also tracking export lag. Reconciliation continues to show both even if fresh
inspection fails. Duplicate stable Sheet IDs produce an explicit blocking item.

## Daily comparison ledger

Require **14 complete days AND 50 mutations**, with daily `export_parity`:
exact stable-ID sets/counts, every exported field byte-equal, equal DB/Sheet
SHA-256 hashes, lag p95 <=15 minutes and zero export failures older than one
hour. Include Typefully sync fields, timestamp/hash stamps, metrics and unknown
columns. Missing days/lag samples stay unmeasured. `export_lag` needs attention
at 15 minutes and blocks at 60; `backup_fresh` needs attention after 36 hours
without verification, on failure, or before the first verified backup.

`ContentExporter.comparison()` computes daily facts at Taipei boundaries;
repair returns them and reconciliation displays thresholds/counts. Local lag
starts at pending detection, not an unseen SQL update. Production must measure
from authoritative change timestamps, persist all samples/failure intervals
across instances/restarts, and count successful distinct mutations durably.
Local instance summaries cannot meet the live time gate. Every production
comparison-period measurement is currently **not measured**.

Reconciliation page loads inspect parity within the exporter's single flight
without adding comparison samples. Only export/repair completion samples feed
the ledger. A day with no lag observation still cannot be green, even if it had
no mutations; this conservative policy is unchanged and needs an explicit
measurement design before live use.

## Private backup and restore drill

`ContentBackupSource.snapshot()` must read posts, schedule, workflow_settings,
row_history, operations and audit_events in **one repeatable-read transaction**.
Each table becomes a new immutable gzipped UTF-8 JSON-lines file. The manifest
contains format/schema version, backup UUID/time, private file handles, row
counts, compressed byte counts and SHA-256 per file. History contains copy:
never log/commit real payloads, IDs, manifests or private folder configuration.

`createContentBackup` re-reads the manifest and **all six** compressed files,
checking hashes, lengths, counts and schema before advancing freshness. Partial
uploads preserve the previous verified backup. Keep 30 daily archives plus the
first verified archive per Taipei month for twelve months (`retainedBackups`).
Deletion is deliberately unwired; review a retention list before introducing a
private delete port. Until then archives remain longer, never removed early.

Backup verification currently accepts only the compiled Content schema version.
A future schema bump must add a versioned archive reader/restore migration and
prove old archives remain restorable before deployment. This round does not
change the archive format or authorize a schema bump.

**Schema-bump re-backup procedure (required until versioned restore exists):**
Before a bump, pause writes and take/verify a final six-table backup with the old
build. Preserve that exact build SHA, its schema/migrations, the private archive
and separately trusted manifest hash; rehearse its restore into an empty branch
at the old schema using that build. Old archives must be verified/restored with
their matching build, never relabelled with the new schema version. After the
separately authorized migration, while writes remain paused, take a new backup
with the new build, re-read all six hashes and rehearse restore/parity into an
empty branch at the new schema. Resume writes only after the new-schema backup
and restore succeed. Keep both archives/builds through retention; if either
drill fails, stop the bump and use its reviewed rollback. No historical archive
reader or automatic cross-version restore is introduced by this follow-up.

Restore steps:

1. Retain the manifest handle and trusted SHA-256 separately in private evidence.
   Create an isolated branch with reviewed schema, no app writers and all six
   target tables empty. Explicitly confirm its branch-admin connection.
2. Construct `SqlContentRestoreBranch` with that branch-admin transaction port.
   The runtime service role intentionally lacks sequence UPDATE: never broaden
   runtime grants for a restore drill. `restoreContentBackup` verifies every
   archive before writing and refuses a wrong purpose/schema/nonempty target.
3. The tested implementation locks all six branch tables, checks emptiness,
   defers lineage constraints, inserts full rows and reseeds history/audit
   sequences atomically. A late constraint error leaves no content.
4. Compare exact counts and order-independent canonical row hashes for all six
   tables, including ledger/history/audit, against the **backup-time** source
   snapshot. Verify replay and a new branch mutation after restore. Do not
   compare against a source that accepted later writes. Hash/parity failure
   blocks acceptance; never automatically redirect the app to the branch.
5. Record private branch identity, source SHA/snapshot time, manifest hash and
   every count/hash/result. Disposable-branch removal is separately reviewed;
   no production data cleanup is part of this drill.

## Rollback to Sheet: exact order

Unlike Phase C, flipping the flag first would lose DB-only saves.

1. Stop new writes on **every instance**, keeping DB authority/read mode:
   `CS_CONTENT_STORE=db`, `CS_CONTENT_WRITE_ENABLED=false`. Deploy the same
   reviewed build and prove write refusals. Stop other writers, drain every
   in-flight request/saga, retain DB/history backup.
2. Call `ContentWriteCutover.rollbackToSheet(flipPort)` in the gated maintenance
   process. It disables its mutation boundary, drains it, runs final export,
   then obtains a **fresh** exact parity report. The live flipPort must change
   deployment configuration only after this success, never before.
3. Require exact IDs/counts/fields/links, equal DB/Sheet hashes and no exporter
   issues. Hand edits, provider failures and extra/missing rows block the flip.
   Stay DB read-only while resolving them. Never automatically re-enable writes
   after a rollback error.
4. Record final parity counts/hashes, manifest hash, exact SHA and timestamps.
   **Only then** set `CS_CONTENT_STORE=sheet`. Keep DB import/export jobs off
   until a separate decision; DB is ignored for Sheet-authority writes.
5. Verify the deployed Sheet build before enabling Sheet writes. Exercise one
   synthetic read/save, stale refusal, replay and Queue append; compare exact
   inventory and inspect health/private audit. Resume edits only after smoke.
   Update authority notes with the actual flip date/mode; this build records
   no invented cutover date.

## Rehearsal and limits

Local T0, through the shared queue, without installing dependencies:

```text
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase --maxWorkers=1
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
```

MIG-12 local tests inject a hand edit, prove unchanged Sheet bytes/skipped row/
blocking field names, and test rollback ordering/refusal and exact hashes.
MIG-13 restores all six tables under PGlite, proves parity/replay/sequence
reseed, rejects corruption and rolls back late constraint failure. These
results are **not hosted T3/T4 evidence**.

Before Phase D, T3 must repeat full import -> shadow -> read flip -> write flip
-> export -> hand-edit preservation -> final exact rollback on a copied synthetic
workbook and a Supabase branch. Include backup/restore, independent SQL backends
and concurrent retries. MIG-05 remains live-gated until those records prove
imports off and exactly one authority throughout. T4 is owner-only smoke on the
exact deployed SHA. No hosted security/backup, live workbook/branch, freeze,
deployment smoke or live observation window is passed by local tests.

Phase E belongs to DB-8: only after every report is exact for the complete
14-day/50-mutation period **and** James agrees to retire the live copy may export
stop, the weekly private human-readable backup remain, Sheet code retire and
authority docs change. No workbook deletion.

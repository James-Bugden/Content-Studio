# ADR-0002: Phased Content authority in Postgres

- Status: Accepted; schema preparation only, no production phase flipped
- Date: 2026-10-24
- Related: CS-055 / [DB-1 #145](https://github.com/James-Bugden/Content-Studio/issues/145), design merged in #131
- Supersedes: ADR-0001's scope limit on a future Content write authority; preserves its shared-project isolation and explicit migration requirements

## Decision

Accept the phased design in [database-migration.md](../implementation/database-migration.md), especially sections 1.1–1.7 and Phase A. The owner decision of 2026-10-24 authorizes preparing Postgres as Content's eventual operational authority. It does not flip a runtime flag or waive a phase gate. Google Sheets remains authoritative until the corresponding production phase is evidenced and flipped. Typefully remains the publisher, Drive the asset store, and the existing ContentRepository the application boundary. The separate decision about canonical Drive Markdown bodies remains gated by design section 3.

Use additive `public.content_studio_*` objects in the shared Supabase project. Apply only the explicitly reviewed migration when deployment is separately performed; never run a repository-wide `db push`. DB-1 produces SQL and PGlite evidence only and does not apply anything to a live database.

All new tables enable and force RLS with zero policies. Tables, sequences, views and invoker functions revoke PUBLIC, anon and authenticated access and grant only service_role access. The migration wraps object creation and ACL/RLS changes in an explicit transaction so a failure under a non-transactional runner leaves no partially secured objects. Views use security_invoker and every function pins its search_path. Auth.js owner authorization stays at the future server adapter boundary; this decision does not introduce Supabase Auth for Content or authorize browser access. Replies objects and policies remain untouched.

## DB-1 SQL contract

`20261024000100_content_authority.sql` defines the seven tables and two derived views in design section 1.1. It also defines `content_studio_import_runs` as the durable home of the Phase A counts, hashes and named exception ledger. The existing jsonb Sheet staging objects remain unchanged. This additional prefixed table contains run evidence, never another copy of Content payloads.

The DB-1 version singleton starts at 1; DB-3 advances it and the compiled adapter expectation to 2. The server-only adapter contract constant and `assertContentSchemaVersion` agree with it; missing/malformed/different versions raise SCHEMA_DRIFT with kind `version`. Runtime schema reads and adapter wiring belong to the later adapter issues.

The four entry points are:

- `content_studio_apply_patch(operation_id, patch_hash, actor_hash, target_kind, target_id, expected_version, patch)`
- `content_studio_insert_queue_idea(operation_id, patch_hash, actor_hash, library_id, row)`
- `content_studio_write_through(operation_id, patch_hash, actor_hash, target_kind, target_id, expected_version, row)`
- `content_studio_import_run(operation_id, snapshot_hash, actor_hash, counts, hashes, exceptions, rows)`

Kinds are `library`, `queue`, `schedule`, `workflow_settings`. Identifiers are stable Sheet identifiers; posts' kind selects the collection. JSON object keys are SQL snake_case column names. Hashes are lowercase SHA-256 hex computed by the trusted server caller over its canonical envelope; actor_hash contains no raw identity. That caller must bind the exact patch, target and operation type to the supplied hash. Caller authentication and business/domain validation still apply; the SQL layer also rejects unknown/protected fields, enforces normal writable allowlists, a 50,000-character limit on each top-level string and a 262,144-byte limit on each mutation's `p_data::text` (including nested passthrough), typed constraints and version preconditions. Schedule rows cannot name themselves as parent; the six nullable metric integers must be nonnegative. Longer lineage cycles remain outside this constraint.

The SQL result contains only `{ok, code, steps, revision}`. `steps[0].state` is `applied`, `already_applied`, `stale`, `not_found` or `conflict`. `revision` is the current bigint row_version, not the domain's 16-hex revision: the future adapter converts that version via `fingerprintValues(['db', table, id, row_version])`. Stale results report the current version without returning copy. Only successful (`ok=true`) results enter the operation ledger and replay exactly, matching today's `SheetsContentRepository` in-memory map. NOT_FOUND, STALE_READ and queue CONFLICT attempts remain in the redacted audit trail but do not consume the operation ID: a retry re-executes against current state, including a fresh expected_version for an unchanged patch. Once success is stored, operation reuse with a different hash/target/actor returns CONFLICT and preserves the original ledger row.

A namespaced transaction advisory lock serializes the small owner-only corpus, including simultaneous first deliveries and imports. Indexed primary-key row locks and compare-and-set updates enforce expected_version. Updates save full before-images, changed field names and SHA-256 before/after hashes; inserts save null before-images. Audit and operation results contain no copy. Any error in history, audit, ledger or deferred lineage validation rolls back all row changes. No-op patches do not bump versions or add history. A content-changing import/copy bumps the version; an identical content copy changing only Sheet fingerprint/row position preserves it, with metadata changes still recorded in history.

Write-through/import expected_version asserts the version observed before the Sheet read; null asserts row absence. A copy is already_applied regardless of that precondition only when every supplied field equals its stored typed value, including any supplied sheet_revision and source_sheet_row. A difference in either metadata field still requires the matching expected_version, although applying metadata-only changes preserves row_version. A stale changed row is refused, never overwritten. Import rows are `{target_kind, target_id, expected_version, row}`; counts and SHA-256 hashes cover exactly the four typed collections. Duplicate stable targets and unknown exception classes are rejected. Exception entries contain only `{class, collection, field, hash}`, with classes `formula_display`, `number_formatting`, `trailing_whitespace`, `blank_boolean`, `boolean_formatting`, `timestamp_formatting`. Imports atomically upsert, support child-before-parent schedule lineage and use one enclosing operation ledger entry. Full-row construction, snapshot hashes, parity classification, scheduling and handling rows absent from a snapshot belong to DB-4; this RPC does not delete absent rows or declare parity passed.

The shared `content_studio_mutate` implementation is also service-role-only. Its internal import mode participates in the enclosing import transaction and ledger rather than deriving child operation IDs that could collide with other operations. Service role is already trusted with direct table DML; this helper is not a new user authorization boundary.

## Consequences and gates

DB-1 introduces no runtime reads/writes, data import, export, store-mode changes or live deployment. Phase A remains incomplete until the reviewed migration is explicitly applied and three full imports prove exact stable-ID sets, counts and allowed field parity. PGlite cannot evidence the hosted Security Advisor or PostgREST configuration. Hosted MIG-04 denial checks and the advisor remain mandatory before claiming live security acceptance.

Phases B–E retain all parity thresholds, owner gates, backup/history exports, rollback rehearsals and production smoke requirements in the accepted design. There is one authority in each mode. The Phase C Sheet-read-back copy is derived and repairable; Phase D Sheet export is one-way and precondition-checked. No bidirectional authority is introduced. No Reply table is joined into Content authority.

## Phase A rollback inventory

Before a Phase A rollback, stop the typed importer and keep `CS_CONTENT_STORE=sheet`. These objects are derived while the Sheet is authoritative. The exact DB-1 drop list below is documentation for a separately reviewed rollback; it has not been executed against a live database. Do not use it after database write authority begins. The original migration is one-shot, not rerunnable over existing objects.

```sql
begin;
drop view if exists public.content_studio_ready_queue;
drop view if exists public.content_studio_queue_summary;
drop function if exists public.content_studio_apply_patch(text, text, text, text, text, bigint, jsonb);
drop function if exists public.content_studio_insert_queue_idea(text, text, text, text, jsonb);
drop function if exists public.content_studio_write_through(text, text, text, text, text, bigint, jsonb);
drop function if exists public.content_studio_import_run(text, text, text, jsonb, jsonb, jsonb, jsonb);
drop function if exists public.content_studio_mutate(text, text, text, text, text, text, bigint, jsonb);
drop function if exists content_studio_private.content_studio_mutate(text, text, text, text, text, text, bigint, jsonb);
drop schema if exists content_studio_private;
drop table if exists public.content_studio_import_runs;
drop table if exists public.content_studio_schema_version;
drop table if exists public.content_studio_audit_events;
drop table if exists public.content_studio_row_history;
drop table if exists public.content_studio_operations;
drop table if exists public.content_studio_workflow_settings;
drop table if exists public.content_studio_schedule;
drop table if exists public.content_studio_posts;
commit;
```

Table drops also remove their owned `content_studio_row_history_history_id_seq` and `content_studio_audit_events_event_id_seq` sequences, primary-key indexes and the `content_studio_schedule_parent` and `content_studio_row_history_target` indexes. No CASCADE is used: later dependencies must stop the rollback for review. Keep the existing Sheet read-model/staging objects (`content_studio_sheet_rows`, `content_studio_sheet_stage`, `content_studio_sheet_sync_runs` and their RPCs) and every Replies object.

## NOTES for DB-2/DB-3/DB-4

- DB-2 review round 1 — summary parity: `syntheticQueueSummaryRows` and the DB view use the same synthetic Queue rows/rules. Their contract proves self-consistency, not equality with the real Sheet summary tab. DB-4's parity report against the real Sheet is the actual check.
- DB-2 review round 1 — zero-row sources: the fixture correction removed the `Synthetic Interview Guide` summary source with zero Queue rows. A grouped DB view cannot represent a source with no rows. This is a known Sheet-vs-DB difference for DB-4 to classify explicitly in parity reports.
- DB-2 review round 1 — Ready Queue revisions: in `db-read`, the derived Ready Queue returns the imported Library row revision. The Sheet Ready tab computes its revision from that tab's own cells. The shared list contract checks only the 16-hex revision format and stability, not equality between those tokens; DB-4 must account for this difference.
- DB-2 review round 1 — deterministic ordering: the unapplied DB-2 migration pins every text column used by PostgREST ordering to `COLLATE "C"` (PostgREST has no per-order collation modifier), and both master-link minima explicitly use `COLLATE "C"`. It rebuilds the two dependent views transactionally with their original invoker security and server-only grants. No live database was changed.
- Finding 3 — DB-3: store the entry-point mode in the operation ledger and compare it on replay. Currently the trusted caller must bind operation type into the hash; SQL does not independently enforce mode identity.
- Finding 4 — DB-4: the canonical import snapshot_hash must cover counts, rows and exceptions (and collection hashes). Replay currently trusts that caller-supplied hash.
- Finding 7 — DB-3: consider moving `content_studio_mutate` into a non-exposed schema. Service-role callers can currently invoke import mode directly without an enclosing import ledger entry; service role already has direct DML privileges.
- Finding 8 — resolved in DB-2: `20261024000200_content_summary_reads.sql` retains the existing view columns and adds `counts` with Total, Not Reviewed, Approved, Queued and Needs Fix. It retains DB-1's Content Queue collection scope, groups once per content source, and chooses the lexically first nonblank master URL when a source has several (falling back to the Source Markdown URL when the Source Master File has no link). Not Reviewed includes blank/Not Reviewed/Pending; Needs Fix includes Changes Requested, copyright REWORK or duplicate CHECK/DUPLICATE. SQL and fake parity, multiple masters, security_invoker and role denial are tested with synthetic PGlite data. The adapter also accepts nullable named counts as `QueueSummaryRow` requires. No migration has been applied live.
- Finding 11 — DB-3: PostgREST defaults to READ COMMITTED. Under REPEATABLE READ/SERIALIZABLE the snapshot can precede the advisory lock, so concurrent first deliveries may fail closed with 23505/40001; define retry handling and verify with real independent backends. PGlite's single connection cannot establish that behavior.

## DB-3 adapter and replay contract

DB-3 enables writes only when the repository uses DB revisions. `db-read`
remains read-only here; DB-5 owns Sheet-first writes in that mode. The runtime
still defaults to `sheet` and rejects every live DB store mode. No migration
has been applied live, no production phase is flipped, and no new dependency
is required.

The ledger stores content-free SQL results, never the application record.
Replay responses add `replayed: true` without changing the stored result.
The adapter reconstructs the exact successful record from the current row at
that version or the earliest matching history before-image after a later edit.
A confirmation read failure is PARTIAL_FAILURE with a completed DB step; a
retry uses the same durable ledger entry. DB-4 must preserve this revision
snapshot rule when adding metadata-only copies that do not increment versions.
No-op patches preserve the row version and add no history; attempts have audit
events, while ledger replay adds neither history nor a duplicate audit event.

DB-3 review round 1 clarifications: failed row attempts (`NOT_FOUND`,
`STALE_READ`, queue identity collision) write audit events without consuming
an operation ID. Envelope/field validation exceptions and reuse of an already
successful operation with a different hash/target/actor/mode return before
the row-attempt audit insert; these refusals do not create audit rows.

Typed DB writes intentionally have stricter validation than Sheet string cells:
`hookScore: '7.5'` and `'8/10'` are rejected (`value_invalid`) because the DB
column is an integer, whereas Sheet accepts both strings. Each string remains
capped at 50,000 characters; the entire DB patch also has a 262,144-byte cap
(SQL measures jsonb text, including nested passthrough). Two 45,000-character
zh-TW fields can therefore pass Sheet validation but fail DB validation
(`value_size` at the adapter). Timestamp writes require ISO date-times with
explicit `Z` or numeric offset; non-ISO `publishedAt: '2026/10/01 09:00'`
and offset-free ISO date-times are rejected instead of depending on the server
time zone. Sheet retains string cells and its Taipei display conventions.
DB-5/cutover parity must account for these differences; they do not authorize
silently coercing existing Sheet content or flipping authority.

`exportContentAudit` is an explicit public-evidence projection: identifiers and
hashes become at most 12-character hashes, field names use a compiled allowlist,
and raw identifiers, URLs, timestamps and copy are omitted. Private database
history and audit tables retain their operational identifiers. The scheduled
private history/backup exporter remains DB-6 work.

- DB-4 review round 1 ? representation exceptions: the unapplied DB-1 SQL
  allowlist also accepts `blank_boolean`, `boolean_formatting` and
  `timestamp_formatting`. Blank Posted/Queue-for-Schedule cells become false
  with `blank_boolean`; other accepted boolean spellings are named separately.
  `number_formatting` includes leading zeros and ASCII spaces as well as commas.
  Timestamp instants may render in Taipei, but every changed cell is named;
  ambiguous multi-delimiter sync stamps block the whole import. Setting keys
  requiring trimming block rather than silently changing identity.
- DB-4 review round 1 ? parity: unknown-column passthrough is compared and
  returned by the typed reader. Only Next Action, Image Next Action and Has
  Image permit removal of one terminal ASCII-space suffix with at most one
  newline. Post copy (including hooks) is exact. Classified differences remain
  unequal fields for the 99.9% gate, except the explicitly named blank-checkbox
  equivalence (blank to FALSE only), which is counted separately in the UI; formula display belongs only to the import
  ledger, never a parity equivalence. Measured empty collections are vacuously
  equal and shown as n/a; missing/failed observations are still blocking.
- DB-4 review round 1 ? privacy and scope: parity fingerprints and exception
  hashes use HMAC-SHA256 with the existing server-only AUTH_SECRET; sessions
  without it use an ephemeral process key. Key rotation changes evidence tokens.
  Canonical snapshot/collection hashes remain unsalted integrity checks over
  complete envelopes, not anonymization: protect reconcile/import-ledger access
  as owner/viewer data, and never publish production hashes. Telemetry emits one
  aggregate event per collection observation, without row/field fingerprints.
- DB-4 review round 1 ? scheduling: imports are allowed only in db-shadow,
  including the writer boundary. Durable typed operation IDs encode trigger
  class (owner/scheduled), the configured non-personal source key and request
  UUID; actor hashes bind trigger class and source with the same private key.
  Owner requests send an Idempotency-Key UUID. The active-run guard and bounded
  completed-request cache are per server instance; SQL locks, CAS and the durable
  ledger remain the cross-instance safeguards. A retry after an instance restart
  with a changed snapshot fails closed as CONFLICT rather than overwriting data.
  This is not a distributed job scheduler or permission to flip reads.

## DB-5 local Phase C contract (no live cutover)

`ContentReadCutoverRepository` composes DB reads with Sheet-only authoritative
mutations. Imported/read-through tokens are Sheet fingerprints. Successful
Sheet read-backs alone reach `write_through`, with a separate hashed operation
ID and the DB version observed before the Sheet mutation; failed derived copies
cannot fail the mutation. DB-read imports are now explicitly allowed at both
the snapshot builder and writer boundaries, and capture **Sheet** snapshots,
never their own DB-served data. Imports remain forbidden under DB authority.
The fake importer shares the actual mutation store and preserves its reader
identity, so scheduled repair is exercised through the container, not a separate
fake snapshot. Schema/default/live-start gates remain unchanged.

The `refresh_pending` step survives the draft and Typefully sagas and is visible
beside the returned saved text. The disposable per-instance overlay stores the
DB version observed before the Sheet save. It clears on its own copied Sheet
fingerprint, or when the DB fingerprint matches a fresh authority read (including
a newer Sheet edit imported later). A version advance alone is insufficient:
an overlapping import can contain an older snapshot. Metadata-only imports can
repair the fingerprint without advancing the version. Only pending rows can add
this bounded authority read during ordinary get/list verification.
Explicit reconciliation re-reads the Sheet collections and reconstructs lag
items even after restart; unreadable sources mean unknown. It never installs
an overlay or invents a save operation for ordinary import lag. Its live quota
and latency cost must be measured at the
Phase C exit, not inferred from synthetic tests. Cross-instance stale displays
remain possible until repair, with Sheet preconditions protecting every save.

DB-3's carried editor wording item is addressed: save/conflict messages and
hook/mismatch controls use the selected write authority. `db-read` correctly
continues to say Sheet; `db` says database. Existing JSON `sheet` revision/draft
field names are retained for client compatibility, without implying authority.
DB-3's integer, timestamp and aggregate-size differences remain explicit copy
failures, never reasons to veto or coerce a Sheet write. In db-read, a refused
integer or oversized row is omitted from the import's accepted rows/counts and
recorded once as `refused_numeric` (column field) or `refused_size` (`@row`) in
the private exception ledger. Other rows still import atomically. Reconcile
shows a blocking row-specific refusal requiring source/limit correction; another
import alone is not promised to repair it. Unknown differences, integrity and
CAS failures still abort the batch; db-shadow retains its fail-closed behavior.
Both unapplied RPC definitions accept these named classes; no live SQL was run.
JSONB separator overhead is included in the preflight byte cap. The
fake Schedule seed now fingerprints formula-aware raw rows exactly as the Sheet
reader does; the previous fixture token mismatch would have made every initial
DB-served Schedule save stale.

See [the Phase C runbook](../ops/runbook.md#phase-c-content-read-cutover-db-5--mig-11)
for rollback, copied-workbook/Supabase-branch rehearsal, exact-SHA T4 smoke and
seven-day measurements. No live database, production flag, deployment, hosted
security proof, T3/T4 rehearsal or Phase C exit is claimed by this local change.

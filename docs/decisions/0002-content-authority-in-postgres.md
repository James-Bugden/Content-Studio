# ADR-0002: Phased Content authority in Postgres

- Status: Accepted; schema preparation only, no production phase flipped
- Date: 2026-10-24
- Related: CS-055 / [DB-1 #145](https://github.com/James-Bugden/Content-Studio/issues/145), design merged in #131
- Supersedes: ADR-0001's scope limit on a future Content write authority; preserves its shared-project isolation and explicit migration requirements

## Decision

Accept the phased design in [database-migration.md](../implementation/database-migration.md), especially sections 1.1–1.7 and Phase A. The owner decision of 2026-10-24 authorizes preparing Postgres as Content's eventual operational authority. It does not flip a runtime flag or waive a phase gate. Google Sheets remains authoritative until the corresponding production phase is evidenced and flipped. Typefully remains the publisher, Drive the asset store, and the existing ContentRepository the application boundary. The separate decision about canonical Drive Markdown bodies remains gated by design section 3.

Use additive `public.content_studio_*` objects in the shared Supabase project. Apply only the explicitly reviewed migration when deployment is separately performed; never run a repository-wide `db push`. DB-1 produces SQL and PGlite evidence only and does not apply anything to a live database.

All new tables enable and force RLS with zero policies. Tables, sequences, views and invoker functions revoke PUBLIC, anon and authenticated access and grant only service_role access. Views use security_invoker and every function pins its search_path. Auth.js owner authorization stays at the future server adapter boundary; this decision does not introduce Supabase Auth for Content or authorize browser access. Replies objects and policies remain untouched.

## DB-1 SQL contract

`20261024000100_content_authority.sql` defines the seven tables and two derived views in design section 1.1. It also defines `content_studio_import_runs` as the durable home of the Phase A counts, hashes and named exception ledger. The existing jsonb Sheet staging objects remain unchanged. This additional prefixed table contains run evidence, never another copy of Content payloads.

The version singleton starts at 1. The server-only adapter contract constant and `assertContentSchemaVersion` agree with it; missing/malformed/different versions raise SCHEMA_DRIFT with kind `version`. Runtime schema reads and adapter wiring belong to the later adapter issues.

The four entry points are:

- `content_studio_apply_patch(operation_id, patch_hash, actor_hash, target_kind, target_id, expected_version, patch)`
- `content_studio_insert_queue_idea(operation_id, patch_hash, actor_hash, library_id, row)`
- `content_studio_write_through(operation_id, patch_hash, actor_hash, target_kind, target_id, expected_version, row)`
- `content_studio_import_run(operation_id, snapshot_hash, actor_hash, counts, hashes, exceptions, rows)`

Kinds are `library`, `queue`, `schedule`, `workflow_settings`. Identifiers are stable Sheet identifiers; posts' kind selects the collection. JSON object keys are SQL snake_case column names. Hashes are lowercase SHA-256 hex computed by the trusted server caller over its canonical envelope; actor_hash contains no raw identity. That caller must bind the exact patch, target and operation type to the supplied hash. Caller authentication and business/domain validation still apply; the SQL layer also rejects unknown/protected fields, enforces normal writable allowlists, text size caps, typed constraints and version preconditions.

The SQL result contains only `{ok, code, steps, revision}`. `steps[0].state` is `applied`, `already_applied`, `stale`, `not_found` or `conflict`. `revision` is the current bigint row_version, not the domain's 16-hex revision: the future adapter converts that version via `fingerprintValues(['db', table, id, row_version])`. Stale results report the current version without returning copy. Stored results replay exactly; operation reuse with a different hash/target/actor returns CONFLICT and preserves the original ledger row.

A namespaced transaction advisory lock serializes the small owner-only corpus, including simultaneous first deliveries and imports. Indexed primary-key row locks and compare-and-set updates enforce expected_version. Updates save full before-images, changed field names and SHA-256 before/after hashes; inserts save null before-images. Audit and operation results contain no copy. Any error in history, audit, ledger or deferred lineage validation rolls back all row changes. No-op patches do not bump versions or add history. A content-changing import/copy bumps the version; an identical content copy changing only Sheet fingerprint/row position preserves it, with metadata changes still recorded in history.

Write-through/import expected_version asserts the version observed before the Sheet read; null asserts row absence. A content-identical copy is already_applied regardless of that precondition. A stale changed row is refused, never overwritten. Import rows are `{target_kind, target_id, expected_version, row}`; counts and SHA-256 hashes cover exactly the four typed collections. Duplicate stable targets and unknown exception classes are rejected. Exception entries contain only `{class, collection, field, hash}`, with classes `formula_display`, `number_formatting`, `trailing_whitespace`. Imports atomically upsert, support child-before-parent schedule lineage and use one enclosing operation ledger entry. Full-row construction, snapshot hashes, parity classification, scheduling and handling rows absent from a snapshot belong to DB-4; this RPC does not delete absent rows or declare parity passed.

The shared `content_studio_mutate` implementation is also service-role-only. Its internal import mode participates in the enclosing import transaction and ledger rather than deriving child operation IDs that could collide with other operations. Service role is already trusted with direct table DML; this helper is not a new user authorization boundary.

## Consequences and gates

DB-1 introduces no runtime reads/writes, data import, export, store-mode changes or live deployment. Phase A remains incomplete until the reviewed migration is explicitly applied and three full imports prove exact stable-ID sets, counts and allowed field parity. PGlite cannot evidence the hosted Security Advisor or PostgREST configuration. Hosted MIG-04 denial checks and the advisor remain mandatory before claiming live security acceptance.

Phases B–E retain all parity thresholds, owner gates, backup/history exports, rollback rehearsals and production smoke requirements in the accepted design. There is one authority in each mode. The Phase C Sheet-read-back copy is derived and repairable; Phase D Sheet export is one-way and precondition-checked. No bidirectional authority is introduced. No Reply table is joined into Content authority.

# Database migration design: Sheet authority to Postgres

Status: design for approval, 2026-10-24. Supersedes the scope limit in
ADR-0001 (`docs/decisions/0001-defer-supabase-migration.md`) once DB-1 lands;
until then nothing in production changes.

## 0. Why now, and what changes

ADR-0001 required "measured need" before replacing Sheet writes. The trigger
for this design is an owner decision, not quota evidence:

- On 2026-10-24 James decided that Content Studio is the only editing surface,
  that nobody edits the workbook by hand, and that the operational source of
  truth should move to a database regardless of further measurement. Every
  Sheet-specific safeguard that exists to tolerate hand edits (header drift,
  formula cells, external row edits) now protects against something that no
  longer happens, while carrying a documented lost-update window
  (`docs/implementation/atomicity.md`).
- Sheet read pressure is a supporting concern, not the justification. Issue
  #88 (CS-041, still open) records three timed Backlog reloads of roughly
  2,000 Library rows and one rate-limit screen, says not to infer a root cause
  from that sample, and notes that runtime logs were unavailable. It also says
  a read mirror must never dual-write Content; the bounded exception to that
  rule in Phase C exists only through the owner approval of this design and
  the carve-out recorded in MASTER-SPEC section 11 (section 4).
- The master Markdown in Drive currently returns `NOT_FOUND` in production
  (issue #81, CS-038), so the Drive half of the draft-save saga is broken.

What does **not** change: Typefully remains the publisher and is called only by
the app's own `TypefullyGateway`; Drive remains the asset store; the
`ContentRepository` port, the mutation envelope, stable IDs, the gate engine
and every UI view model stay as they are. The database (Supabase Postgres,
already the Replies store and the Sheet read model) becomes the operational
source of truth for Content, in phases, each reversible until the last.

## 1. Target model

Postgres in the approved shared Supabase project; every object is prefixed
`content_studio_` and lives in `public`, as the read model already does. The
existing jsonb mirror tables (`content_studio_sheet_rows`, `_sync_runs`,
`_stage`) stay as the import staging area and are dropped in the last phase.

### 1.1 Tables

| Table | Maps from | Key | Notes |
| --- | --- | --- | --- |
| `content_studio_posts` | `Content Library` and `Content Queue` (same 33 columns) | `(collection, library_id)` with `collection in ('library','queue')` | One typed column per `LIBRARY_HEADERS` field. `library_id` is the Sheet `Library ID`, unchanged. |
| `content_studio_schedule` | `Content Schedule` (44 columns) | `content_id` | One typed column per `SCHEDULE_HEADERS` field; `parent_content_id` is a nullable self-reference for Threads lineage. |
| `content_studio_workflow_settings` | `Workflow Settings` | `setting` | `value`, `notes`; parsed by the existing `parseWorkflowSettings` over a rows array. |
| `content_studio_operations` | the in-memory `ops` map in `SheetsContentRepository` | `operation_id` | Durable idempotency ledger (section 1.4). |
| `content_studio_row_history` | Sheet version history | `history_id bigserial` | Full before-image jsonb of every changed row (section 1.5). |
| `content_studio_audit_events` | redacted telemetry | `event_id bigserial` | Hashes and field names only, exportable; no copy bodies. |
| `content_studio_schema_version` | header discovery | singleton | `version integer`, `applied_at`; the adapter refuses to start when it does not match the compiled expectation. |

Derived Sheet tabs become SQL views, never tables:

- `content_studio_ready_queue` = `posts where collection='library' and review_status='Approved' and queue_for_schedule`; the gate engine still re-checks every gate (READY-02 unchanged).
- `content_studio_queue_summary` = counts per `content_source` plus the master link, replacing the read-only summary tab.

### 1.2 Column conventions

- Text fields are `text not null default ''` so the adapter can produce the same
  `cells: Record<Field, string>` the domain already consumes. Booleans
  (`queue_for_schedule`, `posted`) are `boolean`, numbers (`hook_score`,
  `content_angle`, the six metric columns) are `integer` nullable. Enum-valued
  columns stay `text`: the domain's `UNRECOGNISED_VALUE` blocker remains the
  single place that judges vocabulary, so a value the UI cannot handle is still
  visible rather than rejected at import.
- Columns that are formula display values today (`Has Image`, `Next Action`,
  `Image Next Action`) become ordinary writable text columns. The approval,
  visual and zh-TW stamps (`[cs:approved:<hash>]` and friends) keep living in
  those text columns in this migration so no domain code changes; typing them
  into their own columns is a follow-on, not a cutover prerequisite.
- Hyperlinks that today hide in `HYPERLINK()` formulas get real columns:
  `source_markdown_url`, `source_master_file_url`, `source_link_url`,
  `image_file_url`. The adapter fills `record.links` from them.
- `passthrough jsonb not null default '{}'` on posts and schedule keeps every
  unknown Sheet column from the final import, so MAP-02 (unknown columns
  survive round trips) still holds and the one-way export can write them back.
- Every row carries `row_version bigint not null default 1`, `created_at`,
  `updated_at`, `created_by_op`, `updated_by_op` (operation ids),
  `source_sheet_row integer` (the last known Sheet row, used only by the import
  parity report and the export), `sheet_revision text` (the full-row Sheet
  fingerprint, exactly `record.revision` as the Sheet repository computed it
  when the row was last imported or written through) and
  `exported_sheet_revision text` (the Sheet fingerprint observed by the last
  successful export, phase D).

### 1.3 Revision and optimistic concurrency

The domain's `revisionSchema` is a 16-hex string. Which fingerprint the
repository exposes as `record.revision` depends on who holds write authority
in the active store mode (section 4), so that `expectedRevision` is always
compared by the authority that will perform the write:

| Mode | `record.revision` served | Compared by | Mechanism |
| --- | --- | --- | --- |
| `sheet`, `db-shadow` | Sheet full-row fingerprint (`rowRevision`, today's behaviour) | Sheet repository, fresh re-read | unchanged |
| `db-read` | `sheet_revision` stored in the DB (the Sheet fingerprint imported or written through) | Sheet repository, fresh re-read | the token is a Sheet revision, so `current.revision !== m.expectedRevision` behaves exactly as today |
| `db` | `fingerprintValues(['db', table, id, row_version])` | `apply_patch` compare-and-set | `update ... where id = $1 and row_version = $2` |

In `db` mode zero rows updated means the adapter re-reads the row and either
reports `skipped_already_applied` (the patch is already present, a lost
response) or `STALE_READ` with the current revision. This closes the
one-round-trip lost update window that the Sheet could not. `row_version` is
bumped only by `apply_patch`, never by an import or write-through whose
content is identical (`is distinct from` guard), so an import cannot
invalidate an open editor.

In `db-read` mode the DB's `sheet_revision` can lag the Sheet only between a
Sheet write and the next write-through or import. A save made from such a
stale row is refused by the Sheet repository as `STALE_READ`, exactly as a
concurrent edit is today, and the editor shows the comparison; the Phase C
exit metric counts those refusals, attributed by `sheet_revision` age at the
time of the request.

### 1.4 Idempotency and the operation ledger

`content_studio_operations(operation_id text primary key, patch_hash text,
target_kind text, target_id text, actor_hash text, result jsonb, created_at)`.
Semantics are exactly today's in-memory map, made durable and shared across
server instances: same operation id + same patch hash replays the stored
result; same id + different hash is `CONFLICT (operation_reused_with_different_patch)`.
`result` holds only `ok`, `code`, `steps` and the revision, never copy.

All of ledger check, compare-and-set, history insert, audit insert and ledger
insert run inside one SQL function, `content_studio_apply_patch(...)`, so a
Content write is finally atomic. Cross-provider operations (Drive, Typefully)
remain sagas with the same step vocabulary; the DB step simply stops being a
place where partial failure can originate.

### 1.5 Audit trail and history

- `content_studio_row_history`: before-image jsonb of the full row, with
  `operation_id`, `row_version_before`, `changed_fields text[]` and `at`.
  Written by `apply_patch` and by the import. This replaces Sheet version
  history as the restore path for a single row; a restore is itself a normal
  patch with a new operation id, so it is audited too.
- `content_studio_audit_events`: `operation_id`, `actor_hash`, `target_kind`,
  `target_id`, `changed_fields`, `before_hash`, `after_hash`, `outcome`,
  `at`. Redacted by construction, so it can be exported to the public QA
  evidence after a check for IDs.
- Retention: keep everything; the corpus is a few thousand rows and the history
  grows by one row per write. Review at 1 GB, not before.

### 1.6 Access control: server-only service role, not per-user RLS

Chosen: every `content_studio_*` table has RLS enabled and forced with **zero**
policies, all privileges revoked from `anon` and `authenticated`, and grants to
`service_role` only; every writer is a `security invoker` SQL function executable
by `service_role` alone. This is the pattern MIG-04 verified live for the three
read-model tables and RPCs on 2026-09-25; every new table, view and function
needs its own denial proof (DB-1 acceptance), not inheritance of that result.

Why not owner RLS like the Replies tables: Content Studio authenticates the
owner with Auth.js Google OIDC, not Supabase Auth, so `auth.uid()` is null on
every Content request and an RLS policy would have nothing to bind to. The
Replies RPC that resolves the single enabled owner from `private.app_owner`
exists precisely because of that. The server already enforces owner-only on
every route (`requireMutation`), the service key never reaches the browser or
preview, and there is one user. Per-user RLS would add a second identity system
without adding a check that fires. If a second identity ever appears, add
`owner_id uuid not null references private.app_owner` first, then policies;
the tables are shaped so that is an additive migration.

### 1.7 Typefully fields

Schedule gains typed columns for what today is packed into cells:
`typefully_draft_id text`, `typefully_status text`, `final_content text`,
`final_synced_at timestamptz`, `final_synced_hash text` (the short hash that is
currently inside the `<ISO> #<hash>` stamp), `published_at timestamptz`,
`post_link text`, the six metric integers and `analytics_synced_at`. The
adapter renders `cells.finalSyncedAt` as the existing stamp string from the
two columns, so `parseSyncStamp`, `compareCopy` and every TYPE-/PUB- test keep
passing unchanged (section 5).

## 2. Implementing the ports against the database

### 2.1 Shape

`SupabaseContentRepository implements ContentRepository` sits where
`SheetsContentRepository` sits today and is chosen in `container.ts` by a new
server variable `CS_CONTENT_STORE = sheet | db-shadow | db-read | db`
(section 4). Underneath it is a small `ContentDb` port (typed select by key,
list by collection, `applyPatch`, `insertRow`, `exportRows`) with two
implementations: `SupabaseContentDb` (PostgREST + the RPCs, service key, same
URL allowlist and timeout handling as `SupabaseSheetMirrorStore`) and
`FakeContentDb` (in-memory, seeded from `src/fixtures/synthetic.ts`). The
repository logic (validation, ledger semantics, record construction) is shared,
so the fake exercises the real adapter code, not a parallel implementation.

### 2.2 Method by method

| Port method | Database implementation |
| --- | --- |
| `capability()` | `{ provider: 'db', state: 'ready' or 'read_only' }`; `Capability.provider` gains `'db'` and the health route lists it. |
| `schema()` | Compares `content_studio_schema_version` with the compiled constant; a mismatch is `SCHEMA_DRIFT` with `kind: 'version'`, reusing the existing blocking reconcile item and alert. |
| `listLibrary`, `listQueue` | `select * from posts where collection = $1 order by source_sheet_row nulls last, library_id`; one request, no paging quirks. |
| `getLibrary`, `getQueue`, `getSchedule` | Select by primary key; `NOT_FOUND` on zero rows. Duplicate ids are impossible, so the `duplicate_id` conflict path only remains in the import. |
| `listReadyQueue` | Select from the `content_studio_ready_queue` view. |
| `listSchedule` | `select * from schedule order by date, platform, slot`. |
| `queueSummary` | Select from the summary view. |
| `workflowSettings` | Select settings, feed `parseWorkflowSettings` the same `Setting / Value / Notes` rows array. |
| `updateLibrary`, `updateQueue`, `updateSchedule` | Validate exactly as today (actor, operation id, writable allowlist, 50,000-char cap), then one `apply_patch` RPC; map its outcome to the existing `MutationResult` steps, provider `'db'`. |
| `createQueueIdea` | One `content_studio_insert_queue_idea` RPC: ledger check, uniqueness on `(collection, library_id)`, insert, history, audit. Same expected-field set as today. |

`StepResult.provider` gains `'db'`; while the Sheet export runs (phase D) the
export step reports provider `'sheet'`, so the reconcile centre can tell them
apart.

### 2.3 Safeguards that become unnecessary

| Today | After | Why |
| --- | --- | --- |
| Header discovery by name, `SCHEMA_DRIFT` on rename | Schema version check | Columns are typed and migrated; nobody renames them by hand. |
| `formulaFields`, `formula_cell` refusal | Removed | No formulas; those columns are plain text. |
| `HYPERLINK()` parsing for links | Real URL columns | |
| Re-read, compare, write, read-back (4 round trips, residual race) | One compare-and-set RPC | Atomic; the lost-update window is gone. |
| In-memory op cache (500 entries, per instance) | Operations table | Replay is correct across instances and restarts. |
| Row paging, `Unable to parse range` boundary detection, `MAX_TAB_ROWS` | Removed | |
| 60-second Library read cache, in-flight dedupe (CS-045/046/047 pressure) | Removed or shrunk to a few seconds | Reads are cheap and not quota-limited. |
| `RATE_LIMITED` retry screen for reads | Stays as a code, should never fire | Keep the UI path; delete the Sheets-specific copy. |

### 2.4 Safeguards that must remain

- `STALE_READ` on expected-revision mismatch, with `skipped_already_applied`
  when the row already holds the patch. The UI's compare dialog is unchanged.
- Same-operation replay and different-patch conflict (now durable).
- Saga steps and `PARTIAL_FAILURE` for Drive-then-DB (draft save, while Drive
  is written) and Typefully-then-DB (create, push); retries reuse the
  operation id and only complete the missing step.
- Writable-field allowlists (`LIBRARY_WRITABLE`, `SCHEDULE_SYNC_FIELDS`),
  owner-only actor check, value size caps, `VALIDATION_FAILED` reasons.
- Never writing the derived Ready Queue (it is a view, so this is structural).
- Redaction: no copy bodies, ids or URLs in telemetry; `targetHash` stays.

## 3. Drive Markdown bodies: database body authority selected

DB-7 decision (2026-10-25): the owner delegated the choice to the coordinator,
who selected option (b), the recommendation below. Implementation is gated to
`db` with fake/PGlite evidence only; this is not a production flip. See
[the DB-7 runbook](../ops/database-draft-authority.md). The other three modes
retain Drive authority and the existing saga. All phase/owner/live gates stand.

Today the draft body has two homes: the Library-ID section of a master Markdown
file in Drive (canonical) and `Draft Content` in the Sheet (mirror). Every save
is a two-provider saga, and in production the Drive half returns `NOT_FOUND`
(#81), so saves are blocked.

**Recommendation: make the database the authority for the draft body and turn
the Drive Markdown into a one-way export.** `draft_content` already holds the
exact section text; the saga's Drive step becomes an asynchronous export of the
section (same `safeReplaceSectionBody`, same section-only replacement) that
can fail without blocking the editor, surfaced in `/reconcile` as
`markdown_export_lag`. Drive keeps assets and reference files unchanged.

| | Keep Drive canonical | Database canonical, Drive exported (recommended) |
| --- | --- | --- |
| Draft save | Two providers, saga, `PARTIAL_FAILURE` paths stay | One atomic write; export is best-effort and retried |
| #81 | Must be fixed before saves work again | Saves work immediately; export waits for the fix |
| History | Drive revisions (file-level) plus DB history | DB row history (section-level, per operation) |
| Intake of new masters written outside the app | Unchanged | Needs an explicit "Import Markdown master" action (one-off, idempotent, previewed), which DB-7 provides |
| Lost-update window | Drive residual window remains | None for the body |
| What James reads in Drive | Live | Up to the export lag (target: minutes) |

The cost is that the Markdown in Drive is no longer the thing you edit. Since
nobody edits it by hand any more, that mirrors the Sheet decision; but it is
James's call because it changes where the canonical copy of his writing lives.
Either way the Sheet cutover (phases A–E) does not depend on it; DB-7 is
sequenced after the write cutover.

## 4. Phased cutover

Store modes are a single server variable, `CS_CONTENT_STORE`, set per Vercel
environment; preview stays `fake` data with either store. `SUPABASE_READ_MODEL_MODE`
is folded into it and removed in phase E.

| Mode | Reads | Writes | Authority | Sheet role |
| --- | --- | --- | --- | --- |
| `sheet` (today) | Sheet | Sheet | Sheet | authority |
| `db-shadow` | Sheet served; DB read in parallel on a sample (adds no Sheet reads) | Sheet | Sheet | authority |
| `db-read` | DB | Sheet first; the read-back record is then copied into the DB | Sheet | authority |
| `db` | DB | DB; one-way, precondition-checked export to Sheet | DB | export / comparison copy |
| `db` with export off | DB | DB | DB | retired; weekly backup export only |

Exactly one authority exists in every mode. The Phase C copy-into-DB is the one
place where two stores are written in a single request; it is not a second
authority because the DB copy is derived from the Sheet read-back, is never
compared against for a Sheet write, and is repaired by the import if it fails.
MASTER-SPEC section 11 carves out this bounded exception to the dual-write rule
for Phase C only, by owner approval of this document.

Numeric parity thresholds below are measured by the parity job (DB-4) and shown
on `/reconcile`; a phase cannot advance while any threshold is red, and a
skipped or inconclusive measurement is not green.

### Phase A: schema, import, typed read model (DB-1, DB-2, DB-4 import half)

- Entry: this design approved; schema migration applied explicitly to the
  shared project (never `db push` of the whole repo).
- Work: migration, typed import from the Sheet (reusing `buildSheetMirrorSnapshot`
  as the exact source of truth for a run, then a typed `import_run` RPC that
  upserts and records counts, hashes and the exception ledger), scheduled every
  15 minutes via the existing cron route with `CRON_SECRET`. The schedule is
  owner configuration (a `crons` entry in the Vercel project, see
  `docs/ops/deploy.md`); without it the import runs only when triggered from
  `/reconcile`.
- Exit: three consecutive full imports with identical stable-ID sets to the
  Sheet, per-collection count equality, and every field equal except entries
  recorded in the exception ledger (allowed classes: formula display values,
  Sheet number formatting (including leading zeros/spaces), trailing whitespace,
  blank booleans, boolean aliases, timestamp formatting; ADR-0002 NOTES). No unclassified
  mismatch.
- Rollback: set `CS_CONTENT_STORE=sheet` (already the value); truncate the
  tables. Nothing in the app depends on them yet.

### Phase B: parity reports and shadow reads (DB-4)

- Entry: Phase A exit.
- Work: `db-shadow` reads the DB on roughly 10 percent of list requests and on
  every `/reconcile` load, compares records field by field after the adapter
  (so links, revision-independent cells and view models are compared, not raw
  rows), and emits one content-free aggregate event per collection observation.
  Blank checkboxes and FALSE are explicitly named semantic equivalents; all
  other classified text differences still count against field equality.
  The Sheet is read exactly as today; the sample bounds the extra DB reads and
  comparison cost, not Sheet quota.
- Exit: over 7 consecutive days or at least 200 compared requests, whichever is
  longer: stable-ID set equality 100 percent; field equality at least 99.9
  percent per collection with zero unclassified mismatches; import lag p95 at
  or under 15 minutes; zero import failures left unrepaired for more than one
  hour. UI behaviour under the DB adapter is proven adapter-identical by the
  shared contract suite and the e2e suite in both store modes (section 6).
- Rollback: `CS_CONTENT_STORE=sheet`. Instant; no data moves.

### Phase C: flip reads (DB-5)

- Entry: Phase B exit, T4 smoke of the `db-read` build on preview with fake
  data, runbook updated.
- Work: reads come from the DB and carry the stored `sheet_revision` as
  `record.revision` (section 1.3), so the Sheet repository's fresh re-read and
  compare is unchanged. The Sheet write goes first and is the only authoritative
  write; on success the repository takes the read-back record (which it
  already fetches, including its new Sheet fingerprint) and copies it into the
  DB in the same request (`write_through` RPC, idempotent by operation id,
  content-identical guard). If that copy fails the mutation still succeeds,
  the row is marked `refresh_pending`, the UI shows the returned record, and
  the next scheduled import repairs representable values. A refused integer or
  oversized row remains a blocking pending item until its value or copy limit is
  corrected; db-read imports count/classify it in the exception ledger and keep
  importing other rows. Unknown differences and CAS conflicts still fail closed.
  An overlay retires when its fingerprint is copied or the DB matches the
  current Sheet fingerprint, even after a newer edit. Pending reads avoid
  repeated full-tab authority checks for unchanged DB/import tokens:
  each saved overlay remembers its successfully checked `(row_version,
  sheet_revision, latest completed import operation ID)` tuple; any token
  changing rechecks, including unchanged-row imports after a hand revert.
  Concurrent checks share one promise. Rate-limited checks retry after 60
  seconds; other failed reads retry on the next request.
  Ordinary import lag never
  installs an app-save overlay. The 60-second Library cache is reduced to the
  shared `DB_READ_CACHE_TTL_MS` (3 seconds) in both compositions.
- Exit: 7 days; zero Sheets `RATE_LIMITED` events on reads; zero `STALE_READ`
  refusals whose `sheet_revision` was older than the last completed import at
  request time (that is, none caused by lag rather than by a genuine
  concurrent edit); Backlog p95 server time under 1 s warm and under 2.5 s
  cold.
- Rollback: `CS_CONTENT_STORE=sheet`. The Sheet is still the authority, so no
  data is lost; the DB is simply ignored until re-enabled.

### Phase D: flip writes, Sheet becomes a one-way export (DB-6)

- Entry: Phase C exit; James confirms in writing that nobody edits the workbook
  by hand (the freeze); Supabase daily backups confirmed on; the scheduled
  history export (below) has run at least once; a final import after the
  freeze shows exact parity.
- Work: `db` mode. Writes go to `apply_patch`. An exporter writes changed rows
  to the Sheet by stable ID (same cells-by-header code the repository uses
  today, with `RAW` values, formulas untouched), triggered after each
  mutation and repaired every 15 minutes. New Queue ideas are appended. The
  Sheet is never read for authority again; `GOOGLE_WRITE_ENABLED` now gates the
  export only.
- Export precondition (never silently overwrite a newer Sheet row): before
  writing, the exporter re-reads the target row and compares its current Sheet
  fingerprint with the row's `exported_sheet_revision`. Equal means the Sheet
  holds exactly what we last exported, so the write proceeds and the new
  fingerprint is stored. Different means someone or something changed the
  Sheet since the last export: the exporter writes nothing for that row, keeps
  the Sheet value, and raises a blocking `export_mismatch` reconcile item that
  shows the row id and the field names that differ. Resolution is explicit:
  "Export DB value" (the DB is the authority, so this is the normal choice)
  or "Copy Sheet value into DB" as a new audited patch; both record the
  decision. The precondition carries the same one-round-trip residual window
  the Sheet always had, which is acceptable because the Sheet is no longer an
  authority.
- Comparison period: 14 days **and** at least 50 mutations, whichever ends
  later. Daily `export_parity` report: every DB row present in the Sheet, every
  exported field equal after export lag, lag p95 at or under 15 minutes, zero
  export failures older than one hour.
- Rollback (the Sheet regains authority): set the app read-only for a minute
  (`CS_CONTENT_STORE=db` with writes disabled), run a final export, verify the
  parity report is exact, set `CS_CONTENT_STORE=sheet`. Rehearsed on the copied
  workbook in T3 before Phase D starts (MIG-05).

### Phase E: retire the Sheet adapter (DB-8)

- Entry: comparison period complete with every report exact; James agrees the
  Sheet is no longer needed as a live copy.
- Work: stop the continuous export; keep a **weekly** export to a dated tab or
  CSV in a private Drive folder as a human-readable backup (not an authority);
  remove `SheetsContentRepository`, `GoogleSheetTransport` and the jsonb
  mirror tables from the live container and the migrations; keep the fake Sheet
  only as long as any test still needs it, then delete. Update MASTER-SPEC
  sections 2, 5, 7 and 11, AGENTS.md "Sources of truth", the runbook and the
  acceptance matrix.
- Rollback: code is in git, but data divergence begins here, so this phase is
  the one that is not reversible by a flag. Entry criteria are therefore the
  strictest.

### Backups and history export (all phases from D)

- Supabase daily backups are the minimum; point-in-time recovery is the
  recommended add-on (owner billing decision, section 8).
- A scheduled export (cron, daily 03:00 Taipei) writes `posts`, `schedule`,
  `workflow_settings`, `row_history`, `operations` and `audit_events` as
  gzipped JSON lines to a private Drive folder through the existing Drive
  gateway (new file every time, never an overwrite), with a manifest holding
  row counts and SHA-256 per file. Retention: 30 daily, then the first of each
  month for 12 months. The export is verified by re-reading the manifest and
  recomputing one hash; the result appears on `/reconcile` as `backup_fresh`.
- A restore drill (import the export into a Supabase branch and run the parity
  report against production) is part of DB-6 acceptance.

### How `/reconcile` changes

| Item | Change |
| --- | --- |
| `schema_drift` | Fires on schema version mismatch; action `Configure` (deploy the matching build) instead of `Fix in the Sheet`. |
| `partial_mutation` | Read from `content_studio_operations` (durable, cross-instance) instead of `recentEvents`; still offers `Retry` with the same operation id. |
| `markdown_mismatch`, `markdown_missing` | Unchanged while Drive is canonical; become `markdown_export_lag` if the section 3 recommendation is accepted. |
| new `import_lag` (phases A–C), `export_lag` (phase D) | Attention at 15 minutes, blocking at 60 minutes. |
| new `export_mismatch` (phase D) | Blocking on the first occurrence: the exporter found a Sheet row that differs from the last export and skipped it (Phase D precondition). Actions `Export DB value` or `Copy Sheet value into DB`. |
| new `backup_fresh` | Attention when the last verified backup is older than 36 hours. |
| new `store_mode` fact | The report header states the active `CS_CONTENT_STORE`, so screenshots and T4 evidence always show which authority was in force. |

## 5. Typefully after the move

Nothing in `src/application/typefully.ts` changes its logic; only the row store
underneath `repo.updateSchedule` does.

- **Push / create / link**: `createIdempotencyKey(operationId, contentId)` still
  goes into the draft's `scratchpad_text`; the lookup-before-create and
  candidate search are unchanged. The `link Schedule row` step becomes a DB
  patch with provider `'db'`, so a Typefully-succeeded / DB-failed outcome is
  still `PARTIAL_FAILURE` carrying the draft id, and a retry of the same
  operation finds the marker and links (TYPE-02 unchanged). The DB ledger makes
  the "two instances, same operation" residual window smaller: the second
  instance's `apply_patch` sees the first's ledger row.
- **Pull final copy / publication / analytics**: `SCHEDULE_SYNC_FIELDS` is the
  same allowlist; the adapter writes `final_content`, `final_synced_at`,
  `final_synced_hash`, status, `published_at`, `post_link` and metric columns.
  Unavailable metrics are still absent from the patch, so a recorded value is
  never erased (PUB-02).
- **Conflict hash**: `finalTextHash` and the stamp semantics are preserved by
  rendering the stamp from the two columns. `compareCopy` therefore still
  detects a DB-side `Final Content` edit and a Typefully edit independently
  (TYPE-05). The Typefully `updated_at` precondition on `PATCH` is unchanged.
- **Reconciliation scan**: reads the Schedule from the DB; the 7-day Ready-row
  scan no longer costs Sheet quota, so it can run on every `/reconcile` load.

## 6. Test strategy

DB-4 review round 1: repository Playwright config builds one synthetic artifact
and starts separate Sheet (3200) and db-shadow (3201) servers. Existing journeys
stay on Sheet; `content-parity.spec.ts` runs in shadow-w375/shadow-w1280 projects,
with a Sheet inactive-state check in w375/w1280. All projects participate in the
same four CI shards and the existing aggregate requires every shard. This is
Phase A/B evidence only; MIG-14's full db-mode mutation journeys still belong to
the later write-adapter/cutover work. Instance-scoped parity never authorizes a
read flip. Review-round representation classes and hash privacy limits are in
ADR-0002 NOTES.


- **T0**: (1) the migration and every RPC run under PGlite (already a dev
  dependency for Replies tests): schema version, compare-and-set, ledger
  replay/conflict, history and audit rows, view definitions, and access
  denial for `anon`/`authenticated` on every `content_studio_*` object (MIG-04
  pattern). (2) An adapter contract suite, one `describe.each` over
  `SheetsContentRepository(FakeSheetTransport)` and
  `SupabaseContentRepository(FakeContentDb)`, both seeded from the same
  `src/fixtures/synthetic.ts`, asserting identical records, identical
  `MutationResult` shapes for replay, conflict, stale read, not found,
  forbidden and validation. (3) Import, parity and export over the fakes:
  exact counts and hashes, exception-ledger classification, export round trip
  byte-equal. (4) Saga tests for draft save and Typefully create with a failing
  DB step.
- **T1**: the Playwright suite runs twice in CI, `CS_CONTENT_STORE=sheet` and
  `CS_CONTENT_STORE=db`, both with `CS_DATA_MODE=fake`; the fake DB adapter
  needs no credentials. `/api/test-control` gains `db_fail_next` and
  `db_external_edit` so the existing stale-read and partial-failure journeys
  run against the DB fake too.
- **T2**: agentic browser review of the new `/reconcile` items, the store-mode
  fact, and the refresh-pending state, at 375/1280 px.
- **T3**: copied synthetic workbook plus a Supabase branch (`create_branch`,
  never the production database): full import, shadow parity, read flip,
  write flip, export, rollback and the restore drill, each with recorded
  counts and hashes. This is where MIG-05 is finally evidenced.
- **T4**: owner-only smoke on the exact deployed commit after each flip:
  health shows `db` capability and store mode; one synthetic-content read and
  one mutation with a visible audit row; rollback flag exercised once on
  preview.
- No secrets, IDs, copy or screenshots of real content enter the repository;
  the service key lives in the Vercel Production target only; preview never
  receives it.

New acceptance IDs (group `MIG`, continuing the existing numbering): MIG-06
schema version gate; MIG-07 atomic compare-and-set and durable ledger; MIG-08
row history and audit redaction; MIG-09 typed import parity and exception
ledger; MIG-10 shadow parity thresholds; MIG-11 read cutover rollback; MIG-12
one-way export parity and rollback to Sheet; MIG-13 backup export and restore
drill; MIG-14 adapter-identical e2e in both store modes; MIG-15 Sheet adapter
retirement with docs updated.

## 7. Work breakdown (ready-to-file issue bodies)

Dependency order: DB-1 -> DB-2 -> DB-3 -> DB-4 -> DB-5 -> DB-6 -> DB-7 and
DB-8. DB-7 waits for James's section 3 decision and can run alongside DB-6.

### DB-1 — Content schema, RPCs and PGlite tests (heavy: schema, access control and RPCs)

**Outcome.** The `content_studio_*` typed schema from section 1 exists as one
reviewed migration, applied explicitly to the shared project, with every
object server-only.

**In scope.** Migration file under `supabase/migrations/`; tables, views,
`content_studio_apply_patch`, `content_studio_insert_queue_idea`,
`content_studio_import_run`, `content_studio_write_through`, schema version
singleton; RLS forced with zero policies, revokes and `service_role` grants;
ADR-0002 recording this design as the accepted replacement for ADR-0001's
scope limit.

**Files/areas.** `supabase/migrations/2026…_content_authority.sql`,
`docs/decisions/0002-content-authority-in-postgres.md`, `tests/unit/supabase/content-schema.test.ts` (PGlite).

**Acceptance.** MIG-06: adapter-side version constant and DB singleton agree;
mismatch is `SCHEMA_DRIFT`. MIG-07: under PGlite, `apply_patch` replays on
same id + same hash, conflicts on same id + different hash, returns
`stale` with the current version on a version mismatch, `already_applied`
when the patch is present, and writes history, audit and ledger rows in one
transaction (a forced failure after CAS leaves no partial rows). MIG-04
re-run: `anon` and `authenticated` cannot select, execute or see any new
object. Security advisor shows no new warnings.

**Non-goals.** Any runtime read or write from the app; data import; Drive.

**Regression areas.** Replies migrations share the project: the migration must
be additive and prefixed, and the Replies PGlite suite must stay green.

### DB-2 — `ContentDb` port, fake DB and database repository reads (standard)

**Outcome.** `SupabaseContentRepository` can serve every read in the
`ContentRepository` port, over either the live PostgREST client or an
in-memory fake seeded from the synthetic fixtures, and is proven
adapter-identical to the Sheet repository.

**In scope.** `src/application/content-db.ts` (port), `src/integrations/supabase/content-db.ts` (live),
`src/integrations/supabase/fake-content-db.ts`, `src/integrations/supabase/content-repository.ts` (reads, capability, schema),
`Capability.provider` gains `'db'`, health route lists it, container selects
by `CS_CONTENT_STORE` (reads only in this issue), contract suite.

**Acceptance.** MIG-14 (reads half): `tests/unit/application/content-repository-contract.test.ts` runs the same
assertions against both repositories and both produce identical `value`,
`cells`, `links` and ordering for the synthetic corpus; `revision` is a
16-hex string that changes when and only when the row changes. Health output
never includes the DB URL.

**Non-goals.** Writes; import; production enablement.

**Regression areas.** `container.ts` composition in fake mode; every page that
reads `listLibrary`, `listSchedule`, `listReadyQueue`.

### DB-3 — Database writes: compare-and-set, ledger, history (heavy)

**Outcome.** `updateLibrary`, `updateQueue`, `updateSchedule` and
`createQueueIdea` work against the database with today's exact
`MutationResult` semantics, and the draft-save and Typefully sagas pass with a
DB step.

**In scope.** Write methods in the DB repository mapping `apply_patch`
outcomes to steps (`provider: 'db'`), durable replay across two repository
instances, `StepResult.provider` union, fake DB fault injection
(`failNext`, `externalEdit`), `/api/test-control` additions, saga tests.

**Acceptance.** MIG-07 at the adapter level: replay, different-patch conflict,
`STALE_READ` with current revision, `skipped_already_applied`, `NOT_FOUND`,
`FORBIDDEN`, writable allowlist and size validation all match the Sheet
repository's results in the contract suite. MIG-08: every write produces one
history row with the before-image and one audit event with hashes and field
names only; an audit export contains no copy, URL or id longer than 12
characters. DRV-03/04 and TYPE-02/05 suites pass with the DB repository
substituted. Two repository instances sharing one fake DB agree on replay.

**Non-goals.** Export to Sheet; production mode; stamp typing.

**Regression areas.** Draft save, hook selection, approval transitions,
promotion, zh approval, Typefully create/link/push/sync — every mutation
route.

### DB-4 — Typed import, scheduled reconcile and parity reports (standard)

**Outcome.** The Sheet is imported into the typed tables on a schedule with
counts, hashes and an exception ledger; shadow reads report parity; both
appear on `/reconcile`.

**In scope.** `import_run` client over `buildSheetMirrorSnapshot` output, the
exception-ledger classifier (formula display, number formatting, trailing
whitespace), `CS_CONTENT_STORE=db-shadow` sampling at about 10 percent plus
every `/reconcile` load, parity facts in telemetry (collection, field, kind,
fingerprint only), new reconcile items `import_lag` and a parity summary,
cron route reuse with `CRON_SECRET`, runbook thresholds.

**Acceptance.** MIG-09: against the synthetic corpus the import is exact; a
fixture with a formula display value and a `1,234` number is classified, and
an unclassified difference is reported as blocking. MIG-10: the parity report
exposes stable-ID set equality, per-collection field equality percentage,
sample count, lag p95 and days-green, computed from recorded facts. Import
failures are retried on the next run and the row set is never partially
retired (reuse of the complete-snapshot rule).

**Non-goals.** Serving any read from the DB; writes.

**Regression areas.** Sheet quota: shadow mode must add zero Sheet reads (the
Sheet result is served as today; only DB reads are added); request latency on
sampled requests; existing mirror cron.

### DB-5 — Read cutover with write-through and rollback (heavy)

**Outcome.** Production serves Content reads from the database while the
Sheet remains the write authority; one flag returns to Sheet reads.

**In scope.** `CS_CONTENT_STORE=db-read` path in the container: DB reads
serving `sheet_revision` as `record.revision`; Sheet write first (sole
authority), then `write_through` copy of the read-back record and its Sheet
fingerprint in the same request, `refresh_pending` marker and UI state when
the copy fails, cache TTL reduction, runbook rollback steps, T3 rehearsal on
the copied workbook and a Supabase branch, T4 smoke on the exact commit,
Phase C exit measurements. This phase relies on the MASTER-SPEC section 11
carve-out: the Sheet remains the only authority and the DB copy is derived,
never compared against for a Sheet write.

**Acceptance.** MIG-11: with the flag flipped back, every e2e journey passes
unchanged and no data is lost (contract: the DB is ignored, not consulted).
A save from a DB-served record succeeds against the Sheet when nothing else
changed, and is `STALE_READ` when the Sheet row changed since the import, both
proven in the contract suite. Write-through failure yields a successful
mutation plus a `refresh_pending` reconcile item that disappears after the
next import. Phase C exit numbers recorded with environment and SHA; a
skipped measurement is not a pass.

**Non-goals.** DB writes; export; Drive.

**Regression areas.** Read-your-writes on every editor save; Backlog totals and
filters; schedule calendar; `/reconcile` Typefully scan.

### DB-6 — Write cutover, one-way Sheet export, backups, rollback rehearsal (heavy)

**Outcome.** The database is the operational source of truth; the Sheet is a
one-way export for the comparison period; backups and the restore drill exist.

**In scope.** `CS_CONTENT_STORE=db`; exporter (after-mutation plus 15-minute
repair) writing changed rows by stable ID and appending new Queue ideas;
`export_parity` daily report; `export_lag`, `export_mismatch`, `backup_fresh`
reconcile items; scheduled gzipped JSON-lines history export to a private
Drive folder with manifest and hash check; rollback-to-Sheet procedure and
T3 rehearsal; MASTER-SPEC and AGENTS.md "pending cutover" notes become
"cut over on <date>".

**Acceptance.** MIG-12: on the copied workbook the export reproduces every
exported field byte-equal, and the rehearsed rollback (read-only, final
export, exact parity, flag to `sheet`) is recorded with hashes. A hand edit
injected into the copied workbook between two exports is not overwritten: the
exporter skips the row, the Sheet value is preserved, and a blocking
`export_mismatch` item appears with the differing field names. MIG-13: a
backup export is produced, its manifest verified, and a restore into a
Supabase branch passes the parity report. MIG-05 is finally evidenced: no
period has two uncoordinated authorities (export is one-way, imports are off).
Comparison-period thresholds recorded daily.

**Non-goals.** Deleting the Sheet; removing Sheet code; Drive bodies.

**Regression areas.** Every mutation route; Typefully sync fields in the
export; the Replies "save as content idea" append (now a DB insert plus
export).

### DB-7 — Draft body authority: implement James's section 3 decision (heavy)

**Outcome.** Either (a) Drive stays canonical and #81 is fixed so the saga
works, or (b, recommended) the DB holds the draft body, the Drive section is
exported asynchronously, and an idempotent "Import Markdown master" action
exists for new masters written outside the app.

**In scope (b).** Draft save becomes one `apply_patch`; `markdown-source.ts`
reads the DB body; a `markdown_export` queue with `safeReplaceSectionBody`,
Drive revision precondition and `markdown_export_lag` reconcile item; the
import action with preview, section-by-Library-ID matching and conflict
refusal; editor copy updated. **In scope (a).** Diagnose and restore Drive
access (#81), keep the saga and this doc's section 3 table as the record.

**Acceptance (b).** DRV-01 byte-equal round trip holds for the export; a Drive
failure never blocks a save; the import refuses a section whose body differs
from the DB unless the user confirms a direction; T2 review of the editor
copy.

**Non-goals.** Assets (stay in Drive); reference and workflow files.

**Regression areas.** Editor load/save, English QA apply, hook selection
opening-line updates, zh-TW source hash, reconcile `markdown_*` items.

### DB-8 — Retire the Sheet adapter and update the durable docs (standard)

**Outcome.** After the comparison period, the continuous export stops, a
weekly backup export remains, Sheet code leaves the live container, and the
specs describe the new authority.

**In scope.** Remove `SheetsContentRepository`, `GoogleSheetTransport`,
`sheet-mirror*` and the jsonb mirror migration (as a new dropping migration);
remove `SUPABASE_READ_MODEL_*` variables; weekly export job; MASTER-SPEC
sections 2, 5, 7, 11 and 12, AGENTS.md "Sources of truth", runbook, deploy
doc, `.env.example`, acceptance matrix regeneration; delete the fake Sheet
once no test needs it.

**Acceptance.** MIG-15: `npm run verify` green; no reference to `SHEET_TABS`
outside the export; health lists `db`, `drive`, `typefully`, `ai` only;
documentation grep for "Sheet" shows only history, export and backup
contexts.

**Non-goals.** Deleting the workbook (James keeps it as an archive); changing
Typefully or Drive asset handling.

**Regression areas.** Container composition, health, env validation, CI
secret scan, e2e matrix (store mode `sheet` run is removed).

## 8. Risks and what needs the owner

| Risk | Mitigation |
| --- | --- |
| Shared Supabase project with Replies: a bad migration or paused project affects both | Additive, prefixed, explicitly applied migration; PGlite tests; Supabase branch for T3; project tier that does not auto-pause (owner). |
| Hidden hand edits to the Sheet after the freeze | The exporter's fingerprint precondition skips the row and raises a blocking `export_mismatch`; nothing is overwritten until the owner chooses a direction on `/reconcile`. The freeze is an assurance, not a control. |
| Import exception ledger hides a real difference | Only the named classes in ADR-0002 NOTES are allowed; anything else blocks. Classes are listed in the report. |
| Write-through gap in phase C shows a stale row for seconds | `refresh_pending` state; the mutation response already carries the new record. |
| Lost Drive revision history if section 3 (b) is accepted | DB row history per operation; weekly and daily exports; the decision is James's. |
| The service key leaks to preview | Production-target-only variables; preview runs the fake DB; `check:env` test asserts it. |
| Postgres down | Content Studio shows the existing `PROVIDER_UNAVAILABLE` screens; Typefully-scheduled posts still publish because Typefully is the publisher. |
| Cost | Small corpus; the only material cost is the backup/PITR tier. |

Owner-only items:

1. Approve this design and the section 3 recommendation (or choose "keep
   Drive canonical").
2. Confirm the Sheet freeze in writing before Phase D.
3. Supabase: confirm the shared project may host the Content authority,
   choose the plan tier (daily backups at minimum; PITR recommended) and accept
   the billing; the agent cannot create or pay for it.
4. Put the production `SUPABASE_*` service credential and `CRON_SECRET` into
   the Vercel Production target (values are never typed by an agent).
5. Enable the 15-minute cron in the Vercel project (the `crons` entry in
   `docs/ops/deploy.md`; the repository has no `vercel.json`, so this is
   project configuration and may need a plan that supports that frequency) and
   confirm one scheduled run.
6. Share the private backup Drive folder with the service account.

Everything else, including filing DB-1 to DB-8, implementation, tests,
reviews, T0–T3 and the per-phase T4 smoke, is routine engineering work under
the default autonomy in AGENTS.md.

### CS-059g pending latest-import index

Before live `db-read`, rehearse the new migration
`20261025000200_content_import_runs_at_index.sql` for latest-import ordering
(`at DESC, operation_id DESC`). This new file sorts after all existing
migrations; none of the existing migration files was changed. It is unapplied
in this work and has never been applied live. See the explicit owner/live gates
in [the operations runbook](../ops/runbook.md#explicit-ownerlive-gates-carried-from-183184-186).

### DB-9 Phase A live wiring preparation

Issue #197 authorises live `db-shadow` wiring only. The default stays `sheet`;
live `db-read` and `db` remain refused. Existing production
`SUPABASE_READ_MODEL_URL` / `SUPABASE_READ_MODEL_SERVICE_KEY` are reused in
Career, even with the legacy mirror mode off. Typed import coordination and
parity history are durable across instances; no production thresholds are
claimed from synthetic tests. The additive migration remains UNAPPLIED.
Follow [the exact apply order and first-import checklist](../ops/database-shadow-live.md)
for all unapplied migrations, hosted denial/advisor checks, cron configuration,
independent-backend concurrency rehearsal and flag rollback. Section 6's
fake/PGlite/browser evidence does not replace those live gates.

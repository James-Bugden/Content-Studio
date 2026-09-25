# ADR-0001: Use Supabase only as a Sheet-fed read model

- Status: Accepted for staged implementation; authority cutover deferred
- Date: 2026-09-25
- Related: CS-020 / issue #21, `docs/MASTER-SPEC.md` sections 2, 7 and 11

## Decision

Build Supabase as a one-way read model of Google Sheets. Google Sheets remains
Content Studio's only writable operational authority. Supabase does not sync
with Typefully or Drive, and browser code never writes the mirror directly.

The write path remains:

1. Content Studio validates and writes an exact patch to Google Sheets.
2. Typefully operations continue through the existing Typefully gateway and
   write their returned ID, status, final copy, publication facts and available
   analytics to the Schedule row in Sheets.
3. A resumable reconciler snapshots the resulting Sheet rows into Supabase.

Phase 1 is authorised now: schema, immutable snapshot/replay, reconciliation
and field-level parity on synthetic/copied data. Production reads do not switch
to Supabase until parity, security and rollback evidence pass. A later authority
cutover is a separate decision and is not authorised by this record.

## Why this topology

Supabase can make list, filter, calendar and reporting reads faster and gives a
clean path to relational lineage and history later. Keeping it Sheet-fed limits
the integration surface: Typefully and Drive already have safe application
gateways, while the Sheet holds every operational fact the UI needs.

There is not yet recorded production evidence of sustained Sheet latency,
quota exhaustion or workflow-blocking conflicts. For that reason this decision
does not justify replacing Sheet writes. It authorises a reversible read model
whose value and exactness can be measured without risking the live workflow.

The existing `ContentRepository` interface, stable content identifiers and
mutation envelopes remain the boundary. The Supabase reader must be
adapter-identical to the Google reader before any shadow or production read is
enabled.

## Sync contract

- Direction is Google Sheets to Supabase only.
- A successful Sheet write may enqueue or trigger a refresh, but Sheet success
  never depends on Supabase availability.
- Periodic full reconciliation repairs missed refreshes and is authoritative.
- Every mirrored row stores its stable ID, exact mapped values, source revision,
  deterministic hash, source row number and sync-run identifier.
- Snapshot/replay is idempotent. Rows absent from a complete source snapshot
  are retired only after that snapshot finishes and reconciles successfully.
- Parity compares every mapped value, state, ID and timestamp and records named
  exceptions. Content text is never emitted to logs.
- No Supabase-to-Sheet writer exists. No indefinite dual-write exists.

## Security boundary

Supabase is server-only infrastructure in this phase. Public and authenticated
PostgREST access is default-deny through RLS; only the server-side sync/read
role can access mirror tables. Service-role credentials never enter browser
code, logs, telemetry or preview environments that can reach production data.

A future direct-user access design would require a separate owner identity,
non-null ownership, ownership-aware foreign keys and tested RLS policies. It is
not implicitly enabled by this read model.

## Phases and gates

### Phase 1 — snapshot and replay (authorised)

Create the mirror schema and a resumable exporter/importer. Prove exact counts,
stable IDs and deterministic row hashes with synthetic and copied Sheet data.

### Phase 2 — continuous reconciliation (after Phase 1 is green)

Refresh after successful Sheet mutations and run periodic full repair. Measure
freshness, failures and Sheet/API cost without changing application reads.

### Phase 3 — shadow reads (requires copied-data evidence)

Read both repositories server-side, serve the Sheet result, and record only
redacted parity facts. Any unexplained mismatch blocks progress.

### Phase 4 — production read cutover (separate approval)

Only after security, parity, freshness and rollback rehearsals pass may the app
serve reads from Supabase. Writes still go to Sheets first.

Replacing Sheets as write authority is outside this ADR.

## Alternatives considered

### Continue with Sheets only

Lowest operational cost and still valid if the read model shows no material
benefit. The repository seam means Phase 1 can be removed without UI changes.

### Supabase as a Sheet-fed read model — chosen

Adds query performance and migration evidence without changing the working
source of truth or coupling Supabase to Typefully or Drive.

### Bidirectional Sheet/Supabase sync

Rejected. Two writable authorities create stale-write, conflict and recovery
risks that the product contract explicitly forbids.

### Supabase talks directly to Typefully

Rejected. Typefully reconciliation, idempotency and conflict handling already
live in the application service. Duplicating them in a second sync system would
increase duplicate-publish and overwrite risk.

### Move all content and assets into Supabase

Rejected. Drive remains the canonical Markdown and asset store, while Typefully
remains the final editing and publishing surface.

## Cost and rollback

Implementation cost includes schema ownership, snapshot/replay tooling,
field-level parity, RLS tests, monitoring and operator runbooks. Hosted database,
backup and point-in-time recovery costs must be reviewed before a production
read cutover.

Rollback is immediate while Sheets remains authoritative: disable Supabase
reads and serve the existing Google repository. The mirror may then be rebuilt
from a fresh complete snapshot. No Sheet, Drive or Typefully data is rolled back
or rewritten.

## Consequences

- MIG-01 records the approved topology and its limited scope.
- MIG-02 through MIG-05 remain open and must be proved in order.
- CS-020 stays open until the staged acceptance evidence is complete.
- Production behavior is unchanged by the decision record itself.

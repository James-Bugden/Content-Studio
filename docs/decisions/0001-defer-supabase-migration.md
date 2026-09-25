# ADR-0001: Keep Google Sheets as the content authority

- Status: Accepted — defer migration
- Date: 2026-09-25
- Related: CS-020 / issue #21, `docs/MASTER-SPEC.md` sections 2, 7 and 11

## Decision

Keep Google Sheets as Content Studio's operational authority. Do not create a
Supabase project, schema, dependency, environment variable, snapshot job or
dual-write path now.

The existing `ContentRepository` interface, stable content identifiers and
mutation envelopes remain the migration seam. Reconsider a Supabase-backed
repository only after production evidence meets at least one entry criterion
below and a new cutover decision is approved.

## Evidence available now

- The Google repository reads a 1,600-row synthetic corpus across multiple
  pages, and the Review Queue test keeps processing plus pagination below its
  two-second synthetic budget. These are deterministic adapter tests, not a
  claim about live Google latency.
- Sheet operations already emit redacted latency, outcome and rate-limit facts,
  so a real production trigger can be measured without logging content.
- Stable `Library ID` and `Content ID` values, revision checks, idempotency keys
  and the `ContentRepository` port already isolate application code from the
  Google adapter.
- No recorded production evidence currently shows sustained latency pain,
  quota exhaustion, excessive conflicts, an unmet durable-audit requirement or
  a relational query/automation requirement.
- CS-019's copied-data integration and rollback evidence is not complete. A
  database cutover would add risk before the current provider path has finished
  its own release proof.

The first two points show that a future migration is technically possible. They
do not satisfy CS-020's entry criteria. Absence of measured pain is a reason to
defer, not a reason to invent a database requirement.

## Product-specific trade-offs

Supabase remains a credible later destination. PostgreSQL would make content
lineage, repurposed variants, approval history and cross-workflow reporting
more natural than spreadsheet lookups. Transactions and constraints could also
make multi-step automation safer, while row-level security would provide a
strong foundation if Content Studio becomes multi-user.

Those benefits do not remove the current Drive or Typefully integrations, and
the owner-only application does not yet need most multi-user platform features.
A move today would instead add schema ownership, data import and reconciliation,
RLS policy testing, backup/restore operations, monitoring and a cutover/rollback
burden. It would also take away the Sheet's convenient manual inspection and
bulk-edit surface unless the application first replaces those capabilities.

The worst intermediate state is an indefinite Sheet/Supabase dual-write. If a
migration is later approved, use Supabase as a reconciled read-only shadow
before one explicit authority cutover; never treat both systems as writable
authorities.

## Re-entry criteria

Open a new migration decision only when a dated production sample demonstrates
one or more of the following:

- Google read/write latency repeatedly exceeds the agreed interaction budget at
  the real corpus size after targeted caching or batching has been evaluated.
- Google quota or rate-limit failures interrupt normal work.
- Conflict frequency materially blocks the content workflow.
- Required audit/history or relational queries cannot be met safely through
  provider history, redacted telemetry or a separately approved workbook-native
  option.
- Required automation needs transactional/relational behavior the Sheet adapter
  cannot provide without unsafe complexity.

The decision record must state the sample window, corpus size, p50/p95 latency,
error and conflict counts, affected workflow, and the cost of the current pain.

## Alternatives considered

### Continue with the current adapter — chosen

This preserves one operational authority and keeps Drive and Typefully in their
existing roles. Targeted pagination, caching or batching work can be justified
by measured provider behavior without changing the source of truth.

### Add Supabase now as a read model

Rejected for now. Even a read model adds snapshot freshness, reconciliation,
access-control and operational ownership before there is measured value.

### Dual-write Sheet and Supabase

Rejected. Two uncoordinated authorities create exactly the stale-write and
recovery risks the product contract forbids.

### Move all content and assets into Supabase

Rejected. It would replace the approved Sheet/Drive/Typefully authority model,
expand the migration surface and provide no evidenced MVP benefit.

## Cost, security and rollback if re-opened

A future implementation must budget for snapshot/replay tooling, field-level
parity reports, exception handling, owner-only authentication and RLS, direct
anonymous/non-owner API tests, monitoring, a cutover window and operator time.
Every exposed table must be default-deny with non-null ownership; frontend code
must never receive a service-role credential.

Migration remains reversible: build an immutable snapshot/read model, reconcile
continuously, run shadow reads, approve one authority cutover, and keep a tested
rollback window in which Sheet writes remain the recoverable authority. Do not
retire Sheet writes or history until parity, export and rollback evidence pass.

## Consequences

- MIG-01 has a durable evidence-based no-go decision.
- MIG-02 through MIG-05 remain deliberately deferred because no migration is
  authorised.
- CS-020 stays parked. If evidence later meets a re-entry criterion, reopen the
  decision rather than treating this ADR as permanent opposition to Supabase.

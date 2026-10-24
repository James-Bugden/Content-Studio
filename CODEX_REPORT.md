# CS-056 / DB-2 — build round 1

Issue: https://github.com/James-Bugden/Content-Studio/issues/146

Role: build. Tier: standard. Assigned branch/worktree: `cs-146-contentdb`,
`C:/Users/jbbug/projects/cs-wt/146`. Base: `ea63762` (includes DB-1, PR #155).
The task's PR label 146 identifies the issue; no PR exists for this branch.

Final source/test identity: `36667bbd5e8b8d2853fd851893b601c04d94625a`.
Runtime implementation: `6886f637cd54c51caa3af08a6fd41c4b852d0f68`, including
`9109f0f4036362f36ed0ad30e073babea1291f35`. This report is a later documentation
commit, so its own commit is not the implementation identity.

Read AGENTS.md, MASTER-SPEC, issue #146, database-migration.md sections 1–2/6,
ADR-0002 and its carried notes, and the DB-1 fix report. Applied implementation
and adversarial-verification procedures. All data is synthetic. No database
outside in-memory PGlite was contacted or written. No migration was applied
live. No package manifest, lockfile, shared node_modules or other worktree was
changed. No npm install/ci, push, PR, merge, deployment or issue closure.

## Implementation and acceptance

| Requirement | Status / evidence |
| --- | --- |
| MIG-14, reads | Shared parameterized cases execute against SheetsContentRepository(FakeSheetTransport) and SupabaseContentRepository(FakeContentDb), seeded from synthetic.ts. They compare every value, cell, link and list ordering, all stable-key getters, missing records, settings and summary counts. |
| Revisions | DB uses a 16-hex fingerprint of DB/table/collection-qualified key/version; db-read serves the imported Sheet revision and fails closed when absent/malformed. Repeated reads and metadata-only movement preserve the DB token; a content/version change changes it. Existing DB-1 PGlite tests cover actual SQL no-op/version semantics. |
| Schema | Version checked before every read, including getters; missing/mismatched versions and malformed typed rows fail with SCHEMA_DRIFT. Nullable numeric cells, zero metrics and final-sync timestamp/hash rendering retain domain semantics. |
| Live transport | Server-only GET-only PostgREST adapter, stable ordering, URL allowlist, service-key headers, timeout, hosted row-cap continuation and content-free HTTP/network errors. Transport tests use injected synthetic fetch responses. |
| DB-1 item 8 | Additive migration retains content_source/master_link/count and adds named counts. One group per Content Queue source; multiple explicit master URLs choose the lexical minimum. Markdown is the fallback only when the source has no explicit master link. PGlite proves SQL/fake parity and view role denial/security_invoker. Nullable domain counts are separately tested. |
| Health/privacy | Health includes db capability and never the DB URL/key. Inactive DB is omitted from review/reconcile capability lists, so default Sheet operation gains no irrelevant warning. |
| Composition/non-goals | sheet/db-shadow keep Sheet reads; fake db/db-read select the DB adapter. All DB mutations return FORBIDDEN/read_only without changing data. Live database store modes are gated until the later cutover issues. |

Schedule ordering follows design section 2: date/platform/slot with Content ID
as the final tie-breaker. The shared contract seeds the Sheet schedule in that
same order; the production Sheet adapter continues to preserve workbook order.
Post order is source_sheet_row (nulls last), then stable ID. Timestamp cells are
rendered in the operational Taipei offset, including split final-sync hashes.

Two synthetic-fixture corrections make parity meaningful: the default summary
now describes the actual Queue corpus instead of unrelated hard-coded counts,
and Ready Queue preserves hyperlink targets while discarding source formulas.
The existing Sheet summary regression now injects deliberately independent
counts/links, preserving proof that Sheet reads the summary tab directly.

## Verification environment

Windows, Node 24.15.0, shared Vitest 5.0.1, PGlite 0.5.8. The shared Vitest is
older than the lockfile's 5.0.3; dependencies were not installed or changed.
The junction lacks PGlite and Supabase declarations. Reused DB-1's existing
scratch extraction at `D:/tmp/cs145-r1-deps` (PGlite 0.5.8 and Supabase 2.117.0,
matching the lockfile). No archive retrieval or dependency installation needed.

Ignored `tmp/db2/vitest.config.ts` merges the real repo config and aliases only
PGlite and pg_trgm to their actual scratch JS modules. The targeted typecheck
config extends the real tsconfig, disables incremental writes, includes touched
application/integration/fixture/test entrypoints and their transitive imports,
and resolves PGlite/Supabase to their real scratch declarations. It adds no
fake declarations and weakens no compiler checks.

Every Vitest, tsc and ESLint invocation ran through `bash ~/bin/heavy`, with
targeted files only. Memory waits were allowed to complete without bypassing
the queue or terminating other processes.

## Commands and results

```sh
bash ~/bin/heavy npx vitest run \
  tests/unit/application/content-repository-contract.test.ts \
  tests/unit/supabase/content-db.test.ts \
  tests/unit/security/health.test.ts \
  tests/unit/google/sheets-repository.test.ts \
  tests/unit/application/backlog.test.ts \
  tests/unit/application/backlog-readiness.test.ts \
  tests/unit/application/schedule.test.ts \
  tests/unit/supabase/content-schema.test.ts \
  tests/unit/application/reconcile.test.ts \
  tests/unit/application/review.test.ts \
  --config tmp/db2/vitest.config.ts --maxWorkers=1 --silent
bash ~/bin/heavy npx tsc --noEmit --project tmp/db2/tsconfig.json
bash ~/bin/heavy npx eslint \
  src/application/content-db.ts src/application/capabilities.ts \
  src/application/container.ts src/domain/capability.ts src/lib/env.ts \
  src/fixtures/synthetic.ts src/integrations/google/fake-sheet.ts \
  src/integrations/supabase/content-db.ts \
  src/integrations/supabase/content-repository.ts \
  src/integrations/supabase/content-row-schema.ts \
  src/integrations/supabase/content-schema.ts \
  src/integrations/supabase/fake-content-db.ts src/app/api/health/route.ts \
  src/components/capability-banner.tsx \
  tests/unit/application/content-repository-contract.test.ts \
  tests/unit/supabase/content-db.test.ts \
  tests/unit/google/sheets-repository.test.ts tests/unit/security/health.test.ts
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
git diff --check
```

Final post-mutation acceptance run at runtime commit `6886f63`: **10 files /
184 tests passed**, 19.29 seconds. Targeted typecheck and touched-file lint:
exit 0. Privacy scan then flagged an intentionally hostile synthetic URL as an
email-shaped string. Replaced it with an equivalent hostile-host suffix case
(test-only commit `36667bb`); no production code changed. Final affected-file
retest and lint:

```sh
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-db.test.ts --config tmp/db2/vitest.config.ts --maxWorkers=1 --silent
bash ~/bin/heavy npx eslint tests/unit/supabase/content-db.test.ts
```

Exit 0: **10/10 passed**, 5.13 seconds; lint exit 0. Private-path policy and
secret scan then both passed (520 tracked files before this report was added).
Diff whitespace check passed. No full suite or build was run.

Initial targeted run: 3 files / 39 tests passed. A subsequent broader run
caught the old hard-coded summary expectation; it was fixed with an explicit
independent fixture. A later final retest caught fallback URLs outranking
explicit masters; the SQL and fake now prefer explicit masters. Neither failed
run is counted as acceptance evidence.

## Adversarial verification

Ran three implementation mutations against committed source, with the tests
unchanged. The ignored runner `python tmp/db2/mutate.py` asserts that exactly
one replacement applies, records original/mutated SHA-256, and restores the
original bytes in finally. Each mutation must return nonzero. Final probe
original SHA-256 values (all restored):

- revision: `7b3c90ad4dbb21203fbc4a8112630772126d98432038a765f999343c4bf718d0`
- summary: `bb6d6afe2289489f72b718042c7d4b0dbc84cc74ec7d4b1d1736be6182f9fee5`
- privacy: `f393c851135bbe0899fc02a7a3bac7b15d89f7d4fc4dd05e9ba6d2b957a90b59`

1. Replace row_version in the DB revision fingerprint with a constant: the
   version-change regression fails (exit 1).
2. Group the summary by source plus master URL again: the PGlite source-group
   parity regression fails (exit 1).
3. Return the configured DB URL as a health capability detail: the sentinel
   privacy regression fails (exit 1).

Filtered mutation runs deliberately exclude unrelated tests and are
falsification probes, not acceptance passes. All implementation files were
restored byte-for-byte before the final acceptance run. Lenses: revision/state
correctness, SQL grouping and ACLs, privacy/redaction, false-green tests.
This build report does not claim independent reviewer approval.

## Limits and remaining work

- Hosted PostgREST, Security Advisor, real account permissions, live imports
  and workbook-wide parity remain unverified; none was authorized here.
- The additive summary migration is required before database summary reads.
  It retains DB-1's Queue collection scope; it does not persist a second summary
  authority or reproduce arbitrary future workbook summary headers.
- Full dual-mode browser/mutation journeys require DB-3 and subsequent phase
  work. No T1–T4 run, staged build, production cutover or hosted CI is claimed.
  The provider label/impact mapping is typechecked and unit-tested; default
  Sheet UI capabilities remain unchanged.
- Arbitrary production formatting (including timestamp display variants),
  import exceptions and cross-request/multi-page snapshot consistency remain
  for DB-4/cutover evidence. The contract's corpus and ordering are explicit.
- DB-3/4 carry items 3/4/7/11 in ADR-0002 remain assigned there. DB-2 introduces
  no write RPCs, importer, fault-injection controls or live store selection.

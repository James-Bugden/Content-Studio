# CS-055 / DB-1 — fix round 1

Date: 2026-10-24. Classification: Heavy. Role: fix.

Verified implementation commit: `4d04f6126154930e29eaa2fe23f693e9a401f636`
(`CS-055: fix review round 1: denial proof and retry semantics`). This report
is a subsequent documentation-only commit; the implementation SHA identifies
the exact SQL, tests and ADR verified below.

Base: `ff4271bdb4462c37aeceea4a64a47d848df9ac74`.
Branch: `cs-145-db-schema`, in the assigned worktree.
[Issue #145](https://github.com/James-Bugden/Content-Studio/issues/145).
[Actual PR #155](https://github.com/James-Bugden/Content-Studio/pull/155)
(the task labels this work PR 145; GitHub identifies 145 as the issue).

Read AGENTS.md, MASTER-SPEC, database-migration.md (including 1.4 and 1.6),
the issue, PR and supplied independent review. Applied the implementation and
adversarial-verification procedures. No live database, browser spec, other
worktree, dependency manifest or shared node_modules was changed. No push,
merge, deployment or issue closure was performed.

## Per-finding status

| Finding | Status | Change / evidence |
| --- | --- | --- |
| 1, blocking | Fixed | Suite-local raw setup grants hosted-style default ALL on tables/sequences to anon, authenticated and service_role before applying DB-1. AUTH_SHIM is unchanged. Existing denial tests plus explicit sequence ACL assertions pass. Removing the three revoke lines makes both role-denial tests fail. |
| 2, blocking | Fixed, option (a) | Only successful outcomes enter the ledger. NOT_FOUND, STALE_READ and queue CONFLICT remain audited without consuming the operation ID. Tests cover creation after NOT_FOUND, a fresh expected_version after stale failure, queue conflict recovery, exact stored-success replay even after another edit, and different-hash rejection after success. ADR documents Sheet-compatible retries. |
| 3 | Carried only | ADR NOTES assigns mode storage/comparison on replay to DB-3. Caller-bound hashes remain the current contract. |
| 4 | Carried only | ADR NOTES assigns canonical snapshot hashes over counts, rows, exceptions and collection hashes to DB-4. |
| 5 | Fixed as requested | Schedule rejects self-parenting and negative values in all six metric columns. Tests verify constraint errors and atomic rollback; zero and null metrics remain accepted. Longer lineage cycles are not prevented. |
| 6 | Fixed | 262,144-byte cap on p_data::text, in addition to the existing 50,000-character top-level string limit. Both copy and import reject nested UTF-8 passthrough exceeding the byte cap, with no partial rows/history/audit/ledger. |
| 7 | Carried only | ADR NOTES assigns review of the service-role helper's exposed schema to DB-3. |
| 8 | Carried only | ADR NOTES assigns QueueSummaryRow parity and source/master grouping to DB-2. |
| 9 | Fixed | Explicit BEGIN/COMMIT encloses the entire migration, including ACL/RLS setup. Separate-command late-failure test proves rollback without relying on implicit batch atomicity; removing the boundaries makes it fail. |
| 10 | Fixed | ADR lists exact five function signatures, two views and eight tables for Phase A rollback, plus automatically removed sequences/indexes and preserved staging/Replies objects. PGlite executes that exact documented SQL and proves the pre-existing relation/function inventory is preserved. |
| 11 | Carried only | ADR NOTES assigns READ COMMITTED versus REPEATABLE READ/SERIALIZABLE handling and real-backend verification to DB-3. |
| 12 | Fixed | ADR limits unconditional already_applied to equality of every supplied typed field, including Sheet metadata. Metadata-only differences still require CAS and preserve row_version when applied. A stale-metadata regression exercises that distinction. |

## Environment and dependency recovery

Windows / Node 24.15.0 / Vitest 5.0.1 / PGlite 0.5.8. Synthetic fixtures only.
All Vitest, typecheck and lint commands used `bash ~/bin/heavy`; final tests
used one worker. No npm install/ci and no full suite were run.

The shared node_modules junction lacked the already-declared PGlite and
Supabase packages. The initial unaliased schema command failed during import
(zero tests); the initial typecheck with only PGlite resolved failed on missing
Supabase declarations and resulting implicit-any diagnostics. These are not
counted as passes.

Recovered the exact existing lockfile versions into scratch storage with
`npm.cmd pack @electric-sql/pglite@0.5.8 --pack-destination tmp/db1-r1 --silent`
and equivalent locked-archive retrieval for Supabase's existing dependency
tree. Verified archive SHA-512 against package-lock.json before using them.
Moved extracted packages to `D:/tmp/cs145-r1-deps` after C: filled. Temporary,
ignored configs in `tmp/db1-r1` supply only dependency resolution overrides:

- Vitest config imports the repository config and aliases PGlite and pg_trgm
  to the extracted package's actual JS modules.
- Typecheck config extends the repository tsconfig, preserves its full source
  inclusion and compiler checks, resolves @/* to src/*, aliases PGlite and
  Supabase to their actual declarations, and disables incremental writes.
  Supabase transitive declarations resolve from the scratch dependency tree.

No fake declarations, weakened checks, new dependencies or lockfile edits.
The normal commands still require a complete dependency installation by its
owner; the passing commands below explicitly used the scratch configs.

## Commands and results

Baseline after all source edits:

```sh
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-schema.test.ts --config tmp/db1-r1/vitest.config.mjs
```

Exit 0: **47/47 passed**, 10.16 seconds.

Final retest after all mutations were restored:

```sh
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-schema.test.ts tests/replies/unit/db/owner-boundary.test.ts tests/replies/unit/db/recording.test.ts tests/replies/unit/db/schema.test.ts tests/replies/unit/facts/repository.test.ts tests/replies/unit/resources/repository.test.ts tests/replies/unit/server/supabase-store.test.ts --config tmp/db1-r1/vitest.config.mjs --maxWorkers=1
bash ~/bin/heavy npx tsc --noEmit --project tmp/db1-r1/tsconfig.json
bash ~/bin/heavy npx eslint tests/unit/supabase/content-schema.test.ts
git diff --check
git diff ff4271b HEAD --check
```

Results: **7 files / 153 tests passed** (47 Content + 106 Replies), 28.43 seconds;
typecheck exit 0; touched-file lint exit 0; both diff checks exit 0. Schema tests
also prove existing Replies shape/ACLs remain unchanged in the same database.
No runtime/UI change: browser, visual, mobile and production verification were
outside this fix round. Hosted checks were not run and are not claimed passed.

## Mutation evidence

Every mutation changed the SQL implementation on disk, left the tests intact,
ran through the heavy queue, and restored the original Buffer in finally.
Byte equality and SHA-256 were checked after every restoration.

Original/restored SQL SHA-256:
`658387850e8af42e7b50b7f85f3a52e8f316c71717d473c76b97fc26764f25f4`.

1. **Required revoke mutation.** Deleted exactly the table revoke in the
   eight-table loop, the table revoke in the two-view loop, and the sequence
   revoke in the two-sequence loop. Function revokes and RLS remained intact.
   Mutated SHA-256:
   `bda35fb7077d550b9f109689f2129bb054fed98df76abcc8d2b3b10fd790810c`.
   Ran the full 47-test schema command above: test process exit **1**, **45
   passed / 2 failed**. Both anon and authenticated denial tests failed with
   `expected the query to be rejected, but it succeeded` (8.16 seconds).
   A first attempt could not save its output because C: was full; restoration
   succeeded, and that attempt is excluded from evidence. The recorded rerun
   streamed output after scratch files were moved. Restored byte-for-byte;
   the final 153-test run includes all 47 schema tests green.
2. **Retry mutation.** Replaced the success-only ledger insertion guard with
   its original unconditional non-import guard. Mutated SHA-256:
   `1f1650c2ff93d41a7669f736faf9509afde6fa9ef6e31b4bb31d7a7a8aacd781`.
   Ran the schema command with `-t "MIG-07|queue operation ID"`: test exit
   **1**, **4 failed / 17 passed / 26 deliberately filtered out**. The stale
   ledger count, NOT_FOUND retry, fresh-version retry and queue conflict retry
   assertions all detected failed outcomes entering the ledger (4.03 seconds).
   Restored byte-for-byte.
3. **Transaction mutation.** Deleted only top-level BEGIN and COMMIT.
   Mutated SHA-256:
   `760d84f26512655cb134dfb4420a28e009e21e7c9ad62688c0d967d2d4e4bd27`.
   Ran the schema command with `-t "rolls back object creation"`: test exit
   **1**, **1 failed / 46 deliberately filtered out**. After a late 22012
   failure and ROLLBACK, **22 relations remained instead of zero** (5.18
   seconds). The test sends object creation and the fault separately, so
   implicit multi-statement batch atomicity cannot hide this defect.
   Restored byte-for-byte.

The filtered mutation runs are falsification probes, not acceptance passes.
Final acceptance evidence is the unfiltered targeted 153-test run. Skeptical
lenses covered false-green ACL tests, retry/state semantics, atomic deployment
failure, typed constraints, nested input size and rollback isolation. The
committed diff was self-reviewed; this fix round does not claim a new
independent approval.

## Remaining risks and external state

- Carry findings 3/4/7/8/11 are documented, deliberately not implemented here.
- MIG-04 is locally evidenced under hosted-style defaults. Actual hosted ACLs,
  PostgREST/OpenAPI/GraphQL exposure, Security Advisor, hosted service_role
  BYPASSRLS, deferred-FK handling through PostgREST and real multi-backend
  concurrency/isolation remain unverified. No live migration was authorized
  or attempted. No production phase flipped.
- The size cap applies per mutation/row, not to a whole import batch. Longer
  lineage cycles remain possible; only self-parenting was in this fix scope.
- At the inspected base SHA, PR #155 had green typecheck/lint/policy/unit and
  dependency checks, but browser shard 3 and its aggregate check were red.
  Existing Vercel status was green. No new CI or deployment exists for these
  unpushed commits; repository-wide merge readiness is not asserted. Browser
  specs were intentionally left untouched.

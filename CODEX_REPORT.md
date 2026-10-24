# CODEX_REPORT — CS-055 / DB-1, build round 1

- Issue: https://github.com/James-Bugden/Content-Studio/issues/145 (open)
- Branch/worktree: `cs-145-db-schema`, worktree `145`; isolated from `origin/main`
- Base SHA: `7aca000974580e255e5112d173d0b6a34e89ae34`
- Verified implementation SHA: `fce92a13f98e4f8855957f579117e410a5b691c1`
- This report is a separate commit on top of that implementation SHA. `git rev-parse HEAD` identifies the final report-bearing handoff.
- Tier/role/round: Heavy / build / 1. Local Windows + PGlite, synthetic fixtures only, 2026-10-24.
- No push, PR creation, merge, live database connection/migration, import, runtime switch or deployment. The issue remains open. No other worktree was edited and no dependency manifest/lockfile or shared node_modules was modified by installation. No npm install/ci was run.

## Delivered

One additive migration, `supabase/migrations/20261024000100_content_authority.sql`, creates typed posts, schedule, workflow settings, operations, before-image history, redacted audit, schema singleton and import-run evidence, plus derived Ready Queue/Queue Summary views. Every explicit object is `content_studio_*`; existing mirror/Replies objects are unchanged. The extra import-run evidence table holds Phase A counts/hashes/named exceptions, not content payloads.

The four required RPCs and their shared invoker implementation provide version preconditions, exact ledger replay, different-hash conflict, not-found/stale/already-applied results, history, audit and transactional rollback. Import is an atomic typed upsert batch with one ledger entry, duplicate/count/exception checks and deferred schedule lineage. Content-identical copies preserve editor versions; metadata-only changes remain audited. Service-only ACLs explicitly account for hosted Supabase's default function grants. All eight tables force RLS with zero policies; both views are security invokers, all five functions pin search_path, and sequences have explicit ACLs.

`src/integrations/supabase/content-schema.ts` defines the compiled version and the SCHEMA_DRIFT assertion without runtime wiring. ADR-0002 accepts the phased design, supersedes ADR-0001's scope limit, documents SQL parameter/result contracts and preserves every production phase/owner gate. The unchanged Replies PGlite harness is reused by the new schema suite.

## Commands and results

Every Vitest, TypeScript and ESLint invocation ran through `bash ~/bin/heavy`. Tests used `--maxWorkers=1`; no full suite/build/browser run was started.

The shared node_modules junction was missing the already-declared `@electric-sql/pglite@0.5.8`; the normal first test invocation could not resolve it. For verification only, downloaded its lockfile-pinned tarball into ignored `tmp/db1-verification/`, verified its SHA-512 against package-lock.json and extracted it there. No package installation or dependency change was made. An ignored Vitest config extends the repository config and aliases only PGlite and its pg_trgm module to that extracted package. An ignored TypeScript config extends tsconfig.json, retains the `@/*` alias, adds the same two PGlite declaration paths, disables incremental output, and includes only the two new TypeScript files plus their transitive imports. These local wrappers remain available for reruns.

| Command | Result |
| --- | --- |
| `bash ~/bin/heavy npx vitest run tests/unit/supabase/content-schema.test.ts --config tmp/db1-verification/vitest.config.ts --maxWorkers=1` | Final acceptance retest after restoring mutants: **33 passed**, 0 failed/skipped. |
| Targeted combined command below | **10 files, 154 tests passed** (33 new + 121 existing). |
| `bash ~/bin/heavy npx tsc --noEmit --project tmp/db1-verification/tsconfig.json` | PASS, exit 0; targeted files and transitive contracts. |
| `bash ~/bin/heavy npx eslint src/integrations/supabase/content-schema.ts tests/unit/supabase/content-schema.test.ts` | PASS, exit 0. |
| `node scripts/scan-secrets.mjs src/integrations/supabase/content-schema.ts supabase/migrations/20261024000100_content_authority.sql docs/decisions/0002-content-authority-in-postgres.md tests/unit/supabase/content-schema.test.ts` | PASS, 4 files clean. |
| `node scripts/check-private-paths.mjs` | PASS, 502 tracked files clean before this report was added. |
| `git diff --cached --check`, `git diff --check HEAD` | PASS. |
| `node tmp/db1-verification/mutation-check.mjs` | Both intentional implementation mutants failed the targeted regression, then the original SQL was restored byte-for-byte. |

Combined regression command:

```bash
bash ~/bin/heavy npx vitest run \
  tests/unit/supabase/content-schema.test.ts \
  tests/unit/supabase/sheet-mirror.test.ts \
  tests/unit/supabase/sheet-mirror-parity.test.ts \
  tests/unit/supabase/reconciliation-ops.test.ts \
  tests/replies/unit/db/schema.test.ts \
  tests/replies/unit/db/owner-boundary.test.ts \
  tests/replies/unit/db/recording.test.ts \
  tests/replies/unit/server/supabase-store.test.ts \
  tests/replies/unit/facts/repository.test.ts \
  tests/replies/unit/resources/repository.test.ts \
  --config tmp/db1-verification/vitest.config.ts --maxWorkers=1
```

During development, a TypeScript parenthesis typo, SQL UTF-8 BOM and a denial assertion for a structurally non-updatable aggregate view were corrected. The final test checks view SELECT denial and explicit ACL absence rather than mistaking the view's structural rejection for a permission result. There are no outstanding local check failures. Vite emits an advisory about the temporary config's extensionless import; it does not affect test results.

## Acceptance status

| ID | Status and evidence |
| --- | --- |
| MIG-06 | **PASS, local DB-1 contract.** DB singleton version 1 matches the server constant; singleton constraints reject duplicates/false singleton; actual DB mismatch and missing/malformed versions raise SCHEMA_DRIFT with kind `version`. Runtime startup wiring belongs to the adapter issues. |
| MIG-07 | **PASS, PGlite.** Same operation/hash replays the exact stored result; hash/target reuse conflicts; stale reports the current version; present patch is already_applied without bump/history. Forced history, audit and ledger failures after CAS leave the row/version and all three tables unchanged; retry succeeds. Competing deliveries and version checks are covered on PGlite's serialized connection. |
| MIG-04 re-run | **PASS locally; hosted acceptance NOT RUN.** Every new table/view denies anon/authenticated SELECT; tables deny DELETE, sequences deny use, every function denies execution, table/function ACLs deny access, information_schema hides the objects from those roles. RLS is enabled/forced with zero policies and still blocks rows under an intentionally added temporary SELECT grant. Hosted denial proofs, PostgREST behavior and Security Advisor were not run because this task forbids live database application. No claim of a green hosted advisor. |
| MIG-08 | **DB-1 portion PASS.** Full before-images, sorted changed fields and distinct SHA-256 before/after hashes are tested; audit/ledger serialization excludes synthetic copy bodies. Export/retention operations remain future-phase work. |
| MIG-09 | **RPC groundwork PASS only.** Typed upserts, all four collections, count/duplicate/exception validation, history, replay, deferred lineage and all-or-nothing stale/invalid-row rollback are covered. Actual Sheet import/parity and Phase A exit measurements belong to DB-4 and were not run. |
| MIG-05, MIG-10–MIG-15 | Out of scope; no phase acceptance asserted. |

T0 applies to this SQL/contract-only change. T1–T4 do not apply to this build task's absent UI/runtime/deployment changes; their future phase requirements are preserved. The existing Replies harness still explicitly skips pgvector because PGlite lacks it; the migration does not depend on vector. This is not hosted/vector verification.

## Adversarial verification and review

Self-reviewed the committed diff under correctness/edges, state/concurrency, access/privacy and test-integrity lenses. Confirmed exact new-relation inventory, typed header coverage, preservation of Replies table shapes/ACLs, immutable keys/metadata, normal writable allowlists, no-op versions, transactional fault injection and server-only object permissions. No separate independent reviewer was spawned during this builder round; independent review remains a next-round gate.

Implementation mutation proofs (tests unchanged):

1. Disabled both stale-version detection and the UPDATE version predicate. Confirmed two replacements and mutated SQL SHA-256 `2b969c08811f24b8ef875a08412f4a797a417abfb7539d3258b6acc2100ca7cd`. Running the targeted stale regression through heavy exited 1: returned success instead of STALE_READ.
2. Removed anon/authenticated from function revokes while retaining PUBLIC revoke. Confirmed one replacement and mutated SQL SHA-256 `b4890bae615d8af676b6b08389ef57613206408041e2844fed906043d47c3f10`. Running the targeted anon-denial regression through heavy exited 1: a callable function reached validation (22023) instead of execute denial (42501).

Both mutations were reverted with byte-for-byte verification and a clean git diff. The restored committed implementation then passed all 33 schema tests. Mutation-only filtered runs intentionally skip unrelated tests and are evidence of detection, not acceptance passes.

## Unresolved risks and follow-up gates

- No migration was applied to any live project. Explicit hosted application, Security Advisor and hosted role/PostgREST denial tests remain required; this issue must not be closed on local evidence alone.
- PGlite serializes a single connection. It exercises real PostgreSQL constraints/transactions/CAS, but cannot prove advisory-lock scheduling across separate hosted backends. Hosted concurrency verification remains required before cutover.
- Import RPC hashes are supplied by the trusted server importer; canonical envelope hashing, complete-row construction, snapshot chronology, treatment of IDs absent from snapshots, actual import/parity and scheduling are DB-4 responsibilities. Each changed row requires its pre-read expected version; stale snapshots cannot silently overwrite a newer version. This RPC performs no deletion of absent rows.
- The server adapter must bind operation kind/target/exact patch to its hash, authorize the owner, check schema version, translate row versions to domain revisions and preserve domain/saga validation. Those runtime reads/writes are outside DB-1 and have not been enabled.
- Corpus-wide advisory locking favors simple correctness for a single owner's small corpus; assess hosted import duration/lock contention before production use.
- All design phase gates remain outstanding until separately evidenced; no claim that Phase A has exited. Sheet remains production authority, with no Drive decision or data movement made here.

# #234 DB-only build evidence — round 1

Heavy build on `feat/234-db-only`, based on `aa11fdd`. Scope and authority are
the owner's written 2026-10-27 decision in the build request. No GitHub CLI,
push, live provider access, secret edits, migration application or deployment.
Production artifact tested: Next BUILD_ID `XSY6GqcmEw4vU1R69-HYZ`.

## Acceptance

- DB-ONLY-1: live `db` needs `CS_CONTENT_DB_ENABLED=true` plus the existing
  database URL/key. Read/write enable flags may be omitted; explicit
  `CS_CONTENT_WRITE_ENABLED=false` freezes Content. No build identity, source
  alias, folder/waiver, parity, rehearsal, epoch or gate record admits serving.
- DB-ONLY-2: the live composition never creates Sheet adapters. Library, Queue,
  Ready, Schedule, settings and summary read DB; Replies idea insertion uses
  the same DB repository. Reconcile omits Sheet parity and the switch panel.
  Import/parity/cutover operations refuse in DB-only mode. The export cron
  repairs Drive only. Throwing Sheet spies and browser counters prove no reads
  or writes, including during Sheet outages and obsolete Sheet edits.
- DB-ONLY-3: real authenticated draft API and current-migration SQL tests prove
  owner/same-origin checks, validation, idempotent replay, operation-reuse
  conflict, stale-version rejection, Schedule writes, Queue insertion, audit,
  browser-role denial and guarded Drive-link recovery. Independent Drive workers
  retain expiring leases/fencing without authority admission checks.
- DB-ONLY-4: independent page reads run concurrently. Display reads share a
  three-second per-instance cache and pending promises; mutation attempts clear
  it before and after execution. Point reads and SQL CAS remain fresh. Tests
  cover expiry, read failures and reads racing mutation attempts.

## Verification

Every Vitest, typecheck, build and Playwright command used `bash ~/bin/heavy`.
Only targeted files/directories ran, never the full suite.

- T0: `npx vitest run tests/unit/application tests/unit/supabase tests/unit/security
  --maxWorkers=1 --reporter=dot`: **59 files, 1,415 tests passed**, exit 0.
  `CS_TEST_MODE=unit` suppresses routine telemetry in this run.
- T0: `npm run typecheck`, `npm run lint`: passed, exit 0.
- T0: staged diff whitespace check, private-path policy and secret scan passed
  (699 tracked files, synthetic fixtures only).
- T0: `npm run build`: passed. Shared Windows `node_modules` junction prevents
  the default Turbopack root from resolving packages. Build used a temporary
  parent-directory Turbopack root; `next.config.ts` was restored afterward.
  A Webpack fallback attempt hit the existing Replies client `node:crypto`
  import incompatibility; the successful artifact uses Turbopack.
- T1: `content-write-cutover.spec.ts`, `CS_E2E_CONTENT_STORE=db`, projects
  `w375` and `w1280`: **4 passed**, production artifact, zero Sheet counters.
  Axe, overflow checks, DB draft persistence and no-link recovery passed.
- T1: `content-read-cutover.spec.ts`, `CS_E2E_CONTENT_STORE=db-read`, projects
  `w375` and `w1280`: **6 passed** on the final isolated run. An earlier mobile
  navigation timeout during concurrent unit work passed its exact isolated
  retest before this final full-file run.
- T2: interactive Chrome on the credential-free local development server:
  synthetic owner sign-in, dashboard and Fix issues rendered; DB-only authority
  text visible; switch/parity controls absent. Desktop and 375px review showed
  readable layout, no horizontal overflow and no console errors/warnings.
  Temporary viewport, local tab/server, config override and Next's generated
  agent-rules block were cleaned up. T3/T4 do not apply to these changes.

Independent reviewer found and rechecked fixes for the mutation-auth gate,
legacy parity route, distributed Drive worker lease and repair acknowledgements
during a Content freeze. Final re-review found no blocking defect. Adversarial
test-integrity check temporarily replaced the live DB repository with a Sheet
repository: the zero-Sheet regression failed with `Sheet must never run`
(exit 1). The original implementation was restored, then the directory checks
passed. Legacy export/rollback tests explicitly assemble the retained legacy
components against their historical SQL contract; current-serving tests use
the real composition with **all** migrations including the new one.

## Local warm timings

Synthetic fixtures only; these are not hosted Supabase or production timings.
PGlite numbers are the mean of ten warm application-loader invocations. HTTP
numbers include complete local production-server responses, one warm sample
per route at each viewport.

| Surface | PGlite loader ms | HTTP 375px ms | HTTP 1280px ms |
| --- | ---: | ---: | ---: |
| Backlog | 0.22 | 20 | 22 |
| Next up | 0.75 | 17 | 14 |
| Posts | 0.63 | 26 | 22 |
| Calendar | 0.24 | 28 | 23 |

Warm loaders collectively read Library, Ready, Schedule, settings and summary
once each, sharing one schema-version request; no per-row DB reads. The cache
does not remove hosted network latency on a cold instance.

## Deployment boundary

Apply `20261027000100_content_database_only.sql` before deploying this code.
It replaces historical epoch admission inside write/recovery RPCs while keeping
their validation, CAS, ledger, audit/history, outbox and service-role grants.
No content import or deletion occurs. Live configuration and production
performance remain unverified in this build-only round. Current configuration
and legacy-mode history are documented in `docs/ops/cutover.md`.

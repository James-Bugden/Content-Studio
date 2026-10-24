# CS-059b / issue #179 — build round 1

- Classification/role: Standard / build. Issue: https://github.com/James-Bugden/Content-Studio/issues/179; tracker #141; parent #149.
- Branch: `cs-179-fu`; original clean base `d93e98e70771a5a731e27f5da0c0704881921dd2` (DB-5 / #177).
- Implementation commit: `2c8873de01cc91145f42af2d3cc251aa39706a4e`. This report is a subsequent documentation commit.
- Read AGENTS.md, MASTER-SPEC, database-migration Phase C, ADR-0002, predecessor report149b, the current issue, implementation/QA procedures, cutover implementation and tests. Applied the implementation procedure and Supabase read-only verification guidance.
- No push, GitHub write, merge, deployment, live migration/apply, dependency/lockfile edit, npm install/ci, or shared node_modules mutation. All test data is synthetic. No new server module; the modified server module retains `import 'server-only'`.

## Changes and acceptance

1. Pending overlays retain the last successfully checked DB `(row_version, sheet_revision)` pair. Repeated get/list calls skip fresh full-tab Sheet reads for that pair. A change to either token rechecks the current Sheet fingerprint. Failed authority reads retry; a new save installs a fresh overlay/cache. Direct fingerprint matches still retire overlays without an authority read. Existing stale-import, concurrency, metadata-only and replay protections remain exercised.
2. Health smoke requires the exact extra `detail` key and public authority label only for the db-read DB capability, retaining exact key checks for other providers/modes. CI's required db-read job now runs both smoke and cutover specs at both widths using the verified build artifact.
3. The new R05 regression runs the actual db-read import pipeline with a valid snapshot containing an unknown boolean conversion and a separate valid changed row. It requires VALIDATION_FAILED, no store invocation and unchanged stored Library rows. Named numeric/size refusal coverage remains green.
4. Added a mandatory pre-apply migration-history/catalog check to the T3 runbook, including the exact two edited filenames, manual-apply detection, private hash evidence and forward-migration recovery if either was previously applied. See hosted evidence and remaining branch gate below.
5. The portable implementation skill now requires all of security, application and Supabase for database/read-path handoffs, explicitly including health and server boundaries.

## T0 verification

Commands ran through the shared heavy queue. Tests used one worker; no full suite ran.

```text
CS_TEST_MODE=unit bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase --maxWorkers=1 --silent
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
git diff --check
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
```

Mandatory selection PASS: **25 files / 422 tests**, no skipped tests, 44.43 seconds, exit 0. Health and boundaries both ran. Typecheck, lint, diff check, private-path policy and secret scan passed. Final post-mutation restoration results are recorded below.

Environment: Windows, Node 24.15.0; existing Next 16.3.6, Vitest 5.0.1, TypeScript 5.9.3, Playwright 1.63.0; PGlite 0.5.8 and Supabase JS 2.117.0. Installed Next/Vitest differ from manifest pins; lockfile CI remains required. The worktree node_modules junction was preserved. A dedicated external scratch tree copied tracked source and used per-package junctions to existing dependencies for unit checks, plus copies of the already available missing locked packages. Turbopack refused dependencies outside its root, so browser verification used physical copies of those same dependencies inside scratch. No packages were installed/downloaded and no linked package was modified. Scratch had its own Git index for security checks.

Earlier attempts are not passes: the first two scratch runs lacked Git metadata, so boundaries and acceptance-policy checks failed; one accidental worktree run failed five suites because PGlite/Supabase packages are missing there. Typecheck initially caught two new test union accesses; corrected before the green run. A temporary worktree test log was removed. These harness failures were not represented as product failures or successful verification.

## Mutation evidence for every new test

Mutations ran only in external scratch, one at a time, against production implementation. Each replacement was unique, changed the implementation SHA-256, exited 1 with the expected assertion failures, and was byte-restored in `finally`. Every mutation invocation included the complete mandatory three directories, without a test-name filter.

| Regression (fake and PGlite where applicable) | Mutation | Evidence |
| --- | --- | --- |
| New repeated Library, Queue and Schedule get/list tests: six cases, each with ten repeated get/list cycles, correct saved revision and replacement-save reset | A: disable the checked-pair guard | All six fail; wave totals 10 failed / 412 passed |
| New row_version-only change test: two cases, Sheet revision unchanged | B: ignore checked row_version | Both fail; 2 failed / 420 passed |
| Strengthened existing metadata-only repair test: two cases, warm the mismatch before a revision-only repair without a version bump | C: ignore checked sheet_revision | Both fail; 2 failed / 420 passed |
| New failed-authority-read retry test: two cases | D: cache an unsuccessful authority check | Both fail; 2 failed / 420 passed |
| New db-read unknown-conversion abort test | E / R05: skip unclassified conversion failures in db-read | Dedicated test fails because import resolves; 1 failed / 421 passed |

After all five mutations were byte-restored, the complete mandatory selection
passed again: **25 files / 422 tests**, no skipped tests, 49.76 seconds, exit 0.
Mutation wave durations were A 49.94s, B 43.40s, C 47.79s, D 45.18s and E
44.47s. No mutation entered the branch or commit. CI YAML parsed successfully;
the db-read step includes both specs and the aggregate browser gate requires
that job.

## T1 verification

```text
CS_E2E_CONTENT_STORE=db-read CS_E2E_PORT=3290 CS_COMMIT_SHA=2c8873de01cc91145f42af2d3cc251aa39706a4e
bash ~/bin/heavy node node_modules/@playwright/test/cli.js test tests/e2e/content-read-cutover.spec.ts tests/e2e/smoke.spec.ts --project=w375 --project=w1280
```

PASS: **10 tests, zero skipped**, 56.7 seconds including the default Next
production build, exit 0. Build ID `x1kb3-6Bjw__L56X86G0Q`. All 560 files
from the implementation commit were byte-compared with scratch: zero
mismatches after synchronizing the final procedure documentation. This is a
synthetic local production build, not deployed-build evidence.

Earlier browser attempts are not passes: Turbopack rejected the initial
external dependency junctions; a subsequent npx invocation exited 127 without
starting tests. Physical dependency copies and the direct installed Playwright
CLI resolved the harness issues. The actual default production build and all
ten browser tests passed without source/configuration workarounds.

Counterfactual regression: restored only the original baseline smoke spec in
scratch against the same prebuilt db-read server. Both health cases failed on
the unexpected `detail` key: **2 failed / 2 passed**, 5.8s, exit 1. Restored the
updated spec byte-for-byte: db-read smoke **4 passed**, 4.3s; Sheet smoke
**4 passed**, 4.3s, both exit 0. These reruns used the same queued command with
only `tests/e2e/smoke.spec.ts` and `CS_E2E_PREBUILT=1`; store mode was changed
only between the separate db-read and Sheet runtime processes.

No user-visible interaction/layout change was introduced; T2/T3/T4 are not claimed. No hosted deployment, production smoke, live import/parity measurement, rollback rehearsal or phase flip occurred. Independent reviewer/CI remain coordinator work under the build-only/no-push instruction.

## Hosted migration prerequisite (read-only)

On 2026-10-24 UTC, Supabase list-projects/list-branches/list-migrations identified the approved shared Content/Replies project by its existing read-model and Google-auth migration history. Its recorded history has neither `20261024000100` / `content_authority` nor `20261025000100` / `content_writes`. A catalog-only SELECT returned all three booleans true: the authority schema-version table, public apply-patch RPC and private mutator RPC are absent. No row payloads, credentials, project identifiers or unrelated migration inventory are included here. No mutation SQL was issued.

There is **no disposable branch** on that project in the connected branch inventory. Therefore the specific T3 branch confirmation remains **not started**, not a pass. Current hosted metadata supports that the authority migrations are unapplied there; it cannot prove an unrecorded historic manual apply/drop, nor substitute for rechecking the actual disposable branch immediately before any future apply. No branch was provisioned and nothing was applied. The runbook makes this an explicit blocking prerequisite and requires a new forward migration if the edited originals were ever applied.

## Handoff and cleanup

The shared origin/main ref advanced during work to `9364427b62be94d0c01204e69ce396a9c112f1c2` (#178, image export). No fetch/rebase/merge was performed and unrelated main changes were not mixed into this build. Coordinator integration should account for that newer main before merge.

Final source/test restoration matched all 560 implementation-commit files.
Both synthetic ports (3290/3291) were closed after Playwright exited. The two
dedicated scratch roots, `D:/tmp/cs179-round1` and `D:/tmp/cs179-harness`, were
deleted and absence verified, including copied dependencies, build artifacts,
mutation helpers/logs and browser traces. Before recursive deletion, exact
absolute roots were checked and 431 dependency junction entries were removed
without recursion; a second check found no remaining reparse points. Read-only
scratch Git objects required clearing their scratch-only file attributes before
deletion succeeded. The real worktree node_modules remains the original readable
junction to the main checkout. No unknown Node process was killed.

The implementation is ready for independent review against #179, with the
disposable-branch migration prerequisite explicitly outstanding and no live
enablement claimed. GitHub CI, integration with newer main, and T3/live gates
were not run or marked green by this builder.

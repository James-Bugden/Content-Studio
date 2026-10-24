# CS-059b / PR #180 — fix round 1

- Classification / role: Standard / fix. Issue [#179](https://github.com/James-Bugden/Content-Studio/issues/179); review [6388910177](https://github.com/James-Bugden/Content-Studio/pull/180#issuecomment-6388910177).
- Branch: `cs-179-fu`, this worktree only. Starting local and remote head: `46e577ec9673ff254ff0077494fa29fa4031ad10`.
- Implementation commit: `153a553a0d049fae6b281d3f25aca2eead307b24` (`CS-059b: fix round 1: invalidate pending checks after imports`). This report is committed separately afterward.
- Read AGENTS.md, the supplied build handoff, MASTER-SPEC, issue/review, Phase C migration contract, ADR-0002 and the implementation/review/QA procedures.
- `git fetch origin` succeeded. `git rev-list --left-right --count HEAD...origin/main` initially returned `4 0`; `origin/main` remained `9364427b62be94d0c01204e69ce396a9c112f1c2`, already merged in the starting head. No additional merge was needed; no rebase occurred.
- Read-only GitHub inspection: `gh pr view 180 -R James-Bugden/Content-Studio --comments`, `gh issue view 179 -R James-Bugden/Content-Studio`, and `gh pr view 180 -R James-Bugden/Content-Studio --json headRefOid,baseRefName,state,statusCheckRollup`. Existing CI was green on the starting head; it does not verify this local fix.

## Findings addressed

**F1 / P3 / P4: fixed.** A successful mismatch check now remembers the latest committed import operation ID as well as the DB row version and Sheet revision. A completed import can therefore invalidate a check even when the row itself is unchanged. The PostgREST adapter requests just the latest operation ID (`select=operation_id`, `order=at.desc,operation_id.desc`, `limit=1`), without fetching import payloads/history. The fake publishes the identity atomically with a successful snapshot replacement; failed imports and operation replays do not advance it. Failure to read import metadata cannot reuse an old mismatch check.

P3 and P4 run in both fake and PGlite suites. They first warm the mismatch cache, revert the Sheet to the exact DB value, import, and prove the whole DB row stayed unchanged. P3 then proves the original copy/revision is served, the pending marker clears, and the next save succeeds. P4 proves clearing the refused `8/10` score back to blank clears the served score and pending marker. Get and list are each exercised as the first post-import read across the two cases.

The quota bound remains intact: a refused save followed by ten Library lists performs exactly one fresh Sheet read. Two further imports that still refuse the row each permit exactly one additional check across ten lists. Existing row-version-only, revision-only, replacement-save, stale-import and generic failed-read retry cases remain green.

**F2: fixed.** A pending authority check receiving `RATE_LIMITED` waits 60 seconds before another Sheet check, including across an import. The existing boundary does not expose Retry-After, so this is a fixed per-entry backoff. Other read errors remain immediately retryable. Both suites prove five lists make one provider read, the overlay remains at 59,999 ms, and a successful recheck retires it at 60,000 ms.

**F3: fixed.** Concurrent callers share one in-flight check per save entry. Both suites hold the provider read open while five lists enter, then prove one Sheet read and the correct overlay in every response. A replacement save has its own entry/promise; clearing an overlay still requires entry identity to match.

Updated the Phase C design and runbook cache descriptions. No schema, migration, environment default, production composition, dependency, lockfile or UI/layout change was introduced. F4 required no behavior change.

## Red-before-fix evidence

Tests ran only in external scratch `D:/tmp/cs179-fix1`, with synthetic data and an independent Git index. No install/ci command ran. Existing dependencies were reused; the missing locked PGlite 0.5.8 and Supabase packages came from an already available local dependency scratch tree. Initial package junctions were replaced by physical scratch copies for the normal Turbopack build; the worktree's shared node_modules junction was preserved.

Before implementation, this command ran against the original cutover implementation with the four new regression families:

```text
CS_TEST_MODE=unit bash ~/bin/heavy npx vitest run tests/unit/application/content-read-cutover.test.ts --maxWorkers=1 --silent
```

Expected RED: **8 failed / 79 passed**, 13.48 s, exit 1. P3 served `App save R1`; P4 served `8/10`; F2 retried too soon; F3 made five concurrent reads. Both fake and PGlite exposed every finding.

After strengthening F2 to inject persistent rate limits, the final tests were also run with only scratch's cutover implementation replaced by `git show 46e577e:src/application/content-read-cutover.ts`:

```text
CS_TEST_MODE=unit bash ~/bin/heavy npx vitest run tests/unit/application/content-read-cutover.test.ts --maxWorkers=1 --silent -t 'P3:|P4:|F2:|F3:'
```

Expected RED: **8 failed / 83 unselected**, 7.67 s, exit 1. Both F2 and F3 observed five calls instead of one. The fixed implementation bytes were restored in `finally`; later comparison of all 567 tracked files against the implementation commit found zero mismatches. Unselected cases in this focused red run are not claimed as passes.

## Final verification

Every Vitest, typecheck and Playwright/build invocation used the shared heavy queue. The entire repository test suite was never run. Commands below show the effective environment; PowerShell set the named variables before invocation.

```text
CS_TEST_MODE=unit bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase --maxWorkers=1 --silent
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
git diff --check
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
```

- Mandatory security + whole application + whole Supabase selection: **25 files / 440 tests PASS**, no skips, 58.49 s, exit 0. Includes health, boundaries, fake and real local PGlite SQL. Secret-scanner negative fixtures intentionally print synthetic findings; the scanner's tests pass.
- Typecheck and lint: PASS, exit 0. Private-path policy, actual repository secret scan and whitespace check: PASS.
- An earlier broad run had **2 failed / 437 passed** because two newly added transport cases passed arrays incorrectly to `it.each`; typecheck caught the same test declaration. The cases were changed to object-wrapped table rows, then all checks above passed. This was a test setup error, not a product pass. The corrected tests also verify malformed operation IDs are rejected.

```text
CS_E2E_CONTENT_STORE=db-read CS_E2E_PORT=3290 CS_COMMIT_SHA=153a553a0d049fae6b281d3f25aca2eead307b24
bash ~/bin/heavy node node_modules/@playwright/test/cli.js test tests/e2e/content-read-cutover.spec.ts tests/e2e/smoke.spec.ts --project=w375 --project=w1280
```

T1 PASS: **10 tests**, no skips, 1.2 minutes, exit 0, including the default Next production build and db-read health smoke at both widths. Build ID: `EFbPb7aKt0eEugByFgAEj`. These are existing synthetic browser journeys; the exact new P3/P4 cases are evidenced in fake and PGlite unit tests. No UI interaction/layout change was made; no new T2/T3/T4 claim is made.

Environment: Windows, Node 24.15.0, installed Next 16.3.6, Vitest 5.0.1, TypeScript 5.9.3, Playwright 1.63.0, PGlite 0.5.8. Installed Next/Vitest differ from manifest pins; locked CI remains required. No packages were installed or downloaded, and no shared package was changed.

## Handoff and limits

F1, F2 and F3 are addressed locally; no finding was skipped. The latest-import lookup adds one small DB metadata read to a pending verification call. The mismatch cache, backoff and in-flight promise remain instance-local and per save entry. A successful direct DB/overlay fingerprint match can retire the overlay without a Sheet read.

No push, GitHub write, merge, deployment, hosted SQL, live import, migration apply or phase flip occurred. PR/issue remain open. New-head CI and independent review are coordinator work under the explicit local-only fix instruction. The existing disposable-branch migration prerequisite and Phase C live gates remain outstanding and are not passes.

Cleanup: both synthetic listener ports 3290/3291 were closed after Playwright exited. The dedicated scratch root, including dependencies, Git index, build output, screenshots and test caches, was deleted and absence verified. A read-only inventory verified the exact resolved root, 31,999 files and zero remaining reparse entries. The initial recursive cleanup command was rejected by automatic policy before execution. Cleanup then succeeded using checked individual file deletion and nonrecursive removal of empty directories. The real worktree node_modules remains its original junction. No unknown Node process was killed.

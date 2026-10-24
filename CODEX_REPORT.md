# CS-045 / issue #126 build report, round 1

Date: 2026-10-24. Tier: Heavy. Branch: `cs-126-reads`.
Issue: https://github.com/James-Bugden/Content-Studio/issues/126
Implementation commit: `a3fa5ac665414fd89a4a0e9692335196658ce6bb`.
Base: `de41746e9397d2928c060fe5c9c3491a07847dd5`.
This subsequent report commit adds documentation only; tested application code
is identical to the implementation commit. No push, PR creation, deployment,
merge or issue closure was performed, per the build-only assignment.

## Changes and acceptance

- **PASS, concurrent reads:** one in-flight traversal per tab, including zero
  retention and a slow provider exceeding the TTL. Eight simultaneous Library
  reads now make one provider call on the small synthetic fixture.
- **PASS, invalidation:** writes continue to clear all cached tabs, including
  dependent Ready Queue data. Mutation precondition/readback reads bypass the
  cache and do not seed it; the next display read reaches the provider.
- **PASS, stale revisions:** an external edit hidden by the display cache is
  detected by a fresh pre-write read, returning `STALE_READ` with no write.
- **PASS, before/after evidence prepared for the PR:** see the table below and
  [read-path audit](docs/implementation/sheets-read-audit.md). No PR was opened
  because the assignment explicitly prohibits pushing.
- Audited every Sheet transport read path. Workflow Settings narrows A:Z to
  A:C; formatted-value-only callers omit formula/link fields. Full content rows,
  full-row revisions, duplicate-ID checks and bounded pagination remain intact.
- Schema header reads now emit existing `sheet.read` telemetry. The existing
  Sheet adapter Calls metric counts timed transport calls, excluding duplicate
  mutation-result events. Existing Errors/Conflicts count outcomes; that
  distinction is documented in the audit following independent review.
- No auth, validation, idempotency, conflict, provider write, or schema changes.
  Synthetic fixtures only. The existing live 60-second Library/readiness and
  3-second other-tab TTLs are preserved; tests also cover the issue's older
  15-second configuration.

## Fake transport counts before/after

Baseline is the branch base above. Each default synthetic tab fits in one page.
Backlog page reads are Library + Ready Queue + Schedule, matching the page loader.

| Scenario | Before | After |
| --- | ---: | ---: |
| One cold Backlog page | 3 | 3 |
| Two simultaneous Backlog pages, zero retention | 6 | 3 |
| Eight simultaneous Library reads, zero retention | 8 | 1 |
| Second page within configured live TTL | 0 | 0 |
| Second Library read while first remains pending beyond TTL | 2 | 1 |

A large Library still needs one provider call per bounded 500-row page: one
shared traversal is not a claim of one HTTP call for all 2,000 posts.

## Commands and results

All Vitest, TypeScript, lint, Playwright and Next build execution used
`bash ~/bin/heavy`, either directly or as children of a queued helper with the
queue lock inherited. No full Vitest suite was run.

1. `bash ~/bin/heavy npx vitest run tests/unit/google/sheets-read-cache.test.ts`
   before implementation: **expected red**, 9 failed / 9 passed. Failures proved
   duplicate reads (8 vs 1, 6 vs 3), pending expiry, completion TTL, invalidation,
   old rejection eviction, missing schema telemetry, double-counting and width.
2. `bash ~/bin/heavy npx vitest run tests/unit/google/google-transport.test.ts -t 'omits formulas' --maxWorkers=1`
   before the field-mask change: **expected red**, the one selected test failed;
   17 unselected tests were not treated as passes.
3. `bash ~/bin/heavy npx vitest run tests/unit/google/sheets-read-cache.test.ts tests/unit/google/sheets-repository.test.ts tests/unit/google/queue-repository.test.ts tests/unit/google/google-transport.test.ts tests/unit/google/drive-saga.test.ts tests/unit/application/reconcile.test.ts --maxWorkers=1`
   **PASS: 6 files, 114 tests**. Includes saves, named cells, formulas, schema,
   pagination, queue append, idempotency, partial failures and reconciliation.
4. `bash ~/bin/heavy bash tmp/checks-126.sh` ran these checks sequentially:
   - `npm run typecheck`: initially blocked by missing pre-existing dependencies
     in the shared install. Unlinked only this worktree's `node_modules` junction
     and ran `npm.cmd ci --ignore-scripts --prefer-offline` locally. Shared target
     and other worktrees were untouched; manifests/lockfile unchanged.
   - Rerun `npm run typecheck`: **PASS**.
   - `npm run lint`: **PASS**.
   - `npm run check:private` and `npm run check:secrets`: **PASS**.
   - `npx playwright test tests/e2e/backlog.spec.ts tests/e2e/editor.spec.ts tests/e2e/schedule.spec.ts tests/e2e/typefully.spec.ts --project=w1280 --grep 'REV-07|REV-08|two tabs|DRV-04|mismatch|viewer gets|CS-049|throttled Library|Content Library is the primary|editing a hook in place|SCHED-02|SCHED-03|TYPE-04|TYPE-05|provider failure'`:
     **PASS: 15 tests**, fresh `npm run build` and production server from this
     worktree, synthetic adapters. Covered Backlog rate-limit recovery, hook save,
     exact draft save, three-way comparison, two-tab conflict, partial-save retry,
     explicit reconciliation, viewer denial, approval, promotion/double confirm,
     exact Typefully sync, Typefully conflict and provider failure.
5. Independent reviewer: `claude -p --model opus --safe-mode --strict-mcp-config --tools 'Read,Glob,Grep' --allowedTools 'Read,Glob,Grep' --permission-mode dontAsk --no-session-persistence --output-format text`
   with committed diff and review task on stdin: **PASS, no blocking findings**.
   Opus independently inspected source/tests and traced acceptance, concurrency,
   invalidation, mutation safety, cost and privacy. It did not execute tests;
   execution results in this report belong to the builder. Its metric-outcome
   caveat is documented above; fake fault-injection concerns were retested by T1.
6. `bash ~/bin/heavy python tmp/adversarial-126.py`: **PASS after runner repair**.
   First attempt hit Windows console encoding while printing the first result;
   `finally` restored the source. The rerun forced UTF-8 output, then:
   - Changed implementation `if (fresh)` to `if (fresh && false)`. The selected
     `stale-revision validation` test **failed as intended**: mutation returned
     success instead of `STALE_READ`. Mutated SHA-256:
     `80dcc9f45e5d790f20355d63c98297bb0ff40a83ff09c9f8c858eb38c6416139`.
   - Disabled implementation pending-entry sharing (`hit.expiresAt === null`).
     The selected `a pending read is shared` test **failed as intended**, 2 calls
     instead of 1. Mutated SHA-256:
     `3f05b697ef190b7bf7a28262cb45056091e85f0d12e01d37a6db2a4978381ac1`.
   - Restored implementation byte-for-byte, SHA-256
     `0d7f7b366f022bebbc02901ac2c8679582badecb3a683aeeaebbc58db37a6024`.
   - Re-ran the complete cache regression file: **18/18 passed**. Each internal
     command was `npx.cmd vitest run tests/unit/google/sheets-read-cache.test.ts`
     with `--maxWorkers=1` and the applicable `-t` for each mutant.
7. `git diff --check`: **PASS**; no implementation diff remained after mutations.

## Limits and remaining work

No blocking implementation risks found. Cache scope remains per server process;
display reads can lag external edits until expiry. Mutation comparisons remain
fresh. Existing Sheets non-conditional-write atomicity and formula recalculation
limits remain as documented in [atomicity.md](docs/implementation/atomicity.md).
Counts are bounded per-instance logical transport calls, not individual HTTP
retry attempts. Fields/mapping and all mutation semantics are unchanged.

No new layout or interaction was introduced; T2/T3/T4 were not required for this
backend fix. Live-provider and deployed smoke tests were not run in this build
assignment. Required CI/full-suite/post-merge gates remain for the shipping stage;
they are not claimed green here. Build output and temporary review/test logs are
local ignored artifacts. The independent review is source verification, separate
from the builder's executed T0/T1 and adversarial evidence.

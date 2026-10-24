# CS-044 / issue #93 — build round 1

- Issue: https://github.com/James-Bugden/Content-Studio/issues/93
- Branch: `cs-93-work`; classification: Standard; role: build.
- Base / local `origin/main`: `bb40bcb49872ad5463069736b0cb662e7a4a468a`.
- Implementation SHA: `70a24e1a2830fcf07767207134b3d5a58120b375`.
- This follow-up commit adds the report only. Nothing was pushed; no PR,
  merge, deployment or issue closure was performed.

## Implementation

Next up derives its count using the same `splitTasks(...).now` selection as
"Do these now". Fix issues counts blocking reconciliation items only; any
unreadable source makes its total unknown. Existing read models publish these
small disposable totals alongside the shared repository, tied to the exact
Library/Schedule display-cache generations that supplied them.

The authenticated `/api/navigation-counts` endpoint only inspects cached
metadata. Cold, pending, failed, replaced, invalidated or older-than-15-second
source snapshots return null. It cannot invoke a model loader or provider.
Navigation omits null counts, preserves a genuinely known zero, hides previous
page totals while navigation is pending, and expires numbers in the browser.
Action pages retry a missing cached total twice at 500 ms to accommodate
streamed rendering; those requests also cannot spend provider quota.

The existing NavLink renders both sidebar and phone badges. Fix issues stays
inside the existing phone More disclosure. No mutation method, provider write,
write precondition, invalidation rule or normal read TTL was changed. Cache
entries gained a read-generation token solely for matching derived totals.
All fixtures and browser data are synthetic. No dependencies were installed.

## Acceptance status

| Criterion | Status / evidence |
| --- | --- |
| Sidebar and phone counts | Implemented. An earlier phone journey passed and its screenshot was visually reviewed. Final desktop/phone verification is **incomplete**, not green. |
| No added uncached Sheet reads | **Pass (unit and route tests).** Ten navigation reads add zero Sheet, Drive or Typefully calls; cold and expired lookups also add zero. |
| Unavailable count shows no number | **Pass (unit/component/route tests).** Covers missing snapshots, provider failures, incomplete report/board, expiry, mutation invalidation and pending navigation. Earlier browser failure-state journeys passed at both widths. |
| Derivation unit test and synthetic Playwright badge assertions | **Unit pass; Playwright assertions added, final T1 inconclusive.** |

## Commands and results

All Vitest, TypeScript, ESLint and Playwright commands used `bash ~/bin/heavy`.
Only the listed test files and targeted static-check inputs were selected.

```text
bash ~/bin/heavy npx vitest run tests/unit/navigation-counts.test.ts tests/unit/http/navigation-counts-route.test.ts tests/unit/components/navigation-counts.test.tsx tests/unit/google/sheets-read-cache.test.ts tests/unit/application/board-posts.test.ts tests/unit/application/reconcile.test.ts tests/unit/security/boundaries.test.ts
PASS: 7 files, 51 tests, final implementation (before commit).

bash ~/bin/heavy npx tsc --project tmp/tsconfig.cs93.json --noEmit
PASS: final implementation; temporary config extends the repository config,
disables incremental output and includes the changed source/test files only
(plus their imported dependencies and next-env.d.ts).

bash ~/bin/heavy npx eslint src/application/navigation-counts.ts src/application/board.ts src/application/reconcile.ts src/application/ports.ts src/integrations/google/sheets-repository.ts src/components/navigation-counts.tsx src/components/app-shell.tsx src/components/nav-link.tsx src/app/api/navigation-counts/route.ts tests/unit/navigation-counts.test.ts tests/unit/components/navigation-counts.test.tsx tests/unit/http/navigation-counts-route.test.ts tests/e2e/navigation-counts.spec.ts
PASS: final implementation.

node scripts/scan-secrets.mjs src/application/navigation-counts.ts src/components/navigation-counts.tsx src/app/api/navigation-counts/route.ts tests/unit/navigation-counts.test.ts tests/unit/components/navigation-counts.test.tsx tests/unit/http/navigation-counts-route.test.ts tests/e2e/navigation-counts.spec.ts docs/implementation/sheets-read-audit.md
PASS: clean, 8 files.

git diff --check / git diff --cached --check
PASS.

bash ~/bin/heavy npx playwright test tests/e2e/navigation-counts.spec.ts
BLOCKED: default Turbopack build rejects the existing node_modules junction
because its target is outside the worktree root.

bash ~/bin/heavy npx playwright test tests/e2e/navigation-counts.spec.ts --config=tmp/playwright.cs93.config.ts
bash ~/bin/heavy npx playwright test tests/e2e/navigation-counts.spec.ts --project=w1280 --config=tmp/playwright.cs93.config.ts
FINAL T1 INCONCLUSIVE: Next processes failed with ENOSPC / native allocation
and JavaScript heap failures. Later requests received connection resets/refusals.
```

The ignored temporary Playwright config spreads the repository config, uses
`testDir: '../tests/e2e'`, explicitly sets webServer.cwd to this worktree, and
replaces its command with
`npx next dev --webpack --port 3200 --hostname 127.0.0.1`.
It retains the existing synthetic environment and both viewport projects.

An earlier Webpack run passed 3/4 journeys: phone badges, phone failure state,
and desktop failure state. Desktop badge absence exposed timing/module-boundary
problems. Subsequent changes store totals on the shared repository, compare
primitive cache generations and retry only missing cached action-page counts.
Their targeted tests pass, but these final browser fixes still need a clean
browser retest. A later pre-final desktop run showed Next up 8 while Fix issues
was unavailable. These runs are not presented as a final acceptance pass.

T2: inspected the earlier synthetic 375 px screenshot: Fix issues 2 fits in More,
the tab bar fits, and the phone journey's nav axe/overflow assertions passed.
Full final-revision T2 remains incomplete. T3/T4 do not apply to this badge change.

## Adapter call-count evidence

`tests/unit/navigation-counts.test.ts` warms the real Sheets repository over
FakeSheetTransport with a 15-second TTL. Board + reconciliation uses seven Sheet
calls: three board tabs and four existing schema header checks; reconciliation
reuses Library/Schedule. It snapshots Sheet reads, Drive readText calls and
Typefully calls, performs ten cached navigation reads, expires the snapshots,
and asserts all three call counts remain exactly unchanged. Cold lookup starts
at zero reads. A separate route test invokes the actual GET handler and asserts
zero added reads, private/no-store headers and authentication. Existing mutation
invalidation is exercised without modifying the write implementation.

## Remaining risks / handoff

- Required final T1 and complete T2 remain unresolved. Re-run the committed
  Playwright file on a machine with adequate RAM/disk before accepting/merging.
  The final attempt filled C: and even temporarily prevented Git staging.
  Only generated cache files from this worktree were removed to recover space;
  other worktrees, shared dependencies and other agents' processes were untouched.
- Counts are best effort per server process and become available only after an
  existing board/reconciliation load. Cold instances and expired totals omit
  numbers. A different server instance may have no corresponding cached total.
- Navigation uses a conservative 15-second snapshot age despite the current live
  Library/Schedule display TTL being 60 seconds. It never refreshes providers to
  keep a badge visible. Same-page edits may leave the displayed total until its
  bounded browser expiry; subsequent navigation validates cache generations.
- Production build/deployment, full-suite CI and independent review were not run
  in this build-only round. Do not interpret this report as merge readiness.

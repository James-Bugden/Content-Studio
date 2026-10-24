# PR #165: fix round 2

Standard fix on `cs-93-work` in the assigned worktree. No push, deployment,
issue closure or other-worktree change was performed.

- Starting head: `a27e1aaa75114d985cb48af0dfd86961e85aa30c`.
- Fetched/merged main: `8e44fb721f3fbd5c98c0983325df214b586de181`
  (includes merged PR #166).
- Verified code/merge commit: `593613b3797d7fa69cc205514066c3ed5aa4cde9`.
  Its parents are the two commits above. This report is a separate child commit
  so it can identify the exact verified code SHA.
- Final synthetic production build: `0CrAujlGOqaMcdmRRsu7h`.

Read AGENTS.md, MASTER-SPEC.md, issue #93, PRs #165/#166, the Sheets read audit,
and the implementation, code-review and QA-regression procedures. Reviewed the
merged diff against both parents and the integration seams. No independent
review or deployed/live-provider verification is claimed.

## Merge resolutions

Executed `git fetch origin` followed by `git merge origin/main`. Git reported
two textual conflicts; the other expected overlaps merged automatically and
were reviewed semantically. Neither side was taken wholesale.

| File / overlap | Resolution |
| --- | --- |
| `src/application/board.ts` (conflict) | Combined #166's `requireSchedule` option and rethrow with #165's count clearing/publication. Calendar fails visibly when Schedule is unreadable; Library-only consumers retain their existing partial-data behavior, with an unknown count. |
| `src/application/ports.ts` (conflict) | Kept #166's `lastGoodLibrary` return shape `{ rows, readAt }` and #165's separate optional cache-only `navigationSnapshots` capability. |
| `src/integrations/google/sheets-repository.ts` (automatic merge) | Kept generation-bearing cache entries, stable generations for byte-identical completed reads, the original count expiry, and mutation invalidation. Kept the timestamped stale fallback return. An identical successful refresh updates the last-good read time without renewing an older derived total; failure advances neither timestamp. |
| `docs/implementation/sheets-read-audit.md` (automatic merge) | Retained both the stale first-render/age/retry contract and cache-only count evidence. Added the shared timestamp/generation behavior and `999+` display limit. |
| App shell, navigation and state/panel files | No textual conflict. Retained the navigation-only counts context boundary plus #166's server-decided read-only Backlog host, row action names, shared StateView/loading/error boundary, query-preserving Retry, and fail-visible Calendar. |

All incoming main changes were retained. The existing `999+` component and its
unit test remain intact. Added a browser test using synthetic endpoint totals
of 1,100: it asserts `999+`, badge containment inside its tab, viewport fit and
the Fix issues badge through More on a phone. Existing assertions are unchanged.

Added integration unit coverage for required Schedule failure clearing a known
count and for identical refresh generation/expiry coexisting with timestamped
stale recovery. Existing tests still assert zero added Sheet/Drive/Typefully
calls, unknown versus zero, pending/failed/changed reads, expiry and mutation
invalidation.

## Browser failure found and fixed

The first complete browser run had 79 passes and one desktop pagination failure
at `backlog-pagination.spec.ts:47`. The search field lost its entered text and
no search request was sent. The trace shows the fill occurring while the new
page's route JavaScript was still arriving; the final snapshot has an empty
search field. This is consistent with hydration resetting a controlled input.
Three unchanged desktop reruns passed, confirming its timing sensitivity.

Backlog search now uses the same `useSyncExternalStore` hydration guard already
used by the post editor. The server-rendered field is read-only until React can
retain input. It remains visually unchanged and adds no provider calls. The new
SSR/hydration regression fails on the old implementation (`readOnly` was false),
then passes with the fix and verifies that hydrated typing is retained. No
sleep, assertion weakening, increased timeout or retry was added to the specs.

## Verification

The worktree's shared dependency junction contains Next 16.3.6 and lacks required
Supabase/PGlite packages. Its queued typecheck failed for missing dependencies.
Verification therefore used a throwaway source COPY at `~/tmp/cs165-fix-r2`
with its own fresh `npm ci`; no install ran in the worktree. All 532 tracked
files were byte-compared with the copy after verification: zero mismatches.

Versions: Node 24.15.0, Next 16.4.1, React 19.3.0, Playwright 1.63.0,
Vitest 5.0.3. All data, failures and screenshots were synthetic.

Every typecheck, Vitest, build and Playwright command used `bash ~/bin/heavy`.
Only targeted unit/spec files ran. Playwright used one worker and zero retries.
The scratch-only `playwright.built.config.ts` spreads the repository config,
uses the separately built production server, disables server reuse and selects
port 32165 with matching base/server URLs. The initial port-3200 attempt was
blocked before tests because that port was already occupied; no process was
killed. One repeat launcher returned 127 without diagnostic before tests; its
queued rerun completed successfully.

Commands below ran in the source copy unless stated otherwise. The build used
the synthetic environment from `playwright.config.ts`. The complete queued
command runner and lint path list are preserved with the local evidence.

```powershell
bash ~/bin/heavy npm ci
bash ~/bin/heavy npm run typecheck
$lint = Get-Content D:/wt/briefs/cs/165-r2-lint-files.txt
bash ~/bin/heavy npx eslint @lint
bash ~/bin/heavy npx vitest run tests/unit/navigation-counts.test.ts tests/unit/components/navigation-counts.test.tsx tests/unit/components/app-shell-counts.test.tsx tests/unit/http/navigation-counts-route.test.ts tests/unit/google/sheets-read-cache.test.ts tests/unit/google/sheets-stale-read.test.ts tests/unit/google/sheets-repository.test.ts tests/unit/application/board-posts.test.ts tests/unit/application/backlog.test.ts tests/unit/application/backlog-readiness.test.ts tests/unit/domain/backlog-navigation.test.ts tests/unit/domain/backlog.test.ts tests/unit/domain/library-backlog.test.ts tests/unit/domain/library-backlog-sort.test.ts tests/unit/domain/library-backlog-totals.test.ts tests/unit/components/state-view.test.tsx tests/unit/components/backlog-search-hydration.test.tsx tests/unit/errors.test.ts --maxWorkers=1
bash ~/bin/heavy npm run build
$env:CI = '1'
bash ~/bin/heavy npx playwright test tests/e2e/navigation-counts.spec.ts tests/e2e/states.spec.ts tests/e2e/backlog-stale.spec.ts tests/e2e/backlog-pagination.spec.ts tests/e2e/calendar.spec.ts --project=w375 --project=w1280 --config=playwright.built.config.ts
bash ~/bin/heavy npx playwright test tests/e2e/backlog-pagination.spec.ts --project=w375 --project=w1280 --config=playwright.built.config.ts --grep '2,000 posts' --repeat-each=3
# Assigned worktree:
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
git diff --check
```

| Final check | Result / evidence under `D:/wt/briefs/cs` |
| --- | --- |
| Fresh dependency install | Exit 0; 464 packages installed, zero vulnerabilities; `165-r2-npm-ci.log` |
| Typecheck | Exit 0; `165-r2-typecheck.log` |
| ESLint on 62 touched TypeScript files | Exit 0; `165-r2-lint.log`, `165-r2-lint-files.txt` |
| Counts, stale/Backlog, cache, board, shared-state unit tests | 18 files, **165 passed**, exit 0; `165-r2-unit.log` |
| Production build | Exit 0; `165-r2-build.log`, build ID above |
| Five requested browser files at both widths | **80 passed** (40 per project), zero skips/retries, exit 0; `165-r2-browser.log` |
| Exact pagination/search case repeated at both widths | **6 passed**, 3 per width, zero skips/retries, exit 0; `165-r2-pagination-final-loops.log` |
| Hydration regression before fix | Expected failure, exit 1; `165-r2-hydration-before.log` |
| Source-copy identity | 532 tracked files, zero mismatches; `165-r2-source-parity.log` |
| T2 scoped visual review | Inspected phone/desktop capped navigation and stale phone inventory. Badge fits, stale timestamp/Retry are visible, editing is disabled. Stale specs also exercise 375/500/750/1280 widths and 200% zoom; accessibility/overflow assertions passed. Synthetic captures in `165-r2-final-test-results` and `165-r2-final-artifacts`. |
| Public repository policy and whitespace checks | Passed; rerun with the report before its commit. |

Issue #93 acceptance: sidebar and phone counts are evidenced; navigation adds
zero provider reads; unknown counts have no number; derivation, route, component
and synthetic browser assertions pass. #166's stale read-only first render,
age text, Retry filters, no editor/search/totals requests while stale, shared
states and Calendar Schedule failures pass their original targeted journeys.

## Risks and cleanup blocker

Counts remain best effort per server process and expire after their original
15-second lifetime. Repositories without snapshot capability show no number.
No full CI, live provider, deployment, T3 or T4 pass is claimed in this no-push
round. The initial browser failure and its trace are preserved in
`165-r2-initial-test-results`; final evidence was copied out before cleanup.

**Cleanup is blocked, not complete.** Automatic approval review rejected both
the validated cleanup command and a simpler literal absolute-path command:
`Remove-Item -LiteralPath 'C:\Users\jbbug\tmp\cs165-fix-r2' -Recurse -Force`.
Both rejections stated only **"blocked by policy"**. The exact resolved target
was verified as a regular source copy with a regular `node_modules`, no `.git`,
and no listening test server before the second attempt. No deletion safeguard
was bypassed and no unrelated Node process was killed. The scratch copy and its
dependencies therefore remain at `~/tmp/cs165-fix-r2` and still require removal.
The assigned worktree's original shared `node_modules` junction is unchanged.

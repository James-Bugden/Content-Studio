# PR #181 — fix round 1

2026-10-25. Standard; role: fix. [Issue #162](https://github.com/James-Bugden/Content-Studio/issues/162), [PR #181](https://github.com/James-Bugden/Content-Studio/pull/181).

## Exact identity and boundaries

- Started clean on `cs-162-ux`, local and remote `1a2b967b9e0c8b426c38a6b242fd09c321099834`.
- Initial `git fetch origin` found main at `9364427b62be94d0c01204e69ce396a9c112f1c2`, already included. A final fetch found new main `e33d43fbfcd86456a4a54e260b9d804b4bbd887d` (PR #180). `git merge --no-edit origin/main` merged it cleanly; no rebase.
- Fix commit: `01a796612a6de95529d4add2c92b3e0c4d50fed3` — `CS-059c: fix round 1: compose filters and scope sweep reads to documents`. Final verified merged code: `17fde4e32290444ac05ac2eab9b60ecf636bc660`.
- Final production BUILD_ID: `kUtAPeYzuhJL7juD7jYGs`, Next.js `16.4.1`.
- Sorted tracked TS/TSX path + NUL + file-byte SHA-256: `053531a995d374d07fcc871a76ddda210fe93c13fd54253993b6d07aaeba0e3f`. Scratch/worktree source comparison: zero mismatches after merging main.
- This report is a subsequent documentation-only commit. No push or GitHub write, deployment, issue closure, new dependency or lockfile change. No other worktree or shared dependency was modified.

Read AGENTS.md, the supplied builder brief, MASTER-SPEC.md, issue/PR state, implementation/QA procedures and the exploratory-sweep contract. GitHub access was read-only throughout.

## Findings and final fixes

**Ideas:** all five Queue fixture ideas target LinkedIn, in two source groups. The data-derived filter correctly has no X button. The spec now chooses LinkedIn, positively requires both groups before/after filtering, and requires every matching group to open.

**Posts disclosure:** Filters still exists. Its summary begins with a decorative arrow, so the old `^Filters` matcher missed the real DOM. The corrected matcher retains both closed-disclosure assertions.

**Product filter race:** the first real browser run then exposed a separate product failure at 1280: rapid platform/review clicks yielded only `?review=Pending`. FilterBar now composes against React optimistic query state inside a transition, after the dirty-editor guard. The regression holds the first RSC request, requires the platform chip to become selected, then clicks Review. Both URL dimensions must survive, and removing Review must preserve Platform.

**Sweep request ownership:** the complete CI artifact had exactly one finding: owner/1280 `/replies/resources`, pending `GET /api/navigation-counts` for 30 seconds. Content, title, fonts and busy/loading conditions were ready; it was not an auth assertion failure. Main run `40126153705` passed, but its detector was identical to the PR's: both `origin/main:tests/e2e/sweep-checks.ts` and `1a2b967:tests/e2e/sweep-checks.ts` have blob `2d0c1bae5aef794e01798336994758f3dc7090b4`.

The local isolated sweep reproduced that same finding and stale automatic-preview reads on Backlog. A deterministic regression then established the race: an old-document fetch can start after `navigate()` clears its inventory but before the replacement document commits. Chromium can omit its terminal event when the old document disappears, leaving the new view falsely busy. The regression fails with the original/main detector, showing the same 30-second pending-read diagnostic; it passes after the ownership correction.

`observe()` now resets old-document readiness reads at a main-frame document commit, armed only by a document navigation request. Failed document navigation disarms it. Ordinary history/RSC navigation does not clear current-document reads. The regression also holds a current-document read across a history change and requires readiness to reject it. Existing pending-read mutation proofs continue to reject held current reads at both widths. Console, HTTP, failed-request, auth, axe and keyboard checks retain their original strict rules, inventories and timeouts; no retry or allow-list was added.

The evidence supports correcting detector attribution for the Replies finding, despite the request's initial product-code diagnosis. Speculative Replies loading rollback and `keepalive` experiments did not fix it and were removed. Final application changes are limited to the confirmed filter-composition bug; Replies and scheduling application code remain as at the starting head.

## Real production-browser environment

Created an independent copy outside the repository with its own materialized node_modules. The shared junction was only read. Offline restoration reported `ENOTCACHED`; exact lockfile tarballs were reachable (Next tarball HEAD: HTTP 200). npm's existing `pacote.extract`, given lockfile URLs and integrity hashes, restored 38 missing/mismatched compatible packages in scratch. A version audit found zero compatible lockfile mismatches. No `npm install` or `npm ci` ran anywhere. No repository dependency was added or changed.

A scratch-only Git index was necessary because security/acceptance tests call `git ls-files`. Initial scratch policy checks failed without that metadata; a later scratch run caught a stale index entry for an experimental deleted file. The index was synchronized, experiments removed and all required directories rerun successfully on final source. Temporary hydration/request probes were never committed. All browser evidence uses a production build and repository Playwright configuration, not a dev server.

## Exact commands and results

All memory-heavy commands used the shared queue. Only the named unit directories/browser files were selected, never the full unit/browser suite. Commands below ran from scratch unless marked worktree. Environment settings shown were applied with PowerShell before invoking the command.

| Command | Result |
| --- | --- |
| `git status --short`; `git branch --show-current`; `git rev-parse HEAD`; `git fetch origin`; `git rev-parse origin/main` (worktree) | Expected clean starting state. Initial main already included; final fetch/merge details above. |
| `git merge --no-edit origin/main` (worktree) | Clean merge of new main `e33d43f`, producing `17fde4e`. Scratch synchronized and all final checks rerun. |
| `gh run view 40127846762 -R James-Bugden/Content-Studio --log-failed` (worktree) | Read the real shard 2/4 and sweep failures. |
| `gh run download 40127846762 -R James-Bugden/Content-Studio -n exploratory-sweep -D artifacts-162-round1-sweep` (worktree) | Read all failed `sweep.json` and aggregate rows; one CI finding. |
| `bash ~/bin/heavy node hydrate.cjs` | Offline attempt failed; exact-lockfile registry extraction passed: 38 restored, zero failures. Scratch-only script. |
| `CS_DATA_MODE=fake AI_PROVIDER=fake NEXT_TELEMETRY_DISABLED=1`; `bash ~/bin/heavy npm run build` | Final merged production build passed, exit 0. Log: `artifacts-162-round1-build-merged.log`. |
| `bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/components` | Final merged source: 376 tests, 33 files passed, exit 0, 23.54 s. Pre-merge also passed 354 tests. Log: `artifacts-162-round1-units-merged.log`. |
| `bash ~/bin/heavy npx vitest run tests/unit/supabase --maxWorkers=1` | 186 tests, 10 files passed, exit 0, 28.01 s. Added for merged main's updated read-path verification policy. Log: `artifacts-162-round1-supabase-merged.log`. |
| `bash ~/bin/heavy npm run typecheck` | Final merged source passed, exit 0. Log: `artifacts-162-round1-typecheck-merged.log`. |
| `bash ~/bin/heavy npm run lint` | Final merged source passed, exit 0. Log: `artifacts-162-round1-lint-merged.log`. |
| `CS_E2E_PREBUILT=1 CS_E2E_PORT=3362`; `bash ~/bin/heavy npx playwright test tests/e2e/ux-polish.spec.ts --project=w375 --project=w1280` | Initial selector/fixture corrections: 7 passed, 1 failed, exposing the real platform/review composition race. Log: `artifacts-162-round1-ux.log`. |
| Same environment; `bash ~/bin/heavy npx playwright test tests/e2e/ux-polish.spec.ts tests/e2e/navigation-counts.spec.ts tests/e2e/backlog.spec.ts tests/e2e/review.spec.ts --project=w375 --project=w1280 --output=test-results-final-ux` | Intermediate: 93 passed; 1 existing wide-table-only case skipped at 375. The skip is not a pass. Log: `artifacts-162-round1-browser-final.log`. |
| Same environment; `bash ~/bin/heavy npx playwright test tests/e2e/ux-polish.spec.ts tests/e2e/navigation-counts.spec.ts --project=w375 --project=w1280 --output=test-results-verified-ux` | Pre-merge fix: 14 passed, no skips, exit 0, 44.1 s. All 8 UX cases passed, including the two originally failing cases at both widths; axe/overflow assertions passed. Log: `artifacts-162-round1-browser-verified.log`. |
| Same environment; `bash ~/bin/heavy npx playwright test tests/e2e/ux-polish.spec.ts tests/e2e/navigation-counts.spec.ts tests/e2e/smoke.spec.ts --project=w375 --project=w1280 --output=test-results-merged-ux` | Final merged source/build: 18 passed, no skips, exit 0, 56.6 s. Both originally failing UX cases pass at 375 and 1280; axe/overflow checks pass. Log: `artifacts-162-round1-browser-merged.log`. |
| `CS_E2E_PREBUILT=1 CS_E2E_PORT=3402`; `bash ~/bin/heavy npx playwright test tests/e2e/sweep.spec.ts --project=sweep-1280 --grep 'document replacement' --output=test-results-document-ownership-baseline` | Negative control with the original/main detector: failed on the superseded pending read after 30 seconds. Earlier test construction deadlocked and was corrected before this negative control. Log: `artifacts-162-round1-ownership-baseline.log`. |
| Same environment; `bash ~/bin/heavy npx playwright test tests/e2e/sweep.spec.ts --project=sweep-375 --project=sweep-1280 --grep 'document replacement\|mutation proof: pending-read' --output=test-results-document-ownership-fixed` | 4 passed, exit 0, 8.9 s. Current-document held reads still reject readiness, including after history changes. Log: `artifacts-162-round1-ownership-fixed.log`. |
| `CS_E2E_PREBUILT=1 CS_SWEEP_ISOLATED=1 CS_E2E_PORT=3382`; `bash ~/bin/heavy npx playwright test tests/e2e/sweep.spec.ts tests/e2e/sweep-faults.spec.ts --project=sweep-375 --project=sweep-1280 --project=sweep-fault-375 --project=sweep-fault-1280 --reporter=list,./tests/e2e/sweep-reporter.ts` | Final merged source/build: 78 passed, no skips, exit 0; 2,620 passing rows, zero failed rows or report errors. 259,900 ms: above the unchanged 240-second warning target, below the unchanged 360-second ceiling. Runtime target is a warning, not a pass. Log: `artifacts-162-round1-sweep-merged.log`. |
| `node scripts/check-private-paths.mjs`; `node scripts/scan-secrets.mjs`; `git diff --cached --check` (worktree) | Clean before code commit; final report check results recorded below. |

Earlier sweep before the ownership fix: 73 passed, 3 failed, exit 1, 356,984 ms. It reproduced the original Resources wait plus Backlog preview waits; one fault project also recorded Chromium `ERR_NO_BUFFER_SPACE` on a font under local host contention. This run is not credited as a pass. The full corrected pre-merge sweep passed 78 tests and all 2,620 rows in 277,379 ms, with a reported runtime-budget warning. Other bounded investigations included a passing desktop owner sweep on the initial PR bundle (189 checks), two request-logging route probes, a loading-topology comparison, and failing held-fetch/keepalive experiments. None is substituted for the final merged sweep below.

## Acceptance evidence and remaining limits

- Scheduling: automatic preview still makes zero writes until explicit confirmation; final scheduling UX case passed at both widths.
- Filters: one-click selection/removal, positive two-group inventory and auto-opening, composed platform/review filters under a held navigation, and the dirty-editor guard are covered.
- T2: visually inspected synthetic Posts and expanded Ideas screenshots at 375 and 1280; selected chips and counts are readable, secondary Filters remains closed, groups open, controls wrap without page overflow. Final captures also cover scheduling, Backlog platform, Fix issues and navigation badges. Sweep covers real Tab traversal/focus, Escape, accessibility and browser diagnostics. The intermediate Review run additionally passed its existing keyboard/CJK/200% zoom checks at both widths.
- Final sweep covers owner/viewer/stranger routes, provider faults and all existing mutation detectors at both widths. `/replies/resources` and Backlog panel readiness pass. All 78 tests and 2,620 rows passed; the 240-second performance target remains an explicit warning (259.9 seconds locally with two workers).
- No post copy, credentials, live-provider data or production screenshot was used. No physical-device or production/deployment result is claimed. CI has not run this unpushed commit.

Final synthetic screenshots and sweep JSON are preserved locally under ignored `artifacts/162-round1/merged/`; earlier negative-control evidence is under ignored `artifacts/162-round1/verified/`. No artifacts or screenshots are committed.

## Cleanup blocker

The explicitly created scratch directory is `D:\wt\scratch-cs162-round1`. Read-only verification confirmed that exact resolved path, an ordinary directory, no reparse points and no remaining Node processes using it. Automatic approval review rejected `Remove-Item -LiteralPath 'D:/wt/scratch-cs162-round1' -Recurse -Force`, the guarded equivalent and a safer file-by-file/empty-directory cleanup attempt. Each rejection said only `blocked by policy`; no detailed reason was supplied. No rejected command ran, and no alternative bypass was attempted. **The scratch copy remains and needs deletion outside this runtime.** The shared node_modules junction and other worktrees remain untouched.

Final worktree policy checks: `node scripts/check-private-paths.mjs`, `node scripts/scan-secrets.mjs` and `git diff --cached --check` passed before the report commit.

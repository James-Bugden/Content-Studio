# PR #181 — fix round 2

2026-10-25. Standard; role: fix; final allowed round. [Issue #162](https://github.com/James-Bugden/Content-Studio/issues/162), [PR #181](https://github.com/James-Bugden/Content-Studio/pull/181), [independent review](https://github.com/James-Bugden/Content-Studio/pull/181#issuecomment-6388979458).

## Identity and boundaries

- Started clean on `cs-162-ux` at `3cce04a7b4a3e274abb7eedc70d9549cae85d763`, retaining the unpushed round-1 commits.
- Initial and final `git fetch origin` found main unchanged at `e33d43fbfcd86456a4a54e260b9d804b4bbd887d`. `git merge --no-edit origin/main` reported `Already up to date` both times. No rebase.
- Code commit: `14c992e71514c0a284995b807dee7cfcd6f433f9` — `CS-059c: fix round 2: exclude elapsed slots and unify promotion and filters`.
- Production build: Next.js `16.4.1`, BUILD_ID `dBpbLME4oGWtwidpd5VmO`.
- Sorted tracked TS/TSX path + NUL + working-file bytes SHA-256: `56f2ba6e48c5f9c24a675f8412dc727f5ca561ba6422698cb95729379732e62d`. Scratch/worktree comparison: zero differences. This report is a subsequent documentation-only commit.
- GitHub access was read-only. No push, GitHub write, deployment, issue closure, new dependency, lockfile change, or edit to another worktree. No live provider data or credentials were used.

Read the supplied policy, MASTER-SPEC, issue, review comments, round-1 report, implementation/QA procedures and exploratory-sweep contract. Work remained in the assigned isolated branch. No delegated agents were used.

## Review findings addressed

1. **Elapsed default slots:** extracted the board's existing wall-clock comparison to `isPastSlot`, shared by board and promotion context. The picker compares today with the planned policy time, including when the empty row has no Publish Time. It excludes elapsed options entirely. An injected clock at `2026-10-01T13:30:00Z` (21:30 Taipei) excludes October 1 at 21:00 and chooses October 3; an exhausted horizon has no preview or confirm. Board date/time reads also share one instant. The fake-only test-control clock now sets date and time; reset restores the normal fixture clock, and security tests prove the control remains absent outside synthetic e2e mode.
2. **Missing time label:** the shared label formatter omits the separator and time when there is no real HH:MM value. It never presents `No time`, `Not set`, `TBD` or a blank as a time.
3. **Full-page invalid selection:** `?slot=` must identify a usable listed option. Otherwise the page chooses the first usable option, reuses the existing “This slot cannot be used. Choose another slot.” copy, or shows the existing no-slot state without a confirm.
4. **Posts filters:** one FilterBar owns chips and disclosed controls, optimistic state, one count, one polite announcement and one clear action. Clear removes every managed filter together. The disclosure count includes chips while chip-only selection keeps the secondary controls closed. Removed the redundant no-match clear link and result-count live region.
5. **All no-op:** an unchanged filter value returns before navigation or the dirty-editor guard. An unselected All preserves `?page`.
6. **Preview failure/read/layout:** the panel read returns the earliest preview already computed from the same authoritative snapshot as its options; opening the panel now performs zero extra preview GETs. Manual choices still fetch fresh previews. The compatibility path without an initial preview tries the remaining defaults after a failed read; failed choices leave selectors usable. Request ordering still prevents late defaults replacing manual choices. A fixed-height preview area reserves space, scrolls only the cell list, and keeps confirm visible. Browser tests hold the preview and require the tab position to remain exactly unchanged.
7. **Coverage/mutations:** actual Next up page tests cover limited capabilities on success and failure and no warning when all are ready. All nine route fallbacks are tested for their title, loading announcement and hidden decorative skeletons. The time-sort fixture places the second slot earlier than Main on the same day. The confirmation test requires the same operation ID on retry, a new operation ID for new revisions, and cleared stale-result state. Removing the time tie-break (M6) and removing the panel confirm key (M14) each produces the intended failing regression; both changes were restored before final verification.
8. **Sweep timing:** analysis and final measurement below; no budget, timeout, inventory, detector or allow-list change in this round.

## Commands and results

Final commands ran in the independent scratch copy, except the explicitly marked worktree commands. Every test, typecheck and build used the shared heavy queue. Only named directories/files were selected; no full test suite ran. Logs and synthetic browser artifacts are retained under ignored `artifacts/162-round2/`.

| Command | Result |
| --- | --- |
| `gh pr view 181 -R James-Bugden/Content-Studio --comments`; `gh issue view 162 -R James-Bugden/Content-Studio` (worktree) | Read the requested independent review and assigned acceptance criteria. No GitHub write. |
| `git status --short`; `git branch --show-current`; `git rev-parse HEAD`; `git fetch origin`; `git rev-parse origin/main`; `git merge --no-edit origin/main` (worktree) | Clean expected starting state; main already included, including the final recheck. |
| `robocopy <shared-node_modules> D:/wt/scratch-cs162-round2/node_modules /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS`; `git archive HEAD`; copy current tracked/new source into scratch | Materialized dependencies and source outside the repository. The worktree's shared junction was retained. |
| `bash ~/bin/heavy node hydrate.cjs` | Scratch-only exact-lockfile extraction through npm's existing pacote: 29 missing/mismatched compatible packages restored. No install/ci. Existing cmd-shim recreated five scratch CLI shims. Both helper files were removed before final lint. Final audit: 469 compatible lockfile entries checked, zero mismatches. |
| `bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/components --maxWorkers=1` | First complete scratch run: 401 tests in 36 files passed, exit 0, 81.41 s. |
| `bash ~/bin/heavy npx vitest run tests/unit/application/schedule.test.ts -t 'orders by time before slot order' --maxWorkers=1` with M6 applied | Expected exit 1: same-day slots returned Main before the earlier second slot. Other tests were intentionally deselected, not credited as passes. |
| `bash ~/bin/heavy npx vitest run tests/unit/components/post-panel-scheduling.test.tsx -t 'uses the snapshot preview' --maxWorkers=1` with M14 applied | Expected exit 1: stale confirmation result persisted across new revisions. Mutation restored. Final complete positive run below. |
| `CS_DATA_MODE=fake AI_PROVIDER=fake NEXT_TELEMETRY_DISABLED=1`; `bash ~/bin/heavy npm run build` | Final source production build passed, exit 0. Log `artifacts-162-round2-build-final.log`. |
| `bash ~/bin/heavy npm run typecheck` | Passed, exit 0. Log `artifacts-162-round2-typecheck-final.log`. |
| `bash ~/bin/heavy npm run lint` | Passed, exit 0, no warnings. Log `artifacts-162-round2-lint-final.log`. |
| `bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/components tests/unit/supabase --maxWorkers=1` | Final source: 587 tests in 46 files passed, exit 0, 85.90 s. Includes the entire Supabase directory required for read-path changes. Log `artifacts-162-round2-required-final.log`. |
| `CS_E2E_PREBUILT=1 CS_E2E_PORT=3462`; `bash ~/bin/heavy npx playwright test tests/e2e/ux-polish.spec.ts tests/e2e/navigation-counts.spec.ts tests/e2e/panel.spec.ts tests/e2e/schedule.spec.ts tests/e2e/review.spec.ts --project=w375 --project=w1280 --output=test-results-round2-browser` | 66 passed, no skips, exit 0, 1.3 min. New UX cases include zero initial preview GETs/zero writes before confirm, 21:30 clock with a blank row time, exhaustion, full-page fallback, failed automatic preview, unchanged tab position and composed/cleared filters. Existing keyboard/Escape, CJK/200% zoom, revision-conflict, explicit-confirm and viewer checks passed. |
| `CS_E2E_PREBUILT=1 CS_SWEEP_ISOLATED=1 CS_E2E_PORT=3482`; `bash ~/bin/heavy npx playwright test tests/e2e/sweep.spec.ts tests/e2e/sweep-faults.spec.ts --project=sweep-375 --project=sweep-1280 --project=sweep-fault-375 --project=sweep-fault-1280 --reporter=list,./tests/e2e/sweep-reporter.ts --output=test-results-round2-sweep` | 78 passed, no skips, exit 0; 2,620 passing rows, zero failed rows or report errors. 250,770.258 ms, above the unchanged 240-second warning target and below the unchanged 360-second hard ceiling. Log `artifacts-162-round2-sweep.log`. |
| `node scripts/check-private-paths.mjs`; `node scripts/scan-secrets.mjs`; `git diff --cached --check` (worktree) | Clean before the code commit; final report checks recorded below. |

Preliminary failures are not credited: a queued unit attempt ran in the worktree against its pre-existing older/missing dependencies (310 tests passed, one suite failed to import PGlite); scratch's first npx attempt lacked a Vitest CLI shim and ran no tests; initial typecheck caught an invalid Testing Library `exact` option introduced in the new test; initial lint saw six errors in the temporary hydration helper. These were corrected, helpers removed and all final commands above rerun successfully. An earlier build also passed before the final refinement that keeps confirm outside the scrolling cell list; only the final build identity above is used for browser evidence.

## Click counts unchanged

Same counting convention as the original PR: each click/tap is one; a select costs opening plus choosing. Start signed in on the named surface. Scheduling and chips were exercised in the browser; unchanged review/fix flows retain the original code-path counts.

| Main flow | Before PR | After PR and after round 2 |
| --- | ---: | ---: |
| Schedule an approved post with panel open | 2 | 1 |
| Schedule from Next up Schedule action | 3 | 2 |
| Find Library Backlog post by platform | 2 | 1 |
| Find Ideas by platform across N source groups | 2 + N | 1 |
| Find Posts by target platform from closed Filters | 3 | 1 |
| Fix one issue via full-page action, one fix action, return | 3 | 3 |
| Review and approve from Next up | 2 | 2 |

## T2 and sweep runtime evidence

Inspected synthetic schedule-preview, past-slot and full-page fallback screenshots at 375 and 1280, plus Posts filters at both widths. The elapsed slot is absent, confirm names the future slot, the reserved preview keeps confirm visible, tabs retain their position, chips wrap and the count includes both chip selections. The full-page cell table retains its existing horizontal scroll region. UX specs require zero axe violations and no page overflow at both widths. This is Chromium emulation; no physical-device or production verification is claimed.

The previous complete sweep really took **259,900.104 ms**, not 240 seconds: a **19,900.104 ms overrun** of the warning target. Comparing this branch with current main shows **no added route inventory**: 27 routes, 162 load/auth visits across widths/roles. The sole added sweep test is the round-1 document-ownership regression at each width: **763 + 670 = 1,433 ms** of measured test time. It exercises `/replies/resources` and a held current-document read after a history transition. That test is useful regression coverage, not the cause of the whole 19.9-second overrun. The detector's event bookkeeping adds no deliberate wait to ordinary routes.

Previous measured test work totals 492,024 ms across two local workers: route project 375 = 128,501 ms; route project 1280 = 140,810 ms; fault project 375 = 106,434 ms; fault project 1280 = 116,279 ms. The four signed-in route sweeps alone took 197,450 ms in aggregate. These are per-test sums, not a reconstruction of wall time. The new UX journey file runs separately and contributes no time to the exploratory sweep. Local two-worker scheduling and existing route/fault work dominate; the evidence has no per-check timings with which to assign the remaining wall-time difference to one change. CI uses four workers, so its timing is not directly comparable.

The avoidable new work was the automatic extra preview GET on a Ready panel; this round removes it by returning the already-computed preview in the panel response. No measured wall-time speedup is claimed from that change alone. The 240-second target and 360-second hard ceiling remain unchanged. Final measurement: **250,770.258 ms**, 10,770.258 ms over the warning target, with all 78 tests and 2,620 rows passing. The runtime target remains a warning, not a performance pass. This single run is 9,129.846 ms shorter than round 1, but it does not isolate the cause of that difference.

## Cleanup and remaining limits

Preserved final browser images, sweep JSON/results, logs and BUILD_ID under ignored `artifacts/162-round2/`. The temporary mutation helper outside scratch was removed after copying it to the evidence folder. No test server listeners remained on ports 3462-3463 or 3482-3485, and no Node process referenced this scratch directory.

The exact leftover scratch directory is **`D:\wt\scratch-cs162-round2`**. An independent final walk verified zero junctions/symlinks, so there were no links to detach. The worktree's original shared `node_modules` junction was retained. Automatic approval review rejected the guarded PowerShell `Remove-Item -LiteralPath $scratchCleanupPath -Recurse -Force` operation with only **"blocked by policy"**. The command also checked the resolved absolute target and reparse inventory, but the entire command was rejected before execution. No deletion ran, no bypass was attempted, and the full scratch tree remains. This is the only cleanup blocker; it is not a failed correctness check.

No CI run, remote PR update, deployment or production smoke is claimed for these unpushed commits. Review scope is addressed locally; required remote CI still needs to run after an authorised push outside this task. No post-merge action or issue closure was attempted.

Final report checks: `node scripts/check-private-paths.mjs`, `node scripts/scan-secrets.mjs` and `git diff --cached --check` passed before the report commit.

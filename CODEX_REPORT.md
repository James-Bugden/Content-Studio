# CS-059g build report ? round 1

Code commit: `6ff6bea0e3bd56488b55f6bb97ee17b0ddefb26f`.
Base: `ab37596`, branch `cs-188-fu`, initially clean, equal to the local `origin/main` base.
Scope: Standard; build role; [#186](https://github.com/James-Bugden/Content-Studio/issues/186) items 1?6 and [#187](https://github.com/James-Bugden/Content-Studio/issues/187) items 1?6 only.
The GitHub read for PR #188 returned ?Could not resolve to a PullRequest?; no PR was created or changed. No push or GitHub write occurred.

## Delivered

| Item | Implementation / evidence |
| --- | --- |
| 186.1 / V03 | A one-shot ordinary AppError on a Library inventory read must leave later Library rows exporting. Widening duplicate-tab skip to every AppError fails the new test. Existing production guard already correct; test-only change. |
| 186.2 / V20 | Normal hand edits must retain the default direction advice and must not get equals advice. Both marker variants are pinned. |
| 186.3 / V14 | Every paginated request must send `Prefer: count=exact`; a premature empty page must refuse with `incomplete_read`. Latest-import single-row query continues to omit exact count. Existing transport already correct; test-only change. |
| 186.4 | Reconciliation retains existing equals recovery text and also displays existing direction advice, including a row with both a leading equals value and a hand-edited hook. The Sheet edit remains intact. |
| 186.5 | New `20261025000200_content_import_runs_at_index.sql`, sorted after all previous migrations, indexes `(at DESC, operation_id DESC)`. No old migration changed. Docs state it has never been applied live. It is unapplied to persistent databases; the sole execution here was in disposable in-memory PGlite. Catalog regression verifies both index keys. |
| 186.6 | `docs/ops/runbook.md` now explicitly carries OPEN owner/live gates for the 60 s rate-limit window, same-cell export race mitigation, and backup/restore across schema bumps. No live acceptance inferred. |
| 187.1 | One unified FilterBar polite announcement uses the existing result-count text for nonzero and zero results, replacing the applied-filter count on Posts. |
| 187.2 | No-results restores the existing ?Clear all filters? link, hides the duplicate toolbar clear, and resets lane plus all seven filters and pagination. Toolbar clear also resets lane; unrelated layout is retained. Existing dirty-navigation guards remain. |
| 187.3 | Selected chips use the existing dark primary button treatment and white text, with `aria-pressed` retained. |
| 187.4 | Both server preview and confirm reject an elapsed slot using the shared Taipei clock and planned slot time. Revision, Ready, owner and replay guards remain. Tests cover passing the time on the same day and passing the date, with zero writes. |
| 187.5 | Failed automatic preview retains its existing failure reason alongside the later usable slot. Warning-only preview uses natural height. Loading/success keep reserved height and a scrolling cell list, preserving tab position. |
| 187.6 | Unit regressions pin exact first usable preview/revisions, no initial preview for a non-ready post despite a valid slot plan, and optimistic rapid chip composition during a held transition. No production change needed for these existing guards. |

No features from #162 were introduced. No new server module or dependency was added. Default store remains `sheet`; live database modes stay refused. No live DB, Sheet, Drive, Typefully, deployment, credentials or environment configuration was changed.

## Verification

All memory-heavy commands ran through `bash ~/bin/heavy`, with Vitest limited to one worker and the requested directories. No install/ci command was run and no unrelated Node process was killed.

- `bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components --maxWorkers=1`: **51 files, 670 tests passed** on final code.
- `bash ~/bin/heavy npm run typecheck`: passed.
- `bash ~/bin/heavy npm run lint`: passed.
- `bash ~/bin/heavy npx playwright test tests/e2e/ux-polish.spec.ts --project=w375 --project=w1280`, with `CS_E2E_PREBUILT=1`: **16/16 passed**, both configured widths. Includes held navigation composition, unchanged tab position during preview fallback, no pre-confirm writes, result announcement and lane/filter clearing. The added spec is the only touched Playwright file; all its tests ran.
- `node scripts/check-private-paths.mjs`, `node scripts/scan-secrets.mjs`, and `git diff --check`: clean.
- Self-review examined actual diff, auth/revision/replay preservation, filtered count/clear states, mutation integrity and synthetic-only data. Independent review belongs to the separate review round.

Build identity: `jjvhMIQJ1DT1DiX7x9Pne`. Synthetic Sheet mode, fake providers, repository Playwright config, Chromium at 375 and 1280. All 15 final changed source/test/docs/migration files matched both scratch checkouts byte-for-byte before commit; a SHA-256 manifest is retained in local evidence.

### Red / green evidence and verification limits

Before fixes, the new tests failed for combined equals/hand-edit advice, expired confirmation, chip contrast, missing fallback reason and the Posts count announcement. Independently replaying the original page/filter/panel implementations with the final tests produced three additional reds: missing no-results clear link, lane retained by toolbar clear, and the fixed-height warning. Restoring the final implementations passed all ten page/panel component tests.

Test-only gaps (#186.1?3 and #187.6) already had correct production guards: their new tests turn red under the corresponding implementation mutations below. No intentionally broken production change was committed.

The first browser launch failed before tests because Turbopack rejected the external node_modules junction. Webpack fallback failed on an existing Replies client `node:crypto` import. A scratch-only Turbopack root of the common projects parent fixed resolver access. The production build then succeeded using `bash ~/bin/heavy npx next build`; the repository's `next.config.ts` was never changed, and its original copy was restored in scratch before final static checks/browser execution.

The first browser execution of the initial height fix had two real failures (both widths): the tabs moved between loading and successful fallback. The fix now reserves height for loading/success only; final full spec passes. Initial full-directory passes were 666 then 667 tests; the final 670 includes the added catalog and independently isolated component regressions. Additional final runs confirmed native exit **0** for both Vitest (670 tests) and Playwright (16 tests), because PowerShell redirection can mark native stderr as a shell error despite a green runner summary; this is exit-code verification, not flake acceptance.

**#187.7 real T2 visual review was not performed and is not claimed.** Synthetic screenshots/axe checks from T1 do not replace that assigned review. No hosted T3/T4, deployment smoke, production cutover or live query-plan/rate-limit/restore evidence is claimed.

## Mutation evidence

17 implementation mutations were caught (16 distinct checks plus the final warning-height refinement). Tests were not mutated. Each replacement asserted a unique match, changed the implementation SHA-256, ran the named targeted test, then restored original bytes and checked the original hash. Hash prefixes below identify the applied change; full hashes and failure logs remain in local evidence. Initial harness encoding/newline errors were corrected; they are not counted as killed mutants.

| Mutation | Original SHA-256 prefix -> mutant prefix | Result |
| --- | --- | --- |
| V03 | `53ed9f2dc00a` -> `67c97caa72d8` | killed |
| V20 | `53ed9f2dc00a` -> `82188a76a837` | killed |
| V14 | `1503dad417c6` -> `3aa949084c4f` | killed |
| both-advice | `fcdbb5c94196` -> `5c051b765864` | killed |
| first-preview | `c5c0c16e528c` -> `e8c622372d46` | killed |
| ready-preview | `c5c0c16e528c` -> `890c0e3bd320` | killed |
| count-live | `abaa69a39486` -> `e520c66a08b9` | killed |
| clear-lane | `abaa69a39486` -> `61b312d608e9` | killed |
| clear-empty | `92d539c21487` -> `a6d7c59e5f79` | killed |
| chip-contrast | `abaa69a39486` -> `cbbb01f33402` | killed |
| expired-confirm | `c5c0c16e528c` -> `5e956d6bcad6` | killed |
| expired-preview | `c5c0c16e528c` -> `ae9aece088cd` | killed |
| fallback-reason | `b2ab76c859c3` -> `79e008bd43e9` | killed |
| warning-height | `b2ab76c859c3` -> `6c28b03ef292` | killed |
| composition | `abaa69a39486` -> `790e42c01f1e` | killed |
| index | `5df0fb05496e` -> `e3c8b5dcf384` | killed |
| warning-height-final | `afce079deac4` -> `af2a0e641e7b` | killed |

## All added/changed user-facing strings

No ad hoc product wording was invented. These are the complete UI/runtime copy changes; documentation and test descriptions are not product strings.

| String | Change / source |
| --- | --- |
| `Showing {start} to {end} of {total}` with optional ` (filtered from {totalUnfiltered})` | Existing visible Posts count reused as its single polite filter announcement. Visible wording unchanged. |
| `None of the {totalUnfiltered} Library rows match these filters.` | Existing no-match detail reused as the zero-result announcement. |
| `No filters applied` / `{N} filter(s) applied` | Replaced on Posts only by the result text above; unchanged on other FilterBar users. |
| `Clear all filters` | Restored no-results action copy explicitly identified by #187.2. Existing toolbar `Clear filters` wording unchanged. |
| `This slot cannot be used.` | Existing panel fallback text reused for server elapsed-slot refusals and failed automatic preview explanation. Provider-supplied existing problems/message are preserved when available. |
| `Change authoritative value: use the normal audited DB patch to choose text without a leading equals sign, then retry export. See the cutover runbook.` | Existing text retained; now followed by the direction advice below rather than hiding it. |
| `Review the direction in the cutover runbook; no automatic overwrite.` | Existing default reconcile advice retained for ordinary mismatches and appended to equals recovery, separated by one space. |

## Click counts ? unchanged

Code paths and browser regressions retain the merged #181 counts: schedule an approved post **1 -> 1** explicit confirm; find a Library post by platform **1 -> 1**; Posts platform filter **1 -> 1**. Preview GETs do not write; no extra confirmation, selection click, auto-advance or bulk action was added. Clearing all filters/lane is one action.

## Cleanup and retained evidence

Both scratch node_modules junctions were inspected and detached **one at a time** using `System.IO.Directory.Delete` on the junction itself: first `../../cs188-mutation-scratch/node_modules`, then `../../cs188-verify-scratch/node_modules`. Both pointed at the existing `../163/node_modules` installation. Each junction path is now absent. A non-following scan after detachment found **zero remaining reparse points** in either scratch tree.

Automatic approval review rejected recursive scratch deletion as **?blocked by policy?**, without a more specific reason. A narrower explicit-path cleanup attempt was also rejected; no recursive delete ran. Exact retained scratch leftovers, relative to this worktree:

- `../../cs188-mutation-scratch/`: source/test copies only; no node_modules or other junction.
- `../../cs188-verify-scratch/`: source/test copies, generated `.next/` build/types/cache, and synthetic `test-results/`; no node_modules or other junction.

Additional intentional local evidence leftovers: `$TEMP/cs188-evidence/` (logs, scripts, manifest, mutation hashes, synthetic screenshots), `$TEMP/cs188-mutations/` (original duplicate mutation logs), and `$TEMP/next-panic-226ad222a0363544b008ed5f3b90b01.log` (failed initial resolver build). No scratch worktree was registered with Git. Browser-managed test servers exited; no listener remained on test ports 3200/3201.

The worktree node_modules junction to the main checkout was left intact. The existing complete dependency install used for scratch was read-only, including PGlite 0.5.8. No installed package was modified.

Local logs, full mutation hashes, source manifest, harness scripts and synthetic browser artifacts are intentionally retained under `$TEMP/cs188-evidence/`; these are not committed. No production screenshot or private content is included. The committed report is the durable review summary.

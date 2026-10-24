# PR #173 - fix round 1

Tier: Standard. Role: fix. Issue: #163. PR: https://github.com/James-Bugden/Content-Studio/pull/173

Validated final **code head**: `34833cf4496acc40ef8d673ca83a1279b0b2f3be`.
Synthetic production BUILD_ID: `P-2Q1lx2NiKYqByNissHu`; application source is unchanged
since this bundle was built. The evidence-only follow-up commit contains this
report and the sweep document; executable files match the tested code head.
Merged `origin/main` at `bdff565be7eca597f71e8870073e5aabdecdc8c5` into
`cs-163-sweep`, preserving both browser-server configurations and shadow parity
coverage. No rebase or other worktree operation.

All requested fixes are implemented:

1. The 240,000 ms target is separately recorded in JSON/Markdown, console and
   GitHub job summary, with a warning annotation on overrun. The isolated sweep's
   hard ceiling is 360,000 ms in the repository config. Tests pin reporter durations
   at the target boundary, a slight overrun and a 20% overrun without making timing alone
   fail completeness. Historical Ubuntu times/serial-path numbers are documented.
2. Each requested reporter gate has an otherwise-valid isolated regression,
   with a red scratch mutation for each gate (table below).
3. The documentation attributes #169 to main's #166.
4. `noWrites` checks accessible action names across the page, including external
   dialogs/portals, submit inputs, icon buttons, menu items and button-role links.
   Its proof exercises 23 action labels across seven surfaces. Disabled actions
   and read-only navigation are positive controls; every enabled mutation fails.
5. Final-code verification used the repository config: three full repeatable
   sweeps plus all 19 separate red detector runs. The helper records real Git SHA,
   BUILD_ID, execution time and wall time in its evidence.

The artifact's one-day retention/re-run limitation and plain `npm run test:e2e`
including all sweep projects are documented. All CI runners remain free
`ubuntu-latest`; no dependencies or installation commands were added/run.

## Final verification

| Run | Playwright execution (ms) | Command wall time (ms) | Tests / rows |
|---|---:|---:|---:|
| run-1 | 246,494.165 | 247,509 | 76 / 2,618 |
| run-2 | 239,585.778 | 240,363 | 76 / 2,618 |
| run-3 | 245,398.268 | 246,126 | 76 / 2,618 |

Every full run exited 0 with all 76 tests and 2,618 rows passing. Canonical
coverage/action SHA-256 (all three identical):
`6717505979037d0981f29fe82870f62339c642c33554d90d71a8ee8b473c11be`.
Runs 1 and 3 reported over-budget warnings and remained green.

Command: `bash ~/bin/heavy node scripts/verify-sweep.mjs`.
This invokes all four explicit sweep projects with `CS_E2E_PREBUILT=1`,
`CS_SWEEP_ISOLATED=1`, `CS_E2E_PORT=3263`, two local workers, no retries and the
repository Playwright config. Each deliberate red command selects one proof
with `CS_SWEEP_MUTATION=<name>`; status and failed-row identity are verified.
Overall helper status: `passed`.

| Deliberate red proof | Command wall time (ms) | Exit |
|---|---:|---:|
| load | 6,591 | 1 |
| pending-read | 5,257 | 1 |
| overflow | 5,118 | 1 |
| axe | 5,597 | 1 |
| tab-order | 5,265 | 1 |
| keyboard-trap | 6,125 | 1 |
| focus | 6,128 | 1 |
| escape | 6,142 | 1 |
| missing-state | 5,751 | 1 |
| unsafe-write | 14,297 | 1 |
| dead-end | 5,852 | 1 |
| data-loss-guard | 6,007 | 1 |
| pageerror | 5,464 | 1 |
| console-error | 5,628 | 1 |
| console-warning | 6,492 | 1 |
| hydration | 5,594 | 1 |
| requestfailed | 6,094 | 1 |
| router-requestfailed | 6,833 | 1 |
| http | 7,659 | 1 |

The unsafe-write run has 161 intended failed rows; all other red runs have one.
The new pending-read diagnostic contains `GET /api/sweep-pending`.

Reporter gate scratch mutations, re-run at the validated code head:

| Removed gate in scratch copy | Regression that goes red | Failed cases |
|---|---|---:|
| Attachment count | Two passed tests, one valid attachment | 1 |
| Report errors | Readable rows plus an unreadable attachment | 1 |
| Failed row | Passed test carrying a failed row | 1 |
| Per-test status | Skipped/interrupted tests carrying valid passing rows | 2 |
| Zero tests | Zero discovered tests with a retained synthetic row | 1 |

Command: `bash ~/bin/heavy npx vitest run tests/unit/.sweep-mutants-final --reporter=verbose`.
Observed expected-red result: exit 1, five failed files, six failed cases / 69 passed.
Each copy differed from the final reporter only at its named gate; its tests
matched the final tests except for the local import path. Scratch sources were
moved back under ignored `sweep-report/reporter-mutants/`, outside test discovery.
No scratch dependency install or node_modules tree was created.

Other successful checks:

- `bash ~/bin/heavy npm run build` (synthetic fake mode).
- `bash ~/bin/heavy npm run typecheck` (repeated after readiness change).
- `bash ~/bin/heavy npx vitest run tests/unit/sweep-reporter.test.ts tests/unit/application/board-posts.test.ts`: 24 passed.
- Targeted ESLint on changed config/scripts/sweep/reporter/unit files; `actionlint .github/workflows/ci.yml`.
- `node scripts/check-private-paths.mjs` and `node scripts/scan-secrets.mjs`.
- Queued Playwright `content-parity navigation-counts` across `w375`, `w1280`, `shadow-w375`, `shadow-w1280`: 10 passed, 25.3 seconds.
- Queued traced 1280 px owner-route + pending-read retest: two passed, 84,546.319 ms.

## Preserved failed attempt and limits

Before the readiness follow-up, head `4146c13d7b1945870b9f484c81d2ca791747268f`
passed two full runs (244,023.734 / 267,570.761 ms) but its third run failed
(278,572.141 ms): `/replies/resources` had one pending same-origin read beyond
10 seconds. Its other 2,615 rows passed. This is preserved as failed under
`sweep-report/validation-before-readiness-fix/`, not counted among the final
passes. The request identity was unavailable in the old count-only diagnostic.
The fix uses a bounded 30-second condition wait, adds request-path diagnostics
and proves a held request still fails; it adds no sleeps, retries, allow-list or
removed assertion. Three final full runs then passed identically.

Evidence paths (ignored, synthetic): `sweep-report/validation/`,
`sweep-report/validation-final.log`, `sweep-report/reporter-mutants-final.log`,
`sweep-report/unit-final.log`, `sweep-report/merge-journeys-round1.log`, and
`sweep-report/readiness-retest.log`.

No push, GitHub write, PR/issue mutation, remote PR merge, promotion/deployment,
dependency install, or other-worktree edit was performed. Git operations were
limited to the authorized fetch, local merge, commits and state/diff inspection.
Fresh Ubuntu CI/main/post-merge acceptance
is pending the owner's next remote workflow step. No new application UI was
changed in this fix round; no fresh T2, live-provider or physical-device claim.

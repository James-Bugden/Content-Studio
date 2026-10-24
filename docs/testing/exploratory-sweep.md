# Automated exploratory sweep (#163)

The `sweep-375`/`sweep-1280` route projects run `tests/e2e/sweep.spec.ts`; the
`sweep-fault-375`/`sweep-fault-1280` projects run `sweep-faults.spec.ts`. Both use
the same detectors in `sweep-checks.ts`. Existing journey projects exclude both.
CI runs all four groups on one free `ubuntu-latest` runner, with four workers,
one server process per group and no retries. The 240-second execution budget is
reported separately in JSON, Markdown, the job summary and an over-budget warning
annotation. It does not fail otherwise complete tests. Isolated sweeps have a
360-second hard global timeout in the repository Playwright config; timed-out or
incomplete tests still fail. This gives 50% headroom above the target, so ordinary
10–20% runner variance does not fail PR, main or weekly runs on timing alone.
This PC uses two workers to respect its 16 GB memory limit. Each file/project
remains serial; mutable fakes are never shared between workers. The
sweep reuses the synthetic production bundle already built by `verify`, downloaded
with the runner's existing GitHub CLI and a read-only automatic job token. No
repository secret or extra action/dependency is needed. Installation is a separate
preparation step. The existing browser
aggregate requires the sweep and all four journey shards to pass. The verified
`sweep-server` build artifact is retained for **one day**: re-running only failed
jobs on an older run fails at download. Start a fresh whole workflow run instead.

Plain `npm run test:e2e` also runs all four sweep projects, serially against the
shared Sheet server, alongside the journey and shadow-parity projects. Use the
explicit four-project isolated command below for repeatability measurements.
The journey shards select `w375`, `w1280`, `shadow-w375` and `shadow-w1280` to keep
the sweep separate while retaining main's Sheet/shadow parity coverage.

All accounts, provider adapters, edits and screenshots are synthetic. These
tests use the existing Playwright/axe dependencies and the existing fake-only
test-control/auth endpoints. They do not need account credentials.

## Coverage contract

The route inventory includes Next up, both Backlog views, both Posts layouts,
Ready, Calendar week/month/list, Published, Visuals, Fix issues, Login, all five
Replies pages, and representative post, slot, promotion, translation, image and
published details. Post and slot panels are visited through their query URLs.
Every route runs at both widths with owner, viewer and stranger identities.
Strangers must reach Login; signed-in visits to Login must reach Next up.
The development-only state gallery is outside the studio navigation and
intentionally contains a permanent loading state, so it is not a route target.
An inventory check fails if a primary navigation link or error code is added
without updating the sweep.

Each route checks successful navigation, visible/non-loading main content,
document overflow, all axe rules and impacts, actual Tab traversal, visible
focus, positive/negative tabindex mistakes, unreachable controls, Escape and
eight seeded safe random actions. Native radio groups contribute their selected
radio to the Tab inventory. Modal checks use the active dialog as their scope.
Seed 163 and DOM-order candidate lists make monkey action sequences reproducible.
Safe candidates are known internal route links, disclosures, search fields and
Tab/Shift+Tab/Escape. Save, approve, delete, publish, sign-out and discard actions
are outside that inventory. A separate dirty-draft journey verifies the real
navigation warning, Escape retention and external-Drive conflict comparison.

The fault matrix enumerates the entire `ERROR_CODES` vocabulary accepted by
test-control. Sheet-backed primary reads (owner and viewer), Drive text reads, Fix issues
aggregation, linked/unlinked Typefully reads and all three AI entry points have
explicit state expectations. An unavailable primary dataset cannot pass as
`empty`/`no_match`. Unsafe writes must be absent or disabled; AI failures must
leave manual editing available and must not manufacture translation proposals.
An unrelated secondary section (such as absent hook alternatives) may still use
its designated empty state while the AI operation displays its typed error.
Owner-only promotion refuses viewers before reading a provider. Drive failures use the editor's designated inline warning and disabled Save,
while Typefully uses its own provider-error panel. Reply-store faults are covered
by the separate Replies contracts; test-control cannot inject them. Sheet `meta`
is a no-op in test-control. The fake Drive text/byte reads return their own
metadata and no UI service calls its standalone `getMeta`; injecting `meta` into
that unused method cannot fail a page. Neither operation is credited as coverage.
Detailed cross-provider write/retry journeys remain in the existing editor,
Typefully and visual specs.

No application console warnings/errors, hydration diagnostics or page errors are
allow-listed. Two browser/framework diagnostics have narrow exceptions:

- Chromium's exact unused-preload performance warning for the three same-origin
  shipped Inter weights (400/500/600); individual routes need not use every weight.
- `net::ERR_ABORTED` on same-origin fetch GETs for known studio page paths, with
  both the RSC header and `_rsc` query marker. Next cancels superseded prefetch
  and panel-navigation streams even after a transition commits. API/document
  failures, non-page paths, HTTP errors and every other failure reason have no
  exception. A mutation with identical RSC markers on an API path must fail.

Chromium's generic HTTP diagnostic is allowed
only when its exact pathname and status match an explicitly expected fault
response actually observed by the browser. Unexpected same-origin HTTP errors
and failed requests fail the sweep. Assertions wait for conditions; no timing
sleeps or axe severity filters are used.

Readiness retains every condition, including completion of all observed
same-origin non-RSC fetch/XHR reads. It allows 30 seconds for a condition to
settle, within the existing per-test and global ceilings. A failed wait lists
pending request methods/paths rather than only their count. A held-read mutation
proves that an unresolved request still fails; the longer wait is not a bypass.

## Reports and detector mutations

The CI `exploratory-sweep` artifact contains `sweep-report/coverage.json`, a
Markdown coverage table, and failure screenshots under `test-results`.
JSON rows identify route, width, identity, check and result, with action sequences
or failure details. The report includes overall status and completed/expected
tests. Interrupted, skipped, empty and incomplete runs are failures.

Mutation proofs run the same production detectors against controlled broken DOM
or browser events. Each has a positive control before injecting the defect.
The proofs cover missing content, overflow, axe, tabindex, keyboard traps, focus,
Escape, missing fault states, enabled writes, dead ends, dirty-warning bypass,
page errors, console errors/warnings, hydration diagnostics, failed requests and
unexpected HTTP responses. Normal proofs pass only when the detector rejects
the mutation. The unsafe-write proof independently exercises 23 action labels
(including publish, delete, schedule, discard, retry, send and approve) on seven
surfaces: main, external dialog, body portal, icon button, submit input, menu item
and link with button semantics. Disabled actions and read-only Schedule,
Published and Retry links are positive controls. For an actual red Playwright run, select a proof and set
`CS_SWEEP_MUTATION` to its name; the failure is then deliberately uncaught.

Example commands on this PC (all heavy commands use the shared queue):

```bash
bash ~/bin/heavy npm run build
bash ~/bin/heavy node scripts/verify-sweep.mjs
CS_E2E_PREBUILT=1 CS_SWEEP_ISOLATED=1 CS_E2E_PORT=3263 bash ~/bin/heavy npx playwright test sweep --project=sweep-375 --project=sweep-1280 --project=sweep-fault-375 --project=sweep-fault-1280 --reporter=list,./tests/e2e/sweep-reporter.ts
CS_E2E_PREBUILT=1 CS_E2E_PORT=3263 CS_SWEEP_MUTATION=overflow bash ~/bin/heavy npx playwright test sweep.spec.ts --project=sweep-375 --grep 'mutation proof: overflow' --reporter=list,./tests/e2e/sweep-reporter.ts
```

Repeatability compares the complete JSON `rows` arrays from three consecutive
full runs, including monkey actions. Test durations are measurements and are
excluded from that equality check. A fixed seed alone is not evidence of three
identical runs. CI runtime and main-branch green status likewise require actual
CI evidence. Any real app defects found by the strict checks must have separate
issues; do not suppress their assertions to obtain a green sweep.

## Build-round evidence

At `70a702657b0efaafe5d8a770dbb53b86f451ec5f`, three consecutive local full runs
passed: 74 tests and 2,296 check rows each, in 266,979 / 271,299 / 263,808 ms
with two workers. Their canonical coverage/action SHA-256 was identical:
`76ef823870d44992eb532e94a81545f394bd04344673e82e8cfea586e1be9c7a`.
All 18 separate mutation executions returned exit 1 with their intended failed
check; `scripts/verify-sweep.mjs` recorded overall status `passed`.

[CI run 40113890423](https://github.com/James-Bugden/Content-Studio/actions/runs/40113890423)
passed all 74 sweep tests on one `ubuntu-latest` runner. The test command ran
from 16:59:19 to 17:03:11 UTC on 2026-10-24 (232 seconds); the whole job,
including installation and artifact upload, took 279 seconds. The four-minute
budget applies to sweep execution. This historical run predates the separate
budget warning and 360-second hard ceiling. A second reviewed CI run,
[40115328434](https://github.com/James-Bugden/Content-Studio/actions/runs/40115328434),
took approximately 225 seconds. Those 225–232 seconds consumed 93–97% of the old
240-second kill timeout (only 8–15 seconds spare). The serial 1280 px route file
included roughly 90 seconds for owner, 84 seconds for viewer and 28.5 seconds for
stranger. The new hard ceiling leaves 128–135 seconds above these observed runs;
the original 240-second target remains visible for performance follow-up.
Main-branch acceptance remains pending merge and post-merge verification.

Targeted board/reporter regressions passed (14 tests), as did the production
build, typecheck, targeted lint and workflow lint. Synthetic screenshot journeys
passed at both widths (32 images); rendered Replies, Published and Review were
inspected for layout and readable headings. This is Chromium emulation evidence,
with no physical-device or live-provider claim. Subsequent integration changes
must be reverified rather than inheriting these results.

## Findings included under the trivial-fix exception

- [#167](https://github.com/James-Bugden/Content-Studio/issues/167): repair heading
  levels and the Replies/forbidden-promotion page headings, preserving styles.
- [#168](https://github.com/James-Bugden/Content-Studio/issues/168): give Published
  copy regions unique labels and remove the redundant Typefully wrapper landmark.
- [#172](https://github.com/James-Bugden/Content-Studio/issues/172): Next up requires
  Schedule data through the shared board's `requireSchedule` option, as Calendar
  already does on current main. Their existing handlers show the typed recovery
  state; Library-only consumers retain their fallback. A targeted board regression
  proves the former false empty.

The shared error-identity correction is a separate change,
[PR #171](https://github.com/James-Bugden/Content-Studio/pull/171) for
[#170](https://github.com/James-Bugden/Content-Studio/issues/170), merged before this
sweep. It preserves the closed error-code vocabulary across Next server graphs.

The Ideas tab read-error handler tracked by
[#169](https://github.com/James-Bugden/Content-Studio/issues/169) came from main's
[#166](https://github.com/James-Bugden/Content-Studio/pull/166) (`8e44fb7`), not this
PR. It is exercised by the sweep without claiming its implementation here.


## Review round 1: final code evidence

Validated code head: `34833cf4496acc40ef8d673ca83a1279b0b2f3be`. Integrated `origin/main`
`bdff565be7eca597f71e8870073e5aabdecdc8c5` by merge, preserving both isolated
sweep servers and main's Sheet/shadow parity projects. Synthetic production
BUILD_ID: `P-2Q1lx2NiKYqByNissHu`. The follow-up evidence commit changes only this
document and `CODEX_REPORT.md`; application, tests, scripts and config match
this validated code head.

`bash ~/bin/heavy node scripts/verify-sweep.mjs` passed with the repository
Playwright config, two workers, four isolated servers and zero retries:

| Run | Playwright execution (ms) | Command wall time (ms) | Tests / rows |
|---|---:|---:|---:|
| run-1 | 246,494.165 | 247,509 | 76 / 2,618 |
| run-2 | 239,585.778 | 240,363 | 76 / 2,618 |
| run-3 | 245,398.268 | 246,126 | 76 / 2,618 |

All three complete coverage/action arrays have SHA-256
`6717505979037d0981f29fe82870f62339c642c33554d90d71a8ee8b473c11be`.
The 2,618 rows include 161 independent unsafe-write checks per width. Runs 1 and
3 exceeded the reported target and remained green; run 2 stayed within it.
These are local timings, not replacement Ubuntu CI measurements.

All **19 separate red Playwright executions** exited 1 with one failed test
and the intended `mutation/<name>` failed row. The helper independently checks
those conditions, not just the exit code. The changed held-read proof took
5,257 ms wall time; the expanded unsafe-write proof took 14,297 ms and rejected
all 161 label/surface combinations. Exact individual times and commands are in
`CODEX_REPORT.md` and ignored `sweep-report/validation/validation.json`.

The targeted reporter/board unit command passed 24 tests (15 reporter + 9 board).
Five uncommitted scratch reporter copies each had exactly one gate removed or
replaced. Their targeted unit run exited 1: five failed files, six failed
cases and 69 passing cases. The committed reporter stayed unmutated.

| Removed gate in scratch copy | Regression that goes red | Failed cases |
|---|---|---:|
| Attachment count | Two passed tests, one valid attachment | 1 |
| Report errors | Readable rows plus an unreadable attachment | 1 |
| Failed row | Passed test carrying a failed row | 1 |
| Per-test status | Skipped/interrupted tests carrying valid passing rows | 2 |
| Zero tests | Zero discovered tests with a retained synthetic row | 1 |

An earlier validation at `4146c13d7b1945870b9f484c81d2ca791747268f` passed
in 244,023.734 and 267,570.761 ms, then failed its third run (278,572.141 ms):
`/replies/resources` exceeded the old 10-second readiness deadline with one
pending read. Its other 2,615 rows passed. That failure is preserved under
`sweep-report/validation-before-readiness-fix/`; it is not counted as green.
The old diagnostic did not identify the request. The final code gives readiness
30 seconds, lists pending methods/paths, and adds the held-read mutation without
removing any readiness condition. The affected 1280 px owner route and the new
proof also passed a targeted traced retest (84,546.319 ms for both tests).

Production build, typecheck, targeted ESLint, actionlint, private-path and secret
checks passed. The merged Sheet/shadow parity and navigation-count journeys
passed 10 tests at both widths. No new dependency or account access was used.
No production UI change was added in this fix round; no new T2/live-provider or
physical-device claim is made. Fresh Ubuntu CI, main-branch acceptance and
post-merge verification remain pending; this read-only GitHub fix round did not
trigger CI or publish anything.

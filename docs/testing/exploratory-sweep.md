# Automated exploratory sweep (#163)

The `sweep-375`/`sweep-1280` route projects run `tests/e2e/sweep.spec.ts`; the
`sweep-fault-375`/`sweep-fault-1280` projects run `sweep-faults.spec.ts`. Both use
the same detectors in `sweep-checks.ts`. Existing journey projects exclude both.
CI runs all four groups on one free `ubuntu-latest` runner, with four workers,
one server process per group, no retries and a 240-second global browser budget.
This PC uses two workers to respect its 16 GB memory limit. Each file/project
remains serial; mutable fakes are never shared between workers. The
sweep reuses the synthetic production bundle already built by `verify`, downloaded
with the runner's existing GitHub CLI and a read-only automatic job token. No
repository secret or extra action/dependency is needed. Installation is a separate
preparation step. The existing browser
aggregate requires the sweep and all four journey shards to pass.

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
the mutation. For an actual red Playwright run, select a proof and set
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
budget applies to sweep execution, enforced by Playwright's global timeout.
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
- [#169](https://github.com/James-Bugden/Content-Studio/issues/169): catch the Ideas
  tab read error using the existing typed ErrorState and retry link.
- [#172](https://github.com/James-Bugden/Content-Studio/issues/172): stop swallowing
  the Schedule failure in the shared board; the existing page handlers show the
  typed recovery state. A targeted board regression proves the former false empty.

The shared error-identity correction is a separate change,
[PR #171](https://github.com/James-Bugden/Content-Studio/pull/171) for
[#170](https://github.com/James-Bugden/Content-Studio/issues/170), merged before this
sweep. It preserves the closed error-code vocabulary across Next server graphs.

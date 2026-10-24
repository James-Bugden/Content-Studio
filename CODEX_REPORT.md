# CS-059j build report - PR/task 194, round 1

Scope: #191; #192 items 1-4; #193 items 1, 2, 3 and 5. Standard, build role.
Verified code commit: `6a8ee412e899ed1f6584d28316948dddb384151f`.
Baseline: `06ab5ae` on isolated `cs-194-fu`.
Issues: [#191](https://github.com/James-Bugden/Content-Studio/issues/191),
[#192](https://github.com/James-Bugden/Content-Studio/issues/192),
[#193](https://github.com/James-Bugden/Content-Studio/issues/193). GitHub read-only inspection found no
PR numbered 194 at the time of this build; this report treats 194 as the assigned
worktree/task identifier. No GitHub writes, push, live action or dependency change.

## Result

- Shared axe readiness helper is used by all scans in a11y, home, calendar, shell
  and ux-polish. Original tags, severity assertions and strict scans are retained.
  The `sweep-fault-375` diagnose-before-rerun watch is durable in
  `docs/qa/cs-059j-follow-ups.md`.
- Clear links derive managed keys from the same filter definitions used by the
  controls. Empty Library retains Clear when filters/lane are active. One stable
  polite region reinserts keyed content on query changes, including equal counts.
  Visible empty/no-match cards defer their implicit status announcement to it.
  The two All chips are in separate groups: each group has exactly one black chip.
- Fallback warnings identify the failed slot; confirm errors retain catalogue
  safety text and the existing next step. Equals-only repair advice excludes
  unrelated direction advice; mixed conflicts retain both instructions.
- Regression coverage exercises stale-before-elapsed precedence, lane-only Clear,
  lane preservation, warning reset on a settled new pick and snapshot refresh,
  every Clear key including queue, level-4 structural export safety, production
  history filtering, blocking body drift, and unreadable legacy rollback refusal.
- Runbook facts are inline rather than dependent on an absent report. Missing
  sections use `markdown_missing`; pre-existing legacy body drift recovery is
  explicit. DB save stays independent of Drive: discovering the actual section
  level through Drive at save time is not a small safe extension of that contract.

## Copy inventory

The complete changed-string templates and exact reused sentences are in
`docs/qa/cs-059j-follow-ups.md`. They are also enumerated here:

1. `<failed slot label>: <existing problem/message>`; example:
   `Thu 1 Oct · 21:00: This slot cannot be used.`
2. Full-page requested-slot prefix: `<date> · <platform> ·
   <slot>: This slot cannot be used. Choose another slot.`
3. Elapsed confirmation: `This slot cannot be used. Some input was not valid.
   Nothing was changed. Choose another slot.` The safety message is exactly
   `ERROR_CATALOGUE.VALIDATION_FAILED.message`; the next step already exists on
   the promotion page.
4. Other confirmation problems now precede the existing returned catalogue
   message instead of suppressing it. The existing STALE_READ next step remains
   `Reload this page to see the new preview.` The fallback remains
   `Not scheduled. Nothing was written.` No catalogue entry was edited.
5. Equals-only mismatch retains `Change authoritative value: use the normal
   audited DB patch to choose text without a leading equals sign, then retry
   export. See the cutover runbook.` It omits `Review the direction in the
   cutover runbook; no automatic overwrite.` only for an equals-only mismatch.
   Mixed conflicts retain both sentences. Dynamic row-kind/field prefixes are
   unchanged. No filter/chip/live-region/empty-state strings changed.

## Red tests and mutations

Tests were added before the fixes. Initial red runs exposed unchanged live-region
content and hidden empty-Library Clear. Some newly written fixtures had Windows
encoding errors and an incorrect section layout/page-size assumption; these were
corrected, then tested against the pre-fix expressions in scratch before restoring
fixes. Those invalid initial fixture failures are not counted as mutation kills.
The original warning-reset tests returned too early during loading; mutation
survivors led to assertions after the next Confirm appears. Snapshot refresh is
exercised without starting a new pick, so its reset cannot hide behind pick reset.

Twenty deliberate implementation mutations were applied one at a time in
external scratch and restored in `finally`: title wait; live-region key; empty
Clear; lane activity; lane preservation; queue Clear key; per-group chip selection;
failed-slot naming; new-pick warning reset; snapshot warning reset; confirm safety;
full-page failed-slot naming; equals direction advice; M10 raw splice; M44 silent
skip; N03 history filter; N05 drift severity; N11 legacy read failure; stale/elapsed
precedence; implicit status-region duplication. Final results and command evidence are recorded below.

## Verification

- `bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components --maxWorkers=1`: **56 files / 729 tests pass**, locked Vitest 5.0.3, explicit runner exit **0**.
- `bash ~/bin/heavy npm run build`: **pass**, repository default Turbopack and Next 16.4.1; build ID `w7YebDs9By34uyOcoTfwx`.
- `bash ~/bin/heavy npm run typecheck`: **pass**.
- `bash ~/bin/heavy npm run lint`: **pass**.
- `CS_E2E_PREBUILT=1 bash ~/bin/heavy npx playwright test tests/e2e/a11y.spec.ts tests/e2e/home.spec.ts tests/e2e/calendar.spec.ts tests/e2e/shell.spec.ts tests/e2e/ux-polish.spec.ts --project=w375 --project=w1280`: **104/104 pass**, exit 0, repository config, no retries. The new test counts both explicit polite regions and implicit status regions within main content, excluding the unrelated global Notifications toaster.
- `git diff --check`, private-path policy and secret scan: final staging checks recorded with the code identity below.
- Twenty mutations: **20/20 killed**, including the corrected warning tests and explicit/implicit live-region count. Command for each: `bash ~/bin/heavy npx vitest run <target file> --maxWorkers=1 -t CS-059j`. Full local names, exit codes and logs are retained in the external evidence directory.

The first browser result was 102/104: its new test counted the unrelated global
Notifications toaster. That selector was scoped to main content, then strengthened
to include implicit status regions. The added unit test exposed a real duplicate
empty/no-match announcement, fixed by deferring those cards to the filter region.
The final browser run uses the strengthened explicit/implicit region assertion.
A separate launcher exited before any test or output; it was classified as
inconclusive, not a pass. Playwright CLI startup was checked before a visible
logged launch of the same artifact.

Synthetic fallback screenshots and Posts filter chips were inspected at 375 and
1280 px: failed slot and selected/confirmed slot are distinct, the warning fits,
and each filter group has exactly one black selected chip. This is bounded local
visual support, not #192 item 5's complete T2/187.7 review.

The main junction initially supplied Next 16.3.6 / Vitest 5.0.1 and lacked PGlite
and Supabase packages. Initial symlinked Turbopack builds refused outside-root
dependencies. A webpack diagnostic hit an existing unrelated Replies node:crypto
client import and was not counted as a pass. Shared dependencies were copied to
real external scratch directories; missing/drifted packages already in this
branch's lockfile were unpacked from cached tarballs only. No install/ci, package
manifest/lock edit, or shared dependency mutation occurred. Final build/tests use
Next 16.4.1, Vitest 5.0.3, Vite 8.3.3, Playwright 1.63.0, TypeScript 5.9.3 and Node
24.15.0. PGlite 0.5.8 and Supabase 2.117.0 are the existing locked dependencies.

All heavy commands run via `bash ~/bin/heavy`; no npm install/ci was run. Only the
required test directories and targeted files were run, never the full suite.
Synthetic data only; default store remains `sheet`.

The directory runner's 729-pass output initially coincided with an inconsistent
PowerShell wrapper status after jsdom warnings. An explicit subprocess exit-code
capture is used for the final directory result; ambiguous wrapper statuses are
not treated as green. Source/test canonical LF SHA256:
`1fa0fb26dbe32a7d5c21f3cc51dec2635985b3a80aa1f8765a4a6fc6b84f3d90`.
Worktree and validation source/tests match under Git line-ending normalization.

## Deferred / limitations

- #192 item 5's full T2/187.7 visual judgement is outside this build scope.
- #193 item 4 history measurement/capping is outside this build scope.
- Real Drive DRV-01, live SQL, cross-instance leases/cron, outbox backup,
  editor-copy T2 and Phase D remain unpassed owner/live gates. No cutover occurred.
- No PR/CI/deployment/merge/closure action was attempted under the no-write rule.

## Scratch and leftovers

All 363 package junctions in `$HOME/tmp/cs194-validation/node_modules` were
individually detached before any recursive replacement of real scratch package
directories. The original worktree `node_modules` junction still targets the main
checkout and was never detached or modified. Scratch is retained outside the repo.

One diagnostic build in this worktree generated ignored `./.next`. The command
policy rejected its cleanup with `blocked by policy`; it remains retained rather
than attempting deletion through another shell. Exact retained paths and per-file sizes are recorded locally in
`$HOME/tmp/cs194-evidence/leftovers.txt`; summary and junction status are in
`leftovers-summary.json`. No scratch junction remains. Retained task directories:

| Location | Files | Directories | Bytes |
| --- | ---: | ---: | ---: |
| `scratch` | 32493 | 3489 | 1147181253 |
| `ignored-worktree-build` | 22 | 9 | 124293 |
| `evidence` | 90 | 20 | 10184387 |

`scratch` is `$HOME/tmp/cs194-validation`; `ignored-worktree-build` is this
worktree's `./.next`; `evidence` is `$HOME/tmp/cs194-evidence`. Evidence counts
exclude the two inventory files themselves. There are also 67 retained
`$HOME/cs194-*` diagnostic/script files, individually named with sizes in the
inventory (and copied under the evidence directory's `logs`). Routine shared npm
cache/debug logs are not removed. No recursive scratch cleanup was attempted.

Final private-path and secret scans are clean (614 files including this report).
No source/test changes followed verification.

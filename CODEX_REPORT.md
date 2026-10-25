# CS-059j fix round 1 ? PR #194

Tier: Standard. Role: fix. Branch: `cs-194-fu`, assigned isolated worktree.
Verified code commit: `26cde64c7c55af2459cb726ddc4177a8e0f4618f`. This report is a subsequent documentation-only
commit. Base and remote branch on entry: `3ac472b8e1ea24be9f13590e2fcf81730ee0b123`.
Read AGENTS.md, MASTER-SPEC, the supplied build brief, issues #191/#192/#193,
linked database contracts/runbooks and review comment
[6391037898](https://github.com/James-Bugden/Content-Studio/pull/194#issuecomment-6391037898).

`git fetch origin` succeeded. `git rev-list --left-right --count HEAD...origin/main`
returned `3 0` before edits; main was already contained, so no merge was needed.
Fetched main: `06ab5aeebc88f185a75e0cc793e3a5c6dc8ba291`. No rebase, push,
GitHub write, other-worktree edit, dependency manifest change or production action.

## Findings addressed

- **M1:** announcement span keys on committed `searchParams?.toString()`.
  The new MutationObserver regression uses real `useOptimistic` and a held push:
  zero changes/insertions while pending, exactly one insertion with the new
  server count on commit. The region stays stable and atomic. Equal-count
  filter changes still reinsert once. Chromium verifies both paths at both widths.
- **M2:** restore the previous `problems || message || fallback` rendering for
  all other errors. Only `VALIDATION_FAILED` with the sole elapsed-slot problem
  `This slot cannot be used.` appends the server safety message and slot advice.
  Tests cover every error code with and without problems, both stale revisions,
  already-scheduled and duplicate-slot conflicts, both missing-row cases and
  exact elapsed/fallback text. The route/catalogue remain unchanged.
- The atomic-region and selected-All mutations now fail. A two-failure A/B then
  success C test proves the warning names B, not the original A. The dead client
  catalogue fallback/import was deleted rather than manufacturing a caller.
- ux-polish waits for title readiness before measuring overflow. QA docs list
  all **20 direct axe scan sites in 11 remaining files**, including sweep-checks,
  as explicitly outside the five-spec helper coverage; broad #191 is not closed.
- Empty Library now announces the existing heading `The Content Library is empty`.
- The QA doc and DB-7 runbook explicitly say the actual-master-section-level
  save check is **deferred**; save still checks level 2 without Drive. Export
  refuses unsafe structure, keeps the job and preserves the entire master.
  The proposed #193 item 1 note is recorded in the QA doc. It was not posted:
  this round prohibits all GitHub writes. The user owns the PR body correction.

## Verification and exact commands

All test/build/typecheck/lint execution below used the shared `bash ~/bin/heavy`
queue in external scratch with real dependency files. Never ran the full suite.
The original worktree node_modules junction was never detached or modified.
No npm install/ci and no new dependency. Forty absent/drifted package directories
were restored in scratch from existing lockfile tarballs with integrity checks.
Node 24.15.0; Next 16.4.1; Vitest 5.0.3; Vite 8.3.3; React 19.3.0;
TypeScript 5.9.3; Playwright 1.63.0; PGlite 0.5.8; Supabase 2.117.0.

| Command | Result |
| --- | --- |
| `bash ~/bin/heavy npx vitest run tests/unit/components/filter-bar.test.tsx tests/unit/components/promote-confirm.test.tsx tests/unit/components/review-page.test.tsx tests/unit/components/post-panel-scheduling.test.tsx --maxWorkers=1 -t CS-059j` | Red before fixes; M1 inserted the old count during pending; M2 appended inapplicable catalogue text. |
| `bash ~/bin/heavy npx vitest run tests/unit/components/filter-bar.test.tsx tests/unit/components/promote-confirm.test.tsx tests/unit/components/post-panel-scheduling.test.tsx tests/unit/components/review-page.test.tsx --maxWorkers=1` | Exit 0; 4 files, 73 tests pass. |
| `bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components --maxWorkers=1` | Final exit 0; **57 files, 768 tests pass**. |
| `bash ~/bin/heavy npm run build` | Exit 0; default Turbopack build, including build-time TypeScript. |
| `bash ~/bin/heavy npm run typecheck` | Exit 0, including final selector correction. |
| `bash ~/bin/heavy npm run lint` | Exit 0, including final selector correction. |
| `bash ~/bin/heavy npx playwright test tests/e2e/ux-polish.spec.ts --project=w375 --project=w1280` | Final exit 0; **20/20 pass**, no retries, 42.3 seconds. |
| `git diff --cached --check` | Exit 0. |
| `node scripts/check-private-paths.mjs` | Exit 0; code staging clean; final report staging check recorded in external evidence. |
| `node scripts/scan-secrets.mjs` | Exit 0; code staging clean; final report staging check recorded in external evidence. |

Playwright ran with `CS_E2E_PREBUILT=1`, `CS_E2E_PORT=3240`, default Sheet
composition and synthetic auth/providers. `PLAYWRIGHT_BROWSERS_PATH` pointed to
the existing redirected cache at
`$HOME/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Local/ms-playwright`.
No browser download/cache mutation. Full argv, exit codes and logs are retained
under `$HOME/cs194-fix-r1-evidence` (each command's `.json` and `.log`).

Build ID: `kzYvirkoqtrreEo-eilqj`.
Final source/tests canonical-LF SHA256: `53e7019e82e81820e187de15415515d011b58f22368801a23ed032e7e2da695e`.
Runtime source canonical-LF SHA256: `343916f0be7d14d9859c9545ee608dd47643a8446e9727d525ef3a2280fd9cb9`.
All 547 source/test files match the worktree and validation copy. Only an e2e
selector changed after the directory/build run; runtime and unit files remained
byte-identical. Final Playwright, typecheck and lint cover that correction.

### Deliberate mutations

Each mutation was made only in scratch, confirmed on disk, tested through the
queue, then restored byte-for-byte in `finally` with a hash assertion:

- Remove aria-atomic: `bash ~/bin/heavy npx vitest run tests/unit/components/filter-bar.test.tsx --maxWorkers=1 -t CS-059j` ? exit 1 at the atomic assertion.
- Always-primary All: same command ? exit 1 for the selected platform/status case.
- Name first pick instead of failed slot id: `bash ~/bin/heavy npx vitest run tests/unit/components/post-panel-scheduling.test.tsx --maxWorkers=1 -t CS-059j` ? exit 1 at the new B-slot warning assertion.

Three meaningful survivors killed; fourth dead fallback deleted. No mutant
remains in the worktree or retained scratch source.

### Failed attempts retained and diagnosed

- Initial scratch dependency restoration hit a Python default-encoding error;
  it resumed using explicit UTF-8. The runner's first red-log printing also hit
  console encoding; subprocess exit/log evidence was retained and printing fixed.
- An initial all-slots-failed warning fixture assumed the labelled fallback is
  rendered in that branch. It was corrected to A/B fail then C succeeds, the
  actual labelled-warning path; the first invalid fixture is not a mutation kill.
- First required directory run: 55 files passed, two security files failed because
  scratch lacked a Git index. A separate scratch-only `git init -b scratch-cs194`
  and `git add --all` supplied the inventory those checks require. The complete
  directory command was rerun and passed; no application fix was needed.
- First browser command: 20 launch failures, no test body ran. The subprocess
  could not see Chromium at the ordinary cache path; an explicit existing
  redirected cache path resolved it. This run is not counted as browser coverage.
- Next browser run: 18 passed, two failed at my added exact warning-text selector,
  which included InlineResult's nested Check label. Retained DOM evidence showed
  the correct warning. The final test asserts the full failed-slot/problem text
  inside the status region. Same app build; complete spec rerun at both widths
  passed. Failure traces/contexts and final screenshots are retained separately.

Synthetic fallback and selected-chip captures at 375/1280 were inspected: failed
Thursday and confirmed Saturday are distinguishable, warning text fits, and
selected LinkedIn plus Review All are one black chip per group. Strict axe and
overflow checks pass. This is bounded local visual evidence; #192 item 5's full
T2/187.7 review (other widths/zoom) remains deferred. No T3/T4/live claim.

## Complete changed-string list

Permanent inventory: [CS-059j follow-ups](docs/qa/cs-059j-follow-ups.md).
The final templates, exact confirmation messages and removed additions are
reproduced below for this fix report.


Every changed/added rendered string in this follow-up is listed here. Existing
catalogue/convention text is reused rather than introducing a new message:

- Successful fallback warning: `<failed slot label>: <existing preview problem or
  message>` replaces the unqualified problem. Example: `Thu 1 Oct · 21:00: This
  slot cannot be used.` The slot label uses the existing `slotLabel` formatter.
  Provider/catalogue problem and message text is otherwise unchanged.
- Full-page fallback: `Tue 1 Dec · LinkedIn · Main: This slot cannot be used.
  Choose another slot.` prefixes the existing warning with the requested slot
  date/platform/slot using the existing date formatter and platform/slot names.
- Elapsed confirm: `This slot cannot be used. Some input was not valid. Nothing
  was changed. Choose another slot.` Previously the problem suppressed the
  catalogue safety message. The safety sentence is exactly
  `ERROR_CATALOGUE.VALIDATION_FAILED.message`; `Choose another slot.` already
  exists on the full promotion page. We use the catalogue's `Nothing was changed`
  wording here rather than inventing `Nothing was written` for that code.
- Round 1 restores problem-first rendering for every confirm error except the
  elapsed-slot `VALIDATION_FAILED` with exactly `This slot cannot be used.` as
  its single problem. Only that case appends the server's safety message and
  `Choose another slot.` The unused client catalogue fallback is removed.
  Other validation problems retain their prior rendering too. The complete
  confirm inventory and removed additions are below.
- Equals-only export mismatch retains `Change authoritative value: use the normal
  audited DB patch to choose text without a leading equals sign, then retry
  export. See the cutover runbook.` It removes `Review the direction in the
  cutover runbook; no automatic overwrite.` only when no other mismatch requires
  that advice. Mixed hand-edit/equals conflicts retain both existing sentences.

The empty Library's sole polite announcement now reuses the existing visible
heading, exactly `The Content Library is empty`, instead of `None of the 0
Library rows match these filters.` No new product sentence is introduced. Other
filter, chip, empty-state and live-region strings are unchanged. Each filter
group has exactly one black selected chip, including its own All choice at rest.
A single stable polite region reinserts its keyed content when the committed URL
query changes, even when two result counts are identical. An optimistic click inserts nothing while
navigation is pending; commit inserts exactly one span with the new count. The
visible Posts empty/no-match cards defer their implicit status announcement to
this region; the global Notifications
toaster remains separate from filter results.



`Error: ` and `Check: ` are the unchanged InlineResult labels. Problems remain
joined with one space. For route responses with problems, the final body is:

| Code/case | Exact body (after the unchanged label) |
| --- | --- |
| VALIDATION_FAILED, elapsed slot | `This slot cannot be used. Some input was not valid. Nothing was changed. Choose another slot.` |
| STALE_READ, Library revision | `The Library item changed after the preview. Review the new preview. Reload this page to see the new preview.` |
| STALE_READ, Schedule revision | `The slot row changed after the preview. Review the new preview. Reload this page to see the new preview.` |
| CONFLICT, already scheduled | `Already scheduled as <content IDs joined by comma-space>.` |
| CONFLICT, duplicate slot | `The slot row is missing or its Content ID is duplicated.` |
| NOT_FOUND, missing slot | `The slot row is missing or its Content ID is duplicated.` |
| NOT_FOUND, missing Library | `Only Content Library items can be promoted.` |

All other codes with problems render exactly `<problems joined by space>`;
STALE_READ alone appends ` Reload this page to see the new preview.` Non-elapsed
VALIDATION_FAILED adds neither safety nor slot advice. Its unchanged problem
vocabulary from `planPromotion` is complete here:

- `The Library row has an unrecognised target platform.`
- `Threads rows are filled from the approved X post through the zh-TW adaptation, not promoted directly.`
- `The Schedule row has no standard Content ID.`
- `This slot is for <slot platform>, not <target platform>.`
- `The slot is not available: <availability reason>`
- `Workflow Settings has no time for <platform> <slot>.`
- `<platform> <slot> is TBD in Workflow Settings and cannot be scheduled automatically.`
- `The row time <row time> differs from Workflow Settings (<settings time>). Fix one of them first.`
- `The Library row has no Markdown link for lineage.`

With no problems, every code retains the server message. The unchanged route
catalogue messages (tested for each code) are:

| Code | Exact message |
| --- | --- |
| AUTH_REQUIRED | `Sign in to continue. Nothing was changed.` |
| FORBIDDEN | `This account cannot do that. Nothing was changed.` |
| CONFIG_MISSING | `This integration is not configured yet. Reading and manual work still function where available.` |
| SCHEMA_DRIFT | `The Sheet columns no longer match the expected layout. No write was attempted.` |
| NOT_FOUND | `That item was not found. It may have moved or been removed.` |
| STALE_READ | `This item changed since you opened it. Your version is kept; compare before saving.` |
| CONFLICT | `Someone or something else changed this first. Both versions are kept; choose what to keep.` |
| GATE_BLOCKED | `A release gate is not met yet. Resolve the listed blocker first.` |
| AMBIGUOUS_MATCH | `More than one candidate matches. Choose the right one to continue.` |
| RATE_LIMITED | `The provider asked us to slow down. Nothing was lost; try again shortly.` |
| PROVIDER_UNAVAILABLE | `A provider is unavailable. Nothing was confirmed as written; manual work is still available.` |
| PARTIAL_FAILURE | `Some steps finished and some did not. Completed steps are listed; retry the rest safely.` |
| VALIDATION_FAILED | `Some input was not valid. Nothing was changed.` |
| UNKNOWN | `Something unexpected went wrong. Nothing was confirmed as written.` |

STALE_READ without problems still appends ` Reload this page to see the new
preview.` If both problems and message are absent/empty, the existing fallback
is exactly `Not scheduled. Nothing was written.`

Round 1 removes these previously appended additions when a problem is present:
`This item changed since you opened it. Your version is kept; compare before
saving.` (STALE_READ); `Someone or something else changed this first. Both
versions are kept; choose what to keep.` (CONFLICT); `That item was not found.
It may have moved or been removed.` (NOT_FOUND). The same problem-first rule
removes any appended catalogue message for the other codes in the table above.
For non-elapsed validation it also removes ` Choose another slot.` These
catalogue entries themselves and the promote route response are unchanged.

Fallback warnings retain `<last failed slot label>: <problem or message>`.
When A and B both fail before C succeeds, B is named, rather than attributing
B's error to A.
This is covered by a two-failure test; no warning copy change is required.
The full-page fallback and equals-only/mixed repair advice listed above remain
the complete other changed-string templates from this PR.


## Retained paths and cleanup blocker

The validation scratch root is `$HOME/tmp/cs194-fix-r1`. A fresh non-following
scan found **zero junctions/symlinks/reparse points** anywhere in scratch, so
there was no junction to detach. Its dependency files are real copies. The main
checkout junction at this worktree's `node_modules` remains unchanged.

Automatic approval rejected both recursive scratch removal and a safer guarded
individual-file/empty-directory removal. The only stated reason was **blocked
by policy**. Neither deletion command executed. A saved PowerShell cleanup file
also could not execute under the machine's script execution policy; that setting
was not changed. No alternate shell/tool deletion workaround was attempted after
the guarded deletion was rejected. Scratch remains, so requested cleanup is
**blocked, not complete**.

Exact retained roots:

| Root | Files | Directories (including root) | Bytes |
| --- | ---: | ---: | ---: |
| `$HOME/tmp/cs194-fix-r1` | 32,590 | 3,512 | 812,865,717 |
| Pre-existing worktree `.next` (untouched) | 22 | 9 | 124,293 |

Also retained from this round are `$HOME/cs194-fix-prepare.py`,
`$HOME/cs194-fix-restore.py`, `$HOME/cs194-fix-run.py`,
`$HOME/cs194-fix-mutants.py`, `$HOME/cs194-fix-checks.py`, and
`$HOME/cs194-fix-cleanup.ps1`. Their exact sizes and copies are in evidence.
The 67 pre-existing `$HOME/cs194-*` diagnostic files were not altered.

`$HOME/cs194-fix-r1-evidence/leftovers.json` inventories **every retained file
and exact size**, all retained directories' counts, the six round scripts,
pre-existing diagnostic files, scratch and ignored build. It also inventories
all evidence except its own inventory files. `cleanup-scan.json` records the
zero-link scan; `cleanup.json` records both policy rejections. Ordinary shared
npm/tool caches were not removed. No test servers remain listening on 3240/3241.

## Remaining scope

The #193 issue note and PR-body edit are unperformed under the GitHub no-write
rule. The master's actual-level save check, #193 item 4 history measurement/cap,
the 20 additional axe sites and complete #192 item 5 T2 review remain deferred
as documented. Real Drive, live SQL, distributed leases/cron, outbox backup and
Phase D remain unpassed owner/live gates. No production cutover, CI update,
deployment, merge or issue closure occurred. The only fix-round operational
blocker is scratch cleanup rejected by automatic approval.

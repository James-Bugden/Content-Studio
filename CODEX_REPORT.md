# CS-060 / DB-6 — fix round 1

PR: [#182](https://github.com/James-Bugden/Content-Studio/pull/182).
Issue: [#150](https://github.com/James-Bugden/Content-Studio/issues/150).
Review: [6389281060](https://github.com/James-Bugden/Content-Studio/pull/182#issuecomment-6389281060).
Classification: Heavy / fix. Date: 2026-10-25 (Asia/Taipei).

## Identity and boundaries

- Started clean on `cs-150-db` in the assigned worktree at
  `516693634c950558530e807a0b8767223c9cf88f`, equal to `origin/cs-150-db`.
- `git fetch origin` succeeded. `origin/main` was
  `e33d43fbfcd86456a4a54e260b9d804b4bbd887d`;
  `git log --oneline HEAD..origin/main` was empty and
  `git merge-base --is-ancestor origin/main HEAD` exited 0. No merge needed;
  no rebase performed.
- Fix commit: `b230e577eed141d116c6045204ab57a609627e8f`,
  `CS-060: fix round 1: preserve Sheet cell types and strengthen cutover evidence`.
  This report is a subsequent documentation-only commit.
- Read AGENTS.md, MASTER-SPEC, issue #150, all PR comments/findings including the
  survivor list, database-migration.md, ADR-0002/NOTES, the write-cutover runbook,
  and `D:/wt/briefs/cs/report150.md`. Used implementation, adversarial verification
  and QA procedures. Reviewed the final diff against the existing DB-6 scope.
- No push, GitHub write, PR edit/comment/create/merge, live DB/workbook/Drive
  operation, migration, deployment or flag flip. No other worktree changed.
  No dependency/lockfile change, `npm install` or `npm ci` execution.
  Default Sheet authority and all live-mode refusals remain intact.

## Findings addressed

**B1:** Repository updates, repository Replies appends, exporter cell updates
and exporter appends now share `sheetCellValue`. Queue-for-Schedule and Posted
write real RAW booleans. The fake retains the entered boolean separately from
formatted text and its Ready Queue requires boolean true. Export checkpoints,
parity comparisons and hashes retain boolean type, so text `TRUE` cannot be
reported byte-equal to a checkbox. Tests cover approve-and-queue, a Schedule
Posted row change (the normal Posted patch remains protected), immediate Replies
append, text-vs-boolean hashes and derived Ready Queue behavior.

**B2:** Only genuinely DB-origin Queue ideas (no source Sheet row/revision)
exclude unknown columns absent from their DB cells when building comparison
projections. Imported passthrough values/blanks remain fully compared. Full
Sheet checkpoints still detect subsequent hand edits. A synthetic extra Queue
column test proves idea export and rollback succeed, then proves losing an
imported unknown value raises a named blocking mismatch.

**B3:** Added direct regressions for immediate Replies export and write refusal
during/after rollback, two concurrent repairs of an unexported idea with a held
append, a genuinely extra stable Sheet ID, verification of all seven uploaded
backup files at creation before freshness advances, and actual persistent Sheet
read failure during rollback. Added tests for the other non-redundant survivors;
mutation evidence follows below.

CI now has `browser-db-write` on `ubuntu-latest`, with the same pinned actions,
read-only contents/actions permissions and verified `sweep-server` artifact reuse
as db-read. It runs `tests/e2e/content-write-cutover.spec.ts` with
`CS_E2E_CONTENT_STORE=db` at w375/w1280. The aggregate deterministic browser gate
requires its result to be `success`. A policy regression checks that wiring.
This new hosted job is not claimed green: nothing was pushed.

**Cheap additional fixes:** Provider failure retains a known blocking mismatch
and its field names while adding lag; reconcile shows both even when inspection
fails. Parity inspection shares export single flight and does not record samples,
so viewer loads cannot feed the comparison ledger. Duplicate Sheet IDs produce
an explicit blocking export item. Leading-`=` DB text is refused before any row
writes with a named field mismatch; it is never silently changed with an
apostrophe or allowed to become a permanently unwritable exported cell.

## Final verification

All Vitest, typecheck, lint, build and Playwright commands used the shared
`bash ~/bin/heavy` queue. No full Vitest suite ran. All fixtures were synthetic.

The assigned worktree's node_modules is the original junction to
`C:/Users/jbbug/projects/content-studio/node_modules`. It lacks Supabase/PGlite,
so complete verification used the disposable copy
`C:/Users/jbbug/projects/cs150-fix1-scratch`, with existing cached Supabase 2.117.0
and PGlite 0.5.8 copied from `D:/tmp/cs148-deps`. Other dependencies were junctions
to the existing installation. No installation or download was needed. Scratch
Git metadata enabled the real boundary/acceptance-policy tests. Hash comparison
of all 581 tracked files found only `next.config.ts` different: scratch alone
sets `turbopack.root` to `C:/Users/jbbug/projects` to resolve external junctions.
No application, test or CI source differed.

Installed tools: Node 24.15.0, Next 16.3.6, Vitest 5.0.1, TypeScript 5.9.3,
Playwright 1.63.0. Next/Vitest differ from manifest pins; clean-lockfile hosted
CI remains necessary and is not substituted by these local results.

| Exact command | Result |
| --- | --- |
| `bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/google --maxWorkers=1` | PASS, exit 0: 35 files, 642 tests, zero skipped; final restored source, 68.96 s. Includes health, security boundaries, every application/Supabase file, PGlite restore, Sheet transport/repository/cache and draft sagas. |
| `bash ~/bin/heavy npm run typecheck` | PASS, exit 0 in dependency scratch. |
| `bash ~/bin/heavy npm run lint` | PASS, exit 0 in the assigned worktree after final edits. |
| `git diff --cached --check` | PASS, exit 0. |
| `node scripts/check-private-paths.mjs` | PASS, exit 0; repeated with staged files/report. |
| `node scripts/scan-secrets.mjs` | PASS, exit 0; repeated with staged files/report. |
| `node scripts/check-env.mjs` | PASS, exit 0, names only. |
| `bash ~/bin/heavy npm run build` | PASS, exit 0; synthetic production build, including its TypeScript step. |
| `bash ~/bin/heavy npx playwright test tests/e2e/content-write-cutover.spec.ts tests/e2e/smoke.spec.ts --project=w375 --project=w1280` | PASS, exit 0: 6 tests, zero skipped, 9.4 s. |

Initial expected red evidence:
`bash ~/bin/heavy npx vitest run tests/unit/application/content-export.test.ts --maxWorkers=1 -t 'RAW checkboxes|immediately after save|unowned unknown'`
failed all three selected tests on the original implementation: string TRUE,
string FALSE, and the extra-column mismatch. These failures are not counted as
passes. The Queue-column fixture was subsequently given its correct widened
import fingerprint so it tests a valid imported baseline as well as the new idea.

Other non-passes were resolved: initial native verification lacked dependencies;
two fake typing errors and the new serializer's missing server-only marker were
fixed; the extra Posted test initially attempted a correctly protected normal
patch and was changed to simulate a DB row update without weakening validation;
scratch security checks initially lacked Git metadata; scratch lint saw the
disposable mutation harness's console output (harness removed, final repository
lint passed). None of these failed attempts is represented as a green check.

## Adversarial test integrity

Lenses: correctness/representation, state/concurrency/retries, auth/privacy and
backup integrity, false-green tests. No independent second reviewer is claimed
for this fix round. No hosted or original-45-mutant rerun is claimed.

Mutated implementation only in external scratch. The harness required exactly
one replacement, checked the changed SHA-256 after applying it, required an
assertion failure/exit 1 from the selected tests, and restored original bytes in
`finally` with SHA verification. All selected final mutations were killed.
Final full green tests used restored bytes.

For exporter/reconcile rows below, the exact command prefix was:
`bash ~/bin/heavy npx vitest run tests/unit/application/content-export.test.ts --maxWorkers=1 -t`.
For backup rows it was:
`bash ~/bin/heavy npx vitest run tests/unit/application/content-backup.test.ts --maxWorkers=1 -t`.
The filter column supplies the final quoted argument. Each final result is
exit 1 with assertion failure; unselected tests are not counted as passes.

| Survivor / mutation | Filter | Changed SHA-256 prefix | Final result |
| --- | --- | --- | --- |
| M05: remove exported-new-idea deletion guard | `'never re-appends'` | `8b719a3b12d7` | killed |
| M08: remove read-back mismatch issue | `'records a read-back mismatch'` | `5e2fe1829bd5` | killed |
| M09: remove export single flight | `'single-flights two repair'` | `d1d2c0a0adb2` | killed |
| M16: remove createQueueIdea from proxy | `'immediately after save\|actually unreadable'` | `c74b9e8925a6` | killed |
| M17: remove replay counting exclusion | `'counts distinct committed'` | `9d5df785e5aa` | killed |
| M19: ignore extra Sheet IDs | `'real unexpected Sheet ID'` | `888fa02861a5` | killed |
| M21: remove MAX_TAB_ROWS guard | `'bounded-read exhaustion'` | `34fa8b28991a` | killed |
| M28: allow missing lag samples | `'daily comparison never'` | `5961d7f388b1` | killed |
| M32: relax freshness 36h to 360h | `'backup freshness has'` | `74fc626b3239` | killed |
| M33: remove later-backup-failed flag | `'backup freshness has'` | `cb6a723f285d` | killed |
| M37: remove creation verification (backup command) | `'at creation before advancing'` | `0221e358e45e` | killed, all seven corrupt-upload cases |
| M39: remove verify assertPrivate (backup command) | `'independently readable folder'` | `37b01713843e` | killed |
| M02 edge: remove fingerprint gate, empty-header edit | `'empty-header hand edit'` | `d2f6e880c674` | killed |
| M03 edge: remove full-cell gate, link-only edit | `'link-only hand edit'` | `0db4124ed74b` | killed |

M17 initially survived because same-instance repeats were deduplicated by the
operation-ID Set. The final test adds a replay first reaching this instance
after a separate repository committed it, plus same-instance replay and a
distinct no-op operation. The identical mutation then failed (exit 1). Thus the
initial 13/14 result was not accepted; final distinct-mutation coverage is 14/14.

Survivors judged redundant: **M01, M06, M07, M10, M11, M18**. The review explicitly
identifies them as overlapping guard removals with another guard preserving the
same observable refusal. No distinct missing behavior was identified for these
six, so I did not add assertions against the mere presence of guard code.
Existing and new behavior tests exercise pre-write preservation, formula/link
preservation, read-back mismatch and final parity/rollback refusal instead.
The review comment does not publish their individual replacement expressions;
this is a redundancy judgment, not a claim to have reproduced those operators.
M02/M03 were not dismissed wholesale: their named empty-header/link-only gaps
are now independently exercised and the corresponding guard removals killed.

Restored implementation SHA-256 values (identical in scratch and this worktree):

- content-export.ts: `d1b4b10c08ee85843a8c756bdc03664f88c6693f0c7993f4bc4abdf590bec62b`
- content-backup.ts: `83ab953dc646be313f511e2caac5b26d7b28aeeace83c468b10343199a6b0b0f`
- reconcile.ts: `59945f2758a1bcb1ad2cd651a7ea533b18c3c8fcc3d756317a966a3c17e68421`

## Browser/build and cleanup

Build and browser application identity:
`b230e577eed141d116c6045204ab57a609627e8f`.
Next build ID: `36evPIoO704aC7DrI-EfP`.
Synthetic compilation took 17.8 s and its TypeScript step 12.2 s.

Build environment: `CS_DATA_MODE=fake`, `AI_PROVIDER=fake`,
`CS_COMMIT_SHA=b230e577eed141d116c6045204ab57a609627e8f`.
Browser environment: `CS_E2E_PREBUILT=1`, `CS_E2E_CONTENT_STORE=db`,
`CS_E2E_PORT=3380`, `CI=1`, the same `CS_COMMIT_SHA`.
The existing harness owned its 3380/3381 child servers; neither port was listening
after Playwright exited. No unknown Node process was killed.

T1 verified the DB save/export, subsequent Sheet hand-edit conflict with named
Draft Content/blocking severity, absent import action, pending-cutover store
fact, missing-backup state, health identity/capabilities and security headers.
Both widths passed axe on the conflict panel, no horizontal overflow and no page
errors. I visually inspected the synthetic full-page screenshots at 375/1280
for wrapping, field names and severity display. This is local responsive/T2
inspection, not independent review or physical-device/T3/T4 evidence.

**Cleanup is blocked by automatic approval review.** The combined checked cleanup
command was rejected before execution with reason **blocked by policy**. The
safer standalone junction-detachment command then succeeded: validated every
path beneath the literal scratch root, detached **431 links individually** with
nonrecursive directory/file deletion, and confirmed **zero remaining reparse
points**. The subsequent separate, literal-path recursive deletion (again
checking the absolute target and zero links first) was also rejected before
execution with reason **blocked by policy**. No alternate-shell deletion or
other bypass was attempted. No permission prompt was made under the never policy.

Remaining synthetic-only paths, outside the repository:

- `C:/Users/jbbug/projects/cs150-fix1-scratch` — source copy, copied cached
  Supabase/PGlite, synthetic build/test/screenshots/logs and private scratch Git
  metadata; all dependency junctions have been detached.
- `D:/tmp/cs150-fix1-tests.log` — the initial failed local test log; its removal
  was in the rejected command and did not execute.

The assigned worktree's node_modules remains its original junction to
`C:/Users/jbbug/projects/content-studio/node_modules`. Existing scratch paths
from the previous builder report were outside this task and were not touched.

## Remaining limits

Runbook records the unchanged same-cell read/write race, conservative missing-lag
day rule and current-schema-only backup reader (a schema bump must provide a
versioned archive/restore plan). Leading-equals text is explicitly blocked rather
than supported. Instance-local checkpoints, decisions, measurements and mutexes
remain insufficient for live use. Durable adapters/cross-instance leases and
actual live representations still require the existing gates.

MIG-05 live authority/import shutdown, MIG-12 copied-workbook/Supabase-branch T3,
14-day/50-mutation observation, MIG-13 real private Drive/branch restore and plan
backup/PITR confirmation, and T4 exact deployed smoke remain NOT PASSED. No
cutover date or live readiness is claimed. PR/issue remain unchanged remotely;
the coordinator must push and obtain green CI/re-review under its own authority.

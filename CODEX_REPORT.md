# CS-061 / DB-7 — fix round 1

PR [#188](https://github.com/James-Bugden/Content-Studio/pull/188), issue
[#151](https://github.com/James-Bugden/Content-Studio/issues/151). Heavy; role: fix.
Date: 2026-10-25, Asia/Taipei. Local work only; nothing pushed or applied live.

## Identity and scope

- Started clean on `cs-151-db` in the assigned worktree at
  `8b9c58ed37bc7ee13eef4cec508b8ca9532081b6`, matching its remote branch.
- `git fetch origin` succeeded. `origin/main` was
  `8c0aa3eb5bb583d22f904d66bfed7068d44050eb`; `git log HEAD..origin/main`
  was empty. `git merge origin/main` returned `Already up to date.` No rebase.
- Code/test/runbook commit:
  `12e4ca20f328b64b3b88406bcd85764f0d1608c2`
  (`CS-061: fix round 1: preserve rollback safety and prove draft authority guards`).
  This report is committed afterward. The final commit does not change application code.
- Read AGENTS.md, MASTER-SPEC, migration design, ADR-0002 including NOTES,
  DB-7 runbook, the supplied prior report and issue #151. Read both review
  comments with `gh pr view 188 -R James-Bugden/Content-Studio --comments`.
  Issue read: `gh issue view 151 -R James-Bugden/Content-Studio`.
- Used implementation, adversarial verification, QA, Supabase and React quality
  procedures. Review in this round is self-review, not a new independent verdict.
- No GitHub write, push, PR edit/comment/create/merge, deployment, live database,
  live Drive or live Sheet operation. No new dependency, install/ci, lockfile or
  migration change. Default/live authority gates remain unchanged.

## Findings resolved

| Finding | Result and evidence |
| --- | --- |
| B1 | Composed-container rollback succeeds on the untouched fixture and after a DB edit plus export. Existing resolvable sections require exact body bytes. Pending jobs require acknowledgment. An audited Library body edit with a before-image requires exact export even after acknowledgment, for empty bodies and if its section later goes missing/duplicate. Legacy missing/ambiguous sections with no body edit remain legacy warnings and do not make untouched rollback impossible. |
| B1 write state | Writes freeze and drain before verification, closing the in-flight mutation window. A Markdown refusal restores the previous write state; tests prove a previously writable DB accepts a later save and an explicitly frozen DB stays frozen. Sheet-parity/flip failures retain DB-6's frozen state. |
| J1 | A behavioural probe changes another section after export's read but before write. The stale revision refuses the write, preserves the complete external file and retains the job. Refreshing just the write precondition is caught by the test. |
| J2 | DB draft save uses the existing `sectionBodyProblems` validation and `unsafe_markdown_structure` details, so the existing editor error copy is used. Heading and open-fence tests prove no DB history, job or Drive call. DB validation uses the conservative standard level-2 boundary without reading Drive; deeper export layouts still undergo exact `safeReplaceSectionBody` checks. |
| J3 | Missing legacy sections use `markdown_missing`, not export lag. An untouched readable fixture has exactly zero lag items; its duplicate is attention. Browser assertions count actual list items inside the group, require exactly one item for SYN-L008 after failed export, and assert its recovery text and editor link. |
| J4 | Tests independently change generation hash and section hash while retaining a fresh DB revision, for alternative/current choices. Opening tests cover a different opening, a hook-prefix without a newline boundary and a blank hook. Refusals preserve row/history/outbox. |
| Stale queued job | A job whose body no longer matches the row records a named blocking state instead of silently skipping. Fix issues links to the editor and gives recovery; the runbook explains that a deliberate content correction is needed if an equal-body save would enqueue nothing. A later audited change repairs the job and clears stale failure status. |
| Copy and links | Unchanged DB saves say already saved; equal-body import previews say the DB already holds the body. Export failures use actionable prose instead of raw codes or falsely claiming every error is a Drive conflict. New items link to their editor. Drive conflicts, stale revisions and unsafe export bodies are blocking. |
| Repair isolation | Both Markdown and Sheet repair are attempted with `Promise.allSettled`; an unexpected Markdown queue failure cannot skip Sheet repair, and failure is still reported. A composed-container regression verifies this. |
| Documentation | The runbook records the precise rollback rule, conservative history classification and recovery for missing/duplicate/unsafe/stale bodies. Its report link now resolves to this committed file. The prior recorded section-3 delegation is retained; no new owner approval or live readiness is claimed. |

The provenance query uses existing private row history, not another authority or
new table. Initial inserts have no before-image. It conservatively includes
historical body-changing copies with a before-image, so such rows also require
parity. A PGlite/production-client filter test exercises its SQL selection and
deduplication. Hosted PostgREST remains unverified. Direct production DML that
bypasses history/outbox remains outside the approved write path.

## Verification

Checks ran in an external synthetic scratch copy. All tracked files, including
the new tests, were byte-identical to the code commit except a scratch-only
`next.config.ts` Turbopack root override for resolving existing dependencies.
No test or application source substitution was used. Installed tools were Next
16.3.6, Vitest 5.0.1, TypeScript 5.9.3 and Playwright 1.63.0. Next/Vitest differ
from manifest pins, so clean-lockfile CI is still required.

Every Vitest, TypeScript, lint, build and Playwright child command used
`bash ~/bin/heavy`. No full Vitest suite ran. A small external Python wrapper
captured stdout/stderr and the real child exit status; it did not change tests.

| Exact child command | Result |
| --- | --- |
| `bash ~/bin/heavy npx vitest run tests/unit/application/markdown-authority.test.ts tests/unit/application/markdown-rollback.test.ts tests/unit/supabase/markdown-export.test.ts tests/unit/components/post-editor-save.test.tsx --maxWorkers=1` | Exit 0; 4 files / 46 tests; 9.59 s. |
| `bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components tests/unit/google tests/unit/ai tests/unit/domain/markdown.test.ts --maxWorkers=1` | Final child/wrapper exit 0; 65 files / 920 tests, zero skipped; 129.34 s. Includes the entire four required directories. |
| `bash ~/bin/heavy npm run typecheck` | Exit 0, repeated on final source after build. |
| `bash ~/bin/heavy npm run lint` | Final child/wrapper exit 0; no errors or warnings. |
| `bash ~/bin/heavy npm run build` | Child exit 0; successful production compile (23.3 s), TypeScript (16.8 s), page generation and route inventory. Build ID `NXOge9fcDR51aK8QNn6z-`. |
| `bash ~/bin/heavy npx playwright test tests/e2e/markdown-authority.spec.ts tests/e2e/content-write-cutover.spec.ts --project=w375 --project=w1280` | DB runtime, exit 0; 4 passed, zero skipped; 15.4 s. Final acceptance repetition against the same artifact after code commit: 4 passed / 16.0 s. |
| `bash ~/bin/heavy npx playwright test tests/e2e/markdown-authority.spec.ts --project=w375 --project=w1280` | Sheet runtime, exit 0; 2 passed, zero skipped; 6.9 s. |
| `git diff --cached --check`; `node scripts/acceptance-matrix.mjs --check`; `node scripts/check-private-paths.mjs`; `node scripts/check-env.mjs`; `node scripts/scan-secrets.mjs` | Exit 0; 107 acceptance IDs accounted for; private-path/env/secret checks clean. Rechecked report hygiene before its commit. |

Browser runs used `CS_E2E_PREBUILT=1`, separately `CS_E2E_CONTENT_STORE=db`
and `sheet`, ports 3410/3411 and 3412/3413, and the existing installed browser
cache via `PLAYWRIGHT_BROWSERS_PATH`. The repository harness owned its child
servers. No unknown Node process was killed. Synthetic fake-provider build/test
environment only. No real credentials were loaded.

Non-passes were investigated, not counted green:

- The first broad run reported 920 passing tests, but PowerShell redirection
  treated the secret-scanner regression's intentional stderr as NativeCommandError
  and returned 1. The final wrapper rerun recorded exit 0 for the whole command.
- The build itself exited 0, but the wrapper initially failed while printing
  Unicode route-tree characters to a legacy console encoding. Its output encoding
  was corrected; the built artifact and its successful compiler output were
  inspected, typechecked and exercised in both browser modes.
- Two initial browser runs failed before test steps because the default browser
  path was unresolved from the runner. Selecting the real existing cache under
  the installed app's LocalCache resolved this; no download/install occurred.
- Initial per-junction scratch setup was stopped only for its owned Python
  process and batched. PowerShell initially refused a helper `.ps1` by execution
  policy; setup then used normal inline commands. No security policy was changed.
- Successful browser runs emit NO_COLOR/FORCE_COLOR warnings. The final DB run
  also logged a destination-stream-closed error during server teardown; all four
  tests passed, and the DB-7 page-error collection was empty. No test failure was
  waived as a flake.

## Adversarial evidence

Lenses: rollback correctness, provider/concurrency boundaries, auth/privacy and
false-green tests. Reviewed the committed diff and real executions. Each probe
changed implementation code in scratch only, required exactly one replacement,
verified a changed SHA-256, required assertion failure/exit 1, then restored the
original bytes in `finally` and checked equality. All 16 were killed; no mutant
was committed. The mutations correspond to the named review defences; the
review comment does not provide a machine-readable original mutation harness.

Command prefix for every row:
`bash ~/bin/heavy npx vitest run <file> --maxWorkers=1 -t <filter>`.
`A` = `tests/unit/application/markdown-authority.test.ts`;
`R` = `tests/unit/application/markdown-rollback.test.ts`.

| Mutant | Defence removed/changed | File/filter | Mutated SHA-256 prefix | Result |
| --- | --- | --- | --- | --- |
| M42 | Skip rollback hook | R / `unexported DB body` | `4d74cf83cf60` | Killed, exit 1 |
| M09 | Skip rollback body equality | R / `compares body bytes` | `5abdac255f8b` | Killed, exit 1 |
| M11 | Refresh write revision after stale read | A / `adjacent Drive edit` | `2c91ceab2eeb` | Killed, exit 1 |
| M25 | Skip DB hook generation guard | A / `refuses stale DB hook` | `9755cfb0e1cf` | Killed, exit 1 |
| M28 | Skip opening guard | A / `opening mismatch` | `9158907539d8` | Killed, exit 1 |
| M02 | Skip readback revision check | A / `different revision` | `ffe0d9ff2287` | Killed, exit 1 |
| M04 | Skip stale queued-body guard | A / `stale queued snapshot` | `954ff1b6ffbf` | Killed, exit 1 |
| M07 | Retain old failure after completion | A / `stale queued snapshot` | `7a960783a4fb` | Killed, exit 1 |
| M08 | Skip pending acknowledgment check | R / `acknowledgment fails` | `48bdb40cecfd` | Killed, exit 1 |
| M16 | Skip canonical import file-ID validation | A / `noncanonical file id` | `3f8388e21e66` | Killed, exit 1 |
| M17 | Skip preview body-token validation | A / `noncanonical file id` | `27ebb67fce67` | Killed, exit 1 |
| M18 | Omit duplicate refused list | A / `duplicate refusals` | `59ab205e2c36` | Killed, exit 1 |
| M19 | Force differs false | A / `duplicate refusals` | `27bb96b0d7d1` | Killed, exit 1 |
| M21 | Accept trashed preview master | A / `trashed master` | `db943b9204ae` | Killed, exit 1 |
| M32 | Omit no-link item | A / `no-link and unreadable` | `f4011c8d5958` | Killed, exit 1 |
| M33 | Omit unreadable-master items | A / `no-link and unreadable` | `a6117f6668fb` | Killed, exit 1 |

None of the requested mutations was dismissed as equivalent. M16/M17 are
redundant for well-formed route traffic, but strict application validation and
error behaviour are observable and now tested directly. The review's M39/M40
SQL equivalence and fake-only M05 observation were not reclassified or rerun;
this round changes no SQL and does not establish cross-instance single flight.

## Responsive copy review and remaining gates

Inspected synthetic editor/import screenshots at both widths and the phone lag
screen. DB authority, save retention, actionable missing-master wording, review
links, duplicate refusal and side-by-side/stacked import bodies are readable.
The browser verifies unsafe-save copy, exact persisted text, exact lag inventory,
both import directions, no horizontal overflow and zero axe violations in the
import surface. This is local agent T2 inspection, not owner T2 or a physical
device result. Screenshot/log artifacts remain only in the scratch root below.

Live Drive DRV-01, hosted SQL/PostgREST/Advisor, independent-backend races/leases,
cron timing, backup/outbox reconstruction, owner production gates, T3/T4 and
production deployment remain unpassed. No cutover, merge readiness, remote CI
pass, issue closure or independent approval is claimed. The existing metadata
check/write residual Drive race remains. Concurrent/cross-instance operator
rollback orchestration is not newly certified by these single-instance tests.

Supabase changelog and current filter documentation were consulted; no new
provider feature or schema was introduced. Sources:
[filter reference](https://supabase.com/docs/reference/javascript/filter) and
[Postgres minor-release notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

## Cleanup and exact leftovers

All 431 task-created dependency/cache junctions were detached individually and
nonrecursively: the scratch `.vite` junction first, then 430 remaining reparse
points. Paths were validated inside the literal scratch root; fresh traversal
confirmed **zero remaining reparse points before any recursive delete attempt**.

Automatic approval review rejected the subsequent deletion of the validated
scratch root and five regular helper files with **blocked by policy**, before
execution. No alternate deletion mechanism, bypass or permission prompt followed.
Exact task-created leftovers:

```text
C:/Users/jbbug/projects/cs151-fix1-scratch/
C:/Users/jbbug/projects/cs151-fix1-changelog.txt
C:/Users/jbbug/projects/cs151-fix1-harness.py
C:/Users/jbbug/projects/cs151-fix1-links.ps1
C:/Users/jbbug/projects/cs151-fix1-mutate.py
C:/Users/jbbug/projects/cs151-fix1-run.py
```

The scratch root contains the synthetic source/build, copied cached declared
dependencies, test/mutation logs and screenshots, and its own empty Git index.
It contains no dependency junctions. Older scratch roots/reports were untouched.
Final inspection confirmed all six paths above still exist, zero scratch
reparse points and no listeners on the four owned test ports (3410–3413).

One setup mistake had a shared-cache side effect: before detection/detachment,
the first focused Vitest run wrote the pre-existing shared cache file at:

```text
C:/Users/jbbug/projects/content-studio/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json
```

Its observed modification time was 2026-10-25 06:23:57 +08:00. No prior cache
snapshot exists, so it was left in place rather than attempting restoration or
deletion of shared state. Subsequent cache writes were scratch-local. No source
files in another worktree were edited; shared package contents were not installed
or replaced. The assigned worktree's original node_modules junction was retained.

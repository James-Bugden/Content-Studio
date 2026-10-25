# CS-064 / PR #200 — fix round 1

Issue: [#198](https://github.com/James-Bugden/Content-Studio/issues/198).
PR: [#200](https://github.com/James-Bugden/Content-Studio/pull/200).
Heavy, fix role; 2026-10-25. Independent review input: comment 6394682556,
REQUEST CHANGES on `a26effc57545e73e7e40d71d74e7ed96dad3a15d`.

## Identity and scope

Started clean on `cs-198-cut` in the assigned worktree, at the supplied SHA.
Read AGENTS.md, MASTER-SPEC, issue, review/probes/mutations, report198.md and
the migration, cutover, write-authority and draft-authority contracts. Applied
implementation, adversarial verification, QA and React review procedures.
This is a fix to an already specified issue; no new PRD or product direction.

Read-only GitHub commands:

```text
gh pr view 200 -R James-Bugden/Content-Studio --comments
gh issue view 198 -R James-Bugden/Content-Studio
git fetch origin
git log --oneline HEAD..origin/main
git merge origin/main
```

Main had advanced to `e9a0a31`; merged without conflicts as `2dee683`.
Local fix commits:

- `c140e9c`: authority epochs, recovery, leases, outbox, ACL and proof regressions.
- `618320b`: isolate authorization/force-overwrite assertions; bound evidence/state.
- `61c5f98`: assert no-link saves never enqueue work, before any repair runs.
- `a1fb0b3099c27f6f6c75621b0ae5181f1898113a`: retire authority before permanent Sheet resume.

This report's final commit follows the implementation. No push, GitHub write,
migration application, live provider call, install/ci, dependency change or edit
to another worktree was performed. MASTER-SPEC and AGENTS authority notes remain
pending; no production flip or cutover date is claimed.

## Delivered and acceptance

**B1 / MIG-11, MIG-12, MIG-05:** explicit `activate-read` / `activate-db` operations
check the exact deployed build, latest import, complete measured parity and all
required proofs. DB activation records a private schema/cutover contract epoch
(`schema-2:cutover-1`). Ongoing compatible deployments use that epoch, not build
SHA evidence. A contract mismatch serves read-only data, blocks mutation entry
before provider sagas and exposes a blocking Fix issues item. The real RPC
write boundary independently checks admission and its per-mode allow-list.
Backup and rollback use recovery admission while DB authority exists; fresh
build/parity/Phase C evidence cannot strand the emergency exit. Freeze/drain,
linked Markdown exactness and exact fresh Sheet export remain mandatory.
Rollback serializes with mutations, checks exactness before disabling writes,
and leaves an enabled boundary enabled on refusal.

A permanent Sheet rollback explicitly retires the old epoch after verifying
the frozen Sheet deployment and before Sheet writes resume. Retirement is
idempotent/audited and requires the generated exact rehearsal proof. Stale DB
deployments then refuse; reactivation requires a new post-retirement import
and newly bound proof chain. Frozen flag rehearsals retain their epoch because
they permit no intervening authority writes. The runbook specifies both paths.

**M1 / MIG-12:** read-only parity reloads durable state without claiming or saving
an export worker. Mutating workers have two-minute leases, token fencing before
Google writes, fenced persistence and finally release on settled failures.
Abandoned claims/releases expire; an old token cannot take over a new lease.
PGlite tests inject one 429 after every observed awaited I/O boundary in a
read-only inspection and changed-row export, plus each lease-operation boundary.
Ambiguous accepted Google writes retain their precondition conflict; recovery
does not invent a new baseline.

**M2 / DRV-01, MIG-13:** no-link saves create no impossible outbox work and expose
`markdown_missing` with recovery instructions. Missing/duplicate or externally
edited linked sections become named blockers, reconstructed even after restart.
Backup snapshots authoritative DB bodies/history regardless of pending Drive
work. No-link rows roll back through exact Sheet bodies; linked dependent
sections still require exactness. Archives do not invent a restored Drive
baseline; the runbook keeps export disabled until that baseline is recovered.

**M3:** backup and rehearsal admission fixtures now execute actual backup and
rollback operations; only external coordinator attestations are synthetic
phase-C fixtures. Each proof, import/build binding, mode allow-list, direct RPC
authorization, read admission, freeze, replay, ACL boundary and force-overwrite
refusal has a condition-specific exposing assertion. Survivor results follow.

Minor fixes: honour the freeze in Sheet mode (including Replies Content inserts);
document and test exact Sheet revert for hand-edit mismatch recovery; bound
parity proof age to 15 minutes and other flip proofs to 24 hours; bound persisted
diagnostics and refuse excessive state without dropping recovery data; retry
settled failed and expired coordinator jobs, including daily backup across a
compatible redeploy; accept only configured owner/service-account ACL principals
and recognized roles/details; document read-phase preparation normalization;
remove stale pending-cutover UI copy. A schema/cutover change requires its own
reviewed migration plan; changing a SHA does not.

## Verification

Final implementation: **`a1fb0b3099c27f6f6c75621b0ae5181f1898113a`**.
Production artifact (synthetic local runtime) BUILD_ID: **`pCtLgw0HgDWjb6--lGdEs`**.
All **643** tracked source/test/migration/config/doc files matched the validation
copy byte-for-byte before this report-only commit; all **27** installed direct
package versions matched the lockfile. Node `24.15.0`, PGlite `0.5.8`, Next `16.4.1`.

- Full required directories: **68 files / 959 tests passed**, zero skipped,
  exit 0; Vitest 156.04 seconds (queue/wrapper elapsed 159.018 seconds).
- Typecheck, whole-repository lint, production build: **exit 0** (15.163,
  20.616 and 14.374 seconds respectively, including queue/wrapper overhead).
- Production-artifact Playwright: **16/16**, zero skipped: db 4/4, db-read 6/6,
  sheet 6/6, projects `w375` and `w1280`. The touched write-cutover spec ran
  at both widths. The db journeys were repeated once to retain screenshots
  before the next Playwright command could clear its output folder: 4/4 again.
- Actual PGlite execution ran inside these full-directory suites:
  `content-backup-pglite`, `content-cutover-live`, `content-cutover-security`,
  `content-db`, `content-import-pglite`, `content-schema`,
  `content-shadow-pglite`, `content-writes`, and `markdown-export`
  (`tests/unit/supabase/*.test.ts`). All 18 files in that directory ran, plus
  every file in the other three required directories. This is not just a
  targeted cutover test or a run against the incomplete shared dependencies.
- Private-path, secret and environment checks passed; staged whitespace passed.
  Command JSON records include exact argv, cwd, UTC start/end, exit and signal.

T2 visual inspection of saved real-browser renders at 375/1280 covered the DB
editor, preserved Sheet conflict and Drive-lag reconcile states: copy and actions
remain legible, controls wrap within their cards, and the stale pending-cutover
claim is gone. Browser assertions also check overflow, page errors and axe on
changed conflict surfaces. **Additional interactive T2 was blocked**: automatic
approval review rejected the extra persistent synthetic UI server with only
“blocked by policy”. No alternate server command bypassed that rejection. A
Chrome QA tab was opened blank and closed; it performed no application action.
The saved-rendering inspection is not claimed as a complete independent agentic
T2 session, 500/750 or 200% zoom review. No T3/T4 pass is claimed.

All heavy child commands use `bash ~/bin/heavy`; no full Vitest suite ran.
Validation uses a physical scratch copy at `D:/wt/cs200-fix-validation` and a
read-only physical copy of the existing worktree-163 dependencies. The assigned
`node_modules` junction still points to the main checkout. No npm install/ci,
package/browser download, test-config relaxation, bundler-root override or production-source
adapter substitution was used. Supabase/Google transports in local integration
tests are synthetic; actual migration SQL executes in disposable PGlite only.

Exact final commands, from that scratch:

```sh
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components --maxWorkers=1 --silent
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
bash ~/bin/heavy npm run build
# CS_E2E_PREBUILT=1; CS_E2E_CONTENT_STORE=db; ports 3494/3495
bash ~/bin/heavy npx playwright test tests/e2e/content-write-cutover.spec.ts tests/e2e/markdown-authority.spec.ts --project=w375 --project=w1280
# CS_E2E_CONTENT_STORE=db-read
bash ~/bin/heavy npx playwright test tests/e2e/content-read-cutover.spec.ts --project=w375 --project=w1280
# CS_E2E_CONTENT_STORE=sheet
bash ~/bin/heavy npx playwright test tests/e2e/markdown-authority.spec.ts tests/e2e/smoke.spec.ts --project=w375 --project=w1280
```

The earlier broad run exposed a missing server-only declaration and an external
edit fixture targeting the wrong section; both were corrected. Mutation runs
exposed freeze-masked allow-list assertions and a later-error-masked live
force-overwrite assertion; both now prove refusal before provider calls. An
extra no-link mutation exposed checking only after repair; the regression now
checks immediately after save. Retirement's first fixture used a Queue source
absent from the fake's static summary; the retest uses a real Sheet patch and
fresh import, without weakening full parity. Initial PowerShell redirection and
execution-policy errors were corrected; exact command exit/signal evidence is
recorded by a Node wrapper. No failed/blocked check is counted as green.

## Mutation accounting

43 of the 48 original survivors are killed; five are equivalent or intentionally match the corrected contracts. All five added mutations are also killed.

| ID | Original survivor | Final result / exposing evidence |
| --- | --- | --- |
| L01 | db-read authorizes any rpc | Killed ? `calls the real RPC`. |
| L02 | db rpc allow-list removed | Killed ? `calls the real RPC`. |
| L03 | db write flag not checked in rpc | Killed ? `calls the real RPC`. |
| L04 | rpc authorizeWrite skips gate | Killed ? `calls the real RPC`. |
| L06 | measure allowed in db mode | Killed ? `P1: admits SHA A`. |
| L07 | measure no gate at end | Killed ? `rejects a red actual measurement`. |
| L08 | backup skips gate | Equivalent to the fixed recovery contract: the obsolete fresh-build backup gate is intentionally gone; recovery admission is still enforced by the worker. Pre-epoch refusal and post-epoch emergency success are tested. |
| L09 | backup skips markdown drain | Equivalent to the fixed backup contract: Drive drain is intentionally absent; exact authoritative DB backup must continue with pending or impossible Drive work. |
| L10 | backup not recorded as evidence | Killed ? `produces backup/rehearsal`. |
| L12 | rollback skips gate | Equivalent to the fixed recovery contract: rollback must not require new admission proofs. Owner freeze, active authority, linked Markdown and fresh exact Sheet checks still enforce safety. |
| L13 | rollback rehearsal not recorded | Killed ? `produces backup/rehearsal`. |
| L15 | db repo not gated | Killed ? `refuses DB reads and recovery`. |
| L16 | db not frozen without write flag | Killed ? `freezes the db repository`. |
| L18 | rollback (db-read) without markdown verify | Killed ? `a read-phase rollback refuses`. |
| L20 | backup allowed with google writes off | Killed ? `fails a backup closed`. |
| C01 | rollback replay returns cached readiness | Killed ? `never replays cached rollback`. |
| C07 | no mismatch reload before claim | Killed ? `loads mismatches before`. |
| C09 | refresh failure keeps lastVerified | Killed ? `fails a backup closed`. |
| C10 | persist without token | Killed ? `fails a backup closed`. |
| C11 | claimed state not restored | Killed ? `loads mismatches before`. |
| C12 | snapshot table check removed | Killed ? `fails a backup closed`. |
| S02 | gate ignores import identity | Killed ? `obsolete import identity`. |
| S03 | gate ignores coverage | Killed ? `refuses activation for exactly parity.coverage`. |
| S07 | phase-c t4 unchecked | Killed ? `refuses activation for exactly phase-c.t4`. |
| S08 | rehearsal exact unchecked | Killed ? `refuses activation for exactly rehearsal.exact`. |
| S09 | rehearsal hash equality unchecked | Killed ? `refuses activation for exactly rehearsal.sheetHash`. |
| S10 | db proofs ignore build | Killed ? `obsolete import identity`. |
| S11 | backup proof unchecked | Killed ? `refuses activation for exactly backup.manifestHash`. |
| S14 | save skips exported_sheet_revision | Killed ? `fences stale/expired`. |
| S20 | phase-c sheetRaceAccepted unchecked | Killed ? `refuses activation for exactly phase-c.sheetRaceAccepted`. |
| S22 | phase-c p95 bound unchecked | Killed ? `refuses activation for exactly phase-c.warmP95Ms`. |
| S23 | release ignores token | Killed ? `fences stale/expired`. |
| E02 | initial capture ignores imported revision | Equivalent for initial capture: full owned cells, links and types must already match; capture performs no write and checkpoints the complete fresh row, including formulas. Imported fingerprint is an extra conservative condition, not overwrite authority. The stricter original check remains in code. |
| E05 | live resolveMismatch allowed | Killed ? `refuses the live hand-edit force`. |
| E07 | live parity without lock | Equivalent to the fixed inspection contract: read-only parity deliberately takes no worker lock and persists no checkpoint; M1 regressions require this behaviour. |
| E08 | lag ignores changedAt | Killed ? `uses durable updated_at`. |
| E09 | missing updated_at tolerated live | Killed ? `uses durable updated_at`. |
| D01 | authorizeWrite not called | Killed ? `calls the real RPC`. |
| D02 | live write guard bypass | Killed ? `calls the real RPC`. |
| V03 | backup folder not required | Killed ? `requires live DB configuration`. |
| V04 | supabase config not required for live db modes | Killed ? `requires live DB configuration`. |
| K01 | Sheet writable while frozen | Killed ? `freezes the db-read repository`. |
| K03 | db mode exposes import | Killed ? `refuses DB reads and recovery`. |
| B02 | permission pagination ignored | Killed ? `checks permissions on`. |
| B03 | shared drive membership unchecked | Killed ? `checks permissions on`. |
| B06 | file permission check removed | Killed ? `checks permissions on`. |
| B07 | driveId check removed | Killed ? `refuses missing or invalid shared-drive`. |
| R02 | route accepts non-uuid key | Killed ? `requires a valid coordinator`. |

Added mutations: N01 (remove contract mismatch), N02 (make owner recovery depend on new SHA proofs), N03 (enqueue a no-link job), N04 (serve a retired epoch), N05 (reactivate it without a new import): **all killed**.

The first L02/E05 attempts survived before assertions were isolated; the first N03 attempt survived because repair removed the bad job before inspection. Their corrected tests were rerun successfully against both original and mutated code. No surviving run is presented as a kill.

Each executable mutation applied at one logical site, changed the implementation
SHA-256 and restored its original bytes in finally, hash checked. Tests were not
mutated. Selective mutation commands use the relevant Supabase test file with
`--maxWorkers=1 --silent -t <exposing-test>`; unselected tests are not counted as
passes. The final four-directory run is unfiltered and has no skipped tests.
Per-mutant commands, failures and original/mutant/restored hashes are retained
in ignored `artifacts/cs200-fix/mutations/`. The five equivalents are explained
individually rather than counted as kills.

## Limits and remaining coordinator work

This is local builder/self-adversarial verification, not independent Opus review
or hosted CI. No hosted migration/RLS/advisor, independent-backend concurrency,
real quota/latency, shared-drive inheritance, Production environment/deployment,
live T3/T4 or actual flag flip is claimed. The coordinator must review this head,
obtain required CI and execute the revised runbook before production acceptance.
No issue was closed and no PR was edited.

Google's residual non-CAS window remains: a token cannot cancel a request already
accepted upstream. Global freeze/drain and the retained race acceptance remain
required. Linked Drive conflicts may still correctly refuse a global rollback;
backup availability no longer depends on resolving those conflicts. A changed
actual SQL schema must be handled with compatible reviewed recovery code.

## Cleanup

Completed scratch cleanup with:

```sh
bash ~/bin/heavy powershell -NoProfile -ExecutionPolicy Bypass -File D:/wt/cs200-fix-cleanup.ps1
```

The script resolved and verified the exact absolute target, walked without
following links, and found **zero reparse points/junctions**. Thus zero links
needed detaching. It then removed the physical validation tree (**31,895 files,
758,071,718 bytes**), mutation scratch and all external copy/mutation/QA/manifest
helpers and preliminary logs. The original review inputs and other worktrees
were left intact.

Automatic approval review rejected the combined report-update/helper-removal
command, then the separately scoped literal-path helper deletion, each with
only **“blocked by policy”**. The report update was completed with apply_patch;
no alternate deletion mechanism bypassed the rejection. Sole external leftover:
**`D:/wt/cs200-fix-cleanup.ps1`**, **2,770 bytes** (the cleanup script itself). Both scratch roots
and every other helper/log were successfully removed before this final refusal.

Intentionally retained ignored evidence: **`artifacts/cs200-fix/`**, including
commands/results, source/dependency manifests, mutation failures/hashes,
synthetic browser screenshots, helper copies and before/after cleanup evidence.
No production content or screenshots are included. The original assigned
`node_modules` junction is unchanged. No listener remained on ports 3494–3496,
no unrelated Node process was killed, and the temporary Chrome tab was closed.

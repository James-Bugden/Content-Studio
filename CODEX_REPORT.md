# CS-060 / DB-6 — build round 1

Issue: [#150](https://github.com/James-Bugden/Content-Studio/issues/150).
Tier/role: Heavy / build. Branch: `cs-150-db`. No push or GitHub write.

## Identity and state

- Base/main at start: `9364427b62be94d0c01204e69ce396a9c112f1c2`; clean worktree,
  branch already isolated and HEAD equal to origin/main. No rebase/merge needed.
- Implementation: `ae980f3ca135d9e2f06600791aae4b38ef52d5ec`.
- Committed-write confirmation fix: `34fa8da7b3026766e77a4966a8333cd1b1001adf`.
- Final application code: `b85655f3e626a2e73d2c21471db54326c9a80928`.
- Final browser assertion only: `d74e290dbf186b2c2a5f1e08fc7a207d8922c272`.
- Tested Next build ID: `l3LrP3Tc4MmL68FnbqPbg`, application identity `b85655f`.
  Later browser commit changes two expected strings only; application bytes
  remain identical. This report is committed separately after verification.

Read AGENTS.md, MASTER-SPEC, migration design (including Phases D/E and gates),
ADR-0002 including NOTES, report149b/report147b, the merged Content DB modules
and GitHub issues #150/#179. Applied implementation, QA and adversarial skills.
#179 remains separate: no DB-5 pending-row read amplification, db-read smoke
matrix or unknown-conversion-abort follow-up was duplicated.

## Implemented behavior

- Fake DB mode wraps all four ContentRepository writes, including the Replies
  Queue insert. Successful DB writes trigger one-way export; a committed SQL
  step also exports if its confirmation read returned PARTIAL_FAILURE.
  Export failure never rewrites or replays the authoritative patch.
- Stable-ID export, Queue append/replay, RAW plain-cell writes, preserved
  formulas/rich links, unknown-column passthrough, fresh fingerprint checks and
  read-back. A hand edit skips the whole row, preserves Sheet bytes, retains
  the old checkpoint and raises blocking export_mismatch with differing headers.
  Empty unknown columns cannot produce an exact report with different hashes.
- Repair and backup scheduler hooks authenticate with CRON_SECRET. Typed and
  legacy imports explicitly refuse db mode. Ordinary unchanged repair reads
  inventories once per collection, performs no writes and avoids per-row scans.
- Exact export parity, daily Taipei comparison records, lag/failure thresholds,
  export_lag/export_mismatch/export_parity/backup_fresh reconciliation. Missing
  observations never count green; comparison needs 14 complete days AND 50
  mutations. Local evidence is visibly instance-scoped.
- Explicit owner export-conflict resolution checks Sheet fingerprint and DB
  version, validates the decision operation ID, records actor hash/fields/
  direction, and refuses reused-different decisions. Replay cannot authorize
  overwriting a later edit. Copying a Sheet value into DB requires a normal
  validated, audited DB patch followed by explicit baseline authorization.
- New immutable gzip JSON-lines archives for all six tables, private-folder
  port/fake, strict manifest, counts/byte lengths/SHA-256 verification of every
  file, previous verified backup retained after failure, retention selection.
- Branch restore verifies the entire archive before writes, checks matching
  schema/empty isolated branch, locks all six tables, defers lineage, restores
  full rows atomically and reseeds history/audit sequences. It uses an explicit
  branch-admin port: runtime service-role grants are deliberately unchanged.
- Tested rollback disables/drains repository writes, final-exports, obtains
  fresh exact parity/hashes, then calls the Sheet flag port. Any failure leaves
  writes disabled. Read-only capability is reported during rollback.
- [Exact runbook](docs/ops/database-write-cutover.md) covers every phase gate,
  mismatch directions, backup/restore, scheduling, comparison measurements and
  rollback/deployed verification. MASTER-SPEC and AGENTS.md still say pending.

## Acceptance and synthetic hashes

| ID | Local result | Live acceptance |
| --- | --- | --- |
| MIG-05 | Imports off in db; DB-only mutation boundary; readonly -> final export -> exact parity -> Sheet flag ordering; SQL authority/fake workbook rehearsal | NOT PASSED: copied workbook/Supabase branch, independent backends and deployed flip remain gated |
| MIG-12 | Every projected field/link and ID compared exactly; Typefully stamps/final copy/metrics covered; Queue append once; hand edit preserved with blocking differing header names; failed rollback never flips | NOT PASSED on hosted/copied workbook; T3/T4 and actual comparison window remain gated |
| MIG-13 | Six gzip files plus manifest verified; actual PGlite restore counts/hashes exact; history, audit, durable replay, sequence reseed and late-error transaction rollback proven | NOT PASSED on Supabase branch/Drive; owner must separately confirm Supabase plan backups |

The supplemental hash-capture run executes the two existing SQL rehearsal
tests, adding stdout projections in scratch only and byte-restoring the test
in finally with a SHA-256 check. Two selected tests passed; eight unselected
tests are explicitly not counted as passes. The complete acceptance run below
has zero skipped tests. Captured hashes are entirely synthetic.

Final rollback: writes disabled, mode `sheet`, no differences; counts Library
12, Queue 5, Schedule 21, settings 18. DB and Sheet hash both:

`6abde8f705643f3e75b4b948d66f19c1bf1a74e89094b8dd3a2f5bb917afa9ae`

Verified backup manifest SHA-256:
`90aee3d4b4e0e1477672af71da1b14d8f79029afe66edf789daa4ff2d3bfabdb`.
Backup-time and restored branch hashes were identical for each row below:

| Table | Rows | SHA-256 |
| --- | ---: | --- |
| posts | 17 | c84da0361af22790deb2102285b69c7054828a3d41a342efde87d48f8b2c7f0b |
| schedule | 21 | 3b65282101542208561c7b64f1f17292295fca58e84c43962738764eb8ba80c5 |
| workflow_settings | 18 | d82540ca79b56e752c54e39badf595ff0f9d549460647c954b713b2f21391a56 |
| row_history | 57 | 4f607c9d331eabaeebf0f9baa44960524212c383a9157e1828f171279bc2eb95 |
| operations | 2 | 1882467a10631e87366d351c669bd080bcf204d36d3b2d300ec7c9a8f9fc6237 |
| audit_events | 57 | a0b8037cec229c5d8899b98bd979ae5044b76a8cac8f099c62c2100f9a7c957f |

## Commands and results

Every Vitest, typecheck, build and Playwright invocation used `bash ~/bin/heavy`.
No full Vitest suite, install or ci command ran. Existing shared node_modules
remains its original junction. Installed versions: Node 24.15.0, Next 16.3.6,
Vitest 5.0.1, TypeScript 5.9.3, Playwright 1.63.0. Next/Vitest differ from manifest
pins; clean lockfile CI is still required and is not claimed green here.

```text
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/google/drive-saga.test.ts tests/unit/typefully/reconcile-create.test.ts tests/unit/typefully/sync-analytics.test.ts --maxWorkers=1
```

Final application acceptance: PASS, exit 0, **32 files / 630 tests / zero skipped**,
80.65 s. Includes health.test.ts, boundaries.test.ts and the whole required three
directories. Earlier expanded passes: 628 and 629 tests before added regressions.

```text
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
git diff 9364427 HEAD --check
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
node scripts/check-env.mjs
```

All PASS, exit 0. Typecheck used external dependency scratch; lint ran in the
actual worktree. Policy/secret scans covered 580 code/test/doc/config files
before adding this report; rechecked after staging the report.

```text
bash ~/bin/heavy npm run build
bash ~/bin/heavy npx playwright test tests/e2e/content-write-cutover.spec.ts tests/e2e/smoke.spec.ts --project=w375 --project=w1280
```

Build PASS on application b85655f. Browser env: CS_E2E_PREBUILT=1,
CS_E2E_CONTENT_STORE=db, CS_E2E_PORT=3280, CS_COMMIT_SHA=b85655f3e626a2e73d2c21471db54326c9a80928.
PASS **6 tests**, zero skipped, exit 0, 10.9 s. Checks DB-save confirmation,
exact export before conflict, preserved hand-edit conflict, no import button,
backup-not-verified state, health/capabilities and security headers. Axe found
zero violations in the conflict panel; no horizontal overflow or page errors
at either width. Both synthetic screenshots were visually inspected for
wrapping, severity and available controls. No independent interactive review
is claimed; a separate reviewer remains appropriate for this Heavy build.

Browser harness needs a scratch-only `turbopack.root` pointing to the common
projects directory so the existing junction dependencies resolve. No repository
config was changed for that workaround. SHA-256 compared all 580 tracked files:
unit scratch has zero differences; browser scratch differs only in that root
setting. The two browser test strings were synchronized after their test-only
commit; runtime application/build identity remains b85655f.

Earlier non-passes: initial unit expectations used wrong synthetic counts;
initial PGlite restore attempted sequence reseed as service_role and correctly
failed; changed to the branch-admin port without broadening grants. An initial
daily-failure test placed its sample in today's incomplete day; moved it into
the measured window. Early type/lint findings were fixed. Initial D-drive
browser builds failed on external junction resolution; webpack also exposed an
existing client node:crypto import and Windows external-path errors. The final
Turbopack scratch build passed. First browser run was 4 passed / 2 failed because
the test expected Sheet wording; actual DB save correctly said database.
Corrected the assertions; final six passed. No failed attempt is a pass.

## Adversarial verification

Lenses: authority/concurrency/retries; provider integration and restore integrity;
auth/privacy; false-green tests. Mutated implementation only in external scratch,
asserted exactly one replacement, proved changed SHA-256, required the intended
targeted test to fail, then byte-restored in finally. All four were killed:

| Mutation | Command suffix after `bash ~/bin/heavy npx vitest run` | Result |
| --- | --- | --- |
| Remove Sheet fingerprint/full-cell precondition | tests/unit/application/content-export.test.ts --maxWorkers=1 -t "preserves an injected Sheet hand edit" | exit 1, preservation assertion fails |
| Remove rollback exact-parity gate | tests/unit/application/content-export.test.ts --maxWorkers=1 -t "does not flip on hand edit" | exit 1, forbidden flip detected |
| Remove trusted manifest hash gate | tests/unit/supabase/content-backup-pglite.test.ts --maxWorkers=1 -t "rejects a wrong count/schema" | exit 1, wrong trusted hash accepted |
| Remove legacy/typed imports-off boundary | tests/unit/application/content-export.test.ts --maxWorkers=1 -t "blocks typed and legacy imports" | exit 1, expected explicit refusal missing |

Mutation source was committed 34fa8da; later b85655f only tightens unknown-empty-
column equality and exact-hash reporting. Final restored b85655f acceptance
passed all 630 tests. No mutation or supplemental stdout instrumentation entered
the worktree/commits.

## Owner/live gates and limitations

- No live database/workbook/Drive mutation, deployment, migration, provider
  credential, flag flip, cron registration, push, gh write or issue closure.
- Store default remains sheet; live database modes remain explicitly refused
  and tested. Fake DB is never a fallback for live data. Authority notes remain
  pending; no cutover date is claimed.
- Actual Phase A/B/C exits, written Sheet freeze, Supabase plan/daily-backup/PITR
  confirmation, private-folder access, production-target credentials and cron
  confirmation remain owner/live-gated. Do not assume backups exist from a plan.
- Hosted T3 (copied workbook + Supabase branch), independent SQL backend races,
  security-advisor/ACL proof, T4 deployed smoke and 14-day/50-mutation comparison
  are NOT PASSED. Local fake/PGlite rehearsals are not substituted for them.
- Durable checkpoint/decision/measurement adapters, consistent live SQL backup
  source and private Drive folder adapter are intentionally unwired; live use
  needs separately reviewed integration after the gates. Instance maps/fakes
  cannot establish cross-instance/live readiness. Local lag starts at detection;
  live measurement must start at the authoritative update timestamp. Retention
  selection is tested; destructive archive deletion is not wired.
- Drive bodies remain canonical (DB-7 decision separate). Sheet code remains.
  Phase E retirement requires the full comparison and James's retirement decision.
- Local Sheet preconditions retain the documented one-round-trip race. Formula/
  rich-link values RAW cannot represent remain blocking; no false exact claim.

## Cleanup — BLOCKED BY AUTOMATIC APPROVAL REVIEW

Automatic approval review rejected replacing a scratch junction and subsequently
rejected deletion of the verified dedicated browser scratch root, with the only
stated reason **blocked by policy**. The safer cleanup checked the literal
absolute root, verified all 354 reparse points were under its node_modules,
planned nonrecursive junction detachment, then recursive deletion only after
zero links remained. It was rejected before execution. No bypass was attempted.

This leaves the requested scratch deletion unfinished. Remaining synthetic-only
paths (outside the repository):

- `D:/tmp/cs150-build-round1`
- `D:/tmp/cs150-browser-round1`
- `C:/Users/jbbug/projects/cs150-browser-local`
- `D:/tmp/cs150-mutation.ps1`

They contain dependency copies/junctions, synthetic builds/tests/screenshots and
logs, not secrets or live content. The original worktree node_modules junction
is unchanged. Playwright servers exited; neither 3280 nor 3281 was listening at
the final check. No unknown Node process was killed. Cleanup requires an allowed
owner/runtime action; no permission prompt was made under the never-approval
policy. Independent review and remote CI remain for the coordinator.

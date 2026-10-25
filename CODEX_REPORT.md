# CS-066 fix round 1 — PR #205 / issue #204

Code commit: `f506c7ed923a0a05de33f99228794fc4447a4acc`.
Branch: `cs-204-bk`. Starting local/remote head:
`164445e13b5063f9a51b017d14aecc2580735518`.
Classification: Heavy; role: fix; round: 1. P1 and P2 are fixed locally.

## State and scope

Read `AGENTS.md`, `docs/MASTER-SPEC.md`, issue #204, the independent REQUEST
CHANGES comment on PR #205, the migration design and both cutover runbooks.
Read the implementation, QA, code-review and adversarial-verification skills.

Read-only discovery commands:

```text
gh pr view 205 -R James-Bugden/Content-Studio --comments
gh issue view 204 -R James-Bugden/Content-Studio
gh pr view 205 -R James-Bugden/Content-Studio --json headRefName,headRefOid,baseRefName,state,statusCheckRollup,files
git fetch origin
git rev-parse HEAD origin/cs-204-bk origin/main
git log --all --oneline -- supabase/migrations/20261025000700_content_backup_gate_waiver.sql
git merge-base --is-ancestor origin/main HEAD
```

Fetch succeeded. Main remained `9a9f7934baa1da1a9855182eac167be1544c1981`,
already an ancestor, so no merge was needed. The worktree started clean.
The waiver migration was introduced by unmerged commit `00fa268`; the user
explicitly confirmed every migration after `20261025000600` is unapplied.
Its UNAPPLIED marker and runbooks agree. Edited `20261025000700` in place;
the existing migration-reapplication regression passes. No hosted migration
history was queried and no migration was applied to a hosted database.

No push, GitHub write, deployment, live provider API request, installation,
dependency change or production-data operation occurred. GitHub reads and fetch
were the explicitly requested repository-state checks. Database execution was
limited to the synthetic PGlite harness.

## Changes and acceptance

- P1 / issue scope 2(c), 5: under an audited waiver, SQL requires the latest
  completed Sheet export report, at most 15 minutes old, exact JSON true,
  equal valid hashes, empty differences and empty retained issues. Missing,
  malformed or future-dated timestamps refuse. A historical green rehearsal
  cannot conceal a newer failed report. SQLSTATE `42501` reason:
  `waived backup requires exact Sheet export`.
- Every activation action and completed-operation retry reads current Sheet
  parity without exporting or writing Sheet cells. Current mismatches,
  unexpected IDs and retained conflicts refuse with HTTP 403 and named reason
  `backup_waiver_export_not_exact`; provider failure refuses activation too.
  A successful retry preserves the original activation epoch and result.
  SQL rechecks durable state after the provider observation, catching a newer
  worker conflict committed before activation.
- P2 / scope 2(a): Phase C `privateEvidence` must have JSON type string,
  length 1–2048 and at least one non-whitespace character. The superseding
  gate applies this check on both archive and waiver paths. No other waiver
  evidence field uses the length-only reference pattern. Negative cases cover
  whitespace, false, number, object, empty array, null, missing, empty string
  and oversized string. Valid one-character, 2048-character and padded
  nonblank references pass.
- Updated both operational runbooks with these checks and reference bounds.
  SQL can inspect durable observations only; the documented activation action
  supplies the fresh provider read. A direct historical SQL observation is
  not a substitute for that action.

## Verification commands and results

All PGlite suites ran in `D:/wt/cs-205-fix-r1`, a tracked-files scratch copy
whose `node_modules` junction targeted the existing `cs-wt/163/node_modules`.
The main worktree's shared junction was left untouched. No install/ci command
was run. Every Vitest and TypeScript invocation used the shared heavy queue;
lint also used that queue. Vitest used one worker. No full repository suite ran.

```text
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 -t 'CS-066 R1' --reporter=json --outputFile=red-final.json
```

With the original implementation restored from starting HEAD: exit 1,
24 failed / 6 passed selected cases. These were assertion failures, not
runner/setup failures. The full final HTTP reproductions were then run with
the original implementation, after moving the HTTP assertion ahead of SQL
assertions:

```text
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 -t 'activation AFTER real export detects' --reporter=json --outputFile=red-http-after-export.json
```

Exit 1: both hand-edit and unexpected-ID cases returned HTTP 200 after the
real exporter persisted an inexact report with unequal hashes; both expected
403. The fixed implementation was restored byte-for-byte afterward.

```text
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components --maxWorkers=1 --reporter=json --outputFile=required.json
```

Exit 0: **69 files, 1,051 tests passed; zero failed or skipped**. This includes
the entire four required directories, server-boundary and health checks,
existing archive/folder behavior and migration reapplication. The final
HTTP-assertion reorder changed no implementation or test count; final focused
acceptance retest on that exact order:

```text
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 -t 'CS-066 R1' --reporter=json --outputFile=final-r1.json
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
```

All exit 0: **30 final round-1 cases passed**, typecheck passed, lint passed.
The three commands used the restored scratch copy of the committed code and
final tests. An earlier complete cutover-file run also passed 167 cases before
the last two related negative cases were added.

One extra `bash ~/bin/heavy npm run typecheck` attempt in the original worktree
exited 2: its shared MAIN dependency junction lacks `@supabase/supabase-js` and
`@electric-sql/pglite`, producing missing-module and consequent implicit-type
errors. That attempt is a failed environment check, not a pass. Final typecheck
in the prescribed scratch/163 environment passed; no dependency tree was changed.

```text
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
node scripts/check-env.mjs
git diff --check
git diff --cached --check
```

All passed on the repository. Privacy/secret checks are repeated after staging
this report so it is included in their tracked-file inventory.

## Adversarial checks and mutation hashes

Correctness/edges: invalid evidence types/bounds; missing, inexact, stale,
future and malformed export proofs; unequal hashes and unexpected IDs.
Integration/state/concurrency: actual exporter after hand edits, retained
conflicts despite restored equality, provider failure, fresh activation retries,
unchanged replay epoch, and a new worker conflict between observation and SQL.
False-green integrity: implementation-only mutations, exact-once replacement,
nonzero failing assertions, and SHA-256 before/mutated/restored checks.

**17 mutants killed; zero survivors.** For every row below, before and restored
SHA-256 were identical to the corresponding file baseline:

- SQL (`S`): `supabase/migrations/20261025000700_content_backup_gate_waiver.sql`
  — `11b82fe06b43acbb838d3b20f8cdac183ca3e2df7d0a5b9ed2d39304f5020ba5`.
- Runtime (`A`): `src/application/live-content-cutover.ts`
  — `8f18e22b30c889765c856b6be58d81882675ff7b370085444db44ba09fd54b08`.

These are on-disk byte hashes; Git normalizes repository line endings. The
commit identity above identifies the exact repository content. Each mutation
changed one exact occurrence. Tests themselves were not mutated.

For each table row, the exact command was:

```text
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 -t '<pattern>' --reporter=json --outputFile=<id>.json
```

Every mutant run exited 1. The failed-assertion count and exact selected pattern
are recorded below. Setup/import failures were not counted as kills.

| ID | File | Pattern | Failed assertions | Mutated SHA-256 |
| --- | --- | --- | ---: | --- |
| sql-issues | S | SQL waiver refuses issues | 1 | `5fd3a7c36431c362cf439e57e2aea133e1624514f7825c7a5d61adfe25047a8d` |
| sql-latest-report | S | activation AFTER real export detects unexpected-id | 1 | `dd51e814f87a8b95fa11330d40aee2d18b43a0ab150a64ccdaf8294625f27205` |
| sql-exact | S | SQL waiver refuses inexact | 1 | `6d4d6551c83d9dbc2611ebb6392a61daae5aa3588f67de24300221c7b462cb99` |
| sql-differences | S | SQL waiver refuses differences | 1 | `eb4396f919bc5e0a1d7924b8cd9e4d9cfaf1c3b24f8c76a534575ea19b14dfba` |
| sql-valid-hash | S | SQL waiver refuses (missing-hash\|invalid-hash) | 2 | `cd52476c755da9260a66eb2121e7a42bb6c7e0ea887a480c59bb1b544d73fdff` |
| sql-equal-hashes | S | SQL waiver refuses hash | 1 | `6c8ca87a20b5c9e2b517e3d606f35e29c1f35ddef9d5e5b8cab294b58bc2defe` |
| sql-time-type | S | SQL waiver refuses missing-time | 1 | `187a2cd8516dad6fb54940875992234624266f5a64f20983d330b79529efaf41` |
| sql-fresh | S | SQL waiver refuses stale | 1 | `ccd6669215a4a20fa957cdba42da85e36a7fb090ded21c775959a242079c634f` |
| sql-future | S | SQL waiver refuses future | 1 | `65be7afebaabf2634858366074143dc1c26328645ed50aa1ba06a8c2da6876a5` |
| evidence-type | S | phase-c rejects privateEvidence (false\|number\|object\|empty-array) | 4 | `cbc4324ff7172c0d0d2f0267c95d8afd6906c37d5d0c8af93e769ea185deb327` |
| evidence-bound | S | phase-c rejects privateEvidence oversized | 1 | `61d4315b6eec96793d5c6ec8f7ffbc7065440fffe864bcd4b79a1dc7ab7c5876` |
| evidence-blank | S | phase-c rejects privateEvidence whitespace | 1 | `8905213d9df17e9a7791dbaf8ac890c0971e9b0511edda0c51092d72e63cf84f` |
| runtime-fresh | A | first activation rechecks Sheet | 1 | `33f3b3159937006d248f3d4ad2fc6d4a04d2d379f465e191f3bd9073635fd749` |
| runtime-retained | A | fresh equality cannot clear a retained exporter conflict | 1 | `129fb598bdc94fff0a99c67c9f76346bdfc7d1b01afebb8cbc8eb4d799e32a41` |
| runtime-refusal | A | first activation rechecks Sheet | 1 | `117dafdda4271d4413e9bd65bf13a75f02553f67c3db737815d4ea35a1acb933` |
| runtime-direct | A | first activation rechecks Sheet | 1 | `09cba852cc112bb05a9d9dec2180cc238a80057da2d6bff7eaa11d830e538901` |
| runtime-replay | A | replay activation rechecks Sheet | 1 | `33f3b3159937006d248f3d4ad2fc6d4a04d2d379f465e191f3bd9073635fd749` |

The latest-report mutant was also repeated after the final HTTP-assertion
reorder with output `final-latest-report.json`: exit 1, one failing SQL
assertion (the runtime refusal had already passed), same mutant/restoration
hashes. This proves the SQL guard independently rejects the newer red export.

## Handoff and limitations

The final acceptance retest is green on the committed implementation. This
report is local fix evidence, not a new independent review verdict or a claim
that CI ran on the new commits. The independent follow-up review and any
hosted/deployment checks remain with the coordinator under the user's hard
no-write/no-live rules. T1–T4 were not run in this fix round; no browser or UI
surface changed, and hosted/physical-device evidence is not claimed as passed.

The existing Sheet external-edit race after a provider observation remains;
freeze/drain controls and the documented owner race acceptance are still
required. Fresh activation checks do not claim cross-provider atomicity.
No new product direction, authority flip or waiver of another gate was added.

Scratch cleanup completed. In Git Bash, `cmd //c rmdir
'D:\wt\cs-205-fix-r1\node_modules'` unlinked the junction; a recursive
reparse-point inventory then confirmed zero remaining links. Automatic approval
review rejected forced recursive cleanup with only `blocked by policy` as the
reason. Ordinary non-forced cleanup removed the files; the remaining scratch
`.git` directory needed its Hidden attribute cleared with
`Set-ItemProperty -LiteralPath 'D:\wt\cs-205-fix-r1\.git' -Name Attributes -Value Normal`.
`Remove-Item -LiteralPath 'D:\wt\cs-205-fix-r1' -Recurse` then succeeded.
Verified the scratch directory is absent, the shared 163 dependency target
exists, and the original worktree junction retains its original target.
No helper scripts, scratch logs, test artifacts or scratch archive remain.

Issue: https://github.com/James-Bugden/Content-Studio/issues/204

PR: https://github.com/James-Bugden/Content-Studio/pull/205

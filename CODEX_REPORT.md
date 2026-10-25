# CS-063 / PR #199 — fix round 2

Heavy; role: fix; final allowed round. 2026-10-25 (Asia/Taipei).
Issue: [#197](https://github.com/James-Bugden/Content-Studio/issues/197).
PR: [#199](https://github.com/James-Bugden/Content-Studio/pull/199).
Independent review addressed: [6393844142](https://github.com/James-Bugden/Content-Studio/pull/199#issuecomment-6393844142).
Assigned branch/worktree: `cs-197-live` only.
Starting local/remote: `7ae9721d087f310d8b5a5bc1d8a538c833e49935`.
**Code commit: `5749cb9e29d0d6e9788b04b5844c43cc1f326ad7`.**
This report is committed separately after code verification; no code changed afterward.
Synthetic production-build ID: **`WmuYmlUzfD4C5wdiWCyAO`**.

## State and constraints

Read AGENTS.md, MASTER-SPEC, issue #197, both PR reviews, the supplied
`D:/wt/briefs/cs/report197b.md`, migration design, ADR-0002, Phase A
apply/rollback runbook, `probe199b.test.ts`, `mut2.mjs` and `mut2.log`.
Applied the implementation, qa-regression and adversarial-verify skills.
This is builder self-review/adversarial evidence, not a new independent Opus verdict.

Read-only state commands:

```sh
git status --short
git branch --show-current
git log -3 --oneline
git fetch origin
git rev-list --left-right --count HEAD...origin/main
git rev-parse HEAD origin/main origin/cs-197-live
gh pr view 199 -R James-Bugden/Content-Studio --comments
gh issue view 197 -R James-Bugden/Content-Studio
gh issue view 197 -R James-Bugden/Content-Studio --json body --jq .body
```

Initial tree clean; branch and remote matched the supplied starting SHA.
Fetched `origin/main` was `daa475f580b1a3860c786eb48e463418a4f80576`;
divergence `6 0`, so main was already an ancestor and no merge was needed.
Only additive commits were made. No rebase/history rewrite, push, GitHub
write, other-worktree change, hosted migration, live provider API call,
deployment or production flag change. No dependency was added and no
`npm install`/`npm ci` was run. The assigned node_modules junction remains
unchanged and targets the main checkout.

## Fixes and acceptance evidence

| Review item | Result |
| --- | --- |
| Blocker 1: permanently failing reads | Waived readiness counts provider failures and tolerates at most **one failed read per collection** in the evaluation window, only alongside a successful comparison for that collection. Two failures block, even with equal successful comparisons. Each of the six collections has a boundary regression: absent comparison fails; provider failure alone fails; one failure plus measured empty equality passes; the second failure fails. The exact W-B probe with 50 failures each for ready and queue_summary reports 100 failures and ready=false. |
| Blocker 2: missing collections | All six collections require an independent successful sampled comparison: library, queue, ready, schedule, queue_summary, workflow_settings. W-A's lone library sample now fails. The previous test claiming readiness with one sample was corrected to require all six plus a fresh import. Measured empty equality remains valid; absence of measurement does not. |
| Blocker 3: stale import | The waiver now enforces current import age <=900,000 ms, as the historical path does. W-C's three-day-old import fails. Tests pin null, 900,000, 900,001 and three days while historical sample lag stays green, isolating the current-age check. |
| Sampled blocking mismatch | A sample at exactly 99.9% equality passes only with blocking=0; setting blocking=1 fails. Implementation mutation removing this guard is killed. |
| Persistence recovery | A failed sample remains unavailable through successful refresh, failed refresh and later successful refresh. The next successful sample save recovers the persistence gap. A failure generation counter prevents an older in-flight save or the late completion of a budget-timed-out save from erasing it. A successful save cannot clear HISTORY_UNAVAILABLE; history must refresh successfully. Tests exercise RPC timeout, the wrapper's 500 ms budget, concurrency and recovery. |
| SQL classified equality | Existing subtraction is correct and now pinned: seven measured fields with two classified source differences plus formula-display/blank-boolean equivalences yield equal=5, unclassified=0. Removing subtraction is killed. |
| SQL missing stored row | A trigger replaces an imported ID while preserving total row count. The original ID's absence must yield idsEqual=false. Removing the missing-row guard is killed independently of the total-count check. |
| SQL invalid waiver | Three invalid values must raise SQLSTATE 22023 before import/event mutation, preserving the running lease job. Removing SQL waiver validation is killed. |
| Honest operations documentation | The runbook explicitly explains that full-import parity is close to read-back against rows import_run just wrote, using jsonb_populate_record on both sides. It cannot prove adapters/views/read paths; all six independent comparisons stay mandatory. The runbook states the exact failure tolerance, current-age requirement and persistence recovery behavior. |

No migration source changed: the three SQL guards already behaved correctly;
new PGlite tests pin them. SQL executed only in the local in-memory test harness.
Default Sheet behavior and live db-read/db refusal remain covered by the required
application/security/Supabase suites.

## Verification commands and results

The shared dependency junction lacked PGlite/Supabase and had version mismatches.
Validation therefore used a standalone physical source/dependency copy under
`D:/wt/cs199-fix2-validation`, with its own `git init` metadata. Copied installed
packages were supplemented only from the existing npm cache, verifying each
archive against package-lock integrity using npm's bundled cacache/tar modules.
All 27 direct installed versions matched the lockfile. Initial preparation
stopped on an optional bundled dependency without its own integrity; filtering
children of incompatible/uninstalled platform parents resolved preparation.
No failing prerequisites are counted as validation passes.

All **626 tracked source/test/migration/doc/config files** matched this worktree
by SHA-256 before and after build/browser verification. No private environment
files or live credentials were copied. Every Vitest, typecheck, lint, build and Playwright invocation ran
through `bash ~/bin/heavy`; mutation child tests inherited its held queue slot.
No full test suite was run and no unrelated Node process was killed.

```sh
node D:/wt/cs199-fix2-tools/prepare.cjs

# CS_TEST_MODE=unit; first run before code fix: deliberate red regressions
bash ~/bin/heavy npx --no-install vitest run tests/unit/supabase/content-shadow-boundaries.test.ts tests/unit/supabase/content-shadow-pglite.test.ts --maxWorkers=1 --silent

# Same command after code fix, and again after restoring every mutation
bash ~/bin/heavy npx --no-install vitest run tests/unit/supabase/content-shadow-boundaries.test.ts tests/unit/supabase/content-shadow-pglite.test.ts --maxWorkers=1 --silent

bash ~/bin/heavy npx --no-install vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components --maxWorkers=1 --silent
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint

bash ~/bin/heavy node D:/wt/cs199-fix2-tools/mutations.cjs
bash ~/bin/heavy node D:/wt/cs199-fix2-tools/mutations.cjs R2-12

# CS_DATA_MODE=fake; CS_TEST_MODE=e2e
# CS_COMMIT_SHA=5749cb9e29d0d6e9788b04b5844c43cc1f326ad7
bash ~/bin/heavy npm run build

# Same env plus CS_E2E_PREBUILT=1; CS_E2E_PORT=3497
bash ~/bin/heavy npx --no-install playwright test tests/e2e/content-parity.spec.ts --project=shadow-w375 --project=shadow-w1280

node D:/wt/cs199-fix2-tools/manifest.cjs
git diff --cached --check
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
node scripts/check-env.mjs
```

- Deliberate pre-fix run: **13 failed, 40 passed**, exit 1. It reproduced all
  three blocker probes and persistence-recovery defects; SQL cases already passed.
- Post-fix targeted run: **53/53**, exit 0; restored-source final retest:
  **53/53**, exit 0 (5.27 s). No selected test skipped.
- Required directories: **64/64 files, 855/855 tests**, exit 0 (132.62 s).
  Security scanner tests intentionally emit synthetic attack-fixture findings;
  the separate worktree secret scan is clean. Two jsdom navigation notices are
  advisory output, not skipped tests or failures.
- Typecheck, whole-repository lint and production build: exit 0. Build used
  Next.js 16.4.1 and the code SHA above; compilation and build-time types passed.
- T1: **2/2 browser tests**, exit 0 (10.5 s), production artifact and local ports
  3497/3498. Import, idempotent replay, honest unknown/full-import status, ledger,
  overflow, axe and page-error checks passed at 375/1280 px.
- Supporting T2: inspected both synthetic full-page screenshots; text/hashes
  wrap, missing measurements remain visible, controls are readable and no
  horizontal overflow appears. This does not claim live-waiver browser evidence;
  waiver logic is tested in unit/PGlite tests. No new layout was introduced.
- Private-path policy, secret scan, env validation and diff whitespace: clean.

## Adversarial verification

Three lenses: readiness correctness/unknown states; persistence failure/recovery
and concurrency; SQL integrity/validation and false-green test resistance.
**12 distinct implementation mutations killed**, each applied at exactly one
verified site, changed SHA-256, failed for its intended assertion and restored
original bytes with matching SHA-256:

1. Accept unmeasured collections.
2. Raise provider-failure allowance from one to 50.
3. Omit current import freshness under the waiver.
4. Ignore sampled blocking mismatches.
5. Let refresh erase a persistence gap.
6. Never recover after a subsequent saved sample.
7. Let an older save erase a newer failure.
8. Ignore the persistence-budget timeout.
9. Forget the persistence gap during a history outage.
10. Stop subtracting classified SQL differences.
11. Ignore missing stored IDs with equal total counts.
12. Accept an invalid SQL waiver.

The first mutation-runner command exited 1 solely because its classifier
recognised AssertionError but not the harness's explicit “expected the query
to be rejected, but it succeeded” assertion for mutation 12. The SQL tests did
fail for the intended reason. After inspecting that output, the classifier
was corrected and only mutation 12 was rerun: killed, restored, runner exit 0.
This is not an implementation survivor. Untouched final code then passed the
53-test acceptance retest and production build/browser checks above.

Ignored local evidence is retained under `artifacts/cs199-fix2/`: exact cache
preparation/manifest/mutation scripts, complete logs, per-mutant logs/hashes,
dependency versions, file manifest, BUILD_ID, screenshots and cleanup inventory.
No evidence artifact or dependency was committed.

## Cleanup and remaining gates

Before cleanup, both owned scratch roots were resolved against exact literal
absolute paths and recursively inventoried: **zero reparse points** in each.
No scratch junction needed detachment. The assigned node_modules junction was
never detached, replaced or recursively deleted. Browser processes were owned
and stopped by Playwright; the local listener query found neither test port
listening (its empty-result PowerShell status is not a failed browser check).

**Cleanup blocker:** automatic approval review rejected native PowerShell
recursive deletion as **“blocked by policy.”** The verified-root deletion loop
was rejected, then the safer literal-path command was also rejected:

```powershell
Remove-Item -LiteralPath 'D:\wt\cs199-fix2-tools' -Recurse -Force
```

No other deletion mechanism was used to bypass the rejection. Exact leftovers:

| Root | Files | Bytes | Reparse points |
| --- | ---: | ---: | ---: |
| `D:/wt/cs199-fix2-validation` | 32,231 | 823,973,096 | 0 |
| `D:/wt/cs199-fix2-tools` | 26 | 217,017 | 0 |

`artifacts/cs199-fix2/` is intentionally retained as ignored evidence.
The supplied review scratch and all other worktrees were left unchanged.

Local fixes and required validation are complete. Independent Opus acceptance
and required hosted CI on the new SHA remain coordinator gates; starting-head
green CI is not claimed for this commit. Hosted RLS/ACL denial, independent
backend locks/kill recovery, real latency against the 500 ms budgets, production
cron support/completion and actual full-source production parity remain live
checks. This runtime performed none of them. No live cutover or issue closure
is claimed, and no remote write is authorised by this report.

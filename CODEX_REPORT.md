# CS-063 / PR #199 ? fix round 1

Heavy; role: fix. 2026-10-25 (Asia/Taipei).
Issue: [#197](https://github.com/James-Bugden/Content-Studio/issues/197).
PR: [#199](https://github.com/James-Bugden/Content-Studio/pull/199).
Review: [6393377342](https://github.com/James-Bugden/Content-Studio/pull/199#issuecomment-6393377342).
Branch: `cs-197-live`, assigned worktree only.
Starting local/remote head: `ca8fb8280f4351435b16462e1e9638d66f364a17`.
Code commit: **`ad263c0f14df7e54a918c332321ed4f775bdd6b0`**.
This report is a subsequent documentation-only commit.
Production-build artifact (synthetic local runtime): **`HIW8RyE-FUvc96HmfYUaW`**.

## State and scope

Read AGENTS.md, MASTER-SPEC, issue, review, report197.md, migration design,
ADR-0002 and the Phase A apply/rollback contract. Used implementation,
qa-regression and adversarial-verify skills. This is builder self-review and
adversarial testing, not a new independent Opus verdict.

Read-only state commands:

```sh
git status --short
git branch --show-current
git log -3 --oneline
git fetch origin
git rev-list --left-right --count HEAD...origin/main
gh pr view 199 -R James-Bugden/Content-Studio --comments
gh issue view 197 -R James-Bugden/Content-Studio
```

Initial tree was clean. Fetched `origin/main` was
`daa475f580b1a3860c786eb48e463418a4f80576`; divergence was `3 0`, so main
was already an ancestor and no merge was necessary. After the code commit,
divergence is `4 0`. No rebase, history rewrite, push, GitHub write, migration
apply to a hosted database, live provider call, deployment or flag change was
performed. Other checkouts received no writes; the complete dependency tree
was read and copied from an existing validation checkout only.

## Review items addressed

| Item | Change and evidence |
| --- | --- |
| 1 ? durable samples/history | Exact sample RPC payload and unique event identity asserted for every collection. RPC failures preserve Sheet results, append no successful evidence and expose `SAMPLE_PERSISTENCE_FAILED`. Repeated refresh counts once; failed events reconstruct the one-hour gate; prepare loads capture time; reload lag uses capture rather than completion; failed refresh clears stale failure state and names `HISTORY_UNAVAILABLE`. |
| 2 ? actual live comparison | Live failure tests require DB requests, seven sample RPCs and provider-failure samples while comparing list/schema/detail/save/replay/conflict JSON byte-for-byte with Sheet mode. A separate test sets normal sampling to zero and proves reconcile still reads the DB and persists a sample. Removing either live wrapper is killed. |
| 3 ? thresholds | Boundary tests pin 199/200 samples, 6/7 complete days, 99.89/99.9 percent fields, p95 900,000/900,001 ms, and failure duration 3,600,000/3,600,001 ms. Historical day/sample gates remain available when the waiver is off. |
| 4 ? REST boundary | Authorization/API-key headers, no-store and abort deadline are asserted outside the fetch mock's catch boundary. Real abort, 401, 403/RLS, 409, 429 and 500 are exercised. Error messages/details/stacks, telemetry, console and stdout/stderr captures exclude the synthetic service key and provider body. |
| 5 ? minor guards | Tests require a live lease, `{ok:true}`, release with the claimed token on import failure, rejection and sanitisation of replay evidence, stale-token release refusal for the same reclaimed operation, and running job status before import. The runbook explicitly identifies the missing-advisory-lock probe as beyond PGlite's single-connection capability. |
| 6 ? measured gates and waiver | The still-unapplied Phase A import RPC compares every typed input row/field with stored rows inside the import transaction, measures full ID sets including unexpected retained rows, and persists full parity plus the exception ledger. Source conversion differences remain classified; stored-field differences are unclassified and block. `CS_PARITY_WINDOW_WAIVED=2026-10-25` must be explicitly forwarded and durably recorded with owner/date/database timestamp. Both the switch and audit are required. The waiver removes the calendar/sample wait, while full parity, >=99.9 percent equality, zero unknown exceptions, sampled equality, lag p95 <=15 minutes and the one-hour import-failure gate remain required. A named provider timeout is counted/displayed without vetoing exact full-import parity. No samples or missing full-import evidence remains unknown/red. `/reconcile` shows the waiver and measured facts without masking failed checks. |
| 7 ? invalid configuration | Missing/malformed URL or short/missing key degrades live shadow to a visible `CONFIG_MISSING` gap. Sheet reads and authenticated saves still work; import refuses before providers. Other compositions retain their prior environment validation. |
| 8 ? uppercase key | UUID is normalised before operation identity/hash/SQL claim. Application and actual owner-route tests assert lowercase claims from uppercase headers. |
| 9 ? operability | Lease is 65 seconds against both routes' 60-second maxDuration; SQL and route tests pin that contract. Runbook describes five-second capture recovery and transaction-drain limits. History uses one bounded 30-day MVCC snapshot with prior import/failure carry-in; SQL returns at most 50,001 events and the reader refuses >50,000 rather than accepting truncation. Legacy mirror + db-shadow explicitly refuses before claim with configuration instructions. Failed refresh clears stale failureSince and repaired failures. |

Only the PR's **still-unapplied** `20261025000500_content_shadow_live.sql` was
changed; no previously applied migration was edited. Its import RPC now has
an optional ninth waiver argument, and grants plus exact rollback signatures
were updated. The runbook retains the complete six-migration apply order.
The old non-lease import RPC retains its original seven-argument payload.
No dependency was added.

## Verification on the final code

All Vitest, typecheck, lint, build and Playwright executions used the shared
`bash ~/bin/heavy` queue. Mutant executions held a queue slot and nested
commands inherited that lock. No full suite or unrelated process kill.

Final validation ran in an external physical source/dependency copy. All 27
direct installed package versions matched the lockfile. All **626 source,
test, migration, script, doc and config files** matched the assigned worktree
by SHA-256 before and after build/Playwright. Scratch Git metadata was created
with `git init`; it is a standalone directory, not a worktree pointer.

```sh
# CS_TEST_MODE=unit; synthetic providers only
bash ~/bin/heavy npx --no-install vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components --maxWorkers=1 --silent
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint

# CS_DATA_MODE=fake; CS_TEST_MODE=e2e; CS_COMMIT_SHA=ad263c0f14df7e54a918c332321ed4f775bdd6b0
bash ~/bin/heavy npm run build

# CS_E2E_PREBUILT=1; CS_E2E_PORT=3397; same CS_COMMIT_SHA
bash ~/bin/heavy npx --no-install playwright test tests/e2e/content-parity.spec.ts --project=shadow-w375 --project=shadow-w1280

git diff --cached --check
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
node scripts/check-env.mjs
```

- Required directories: **64/64 files, 834/834 tests passed**, exit 0,
  114.70 seconds. No skipped selected test.
- Typecheck, whole-repository lint and production build: exit 0.
- T1: **2/2 passed**, 10.0 seconds, repository Playwright configuration,
  production artifact, isolated local ports 3397/3398. Import/replay,
  honest unknown/full-import labels, ledger expansion, overflow, axe and
  page-error assertions passed at 375 and 1280 px.
- T2: inspected both synthetic full-page screenshots. Parity copy and hashes
  wrap, the ledger is bounded, and controls remain readable. Waiver and named
  configuration-gap/error states also have component assertions. This does
  not claim a live-provider browser review or physical-device evidence.
- Private-path policy, secret scan, env check and cached diff whitespace:
  clean. Scanner unit tests intentionally emit synthetic attack-fixture
  findings; the separate repository scan is clean.

Initial attempts are not counted as passes: the assigned node_modules junction
lacked PGlite/Supabase, so an initial SQL run/typecheck failed. Reused a complete
existing physical installation without npm install/ci. The first external
required-directory run had 826 passing tests and failed only the two security
suites requiring missing Git metadata; added standalone scratch metadata and
reran the complete required directories green. A robocopy attempt exited 16
because MSYS converted flags; physical Python copying succeeded afterward.
An initial scratch sync ran from the wrong cwd and failed before copying;
explicit-source sync and the final 626-file manifest verified the result.

## Adversarial mutation evidence

**34 distinct implementation mutations killed** in their final attempts.
Each applied at exactly one verified site, changed SHA-256, exited 1 for the
intended assertion, and restored the original bytes. Untouched final source
then passed all required directories above. The missing advisory-lock mutant
is not included as killed: PGlite cannot establish independent-backend locks.

- Review probes: M08, M09, M10, M11, M15, M16, M17, M18, M19, M20, M21,
  M22, M23, M24, M25, M26, M31, M39, M40, S10, S13.
- Added probes N01?N13: waived lag threshold, full-import ID/unknown/equality
  gates, one-hour threshold, UUID normalisation, lease lifetime, history
  window, stale failure state, waiver bypass of measured gates, configuration
  fallback, stored-field comparison and waiver forwarding.
- The first M20 attempt exposed an assertion swallowed inside mocked fetch;
  moved that assertion outside the caught boundary and killed the mutation.
  M25 still executed `.parse()` but discarded its sanitised result; added an
  unexpected-payload stripping assertion and killed it. Initial non-applied
  multiline/duplicate-site probes were corrected before counting final results.
  The waiver-forwarding probe caught an extra parameter on the legacy RPC;
  corrected it and added an exact legacy payload assertion.

Ignored evidence is retained under `artifacts/cs199-fix1/`: exact queue runner,
full mutation runner/log/hashes and verdicts, final/initial test logs,
checks.json, source manifest, BUILD_ID, both synthetic screenshots and scratch
inventory. These files are not committed.

## Cleanup and remaining gates

The assigned node_modules junction is unchanged and still targets the main
checkout. No npm install/ci or modification of that installation was used.
The temporary scratch junction to shared dependencies was detached individually
before replacing it with a physical dependency copy. Final inventory confirmed
**zero reparse points** in both owned scratch directories. Playwright completed
and stopped its own servers; no unrelated Node process was killed.

**Cleanup blocker:** automatic approval review rejected native PowerShell
recursive deletion with **?blocked by policy?**, despite verified literal
absolute roots and zero reparse points. A second, simpler literal-path removal
of the tools directory was also rejected. No alternative deletion mechanism
bypassed those refusals. Exact leftovers:

- `D:/wt/cs199-fix1-validation`: **32,442 files / 785,254,508 bytes**, including
  physical dependencies, local build, tests and standalone Git metadata.
- `D:/wt/cs199-fix1-tools`: **4 files / 38,750 bytes**.
- `D:/wt/cs199-fix1-deps` was moved into the validation root and no longer exists.
- Worktree `artifacts/cs199-fix1/` is intentionally retained as ignored evidence.

Local fix/verification is complete. Coordinator still needs independent review
and required hosted CI on this new code SHA, then the separately authorised
migration/deployment workflow. Hosted RLS/ACL denial, independent-backend
concurrency and kill recovery, real latency against the 500 ms budgets,
production cron support/completion, and actual full-source parity remain live
checks. PGlite/fake/browser results do not prove them. Set the explicit waiver
only through the documented production configuration and retain its audit.
Live db-read/db remain refused. No production cutover is claimed.

# CS-062b / #174 — build round 1

Tier: standard. Role: build. Date: 2026-10-25. Branch: `cs-174-te`.
Issue: https://github.com/James-Bugden/Content-Studio/issues/174
Validated code commit: `fa1e7d43359df0fd544f772c000081c54ddc27a6`.
Base: `2a144af` (the supplied `origin/main`). This following commit adds only
validation documentation; application code, tests and config match that head.
Production BUILD_ID: `yZZRTG0A7v1Bspim5khXA` (synthetic providers, Next 16.4.1).

## Result and acceptance

- Added the distinct `Symbol.for('content-studio.AppError')` brand, retained
  `instanceof` first and the closed code/details checks. Foreign module and VM
  realm instances preserve identity; well-formed unbranded Error objects fail
  closed. Deliberate in-process symbol forgery is documented and tested as an
  accepted boundary, not represented as a security sandbox.
- Replaced the Markdown and Backlog structural fallbacks with `isAppError`,
  preserving their respective unknown defaults. Same-graph errors and all
  catalogue messages are unchanged. No #144 fallback rules changed.
- Added real VM-module, forged Error, Replies rejection, malformed brand,
  same-graph and consumer regressions. Updated the old Drive test to construct
  a genuine independently imported AppError instead of an unbranded fixture.
- Searched all `src` for AppError name checks, `ERROR_CODES`, code membership
  and `'code' in` workarounds. Remaining client API-envelope handlers, Replies
  recovery and SQLSTATE parsing have different contracts and were left intact.
- All 18 requested page/code combinations already existed in the sweep.
  [The coverage matrix](docs/testing/typed-error-recovery.md) maps each to its
  injected tab and designated state. No Playwright spec was changed or added.
  Fresh production tests prove all 72 combinations including roles/widths.
- T0 and requested T1 passed locally. CI and independent review remain pending;
  this build role does not claim independent review, merge readiness or live
  deployment evidence. No new render/layout interaction was introduced; no
  separate T2, physical-device or live-provider verification is claimed.

## Red-before-change / mutation evidence

Before implementation, the three targeted files produced **5 failures and 13
passes**: VM realm recognition, forged Error rejection, Markdown rejection,
and Backlog rejection in both Posts and Ideas.

After completing validation, replaced only these scratch source files with
their exact `2a144af` versions: `src/domain/errors.ts`,
`src/application/markdown-source.ts`, `src/app/(studio)/backlog/page.tsx`.
The final new tests then exited **1: 6 failed, 21 passed, 3 failed files**
(4.16 seconds). The additional failure documents brand-based recognition
without a matching Error name. This is the recorded pre-change mutation,
not an assertion that an unrelated test crash proves the regression.

```sh
bash ~/bin/heavy npx vitest run tests/unit/errors.test.ts tests/unit/application/markdown-error.test.ts tests/unit/components/backlog-error.test.tsx --maxWorkers=1
```

Restored all three files from the validated commit: hashes of every tracked
source/test/script and relevant package/config file matched again (zero
mismatches). The same targeted command then passed **27/27** (4.28 seconds).
The working branch was never mutated for this proof.

## Commands and fresh results

All heavy commands used the shared queue. No full unit suite was run.
The complete requested directories, plus the implementation skill's Supabase
directory and changed Drive test, ran with one worker:

```sh
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/components tests/unit/supabase tests/unit/errors.test.ts tests/unit/google/drive-saga.test.ts --maxWorkers=1
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
bash ~/bin/heavy npm run build
```

- Unit: **61 files, 858 tests passed**, 152.16 seconds; no skipped checks.
- Typecheck: exit 0. Full repository lint: exit 0.
- Production build: exit 0; synthetic `CS_DATA_MODE=fake`, `AI_PROVIDER=fake`.
- Production Playwright: both repository fault projects at 375 and 1280 px,
  three requested codes, **6/6 tests and 240/240 report rows passed**. Exactly
  72 rows cover the six requested pages × three codes × two roles × two widths.
  Execution: **55,432.16 ms**, below the 240-second reported target. This is a
  selected subset, not a fresh whole-sweep timing. The full sweep workload is
  unchanged. Exact command is in the linked matrix document.
- `git diff --check`, private-path policy and secret scan passed.

Ignored local evidence: `artifacts/cs174/cs174-scratch-{unit,typecheck,lint,build,e2e,mutation,restored}.log`
and `sweep-report/cs174/{coverage.json,coverage.md}`. The initial environment
failure logs are also retained in `artifacts/cs174/`.

## Environment and GitHub state

The supplied `node_modules` junction points to MAIN's dependency tree, which
has older installed versions (e.g. Next 16.3.6) and lacks Supabase/PGlite.
Initial typecheck failed on missing packages; initial unit run had 54 passing
files/619 passing tests and seven import-failed suites. Initial build failed
because Turbopack rejects an external node_modules junction. Those runs are
not counted as passes. Initial full lint passed.

Validation was recovered without installs or changes to the junction: copied
source and the existing physical dependency tree from worktree 163 into
`C:\Users\jbbug\cs174-validation-20261025`. All direct installed versions matched
the lockfile. All tracked runtime/test/script/config hashes matched the code
commit before the production build and again after mutation restoration.

Read AGENTS, MASTER-SPEC, implementation/QA procedures, #174, merged #171 and
its review comment, the relevant sources/tests and sweep contract. #174 is
OPEN; #171 is MERGED (`3bc1ba2`). GitHub could not resolve PR #195, so no PR
was updated. #170 was already CLOSED when inspected, contrary to the issue's
request to keep it open. No GitHub writes, pushes, account changes or
deployments were attempted. Review and CI must be supplied by the next role.

## Exact cleanup leftovers / blocker

Recursive deletion of the scratch copy was rejected by automatic approval
review with only **“blocked by policy”**, including a literal-path deletion
after verifying the path and finding **zero reparse points/junctions**. No
junction needed detachment. Cleanup could not be completed by this runtime;
no alternate deletion mechanism was used to bypass that rejection.

Retained paths:

- `C:\Users\jbbug\cs174-validation-20261025` — entire scratch checkout and
  physical dependency/build/test output: **31,788 files, 782,128,712 bytes** at
  inventory time. Exact file paths/sizes: ignored
  `artifacts/cs174/scratch-leftovers.json`.
- `C:\Users\jbbug\projects\cs-wt\195\.next` — initial failed-build output,
  **22 files**; exact paths/sizes in `artifacts/cs174/build-leftovers.json`.
- `C:\Users\jbbug\AppData\Local\Temp\next-panic-d7e635b8b910f82352dbc44a1ff96623.log`
  — initial junction-build panic log.
- Assigned-worktree evidence directories `artifacts/cs174/` (eleven command
  logs plus the two inventories) and `sweep-report/cs174/` (coverage JSON and
  Markdown) are intentionally retained and ignored.

The pre-existing MAIN `node_modules` junction remains unchanged. No other
scratch checkout or junction was created. Playwright owned and stopped its
synthetic server processes; no unrelated Node process was killed.

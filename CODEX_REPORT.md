# CS-075 — PR #231, fix round 1

Fixed the three blocking P1 findings from the read-only [PR #231 review](https://github.com/James-Bugden/Content-Studio/pull/231) for [issue #229](https://github.com/James-Bugden/Content-Studio/issues/229), in the existing isolated `fix/229-parity-shape` worktree. Classification: **Heavy**; scoped bug fixes, no PRD required.

Reviewed head/base for this fix: `68148a5bc1e372853f444e33b1b9f47cdf85cb84`. Implementation/test/runner tree before replacing this report and adding the new mutation evidence: `3064bdcfb3019bd34022c7d5be4ed987535b6644`. The containing commit identifies the final build. Previous build-round evidence remains historical at that parent commit; it does not establish these fixes.

## Fixes and acceptance evidence

| Finding | Result and committed regression |
| --- | --- |
| P1-1: invalid calendar dates compare equal and import | The shared parser checks the written year/month/day, Gregorian leap-year rules, hours, minutes, seconds and offset components before calling `Date.parse`. Years are 0001–9999; minute/second and offset-minute ranges are 00–59, offset hours 00–23. Existing minute-only timestamps and exactly `24:00` (zero seconds/fraction) remain accepted. Impossible days, invalid times, ambiguous offsets and malformed hash suffixes cannot qualify for equivalence. Import and patch conversion refuse them. Parity still compares invalid text exactly, without normalizing it. `content-timestamps.test.ts` covers February 30, non-leap/century February 29, month ends, zero/out-of-range components, offset signs and boundaries, 24-hour policy, and valid leap/year/date boundaries. |
| P1-2: exact rollback changes the original timestamp bytes | Import retains the entire `finalSyncedAt` cell in reserved `passthrough.@final_synced_at` metadata, using the existing angle/score pattern. The adapter renders it only if the preserved text still parses to the current DB instant **and** exact hash. Changed seconds, microseconds, hash or cleared timestamps discard the stale rendering; malformed metadata is ignored. Metadata never becomes an unknown exported column. Library/Queue currently have no such field: no field/schema was added, and their renderers strip the reserved metadata too. |
| P1-2: complete SQL/export/rollback proof (MIG-09/MIG-12) | `content-timestamps-pglite.test.ts` applies the complete sorted existing Content migration chain and executes the actual import and patch RPCs. Repository/export reads query the actual PGlite tables, with PostgreSQL JSON timestamp serialization retaining microseconds. Tests prove byte-identical original cells and whole Schedule grids through import, export and rollback for positive/negative offsets, `.1200`, `Z`, microseconds, exact Unicode/tab hash text, minute-only and 24:00 forms. A same-instant SQL patch retains the original; edited instants/fractions/hashes and clearing export the current value. Exact parity and matching hashes are asserted after rollback. |
| P1-3: equality allowance extends to other timestamps | The new schedule `value.*` comparison and field-equality accounting apply only to `finalSyncedAt`. `publishedAt` and `analyticsSyncedAt` retain their previous behavior: a timestamp-formatting cell fact remains unequal, while a changed typed value blocks. Dedicated regressions assert both the blocking count and field-equality accounting, including cell-only comparisons. |
| Reviewer's independent probes | Committed the saved reviewer probes as `tests/unit/supabase/independent-parity-review.test.ts`, changing only the support import path for its directory. Before fixes: **22 passed, 5 failed**, reproducing the two calendar failures, two overbroad parity failures and SQL/export/rollback failure. After fixes: **27 passed**. |

The Ready Queue, derived summary, lag behavior, thresholds, gate SQL and existing migrations retain the prior implementation. No migration is needed.

Existing database copies need a fresh Sheet-authoritative import to acquire the raw timestamp metadata. A timestamp normalized by an older import cannot recover its original cell bytes from `timestamptz` alone; the coordinator should re-import on this build before live exact rollback verification.

## Local verification

All work used synthetic fixtures and local PGlite in a scratch **copy** at `D:/wt/cs-231-fix-r1`, with a junction to the existing `C:/Users/jbbug/projects/cs-wt/163/node_modules`. Scratch-only Git metadata was initialized for the security scanner checks. No dependency was installed. Every Vitest and typecheck invocation used `bash ~/bin/heavy`; lint used the queue too.

Final commands:

```text
bash ~/bin/heavy npx vitest run tests/unit/application tests/unit/supabase tests/unit/security tests/unit/google tests/unit/env-bootstrap.test.ts --maxWorkers=1
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
node scripts/check-env.mjs
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
git diff --cached --check
```

Final result: **61 files / 1,578 tests passed**, no skipped tests, **239.77 seconds**, exit **0**. Typecheck and lint each exited **0**. Env validation, env-manifest/schema drift, private-path policy, secret scanning and staged whitespace checks passed. The entire required application/Supabase/security directories and **all** Google unit regressions are included; this is not the full repository suite. `env-bootstrap.test.ts` verifies env-manifest/schema drift. The initial directory run passed 61 files / 1,575 tests; the final run adds three boundary/same-instant tests. The first targeted run exposed hard-coded test field counts that omitted the comparator's existing empty projections; those assertions now compare equality relative to the reported field count. Final process exit codes were captured directly by the external Node validation runner, avoiding PowerShell's treatment of expected test stderr as a shell error.

Adversarial verification used calendar/precision correctness, SQL/export/stale-state integration, metadata privacy, and false-green test integrity lenses. The committed runner, `scripts/verify-cs-075-round1.mjs`, requires a disposable `D:/wt/cs-231-fix-*` directory, runs a green baseline, applies **35** distinct implementation mutations, requires failing test assertions, checks changed SHA-256 hashes, restores original bytes in `finally`, and retests the restored implementation. **35/35 detected**; the baseline and restored runs both passed **105 tests**. All recorded source/restored hashes match this worktree. The new evidence is [cs-075-review-r1-mutations.json](docs/qa/cs-075-review-r1-mutations.json); the earlier `cs-075-mutations.json` belongs to the previous build. Full logs, baseline failure reproduction, final exit codes and mutation logs remain outside the repository at `D:/wt/cs-231-fix-r1-evidence`.

T0 applies. No UI/interaction, mobile or native behavior changed, so T1/T2/T3/T4 execution is outside this local fix scope. A new independent review and remote CI remain for the coordinator's next review round; the previous head's green CI is not evidence for the new local commit.

## Handoff and constraints

No live provider data call, GitHub write, push, merge, deployment or issue closure occurred. GitHub inspection was read-only. Dependencies, thresholds, gate SQL and migrations are unchanged. The final commit uses the requested message: `CS-075: validate calendar dates, preserve raw timestamp text, limit leniency to finalSyncedAt (#229)`.

All 11 implementation/test/runner files matched the verified scratch copy byte-for-byte by SHA-256. The scratch dependency junction was removed using `cmd //c rmdir`; the dependency source remains intact. The unlinked scratch copy and external evidence directory are retained. No recursive deletion occurred under `cs-wt` or elsewhere. No unresolved implementation blocker remains; the local commit is ready for the coordinator's independent review.

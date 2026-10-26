# CS-068 build report: issue #210, round 1

Issue: https://github.com/James-Bugden/Content-Studio/issues/210

Branch: `fix/210-missing-queue-summary-tab`, based on `1970368`.
Classification: Standard; verification tier T0. This report is committed with
the implementation; the containing commit identifies the reviewed build.

## Change and acceptance evidence

- `readAll` returns an empty collection only for `queueSummary` when its first
  page throws the transport's typed `VALIDATION_FAILED` error (Sheet HTTP 400).
- Emits `sheet.tab_absent` with `{ tab: 'queueSummary', tabAbsent: true,
  startRow: 1 }`. No provider payload, workbook identifier or content is logged.
- All other tabs retain first-page error propagation; all other typed codes
  and untyped errors still propagate for the summary.
- Present-tab parsing and the existing later-page grid-boundary handling remain
  unchanged. Tests cover both existing counts/master links and summary pagination.
- A fake-transport missing-tab fixture builds a complete mirror snapshot with
  zero summary rows. Sampled shadow parity compares empty summaries successfully
  with equal IDs, no blocking facts and 100% field equality (fields not applicable).

Read AGENTS.md, the implementation skill, MASTER-SPEC, issue #210, the Sheet
repository, mirror and parity services, and the Sheets read/cache contract.
The worktree was initially clean; no existing PR was listed for this branch.
Self-reviewed the complete source/test diff against the issue's narrow scope.

## Commands and results

All resource-heavy commands used the shared queue. No full test suite was run.

```sh
bash ~/bin/heavy npx vitest run tests/unit/google/sheets-missing-summary.test.ts tests/unit/google/sheets-repository.test.ts tests/unit/google/sheets-read-cache.test.ts tests/unit/google/sheets-stale-read.test.ts tests/unit/supabase/sheet-mirror.test.ts tests/unit/supabase/sheet-mirror-parity.test.ts tests/unit/supabase/content-parity.test.ts tests/unit/security --maxWorkers=1
```

PASS: 18 test files, 226 tests; exit 0. Secret-scanner security tests intentionally
print findings for planted synthetic sentinels; those tests passed.

```sh
bash ~/bin/heavy npm run typecheck
```

FAILED: exit 1. Shared dependencies `@supabase/supabase-js` and
`@electric-sql/pglite` are absent (confirmed with `Test-Path`); TypeScript reports
missing modules and associated implicit-any/untyped-call errors in existing
Replies/database code and tests. No diagnostics name the changed source or test.
`node_modules` is a junction to the main checkout and was left untouched;
no package installation was attempted. Global typecheck is not a pass.

```sh
bash ~/bin/heavy npm run lint
```

PASS: exit 0, no lint diagnostics.

```sh
git diff --check
```

PASS: no whitespace errors.

## Risks and limits

The transport's first-page validation code is the specified signal for an absent
summary; this intentionally does not inspect private provider error messages.
The optional summary remains empty rather than deriving replacement counts from
Content Queue. No schema, authority, write, cache-policy or dependency changes.

No live provider calls, PGlite suites, browser checks, push, GitHub writes,
merge or deployment were performed. GitHub access was read-only issue/PR-state
inspection. Production behavior is unverified by design for this build handoff.
The requested targeted T0 scope supersedes the skill's broader database-suite
recommendation; unrelated application/database suites were not run.

## PR #211 review fix: round 1

PR: https://github.com/James-Bugden/Content-Studio/pull/211

Review-fix base: `d3d8d116ff6a2bbb7316ff0b280772e39b6976d8`.
Classification remains Standard, T0. The commit containing this report identifies
the fixed build. The earlier sections retain the original implementation evidence.

Read-only GitHub inspection confirmed issue #210 and PR #211 are open, with the
PR head matching the local review-fix base. Vercel reported a successful preview
for that prior head; this local fix has not been pushed or deployed.

Addressed P2 by adding two first-page `queueSummary()` transport failures:

- A plain object `{ code: 'VALIDATION_FAILED', details: { status: 400 } }`.
- An ordinary `Error` with `code = 'VALIDATION_FAILED'`.

Both cases assert rejection with the exact thrown value using `rejects.toBe`,
and assert one transport read of the summary tab at `startRow: 1`. The original
untyped Error regression and branded AppError success case remain covered.

```sh
bash ~/bin/heavy npx vitest run tests/unit/google/sheets-missing-summary.test.ts --maxWorkers=1
```

PASS on the real source: 1 test file, 25 tests; exit 0.

Mutation proof: temporarily replaced only the first-summary-page
`isAppError(error)` check with
`typeof error === 'object' && error !== null && 'code' in error`, leaving the
`error.code === 'VALIDATION_FAILED'` comparison in place. The full file failed
with exit 1. A focused repeat captured both new failures explicitly:

```sh
bash ~/bin/heavy npx vitest run tests/unit/google/sheets-missing-summary.test.ts -t 'carrying VALIDATION_FAILED' --maxWorkers=1
```

EXPECTED FAILURE on the widened guard: 2 failed, 23 deselected; exit 1. Both
reported `promise resolved "[]" instead of rejecting` at the identity assertion.
Restored the original bytes in `finally` after each mutation run. Before/after
SHA-256 matched:
`3C432A76FA0F0736DBE9EC0077613E4A1A18F2AEFCDA7B94E2AEEE1B12560B57`.
`git diff --exit-code -- src/integrations/google/sheets-repository.ts` passed
with no output. The same focused command then passed on the restored source:
2 passed, 23 deselected; exit 0. Deselection is only for this mutation probe;
all 25 cases passed in the complete-file and related-test runs.

```sh
bash ~/bin/heavy npx vitest run tests/unit/google/sheets-missing-summary.test.ts tests/unit/google/sheets-repository.test.ts tests/unit/google/sheets-read-cache.test.ts tests/unit/google/sheets-stale-read.test.ts --maxWorkers=1
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
```

Restored-source Sheets tests: PASS, 4 files / 76 tests; exit 0.
Typecheck: FAILED, exit 2, because the shared `node_modules` junction still lacks
`@supabase/supabase-js` and `@electric-sql/pglite`, with missing-module and related
implicit-any/untyped-call diagnostics in existing Replies/database files.
No diagnostic names the changed test. No dependency installation or workaround
was attempted; global typecheck remains a failed check.
Lint: PASS, exit 0, no diagnostics. `git diff --check`: PASS.

All heavy commands used the shared queue. Mutation, restored-source tests,
typecheck and lint ran sequentially within one queue reservation, with nested
`bash ~/bin/heavy` calls retaining that reservation. The initial script-file
launcher was refused by local PowerShell policy before any check or source
mutation; invoking the same commands inline completed the verification.

The final change contains only this report and the regression test. Production
implementation is byte-for-byte unchanged. T1-T4 do not apply to this test-only
review fix. No full suite, package install, push, GitHub write, merge, deployment
or live-provider operation was performed. The remaining limitation is the
pre-existing dependency-blocked typecheck.

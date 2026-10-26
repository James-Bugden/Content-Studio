# CODEX_REPORT: CS-074 / PR #228, CI fix round 1

Parent: `0d02831aa1e3c9ab41bdd42fd2f043b025d597ff`.
Branch: `fix/226-hook-score-decimal`. Classification: Heavy. T0.
Issue: https://github.com/James-Bugden/Content-Studio/issues/226
PR: https://github.com/James-Bugden/Content-Studio/pull/228
Requested local commit: `CS-074: normalise numeric hook_score from drivers and keep unchanged imports row-version stable (#226)`.

## Findings and fix

The unmodified PR cutover test was restored in the scratch copy and the entire
`tests/unit/application`, `tests/unit/supabase` and `tests/unit/security`
directories reproduced the CI failures: **49 files, 1,246 passed, 2 failed,
zero pending**, exit 1. The failed tests are exactly the fake and PGlite B1
metadata-repair cases in the supplied read-only run-40296857098 log.

- Direct PGlite SQL returns `numeric(6,2)` as strings such as `7.00`.
  PostgREST JSON uses numbers. The persisted-row contract now permits either;
  validation checks the existing bounded ASCII decimal grammar and normalizes
  to `number | null` before readers render or check preserved text. Other
  numeric fields remain integer-only. Malformed strings fail with content-free
  `SCHEMA_DRIFT` column diagnostics.
- Fake import and write-through comparisons use the same normalized row before
  deciding whether anything changed. A driver string and its imported number
  no longer cause a version/history change. Exact `@hook_score` passthrough
  text is still compared byte-for-byte and is never normalized away.
- SQL already compares through the actual typed row. Its metadata-only repair
  kept the version stable but unconditionally inserted history. New additive,
  idempotent **UNAPPLIED** migration
  `20261026000200_content_metadata_history.sql` preserves history for inserts
  and content changes and omits it for revision/row-only repairs. Audit records,
  CAS, idempotency, invoker mode, pinned search path and service-only ACL remain.
  No earlier migration was edited. Both CS-074 migrations remain unapplied live.
- The original fake B1 case changes the preserved Hook Score spelling, e.g.
  `7` to `007`. That is a content change under #226's exact-text contract, not
  an integer/decimal equality defect. Four test edits already existed at handoff;
  their distinction between boolean formatting and score-spelling changes is
  retained. B1 now also requires no new history. A separate regression requires
  exact score-spelling changes to advance the version and retire the overlay.
  The helper conversion to PostgREST JSON that masked numeric strings was
  removed; cutover tests use direct PGlite numeric strings.

New fake AND direct-PGlite cases cover Library, Queue and Schedule: padded/tabbed
score text, typed domain value, exact export, unchanged import revision/version/
history, metadata repair, and subsequent edit/clear dropping stale text. The SQL
chain and re-run test includes the new migration. Invalid persisted numeric
strings, nonnumeric values and existing integer-column refusals remain covered.
Existing parity fixture-ID and ASCII grammar test improvements are preserved.

The first expanded directory run passed 1,302 tests and exposed one older
MIG-09 assertion that explicitly required an extra history row for a pure Sheet
revision repair. That expectation conflicts with this task's no-history
requirement. It now strictly requires unchanged history AND an audit event with
`outcome=applied` and `changed_fields=['sheet_revision']`; version and concurrent
CAS checks remain. Rechecking the SQL guard mutation now fails assertions in
both cutover and import PGlite suites. No implementation change was needed.

The `deterministic browser journeys` failure is a dependency failure, not an
observed flaky browser test. All four result variables in the supplied log are
`skipped`; `.github/workflows/ci.yml` makes browser jobs depend on `verify`, and
the aggregate requires each result to be `success`. No browser journey ran in
that failed CI run. No hosted rerun or new browser result is claimed here.

## Verification

Tests, PGlite and mutation runs use a tracked-file scratch COPY at
`D:/wt/cs228-ci-r1`, without private environment files. The `node_modules`
junction targets the existing worktree-163 dependencies requested by the user;
no package was installed. A scratch Git index supports security boundary checks.
Every Vitest/typecheck and mutation-runner command used `bash ~/bin/heavy`;
mutation subprocesses inherit `HEAVY_LOCK_HELD=1`, one Vitest worker.

```text
bash ~/bin/heavy npx vitest run tests/unit/application tests/unit/supabase tests/unit/security --maxWorkers=1 --reporter=json --outputFile=D:/wt/cs228-ci-r1-reproduction.json
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
bash ~/bin/heavy node tests/support/hook-score-mutations.mjs
bash ~/bin/heavy node tests/support/hook-score-mutations.mjs G43-SQL-metadata-history
bash ~/bin/heavy npx vitest run tests/unit/application tests/unit/supabase tests/unit/security tests/unit/env-bootstrap.test.ts --maxWorkers=1 --reporter=json --outputFile=D:/wt/cs228-ci-r1-validation-final.json
node --check tests/support/hook-score-mutations.mjs
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
git diff --check
```

- Scratch typecheck: **pass**, exit 0. An earlier assigned-worktree typecheck
  failed because its pre-existing dependency junction lacks PGlite; the final
  check uses the specified worktree-163 dependencies, without installation.
- Repository lint: **pass**, exit 0.
- Mutation baseline: **218 tests passed**, zero failed/pending.
- Final required-directory run: **49 files / 1,256 passed**, zero failed or
  pending. Environment manifest/bootstrap file: **47 passed**. Combined:
  **50 files / 1,303 passed**, zero failed/pending, success true, native exit 0.
- **43/43 implementation/SQL mutants killed** by actual failed assertions.
  Restored baseline: **218 passed**, zero failed/pending, runner exit 0.
- SQL metadata-history recheck, including the strengthened legacy import test:
  baseline AND restored runs **238 passed** each, zero failed/pending; the
  mutation fails **5** assertions across both PGlite files, runner exit 0.
- Private-path and secret scans: **pass**, 671 tracked files; runner syntax and
  staged/unstaged whitespace checks: **pass**. Final scratch typecheck and lint
  were repeated after the strengthened import assertion and both passed.
- All **12** changed source/test/doc/migration files (excluding this report)
  matched both the assigned worktree and restored scratch copy by SHA-256.
  Source manifest: `D:/wt/cs228-ci-r1-source-manifest.json`, SHA-256
  `977e28249b9de5f36f500fc65387c8b5b322adc97dd4c2ea157e958e4dd2cb6f`.
  The scratch `node_modules` junction was unlinked with `cmd //c rmdir` after
  all heavy commands completed. Shared worktree-163 PGlite dependencies were
  checked to remain available. Scratch files and synthetic evidence are
  retained; no recursive delete under `cs-wt` was attempted.

Machine-readable reproduction and final required-directory results, plus logs:
`D:/wt/cs228-ci-r1-reproduction.{json,log}` and
`D:/wt/cs228-ci-r1-validation-final.{json,log}`. The intermediate contract failure
is retained in `D:/wt/cs228-ci-r1-validation.{json,log}`. Mutation per-guard JSON/logs,
`summary.json` and restored run are in
`D:/wt/cs228-ci-r1/score-mutation-results`; the runner log is
`D:/wt/cs228-ci-r1-mutations.log`.
The additional SQL recheck and its 238-test restored run are retained under
`score-mutation-results/selected`, with runner log
`D:/wt/cs228-ci-r1-metadata-recheck.log`. The runner accepts exact guard names
to recheck changed assertions without overwriting the full-campaign evidence.

## Adversarial verification and limits

Lenses: driver integration/exact-text correctness; version/history/CAS/replay
state; auth/privacy/ACL; false-green test integrity. The new implementation
mutants remove string acceptance, numeric normalization, fake import/copy
normalization, fake metadata-history suppression and SQL metadata-history
suppression. Each must cause actual assertions to fail in the cutover test file.
The existing grammar, Unicode/whitespace, stale-text, parity, type, ACL and
transaction mutations are also rerun. The runner proves each mutation changed
SHA-256 and was written, restores original buffers in `finally`, and asserts
byte-for-byte restoration. Tests themselves are never mutated.

| New guard mutation | Actual failed cutover tests |
| --- | ---: |
| G38: remove SQL driver string acceptance | 7 |
| G39: remove canonical numeric transformation | 7 |
| G40: remove fake import typed comparison | 3 |
| G41: remove fake write-through typed comparison | 3 |
| G42: record fake metadata-only repairs in history | 3 |
| G43: record SQL metadata-only repairs in history | 4 initially; 5 after strengthened MIG-09 test |

G40/G41/G42 each fail Library, Queue and Schedule assertions. G43 also fails
the metadata-only overlay repair. Existing G01-G37 all remain killed, including
NFKC, NFC, terminal tab, magnitude/precision, exact parity, stale metadata,
decimal column types, view ACL/invoker and atomic migration checks.

The copied SQL helper differs from its earlier implementation only in the
history condition and an updated numeric comment; before/after extracts are
retained under `D:/wt/cs228-ci-r1-mutate-{before,after}.sql`.

T1-T4 do not apply to this storage-boundary fix: #226 requires T0 and no UI or
browser interaction model changes. The aggregate browser gate remains pending
future CI on the unpushed commit. No independent-review approval, hosted CI,
production migration application, deployment or authority flip is claimed.
No full repository test suite, dependency install, push, GitHub write, merge,
production provider mutation or process termination was performed. The linked
issue remains open for the coordinator's review and shipping workflow.

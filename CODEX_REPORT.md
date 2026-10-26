# CS-071 / issue #222 build report

- Assignment: Standard; build; PR label 222; round 1.
- Issue: https://github.com/James-Bugden/Content-Studio/issues/222
- Branch: fix/222-shadow-refusals; worktree initially clean.
- Base: cc07826c57178ae6d4e9e75a064f9385538366af.
- Commit subject: CS-071: allow named copy refusals as classified exceptions in db-shadow (#222).
- Implementation commit: the commit containing this report; resolve with git log -1 --format=%H -- CODEX_REPORT.md.
- Verified src/application/content-import.ts Git blob: 7bd59184914c016a1bd8f9bd090e36e3a684ac38.
- Environment: Windows local worktree; synthetic fake/transport fixtures only; 2026-10-26.

## Change and acceptance evidence

buildTypedImport now permits only the existing named numeric/size copy
refusals in both db-shadow and db-read. A refused row contributes one
content-free exception and is omitted from the accepted rows/counts; other
rows continue. Unknown conversion errors still abort before applying anything.
sheet and db imports remain forbidden before provider reads/writes.

The importer has no existing serverEnv() or configured service access, so the
change retains its existing environment access and adds no configuration layer.
Parsing, size limits, parity calculations, measurement code, SQL, cutover gates
and thresholds are unchanged. The migration design and ADR now describe both
eligible import modes.

| Issue acceptance | Evidence | Result |
| --- | --- | --- |
| Shadow numeric refusal becomes an exception; other rows import | Synthetic invalid contentAngle; fake store excludes that row and retains another changed row | Pass |
| Shadow size refusal behaves the same | Oversized synthetic imageBrief; exact accepted count and surviving row asserted | Pass |
| db-read retains both named-refusal behaviors | Same two cases parameterized across both modes | Pass |
| Other errors still abort | Malformed boolean in both modes; precise error reason, no apply call, unchanged DB | Pass |
| sheet/db behavior unchanged | Existing mode-denial tests cover envelope building, service reads/writes and direct fake/REST stores | Pass |
| Exception ledger contains no content/IDs | Exact four-key shape, named class/field, keyed hash, and absence of synthetic content, stable ID and revision | Pass |
| Refusals remain blocking | Imported missing row blocks adapter parity; otherwise-green journal turns red for either refusal, with and without calendar waiver | Pass |
| Actual measure/SQL activation remain red | Added both-refusal regressions to mocked-provider/PGlite composition suite, with positive baseline and direct SQL gate checks | Blocked: missing PGlite |
| Mutation-check the mode condition | Temporarily restored original db-read-only condition; both new shadow tests failed | Pass: mutant killed |

The import regression also verifies that representation exceptions accumulated
before a refusal are discarded for that row. An older shadow test expecting a
numeric refusal to abort now asserts the newly required named exception.

## Verification

All Vitest, typecheck and lint commands used the shared bash ~/bin/heavy
queue. Every test command set CS_TEST_MODE=unit and used --maxWorkers=1.
Only targeted files and the requested security directory were selected.

Final available-tests command, after restoring the mutation:

~~~powershell
$env:CS_TEST_MODE='unit'
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-import.test.ts tests/unit/supabase/content-parity.test.ts tests/unit/supabase/content-import-operation.test.ts tests/unit/supabase/content-shadow-live.test.ts tests/unit/cutover-cli.test.ts tests/unit/cutover-runner.test.ts tests/unit/cutover-acl.test.ts tests/unit/security --maxWorkers=1
~~~

Result: **18 files passed; 366 tests passed; exit 0**. No skipped tests.
Secret-scanner negative fixtures intentionally print synthetic findings.

The requested database-backed cutover/measure tests were attempted in this
combined targeted command:

~~~powershell
$env:CS_TEST_MODE='unit'
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-import.test.ts tests/unit/supabase/content-parity.test.ts tests/unit/supabase/content-import-operation.test.ts tests/unit/supabase/content-shadow-live.test.ts tests/unit/supabase/content-cutover-live.test.ts tests/unit/supabase/content-cutover-security.test.ts tests/unit/application/content-read-cutover.test.ts tests/unit/security --maxWorkers=1
~~~

Result: **15 files passed; 206 tests passed; 3 suites failed to load; exit 1**.
content-cutover-live, content-cutover-security and content-read-cutover
cannot import the absent @electric-sql/pglite package. Their checks, including
the new measure/SQL regression, are **blocked**, not passed or skipped.

Mutation command:

~~~powershell
$env:CS_TEST_MODE='unit'
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-import.test.ts --maxWorkers=1 -t CS-071
~~~

With the original condition restored temporarily: **2 failed; 4 passed;
25 unselected/skipped; exit 1**. Both shadow numeric/size regressions failed at
the intended conversion error. The original fixed source bytes were restored
in a finally block before the final green tests. Unselected tests are not
claimed as verification passes.

- bash ~/bin/heavy npm run lint: **Pass**, exit 0.
- bash ~/bin/heavy npm run typecheck: **Blocked / failed**, exit 1.
  The existing shared local dependencies lack @supabase/supabase-js and
  @electric-sql/pglite (including contrib declarations). Diagnostics report
  unresolved imports and consequent typing errors in unchanged files; none
  name the edited files. No packages were installed or changed.
- git diff --check: **Pass**.
- node scripts/check-private-paths.mjs: **Pass**, 661 tracked files clean.
- node scripts/scan-secrets.mjs: **Pass**, 661 files clean.
- Self-review: reviewed actual code/test/docs diff; no blocking code findings.

## Remaining limits and handoff

T0 is the issue's required tier. Available targeted tests and lint pass, but
overall T0 is **not green**: typecheck and database-backed measure/gate tests
remain blocked by the existing dependency state. Run the recorded blocked
commands in a fully provisioned environment before treating acceptance as
fully verified. Broader application/Supabase directory suites were not run,
following the assignment's explicit targeted-only memory rule.

No UI/browser behavior changes; T1-T4 were not required or run. No live
provider calls, SQL application, deployments, dependencies, installs, pushes or
GitHub writes occurred. Read-only issue and branch PR inspection found the
issue open and no PR for this branch. No production behavior or CI status is
claimed; issue closure and shipping are outside this build assignment.

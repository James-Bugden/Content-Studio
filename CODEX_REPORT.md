# CS-070 / issue #219 build report

- Assignment: Standard; build; PR label 219; round 1.
- Issue: https://github.com/James-Bugden/Content-Studio/issues/219
- Branch: `fix/219-idless-rows`.
- Base: `e611740` (main at task start); worktree initially clean.
- Implementation commit: `3db6f5ab0b1a7a2636177964621f6f31a8b9edb3`.
- Commit subject: `CS-070: skip Sheet rows without a stable ID in import and parity (#219)`.
- Environment: Windows local worktree; synthetic fake repositories only; 2026-10-26.

## Result and acceptance evidence

The mirror now omits library, queue, ready and schedule records whose stable
ID is empty after trimming. `hasStableSheetId` is shared with Sheet-side content
parity. Retained records keep their original positions, payloads and hashes.
Typed import inherits the mirror filter without changing conversion rules.

When any rows are skipped, one `sheet.mirror.skipped_idless` telemetry event
contains the four numeric collection counts in `facts`. Its only other fields
are the fixed name, adapter, outcome and generated timestamp. It includes no
content, stable IDs, source row numbers or operation identity.

| Issue acceptance | Evidence | Result |
| --- | --- | --- |
| Skip/count idless records in all four collections | Fake repository mixes empty, whitespace-only and valid IDs; different skip counts per collection | Pass |
| Mirror snapshot builds and preserves valid records | Counts, nonempty retained IDs, payloads, hashes and original positions asserted | Pass |
| Duplicate IDs still conflict | Duplicate stable ID injected separately into each collection alongside idless records | Pass |
| Parity has equal Sheet/DB ID sets | Direct four-collection comparisons plus typed fake-store import/adapter round trip | Pass |
| Counts-only logging | Exact event shape and exactly one skip event asserted through telemetry sink | Pass |
| Mutation-check skip guard | Guard disabled; mirror, import and parity regressions fail; original bytes restored | Pass |

Parity filters only the expected Sheet lists; invalid DB rows and duplicates on
either side remain blocking. Queue-summary and workflow-settings rules remain
unchanged, with explicit regression coverage. UI gates remain unchanged.

## Verification

All Vitest, typecheck and lint commands ran through `bash ~/bin/heavy`.
The final test command ran after restoring the mutation:

```powershell
$env:CS_TEST_MODE='unit'
bash ~/bin/heavy npx vitest run tests/unit/supabase/sheet-mirror.test.ts tests/unit/supabase/content-import.test.ts tests/unit/supabase/content-import-operation.test.ts tests/unit/supabase/content-parity.test.ts tests/unit/supabase/sheet-mirror-parity.test.ts tests/unit/security --maxWorkers=1
```

Result: **16 files passed, 195 tests passed**, exit 0. No skipped tests in this
final run. Secret-scanner negative fixtures intentionally print synthetic
findings; their tests pass.

Mutation command: the three edited test files above, with
`--maxWorkers=1 -t CS-070`, after temporarily replacing
`return id.trim() !== '';` with `return id.length >= 0;` in the shared helper.
Result: **10 failed, 2 passed, 44 unselected/skipped**, exit 1; mutant killed.
The unselected tests are not claimed as verification passes.

- `bash ~/bin/heavy npm run lint`: **Pass**, exit 0.
- `bash ~/bin/heavy npm run typecheck`: **Blocked / failed**, exit 1.
  The shared local `node_modules` lacks `@supabase/supabase-js` and
  `@electric-sql/pglite` (including its contrib declarations). TypeScript reports
  unresolved imports and consequent typing errors in unchanged Replies and
  database tests. No diagnostics name the changed files. This is not a green
  typecheck; dependencies were not installed or modified.
- `git diff --check`: **Pass**.
- Self-review: reviewed actual implementation/test diff; no blocking code findings.

## Scope and remaining limitations

T0 is the issue's required tier. Its targeted tests and lint pass, but full T0
is not green because of the typecheck environment blocker. Broader application
and Supabase directory suites were not run: the assignment explicitly limits
this memory-constrained PC to targeted tests. No UI/browser behavior changed;
T1-T4 were not required or run for this build assignment.

No live provider calls, deployments, new dependencies, installs, pushes or
GitHub writes were performed. Issue and branch PR state were inspected using
read-only GitHub commands; no PR existed for this branch at inspection. The
issue remains open. Production import behavior is not claimed as verified.

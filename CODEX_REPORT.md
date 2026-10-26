# CS-072 build report — issue #224, round 1

Heavy / build; branch `fix/224-angle-label`.
Issue: https://github.com/James-Bugden/Content-Studio/issues/224
Base commit: `13c59e36c78c188c98361a073e062b9a4f2b34fd`.
Final commit identity is the commit containing this report (`git rev-parse HEAD`).
Source identity is also recorded by the SHA-256 values below.

## Implementation and acceptance

- Accepts the issue's exact numbered-label regex with N in 1..14.
  Stores integer `content_angle` plus the untouched original cell in
  `passthrough["@content_angle"]`. The imported source record is not mutated.
- The DB adapter consumes this reserved metadata, retains real unknown columns,
  and renders the original label only when it is a valid label whose integer
  equals the DB value. Changing or clearing the integer exports the current
  integer/blank instead. Sheet mapping (`num`) is unchanged, including its
  existing null domain value for label cells.
- Export/rollback use the existing adapter renderer and exact inventory
  comparison. Parity still compares the exact cell string; no new equivalence
  or classified-exception bypass was introduced. SQL shadow measurement compares
  both integer and passthrough and reports full equality with zero refusals.
- Invalid numbered labels (including 0 and 15), `x. y`, missing dots and empty
  labels remain named `refused_numeric` refusals. Plain integer rules remain
  unchanged, including existing plain 0/15 behavior. The specified regex also
  accepts `3.5` as angle 3 with label 5; there is no extra whitespace requirement.
- All other numeric fields retain their refusal rules. Tests cover all 14 labels,
  leading whitespace/zeroes, Unicode/trailing spaces, plain integers/blank,
  Library/Queue/Ready, unknown columns, stale/cleared integer values, malformed
  metadata, exact parity failures, private diagnostics, and rollback bytes.
- PGlite executes the complete sorted Content migration chain, the real import/
  shadow claim/measurement RPCs, and a changed integer through the real SQL
  write-through/CAS RPC. SQL rows pass through JSON serialization to model
  PostgREST timestamps before adapter/export tests. All six adapter collections
  are compared; rollback requires equal hashes and no issues.

Migration: **none**. Existing integer and JSONB passthrough columns, SQL
`jsonb_populate_record` imports, full-row backup snapshots and existing
Markdown/Sheet export paths already preserve the representation. Existing
migrations, SQL functions, RLS/ACL, source authority and cutover gates are unchanged.
The DB design now documents the reserved metadata key.

## Verification commands and results

All Vitest/typecheck/lint/mutation commands ran through `bash ~/bin/heavy`.
No full test suite, installs, new dependencies, live provider operations,
GitHub writes or pushes were performed.

PGlite and final validation ran in a disposable COPY at
`D:/wt/cs224-build-r1`, with `node_modules` a junction to the existing
`../163/node_modules` relative to the assigned worktree. Only repository
files were copied (no private environment files or credentials). A local `git init` and index
were required for Git-aware architectural/acceptance checks.

```text
gh issue view 224 --repo James-Bugden/Content-Studio --json number,title,body,state,url
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-angle.test.ts --maxWorkers=1
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-import-pglite.test.ts --maxWorkers=1
bash ~/bin/heavy node tests/support/content-angle-mutations.mjs
bash ~/bin/heavy npx vitest run tests/unit/application tests/unit/security tests/unit/supabase tests/unit/cutover-acl.test.ts tests/unit/cutover-cli.test.ts tests/unit/cutover-runner.test.ts tests/unit/env-bootstrap.test.ts --maxWorkers=1 --reporter=json --outputFile=D:/wt/cs224-final-results.json
bash ~/bin/heavy npx vitest run tests/unit/application tests/unit/security tests/unit/supabase tests/unit/cutover-acl.test.ts tests/unit/cutover-cli.test.ts tests/unit/cutover-runner.test.ts tests/unit/env-bootstrap.test.ts --maxWorkers=1
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
bash ~/bin/heavy npx eslint tests/unit/supabase/content-angle.test.ts
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
git diff --check
```

- Final targeted run: **51 files / 1,319 tests passed**, zero skipped/pending,
  native exit **0**, 215.56 seconds. Includes all application, security and
  Supabase tests plus the three cutover files and env-manifest drift checks.
- Focused angle baseline/restored run: **45 tests passed**. Import PGlite file:
  **12 tests passed**, including both SQL round trips and refusal persistence.
- Typecheck: **pass**, rerun after the final assertion correction, exit 0.
- Full repository lint: **pass**; edited-test ESLint rerun also passed, exit 0.
- All **18 mutations killed** with byte-exact restoration and passing baseline.
- Private-path/secret scans and staged diff whitespace check: **pass**.

Intermediate failures were corrected, not counted as passes: initial test
assertions included unrelated fixture formula-display exceptions; these were
restricted to the affected field/refusal classes. The first scratch run needed
Git metadata for two checks; the PGlite additions needed shadow-state cleanup
and JSON timestamp serialization. Independent review identified the shadow
cleanup issue and unordered SQL-row lookup; both were fixed and re-reviewed.
An initial typecheck in the assigned worktree failed because its shared
dependencies lack PGlite; typecheck was rerun in the required scratch dependency
environment without installing anything.
The first all-green JSON run was wrapped by PowerShell, which treated expected
negative secret-scanner stderr as a NativeCommandError. It was repeated directly
under Bash to obtain an unambiguous process exit status.
That rerun exposed a new-test flake: the short invalid label `7.` can occur in
a telemetry timestamp. The privacy assertion now checks every content-bearing
event field while excluding the clock; mutations and final checks were rerun.

T0 applies. No browser/UI/mobile/native interaction changed, so T1–T4 are
not applicable to this local build. Hosted/deployed behavior is unverified;
this is synthetic local evidence only.

## Independent and adversarial review

Applied implementation, qa-regression, code-review and adversarial-verify skills.
A separate reviewer inspected parser scope/range, metadata collision/filtering,
stale-state behavior, unchanged Sheet semantics, exact parity/export,
diagnostic privacy, SQL/test isolation and mutation-test integrity. Final
re-review: **no remaining blockers**.

Adversarial lenses: grammar/bounds and exact bytes; integration/state/rollback
and unknown columns; privacy/refusals; false-green test integrity.
All 18 implementation mutations below caused actual failing tests. Baseline
and restored runs each passed 45 tests. The runner verifies every replacement
matches exactly once, mutated SHA differs, and restores the original Buffer
in `finally`; every file is checked byte-for-byte again at exit. Tests are
never mutated.

Before and after SHA-256 are **identical** for every mutation using these file
identities (the assigned worktree was independently hashed and matches):

| File | Path | Before = after SHA-256 |
| --- | --- | --- |
| F1 | `src/domain/content-angle.ts` | `684810235fc65f3132a34f5de1026aa8ee6d2089c3a84dc26e1b9b2445ac112c` |
| F2 | `src/application/content-import.ts` | `23f84c76fd7920a9ea256db5c6970a635af2e69361771db1eb3a5d8f3c863c95` |
| F3 | `src/integrations/supabase/content-repository.ts` | `cee399c473df2ec77957f682e5c671b5b33568e759c32382283d82da77716a08` |
| F4 | `src/application/content-parity.ts` | `d45c233d088a92b67436021f298f1af928fb62ea16390e682aad925b3b39760b` |

Each row records the changed implementation SHA-256 and the number of actual
failed tests. For its before/after values use the referenced file identity
above; every one was verified equal on restoration.

| Mutation | File | Mutated SHA-256 | Failed tests |
| --- | --- | --- | --- |
| G01-grammar | F1 | `b590da8af30bc12f253e5b23210557a0aed6020c2a98d672b90e93549e8c898f` | 14 |
| G02-lower-bound | F1 | `6aa29c6b86cc5345731eefa2ed13a81d41f14cdc911b6d1d3655f009fd5a5f3b` | 1 |
| G03-upper-bound | F1 | `37033a2b9b95e64efb58247ab46705182c2f967aa86676d50bff62032fa85256` | 1 |
| G04-digit-count | F1 | `85895a1037cb10a5c9fb95725b196098ba840ff4f1c3b7aa2110c13dae03ac66` | 1 |
| G05-required-dot | F1 | `a56db973efe505f80a7f6199932c746062934f33729551e9cad6bfdebc89df2a` | 2 |
| G06-required-label | F1 | `8c9a761b22b2a3dabd62e46ae1fb2dd740036084128e4a49a800b04faefd085a` | 2 |
| G07-start-anchor | F1 | `2e27e40f07f8a5fbeb26010d0ab45383ed440e509391fcb80b1ebfe08eb5ec12` | 3 |
| G08-end-anchor | F1 | `8e382effb9c848bf1988fcf8460da43989e10d3d53ca069ddedfee64dee66aec` | 1 |
| G09-field-scope | F2 | `6fa9269e6a5429412159ac857886be716e39c9ad340920f7c445f28b0d7526f8` | 1 |
| G10-null-label | F2 | `92b806fad9fc0ae9bfe0270d758d36b614fb695ad8923e4d74bc5b701a05799d` | 41 |
| G11-preserve-bytes | F2 | `2dd4b3dffb1eb2aac2de249259e157290a1751bc4d910f17f68ba761c042d114` | 17 |
| G12-preserve-unknown | F2 | `a30aee728882efa6f9e4562506fe87b404d99473938c8dcbb418cd4c76316407` | 17 |
| G13-render-import | F2 | `1578664e1d27c78fc802c31c6a0b69ed9b7a75ecc2c2bcecfd188fda3d414e0d` | 26 |
| G14-metadata-type | F3 | `107f560236c8ea8962b113266da1bdde9b719c0768fece440d399b0885122901` | 1 |
| G15-valid-metadata | F3 | `01e99e92ca19d7fb774d64c8b08cb78c77c13fc78d83146ea5a59619b0a02ee1` | 4 |
| G16-stale-label | F3 | `41be85accc5bc90fb69a83986ed905ad40d4ac9426f509aceb845f33ad26e568` | 2 |
| G17-strip-metadata | F3 | `fb57e51acb6a50e1421d43a562ef012ec0f34f3b24a3f839b840d835eba0fcc7` | 25 |
| G18-exact-parity | F4 | `e6354d090383b29cb464107a7ed785d62bfd973e1990e8bb537ac87f3d85ec67` | 1 |

Full synthetic execution logs and machine-readable reports are outside the
repository under `D:/wt/cs224-*`. The scratch junction is unlinked with
`cmd //c rmdir`; shared dependencies are retained. Automatic approval review
rejected recursive deletion of the already-unlinked scratch copy with only
"blocked by policy" as the reason. The unlinked copy remains at
`D:/wt/cs224-build-r1`; no alternative deletion was attempted.

## Remaining scope

No implementation blockers or migration requirements. Independent CI, PR,
merge, deployment and production cutover were outside this build-only
instruction; the linked issue remains open. No live authority flip is claimed.

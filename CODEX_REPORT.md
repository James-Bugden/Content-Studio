# PR #176 — fix round 1

- Issue: [CS-057 / #147](https://github.com/James-Bugden/Content-Studio/issues/147).
- Review: [comment 6387431427](https://github.com/James-Bugden/Content-Studio/pull/176#issuecomment-6387431427).
- Tier/role: Standard, fix. Branch: `cs-147-db`, this worktree only.
- Starting head: `91d22213509b23bf323ac8245bbb1b13cf97b2a2`.
- Code commit: `f29e0e3a66513f5fd60a58768fa108339da79c72`.
- `git fetch origin main` succeeded; `git rev-list --left-right --count HEAD...origin/main` at the start returned `6 0`. Main was already merged; no additional merge was needed.

## Changes and acceptance evidence

| Review item | Result |
| --- | --- |
| 1 / MIG-06 | Import PGlite suite discovers and applies all timestamped `*_content_*.sql` migrations in sorted order, including DB-3 and future Content migrations. The scheduled rerun test exercises schema version 2. |
| 2 / MIG-09 | DB-3 retains all six DB-4 exception classes. Diffed the complete DB-1 and DB-3 `import_run` bodies: the allowlist was the only accidental divergence; DB-3's intentional mode binding, replay flag and private-helper changes remain. Six parameterized full-chain RPC tests guard every class; the real-workbook representation test remains intact. Number formatting classification stays with DB-4's existing importer. |
| 3 / MIG-07/08 | A local HTTP-boundary shim exercises the production `SupabaseContentDb` methods against PGlite. RPC body keys must equal `pg_proc.proargnames`, and named arguments execute the real SQL. The production history query's filters, ordering, limit and offset execute as SQL. Multiple metadata-only copies preserve version 2; after a content edit, `mutationRow` must recover the earliest version-2 before-image. Both patch and queue-insert RPCs are exercised. |
| 4 / TYPE-02/04/05, PUB-01/02 | Typefully create, replay, partial failure, exact final-copy sync, repeated sync and analytics assertions require the selected store provider, including `db`. |
| 5 / MIG-07/08 | Tests cover failed-attempt audit events with no ledger/history consumption, direct SQL writable allowlist, Schedule source metadata protection, metadata-only version preservation, adapter and SQL byte caps (including nested JSON), replayed failure refusal and export field-name filtering. Added pre-SQL Schedule rename refusal and test-control protected/inherited key coverage; replaced `in` with `Object.hasOwn`. ADR clarifies that validation exceptions and successful-operation identity conflicts return before row-attempt auditing. |
| 6 / MIG-07 | Timestamp writes require ISO date-times with explicit offsets; non-ISO and offset-free stamps fail deterministically. Tests assert refusal and equivalent UTC/Taipei instants. ADR records the integer hookScore restriction (`7.5`, `8/10`), aggregate UTF-8 cap affecting two 45,000-character zh-TW strings, and timestamp differences from Sheet cells. |
| 7 | Deferred as explicitly permitted. Editor success/conflict labels still say Sheet in database mode. This spans the editor's provider union, model terminology and browser assertions; it remains DB-5/cutover follow-up. No UI wording was changed in this round. |

## Verification environment

The shared `node_modules` junction was left in place. Its installation lacks declared PGlite and Supabase packages: the initial worktree test command could not load the SQL suites, and the first scratch typecheck also reported missing Supabase imports. Those runs were failures, not passes.

To verify without changing the main checkout or installing dependencies, created a temporary workspace outside the repository containing copies of tracked files and links to existing packages. Downloaded/extracted the already declared `@electric-sql/pglite@0.5.8` and `@supabase/supabase-js@2.117.0` packages plus required missing transitive packages only into scratch. No `npm install`/`npm ci`, manifest change, lockfile change or new dependency. Before final acceptance checks, byte-compared every tracked worktree file with scratch: identical, and all mutations restored. PGlite was local and ephemeral; no live DB was contacted.

## Final checks

All Vitest, typecheck and lint commands ran through `bash ~/bin/heavy` in the scratch workspace.

```text
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-db.test.ts tests/unit/supabase/content-schema.test.ts tests/unit/supabase/content-writes.test.ts tests/unit/supabase/content-import-pglite.test.ts tests/unit/supabase/content-import.test.ts tests/unit/supabase/content-import-operation.test.ts tests/unit/supabase/content-parity.test.ts tests/unit/application/content-repository-contract.test.ts tests/unit/typefully/reconcile-create.test.ts tests/unit/typefully/sync-analytics.test.ts tests/unit/security/db-test-control.test.ts tests/unit/google/drive-saga.test.ts
```

- Targeted unit acceptance: PASS, exit 0; **12 files, 346 tests passed**, 23.86 seconds.
- `bash ~/bin/heavy npm run typecheck`: PASS, exit 0.
- `bash ~/bin/heavy npm run lint`: PASS, exit 0, no warnings/errors.
- `git diff HEAD^ HEAD --check`: PASS.
- Earlier expanded run: 11 files, 284 tests passed. Final acceptance includes the corrected metadata-guard tests and the actual `tests/unit/google/drive-saga.test.ts` path.

## Adversarial verification

Applied one implementation mutation at a time in scratch, asserted exactly one replacement, ran the relevant targeted tests through heavy, and restored the original bytes in `finally`. No mutation was committed.

| Mutation | Targeted command suffix after `bash ~/bin/heavy npx vitest run` | Result |
| --- | --- | --- |
| Remove SQL source metadata protection | `tests/unit/supabase/content-writes.test.ts -t "SQL refuses"` | Red: all 3 Schedule metadata cases fail; 2 other guards pass. |
| Restore the old three-class import allowlist | `tests/unit/supabase/content-import-pglite.test.ts -t "complete migration chain"` | Red: the 3 DB-4 classes fail; original 3 pass. |
| Rename live `p_patch` to `p_data` | `tests/unit/supabase/content-writes.test.ts -t "runs live RPC"` | Red: SQL catalog/live client contract fails. |
| Reverse live history order to descending | Same live RPC command | Red: wrong before-image fails the assertion. |
| Hard-code Typefully provider to Sheet | `tests/unit/typefully/reconcile-create.test.ts -t "creates once\|sequential retry"` | Red: both DB provider cases fail; both Sheet cases pass. |

## Boundaries and remaining limitations

- No push, GitHub write, PR merge/edit, issue write, deployment, live migration or production data change. Repository and runtime defaults are unchanged.
- Final verification is local SQL/fake-provider evidence. Hosted PostgREST, hosted ACL/security-advisor checks, independent-backend isolation/retry behavior, deployment and CI are not claimed as verified.
- T1/T2 browser checks were not run in this fix round; no user-visible UI layout or interaction was changed. DB-mode CI coverage and editor wording remain follow-up items from the review. T3/T4 and production acceptance are outside this local fix round.
- Scratch workspace, downloaded package archives, extracted dependencies, mutation logs and state marker deleted after verification; package junctions detached before recursive deletion so their targets were not traversed.

# CS-061 / DB-7 build round 1

Issue: [#151](https://github.com/James-Bugden/Content-Studio/issues/151).
Classification: Heavy. Role: build. Branch: `cs-151-db`.
Date: 2026-10-25 (Asia/Taipei). This is a local handoff, not a production flip.

## Identity and boundaries

- Starting clean HEAD and `origin/main`:
  `d2c0ab58eef2e5af621d07c0a1c53620773b608f` (DB-6 merged). Read-only
  `git ls-remote origin refs/heads/main` confirmed that same remote main.
- Implementation: `b69444bc3ba36a333828b065a59e91f526864be0`.
- Final application/test commit: `11a6b1e3416e4f4d751bd68cd5e3e6cd819de581`.
  This report is committed separately after verification and the cleanup attempts.
- Read AGENTS.md, MASTER-SPEC, issue #151, migration design section 3/DRV-01/
  phase gates, ADR-0002 including NOTES, DB-6 operations, merged DB adapters,
  Markdown parser/replacement, save/hook/reconcile flows, and the requested
  `report150b.md` and `report147b.md` conventions.
- Used implementation, adversarial verification, QA, Supabase and React quality
  skills. Self-review only; no independent reviewer or hosted CI pass is claimed.
- No git push, GitHub write, PR creation/edit/merge, issue write, deployment,
  production flag change, live SQL, live workbook or live Drive operation.
  The branch had no open PR in the initial read-only branch query.
- No new dependency, manifest/lockfile change, npm install or npm ci. Synthetic
  fixtures/fakes and local ephemeral PGlite only. Default remains `sheet` and
  live DB modes remain refused before constructing providers.

## Result and acceptance evidence

The coordinator selected option (b) under the owner's explicit delegation.
Only the `db` composition opts into DB draft body authority. The other three
modes retain the Drive-first saga. Existing production authority is unchanged.

| Contract | Evidence |
| --- | --- |
| Atomic draft save | DB save calls one `apply_patch`, with SQL/fake approval reset, history, redacted audit, ledger and coalescing Markdown outbox in the same transaction. PGlite forces an outbox constraint failure and proves body/version/approval/history/audit/ledger all roll back. |
| Drive failure cannot block save/load | The DB editor source reads the row body without any Drive call. A read spy and NOT_FOUND injection prove successful save/load and a later failed/retried export. T1 saves/reloads exact text while Drive is failing. |
| DRV-01 | The new exporter test compares UTF-8 buffers for CJK, emoji, CRLF/LF, indentation, tabs and trailing spaces, plus exact prefix/suffix outside the Library-ID body. It uses `safeReplaceSectionBody`, a fresh provider revision and whole-file/revision readback. The existing domain/parser and Sheet/DB legacy saga suites remain green. |
| Safe asynchronous export | Next `after` triggers body-save, hook and import repair outside their successful responses. Existing authenticated Content export repair also drains the queue. No cron installed. Unexpected Drive body, stale revision, unsafe Markdown, missing/duplicate section, read/write failure or unconfirmed readback preserves the DB save and queued work. Reconcile uses `markdown_export_lag` in DB-body mode. |
| Concurrency/retry | Coalescing keeps the oldest unexported baseline and latest body. Completion of an older export retains a newer save and advances its baseline; duplicate completion cannot regress it. Repeat repair does not duplicate a write. Known unconfirmed jobs stay visible even if the section currently matches. |
| Import preview and refusal | Owner-only same-origin POST previews sections by Library ID using the existing heading, marker and labelled layouts. Duplicate sections refuse individually; unmatched sections do not create rows. Missing direction refuses before mutation. Drive file/section tokens and DB CAS refuse stale previews. Explicit Use Markdown body applies an exact audited patch and replays without another history row. Keep database body writes neither provider and grants no overwrite baseline. |
| One-off external intake | New marker/labelled master fixtures import exact text by ID. Existing source links/export destinations are retained; the supplied master is intake, not a new authority. Per-section confirmations are independently audited, not a claimed bulk transaction. |
| Regression areas | Full required application/component/security/Supabase directories plus Google sagas, AI English QA/hook/zh suites and Markdown parser. A new DB hook test proves one history entry covers hook metadata and opening, with Drive unavailable and a replay. |
| Rollback | DB composition disables/drains writes, requires verified Markdown body parity with no pending jobs, then existing exact Sheet export parity before the authority flip. Unknown/missing/conflicting Drive stops rollback. |
| Security | New application/integration modules use server-only. Client DTO is domain-only. PGlite proves forced RLS, zero policies and browser-role table/function denial; production PostgREST queue/ack arguments execute against the SQL catalog using an injected local HTTP shim. Public hygiene checks pass. |

The additive outbox SQL has not been applied live. It adds no columns to the
version-2 row representation; separately reviewed live enablement must explicitly
require the new migration as well as the compiled row schema version. The live
client methods are prepared but the live container remains unwired. See
[DB-7 operations](docs/ops/database-draft-authority.md).

## Verification environment and commands

The assigned node_modules remains its original junction to the main checkout.
Complete checks use the external synthetic copy
`C:/Users/jbbug/projects/cs151-build-scratch`, with the existing installation
linked and already-declared missing Supabase/PGlite packages copied from the
existing `D:/tmp/cs148-deps` cache. No install/download was used. Before the
final run, all 591 tracked files were byte-identical; the sole subsequent
scratch-only source exception is `next.config.ts` setting `turbopack.root` to
`C:/Users/jbbug/projects` so external dependency junctions resolve.

Local installed tools include Next 16.3.6, Vitest 5.0.1, TypeScript 5.9.3 and
Playwright 1.63.0. Next/Vitest differ from manifest pins, so clean-lockfile hosted
CI remains required. The Supabase CLI was unavailable; no installation or live
tool was substituted. The additive migration follows repository ordering and is
executed under PGlite. Official changelog, RLS and invoker-function docs were
consulted; hosted Advisor/PostgREST security evidence is not claimed.

Every Vitest, typecheck, lint, build and Playwright command used `bash ~/bin/heavy`.
No full Vitest suite was run. The final application SHA is above.

| Exact command | Result |
| --- | --- |
| `bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components tests/unit/google tests/unit/ai tests/unit/domain/markdown.test.ts --maxWorkers=1` | PASS, exit 0: 60 files / 860 tests, zero skipped, 98.95 s. |
| `bash ~/bin/heavy npm run typecheck` | PASS, exit 0. |
| `bash ~/bin/heavy npm run lint` | PASS, exit 0, no warnings/errors. |
| `bash ~/bin/heavy npm run build` | PASS, exit 0; compile 3.7 s, TypeScript 4.9 s. |
| `bash ~/bin/heavy npx playwright test tests/e2e/markdown-authority.spec.ts tests/e2e/content-write-cutover.spec.ts --project=w375 --project=w1280` | PASS in db mode, exit 0: 4 tests, zero skipped, 15.3 s. |
| `bash ~/bin/heavy npx playwright test tests/e2e/markdown-authority.spec.ts --project=w375 --project=w1280` | PASS in sheet mode, exit 0: 2 tests, zero skipped, 7.9 s. |
| `git diff --cached --check`; private-path, secret and env scripts | PASS, exit 0; repeated with the final staged report before commit. |
| `node scripts/acceptance-matrix.mjs` | PASS: generated 107 IDs, zero missing; matrix includes DB-7 DRV-01 evidence. |

Initial non-passes were fixed, not represented as green: duplicate fixture
sections initially aborted the whole preview; source-link mutation hit the
protected-field allowlist; a client type import violated the boundary rule;
the component expected old DB copy; a SQL test needed an explicit result type;
CI policy regexes exposed CRLF in the edited workflow (restored LF); and the
mutation harness initially needed explicit UTF-8 output decoding. The first
expanded run had 765 passed/4 failed; the next expanded run passed 860/860.

## Adversarial verification

Lenses: correctness/representation, integration/concurrency/retries,
auth/privacy/RLS and false-green test integrity. Each implementation mutation
was applied only in scratch, required exactly one replacement and a changed
SHA-256, required an assertion failure/exit 1, and restored original bytes in
finally with equality verification. No test was mutated, and no mutant was committed.
The tested implementation modules are identical in the final application SHA;
the later T2 fix changed only the full editor metadata and its browser assertion.

For the first, second, third and fifth rows, the command prefix is
`bash ~/bin/heavy npx vitest run tests/unit/application/markdown-authority.test.ts --maxWorkers=1 -t`.
For SQL it is
`bash ~/bin/heavy npx vitest run tests/unit/supabase/markdown-export.test.ts --maxWorkers=1 -t`.

| Implementation mutation | Final filter | Applied SHA-256 prefix | Result |
| --- | --- | --- | --- |
| Remove unexpected Drive body refusal | `hand-edited section` | `d00e85bbb5ce55f7` | killed, exit 1 |
| Default missing import direction to Markdown | `matches sections by Library ID` | `e3b01b05a582aec8` | killed, exit 1 |
| Delete a newer queued save on old completion | `completion of an older export` | `72fdb02207a97817` | killed, exit 1 |
| Remove SQL outbox enqueue for changed body | `one apply_patch atomically enqueues` | `68dc36137bed62ae` | killed, exit 1 |
| Restore Drive-first path for DB save | `saves and loads with no Drive reads` | `80bc60314e5951e3` | killed, exit 1 |

Restored acceptance command:
`bash ~/bin/heavy npx vitest run tests/unit/application/markdown-authority.test.ts tests/unit/supabase/markdown-export.test.ts tests/unit/security/ci-policy.test.ts --maxWorkers=1`
passed 3 files/24 tests after all five mutations. Final directory checks repeat
that restored source. Hosted/independent-backend mutation execution is not claimed.

## Browser and T2 copy review

Final application/build identity: `11a6b1e3416e4f4d751bd68cd5e3e6cd819de581` /
Next build ID `qOYLAEizG4OQseAtECjjz`. DB: 4/4 passed. Sheet: 2/2 passed.
Build environment is synthetic `CS_DATA_MODE=fake`, `AI_PROVIDER=fake`,
`CS_COMMIT_SHA` equal to the final application SHA. Browser uses that same SHA,
`CS_E2E_PREBUILT=1`, `CI=1`, and separately `CS_E2E_CONTENT_STORE=db`/`sheet`.
The repository harness owns both local child servers; no unknown process is killed.

The initial DB run passed four journeys at both widths. Visual inspection then
caught the full editor's old Markdown revision/Invalid Date metadata. The follow-up
commit names the database source and adds an explicit no-Invalid-Date assertion.
Final synthetic screenshots at 375/1280 show readable source copy, exact-text
comparisons, explicit non-default direction buttons and the corrected source
metadata. Import-panel axe found zero violations at both widths; no horizontal
overflow or page errors. DB save/reload works during injected Drive failure;
Sheet keeps saving disabled when its canonical Drive section is unavailable.
The import action is absent and its API refuses in Sheet mode. This is local
responsive T2 inspection, not independent review or physical-device evidence.
Screenshots inspected: `db-body-editor-w375.png`, `db-body-editor-w1280.png`,
`db-body-import-w375.png`, `db-body-import-w1280.png` (synthetic, not committed).
Both owned ports 3390/3391 were no longer listening after the harness exited.
Only harmless server NO_COLOR/FORCE_COLOR warnings appeared; no test skip,
provider warning or blocked check was counted as a pass.

All added/changed user-facing strings follow existing InlineResult, text,
buttonClass and reconcile conventions. Sheet wording is retained. Exact strings
and templates (shared occurrences listed once):

- `The database holds your saved draft. Drive receives a separate export; export delays appear in Fix issues.`
- `Saved in the database. Drive export is queued.`
- `Already saved in the database.`
- `Draft source`
- `Database; Drive is an export`
- `Drive draft export is behind`
- `{Library ID}: Drive export is behind`
- `{Library ID}: Drive export needs attention`
- `Awaiting verified Drive export. The database draft is saved.`
- `Export is unconfirmed ({code}). The database draft is saved. Conflicting Drive text is preserved.`
- `No usable master link. The database draft is saved.`
- `Drive could not be read. The database draft is saved.`
- `The section is missing or duplicated. The database draft is saved.`
- `The database is authoritative. A conflicting Drive body is preserved; preview Import Markdown master to choose a direction.`
- `Markdown export queue` (unreadable-source label)
- `Import Markdown master`
- `Preview sections matched by Library ID. Compare exact text, then choose a direction for each section. Unmatched sections are not imported.`
- `Drive master link`
- `Preview master`
- `Working…`
- `Duplicate sections refused: {Library IDs}. Give each Library ID one section, then preview again.`
- `{Library ID}: Bodies differ; choose a direction`
- `{Library ID}: Bodies match`
- `Database body`
- `Markdown body`
- `Use Markdown body`
- `Keep database body`
- `The preview is out of date. Preview the master again.`
- `Import could not complete. Your saved database draft is kept.`
- `Import failed.`
- `Database body kept. Drive was not changed.`
- `Markdown section imported into the database.`
- `Import {Library ID}` (preview article accessible name)

## Cleanup and remaining gates

Cleanup is partially blocked by automatic approval review. All **431** scratch
junctions/reparse points were validated beneath the literal scratch root and
**detached individually, nonrecursively**. A fresh traversal confirmed **zero**
remaining reparse points. The subsequent separately checked recursive removal
of that exact root was rejected before execution with reason **blocked by policy**.
A separate nonrecursive command to remove only the 20 task-created regular
log/harness files was also rejected before execution with the same reason.
No alternate shell, deletion bypass or permission prompt was attempted.

Exact remaining synthetic-only scratch root, outside the repository:
`C:/Users/jbbug/projects/cs151-build-scratch` (source copy, copied cached
Supabase/PGlite, synthetic build/test/screenshots, private scratch Git metadata;
**no remaining dependency junctions**).

Exact remaining task-created files, outside the repository:

```text
D:/tmp/cs151-acceptance.log
D:/tmp/cs151-browser-db-final.log
D:/tmp/cs151-browser-db.log
D:/tmp/cs151-browser-sheet-final.log
D:/tmp/cs151-build-final.log
D:/tmp/cs151-build.log
D:/tmp/cs151-lint-final.log
D:/tmp/cs151-lint.log
D:/tmp/cs151-mutate.py
D:/tmp/cs151-mutation-completion.log
D:/tmp/cs151-mutation-db_save.log
D:/tmp/cs151-mutation-direction.log
D:/tmp/cs151-mutation-export_conflict.log
D:/tmp/cs151-mutation-sql_outbox.log
D:/tmp/cs151-mutations.json
D:/tmp/cs151-restored.log
D:/tmp/cs151-target.log
D:/tmp/cs151-typecheck.log
D:/tmp/cs151-unit-final.log
D:/tmp/cs151-unit.log
```

The assigned worktree node_modules remains its original junction to
`C:/Users/jbbug/projects/content-studio/node_modules`; its target was not
modified. Existing shared caches and other tasks' scratch directories were
outside this cleanup and were not touched.

No hosted security/Advisor, copied workbook/Supabase branch T3, independent SQL
backends/leases, production deployment/T4, freeze, backup permissions/billing,
observation windows or real scheduled run has passed. DB-6 backups still cover
six authority/history tables, not the derived Markdown outbox; live enablement
must define/rehearse outbox backup or safe reconstruction without adopting an
unknown Drive baseline. Current fake jobs/failure status are process-local.
Drive retains its existing metadata-check/write residual race. Keeping the DB
body is deliberately not a force-export conflict-resolution action. No live
readiness, production cutover date, issue closure or remote PR state is claimed.

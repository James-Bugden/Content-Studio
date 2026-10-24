# CS-059 / DB-5 build report — round 1

- Issue: [#149](https://github.com/James-Bugden/Content-Studio/issues/149).
- Classification/role: Heavy / build. Branch: `cs-149-db`; only this worktree changed.
- Base: `e02d6b57eff67130de2a808bd525e754949cae94` (DB-1 through DB-4 merged; equal to `origin/main` at inspection).
- Final implementation/test SHA: `c9d7fb5133a87ce85150df024d25e0c872c6eef3`.
- Implementation commits: `e893eaf`, `d62163c`, `46aacfc`, `c9d7fb5`; the following report commit changes documentation only.
- No push, GitHub write, PR creation/edit/merge, deployment, live SQL, database migration or production flag change. Issue stays open. No new dependency or lockfile change; no `npm install`/`npm ci`.

## Result

The synthetic container now composes `ContentReadCutoverRepository` for
`db-read`: DB reads expose `sheet_revision`; the existing Sheet repository owns
all four mutation paths. A successful Sheet read-back alone reaches the
idempotent `write_through` RPC. Its separate hashed operation ID and the DB
version observed before the Sheet write protect the derived copy. DB failures
cannot veto or authorize a Sheet mutation. Old operation replays cannot copy a
historical result over a newer row.

A failed copy returns success plus `refresh_pending`, retains the returned
saved record/revision and exposes a reconcile item. Imports repair the actual
shared fake DB, using an uncached Sheet repository rather than the DB read model.
The overlay clears on matching fingerprints; reconciliation reconstructs lag
after a process restart. Ordinary Content reads do not run that Sheet scan.
The Phase C Sheet cache is three seconds; the DB reader has no retained cache.
Sheet-mode defaults and cache behavior are preserved.

The draft saga checks the fresh Sheet before touching Drive. Draft and Typefully
sagas preserve copy/pending steps and identify Sheet as the mutation provider
in `db-read`. Editor save/conflict/hook/mismatch messages use the selected write
authority; revision labels are store-neutral. The existing JSON `sheet` keys
remain for compatibility. The fake Schedule seed now matches the Sheet's
formula-aware revision fingerprints.

Shared import/copy conversion refuses unclassified integers/timestamps and
oversized combined UTF-8 rows. Such a copy refusal leaves a successful Sheet
save pending; it never silently coerces or vetoes the authoritative patch.
SQL still enforces its own jsonb byte cap, including formatting overhead.

The default remains `sheet`; **every live DB mode still refuses startup** and
the production composition still has no live typed client. No production phase
has flipped. See the [Phase C runbook](docs/ops/runbook.md#phase-c-content-read-cutover-db-5--mig-11)
for rollback, exact T3/T4 rehearsal steps and measurement procedures.

## Acceptance evidence and limits

| ID / requirement | Local evidence | Status beyond local tests |
| --- | --- | --- |
| MIG-11 imported token and fresh save | Shared read contracts plus Library/Queue/Schedule mutation contracts over fakes and PGlite; exact Sheet token, read-back copy, replay and conflict | Live owner gate remains |
| MIG-11 stale since import | All three collections reject external Sheet edits; no copy; draft preflight proves Drive remains untouched | Independent hosted backend rehearsal remains |
| MIG-11 failed copy | Successful Sheet result with pending step; returned record and list/get read-your-writes; CAS rejection, DB outage, numeric/byte-cap refusal | Cross-instance displays can remain stale until repair |
| MIG-11 repair | Fake and real SQL `import_run` repair pending records; configured scheduled import clears reconcile state; restart reconstructs pending items | Real copied-workbook/branch scheduler rehearsal remains |
| MIG-11 rollback | Fresh Sheet composition ignores poisoned/unavailable DB methods; inventories retain failed-copy saves; 56 selected Sheet browser journeys pass at both widths | Every journey/full CI and live rollback have **not** been run |
| MIG-06/07/08 regression | Schema gate, complete migration chain, durable operations/history/audit and exact production `write_through` RPC argument names execute locally | Hosted security advisor/PostgREST/independent-backend isolation not claimed |
| MIG-09 regression | Typed import/parity, exception classes, same shared conversion and source-isolation regression | No live parity claim |
| MIG-14 regression | Shared read contracts include cutover composition; Typefully contracts run Sheet, DB and DB-read; selected browser journeys in Sheet, DB-read and DB | Full dual-mode CI is unrun |
| REV-07/08, DRV-03/04, TYPE-02/04/05, PUB-01/02 | Exact Unicode/whitespace, fresh authority preflight, provider failure/retry, final-copy/analytics and stale/conflict regressions | No real-provider T3/T4 claim |

## Environment and successful commands

Windows, Node `24.15.0`; existing installed Next `16.3.6`, Vitest `5.0.1`,
Playwright `1.63.0`, TypeScript `5.9.3`. The existing Next/Vitest installations
differ from the manifest pins; lockfile-based CI remains required. Missing
packages were recovered **only in external scratch**, at their exact lockfile
versions and with archive integrity checks: PGlite `0.5.8`, Supabase JS and its
Auth/Functions/PostgREST/Realtime/Storage packages `2.117.0`, Phoenix `0.4.5`,
and iceberg-js `0.8.1`. No live credentials were used.

The main `node_modules` junction was untouched. Scratch initially linked existing
packages; Turbopack refused links outside its root, so only scratch junctions
were detached without traversal and existing packages copied into scratch.
Every tracked worktree file was byte-compared with scratch after restoring
mutations: zero mismatches. All heavy commands used `bash ~/bin/heavy`.

Final targeted T0 command (external scratch; `CS_TEST_MODE=unit`):

```text
bash ~/bin/heavy npx vitest run tests/unit/application/content-read-cutover.test.ts tests/unit/application/content-repository-contract.test.ts tests/unit/supabase/content-import.test.ts tests/unit/supabase/content-import-operation.test.ts tests/unit/supabase/content-import-pglite.test.ts tests/unit/supabase/content-writes.test.ts tests/unit/supabase/content-db.test.ts tests/unit/components/post-editor-save.test.tsx tests/unit/google/drive-saga.test.ts tests/unit/typefully/reconcile-create.test.ts tests/unit/typefully/sync-analytics.test.ts
```

**PASS: 11 files, 369 tests, zero skipped; 31.99 seconds, exit 0.**
`bash ~/bin/heavy npm run typecheck`: PASS, exit 0.
`bash ~/bin/heavy npm run lint`: PASS, exit 0.
Repository private-path/secret scanners and `git diff --check`: PASS.
Next production builds also run through the queued Playwright web-server command.

Browser matrix uses the unchanged repository config, one worker, both
`--project=w375 --project=w1280`; the runtime selector is
`CS_E2E_CONTENT_STORE`, defaulting to Sheet. Common command prefix:
`bash ~/bin/heavy npx playwright test`.

| Mode | Files / selector | Result |
| --- | --- | --- |
| `db-read` | `content-read-cutover.spec.ts editor.spec.ts smoke.spec.ts calendar.spec.ts typefully.spec.ts backlog.spec.ts`, grep below | 58 passed, zero skipped, 1.1 min |
| `sheet` rollback | Same selected existing files without `content-read-cutover.spec.ts`, grep below | 56 passed, zero skipped, 54.1 s |
| `db` carried editor/replay checks | `tests/e2e/database-writes.spec.ts` | 6 passed, zero skipped, 24.7 s |
| Final `db-read` source snapshot | `tests/e2e/content-read-cutover.spec.ts tests/e2e/smoke.spec.ts`, both widths | 6 passed, zero skipped, 33.7 s; final exact-SHA build/result below |

The first two commands used the full `tests/e2e/` paths and this selection:

```text
--grep 'MIG-11|TYPE-|PUB-|Threads:|REV-|DRV-|health|security|two tabs|denied Drive|a Sheet and Markdown|viewer gets|CS-049|UX-06|UX-07|week view|month view|Content Source filter|CS-059|CS-056'
```

The Sheet command omits `MIG-11` (that spec is DB-read-only). External Sheet
fixture edits in editor/Typefully journeys explicitly import before testing
the DB-served display; behavior assertions remain intact. The stale-since-import
contracts separately prove refusal without an import. Health expects the active
DB capability when applicable. No full unit/e2e suite was run, per memory rules.

## Adversarial verification

Skeptical lenses: authority/revisions, concurrency/replay/import integration,
privacy/live-start boundaries, and false-green test integrity. Applied each
mutation to implementation bytes in scratch, asserted the replacement and
changed SHA-256, ran the targeted test through the queue, then restored bytes
in `finally`. No mutation was committed.

| Applied mutation (digest prefix) | Test selection in `content-read-cutover.test.ts` | Evidence |
| --- | --- | --- |
| Serve DB-version tokens (`02edce124ecb`) | `-t 'uses the imported Sheet token'` | RED: 6 failed |
| Ignore copy CAS refusal (`a3d5f0765fac`) | `-t 'overlapping import/copy'` | RED: 2 failed |
| Import from the DB-served repository (`791f31968690`) | `-t 'configured import always'` | RED: 1 failed |
| Rename live RPC `p_row` to `p_patch` (`620ebd1ded88`) | `-t 'uses the imported Sheet token'` | RED: 3 SQL cases failed; 3 fake cases passed |

The importer mutation initially survived the pending-only test because the
overlay masked the wrong source. Added a regression with a new external Sheet
edit and a failing DB read model; the same implementation mutation then failed.
After restoration, all 369 targeted tests passed. Tests excluded by mutation
`-t` are not counted as acceptance passes.

Earlier failed attempts were not passes: initial fixture revision/capability
expectations; one accidental worktree test run missing PGlite; scratch Turbopack
link rejection; first browser fixture assumptions; one Windows Playwright worker
exit (`3221226505`) during dirty recovery; and a lint unused import. Corrected
the defects/environment, reran the complete selected browser matrix without
other concurrent checks, and obtained the green results above.

## T2 and owner/live gates

Synthetic screenshots of save/pending/reconcile were visually reviewed at
375/1280: saved text remains readable, success and pending are distinct,
the reconcile action wraps within the viewport, and the store-mode fact is
visible. Targeted axe and horizontal-overflow assertions passed. A separate
interactive agentic-browser review is **unavailable/incomplete**: the computer-use
browser inventory returned `[]` (IAB unavailable). Automated Playwright and
screenshot review are not represented as that missing interactive check.

**T3 and T4 were not run and are not passes.** No real workbook or Supabase
branch was available. The runbook contains the exact copied-synthetic-workbook,
Supabase-branch, independent-backend, failed-copy/import, rollback and exact
deployed-SHA smoke checklists. Live startup stays blocked until that owner gate
and a separately reviewed wiring change. Independent PR review, remote CI,
deployment and post-merge verification are outside this local build round.

Phase C exit ledger, environment = local synthetic/PGlite, source SHA =
`c9d7fb5133a87ce85150df024d25e0c872c6eef3`:

| Measurement | Required | Actual |
| --- | --- | --- |
| Live DB-read observation | 7 consecutive days | Not started; not a pass |
| Sheet read rate limits | 0 | Not measured live; not a pass |
| Lag-attributed stale refusals | 0 | Not measured live; not a pass |
| Warm Backlog p95 | <1000 ms | Not measured live; not a pass |
| Cold Backlog p95 | <2500 ms | Not measured live; not a pass |

Known limits: the overlay is per instance; failed-copy reads on another instance
can lag until import/reconciliation. Sheet's documented one-round-trip write
race remains. Reconcile adds authoritative Sheet reads whose quota/latency must
be measured. SQL's jsonb byte cap can reject a boundary-size row that passes
the compact transport precheck; this remains a successful Sheet save with a
pending repair. Imports intentionally do not delete absent Sheet rows (DB-4
contract). These limits and unknown live measurements do not authorize a cutover.

## Final identity and cleanup

Final smoke used `CS_E2E_CONTENT_STORE=db-read` and
`CS_COMMIT_SHA=c9d7fb5133a87ce85150df024d25e0c872c6eef3`, with the queued
Playwright command and both configured widths. PASS: 6 tests, zero skipped,
33.7 seconds; Next build ID `8RnzSF8IDankWwuY6Ulmq`. The final queued lint also
passed. Byte comparison of every tracked worktree file against the tested
scratch snapshot returned zero mismatches after all mutations and label fixes.
Earlier broad matrices cover `e893eaf`; later changes were the byte-cap guard,
its regression tests and store-neutral revision text. The final targeted
contracts/build/smoke cover those changes. The DB-mode label matrix ran the
final source snapshot, with a previous-commit health label; the final DB-read
smoke above uses the correct exact SHA.

External scratch, its complete `node_modules`, downloaded dependencies, builds,
synthetic screenshots, mutation logs, task logs and scratch marker were deleted
after verification. Paths were checked against the dedicated temporary root;
package junctions were detached without traversal. The main `node_modules`
junction remains present and readable. No other worktree was modified.

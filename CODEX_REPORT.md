# CS-058 / DB-4 — build round 1

Date: 2026-10-25 (Taipei). Tier: standard. Role: build.
Task PR label: 148; [GitHub issue #148](https://github.com/James-Bugden/Content-Studio/issues/148).
Branch: `cs-148-db`, assigned isolated worktree.
Base: `b174339f90d48a5d78ae0ce89c8d740d5ba9760b` (origin/main).
Implementation commit: `0be090c830f91f03b4755d35820129fd434c7ded`.
This report is a subsequent documentation-only commit.

## Delivered

- Typed import over one complete `buildSheetMirrorSnapshot`, with schema gate,
  versions captured before the Sheet read, typed cells/links, preserved unknown
  columns and original settings values/notes/Sheet positions.
- Separate import port, explicit server-only PostgREST `import_run` client and
  atomic import fake. No edits to DB-3's repository/write-path implementation,
  existing fake/read client, or SQL migrations.
- SHA-256 binding counts, collection hashes, rows/preconditions and exception
  ledger. Formula display, number formatting and trailing whitespace classifier;
  changed formula text cannot hide behind a formula marker.
- Ten-percent list sampling and forced comparisons for the existing Library
  and Schedule reads on every reconcile load. The Sheet result is served;
  comparison adds zero Sheet reads. A 500 ms comparison budget bounds waiting
  for DB results. Failed/stalled comparisons become blocking measurements.
- Recorded ID-set equality, per-collection field percentages, sample counts,
  nearest-rank import-lag p95 and complete UTC days green. The measurement
  window covers seven completed days plus today, or 200 requests if longer.
  Repaired import failures lasting over an hour remain recorded in that window.
- Reconcile mode/parity summary, import lag items, safe counts/hashes/exception
  details, owner retry button and bounded keyboard-scrollable exception ledger.
  Existing owner POST and CRON_SECRET-protected cron GET reuse the operation.
  Runbook documents thresholds, recovery and remaining production gates.

Read AGENTS.md, MASTER-SPEC, migration design, ADR-0002 including NOTES,
DB-1 SQL and DB-2 interfaces. Applied implementation, QA, React checklist and
adversarial-verification procedures; reviewed the actual diff and synthetic
browser screenshots. No independent-agent review is claimed in this build round.

## Acceptance evidence

| ID / contract | Result and evidence |
| --- | --- |
| MIG-09 synthetic exactness | PASS locally. Import into an empty fake, then compare all six adapter collections: IDs, cells, links, domain values and normalized settings agree. PGlite executes actual DB-1/DB-2 migrations and DB-4 envelopes, checking every supplied typed column against persisted rows. Synthetic counts: Library 12, Queue 5, Schedule 21, Settings 18. |
| MIG-09 exceptions | PASS locally. Formula display and `1,234` produce named ledger entries; 1234 is persisted as an integer. Trailing whitespace is narrowly classified. Arbitrary changed formula text is unclassified; malformed numeric conversion blocks. Unknown-column payloads and exact raw settings rows survive construction. Duplicate setting targets are refused. |
| Complete snapshot / retry | PASS locally. Failed collection reads make zero import calls and preserve rows. A failed apply retries successfully on the next complete run. Late conflicts preserve the fake's prior snapshot. PGlite rejects an invalid final batch row and proves no partial content/history/operation/import-run changes. Replay adds no history or ledger entries. |
| MIG-10 calculations | PASS locally. Recorded samples drive ID equality, percentages, counts, p95 and seven-day streaks; missing observations remain unknown. Tests cover old repaired mismatches aging out, red current samples, missing days and an over-hour failure remaining red after repair. These are synthetic calculations, not seven days of production observation. |
| MIG-10 regression seams | PASS locally. Default sampling boundary, zero additional Sheet reads, unchanged Sheet response, failed/stalled DB comparison, failure-age recovery and 15/60-minute reconcile thresholds are tested. Difference telemetry contains only collection, field, kind and fingerprint. |
| Carried ADR findings | Snapshot hash covers the full envelope. Zero-row summary sources are explicitly named and still fail ID equality. Ready Queue revision differences are excluded. Summary parity compares the served adapter results; no real Sheet summary parity is claimed. |
| T1 / T2 | PASS locally at 375 and 1280 px: authenticated reconcile, retry, imported evidence, lag display, axe scan and overflow assertion. Reviewed screenshots; bounded the expanded ledger after mobile review and reran both projects successfully. |

## Commands and results

All Vitest, TypeScript, lint and Playwright execution used `bash ~/bin/heavy`.
No full suite, npm install/ci, live database command, push, PR creation, merge,
deployment or issue closure was performed.

```sh
bash ~/bin/heavy npx vitest run \
  tests/unit/supabase/content-import.test.ts \
  tests/unit/supabase/content-parity.test.ts \
  tests/unit/supabase/content-import-operation.test.ts \
  tests/unit/supabase/content-import-pglite.test.ts \
  tests/unit/supabase/sheet-mirror.test.ts \
  tests/unit/application/reconcile.test.ts \
  tests/unit/application/content-repository-contract.test.ts \
  tests/unit/domain/mapping.test.ts \
  tests/unit/security/boundaries.test.ts \
  --config tmp/db4/vitest.config.ts --maxWorkers=1 --silent
```

PASS: 9 files, 84 tests, exit 0. After final measurement-window hardening:

```sh
bash ~/bin/heavy npx vitest run \
  tests/unit/supabase/content-parity.test.ts \
  tests/unit/supabase/content-import-operation.test.ts \
  --maxWorkers=1 --silent
bash ~/bin/heavy npx tsc --noEmit --project tmp/db4/tsconfig.json
```

PASS: 2 files, 11 tests (including the new window regression), exit 0.
Full-project typecheck using real dependency declaration aliases: PASS, exit 0.

```sh
bash ~/bin/heavy npx eslint \
  src/application/content-import.ts src/application/content-parity.ts \
  src/application/container.ts src/application/content-db.ts \
  src/application/reconcile.ts src/application/sheet-mirror.ts \
  src/domain/records.ts src/domain/mapping.ts src/domain/settings.ts \
  src/lib/sheet-mirror-operation.ts src/observability/events.ts \
  src/integrations/supabase/content-import-store.ts \
  src/integrations/supabase/fake-content-import.ts \
  'src/app/(studio)/reconcile/page.tsx' \
  src/components/reconcile/content-import-button.tsx \
  tests/unit/supabase/content-import.test.ts \
  tests/unit/supabase/content-parity.test.ts \
  tests/unit/supabase/content-import-pglite.test.ts \
  tests/unit/supabase/content-import-operation.test.ts \
  tests/e2e/content-parity.spec.ts \
  tests/unit/application/content-repository-contract.test.ts
bash ~/bin/heavy npx playwright test tests/e2e/content-parity.spec.ts \
  --config tmp/db4/playwright.config.ts
```

Lint PASS, exit 0. Final browser run PASS: 2/2 projects, exit 0. The ignored
Playwright config preserves both standard viewports and uses a local Webpack
dev server on port 3200, fake providers, db-shadow and synthetic test auth.
This is not a production build or deployed-build smoke.

`git diff --check`, `git diff --cached --check`,
`node scripts/check-private-paths.mjs`, `node scripts/scan-secrets.mjs` and
`node scripts/check-env.mjs`: PASS. Hygiene scans included staged new files.

Earlier failures were corrected, not counted as passes: settings ordering
after import; TypeScript tuple inference and a scratch declaration alias;
Playwright's initial config-directory working directory; then Turbopack's
rejection of the shared node_modules junction. Webpack resolved the latter
without changing the junction. Next dev's generated AGENTS.md addition was
restored; the canonical file is unchanged.

## Mutation evidence

Ignored runner `python tmp/db4/mutate.py` asserted one exact source replacement
per probe, recorded SHA-256 before/after, ran the exposing targeted test via
the shared queue, and restored original bytes in `finally`. All three probes
failed with exit 1 for the intended assertion. These ran before final
window/count hardening; subsequent restored-source tests above passed.

| Probe | Actual source mutation | Exposing failure |
| --- | --- | --- |
| hash-envelope | Hash an empty exception ledger instead of the actual ledger | Canonical full-envelope hash assertion fails. |
| sample-quota | Force every request selected | Expected one DB call at the .099/.1 boundary, received two. |
| formula-mask | Accept any formula-marked difference | Expected unclassified/null for changed text, received formula_display. |

Applied source digests (original followed by mutated):

```text
hash-envelope
6fdc070a371eacd2d1be03052d24b79ce30029be21d7cddaf0cb2a1873852145
b443fb7b11b2999fd26f0cffe413d96adf3082511a7f78e03d53944413f4bdcd
sample-quota
c4b35578278bd6ca977672393268ed1747d8b67f9e43ebfd7ecfca4e61cc2ab3
99e0e26d5ebf2a180ee32848270c021dddb9c790b2a993b0fb47bb8c1b8bbcd7
formula-mask
6fdc070a371eacd2d1be03052d24b79ce30029be21d7cddaf0cb2a1873852145
5760c730f228438ae227caa04c35b1f8272d98e082633396ac2d2be5fec3b425
```

## Dependency and disk hygiene

The shared node_modules junction lacked PGlite/Supabase. Copied existing DB-1
recovery from `D:/tmp/cs145-r1-deps` into this task's `D:/tmp/cs148-deps`;
checked all 10 copied package versions against the lockfile, including PGlite
0.5.8 and Supabase 2.117.0. No retrieval or installation was needed. Ignored
Vitest aliases target real PGlite JS; the temporary tsconfig extends the real
full-project config, resolves actual PGlite/Supabase declarations and disables
incremental output without weakening compiler checks.

**Cleanup blocker:** automatic approval review rejected deleting the task-owned
`D:/tmp/cs148-deps`, including a retry using its verified literal absolute path,
with `blocked by policy`. The directory was verified to be an ordinary directory
containing only `pglite` and `node_modules`, but remains on disk. No alternative
deletion mechanism was used to bypass that rejection. Original DB-1 scratch,
dependency manifests, shared junction and other worktrees were not changed.

## Remaining limits and phase gates

- Store still defaults to Sheet; live database modes remain rejected by env
  validation and the typed live client is unwired. Nothing was applied to any
  live database. All content and screenshots are synthetic.
- Parity evidence is explicitly per-instance, capped at 10,000 samples / 30
  days, and lost on restart. Durable cross-instance evidence is required before
  a real production phase exit. No production thresholds are claimed green.
- DB-1's import RPC is upsert-only. Absent rows are retained and surfaced as
  unexpected IDs, rather than retired from incomplete or complete snapshots.
  A reviewed retirement protocol is still needed before advancing a real-data
  phase containing removals. No partial retirement can occur in this build.
- A timed-out comparison does not cancel its underlying read through the
  current read port; the network timeout remains a second bound. Sampling adds
  no Sheet reads, but incurs bounded DB/background work.
- Real Sheet summary differences, three full Phase A imports, hosted security
  denial/advisor checks, T3/T4, production latency and real independent-backend
  concurrency are not evidenced by PGlite/fakes. No production build, hosted CI
  or deployment verification is claimed.
- DB-3's carried ledger-mode, helper exposure and independent-backend retry
  findings remain DB-3's responsibility; its code was left unchanged.

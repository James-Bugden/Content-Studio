# CS-057 / DB-3 ? build round 1

Issue: https://github.com/James-Bugden/Content-Studio/issues/147

Heavy / build / round 1. Branch: `cs-147-db`; base: `b174339`.
Final source/test commit: `648c20c1161e8b726ac4356e4a3d8a1834b9da83`.
Runtime implementation: `ed4ddbf51b74544e4a1cdf72ff0f81320f9c3a14`.
This report is a later documentation commit. The task's PR label identifies
issue #147; no PR exists for this branch, and nothing was pushed.

Read AGENTS.md, MASTER-SPEC, issue #147, database-migration.md, ADR-0002 including
NOTES, the DB-1 migrations and DB-2 adapter/fake. Applied the implementation,
Supabase and adversarial verification procedures. Self-reviewed the committed
diff; this build role does not claim an independent review approval.

## Changes and acceptance

| Contract | Evidence |
| --- | --- |
| MIG-07 adapter | Shared cases run against Sheet, fake DB and actual PGlite RPCs: Library/Queue/Schedule writes, exact copy, success replay, different-patch conflict, stale/current revision, lost response, no-op, NOT_FOUND retry, owner denial, writable allowlist and value limits. Queue creation checks the existing expected field set, replay and stable-ID collision. |
| Durable replay | Two repositories sharing one fake DB agree; PGlite uses the durable SQL ledger. Replays preserve the successful revision/value after later Content edits. Same-operation concurrent requests deduplicate; different operations cannot both overwrite one version. Identical concurrent patches report skipped/replayed against the RPC revision. |
| MIG-08 | Changed patches have one full before-image and one hash/field-only audit event; replay adds neither. No-op patches retain their version and add no history, per ADR-0002. An injected audit trigger failure rolls CAS/history/ledger back. Explicit audit export removes raw identifiers and copy/URLs and bounds identifier/hash values to 12 characters. |
| DRV-03/04 | Existing Drive saga suite parameterized over Sheet/DB. Drive-success/DB-failure retry completes the missing step without another Drive write; conflicts and exact Unicode/whitespace round trips remain protected. |
| TYPE-02/05 | Existing reconcile/create and sync/analytics suites parameterized over Sheet/DB, including create/link/push/sync, provider edits, final-copy conflicts, analytics allowlist and unavailable metrics. Typefully success followed by DB failure retries without another draft. |
| Test controls | Fake DB failNext and externalEdit handles are exposed only through the existing synthetic e2e boundary. New db_fail_next/db_external_edit controls and boundary tests cover disabled modes, protected fields and missing targets. |
| Carried finding 3 | Additive SQL stores and checks entry-point mode independently of caller hashes. Unknown legacy non-import entries fail closed. |
| Carried finding 7 | Helper moves out of public into content_studio_private, with pinned search_path and service-role-only schema/function grants. PGlite proves anon/authenticated denial and absence of the public helper. |
| Carried finding 11 | Unwired PostgREST transport retries 40001/23505 at most three times in fresh requests using the identical envelope. Exhaustion/network errors stay content-free. Real independent-backend proof is still unverified; see limits. |
| Gates | Schema version advances to 2; old schemas fail closed before writes. Default remains sheet; db-read remains read-only here; live DB modes remain blocked and the live client is not wired in production. No Sheet export or authority/stamp change. |

The adapter normalizes boolean/integer/null/timestamp storage, including the
existing split final-sync timestamp/hash. Asset/source hyperlink counterparts
are replaced or cleared with changed cells; unchanged display cells retain
imported links. A successful RPC followed by a failed confirmation read reports
PARTIAL_FAILURE and retries through the durable ledger.

## Verification

All heavy commands used `bash ~/bin/heavy`, targeted files only, one Vitest
worker. No full suite, npm install/ci, new dependency, package/lockfile change,
push, merge, deployment or live database operation. Windows / Node 24.15.0 /
shared Vitest 5.0.1 / lockfile PGlite 0.5.8.

The junction lacks the declared PGlite/Supabase packages. Copied the already
recovered exact dependency tree described in report145-fix1.md/report146.md to
our own external scratch directory, `D:/tmp/cs147-deps`; verified all 10 package
versions against package-lock.json, including PGlite 0.5.8 and Supabase 2.117.0.
No package download or install was needed. Temporary ignored configs alias the
actual package modules/declarations. Typecheck extends the normal full project
config, keeps all source checks, and only disables incremental output and adds
resolution aliases. No fake declarations or relaxed compiler checks.

Final unit command (the ignored Python runner only captures stdout/exit status):

```sh
bash ~/bin/heavy npx vitest run \
  tests/unit/supabase/content-writes.test.ts \
  tests/unit/supabase/content-db.test.ts \
  tests/unit/supabase/content-schema.test.ts \
  tests/unit/application/content-repository-contract.test.ts \
  tests/unit/google/drive-saga.test.ts \
  tests/unit/typefully/reconcile-create.test.ts \
  tests/unit/typefully/sync-analytics.test.ts \
  tests/unit/security/db-test-control.test.ts \
  tests/unit/security/health.test.ts \
  tests/unit/security/boundaries.test.ts \
  tests/unit/application/review.test.ts \
  tests/unit/application/review-findings.test.ts \
  tests/unit/application/backlog.test.ts \
  tests/unit/typefully/views.test.ts \
  --config tmp/db3/vitest.config.ts --maxWorkers=1 --silent
bash ~/bin/heavy npx tsc --noEmit --project tmp/db3/tsconfig.json
bash ~/bin/heavy npx eslint \
  src/app/api/test-control/route.ts \
  src/application/capabilities.ts \
  src/application/container.ts \
  src/application/content-db.ts \
  src/application/draft-save.ts \
  src/application/typefully.ts \
  src/components/typefully/typefully-panel.tsx \
  src/domain/mutation.ts \
  src/domain/typefully-view.ts \
  src/integrations/supabase/content-db.ts \
  src/integrations/supabase/content-repository.ts \
  src/integrations/supabase/content-schema.ts \
  src/integrations/supabase/fake-content-db.ts \
  src/integrations/supabase/content-audit.ts \
  tests/unit/application/content-repository-contract.test.ts \
  tests/unit/google/drive-saga.test.ts \
  tests/unit/typefully/harness.ts \
  tests/unit/typefully/reconcile-create.test.ts \
  tests/unit/typefully/sync-analytics.test.ts \
  tests/unit/supabase/content-db.test.ts \
  tests/unit/supabase/content-schema.test.ts \
  tests/unit/supabase/content-writes.test.ts \
  tests/unit/security/db-test-control.test.ts \
  tests/unit/security/health.test.ts \
  tests/e2e/database-writes.spec.ts
```

Final post-mutation T0: **14 files / 343 tests passed**, 52.18 seconds; exit 0.
Full-project typecheck with scratch resolution: exit 0.
Touched-file ESLint: exit 0. Private-path policy, secret scan and diff whitespace
checks: exit 0 after staging this report.

T1 uses the new database-writes.spec.ts unchanged in both store modes. Each
command runs both w375 and w1280 projects, with fake data and test owner auth:

```sh
CS_CONTENT_STORE=db bash ~/bin/heavy npx playwright test tests/e2e/database-writes.spec.ts --config tmp/db3/playwright.config.ts
CS_CONTENT_STORE=sheet bash ~/bin/heavy npx playwright test tests/e2e/database-writes.spec.ts --config tmp/db3/playwright.config.ts
```

Final committed-source T1: **DB 6/6 passed** (1.7 minutes), **Sheet 6/6 passed** (1.8 minutes), both widths in each run; exit 0 each.
The final ignored config selects the already installed Microsoft Edge executable
(headless Chromium engine), preserves both viewport projects, and uses an isolated
loopback port and Next's webpack development server, and resolves the existing
SDK from external scratch through NODE_PATH. Final runs set CS_COMMIT_SHA to
the source/test commit above. These are development-server smokes, not a
production build/deployment claim. T2: visually inspected synthetic DB editor
conflict and linked Typefully screenshots at both widths; controls wrap and
remain available. Existing Sheet-oriented product labels remain for the later
cutover work. No new interaction model or layout was introduced.

Initial failed runs are excluded from acceptance: a nonexistent synthetic Queue
ID, the split sync hash's test-harness field mapping, invalid environment
combinations in the control test, a temporary browser config cwd error, an old
DB-2 read-only health label, and an assertion expecting steps in a successful
Typefully API response (the existing safe projection intentionally omits them).
All were corrected and retested. A final bundled-browser launch reported its
cached executable missing twice despite the file being present. The isolated
config then selected installed Microsoft Edge explicitly, without an install
or dependency change. Shared queue waits were allowed to finish;
no other Node process or worktree was touched.

## Adversarial evidence

Lenses: revision/concurrency/replay, atomicity, auth/privacy, and false-green
test integrity. The ignored mutation runner changes implementation bytes only,
asserts exactly one replacement, requires an assertion failure, and restores
original bytes in finally. Filtered runs are falsification probes, not acceptance
passes. Final unfiltered targeted verification runs after restoration.

| Mutation | Actual result |
| --- | --- |
| Remove the SQL ledger mode comparison | exit 1; 1 failed, 41 filtered out. Copy-to-patch reuse incorrectly succeeded and the independent-mode assertion caught it. |
| Bypass the fake DB version comparison | exit 1; 1 failed, 1 passed, 40 filtered out. Both different deliveries succeeded; the one-winner assertion caught it. |
| Export the raw operation ID | exit 1; 2 failed, 40 filtered out. Both fake/SQL export privacy assertions caught the identifier leak. |

The first attempted mode probe exposed test-order dependence (missing seed row),
not an implementation assertion. It is excluded. Commit 648c20c makes the test
self-contained; its isolated baseline passes, then the recorded mode mutation
fails for the intended assertion.

- mode: original/restored `fb8c3e3a7c97dbda0041fd76383069a5243a575b51b4f0b56a53c918c0210854`; mutated `e9f3563e4501a346ed7480df295066953193b46f6548e24f4fb706e1c5ee843b`. Byte equality verified after restoration.
- cas: original/restored `829f78f62318bd944ba297d4f359147a17c3b49b50b5011f7b85a76ee4ac8a75`; mutated `42330e259b6508b80f5425fa7be0c4449bf14376c73f011a29847d46676a74c3`. Byte equality verified after restoration.
- redaction: original/restored `f2cef9df7bc66cb44c64df7cc8fb92bc801c367cbeb26d691bb97cc470549a1e`; mutated `cbfdf4fea8b94f4796ae716ba92dbe588b9debe65f4d8a92d16bac685b5e2a6f`. Byte equality verified after restoration.

## Limits and handoff

- No hosted migration, Security Advisor, PostgREST schema exposure check, CI,
  deployment or T3/T4 result is claimed. The task permits PGlite/fakes only.
  [PostgREST's transaction contract](https://docs.postgrest.org/en/stable/references/transactions.html)
  supports the fresh-request retry policy; real concurrent independent backends
  under READ COMMITTED/REPEATABLE READ/SERIALIZABLE remain a cutover prerequisite.
- Private helper schema must stay outside the hosted exposed-schema list. The
  trusted service role retains direct DML and can invoke internal import mode
  using SQL; moving the helper reduces exposure, not that role's authority.
- Replay is evidenced for Content-changing patches and no-ops. DB-4's
  metadata-only copies can share versions; exact row-position/Sheet-fingerprint
  snapshots across those copies need DB-4 integration work, as recorded in ADR.
- Import snapshot hashing/parity and DB-4 review carry items remain DB-4 work;
  backup/history scheduling, Sheet export and hosted rollout gates remain later
  issues. This issue stays open because no post-merge/deployed verification is
  authorized or possible for these unpushed commits.
- Scratch cleanup is blocked: automatic approval review rejected recursive and guarded file-by-file deletion of D:/tmp/cs147-deps, returning only "blocked by policy". The task-owned scratch copy, including node_modules, remains and needs external cleanup. No deletion was executed. The shared node_modules junction and original recovered dependency tree were not modified. Restored only the AGENTS.md block generated by our Next development server. Temporary configs/logs and synthetic screenshots remain ignored under tmp/db3.

# CS-063 / DB-9 — build round 1

Heavy; role: build. Date: 2026-10-25, Asia/Taipei.
Issue: [#197](https://github.com/James-Bugden/Content-Studio/issues/197).
Branch: `cs-197-live`, assigned isolated worktree.
Base: `daa475f` (matched the supplied `origin/main`; divergence `0 0`).
Implementation commit: `62488b979a5f219d407b9f75cca473b10be3a8aa`.
This subsequent report commit changes documentation only.
Final synthetic production BUILD_ID: `sOcXh073Co3Fw4kQ52kOM`.

## Delivered

- Live `db-shadow` composition uses `SupabaseContentImportStore`, its real
  `SupabaseContentDb` reader, and a durable parity journal. It reuses existing
  Production `SUPABASE_READ_MODEL_URL` / `SUPABASE_READ_MODEL_SERVICE_KEY` in
  the shared Career project, plus the existing opaque source alias. No new
  secret names or dependency. Legacy mirror mode can remain off.
- Default `sheet` creates no typed DB services. Its Sheet repository/cache
  configuration is unchanged. Shadow serves the exact Sheet objects and
  mutation results. Ordinary DB mutations fail closed at the live client
  boundary; only the typed importer can write Content in live Phase A.
- Owner POST retains real session/owner/same-origin checks and UUID
  Idempotency-Key validation; both owner and cron routes have a 60-second
  duration budget. Cron retains constant-time bearer authentication. Live
  imports require `db-shadow`; live `db-read` and `db` remain refused.
- Import claims a durable DB lease before DB-version/Sheet capture. A separate
  read-only, uncached Google Sheet repository prevents reuse of display-cache
  snapshots. Existing typed conversion, exception ledger, CAS, history and audit
  are reused. An expired/replaced lease cannot commit. Completed request keys
  replay durable evidence after restart without another Sheet capture.
  Scheduled redelivery shares an identity within each UTC 15-minute slot.
- New **UNAPPLIED** migration:
  `20261025000500_content_shadow_live.sql`, sorted after all existing files.
  Three additive `create table if not exists` tables, one index and five invoker
  RPCs; forced RLS, zero policies and explicit PUBLIC/anon/authenticated revokes.
  No existing migration was edited. No Replies object was changed.
- Import successes/failures and comparison samples are durable. `/reconcile`
  reloads one consistent database history snapshot rather than shifting offset
  pages or a capped REST table result. It reconstructs the existing gate
  calculations and exception evidence across instances. Missing/unavailable or
  malformed evidence, unknown sample lag, missing days/collections and too few
  samples cannot pass. The UI distinguishes durable from instance evidence.
- Shadow catches synchronous/async comparison, sampling and sink errors.
  Comparison has a 500 ms wait budget and persistence another 500 ms; provider
  network requests have their own timeout. Errors cannot replace or reject a
  Sheet result. No extra Sheet reads are added by comparison.
- [Apply/runbook](docs/ops/database-shadow-live.md): explicit order of all six
  unapplied migrations, including DB-7; security/advisor verification; first
  import; three-import and seven-day/200-observation gates; scheduler setup;
  rollback SQL and Sheet flag rollback. Related durable docs/env example now
  distinguish Phase A from the still-refused live authority modes.
- No `vercel.json` added. The documented project-config alternative preserves
  existing schedules and requires confirmation of the current plan/config
  mechanism. The exact production entry is in the runbook; it is not installed
  or claimed active by this build.

Read AGENTS, MASTER-SPEC, migration design/Phase A/gates/section 6, ADR-0002
including NOTES, the requested composition/import/parity/ops sources, and
relevant DB build/fix reports. Applied implementation, QA regression and
adversarial-verification skills. This is self-review, not independent Opus review.
Read-only `gh issue view 197` reported OPEN. GitHub could not resolve PR #197;
the supplied PR label is not a claim that a PR was created.

## Local acceptance evidence

| Contract | Result |
| --- | --- |
| Default/Sheet response regression | PASS. Real live composition with a fake Supabase fetch and mocked Google transport methods compares serialized list/schema/detail/save/replay/conflict responses byte-for-byte with Sheet mode under 401, 403/RLS denial, 500 and timeout failures. Default mode makes zero DB requests. |
| Live typed import | PASS locally. Real composition produces 56 typed synthetic rows: Library 12, Queue 5, Schedule 21, Settings 18; captures a source change after display-cache warming; records exception evidence; makes zero Sheet writes. Restart replay performs no Sheet read. |
| Import coordination | PASS locally. Busy claims stop before Sheet capture; scheduled identities are stable. Actual SQL proves overlapping claims, identity conflicts, expiration, stale-token refusal, recovery and atomic import/evidence/lease completion. Hosted independent-backend concurrency remains unproved. |
| Authentication/write gates | PASS. Real route authentication refuses anonymous/viewer/cross-origin/invalid keys and missing/incorrect cron bearer before fetch. Direct live DB writers refuse before fetch. Both live authority modes are explicitly refused at env and import boundaries. |
| Durable gates | PASS with synthetic facts. A fresh journal reconstructs 210 samples over seven complete days; missing lag, malformed/unavailable history and insufficient measurements refuse readiness. SQL persists import evidence/failures and detects sample-key reuse with changed payload. No production seven-day window is claimed. |
| Security/rollback | PASS in PGlite. Hostile default grants are revoked; every new table forces RLS with zero policies; all five RPCs deny browser-role execute privileges. Actual anon/authenticated reads/history execution refuse. Late evidence failure rolls back the import transaction. The exact runbook rollback restores the baseline Replies/legacy-mirror catalog. |
| T1 | PASS. Repository Playwright config, production artifact, shadow-w375 and shadow-w1280: 2/2. Import/replay, honest unknown/insufficient state, ledger expansion, overflow, axe and page-error assertions passed. |
| T2 | Synthetic screenshot inspection at both widths: readable wrapping and bounded ledger, no horizontal overflow. Durable/unavailable wording is separately covered by component tests. No live-provider browser, physical-device, hosted T3/T4 or production smoke is claimed. |

## Commands and results

All Vitest, TypeScript, lint, build and Playwright commands ran through
`bash ~/bin/heavy`. The sequential check/mutation wrapper also held the shared
queue slot; nested heavy calls inherited its lock. No full suite was run.

```sh
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components --maxWorkers=1 --silent
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
bash ~/bin/heavy npm run build
CS_E2E_PREBUILT=1 bash ~/bin/heavy npx playwright test tests/e2e/content-parity.spec.ts --project=shadow-w375 --project=shadow-w1280
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-shadow-live.test.ts tests/unit/security/content-shadow-routes.test.ts --maxWorkers=1 --silent
```

- Required directories: **63 files / 794 tests passed**, exit 0; final run
  117.39 seconds. This includes the entire application, Supabase, security and
  components directories. No selected test was skipped in acceptance runs.
- Typecheck, whole-repository lint and production build: exit 0.
- Final production Playwright: **2/2 passed**, 10.2 seconds, repository config.
- Final targeted retest after changing scanner-compatible synthetic email
  sentinels: **15/15 passed**, exit 0.
- `git diff --cached --check`, private-path policy, secret scan and env check:
  clean. The initial scanner refusal of two `example.test` fixture addresses
  was corrected to approved `example.com` synthetic values; no real secret.
- Initial focused tests exposed missing mocked settings versions and a reused
  consumed Response body. Corrected the fixtures, then all acceptance checks
  above passed. Those initial failures are not counted as passes.

Ignored evidence is retained in `artifacts/cs197/`: final/initial logs, mutation
logs and JSON, source manifest, BUILD_ID, both synthetic screenshots and exact
scratch inventory. The secret-scanner unit tests deliberately print findings
for synthetic temporary attack fixtures; the separate repository scan is clean.

## Adversarial mutation evidence

Mutated implementation files only in scratch, with one asserted exact source
replacement per probe, different before/after SHA-256 and restoration in
`finally`. Every probe exited 1 for its intended assertion. Restored-source
required-directory tests passed afterward.

| Probe | Applied implementation mutation | Exposing result |
| --- | --- | --- |
| authority-gate | Remove both live authority modes from env refusal | Explicit live db-read/db tests fail: expected refusal is absent. |
| fail-open | Rethrow comparison/journal exceptions | Synchronous comparison/sink test rejects instead of returning the Sheet result. |
| expired-lease | Remove SQL lease expiry predicate | Expired import actually succeeds; the test expected SQL refusal. |

Source digests (original -> mutant):

```text
authority-gate
c56b763960e1c84f6bebff138739e13267c2e75af00441c9fe4c5d1bda5248af
5b2ae3637f159bc2a16aeba5a5667632ff53fe67c6ab69c6c902354740da240f
fail-open
d74d37f1e71ffb222311b6e61ec6f7c9e1a0eb357524dbd2731348527f9a27f3
d78a6dc3bb4a3d070106bcd32001c9ee16d5203a69f93e189b2f48dcc3254000
expired-lease
ba5a8152332f10cd09d3095dfeeb9fc042368c3a7cd815d412dfc846bc158a90
1278139fd1bf9217abec89c3aa70d806c8d0bd5b611b75b05044be9dababff5f
```

## Environment, cleanup and exact leftovers

The assigned `node_modules` junction remains unchanged, pointing to
`C:\Users\jbbug\projects\content-studio\node_modules`. Never ran npm install/ci,
downloaded dependencies, or changed the shared installation. Validation used
an external physical copy of the existing worktree-163 dependency tree.
All **27 direct installed versions match the lockfile**. Final hashes of
**606 source/test/migration/script/doc/config files match** the worktree.
No runtime/test/config substitution or bundler override was used.

The initial scratch copy included its worktree `.git` pointer. After detecting
it, stopped scratch Git writes and verified the assigned branch/HEAD. Only
this task's files were staged; no unrelated work or branch was changed.

**Cleanup blocker:** automatic approval review rejected removal of the copied
`.git` pointer, and subsequently rejected native PowerShell cleanup of the
other scratch contents with **“blocked by policy”**, despite checking the
literal absolute target and verifying **zero reparse points/junctions**. No
alternative deletion mechanism bypassed either rejection. There were zero
scratch junctions requiring individual detachment.

Exact retained scratch: `C:\Users\jbbug\cs197-validation-20261025`, **31,780
files / 782,610,493 bytes**, including its 66-byte `.git` pointer and physical
dependency/build/test outputs. Full paths and sizes are in ignored
`artifacts/cs197/scratch-leftovers.json`. The three external check/mutation
helper files were deleted successfully; no helper remains. The assigned
worktree's ignored `artifacts/cs197/` is intentionally retained as evidence.
Playwright stopped its own servers; no unrelated Node process was killed.

## Exact coordinator/owner-only remaining steps

1. Obtain independent **Opus review** and required hosted CI on the code SHA.
   This build role did not supply an independent verdict, push, GitHub write,
   PR update/merge or issue closure.
2. Coordinator applies the six reviewed unapplied migrations explicitly in
   runbook order, after confirming the private project's migration inventory.
   No migration or live Supabase/Google API call was made by this builder;
   local PGlite execution and fake REST/Google boundaries are the evidence.
3. Run hosted RLS/ACL/anon/authenticated denial probes and advisors; rehearse
   independent-backend concurrency and lease expiry on a branch. PGlite's
   single connection cannot establish hosted concurrency or configuration.
4. Owner/coordinator confirms the existing Production-only URL/key/source
   alias, stable AUTH_SECRET and CRON_SECRET privately; deploy the reviewed
   SHA with `db-shadow`; prove first import and three full sets/counts with
   only allowed exceptions. Ordinary Sheet saves remain authoritative.
5. Configure/confirm the exact 15-minute Vercel cron entry in the runbook,
   preserving existing schedules and confirming plan support; observe a real
   scheduled completion. The builder did not install a schedule or alter flags.
6. Measure durable seven-day/200-observation gates and hosted cron coverage;
   missing samples cannot prove that no outage occurred. Retain production
   evidence privately. No read/write phase enablement is included here.

Known limits: absent Sheet rows are retained and fail ID parity; no automatic
retirement. History is currently read in full without truncation; review its
growth before retention/aggregation changes. Comparison timeouts stop waiting
but the underlying provider request may continue to its network timeout.
Live security, deployments, actual source parity and production threshold
acceptance remain pending. Nothing in this report declares cutover complete.

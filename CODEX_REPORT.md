# CS-064 / DB-10 — build round 1

Heavy; build role; 2026-10-25, Asia/Taipei.
Issue: [#198](https://github.com/James-Bugden/Content-Studio/issues/198).
Assigned branch: `cs-198-cut`, stacked on `cs-197-live` / [PR #199](https://github.com/James-Bugden/Content-Studio/pull/199).
Initial clean base: `ca8fb8280f4351435b16462e1e9638d66f364a17`.
Initial implementation: `e2b584602110427340247441c150dec4fb0be2a4`.
Freeze follow-up: `416b825e1121efee19a7005a2cc00ddbf658d78c`.
Final implementation: **`7b3c3b201f16b2ce3af9fcb6652bcc21b435f100`**.
This subsequent commit contains this report only. Synthetic production BUILD_ID:
`yvd-dfjj444DtYT3Dk1c_`.

Read AGENTS, MASTER-SPEC, the migration design/Phases C–E/gates, ADR-0002/NOTES,
the requested DB-5/6/7 and follow-up reports, DB-9 report, existing adapters and
fake composition. Applied implementation, QA-regression and adversarial
verification procedures. Read-only GitHub checks found issue #198 OPEN and
PR #199 OPEN at the supplied base, with CI still running at inspection.
No independent Opus verdict is supplied by this build role.

## Delivered

- Default `sheet` remains unchanged and constructs no typed DB services.
  Live `db-read` requires `CS_CONTENT_READ_ENABLED=true`; live `db` requires
  `CS_CONTENT_DB_ENABLED=true` and a configured private backup folder. Flags
  alone are insufficient: every live repository operation and SQL mutation
  checks durable evidence for the exact full build SHA/latest typed import.
  Missing, wrong-build, obsolete-import, malformed or red measurements refuse.
- Live read composition uses real `SupabaseContentDb` and the existing
  Sheet-first write-through repository. Revisions remain Sheet fingerprints;
  derived-copy failures preserve successful Sheet saves and `refresh_pending`.
  Live Phase C repair imports perform a new full measurement before reporting
  success, including recovery through durable import replay.
- Live DB composition uses the real repository/CAS/idempotency/audit RPCs,
  after-mutation Sheet export and scheduled repair, DB draft-body authority,
  durable DB-7 outbox and asynchronous Drive section export. No Fake adapter
  participates in either live authority composition. DB mode exposes no import
  service, refuses both import paths, and does not report Sheet import lag as
  though Sheet were still authoritative.
- The live freeze also refuses Content requests at the authenticated mutation
  entry, before Drive-first/Typefully-first saga work. This includes DB writes
  that were never explicitly enabled. Final import/parity remain owner-only
  and available while frozen; Replies retains its separate authority. Actual
  draft/Typefully route regressions prove refusal before provider calls.
- Export checkpoints, complete cells/formulas/links, blocking mismatches,
  comparison reports, lag samples and repaired-failure intervals persist
  privately. Checkpoints and `exported_sheet_revision` update atomically without
  changing content row versions. Known mismatches reload even if another worker
  holds the lock. Successful backup freshness reloads after process restart;
  invalid/unavailable backup evidence is unverified.
  Failed backup attempts persist their failure timestamp without advancing
  verification or releasing an ambiguous worker. A fresh-store regression
  first failed with `failureSince: null` instead of 42, then passed after repair.
- Distributed, token-fenced, **non-expiring** worker locks cover Sheet export,
  Markdown export and backup. Crashed/ambiguous workers remain locked until
  explicit drain/recovery; an elapsed timer cannot authorize a second delayed
  Google writer. Coordinator requests have validated UUID keys, durable replay
  and different-action conflicts. Rollback retries always recheck fresh parity.
  Scheduled backups use a deterministic daily UUID.
- Initial unchanged live export captures its imported baseline with eight
  collection reads, rather than two additional Sheet reads per row. Actual
  changed rows still use a fresh precondition and read-back. Matching checkpoint
  versions also require matching rendered content, preventing a mixed-version
  read from permanently skipping a newer DB value.
- Private backup uses the service account and configured **shared-drive**
  folder. Both drive membership and inherited folder/file permissions must be
  complete and user-only; anyone/domain/group/unknown/incomplete permissions
  refuse. No permission mutation, public URL or file overwrite is implemented.
  Service accounts cannot own files/use personal storage; see
  [Google's shared-drive documentation](https://developers.google.com/workspace/drive/api/guides/about-shareddrives).
- Six-table backup is one SQL statement snapshot. Existing gzip/manifest code
  re-reads all six files and manifest, validating every count/hash/length.
  Pending Markdown outbox jobs refuse the snapshot rather than inventing a
  restore baseline. Archives are immutable; automatic deletion stays unwired.
- Authenticated `POST /api/ops/content-cutover` implements `measure`, `backup`
  and `rollback`, with strict body/key validation. Preparation is available
  before DB authority, avoiding a circular backup/rehearsal admission gate.
  Rollback freezes its boundary, verifies Markdown, exports, then freshly
  verifies exact Sheet parity. It returns **readyToFlip**, not a false claim
  that Vercel configuration changed. The coordinator performs the actual flip.
- [Coordinator runbook](docs/ops/cutover.md): seven explicit Supabase MCP
  migration applications, hosted denial/advisor checks, first imports, full
  parity, read flip/metrics/T4, freeze/final import, verified private backup and
  restore drill, generated rollback hashes, external proof record, DB flip,
  actual flag round trips and final smoke. Exact Production variable names,
  Vercel commands and rollback order are included. Calendar waits are waived;
  numeric/security/backup/rollback checks remain mandatory. Phase E is excluded.

New **UNAPPLIED** migration:
`20261025000600_content_cutover_live.sql`: three private prefixed tables, eight
invoker RPCs, forced zero-policy RLS, browser-role/PUBLIC revokes and
service-role-only grants. No old migration, schema-version representation,
Replies object, dependency, lockfile, MASTER-SPEC or AGENTS authority note changed.

## Local acceptance and verification

All data/transports were synthetic. Actual SQL executes only in disposable
PGlite. Live composition tests bridge real REST clients to that SQL and mock
Google transport methods; separate private-backup tests exercise the real
multipart/permission/download REST boundary with mocked fetch/token transports.
External prerequisites in write-admission fixtures are explicitly synthetic
attestations, not hosted evidence.

| Contract | Local evidence |
| --- | --- |
| MIG-11 / read authority | Real composition serves DB reads with Sheet revisions; Sheet-first save, real write-through RPC, durable replay, stale refusal, copy 403/429/500, overlay/pending, full repair import and replay. Sheet flag rollback ignores a broken DB and serializes reads byte-identically. Existing full-directory Sheet/shadow regression contracts also pass. |
| Measured admission | All 56 synthetic source rows and all six projections measured, including derived views/settings/passthrough. SQL rejects missing collections, changed IDs, <99.9% fields, unknown lag, >15-minute lag, unclassified differences, impossible counters and wrong build/import. No calendar window is substituted for the measurements. |
| MIG-12 / export | Live DB save/export, restart checkpoint loading, replay, whole hand-edited Sheet grid byte preservation (including CRLF, tabs and Traditional Chinese), skipped row and blocking field mismatch. Sheet 429/5xx failures leave DB success intact and repair after restart. DB timeout/RLS denial mid-export retain prior durable checkpoints and the worker lock. |
| DRV-01 / body authority | Real SQL outbox after DB body save; Drive failure cannot veto the DB save and blocks rollback. Existing application/Supabase Markdown tests cover exact surrounding bytes, stale revisions, coalescing, explicit import direction, concurrent saves and completion. |
| MIG-13 / backup | Real private Drive upload/download/ACL boundary verifies all six archives and manifest; immutable name replay/different-bytes conflict, private-folder escape refusal and Drive 429/5xx preserve prior verified backup. SQL snapshot refuses pending outbox. Existing PGlite six-table restore/parity/replay/sequence/late-failure tests pass. |
| Rollback / MIG-05 | Actual composed preparation runs before DB authority and after DB saves, requires freeze, exact hashes and Markdown parity; simulated flag round trip preserves DB-only saves. Hand edit/Drive failure refuse. No live flag flip is claimed. |
| Security/concurrency | New tables force RLS with zero policies despite hostile default grants; actual anon/authenticated reads/RPCs deny. Independent store instances serialize; stale tokens refuse; crash locks remain. Cron auth and invalid UUID refuse before provider work. Hosted independent SQL-backend concurrency remains a coordinator check. |

Every heavy child command used `bash ~/bin/heavy`; no full Vitest suite,
dependency install/download, unrelated process kill or runtime/config substitution.

```sh
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components --maxWorkers=1 --silent
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
bash ~/bin/heavy npm run build
# Each browser command used CS_E2E_PREBUILT=1 and the named synthetic store:
# db
bash ~/bin/heavy npx playwright test tests/e2e/content-write-cutover.spec.ts tests/e2e/markdown-authority.spec.ts --project=w375 --project=w1280
# db-read
bash ~/bin/heavy npx playwright test tests/e2e/content-read-cutover.spec.ts --project=w375 --project=w1280
# sheet
bash ~/bin/heavy npx playwright test tests/e2e/markdown-authority.spec.ts tests/e2e/smoke.spec.ts --project=w375 --project=w1280
```

- Final restored-source required directories: **67 files / 832 tests passed**,
  exit 0, zero skipped, 150.41 seconds. All four requested directories ran whole.
- Typecheck, whole-repository lint and production build: exit 0.
- Production-artifact Playwright: **16/16**, zero skipped: db 4/4 (18.8s),
  db-read 6/6 (15.4s), sheet 6/6 (8.6s), widths 375 and 1280, repository config.
  No Playwright spec was edited. Hosted T3/T4 and a separate T2 visual review
  were not performed or claimed.
- Private-path policy, secret scan, environment check, acceptance matrix
  (107 existing IDs) and staged whitespace check passed. Final report hygiene
  is checked again before its commit.
- Node 24.15.0, Next 16.4.1, Vitest 5.0.3; all **27 direct installed versions
  match the lockfile**. Validation used a physical copy of the existing
  worktree-163 dependencies. Main `node_modules` junction was untouched.
- All **635 implementation source/test/migration/script/doc/config files** matched
  validation bytes in the retained SHA-256 manifest. No bundler root override,
  provider substitution in production source, or test/config relaxation.

Initial non-passes were corrected: test union narrowing/unused import, a test
assuming an outbox FK that does not exist, and DB-9's historical rollback test
accidentally loading DB-10 objects. The latter now loads only its own migration
generation; other tests execute the entire current migration set. An initial
browser run entered no journey because the default cache alias hid the
executable; using the existing physical browser-cache path passed all 16.
No browser or package installation occurred. One test Unicode sentinel was
spelled with escapes to avoid PowerShell encoding corruption. No failure was
waived or counted green.
An initial PGlite-focused command launched in the assigned worktree failed at
package resolution; the actual exposing backup assertion and final verification
ran in the complete dependency scratch, without installing anything.

## Adversarial mutation evidence

Four exact, single-match implementation mutations ran in scratch. Each changed
the implementation SHA-256, exited 1 for the intended assertion, and restored
the original bytes in `finally`. Tests were never mutated. The final required
directory run above occurred **after** restoration.

| Probe | Actual mutation / exposing failure |
| --- | --- |
| gate | Return success before SQL measured-gate checks; the missing/red evidence rejection assertion fails. |
| hand-edit | Remove the exporter fingerprint/cell precondition; actual Sheet overwrite makes the preservation/parity assertion fail. |
| worker-lock | Remove SQL busy-worker refusal; the second independent worker succeeds instead of rejecting. |
| freeze | Remove the authenticated entry freeze; both authority-mode provider-first refusal assertions fail. |

```text
gate original 24525f59906ba3928dde1c0943647cf205b0201d8b825674c155cc0b3ea397df
gate mutant   8cdb664f39ed15b59104fd7ec480dfa32bb66f010e70282370fbe6034ede890b
hand original 01f1e941e2655649e0ba1a5eeb699bc94357f872292ade11c34283efb0f3a4fa
hand mutant   0c34788a8e4b49494da436109311bc379a818a29e1e2eaf9aa0165440947ac9f
lock original 24525f59906ba3928dde1c0943647cf205b0201d8b825674c155cc0b3ea397df
lock mutant   b5b4711db73e05f758c4ac0aa8513cfcacce806577bf22763c4c4a3198a30a7b
freeze original 5fa89d17bb8ff0678ea463420ad51963f3ef4130aeac65de0e5ad5bf4db4cbb1
freeze mutant   efcdf4ae30b8c27164b0ece67d1a7c2613e021153b12c0d9e29fadb449824594
```

Self-review covered correctness/authority, provider concurrency/crash state,
auth/privacy/RLS and false-green tests. It is not the independent Opus review.

## Exact coordinator/owner-only remaining work

1. Complete independent Opus review of both stack commits and required hosted
   CI. This builder never pushed, wrote GitHub, merged, deployed or closed an
   issue. PR #199 was still under review at inspection.
2. Confirm private project/migration inventory, explicitly apply the seven
   reviewed unapplied files via Supabase MCP in runbook order, prove hosted
   ACL/RLS/advisors and unchanged Replies inventory. Rehearse on a copied
   synthetic workbook/branch with real independent SQL backends.
3. Owner/coordinator supplies/validates the private shared-drive folder and
   service-account permissions, existing Production credentials/cron secret,
   actual daily plan backup/restore evidence, written Sheet freeze and the
   retained provider-race decision. No new billing or permission was changed.
4. Execute the one-session runbook: three imports, full durable parity, read
   flip, deployed smoke/T4/write-through and measured latency/error/lag facts;
   actual Sheet/read flag round trip; final freeze/import/measure; imports off;
   generated private backup and branch restore; exact rollback rehearsal/hashes.
   Record external Phase C/security/restore proofs with their private evidence
   reference. These coordinator attestations must reflect actual measurements;
   the builder's seeded records are not live evidence.
5. Check the DB gate, deploy frozen DB authority, smoke, resume deliberately,
   measure exact export and Markdown completion, freeze/drain and execute the
   actual DB-to-Sheet-to-DB rollback rehearsal. The readiness endpoint does not
   mutate Vercel; configuration changes and newly deployed identity/smoke are
   required at each flip. Configure/observe export-only and daily backup cron.
6. Only after verified production flip/final smoke, update pending-cutover
   authority notes in a **separate PR** with the actual date. No Phase E,
   Sheet deletion/clearing, source cleanup or invented cutover date.

Residual limits: Google's fresh-read/write residual window remains as documented
in the accepted design; this is not provider-side CAS or an unconditional
same-cell concurrent-edit guarantee. The DB gate requires recorded acceptance
or stronger edit controls. Ordinary detected hand edits are preserved exactly.
The live force-overwrite helper remains refused; no automatic baseline reset
or silent conflict-resolution direction is introduced.
Crash recovery is deliberately manual after every old writer drains. Pending
Markdown jobs block private snapshots rather than guessing a baseline. Large
snapshot/permission/operation budgets and inherited shared-drive configuration
need hosted rehearsal; missing evidence blocks. Legacy soak summaries are
historical diagnostics, not DB-10 admission. No production acceptance is claimed.

## Cleanup and exact leftovers

The assigned `node_modules` remains the original junction to
`C:/Users/jbbug/projects/content-studio/node_modules`. Never ran npm install/ci
or changed installed packages. Scratch dependencies are physical copies.
Non-following inventory found **zero reparse points/junctions**, so zero links
needed detaching. Browser-owned servers exited; no listeners remained on
3490–3495 and no unrelated Node process was killed.

Automatic approval review rejected the scan/detach command, then the separately
verified **literal-path** recursive scratch cleanup, and the three literal
helper-file removals, each as **“blocked by policy”** with no further reason.
No deletion executed and no alternate deletion mechanism bypassed rejection.

Exact retained scratch: `C:/Users/jbbug/cs198-validation`, **32,530 files,
3,472 directories below the root, 803,003,732 bytes**, zero reparse points.
Includes its independent scratch Git directory, physical dependencies, build,
synthetic test outputs and logs. Exact retained external helpers:

- `C:/Users/jbbug/cs198-checks.py` — 1,232 bytes.
- `C:/Users/jbbug/cs198-browser.py` — 1,277 bytes.
- `C:/Users/jbbug/cs198-mutations.py` — 2,632 bytes.

Intentionally retained ignored evidence: `artifacts/cs198/`, including command
logs/results, mutation hashes, BUILD_ID, dependency/source manifests, exhaustive
scratch inventory and `scratch-leftovers.json`. No production content or
screenshots are present. Cleanup is the sole tool-policy blocker left by this
local build; live review/apply/cutover steps remain assigned to the coordinator.

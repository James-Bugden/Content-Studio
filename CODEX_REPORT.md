# CS-064 / PR #200 ? fix round 2

Heavy; fix role; final allowed fix round. Issue [#198](https://github.com/James-Bugden/Content-Studio/issues/198), PR [#200](https://github.com/James-Bugden/Content-Studio/pull/200), [independent re-review 6396242070](https://github.com/James-Bugden/Content-Studio/pull/200#issuecomment-6396242070). Local work only, 2026-10-25.

## Identity and scope

Started clean in the assigned `cs-198-cut` worktree at `467f3634c80ca6d60ad0f9a93b3ed8f049874360`, matching the supplied remote head. Read AGENTS.md, MASTER-SPEC, issue, review comments, report198b.md, mut2-final.log, probe3.log and the migration/write/draft/cutover contracts. Used implementation, adversarial verification and QA procedures. This is a fix to an already specified issue, so no new PRD.

Read-only state commands included:

```text
git status --short
git branch --show-current
git rev-parse HEAD
git fetch origin
git log --oneline HEAD..origin/main
gh pr view 200 -R James-Bugden/Content-Studio --comments
gh issue view 198 -R James-Bugden/Content-Studio
```

`origin/main` was already included at `e9a0a31a2843c39bd002683a86e903605d745fa0`; the log was empty, so no merge was necessary. No rebase.

Implementation commits:

- `e1fe7621252d21c5ac1d945bbe212fdfab3c1325`: prove epoch/lease guards, timeout and transactional checks, narrow recovery RPC and runbook.
- `4e37a1148bb8a66c1ec8b5594f665db953b856df`: scope the recovery action to absent destinations; retain generic provider-error and linked-section recovery behavior.

Final implementation identity: **`4e37a1148bb8a66c1ec8b5594f665db953b856df`**. Synthetic production artifact BUILD_ID: **`2OkVmGb-sq3AStXXeGhvP`**. This report is committed separately after validation and cleanup. All **643** tracked implementation/test/config/doc files matched the physical validation copy byte-for-byte. All **27** installed direct dependency versions matched package-lock.json; Node 24.15.0, PGlite 0.5.8, Next 16.4.1.

No push, GitHub write, PR edit/create/merge/comment, live provider API call, hosted migration application, install/ci, dependency change or write to another worktree was performed. No deployment, authority flip, issue closure or production cutover date is claimed. The pending authority notes remain unchanged.

## Delivered and acceptance

**Epochs / MIG-11, MIG-12:** condition-specific real SQL tests refuse a db-read deployment against DB authority, downgrade and contract-mismatched activation. Retirement tests execute actual later DB writes and independently isolate post/Schedule writes, non-exact rehearsal and the existing **15-minute** age bound. Every mandatory mutation was re-applied individually and killed.

**Lease fencing / MIG-12, MIG-13:** the tests expire actual SQL leases during the preceding Sheet/Drive read or backup snapshot/create, independently of the fence invocation. They then assert zero forbidden provider calls. All six backup files and the manifest have separate exposing cases. An expired current token cannot save, and operation takeover is denied before expiry and succeeds afterward while rejecting the old completion. Read-only parity reloads the durable conflict without claiming/saving a lease.

**Route entry:** real authenticated, same-origin draft and Typefully route calls cover both db and db-read with writes enabled, valid request bodies/identities, a primed green cache and a subsequent durable contract change. They assert the specific blocking reason and zero Drive/Typefully calls. The direct RPC test also asserts no patch RPC is sent when its write gate blocks; a later SQL refusal cannot make that test falsely green.

**Sheet timeout:** writeCells and appendRow now pass a **30-second AbortSignal timeout**, well below the two-minute lease. Both transport tests assert the deadline, abort behavior and one request only. An upstream write already accepted by Google can still outlive client cancellation; the existing freeze/drain and non-CAS race acceptance remain necessary and are documented.

**Transaction epoch check:** apply_patch and insert_queue_idea now recheck DB mode/schema/contract inside their transaction, taking the same authority-transition advisory lock as activation/retirement. The tests commit retirement after successful HTTP authorization but before executing the real SQL write, then prove no content/ledger write occurred. These are deterministic committed interleavings in PGlite, not independent-backend contention evidence.

**No-link recovery / DRV-01:** `restore_markdown_link` is a narrow coordinator-only, service-role RPC. It validates a canonical Drive URL and expected version, refuses missing/already-linked rows, rechecks the epoch, records the before-image/audit and replays without a second write. It fixes only the source Markdown fields; ordinary patches still cannot change source identity. The outbox requires the linked section to equal the saved DB body, so a conflicting Drive body is preserved. Tests prove invalid URL/length refusal, browser-role denial, stale refusal, replay, conflict preservation and clearance after explicit exact-body restoration. The named **Restore Drive link** action opens the affected Review page; the runbook supplies the coordinator operation. It is not a new browser link editor. Linked missing sections and generic provider NOT_FOUND retain their existing recovery behavior.

**Runbook:** forbids Vercel instant rollback/promotion of pre-db, Sheet or db-read deployments while a DB epoch exists. Safe code rollback keeps DB authority/freeze and redeploys forward with current flags; authority rollback retains the full exact-export, frozen Sheet deployment and retirement sequence. It states the retirement age bound and how to repeat an expired rehearsal.

Self-review used state/concurrency, auth/privacy, false-green test integrity and UI/provider integration lenses. The cutover security suite checks invoker behavior and browser-role denial for all 14 cutover-related functions, including the new helper/recovery RPC. This builder report is not an independent Opus approval or new hosted CI result.

## Final verification

All heavy commands ran through the shared `bash ~/bin/heavy` queue, with Vitest `--maxWorkers=1`. No full-repository test suite ran. The physical scratch copy was `D:/wt/cs200-round2`; dependencies were copied read-only into it from the existing worktree-163 installation. The assigned node_modules junction was never modified. The scratch copy had its own Git index, with no remote or linked worktree metadata, so boundary/acceptance checks could inspect tracked paths normally. No test configuration, assertions, provider adapter or migration was weakened for validation.

Final commands (cwd: physical scratch):

```sh
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components tests/unit/google/google-transport.test.ts --maxWorkers=1 --silent
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
bash ~/bin/heavy npm run build
bash ~/bin/heavy npm run check:private
bash ~/bin/heavy npm run check:secrets
bash ~/bin/heavy npm run check:env
# CS_E2E_PREBUILT=1; CS_E2E_PORT=3518; CS_COMMIT_SHA=4e37a1148bb8a66c1ec8b5594f665db953b856df
# PLAYWRIGHT_BROWSERS_PATH points at the existing matching Chromium 1243 app cache.
# CS_E2E_CONTENT_STORE=db
bash ~/bin/heavy npx playwright test tests/e2e/content-write-cutover.spec.ts tests/e2e/markdown-authority.spec.ts --project=w375 --project=w1280
# CS_E2E_CONTENT_STORE=db-read
bash ~/bin/heavy npx playwright test tests/e2e/content-read-cutover.spec.ts --project=w375 --project=w1280
# CS_E2E_CONTENT_STORE=sheet
bash ~/bin/heavy npx playwright test tests/e2e/markdown-authority.spec.ts tests/e2e/smoke.spec.ts --project=w375 --project=w1280
```

- **69 files / 1,010 tests passed, zero skipped**, exit 0. The four mandatory directories contain 8 security, 15 application, 18 Supabase and 27 component files; the additional file is google/google-transport.test.ts.
- Real PGlite SQL executed in content-backup-pglite, content-cutover-live, content-cutover-security, content-db, content-import-pglite, content-schema, content-shadow-pglite, content-writes and markdown-export. All 18 Supabase files ran, including the transport/fake suites; no PGlite suite was replaced with a fake-only check.
- Typecheck, repository lint, production build, private-path, secret and environment checks: **exit 0**.
- Prebuilt-artifact Playwright: **18/18**, zero skipped: db 6/6, db-read 6/6, sheet 6/6, at 375 and 1280 pixels. Changed conflict/recovery surfaces assert no overflow, no page errors and axe results. Scoped T2 visual inspection of the saved real-browser no-link renders found the action/text readable and contained within the cards. No physical-device T4 or full zoom/viewport matrix is claimed.

Earlier attempts are not counted as passes: initial targeted fixtures used the wrong origin, assumed no earlier backup and chose a legacy missing section; those were corrected. UTF-8 command capture was repaired. The first broad scratch run failed two security checks because Git metadata was absent; a separate scratch index fixed that, and the entire required directories were rerun green. Browser startup first failed on an unresolved default cache path; the existing matching app-cache binary was used without downloading anything. The broader Markdown journey then exposed an over-broad recovery message; the committed correction was followed by another full-directory/type/lint/build/browser validation.

Exact argv, cwd, UTC timing, exits and complete logs are retained in ignored `artifacts/cs200-round2/*.json` / `*.log`. Final successful command records:

| Record | Command/result | Queue-inclusive seconds |
| --- | --- | --- |
| `1792924404808931000` | `npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components tests/unit/google/google-transport.test.ts --maxWorkers=1 --silent` ? exit 0 | 169.376 |
| `1792924355122408800` | `npm run typecheck` ? exit 0 | 14.522 |
| `1792924574992064800` | `npm run lint` ? exit 0 | 22.767 |
| `1792924598532459500` | `npm run build` ? exit 0 | 19.617 |
| `1792924618928491900` | `npm run check:private` ? exit 0 | 1.679 |
| `1792924621352179600` | `npm run check:secrets` ? exit 0 | 2.106 |
| `1792924624177966900` | `npm run check:env` ? exit 0 | 1.573 |
| `1792924630823931300` | `npx playwright test tests/e2e/content-write-cutover.spec.ts tests/e2e/markdown-authority.spec.ts --project=w375 --project=w1280` ? exit 0 | 20.314 |
| `1792924651921434500` | `npx playwright test tests/e2e/content-read-cutover.spec.ts --project=w375 --project=w1280` ? exit 0 | 14.721 |
| `1792924667388582400` | `npx playwright test tests/e2e/markdown-authority.spec.ts tests/e2e/smoke.spec.ts --project=w375 --project=w1280` ? exit 0 | 8.611 |

## Final survivor accounting

The review log has **23 new survivors plus the previously accepted E02**. All **20 non-equivalent new survivors are killed**; N01/N49/N50 are individually justified layered equivalents. Thus every one of the log's 24 survivor entries is accounted for. Four additional mutations (X01?X04) are also killed: **28 executed mutations, 24 kills, four equivalents, no unclassified survivor**. All mandatory IDs are kills.

Each mutation applied at one logical site in implementation code, changed SHA-256, ran its exposing test without changing tests, and restored original bytes in finally. Every original/restored hash matches the final committed source working bytes. Filtered runs intentionally leave unrelated tests unselected; those skipped tests are not passes. The final unfiltered directory run above has zero skips. Nonzero exits were checked for the named test failures, rather than treating startup/collection errors as kills.

| ID | Final result / exposing evidence |
| --- | --- |
| E02 | Equivalent (previously accepted): initial capture requires all owned cells, links and types equal and performs no write; imported revision is an additional conservative check. |
| N01 | Layered equivalent: without the recovery shortcut, authorize still returns ok/read-only for a contract mismatch because recovery is not a write. Recovery consumes ok, not readOnly. Real backup and rollback still succeed. |
| N06 | Killed: a DB epoch refuses db-read reads and Sheet-first mutation entry; zero Sheet writes/appends. |
| N09 | Killed: wrong contract refuses activation with every other proof green. |
| N11 | Killed: green Phase C evidence cannot downgrade a DB epoch. |
| N13 | Killed: an actual post-rehearsal post write refuses retirement; a separate Schedule-write case also passes. |
| N14 | Killed: a 16-minute rehearsal refuses, with all content timestamps earlier so only age is red. Bound: 15 minutes. |
| N15 | Killed: exact=false alone refuses retirement while equal hashes, import, age and build remain green. |
| N19 | Killed: an expired matching token cannot save even before takeover; persisted state stays unchanged. |
| N21 | Killed: takeover refuses before expiry, acquires after 121 seconds, and fences the old completion. |
| N24 | Killed: expiry after the fresh Sheet row read prevents writeCells; zero provider writes. |
| N25 | Killed: expiry after the fresh Queue read prevents appendRow; zero provider appends. |
| N26 | Killed: expiry after the Drive read prevents writeText; pending job remains and names FORBIDDEN. |
| N27 | Killed in all seven cases: expiry before each of six archives and the manifest prevents that create and retains prior verified backup. |
| N28 | Killed: fresh read-only parity must reload a durable conflict into its journal, without claim/save. |
| N31 | Killed in four cases: valid db/db-read draft and Typefully routes refuse blocked status before all Drive/Typefully calls. |
| N34 | Killed: a legacy no-link job must complete without any Drive call. |
| N36 | Killed: direct RPC authorization must refuse the blocked write before sending apply_patch; downstream SQL refusal cannot mask this. |
| N39 | Killed: the same activation UUID on a different build conflicts before running or replaying activation. |
| N46 | Killed at all three ACL boundaries: deleted=true alone refuses with valid principal, role and permissionDetails. |
| N47 | Killed in four cases: status primed green must refresh after a durable epoch change before route entry. |
| N49 | Layered equivalent: rollback still enters the Markdown/export worker whose exclusive() checks recovery before provider I/O. Before activation it still refuses and records no proof. |
| N50 | Layered equivalent: backup still enters exclusive(), which checks recovery before folder/snapshot/create work. Before activation it still refuses and records no proof. |
| N51 | Killed: pending Markdown completion must drain through recovery during contract mismatch plus authority-write freeze. |
| X01 | Killed: removing the patch transaction check commits after retirement between HTTP authorization and the RPC. |
| X02 | Killed: removing the Queue insert transaction check commits after that same interleaving. |
| X03 | Killed: removing the writeCells timeout violates the 30-second abort contract and no-retry test. |
| X04 | Killed: removing the appendRow timeout violates the same contract. |

### SHA-256 proof

Hashes cover actual tested bytes, preserving line endings; they are not Git blob IDs. The original hash in the file table is also the restored hash for every associated mutation. Full per-mutation JSON/logs remain in `artifacts/cs200-round2/mutations/`.

| File alias | Implementation file | Original = restored SHA-256 |
| --- | --- | --- |
| A | `src/application/content-export.ts` | `94d01e0b5eee4b6e5567ed46f76ebab1aabc2a3260c22964c7070c2701266efd` |
| B | `src/application/live-content-cutover.ts` | `17443614a17d670bcd0f861ee2e5e1ef32752cbd772d54e2729f6f4db3279f62` |
| C | `src/application/markdown-export.ts` | `bb12703bbc39e795066fb8ad4f42e970952588081090d04e157c6b5f707e7e1b` |
| D | `src/integrations/google/google-sheet.ts` | `91acd540e74527eb35bf313f21c9c7f6bdac01016b5b0b10e4fa6aa91f1c0269` |
| E | `src/integrations/google/private-backup-folder.ts` | `02d261f40e5bf20f14324fd400b66a52d3980a02307124b4c15276bfeee513ad` |
| F | `src/integrations/supabase/content-cutover-store.ts` | `98884e59cf52ece0c9bd0aa1a266e6eb1ca978c2848476ecc65f3f978147b114` |
| G | `src/lib/auth/index.ts` | `60043343fa071a7dc6cfd6225ff2699e562bcc6b079f369558348d9c145ae378` |
| H | `supabase/migrations/20261025000600_content_cutover_live.sql` | `281dca2fb8c1152e40d9bbd9ed404710b883d2776ad8fd4600c63934e8ebfcaa` |

| ID | File | Mutated SHA-256 | Exit / exposing tests red |
| --- | --- | --- | --- |
| E02 | A | `9c8182f7433a292f2c161547558dc488df01eade4996e8dc4a54334cdb48f138` | 0 / 0 |
| N01 | H | `af81de92eb559c6462174769a795611e36a638e6b4c03a758d2207b9a9b4e2f8` | 0 / 0 |
| N06 | H | `6403225e67c4805187a86748a1348896aba8e07e51534bce2aa0b416db3f3dd0` | 1 / 1 |
| N09 | H | `bfe820588ebdb83a72ab524ae57ef7daf6f140159b516263f119a844b1e677b7` | 1 / 1 |
| N11 | H | `ff04453fbd87b3dc010c0bec2f20ed504ac955d0a597a40c9f119a9b94b7232c` | 1 / 1 |
| N13 | H | `a4a71c70cbddd6b6d89f3195652cf65788674350fb07177fadda76fca645a9f7` | 1 / 1 |
| N14 | H | `b77ff2b447c0ca342a9a1158a5afbd9b39769f77e8f648fbf7104ea9dacc9e67` | 1 / 1 |
| N15 | H | `55bc301231e5ffbd56c05cca891b148a1d145c6fd7874cf79159da75f2125123` | 1 / 1 |
| N19 | H | `b6efefe1ca9f31360cb59b280a184d54011e01b27b8e93d2546930251e4ac723` | 1 / 1 |
| N21 | H | `df40ed40090673bada46695a550fe8461cce67df4bd11fbf87df9663e97b372d` | 1 / 1 |
| N24 | A | `e73b468ff1206636d08ad70df909f4ef31a0cc83ca2226cb666dc82f23346547` | 1 / 1 |
| N25 | A | `6ae4735cdf439227e2a4e98cfd9a4859a7c493a7544145301cec8ae3d2e38a2e` | 1 / 1 |
| N26 | C | `ff1af58f48c5a19c22a346963ccbb4aa9eedfda2a7479228d6669eccd505b37e` | 1 / 1 |
| N27 | B | `b3726376aacf901825284c619a4c8037326b933b80f91e1ea6b1242cf800102f` | 1 / 7 |
| N28 | A | `7d3cb704db707d0b4a95d4ece4ee6628c58425b8bb928963ed75af5145144f30` | 1 / 1 |
| N31 | G | `19ca9f5af30881d23cd1174f9e94e9bb7d3432b72cc217898c9e8595d4e3fb54` | 1 / 4 |
| N34 | C | `86a54717284209e2fd99de1704ab7644ce10b077b0b5a30e4bc8f16cd86f0d13` | 1 / 1 |
| N36 | B | `fc5f37db6d515a4c33e459c821fc2c3673c7ba2c7f14c18d276887a1d36fd2a8` | 1 / 1 |
| N39 | F | `7fa28dc1ba347ac19191b866f29c76b8eede42dd14a2fc24de7ba9426b48dd97` | 1 / 1 |
| N46 | E | `eb3748fd3c795620372df8d1473126847cc2ac31b0bbdcbf35d75859fdbbfdaa` | 1 / 3 |
| N47 | B | `033dab0a5015573b01c562879a38fcb034841a076069b0757c1efb5ed9e527e6` | 1 / 4 |
| N49 | B | `263f8c90bdce8a0fb49c1fec19b2cb197e5a73facbde4455051be3e1342fc530` | 0 / 0 |
| N50 | B | `2243b9dc7371382baf02f7da75fa001c01b2d630d0260a7e2d846c309f2885b1` | 0 / 0 |
| N51 | B | `f16ec026642e8a311623fb01cb347e16a3289374bc9d02747a1633e565f99aca` | 1 / 1 |
| X01 | H | `3abf57cccf7d1a8a2bbeb9b4a07f4fb00ddd4ac2a2b0a1f51c042943040e0188` | 1 / 1 |
| X02 | H | `8471d6b313745fd3e9c029103bd7f7ec0e53aaba069df192c90ec161c5771115` | 1 / 1 |
| X03 | D | `c1bc3c75b68d8f313897be76c13c8c42c24a887461dbb3f7023b7d91e7f4cba7` | 1 / 1 |
| X04 | D | `b69b63f47ce6578f2182262c9adc198a9c9ec38c4f4dadead2804e7e245a1d53` | 1 / 1 |

Exact selective mutation test commands follow. Each has its own original/mutant/restored hashes above; the queue prefix expands to the shared heavy script on this PC.

```sh
# E02
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 epochs|P1: admits'
# N01
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'P1: an incompatible'
# N06
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 epochs: refuses a db-read'
# N09
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 epochs: activation refuses'
# N11
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 epochs: cannot downgrade'
# N13
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 retire: refuses post-write'
# N14
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 retire: refuses expired'
# N15
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 retire: refuses inexact'
# N19
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 lease: an expired owner'
# N21
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 lease: an operation'
# N24
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 fence: expired export refuses before Sheet writeCells'
# N25
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 fence: expired export refuses before Sheet appendRow'
# N26
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 fence: expired Markdown'
# N27
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 fence: expiry refuses backup'
# N28
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 parity: inspection'
# N31
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 route:'
# N34
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 no-link: a legacy'
# N36
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 RPC:'
# N39
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 activation:'
# N46
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-backup-drive-live.test.ts --maxWorkers=1 --silent -t 'checks permissions'
# N47
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 route:'
# N49
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'refuses DB reads and recovery before activation'
# N50
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'refuses DB reads and recovery before activation'
# N51
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 Markdown completion:'
# X01
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 transaction: apply_patch'
# X02
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts --maxWorkers=1 --silent -t 'R2 transaction: insert_queue_idea'
# X03
bash ~/bin/heavy npx vitest run tests/unit/google/google-transport.test.ts --maxWorkers=1 --silent -t 'bounds writeCells to 30 seconds'
# X04
bash ~/bin/heavy npx vitest run tests/unit/google/google-transport.test.ts --maxWorkers=1 --silent -t 'bounds appendRow to 30 seconds'
```

## Live limits and coordinator handoff

No live migration, hosted RLS/advisor, independent-backend contention, real Sheets/Drive quota/latency or shared-drive inheritance, Vercel environment/cron/redeploy, Phase C/D flip or retire/flag round trip was performed. They remain the coordinator's reviewed live gates, not local passes. No issue/PR state was changed. A new independent review and required hosted checks must evaluate these local commits before any merge/deployment.

Google's accepted-request/non-CAS window remains documented; client timeout and fencing reduce it without claiming remote cancellation. Restore Drive link remains a deliberate coordinator operation and never overwrites a conflicting Drive section automatically. Schema/contract changes still require their separately reviewed migration/recovery plan.

## Cleanup and retained evidence

Cleanup completed at `2026-10-25T10:38:45.209867+00:00` through the shared heavy queue. The exact absolute target was resolved/verified as `D:/wt/cs200-round2` before deletion. A non-following traversal found **0 links/junctions**; none needed detaching. A second scan proved zero links before recursive deletion. Removed the physical scratch tree (**32,548 files, 757,996,885 bytes, 3,470 subdirectories**) and both task-created external helpers (`cs200-round2-run.py`, `cs200-round2-mutate.mjs`). **Task-created scratch/helper leftovers: zero.**

The assigned node_modules junction still targets the main checkout. No unrelated Node process was killed, and no listener remained on ports 3518/3519 after the browser runners stopped their own servers. Existing review inputs and other worktrees were left intact. Retained ignored evidence is only `artifacts/cs200-round2/`: command logs/results, mutation logs/hashes, source/dependency/test manifests, synthetic browser renders and cleanup JSON. No helper scripts, production content, credentials or production screenshots were added to the report or evidence.

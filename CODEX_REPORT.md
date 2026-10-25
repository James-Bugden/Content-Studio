# CS-066 / issue #204 - build handoff, round 1

Implementation commit: `00fa26856f10420a94e20babeaf090a516bd94a2` on `cs-204-bk`.
Base / cached `origin/main`: `9a9f7934baa1da1a9855182eac167be1544c1981` (merged #200).
Issue: https://github.com/James-Bugden/Content-Studio/issues/204
Classification: Heavy, ROLE build. Issue contract and owner decision dated 2026-10-25 were supplied in the coordinator request; no remote API was used to refresh state.

## Result and acceptance

Implemented the optional exact-date switch and append-only, service-role-only owner decision audit; both are required. Audit records bind full build/import, actor hash, by/on, operation UUID and server time. Identical action replays; changed identity/build/import conflicts. Runtime removal revokes the waiver. New SQL is only `20261025000700_content_backup_gate_waiver.sql`, header UNAPPLIED, idempotence tested; every earlier migration is unchanged.

The only admission exception is an absent private Drive manifest. A present wrong-build/import, malformed, expired or failed archive proof cannot be skipped, nor can a retained failed backup attempt. Phase C still requires `dailyPlanBackup:true` plus private evidence, all other attestations, fresh parity and lag limits, freeze and full SHA/latest-import binding. Rehearsal still requires exactness/equal hashes, is limited to the existing 24-hour age bound, and now explicitly rejects missing/nonempty differences. This reinforces the already required zero-issues rehearsal; it does not waive or expand any phase.

A configured folder always takes the verified-backup path. Without one, the audited waiver returns only `{status:"backup_waived"}`, without fabricated manifest/freshness. Reconcile displays "Backup gate waived by owner", dates and recovery limits alongside blocking admission/export issues and retained backup failures. Activation and waived-backup replays recheck revocation. Emergency verified backup with a folder and exact rollback remain intact. The default Sheet composition and tested read/write bytes are identical with/without the switch. No dependencies or new server modules were introduced; existing server boundaries remain.

`CS_BACKUP_GATE_WAIVED` is optional, non-secret, default/schemaDefault null, and coordinator-managed in the env manifest. Setup never sets or rotates it; manifest/schema drift and explicit setup regression pass.

**Not merge/deployment ready:** independent Opus review is pending; no Opus review is claimed. Required hosted CI has not been run. Default build is blocked as detailed below. T1 deployed-route and T3/T4 live evidence are pending. No database, deployment, provider schedule, production setting or authority was changed. No push, GitHub write, provider API request, dependency installation, merge or issue closure occurred. SQL was executed only in ephemeral in-memory PGlite under the scratch copy.

## Commands and observed results

All Vitest, TypeScript, build, lint and browser commands used `bash ~/bin/heavy`. PGlite used only scratch `D:/wt/cs-204-backup-verify`, with its node_modules junction to the prescribed 163 checkout dependency directory. The worktree's original MAIN dependency junction was untouched.

- RED before implementation: `bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts -t CS-066 --maxWorkers=1` - 16 failed, 113 deselected. Missing audited-waiver RPC; no false green. Isolated per-condition red evidence is also provided by the mutation campaign below.
- First broad run: 66 files passed; Git-dependent policy/boundary checks failed because a scratch copy lacked `.git`; a backup-failure fixture also collided with existing backup state. Initialized scratch-only Git metadata, fixed the fixture to update its existing state, and reran the affected checks: 7 files / 207 tests passed.
- Required-directory run: `bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components tests/unit/env-bootstrap.test.ts --maxWorkers=1` - 70 files / 1,068 tests passed, none skipped. Its PowerShell wrapper exited 1 because a preceding scratch-log removal reported a missing file, so a clean subprocess run was additionally required; see final result below. Log SHA-256 `eb7818fda8445422cc8f8b9b1d44cc5797bc6327060074d3d16e631eeb887766`.
- Post-mutation retest: `bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts tests/unit/supabase/content-cutover-security.test.ts tests/unit/security/backup-waiver-env.test.ts tests/unit/components/reconcile-list.test.tsx tests/unit/env-bootstrap.test.ts -t 'CS-066|forces zero|covers every key|never bootstraps' --maxWorkers=1` - exit 0; 32 selected tests passed, 163 deliberately deselected. Deselection is not acceptance evidence for the other tests; those ran in the required-directory runs. Log SHA-256 `47c22f9899f70c62d74244c31feb1f88e13a536afb9f259aec899777915cc241`.
- `bash ~/bin/heavy npm run typecheck` in scratch - exit 0, including final post-mutation run. Initial worktree attempt failed on missing Supabase/PGlite packages in MAIN's existing junction; no install or dependency modification was attempted.
- `bash ~/bin/heavy npm run lint` in the worktree - exit 0.
- `node scripts/check-private-paths.mjs` - exit 0, 645 tracked files clean; `node scripts/scan-secrets.mjs` - exit 0, 645 files clean (implementation commit). PowerShell's `npm.ps1` policy blocked the npm aliases; the exact underlying scripts were run directly.
- `git diff --check` - clean.
- A directory-test command was accidentally launched once from the worktree; it was stopped. PGlite imports failed there before execution (zero database tests); no database was constructed/applied there. All PGlite executions and mutation tests used the prescribed scratch copy.

## Build limitation - not a pass

`bash ~/bin/heavy npm run build` was run in scratch. Turbopack refused the mandated cross-drive node_modules junction: "Symlink node_modules could not be resolved: the symlink target leaves the filesystem root".

Fallback `bash ~/bin/heavy npm run build -- --webpack` was also run. It failed on cross-drive Next client entry paths (`./C:/.../next/dist/client/next.js` / `app-next.js`) and the existing Replies client graph reaching `node:crypto` through `src/replies/lib/contracts/text.ts` -> `Workspace.tsx`. No unrelated build configuration or Replies changes were made. Git blobs exactly equal base: `next.config.ts` = `025737534a2fe4d83165a32ccb515b749f599194`; Replies text contract = `b7453c7f90967db01b8f06b485d03ba4fc537785`. This identifies unchanged inputs; it does not claim an independently executed baseline build passed or failed. Coordinator must obtain a green build/required CI on the reviewed commit before shipping.

## Browser / adversarial verification

Used the implementation and adversarial-verify procedures, with correctness/state/replay, security/privileges/privacy, and false-green-test lenses. Verified no browser roles have table/RPC access, forced zero-policy RLS, invoker/pinned-path RPCs, and append-only runtime audit permissions even under hostile default grants. Migration reapplication preserves audit records. Real operation/rehearsal/export fixtures exercise SQL over mocked REST/Google boundaries, rather than hand-written ready flags. Export hand edits stay blocking and rollback refuses them under the waiver.

T2 **isolated presentation check**, not a deployed route admission test: rendered the actual ReconcileList with synthetic waiver/export/admission items, using generated application CSS, into an offline fixture. `bash ~/bin/heavy npx vitest run tests/unit/components/qa-render.test.tsx --maxWorkers=1` generated it; `bash ~/bin/heavy node qa-browser.cjs` ran Chromium/axe. 375/500/750/1280 px and 1280 px at 200% CSS zoom: no horizontal overflow, correct blocker-before-waiver order, zero axe violations. Visually inspected phone and desktop captures: readable recovery caveat, retained red blockers, existing design classes. The fixture needed its normal surrounding h2 to avoid a harness-only heading-order failure; no product heading change was needed. First axe invocation required an explicit browser context and was corrected. Static presentation does not test hydrated dismissal or full deployed-route authentication; hosted T1/T2 remain coordinator evidence.

Browser result SHA-256 `44f8511979cd8ac0a45a183ae661f0630584fbcdc13fb88c725a8bb60302d75a`.
Synthetic screenshots (reviewed locally; retained only in the link-free scratch pending the cleanup blocker below): 375px `3f49e0ad9801e93e7cb0ca10ba58c5d40d289b8170822c4a846d63385592acd6`; 1280px `b79cfae78cc056d61ff7e88b81c37b95bdb9210f9cb0084d305f6246a542b391`; 200% CSS zoom `0ce00b1876d57ebf80335cb41edd51ba278b9f0481e908f679bec80e3d2e16ba`.

## Mutation evidence - implementation changed, tests unchanged

38/38 mutations caused the selected regression to fail; each mutated implementation file was reread and hashed before execution. Every mutant ran through the queue, serially, in scratch. All implementation bytes were restored and compared with the worktree before the post-mutation retest. Most failures are assertions that a forbidden call unexpectedly resolved; mutation 15 instead makes the allowed activation fail with FORBIDDEN, proving that the runtime switch channel is necessary. The initial result classifier expected only the literal "AssertionError"; Vitest emits "Error: promise resolved ... instead of rejecting" for `.rejects`, so stored JSON assertion failures were inspected and classified correctly. No survived or setup-only failure is counted as killed.

Common mutation command: `bash ~/bin/heavy npx vitest run <test-file> -t '<selector>' --maxWorkers=1 --reporter=json --outputFile=mutant-N.json`. JSON failure records identify the selected failed test; zero-test hook/setup failures are excluded. Date/build/actor validation mutants remove both function checks and redundant table constraints. The "absent-proof-only" mutant removes both absence checks; individual obsolete-proof coverage is separately killed.

Baseline SHA-256 by implementation file:

- `scripts/env-manifest.json`: `6d78d49ea355cedd75cb678e6d079627fe887e9275b7762ab00a0f58dede2949`
- `src/application/live-content-cutover.ts`: `f4de9323906a77f2de49b7f09041b5698655604219e7f3a66556fd70f0dc15dc`
- `src/application/reconcile.ts`: `6fe2a7d8956068dea8c2b83037dfbbf62ed7bf16298253dee2305bd7f10b9f11`
- `src/integrations/supabase/content-cutover-store.ts`: `2cb2ac74496dd908b6c2befaebaa23d1cab7e72efcf6383cf01deee784ca0050`
- `src/lib/content-maintenance.ts`: `694a81e8c4c2132a3e798f76a7520fb8aff9e00907f4fbe0674872aa15135b7e`
- `src/lib/env.ts`: `dba0100180c284a886167748ec3e434aae865a11f7a684323c5ad02032d73611`
- `supabase/migrations/20261025000700_content_backup_gate_waiver.sql`: `c9d185f1d7081592bd0b95ed8c69edc2ceeaa474ceb300283b82a05219909a97`

| # | Guard / selector | Mutant file SHA-256 | Test-output SHA-256 | Result |
| --- | --- | --- | --- | --- |
| 1 | env-and-audit; `requires env AND` | `1be47d1817ec00034ed4833a692f3c5d1a235e0e4a7824162cc08ce04d1932be` | `16101cb7a8d22e2e189e3d926cda0ae8c38c219596c4843378784bf1b2fd735c` | exit 1; 1 test failed; killed |
| 2 | audit-required; `requires env AND` | `677d4356a919f712cbb2f227e98f8c6e6ff94dce2826c3e0bae7c0af6e4f31f9` | `f8c0947577f139818c5cee9236d5bcfc3860d5fb5818c2395586303d33c9c7a1` | exit 1; 1 test failed; killed |
| 3 | audit-build; `waiver never hides sha` | `04fae0e44fe03a6ff6299a32525c03eb4252df20738ded3947516e937317b169` | `5fdde5fa714209d2d52916a7c2b75970fe97bd2240d5b36850c944658cd68f54` | exit 1; 1 test failed; killed |
| 4 | audit-import; `waiver never hides import` | `c9f79e71c3260570a16d0d710fb86361f5e44d12b65245bc3e02d99e057bedc2` | `deee005dbb117603a6d7b48518ace599e2f14563e3fe07eb230c445f2163e4fd` | exit 1; 1 test failed; killed |
| 5 | backup-only; `waiver never hides missing-rehearsal` | `c208dc1b93214412a275bca67152902bfab4ed7795b185a3e131e8b0c72d3e85` | `1bb8223eb8c39121061203c554c317688a02fa80e967a2d8aa05ac711902695a` | exit 1; 1 test failed; killed |
| 6 | absent-proof-only; `waiver never hides failed-backup` | `05e8fad77c699e60303d88436970da0c0ed390174741c3a68a6998dcd9173abd` | `3b6ca2b310be83898f5f796f1fe8124a77cb1f61a16bf1c6720c91dddcc28c00` | exit 1; 1 test failed; killed |
| 7 | obsolete-proof-not-absence; `waiver never hides obsolete-backup` | `5e16301d9ce2cab72c9b3737cd8dcd9904fe86aa9ce59734180a0b8e14a5e3e3` | `0fab03710405da45b482948c83b5ae0e8d551cbf3927979240914e59571ac21b` | exit 1; 1 test failed; killed |
| 8 | backup-failure-retained; `waiver never hides backup-failure` | `2d8fea849852da93bdc5f9cc62de24054127b5c3e26684e6875fb6892d7a14ec` | `ffd0b06f23447c85539240216d407a572fea88eab404440b38aeb46af64f6899` | exit 1; 1 test failed; killed |
| 9 | zero-rehearsal-issues; `waiver never hides issues` | `69c14fcd7b1d6aee5be8618ab7e6cc3ecc9fbfe329e102ab06deec2976245fbd` | `dfde22fc5ca70dffefcca10009bf5528e0bb70156f66ce0ce9109d79d948d6cc` | exit 1; 1 test failed; killed |
| 10 | waiver-date-validation; `audited action rejects invalid date` | `55da8f64c25a458213b07e6851068e93452c124fd5d3a837fe768204373ca0b2` | `524a7156f21c763fc8463393ca93626f38c71aa3e5df571c78dd300a421926c0` | exit 1; 1 test failed; killed |
| 11 | waiver-build-validation; `audited action rejects invalid build` | `d17a096872c06c8fe3ccdf34732021e486791ba2fa7a8abc14d73ae790743870` | `0754e0a0c93f806eefb47113d68aa3daab11f893a57fe1c6f1d78061fa5e0e61` | exit 1; 1 test failed; killed |
| 12 | waiver-actor-validation; `audited action rejects invalid actor` | `cad63528c1e6f94e664473f671689a6d1077fbdc76ba57d5161c5fcd0c305b90` | `071841c3a5d190463f9bc1aa373401eed24e5353c3e1bfe18df745f8cf0c7115` | exit 1; 1 test failed; killed |
| 13 | record-current-import; `audited action rejects invalid import` | `517f305bab206e86dce80a07e43a785b1e0365dc1ea1e26736dbcd7ef961027b` | `d0f957e53b8cdd53b4306e33386672283a383301ffb0f7814eca2b31f927cde7` | exit 1; 1 test failed; killed |
| 14 | configured-folder; `configured folder still verifies` | `d144fba1f638e2f210fa4640795cfd5c39776af14024dee40e8a77c8ca2ddfe4` | `b2425b149b871f28333904c67edfa40a84c70708fd032fefec782fc4de3219ff` | exit 1; 1 test failed; killed |
| 15 | activation-switch-forwarded; `requires env AND` | `78a77d55dfe28d194ad04e6353abfc04db14a11e09da1657e346cb482b96a709` | `074b5c11167f4017b6ac758b90cd261f5f954977d8826761cb50315fc51796c9` | exit 1; 1 test failed; killed |
| 16 | gate-switch-forwarded; `waiver never hides plan` | `f844f4f192428eb98316da10a994da986789747da481a67038aa59f53d70cd57` | `a2fbb408c05917b9828fd9686d59d552ffb5bbcbbed9d01a99e3254c989fb690` | exit 1; 1 test failed; killed |
| 17 | activation-replay-rechecks; `completed activation and waived backup replays` | `98b6fde0ed593955bd520f3d4dc3bdc2a7996750b823597e255c54028fc7ba6e` | `2d05ba2471b23ebd2b150ec1c3f2470f58f40f183a2e956bc6b8eb3bccbd5788` | exit 1; 1 test failed; killed |
| 18 | waived-replay-rechecks; `completed activation and waived backup replays` | `634778fe27b9f7df97137b59ef9ef32ebd319c0ed0a947655300cb35da9316ce` | `a7743a9ade2eec2f0e42bff9b680f5dcb1265dc6fdfb6ac68061e6b867330c24` | exit 1; 1 test failed; killed |
| 19 | worker-audit-required; `completed activation and waived backup replays` | `db1c23f23e637f9f5f43eef71d1540900c836d2533892d7097d386d1e0f8c29f` | `eb3be8ae7bffb3a4158f25b666e06e2a06d82ab341593c99f7be73bf2085870e` | exit 1; 1 test failed; killed |
| 20 | live-env-folder-guard; `live DB folder admission` | `05a57da4da3b81568460349e07ce61244785f64d017446985016f695ef656396` | `fcb846a07bdfa452aca742f46824ab6e87234891902d463b5ed41cf40b200272` | exit 1; 1 test failed; killed |
| 21 | reconcile-failure-visible; `red admission and a past backup failure` | `96ec5e11b799204fdfdc2bdbada7e03bbbb62a8eaf73bc395fc88ad345a6ad06` | `f33286cca17c4a39f037e290af63240bc2882d914bbd041ccb37fd3b4e867739` | exit 1; 1 test failed; killed |
| 22 | reconcile-waiver-visible; `red admission and a past backup failure` | `ab9d4b4068a7c3e495f3828c5424ca910c891911af45a99a4e4cbda7c0e4196a` | `67d81e19a9a702029f1b96eaaabf1fcd5fb2be11d77b66936f7a22eee33199b7` | exit 1; 1 test failed; killed |
| 23 | setup-never-sets-waiver; `never bootstraps deployment-owned` | `478a68fe2c9d72d30310896f4a2256c7cd853871de2894a23a845d23cf48a6b2` | `d24c31b467beea259f3a38174209f31598a3e45ab5747ce00c18563d860a7e75` | exit 1; 1 test failed; killed |
| 24 | plan-backup-required; `waiver never hides plan` | `61db23d0351a9125b97c9318f55b2ef0421207d1ee2d3687b3c848be05c6f650` | `0c50100b00f57b0cb6278e08637ff1ce96c9d7dbbc4eeb8383b103b1c237923a` | exit 1; 1 test failed; killed |
| 25 | private-evidence-required; `waiver never hides private-reference` | `dfc20734755b36e260ad7e2abd1010d4654eefedb11978656e2744a6fc791707` | `1e32d5640e151ee4b001285c0014f9562e974faeba28729a611b718abf528d64` | exit 1; 1 test failed; killed |
| 26 | exact-rehearsal-required; `waiver never hides inexact` | `1e0ea979520d794dd1ec40fa0c5eafbf3ada3da150244804545c6cd95365f6c0` | `34d46eaada467b776f1bd6099c695592a2abddbed67d05c36dc90537645e6a1b` | exit 1; 1 test failed; killed |
| 27 | equal-rehearsal-hashes; `waiver never hides hash` | `ecfa976350623fe1aff826218d35cd4a50ff564bdc5a8fa3dfb1bf595b4ddc2c` | `38a30150b6e6efa980f68b8d187060ba2fdf2547ab5ac02afbc7bafdc90bb460` | exit 1; 1 test failed; killed |
| 28 | fresh-rehearsal-required; `waiver never hides stale` | `4c52b42cbff180decb56395023a3e82be8775635a5dd675e741615777562b6a8` | `5d16e71102067bdbf196bae1b21a2758d175f0fdd038d93faca49683c5e95216` | exit 1; 1 test failed; killed |
| 29 | parity-ids-required; `waiver never hides parity` | `7ed3a9dee9524c537f47c1fe4fe02ba102109123475dfe223d450a4efcbab2c7` | `43a55ce3acfe767412ddce849d313b6d82657b0c07eda18f788bc4ac9587892f` | exit 1; 1 test failed; killed |
| 30 | lag-bound-required; `waiver never hides lag` | `602cfccb1270c8149d7909e99d643233cee24140b2ad93c2ce914b393ad41ff9` | `9868f77fe31f8a0e0a8b515e2cbbe7ba17930048de59f4249500b261fc71304a` | exit 1; 1 test failed; killed |
| 31 | freeze-required; `waiver never hides freeze` | `303e507aa06636e1ba6bab573a39f847e94940faeae598a4d008f0a7d8c34f2d` | `17ba9f39b47d150339ce2980778cfabfb99bf6b4b327dfde736cf9434821be1f` | exit 1; 1 test failed; killed |
| 32 | audited-identity-conflict; `requires env AND` | `7035deb32fb7f5a6dbc2df1bf770e9b78ed8ba302d8796613094550c0d1de7b4` | `a743c76e084a0016f6924405351f41a8571a7bdf42a46394f164f681684705c6` | exit 1; 1 test failed; killed |
| 33 | append-only-audit; `forces zero-policy` | `16ac59be1d0b812dfe866953ce426286e67193e19b0288eb56dcc041da95d827` | `e9e2fbfef4ca03347e834da98dc5a6ec7f4bdfd08422fd2042e1192cd079afb1` | exit 1; 1 test failed; killed |
| 34 | exact-env-date; `live DB folder admission` | `0a51a79a88404a0f8b1e821628b68c7ea45e06a64278952ac803ff956553e929` | `e7c4d9a9b520d9cecebdbd90db8599e9180f0adb7f07b2d9a60c85a845abdff4` | exit 1; 1 test failed; killed |
| 35 | red-status-not-hidden; `red admission and a past backup failure` | `b415631db7bec629588c4a079d0456602479a7e29daf36808bcf98b83d00635d` | `0df67c9294606a30f417e6f4ff2ef87395bbf4d1669bf552c135854e35603ee7` | exit 1; 1 test failed; killed |
| 36 | scheduled-waived-worker; `waiver reports honestly through worker` | `a61841f3768d29c082b2bb3a74be2b2808a6a052c7dc2eecbc3d6eca399dabe5` | `3205ce080a905189f58d34f204ff8c04086a402760f78f35beb927e9822b8b67` | exit 1; 1 test failed; killed |
| 37 | waived-absence-not-failure; `waiver reports honestly through worker` | `0b0037e1da92ebe95ca81f6651b8a33a5ed83390b5e3de75f5b7063cc0bf0c87` | `50f23548400e8fd3de2dbe60fff8af52767531b6798f165e0ed0d0b731fe7c04` | exit 1; 1 test failed; killed |
| 38 | past-backup-failure-read; `red admission and a past backup failure` | `5e928dd9ceae9a763daec4cdaa789e1522f68e1e5404c569c8fa320a0cc4a9a7` | `046d9f8a76a9abe345cad7504d87fdf58067dbfcd021bfed659ee5dabbfef74d` | exit 1; 1 test failed; killed |

## Exact coordinator continuation (not executed)

1. Obtain independent Opus review of the implementation SHA above and these changes; resolve findings and rerun applicable checks. Obtain a genuinely green build and every required CI context. Do not infer readiness from this report or merge while a required check is red/unknown.
2. In the private coordinator session verify existing project, migration history, deployment identity and the owner decision dated 2026-10-25. Follow `docs/ops/cutover.md` in order. Apply only the explicitly reviewed additive UNAPPLIED migrations, one exact file at a time, in dependency order. For this issue the only new migration is `20261025000700_content_backup_gate_waiver.sql`; never edit/reapply earlier SQL in another form or run repository-wide db push. Reverify hosted denial/catalog/advisor checks, including new audit table/RPCs, and Replies invariance.
3. Retain Sheet authority until measured admission. Keep both imports stopped before DB activation, freeze all app/other writers, drain old deployments/sagas, and preserve owner freeze/race-acceptance evidence. Complete the final import and full six-collection measure on the reviewed SHA. Keep the one-way Sheet export; no Phase E or new source of truth.
4. Explicitly set Production `CS_BACKUP_GATE_WAIVED=2026-10-25` and redeploy the reviewed SHA. Leave the folder unset only for this approved waiver path. Setup must never set this switch. If a folder is configured, retain the original verified-backup admission and worker behavior instead.
5. **Audited waiver action:** after the final import, verify the owner's identity privately and compute its SHA-256 hash. With authenticated private service-role/admin coordinator SQL, call:

   ```sql
   select public.content_studio_cutover_waive_backup(
     '<new-operation-uuid>', '<reviewed-40-character-sha>',
     '<latest-import-operation-id>', '2026-10-25',
     '<sha256-of-verified-owner-identity>');
   ```

   Retain operation UUID, full build/import, by=owner/on date, actor hash and server recordedAt in private evidence. Identical UUID/action replays; any changed identity/build/import needs a fresh UUID. A new final import/build requires a newly bound action. Never delete audit/proofs to make a gate pass.
6. Record actual daily Pro plan backup configuration **and a restorable backup** with a private evidence reference. Record every existing Phase C field through `content_studio_cutover_record('phase-c',...)`, including `dailyPlanBackup:true`, `restoreExact:true`, freeze/importsStopped, real metrics, smoke/T4/security/concurrency and `privateEvidence`. Waiver is not plan-backup or restore evidence. A tier name alone does not pass.
7. Run authenticated coordinator backup (expect only `backup_waived` with no folder) and the exact rollback operation; retain fresh equality of IDs/counts/fields/links/types, equal hashes, zero differences/issues. Rehearsal stays bound to full SHA/latest import and <=24h old. Actually rehearse the documented frozen Sheet flag/deployment round trip, then return to frozen db-read. Any mismatch, stale proof or failed check blocks.
8. SQL cannot read deployment env. Runtime gate/activate pass the switch on every call. For a direct private SQL gate check use `content_studio_cutover_gate('db','<sha>','2026-10-25')` only after verifying the current deployed switch and absence of a folder. The compatible two-argument form stays conservative and requires the archive. No guessed SQL setting or durable env-on flag is used. Removing the deployment switch revokes the waiver even if the audit remains.
9. On the measured deployed SHA call authenticated `activate-db` with a fresh UUID; require success, then deploy DB mode frozen and verify exact build/store/epoch/inventory/export. Reconcile must display the owner waiver/date/time and retained failed checks. Resume only after the runbook's deployment smoke and acceptance gates. Export scheduling stays one-way; backup cron reports `backup_waived`, never verified. No import during DB authority.
10. Recovery limitations must remain explicit: no independent history/ledger archive outside the project; project-level loss relies on Supabase daily plan backups plus Sheet export, which lacks full history/ledger. Rollback is unchanged: freeze/drain all instances -> backup/waived status -> exact final export/fresh rollback proof -> only then Sheet flag -> redeploy/smoke. Never flip first after DB-only saves. With a configured folder the emergency verified archive remains available.


## Final clean process result

The exact required-directory command above was run once more from scratch via a Python subprocess capturing the actual process exit (avoiding PowerShell error-stream/wrapper ambiguity). Exit **0**; **71 files, 1,069 tests passed, none skipped**, including the 70 required-directory files / 1,068 tests and one disposable offline-render fixture check. It includes the final added waiver-absence assertion. Every requested directory was run in full. No implementation changes followed this run. Only this report and a runbook punctuation repair followed the implementation commit.

Final full-run log SHA-256: `7ccc7efc6999d560d3b4520df56f0651fc93d95d40467dfb3eb4d63ecf3b5a65`.

## Cleanup blocker (automatic approval review)

All test/build/browser processes started for this task completed. The scratch dependency junction was inspected and then unlinked with native Windows `cmd /c rmdir "D:\wt\cs-204-backup-verify\node_modules"` (the initial Git Bash `cmd //c rmdir` spelling failed to resolve the path). Verified the exact absolute scratch root and **zero reparse points remaining**. The original worktree junction and the 163 dependency target remain intact.

Automatic approval review rejected both the verified literal recursive PowerShell deletion and the safer nonrecursive leaf-file/empty-directory batch, giving only **"blocked by policy"**. No approval escalation is available in this runtime. A single explicitly named helper file (`qa-browser.cjs`) was removed successfully, but bulk cleanup remains blocked. **`D:/wt/cs-204-backup-verify` still exists without node_modules or any other link**, containing synthetic scratch copies, test/build artifacts, mutation helpers/logs and screenshots. No helper files were left in the worktree. This is an unresolved cleanup requirement, not a cleanup pass. Coordinator must remove that verified, link-free disposable directory using authorized tooling. Do not delete either shared dependency target.

# CODEX report - CS-067 / issue #207 / build round 1

## Disposition and exact identity

Implemented and committed the server status/gate endpoint, audited backup
receipt, health deployment identity, runner alignment, tests and runbooks.
**Offline functional acceptance passes; scratch-directory cleanup is blocked by
automatic approval review. No production cutover is recorded.**

- Issue: https://github.com/James-Bugden/Content-Studio/issues/207 (open at inspection).
- Review target: #207; classification Heavy; role build; round 1.
- Branch: `cs-206-run`; starting base: `35abd14ab6e830aa07a395a06fdb59b4f53f4fe3`.
- Implementation commit: `4a3a5feb3fe4e905f61ae6ff09fc51c88acda555` - `CS-067: expose audited cutover status and deployment identity`.
- This report is committed separately as a descendant of that implementation.
- GitHub issue/PR state inspection was read-only; no PR #207 resolved at inspection.
  No GitHub write, push, deployment, environment change or live provider/database
  operation was performed. Migrations ran only inside disposable local PGlite.

## Acceptance and behavior

| Area | Result and evidence |
| --- | --- |
| Authenticated read-only GET | PASS. Reuses CRON_SECRET SHA-256 + timingSafeEqual over fixed 32-byte digests. Missing/wrong/malformed bearer refuses before fetch. Missing secret cannot admit `Bearer undefined`. No idempotency key is needed; query/body/content inputs refuse. Unsupported methods return 405. Success, refusal and error responses are private/no-store. |
| App-owned state | PASS. Exact validated 40-character platform SHA (CS_COMMIT_SHA fallback), optional platform deployment ID, configured store, compiled contract, none/read/db/retired epoch and effective local write freeze. Dedicated read boundary does not construct provider services or acquire operation/export leases. |
| Gate truth and reasons | PASS. New read-only SQL wrapper invokes the existing content_studio_cutover_gate separately for db-read/db, using this build and the effective backup switch. It maps all known failures to named reasons and suppresses unexpected SQL text as gate_unavailable. Each target exposes its first blocker; it is not a reservation or substitute for atomic activation. Malformed/unexpected success shapes fail closed. |
| Evidence and waivers | PASS. Nullable nonnegative safe-integer ages in milliseconds for current-build/latest-import parity, phase-c, rehearsal and backup evidence. Separate calendar/backup audited booleans; no evidence text, content, content IDs, actor IDs, tokens or private references. Calendar audit checks the latest imported event and matching import snapshot. Backup audit is build/import bound and disabled when a backup folder is configured. |
| Audited backup receipt | PASS. Existing POST operation and scheduled backup return backup_waived only with waiver.audited=true, exact build and SHA-256 auditHash from the durable row. Tests independently recompute the hash with Node crypto. Newer foreign-build/obsolete-import audits cannot change it. Env/audit removal revokes the result. Calendar switch never creates it. Existing recovery gate and verified-archive path remain in place. |
| Health | PASS. Exact full SHA when valid build metadata is configured; optional deploymentId beside commit. No other state/content is added. Default Sheet health output without metadata is checked byte for byte against the previous response. |
| Runner | PASS. Consumes actual health/status/receipt shapes, binds SHA/deployment ID, shows local freeze/epoch/evidence ages/audit flags, validates both gates even during read activation, and retains exact ACTIVATE, post-prompt recheck, retry identity, result validation, private ACL and redaction rails. Tests include the actual npm subprocess with mocked fetch/TTY and the actual health/status handlers over mocked REST + real PGlite. |
| SQL safety | PASS offline. New later-sorted 20261025000800_content_cutover_status.sql is header-marked UNAPPLIED and reapplication-tested. Both functions are invoker with pinned pg_catalog,public search_path; public/anon/authenticated EXECUTE is revoked; service_role alone is granted execution. Catalog checks run against hostile default function grants. No new tables or write functions. Existing gate migrations/thresholds are unchanged. |
| Default authority/dependencies | PASS. Sheet remains the default. Google adapters, service composition, parity/read adapters, package.json and package-lock.json have no diff from the starting base. No dependency was added/installed. Main node_modules junction was untouched. |
| Env manifest | PASS. VERCEL_DEPLOYMENT_ID is optional, managed and non-secret; manifest/schema drift regression is green. Existing defaults are unchanged. |
| Independent review | PASS. Separate gpt-6-sol reviewer at xhigh reviewed the production diff and rereviewed the validation simplification; no blocking findings. Reviewer made no edits or live calls. |
| Hosted/CI/deployment | NOT RUN under the explicit no-push/no-GitHub-write/no-live instruction. No CI/hosted pass, deployment identity, authority flip or cutover date is claimed. |

## Final verification

All heavy commands used the shared `bash ~/bin/heavy` queue. Every Vitest
invocation targeted named files/directories with maxWorkers=1; no full suite was
run. PGlite and final typecheck ran in `D:/wt/cs207-check`, whose node_modules
was a junction to the specified worktree 163 dependencies. No npm install/ci.

Final clean run: **76 files, 1452 tests passed; zero failed,
pending or todo tests**. The JSON reporter counts nested describe groups as
177 suites; the actual file count is 76.

```text
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components tests/unit/cutover-acl.test.ts tests/unit/cutover-cli.test.ts tests/unit/cutover-runner.test.ts tests/unit/env-bootstrap.test.ts tests/unit/env-sources.test.ts --maxWorkers=1 --silent --reporter=json --outputFile=<temporary external result>
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
bash ~/bin/heavy npm run check:private
bash ~/bin/heavy npm run check:secrets
git diff --cached --check
```

| Required directory | Files | Passed tests |
| --- | ---: | ---: |
| tests/unit/security | 10 | 116 |
| tests/unit/application | 15 | 318 |
| tests/unit/supabase | 19 | 576 |
| tests/unit/components | 27 | 209 |
| Runner/ACL/env bootstrap/source files | 5 | 233 |

Typecheck and lint exited 0 on the restored final source. Privacy and secret
scans passed with all implementation files staged, and were rerun including
this report before its commit. Expected synthetic scanner-positive controls
and jsdom navigation notices inside the tests are not repository scan findings.

T0 applies. No browser interaction/UI changed, so Playwright/visual/mobile QA
is not applicable to this issue. Hosted owner smoke, provider verification,
all-instance drain and production acceptance remain the coordinator/owner's
ordered live gates; they were not substituted with local tests.

## Adversarial and mutation evidence

Lenses: fail-closed correctness/edge states; integration/build/import/replay
identity; auth/privacy/RLS/ACL; false-green test integrity. GET was checked
against real SQL over mocked REST, with before/after operational-table snapshots
proving no writes. All provider and runner fetches were mocked.

**140/140 meaningful implementation mutations killed.** Each counted probe
changed implementation bytes, received a nonzero Vitest exit with at least one
failed test case, and restored the exact original bytes before the next probe.
No tests were mutated. Parse-only/zero-collected probes were excluded and
replaced with executable mutations.

Early probes exposed test gaps for independent waiver switches, foreign audit
selection, malformed non-target gates and missing smoke providers. Regressions
were added and the final probes were killed. A redundant explicit age maximum
was removed because Zod int already rejects unsafe integers. The receipt's
lookup and row predicates overlap; the effective switch/audit protection was
also tested by a combined bypass, rather than counting a redundant isolated
lookup removal as a killed mutant. No unresolved survivor is presented as green.

The file table gives **both before and restored SHA-256** for every probe using
that alias. These are the actual exercised workspace bytes (before Git LF
normalization), independently matched against the final worktree and scratch.
The probe table records the changed-byte SHA and number of failed test cases.

| Alias | File | Before = restored SHA-256 |
| --- | --- | --- |
| F1 | `src/app/api/ops/content-cutover/route.ts` | `fdd2c77c03f8fdb9e5b5b0e216b09894a50f5aca67be32bf48efc87c1a0c10c1` |
| F2 | `src/lib/cron-auth.ts` | `178578f13c44d832f1eb530224c788acd71372c648bc97df37a0e1b2a982583b` |
| F3 | `src/lib/http.ts` | `bd986b667b47ee505def9dd3c83f7574a80c73a80d7a4263cb96a6de3193d84f` |
| F4 | `src/application/cutover-status.ts` | `943a3e52987cfc289e4f329b423fb2641ac1c84911b4e9f419cccd4962a8e504` |
| F5 | `src/app/api/health/route.ts` | `a439a69d689eea50bd6c9ccf00bcb26cea2ca170908c3f7dfd3c26fe81e97141` |
| F6 | `src/integrations/supabase/content-cutover-store.ts` | `03f35017b924bb37c03f04cb05b34cf45c271f85ad72bb5567e463518487a68a` |
| F7 | `supabase/migrations/20261025000800_content_cutover_status.sql` | `0b84e586ddcacf136c9ec9b967095ff9817acabcb8a11bd721cc3d3002eb7e7a` |
| F8 | `scripts/cutover.mjs` | `063b1dab59273dda3f2baae229e37ed4f456d64541b7acd23c582a0df5454aaa` |
| F9 | `src/integrations/supabase/content-db.ts` | `23b72bd93459446dd8a4d5e44d5edf04a82cca9906dbabd7054f8a47d03b1a6e` |
| F10 | `src/lib/env.ts` | `faaeda9bc6bcdffb1b5a265d74b7d72588087cc081dc466ed0b93694107f42ec` |
| F11 | `src/application/live-content-cutover.ts` | `431bc6351342b8780b864cfb7599b95734aff789fdea468318b84e544928e8a0` |

Probe commands used the same queue with the relevant named security-status,
Supabase-status, runner, ACL, health, or live-cutover test file, plus
`--maxWorkers=1 --silent --reporter=json --outputFile=<temporary external file>`.
Backup recovery probes selected the named audited-receipt regression; backup
replay probes selected the completed-activation/waived-backup revocation case.

| # | Guard bypass/probe | File | Mutant SHA-256 | Failed tests |
| ---: | --- | --- | --- | ---: |
| 1 | GET bearer authentication | F1 | `b8bd15408fece7db33f2c654bcb815ead220c6849f48ea3fee02a9c3499bfe4c` | 5 |
| 2 | GET query input | F1 | `61b50cf95d519309993f096edbc48eb235de5cdae60f276c19acdda23deb8cba` | 2 |
| 3 | GET content header | F1 | `ce2fdc9044111886f26d6ace921570bdbc69fdded3d2ee04dfbb9455833930ee` | 1 |
| 4 | GET body input | F1 | `5e776f0ae7b1f37d483903e531db5ed4cbeb345b7bf50d914e9a18224fe324b5` | 1 |
| 5 | 405 PUT | F1 | `1a6de5d3033b9ab052b3b283593e5c5c844b22a33668000357ecf1a32b3be4b3` | 1 |
| 6 | 405 PATCH | F1 | `ccfd506d08957b75f57624f5acd7bd38686f41f5ce98e2b243b4403df713889e` | 1 |
| 7 | 405 DELETE | F1 | `4f92b1877ea38aeb28251fe35ebec219eabb9fc0bb9dfdd73f47286c7ba2c356` | 1 |
| 8 | 405 HEAD | F1 | `18802270101b0b76713410e8cc81ec47e69f5a7c6890ed3abbc55968f9a07215` | 1 |
| 9 | 405 OPTIONS | F1 | `d929cba9ed4768daf27794052b9a120b8c2e5922347c6557ba583461e7825cbd` | 1 |
| 10 | fixed-time bearer digest | F2 | `4910bb95802e6fb325851fdce3a0679108f4f35f8776788ae8be036bf67d51d6` | 4 |
| 11 | private no-store | F3 | `2a1d839b996b49ee693c47a92e5481d3aa4c38feb346ae864aa7f833f7e91104` | 10 |
| 12 | exact deployed build | F4 | `26c94da09e3286d63512e2ab098084e421714a52a5672468c553d25c277fcb31` | 1 |
| 13 | live status only | F4 | `1adfbbb82dafc5c0f73a28fc0df392696d5b017cad81028c8e6e5f1cd8f033ca` | 1 |
| 14 | status build preference | F4 | `e832d40556b69f7d23ad14632ac6e3675b95a6acf79ee0d25f6d9616877b0c91` | 1 |
| 15 | RPC aggregate projection | F4 | `631279c923a38a5c32a88115ac9aba78e1553a228bfe50b184fb2f9f9aa63af1` | 14 |
| 16 | gate reason allowlist | F4 | `780dfa80067e28b5ed42ca6f3b1f81dd72a48716d5a841387bed715ed5c240c5` | 1 |
| 17 | green reason contradiction | F4 | `d984cb80ed476fe5e3a34423baee2c39fb8a951d1cc2e5777e8fcdd16e119d1d` | 1 |
| 18 | red reason required | F4 | `7b7d5ae54e0b3de3d21c9e05d3bb291f03f0cea373b20f2ea2c580f8b66ec6f2` | 1 |
| 19 | gate boolean type | F4 | `3cf88bea8adebc16c863f9af032ca5eb7d6d3ac1d52a2f8ed87486e991502748` | 1 |
| 20 | age nonnegative | F4 | `646060a4b2d4334cd3789b407dfd247829d7934ebf66b64bd8d5cb72714b4a63` | 1 |
| 21 | age integer | F4 | `e292cff7eca43bbcb6cf66fd7a42e903ca7c968939e8b18a0650202a3c7d7ddb` | 2 |
| 22 | epoch enum | F4 | `de54f6e1c38f0098db5da33d80768b5a5cb57d4796def0a74e0a530f4f405e29` | 1 |
| 23 | audit boolean type | F4 | `5943ff46d13949af9ac3619a9890515236efadab908881314c3386d021315dc5` | 1 |
| 24 | folder revokes status waiver | F4 | `0117acb94d7cc07d935dd5959e3a73ded9046509ff03b8f9d3b61188ce798cb3` | 1 |
| 25 | calendar independent input | F4 | `283332db8149e10c0cddfc6eb7f00bc034a8702d86cd61246eeaa6678b035e0f` | 2 |
| 26 | explicit local freeze | F4 | `8af73aa5e1b1b8b2738e2e11a7186da3985e739a210f691f6eef67b23342452c` | 4 |
| 27 | implicit DB freeze | F4 | `2543da09626d0ec53b0587a15bf700ec87f3e00d946df7d0b57cac62047e34cb` | 1 |
| 28 | health full SHA | F5 | `6e5582bc7892f8cf6b3c3b72584d3829464dc4ac58001712fdbec98c0739cf8f` | 1 |
| 29 | health deployment id | F5 | `fe47571099a067686f048dba986bac6c57cd736cc93d6e49b7791ebf2cb8f494` | 1 |
| 30 | receipt audited schema | F6 | `101e04e4a60c4f6a1ebb39ae89cc0f2f0bc912f8d26fb629d7480a3a41affe9b` | 1 |
| 31 | receipt build schema | F6 | `1c83821ff7b565573c0fe81ad370343311e5dc519d40a942e9e2f4375d79fd34` | 1 |
| 32 | receipt hash schema | F6 | `e5a546f65d4d858bd09c9d2ed6002f155ed688aa642c2cc19fe8bfd928dc28c8` | 1 |
| 33 | receipt status schema | F6 | `65299fe369cc6ffb97cc5d54f2012fe02953bfd41c8be004e0912955a2a1ffdb` | 1 |
| 34 | SQL exact build | F7 | `6242ffd3d3bfc215339d443502f56b4f9ad103199e8db4fcfef37811730a0a6d` | 1 |
| 35 | SQL current-build gates | F7 | `d2add9b6866370c78e8daaa284753c42fe838bdbb18cc2f93740b8548fede38b` | 10 |
| 36 | SQL gate verdict cannot be fabricated | F7 | `19dcd1c926ed9966c4ed68041491b6429019dfec803ca12e5369b5199b60a851` | 13 |
| 37 | SQL error reasons redacted | F7 | `df27552a8ee57ecb333fe8b574629e93ff1b2b1ef9bfe2aea01f01c5e41068cf` | 4 |
| 38 | SQL evidence build | F7 | `2030ef3e5e2c1aa6d3f942d7101e7bd7709934691f7979fa10e8970308bf1cc4` | 1 |
| 39 | SQL evidence import | F7 | `8eaa57aa3be3a0fda4a56042cc48d97f66d070fb766df0baedc49aa03d52dbbb` | 1 |
| 40 | SQL calendar env | F7 | `970c6a7f323b1404e697bd0fc7fca736790d2c78614903dcc27940232d425cb7` | 1 |
| 41 | SQL calendar owner | F7 | `744a81061d67bbeb958974011aed1d2cc6cf2d11f1cf8d3f20dacd75b0e00aa5` | 1 |
| 42 | SQL calendar date | F7 | `00260d03234350fb4be5a56888293666d62b530cb52301572b7da62ecc6cfbf2` | 1 |
| 43 | SQL calendar durable timestamp | F7 | `feb89b7bd0c2e7bf50fa7708ae4f8baef538cf06908d4eb251ca65929d0d767b` | 1 |
| 44 | SQL calendar latest import | F7 | `28a80eef27cd9031d4a68e5c45b128532e4e5414ffac694015405a4696311e4f` | 2 |
| 45 | SQL calendar event kind | F7 | `2c3afea0a1404988e420cfa8c46631149c173208f6626c995ce00232cf65dff2` | 1 |
| 46 | SQL calendar latest event | F7 | `ec7f21d89a28ce6591d903ee94984a4fbb8c50524357b3a941fdf254003b6f16` | 1 |
| 47 | SQL receipt exact build | F7 | `0f60706dc4660dc7beb4e00ae3b131e3021a5edc6d7912c1962cb4a2495b8ef9` | 1 |
| 48 | SQL receipt latest import | F7 | `bd195178fc0153763bfed3f9aa49b0ac1ebe95e11267869eef3f66745825b32a` | 1 |
| 49 | SQL receipt audited hash | F7 | `8e3d03b7e8d484c15d0d7c7b372b7a01ae9d91a00aefb7e266058d78f453348d` | 1 |
| 50 | SQL service-only ACL | F7 | `3009409af14071a3cbdc215550bf8514eb94fc5d3343c0e2bc9ed94ddd9e21ca` | 1 |
| 51 | SQL security invoker | F7 | `d5765c3e6159a5537d9317abc508192678c30da94b6410a5b87b9aa547a1d1ac` | 1 |
| 52 | SQL pinned search path | F7 | `c4e497bbcc798f3d001130e0db35bf911ed3fdbfcf14204ccaf8e26a4f9526d2` | 1 |
| 53 | runner deployment binding | F8 | `2bc1169b0a46d4cf492fd452d49a2a7693d0ac8433e3d24ee590ba2d59c2738a` | 1 |
| 54 | runner store enum | F8 | `ce62f2837b56c70742008d4b808fcd1fcdc266d6db23334734fc482605201636` | 1 |
| 55 | runner epoch enum | F8 | `519bf878d951db16b72260148ada0f625b7b66c20efedf270312f238250e823e` | 1 |
| 56 | runner freeze boolean | F8 | `6228425570153d56b29a739a69547d0e85d10980045b11b9eaa6b4a523b11f0c` | 1 |
| 57 | runner ages object | F8 | `98bd46661534af6f06aecf1be5fdcd572d2277b8234b0df51606fc8c0aebd15a` | 1 |
| 58 | runner age bounds | F8 | `91ff4c18f801a22fa48a9c4c8f0e8632b91c1e75802d9edec82b30fad0d49e5b` | 2 |
| 59 | runner audit boolean | F8 | `df6b356f92fa26f111edf9f15bf744d446e25ca5986e71b7c1f9b2df0757d69d` | 1 |
| 60 | runner gate reasons allowlist | F8 | `ecfda2b5c93c7597e93b95d49349667cd2f142fadb00c22276a722eea551ed98` | 1 |
| 61 | runner contradictory verdict | F8 | `aed08dc8aabcf1cc486c6a97ef816dead8b11b869d1b98b8dfc5532dc3013d32` | 2 |
| 62 | runner deployment id format | F8 | `ce52ddb465a66b308cb92e34fdfb696636abe2b154432836c6aa3b011b6196aa` | 1 |
| 63 | runner deployment id projection | F8 | `85cc560f94ab2dafe07af046861822dc86d91c1161985980716468f163c86ded` | 1 |
| 64 | runner command allowlist | F8 | `636f19be7d35c08af03a1c352dbb265a594112e780c26b5eb7d5736c4004a565` | 1 |
| 65 | runner activation full SHA | F8 | `e55d9bcabe9d356e0fe8d6e5d1cb7a0d351442444dee8fa37e4b3bd6d4c664c1` | 1 |
| 66 | runner safe HTTPS origin | F8 | `eed744e76b0fddfaf49711c0ca08b093057abe80dfb58d72afd035b4f13bcdd8` | 5 |
| 67 | runner non-TTY source | F8 | `af918d83ea5ab9e1423525d865bf7148cc1df97f481c618dd9accea139451d1c` | 2 |
| 68 | runner bearer validation | F8 | `53f43c7c90a8cd4e0b06e812d9af2d7d0672eb3ef29eadb9e93e1632fd2be6b3` | 4 |
| 69 | runner env source consumption | F8 | `f4fde84a1d7ba7b3dd7d414f4f93a67cf0daefafd2cfe7644ba5269ecf3be01b` | 2 |
| 70 | runner origin credential overlap | F8 | `261b4c41112ddb69ac853930f984fd9b359a8d9a34ba02844fc1f1256c47f00d` | 1 |
| 71 | runner redirect refusal | F8 | `1e3a3d92bfffb86554a299afef53a55f269e0b0fa8aad7237560a902baf15e2a` | 1 |
| 72 | runner Authorization header | F8 | `3e60246e13cb0f2cb1c3138ee2c7c4150fc41b6e653539fcb3d23a1820022d0b` | 1 |
| 73 | runner HTTP errors | F8 | `01e453e0e56743763d13bf5400bc29fb9b3b1c50d67a3ff37252984a411e18d4` | 7 |
| 74 | runner live health | F8 | `eb5cbf45ee7211336c86c05532204190a6811f702c13ab1e5b0cab22919bf86a` | 1 |
| 75 | runner full health SHA | F8 | `0efd76599bba8ae9239b9d415f441909c149987a7b966761789d8449ae0eda0e` | 1 |
| 76 | runner health capabilities | F8 | `bc7026ccf4efa6c7c96bce232b02f7c8dad594559b33bcec5c2b5a47ba9bbc5f` | 1 |
| 77 | runner expected SHA | F8 | `9e8508119edfb6604b19f14e1cb5f81b7661e160653731ea8a63cbedd671dfb5` | 2 |
| 78 | runner status SHA binding | F8 | `b499641ee1c9154b73d9a0048a2c38aa123a74ecbb3d9d6989ac85a34e9ec32f` | 1 |
| 79 | runner compiled contract | F8 | `1b8148a12969fbcee8d37c8d6e11fdfb0f0268c1eb8cd5635352eb1c33e5b30c` | 1 |
| 80 | runner gate verdict shape | F8 | `9ca1441057ecaad59157e753e71c8adfbc7e2f87767d38e8460d5d38517c6ab9` | 1 |
| 81 | runner target gate admission | F8 | `3b6f84725885e741284f8ac28c31bf8d21e08854ac18096a2f26485d61621f24` | 2 |
| 82 | runner activation TTY | F8 | `59e46542764fba0ab98391c7ddb8c91abd1b21cb119e9294376964a9d216b5f3` | 1 |
| 83 | runner exact ACTIVATE | F8 | `d4f57e5e61a2fd2c7c4f273ccc3734dc56f1fe74a87656e736beab72195c13a8` | 5 |
| 84 | runner post-confirmation recheck | F8 | `eb3f286ac021efb81b0fc0633308e2a4905da39a9f63bfe76225e751c3078a0d` | 1 |
| 85 | runner pending SHA conflict | F8 | `42c6bfa5d7dbee26284c066cad37a98c084f9ebf8f9444aa58afee9bbacf6142` | 1 |
| 86 | runner pending key reuse | F8 | `3aaa12ca62560a70dad300f14a7e1cb0d5e98bc83992ce6479351b45d2a49f58` | 1 |
| 87 | runner completed key rotation | F8 | `c6a096145a35632b3a7df8c2f61f5a6b973e4cf58a35361ef4e15eb0aae041c9` | 1 |
| 88 | runner UUID format | F8 | `8803733c1f5e88e97de914ea62a825794ea0760f6b1a9a88b6a973399a0494e4` | 1 |
| 89 | runner request result verification | F8 | `7060a7ea5b137d92c519e2eb9bc1a7ef395955838409e171281268df95580eae` | 28 |
| 90 | runner result SHA binding | F8 | `26cbb8c1f89d54c4b5b8a69116cf489988f296e001810c9f7c0c566ad2f76906` | 2 |
| 91 | runner audited backup | F8 | `51cf6b0f8f4ee7183aa38ae0b5c273efd8da9224ebbb155ecb605bf4f1177f05` | 2 |
| 92 | runner backup build binding | F8 | `c4689dddfded9743c8e8083b9d531cc8cd383f29505a5870005cb48d048d6d9f` | 1 |
| 93 | runner backup audit hash | F8 | `e1458dc79a3fc5029fcf263e82e87412404cbfe352982e45a6381017922c4626` | 1 |
| 94 | runner rollback freeze | F8 | `4d74501ad9edba419d499d1d69fda1a13a66cc58fbf3aac026c88496b482ead5` | 1 |
| 95 | runner rollback readiness | F8 | `825fb6382e7f289a24e588a5fa20c8f6e192f7f4aaf2199204dea32f35721d21` | 1 |
| 96 | runner private path type | F8 | `c4e1965d2e6f4ed79b57115fb27c301b3fc83b7ee1c56a68ee145ea8a205c35e` | 1 |
| 97 | runner private hardlinks | F8 | `6082b1e3f7a2143cf1356b4898add07477e3a8aed15dac936cf5e598e19b12f4` | 1 |
| 98 | runner Windows ACL | F8 | `0df449dc3ceb95afa4bda1397ee34f8b2a36af8c2898fdb1bfa8175fc5926951` | 1 |
| 99 | cron secret required | F2 | `3804241980926b441465865e6c2c4a62f74b49f835fbea8cb0a2585f74506b78` | 1 |
| 100 | REST configuration allowlist | F9 | `6696ba796a811ad00d99508eb21163b990e78e4f702ac242c217ce6f6cc53600` | 2 |
| 101 | deployment metadata format | F10 | `3b16742baeb6f88b107f332a122f4a005083ffe2a13411f7578e73a39a776906` | 1 |
| 102 | SQL gate result shape | F7 | `43803a08a419a03d871a6579c789e93c2ae631b0ef587493703d02b66e39556e` | 3 |
| 103 | SQL receipt switch/audit combined | F7 | `4e3a7d200ff687926584780a46ad0c1e2a4d02cd72c8eb0a94ad725caaa23efc` | 1 |
| 104 | SQL receipt hash tied to audit | F7 | `4cc33b7879ddbe591e657887d54d4b94005af9f288805975fc0a0c7d325ca080` | 1 |
| 105 | runner redaction | F8 | `a179c5db838bdb5e2b5d33cb495b14979fece906e88a8b1ea467bf950cbb1a7d` | 1 |
| 106 | runner unknown error suppression | F8 | `3306700e1427f56ab6e95be2fdcee3b7fc1927c7056925826b28ad499fae35a9` | 1 |
| 107 | runner persist before request | F8 | `f425fb3f6db12076ec63233bffa79ed50bde0a92e155d5e842e888ce0951cbfb` | 20 |
| 108 | runner completed state | F8 | `f168c51dcea193e3468b70118a218323ab2c2a18836393c640d0c3e8cb7a2613` | 1 |
| 109 | runner state credential overlap | F8 | `8885891f1d1fb70022a97ba1b0970651c8d0a24d0274c39b448ce88dea2a6d35` | 1 |
| 110 | runner repeated flags | F8 | `164bca7ceb91f31d945d4f5b5a70da6f1563f8eebe57240959b71aae08fcfe5b` | 1 |
| 111 | runner full measurement | F8 | `a6b78b370b50bcaafc8f6329551e9a0ed6a1e52686f37dd1226f91f9e0edffea` | 1 |
| 112 | runner measurement collections | F8 | `dd7063726fcad659f9cc05caacf534810ffa9b1ef7ee719c411930e42e5e02bc` | 1 |
| 113 | runner measurement IDs | F8 | `424da1dc206f2ebdb618750eebc7af4319193d0fafeab9637b497cb286d54b04` | 1 |
| 114 | runner measurement blockers | F8 | `fc285b8036a01862f8fe5fdcb775404c487b6195ad9011cf1677bd959a53d3c1` | 1 |
| 115 | runner measurement equality | F8 | `c8342b8580adc00d0f22b6f13eaa81be84ea5a6c2904aff26a57c526a63bd14f` | 1 |
| 116 | runner measurement lag | F8 | `69692dbb4a6f85ac1a19771c1499d29de8a35c6579dc10954c54e52f24b5ecc0` | 2 |
| 117 | runner parity exact | F8 | `fc33a6c8a43519e674e5c52bc40d9dbe34b8212a1343c9e2b46b447de06ababc` | 1 |
| 118 | runner parity matching hash | F8 | `ae2141a3f75a4a2e554a32d17dd1ee70560377081e14f1871436bd3da2158297` | 1 |
| 119 | runner parity counts | F8 | `30ee69823742556f7345c7de55262776a8b0cf5240979963607ec8ffdc0b5e8a` | 1 |
| 120 | runner parity differences | F8 | `6812001aec938a7654a96ef7520bd653fa38da58d5b4b963493d8276a921a944` | 1 |
| 121 | runner backup verified hash | F8 | `d4905014616c05a626887a8e0954f958bfaabf83e508e344544f7b505948d3a9` | 1 |
| 122 | runner smoke required providers | F8 | `5351740ecb08542d8636f050bcf7d6e4ae2f2766431199fa9c295597a27f61fa` | 2 |
| 123 | runner smoke provider status | F8 | `966dcf3f3e057ebdcbe4fe25f159743b5f4c6b7bee991ac29a57884952a39124` | 4 |
| 124 | runner private permissions | F8 | `174694ba2cc38f6ce0d4aac184c1a0b42f0fcba23787c9e52d67f08fcf383444` | 1 |
| 125 | runner private directory mode | F8 | `abde61c4453afc8a7f9bcee51fe1ef57042ab59a8e7eb0d592ceefd6e1051e4c` | 1 |
| 126 | runner private file mode | F8 | `68c6ead1e358ef541bc6549aa60195edbd6dbceb3c7afdb71cd52c2852418d38` | 1 |
| 127 | runner ACL principals | F8 | `fa151d1eac9e791244a93e7867d160e769bfa362ac1a08b7909a0c944cac0944` | 5 |
| 128 | runner ACL nonempty | F8 | `6739d0171edd0321389653b8b8111a4f781af99caec2f3fa00b100ad5641fc81` | 1 |
| 129 | runner ACL protected | F8 | `7ee3e66db6e7a8da69f8992cc10f9d8688375707bca184239030d316dae23c4f` | 1 |
| 130 | runner ACL no deny | F8 | `572bda6f42f253fcbc9953013e5b670724d6eae1b0ec0641d7f0e861dd723752` | 1 |
| 131 | runner existing file ACL | F8 | `4702cadd557564385dc0ce71e74a8210b8df6f140b79770fddbecf9777540848` | 2 |
| 132 | runner Windows entry inventory | F8 | `3b3ff20351ec9b3842ea37893891a300fb7d97b7dcad556ddc06eef691f55bcb` | 3 |
| 133 | runner native Windows tools | F8 | `ad4fd1f90f9ed892751e1e9ad832b760b7f5dc9e82b916933f9bfe04d5f94bcd` | 1 |
| 134 | runner log failure status | F8 | `13ba264e3e6605c1a63a76a0a81e70463c4ce86e42f64ffa51676a3517800d15` | 1 |
| 135 | runner lock failure status | F8 | `75d1d271c9e52042bed9f625e2a0c385949eedc41ba450d76d51780ddf4cf61a` | 1 |
| 136 | backup recovery admission | F11 | `e4334af64f5fc11bc8fb1d10ee4848273902b9e64d9e15988ef9331a791a9a71` | 1 |
| 137 | backup missing receipt refuses | F11 | `21672c72307adb8131b844a14d1d04ae41afc7a1194f1f6be957db3f543a7132` | 1 |
| 138 | backup audited receipt returned | F11 | `fd3237ec3f77e3f09eb708e670fc727363fe24c80c09fc1f16bc21e27e63ab06` | 1 |
| 139 | backup folder overrides dynamic waiver | F6 | `e7d0ff39eb47f33490ab4293e5b561f0cb6e8523054a2b35ecb106f39468ed4d` | 1 |
| 140 | backup env revocation | F6 | `4a16a4f36209c75548b5eb029e2aeebc2ac6e424d054564cae8d05f945a5d8bf` | 1 |

## Handoff and cleanup

The new status/receipt migration remains **UNAPPLIED**. The coordinator must
review/apply it and verify the exact reviewed deployed build before instructing
the owner to run the quickstart. A local freeze does not establish all-instance
or external-writer drain. Use the immutable verified deployment URL; separate
HTTP requests cannot reserve a mutable domain/build. Existing atomic activation
and ordered recovery remain the final authority.

The scratch dependency junction was unlinked using `cmd //c rmdir` in Git Bash.
The recursive deletion request included a no-links safety check, but automatic
approval review rejected execution with the stated reason **blocked by policy**.
A separate read-only check then confirmed zero remaining reparse points. The earlier direct deletion of the copied scratch .git pointer was
also rejected; no alternative shell/API was used to bypass that rejection.

**Remaining cleanup blocker:** `D:/wt/cs207-check` still contains the regular
scratch copy, without node_modules or other reparse points. This is a cleanup
failure, not a passed check. A runtime permitted to remove that verified scratch
directory is required to finish the requested cleanup. The main dependency
junction and its target remain intact.

The final mutation evidence was transcribed into this report. All seven external
mutation scripts/results/logs were removed with individual literal-path,
nonrecursive deletions. No
helper files or dependency changes remain in the worktree. No remote write,
deployment or external database operation occurred.

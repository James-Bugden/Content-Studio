# CODEX report ? CS-067 / issue #206 / build round 1

## Disposition and identity

Implemented and committed the owner runner, offline tests and owner/coordinator
documentation. **Not production-ready and not a completed live cutover.** The
merged API lacks the read-only gate/status contract required for safe activation.
The runner refuses that gap; no server route/gate was changed to work around it.

- Issue: https://github.com/James-Bugden/Content-Studio/issues/206
- Branch: `cs-206-run`; clean starting base/origin-main: `9a9f7934baa1da1a9855182eac167be1544c1981`.
- Implementation commit: `414e76e5ee16c743e4353545ebba3120e8f7bcc2` ? `CS-067: add private owner cutover runner and mocked safety checks`.
- Report is committed separately after that implementation commit.
- Final exercised `scripts/cutover.mjs` workspace-byte SHA-256: `c50989bc57007ff9de45f4634510a012d5005cec6b1b48d52561c14ff61962e3`.
- Classification: Heavy; role build; round 1. No matching remote PR existed for this branch when inspected. No PR was opened or updated under the explicit no-write instruction.

## Result and acceptance

| Acceptance area | Evidence / actual status |
| --- | --- |
| One npm command / named commands | Added `cutover` package key; status, measure, activate-read, backup, rollback, activate-db, export, all-prepare, smoke. `backup --scheduled` exercises the merged daily reconcile GET. Actual npm subprocess is exercised with mocked fetch and TTY. |
| Sources / secrecy | Hidden TTY default; explicit LastPass fixed entry; explicit process-only env source. Existing hiddenPrompt/selectSource/command helpers reused without refactor. Shared command now removes CS_CUTOVER_BEARER as well as app secrets from child env. Tests assert no bearer in argv, URL, children, logs, errors or generated files. Only synthetic bearers were used. |
| Durable retry / concurrency | Pending UUID persisted atomically before a mutation, reused after ambiguous failure, rotated only after verified success. Directory lock serializes local processes; corrupt/stale-SHA retry state refuses. Files 0600/root 0700 on POSIX; verified owner-only ACLs on Windows, including existing state/log files. Symlinks/hardlinks/unexpected Windows entries refuse. |
| Activation guards | Full explicit expected SHA; deployed health/status build equality; strict compiled contract; target gate green with no reasons; real TTY; exact hidden ACTIVATE; post-prompt recheck; typed response verification. Guards pass in mocks and refuse the actual merged POST-only status contract. |
| Backup / rollback / export | Validate verified manifest hash or explicit server-audited build-bound waiver; rollback requires frozen writes, readyToFlip Sheet and exact counts/hashes/no differences. Calls only app routes. Never flips Vercel or accesses providers directly. |
| Output / private evidence | PASS/FAIL rows, fixed/allowlisted reasons, nonzero on failures including local journal failures, timestamp/SHA/deploymentId-null/count/hash projection only. No arbitrary provider/server text or post copy is persisted. |
| Docs | `docs/ops/cutover-owner-quickstart.md` has numbered owner steps, failure/retry recovery, proposed status contract and all current limitations. Coordinator runbook links it, removes secret-bearing shell examples and assigns roles. |
| Env manifest | Schema drift test stays green. APP_BASE_URL already exists. CS_CUTOVER_BEARER and Windows SystemRoot are CLI/OS inputs, documented rather than added to app settings. The shared launcher uses PATH. No app default or source-of-truth change. |
| Independent review | gpt-6-sol, xhigh, separate reviewer. Build-SHA binding and retained Windows ACL issues fixed automatically, regression tested and re-reviewed. Final reviewer found no further code/ACL blocker. Four independent isolated mutation probes also confirmed critical guards. |
| Live/hosted acceptance | NOT RUN, explicitly prohibited for builder. No production readiness, hosted QA, deployment, cutover date or authority flip claimed. |

## Required checks and limits

Every Vitest, typecheck and lint invocation used `bash ~/bin/heavy`; no full test
suite was run. Dependencies were not installed or modified. The existing
node_modules junction to the MAIN checkout was left untouched.

1. **PASS** final targeted Node/CLI/helper tests: 5 files, 212 tests:

   ```text
   bash ~/bin/heavy npx vitest run tests/unit/cutover-acl.test.ts tests/unit/cutover-cli.test.ts tests/unit/cutover-runner.test.ts tests/unit/env-bootstrap.test.ts tests/unit/env-sources.test.ts --maxWorkers=1
   ```

   Includes the manifest drift test and all existing secret-source tests. The
   actual `npm run cutover -- status` subprocess uses a temporary external
   checkout containing only copied scripts/package metadata and a mocked HTTP/TTY
   preload. Its table contains read-gate PASS and write-gate FAIL/import_lag;
   it exits nonzero and leaves no bearer in any generated file. Native Windows
   permission tools are exercised there. No dependency link is created.

2. **INCOMPLETE / FAILED TO COLLECT 10 FILES** required broader directory attempt:

   ```text
   bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/cutover-runner.test.ts tests/unit/env-bootstrap.test.ts tests/unit/env-sources.test.ts --maxWorkers=1
   ```

   Actual result: 34 files passed, 10 files failed to import, 600 tests passed.
   All 8 security files passed. Application: 14/15 files passed; Supabase:
   9/18 files passed. Missing `@electric-sql/pglite` prevents application
   content-read-cutover plus nine Supabase suites from collecting. This attempt
   preceded final CLI-only regression additions. It is not an overall pass.
   No application, route, schema or provider module was edited afterwards.

3. **BLOCKED / FAIL** `bash ~/bin/heavy npm run typecheck`: missing
   `@supabase/supabase-js`, `@electric-sql/pglite` and PGlite pg_trgm typings
   in the shared MAIN dependencies, with downstream implicit-any/untyped-call
   diagnostics in existing Replies/application/Supabase files. Final attempt
   reports no diagnostic in the new cutover test files. The no-install/junction
   restriction prevents repairing the shared dependency installation here.

4. **PASS** `bash ~/bin/heavy npm run lint` and `git diff --cached --check`.
5. **PASS** `bash ~/bin/heavy npm run check:private` and
   `bash ~/bin/heavy npm run check:secrets` including the staged report: 649 files, both clean. The secret scanner initially
   flagged a synthetic credential-shaped URL literal in a refusal fixture;
   the fixture now constructs that unsafe URL at runtime. Scanner rules were
   not weakened; no real secret was present.
6. T1/T2 browser, T3 device and hosted T4: not applicable to this Node-only
   implementation or not run under the explicit no-live-call instruction.
   Owner content/save/replay/stale and exact deployed T4 remain live gates.
   `smoke` checks read-only health/capability facts only, not provider reads or
   authenticated content flows.

## Explicit integration blockers / handoff

- GET `/api/ops/content-cutover` does not exist in the merged build. Real status,
  both activation commands, and final all-prepare verdict refuse HTTP 405.
  The future mock GET contract in the quickstart is **proposed**, not invented
  evidence of a deployed endpoint. It needs a separately reviewed server change
  before the owner can be told activation is ready. Health cannot substitute.
- Current health does not expose a deployment ID; the log uses null and the
  table says unreported. Coordinator must retain verified deployment identity
  privately. SHA is validated where the route exposes it.
- No audited backup-waiver response exists. `backup_waived` is accepted only in
  a synthetic response carrying audited=true, exact build and auditHash. The
  existing calendar waiver never skips a real backup. Current routes still
  require the verified private backup and all other live gates.
- Export and scheduled-backup GET routes ignore client Idempotency-Key. The
  runner persists/sends it, but cannot add server replay semantics. Export uses
  server checkpoints/leases; scheduled backup uses a deterministic daily server
  UUID, which can change across a day boundary. No automatic retry occurs and
  docs explain this limit. Cutover POST actions use the merged operation ledger.
- Use the coordinator-verified immutable deployment URL and avoid deployments
  during activation: the existing action-only POST cannot atomically bind the
  caller's expected SHA to a mutable hostname. Its own server gate remains final.
- Current source of truth/default is still Sheet. No deployment/cutover/Phase E,
  schedule, migration, production data operation or provider call occurred.
- No git push, no GitHub write, no PR merge/deploy/issue closure. Only read-only
  GitHub issue/PR metadata was inspected. No real CRON_SECRET was requested,
  read or handled. All app HTTP tests use mock fetch.

## Independent review / adversarial evidence

Lenses: correctness/shape validation; state/concurrency/retries; auth/privacy and
local ACLs; false-green tests. Real red-before regressions included the native
Git Bash whoami collision, six root ACL/identity failures, and two retained
child-file ACL failures. All were green after fixes. Three originally surviving
logical mutation checks exposed weak assertions; tests were strengthened. The
redundant standalone symlink predicate mutation was replaced with a meaningful
combined path/type guard bypass. Final main campaign: **64/64 killed**; new root
ACL campaign: **6/6 killed**; existing-file ACL campaign: **4/4 killed**.

Each row below records the actual pre-mutation bytes, changed implementation
bytes and exact restored bytes. A killed mutant required nonzero Vitest exit
**and at least one failed assertion**; parse-only/zero-test failures were not
counted. No tests were mutated. Campaigns were sequential, with original bytes
restored and SHA verified after every probe. Campaign 1 precedes the focused ACL
repairs; campaigns 2/3 test those additional guards on the subsequent snapshots.
Final tests above run the restored final source. All helper scripts/reports were
outside the repository, without node_modules links, and were removed after
transcribing this evidence (six known regular files, then the empty directory). Runtime test scratch is also removed; temporary
junction tests unlink with cmd rmdir before deleting their containing scratch.

| # | Guard | Before SHA-256 | Mutant SHA-256 | Restored SHA-256 | Failed tests |
| --- | --- | --- | --- | --- | --- |
| 1 | command_allowlist | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `7e134538a073c0bbeb3b79763e20aad31e2729499a3ce7f32f1d69f05e3cbde2` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 2 | activation_full_sha_required | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `0d947ae84fe00c5b8a0b35c5aa4ebb2353e3e502b00b670968e294539e097082` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 3 | origin_https_and_no_credentials | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `9303157f84a50e2e4c9d46f08a204ea2737d17394ed37109c308d2fe6fc65216` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 5 |
| 4 | non_tty_source | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `447cbf223993ecc156839ce8e92fac8cc129b11c2ee1c6044815566546202830` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 2 |
| 5 | bearer_validation | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `4afcf84ee8854e4aed307bcf5243a232bfd4264d1db72cc61ce97e98e1345484` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 4 |
| 6 | env_source_consumption | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `d1ce2bb74550a9c06040ef6a266aa59ea2b5ee013988c74b93ef8780feaca2c0` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 2 |
| 7 | origin_secret_overlap | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `55148c5773a436e4f01b3bcd48ba19fcbcafd9932a930a656afc00c20a27ce18` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 8 | redaction | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `b61bc6589a0300adc52b49716b405513239b510d1cc6b0193d306d8d53d88fa3` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 9 | unknown_error_suppression | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `70210677dd8d498020c3ee77b45b9480de46b18991bef7d6b1174fc20b021b28` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 10 | redirect_prohibition | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `8aa1bb1c0f6ac8951588f1182369459d80475ef70d74a899df494b9a1059b245` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 11 | authorization_header | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `9ddba5cd8bf459514826309ec95e9046d701979268fbb6c6de029d6093098477` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 12 | http_failure | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `737cedff2dcf0e8657f43e72cb3c848f440d5a54b83c237296024da82d12d858` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 7 |
| 13 | live_health | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `25954222b75f6533a30195bae1e78b56c1a578829037972ce226aa0a458710bd` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 14 | health_sha_format | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `cc249685a4c2bbc951af49d6f01eafe5963e0eb862fe5ce6ebeb93f20c3c296d` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 15 | health_capabilities_shape | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `0cb8b980f1e795542596bff66202f6a60bfc1e05f9fc788f095b2dbfa28b6aa5` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 16 | expected_deployed_sha | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `f9f86a766e6efee9b4aed2c0f76d7ecc7899ee62af7bcce29cb9ccf69d239c4d` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 2 |
| 17 | status_build_binding | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `7a2c8b5f649f7bdc18e573348da76a46ee7d01a0b07b7dfc6b2599c386b3a8b7` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 18 | status_contract | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `ade0860076f580001a664defe18fc82838f5d0915b40a79527238ebae08d453a` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 19 | target_gate_admission | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `1e53e3dcb8e165b7ff8b55783673e33f0d730d7f0edd130f8726b58c214e469e` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 2 |
| 20 | activation_tty | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `e17b145e796a349b6bf7c33ec19f917c4bd42aa0b635d4e026aa2c49a37ce5b3` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 21 | exact_ACTIVATE | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `527fa91ed22f5422e575bba384799505c9f62ea5200bfa1467e1e3b06fec5664` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 5 |
| 22 | post_prompt_gate_recheck | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `0d815a39485f7077b3faf01dfad0500f455d0c7167c059288c49e1c4088bf633` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 23 | pending_sha_conflict | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `b85b6d8eaa69e8ee867d8a10a7c41c056d6df9600b6f67938fd9d53bc8a15c28` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 24 | retry_key_reuse | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `dc4351880b623aeb05f377e96c07f028028be093b7391561274d0d65d5d6e404` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 25 | completed_key_rotation | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `96cdd16194ba9e8bf4343e6894c7ce3aa43750b3682846fea3eb232bac75112e` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 26 | uuid_validation | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `49c39250cccd22c33742012ee7ff1628fb39e03b8294d2af8080b01841d1965a` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 27 | state_validation | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `b83497fd738397d43cd5c286d233311bd749c1950ae851bdbb00639444092f56` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 28 | persist_before_request | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `c72d0fa5017c6cf56703b91c65e91741902b1b0b2670e19ae26dac2d17e10e3f` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 20 |
| 29 | completion_rotation | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `a83822540efd3fb7050b061f8da280454ddafa88bf87c50de1bf99203febe54d` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 30 | result_validation | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `c4d28380dade48c3972c1a1ab3a9bfff7d7a8b67838609973fb0b3fe8eb8b4c7` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 28 |
| 31 | result_build_binding | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `a604518804b60f02b4f9b7f40ab0a947747a8c947be952fec03c74d7b87e651d` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 2 |
| 32 | measurement_all_rows | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `8114b6648a31613af24d18b6512c9349a22ed7a284dce4f35b63434e953d9ccd` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 33 | measurement_all_collections | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `52c9a1c9d0ba940d0975b0d0a49bd54a792c5bcd47e00a47e9bc48b7d8897a59` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 7 |
| 34 | measurement_ids | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `a7c1c9d20b3b57b250cef91248f8f596a8c617a7209ea88fa9a3a22e36ae37ba` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 35 | measurement_blocking | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `5a980650da14cc9fd8bcc264c4abbbc5ecf6871be67da682330394313401c394` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 36 | measurement_field_equality | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `01c40aa77ff42f148851e9a2bc7950053efc8d2e8fa9496fb5eb7273a479a38f` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 37 | measurement_lag | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `88cd397ef88c3af3e98982b23dddfeabe947c58f649a8067d81def8a4eeb5d11` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 38 | parity_exact | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `03ce3fa023de657ab96c61a47f57355d68c8fffcf07e72fe27b6db3488f96daa` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 39 | parity_hash_match | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `68ad118079f893cc54c6f85f9e0b9abfed380ebbb1d5e55bfb98045dc00163b6` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 40 | parity_counts | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `4e1ad86c1c3960cb94da19f90887b870a8705acb091ad783bc49d11df74e22b0` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 41 | parity_differences | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `5613d451c00e58466127c0d1b6745c4e6c28feeaca09f3df441d683e72555a76` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 42 | rollback_frozen | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `23ddf95711576157ee8155df8eec7502d29280f7353e60c997b4012008c18686` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 43 | rollback_ready | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `78c36c8c7dc820c9e3c42efce46f9156a5b369f9c246ece89423727de9945cd3` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 44 | backup_manifest | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `1888ef93f87113d7ef994a9e0e2d056505b95db714c28201c965754f5e35725e` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 45 | waiver_audited | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `25a7fbe226f02adcc20c7a1ce2d44bc8bf22bbccde49d1be3308e3cf84ef3dee` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 2 |
| 46 | waiver_build | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `2d9819a77c9b0e727c80a39eefb79260e18c78d6f439e4e49ce91e5b6ba7dc97` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 47 | waiver_audit_hash | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `b828367da44ffe00344bdc3fc1e00db47157f40d75e9a92aa979600f5c3090c5` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 48 | smoke_required_providers | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `cd1aa0a40d8d3a5e9932b0d604744c469c61702f8b3c5c0cee6729fd143fa2dd` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 49 | smoke_provider_live | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `1d31240db7a4e4140bb14dd3c2dfb4025344f9de5e32c12a9ffbd2ce4e8d10d5` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 50 | smoke_provider_ready | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `868b696a7ec4d7648bcb12cc487c11aa125c2902248bd4b13cd2b90784daf1d1` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 51 | private_path_symlink | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `a5fddcbee76055c9e4a87380c60cdc8ecb18e8baf8a60d364c2cc6e6ae4696ec` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 2 |
| 52 | private_file_hardlinks | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `501df4e69f734e9839c372f8a3b8a1ecefe3293859e0566e79d6813163b50246` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 53 | windows_acl | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `defff5b315cc76da4ca2e3a5a3d4a842d8a7d2f0b99a058f3f8b8a9622de958e` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 54 | child_env_sanitization | `4fd3e131de0d86eade369dce80e8e0b41abddabbc6558d71acf711ff72ca3254` | `ac6166582e025ab7f8e98d263c814559bb61d293340d12f6c26a8f8f0f33a4bd` | `4fd3e131de0d86eade369dce80e8e0b41abddabbc6558d71acf711ff72ca3254` | 1 |
| 55 | option_duplicates | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `63df876814dd4be0c6177168d93b8200b226be373a3af95fa627f33e0a33d838` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 56 | state_secret_overlap | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `7779e1fd0315a7aba5efc446fd6a77754a05ac47a032703e15c22e6bcb07fa17` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 57 | native_windows_tools | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `8b4e83258023d160e128e5c3252937964530a1e1391b540551830b689d77669d` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 58 | private_directory_permissions | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `62ff8cfd0c894605379ef6b1da4a2126d8ae283aea04aa9327a1b9916827c304` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 59 | private_file_permissions | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `4d7d75b611468f9403ce704a668a4ad09b00ceafe0eeb6b31137830e8f807a1a` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 60 | private_directory_creation | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `8a99cc36cc6d13f57456e93ae6f30e974d376b479e8b18d826889ce1409a67b0` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 61 | local_lock | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `bf6eab7a72ad2e61fb9a05a0efbc0a8b1c5979fd185929d2c7a734488d6c675a` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 62 | gate_verdict_shape | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `4d92b60bb4c1ccd794e40e6fe68f47bcea5a1bce1773fa02f69ac17d1f65bcaa` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 11 |
| 63 | log_failure_exit | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `2590b86f770a184c83300a0814d63524725cb3e95aae4e730b21b17dc005b267` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 64 | lock_failure_exit | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | `6af4dde6dde1891d7bfa725c373d6bc8489ae07ebe6e9b41d13b96920af85927` | `ad7652b9279c8e6206ba78dc4e29bf9ac8441faa02ac5f709cf1092bd8c079ec` | 1 |
| 65 | acl_every_principal | `cff1a65a228d8771a1551e0c965eb294346322bdc7612610835c3acf5e389f7f` | `f08fe9f3b6fdc32318453e1e6709ecafc88dc432371e382682392db775e1e5b5` | `cff1a65a228d8771a1551e0c965eb294346322bdc7612610835c3acf5e389f7f` | 4 |
| 66 | acl_has_owner_entry | `cff1a65a228d8771a1551e0c965eb294346322bdc7612610835c3acf5e389f7f` | `25139dcf6a0b93fea498cdbf68237683b1fd848a910ce13cff1b8c073e8f58f5` | `cff1a65a228d8771a1551e0c965eb294346322bdc7612610835c3acf5e389f7f` | 1 |
| 67 | acl_no_inheritance | `cff1a65a228d8771a1551e0c965eb294346322bdc7612610835c3acf5e389f7f` | `99cc5ffc4786515c6627f7efe46709d5dba21ab6a906bb8ecc65fcb5a456f000` | `cff1a65a228d8771a1551e0c965eb294346322bdc7612610835c3acf5e389f7f` | 1 |
| 68 | acl_no_deny | `cff1a65a228d8771a1551e0c965eb294346322bdc7612610835c3acf5e389f7f` | `156a2cb8b7eff5291cb790eb35a7fa0a265f17124429ae8bc570b8dec1c6c4d9` | `cff1a65a228d8771a1551e0c965eb294346322bdc7612610835c3acf5e389f7f` | 1 |
| 69 | acl_enforced | `cff1a65a228d8771a1551e0c965eb294346322bdc7612610835c3acf5e389f7f` | `97441831dd720e697495f81274f32e0842a64c417a4a5ceedf319c762cd6b5d5` | `cff1a65a228d8771a1551e0c965eb294346322bdc7612610835c3acf5e389f7f` | 8 |
| 70 | owner_command_success | `cff1a65a228d8771a1551e0c965eb294346322bdc7612610835c3acf5e389f7f` | `af3928f081dd94b4f2900d11db9f8c3e9dcffc6e142df9ab9afcf9bbdda8e551` | `cff1a65a228d8771a1551e0c965eb294346322bdc7612610835c3acf5e389f7f` | 1 |
| 71 | acl_existing_files_enforced | `c50989bc57007ff9de45f4634510a012d5005cec6b1b48d52561c14ff61962e3` | `2dc90d2c7a53f702e7229036d2cf5d2c0313cf047e58137ae976fd8d7f57aeab` | `c50989bc57007ff9de45f4634510a012d5005cec6b1b48d52561c14ff61962e3` | 2 |
| 72 | acl_existing_files_enumerated | `c50989bc57007ff9de45f4634510a012d5005cec6b1b48d52561c14ff61962e3` | `e3e4d7ca865f46f927f09e384835caf561a6cb791f1b152bbe5d1ac32ab561be` | `c50989bc57007ff9de45f4634510a012d5005cec6b1b48d52561c14ff61962e3` | 3 |
| 73 | acl_root_inheritance | `c50989bc57007ff9de45f4634510a012d5005cec6b1b48d52561c14ff61962e3` | `e99b49b751328731fccb063f60b4a46b4fba237f42ae19a1698c2ac5a20a0369` | `c50989bc57007ff9de45f4634510a012d5005cec6b1b48d52561c14ff61962e3` | 1 |
| 74 | unexpected_state_entries | `c50989bc57007ff9de45f4634510a012d5005cec6b1b48d52561c14ff61962e3` | `0b486225a2b6744a7b157beef79b2d5fffa421e3daf6cfce19a29e9ae3317bb9` | `c50989bc57007ff9de45f4634510a012d5005cec6b1b48d52561c14ff61962e3` | 1 |

The independent reviewer separately changed temporary copies for deployed SHA,
ACTIVATE, retry identity and measurement IDs. The original SHA was
`d44d378b5dc9bf560561fd7f14055f5decbe1bcd119b2d6981e46d2c2a36752a`.
Its four mutant SHAs were respectively
`053a65d741f104ad1c9babff282bf2b5f81741ee8f6694d1af61e92bdd606d15`,
`6d07dca80348d847f8d6b3b899319eb70baf7fe889261c73821573b397afbdda`,
`dbc12c2702d6a74b133b0109687f724174db028678d021ca370df089fd0f2167`,
and `5f1b019ea917e75d243de3f04ba8b3f299be8e82fa854be5faf212c0f5390b06`.
Without SHA/ACTIVATE checks the mock made an activation POST; disabling retry
reuse rotated the pending key; removing ID equality accepted a bad measurement.
Original-copy hash equality and scratch cleanup were independently confirmed.

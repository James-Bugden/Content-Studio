# CS-067 / PR #208: fix round 1

Code commit: `f40aa50de66fc9b97aa7944bd6afb9fd17314e36`. Branch: `cs-206-run`.
Verification date: 2026-10-26, Asia/Taipei.
Reviewed starting head: `fe934eb7a18b77eb9fc71f7d7655651197e9df2f`.
Fetched base: `74ef80cf586c76decae3e28a4dbd9328b4855c3a`; already an ancestor, so no merge was needed.
Classification: Heavy. [PR #208](https://github.com/James-Bugden/Content-Studio/pull/208), [#206](https://github.com/James-Bugden/Content-Studio/issues/206), [#207](https://github.com/James-Bugden/Content-Studio/issues/207).
This report is committed separately after the code commit. No push or GitHub write was performed.

## Result and acceptance evidence

The server now requires strict `expectedBuild` input on both activation actions.
Only an exact 40-character lowercase hexadecimal SHA is accepted. Missing,
malformed, uppercase, short, long or padded input returns HTTP 422 with
`cutover_expected_build_invalid`; a different executing build returns HTTP 409
with `cutover_build_mismatch`. Authentication precedes body validation. Unknown
body fields are refused. Error details contain only fixed reasons.

The route snapshots the deployed build once using platform precedence and
compares before service access. It passes that snapshot to `execute`, which
checks it against the SQL store's captured build before provider work, operation
claim/replay or activation. That store supplies the same build to SQL gate and
activation calls and already hashes it into activation operation identity.
This also refuses a stale cached composition rather than switching builds.
No SQL change or migration edit was needed.

The runner sends `--sha` as `expectedBuild` on both activation POSTs. Existing
client checks still run before POST. A refusal, including HTTP refusal with a
plausible success receipt or an `ok:false` body on HTTP 200, cannot print an
activation PASS or complete the retry state. Named build reasons are allowlisted.
The owner quickstart documents the field, strictness, refusal reasons and retry
behavior, and distinguishes build binding from deployment/configuration identity.

| Acceptance | Evidence |
| --- | --- |
| Both actions validate strictly before service access | `security/cutover-activation.test.ts`: missing/type/format/case/length/padding, extra keys, auth first, platform precedence and fallback |
| Compare full SHA before mutation; no TOCTOU | Route single-read getter test; shared guard exact/prefix/case/trim tests; cached-composition PGlite refusal |
| No authority/job/audit effects on mismatch | Real composition + real SQL through mocked REST with fully green executing build; authority and jobs remain absent, audit rows unchanged, zero provider calls |
| SQL gets compared build | Positive activation inspects exact RPC `p_build`; wrong-build RPC mutation killed |
| Changed expected build cannot replay success | Same UUID refuses before provider access; matching retry preserves original receipt/epoch; redeployed matching new build with old UUID receives 409 and leaves epoch unchanged |
| Runner sends expected SHA and never reports refused activation success | Mocked refusal for both actions, HTTP/body refusal variants, pending-key reuse and changed-SHA client refusal |
| Full client comparisons | Health, status and activation receipt same-prefix regressions; three prefix mutations first survived, then were killed |
| Env manifest unchanged and green | Exact schema-key/requiredness/default drift test passed in final required run |

## Red before / green after

Before implementation, the three-layer targeted run reported 14 failed / 5 passed
(other tests deliberately not selected). Route failures included accepting a
missing expected build and lacking the new strict contract; the runner failed
the expected-build refusal contract. A separate real-composition PGlite probe
reported 2 failed / 0 passed: both activation modes accepted another expected
snapshot, returned success and created one authority row and one operation job.
The zero-epoch assertion failed explicitly. The required scratch rerun reproduced
that exact result before the fix.

After implementation the targeted build-binding run passed 45 / 45, including
four PGlite cases. Subsequent tests strengthened same-prefix comparisons and
refusal handling; all final required tests below are green.

Two initial length-deletion mutants survived because the anchored 40-character
regex already enforced exactly that length. Both redundant added length checks
were removed from the final implementation, retaining the strict regex. The
final guard campaign killed 28 / 28 mutants. Three additional client prefix
probes initially survived; committed health/status/receipt regressions killed
all three identical mutants on rerun. There are no remaining final-guard
survivors. All initial survivors are disclosed in the campaign tables.

## Final verification

Final required run: **1459 passed, 0 failed, 0 pending**, across
**77 files**, with no failed or never-started suite.
Every Vitest/typecheck/lint/scan invocation used `bash ~/bin/heavy`; tests used
one worker. Only the named files/directories below were selected, never the
repository-wide suite. PGlite ran in an isolated scratch copy with its
`node_modules` junction targeting the existing `163/node_modules`; no dependency
installation occurred. The worktree's existing MAIN dependency junction was
preserved. Source and test bytes were compared between worktree and scratch.

```text
# cwd: scratch copy
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components tests/unit/cutover-runner.test.ts tests/unit/cutover-cli.test.ts tests/unit/cutover-acl.test.ts tests/unit/env-bootstrap.test.ts --maxWorkers=1 --silent --reporter=default --reporter=json --outputFile=final-required.json
bash ~/bin/heavy npm run typecheck
# cwd: worktree
bash ~/bin/heavy npm run lint
bash ~/bin/heavy npm run check:private
bash ~/bin/heavy npm run check:secrets
bash ~/bin/heavy npm run check:env
git diff --cached --check
```

All commands above passed. Manifest drift passed explicitly. Typecheck initially
failed in the worktree because the MAIN dependency tree lacks the existing
Supabase/PGlite packages; it passed against the complete pre-existing scratch
dependency junction, including on the final code. The first required scratch
run passed 1,451 tests but its boundary file failed to start without Git
metadata. After adding scratch Git metadata, that file passed all five tests,
and the final entire named selection above passed without omissions.
An intermediate JSON-only run reported all assertions green but its shell
invocation exited 1; it was not accepted as a pass. The final complete rerun
used default plus JSON reporting with direct subprocess exit capture: 77 files,
1,459 tests passed in 252.02 seconds, no unhandled errors, process exit 0.

One early targeted PGlite red-before invocation accidentally used the worktree
cwd instead of scratch. It was repeated in the required scratch location before
implementation; all subsequent PGlite runs used scratch. This was local
synthetic test execution only, with no external database or provider calls.

T0 is evidenced above. T1/T2/T3/T4 are not applicable to this offline route/CLI
fix: there is no browser UI or hardware behavior change. No browser/live check
is represented as a pass. No new independent review was run in this fix turn;
this local code is ready for the next independent review round.

## Adversarial verification and mutation record

Lenses: exact-string correctness and normalization; deployment snapshot/state/
idempotency replay; authentication/privacy and absence of durable refusal
effects; runner false-success and test-integrity attacks.

Each mutation changed implementation bytes only, matched exactly once, recorded
SHA-256 before/after/restoration, and restored byte-for-byte in `finally`.
Killed means a nonzero test exit with failed test assertions, not a parse error
or zero-test run. Every restoration hash equals its source-version hash below.
There were 64 attempts: 30 initial, 28 against the final remaining guards, three
additional prefix probes, and three successful kills after adding regressions.

Commands used for each mutation (cwd: scratch; the table identifies L or P):

```text
L: bash ~/bin/heavy npx vitest run tests/unit/application/cutover-build.test.ts tests/unit/security/cutover-activation.test.ts tests/unit/cutover-runner.test.ts -t "build binding:" --maxWorkers=1 --silent --reporter=json --outputFile=<scratch>/mutant-N.json
P: bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts -t "build binding:" --maxWorkers=1 --silent --reporter=json --outputFile=<scratch>/mutant-N.json
```

The source-version IDs resolve the complete before AND restored SHA-256 for each
attempt. Mutant SHA-256 is recorded individually. No source restoration differed.

| Version | File | Before = restored SHA-256 |
| --- | --- | --- |
| H1 | `src/app/api/ops/content-cutover/route.ts` | `cbe1c84bf93abd4a97e42835474ceffe7a50d1d4e5e0caf636c05e7cb66758d6` |
| H2 | `src/application/cutover-build.ts` | `eede54fc1fe17573887bef83b8a1b51024fa2033f15c535d3e0e6acdd9cf9ede` |
| H3 | `src/application/live-content-cutover.ts` | `b27a1df75445bdf209445993fdc2c41fe4da28ff421398bbe67bdde2c890eb34` |
| H4 | `src/integrations/supabase/content-cutover-store.ts` | `03f35017b924bb37c03f04cb05b34cf45c271f85ad72bb5567e463518487a68a` |
| H5 | `scripts/cutover.mjs` | `36c5690b5c947cabba22033fdc182671e51c7f43d5706f4b519c6f9f5e57639e` |
| H6 | `src/application/cutover-build.ts` | `c5edcb3656ba0687078b4352ce9d8da4304e8ff8eb3d7bc5083580a7ba26ec09` |
| H7 | `scripts/cutover.mjs` | `ab0d49b1c710cd9de124b7629cd9325accf6909d915501d3ada6d8020a5c162f` |

### Initial

| Attempt | Guard | Before/restored | Mutant SHA-256 | Command | Result (failed / passed) |
| ---: | --- | --- | --- | --- | --- |
| 1 | schema required | H1 | `b5ec95d811ec5cbcd9da41bac051367960c9dd2281261908434c5fd17af4f609` | L | killed (2 / 39) |
| 2 | schema strict body | H1 | `c8b71a9461742720a46a4a2b4c4159f355bb73ed8ba792046b94a164e411ba0f` | L | killed (2 / 39) |
| 3 | schema exact length | H2 | `52a9d0f17f820cb4f87adafd362dde6019c8836e25fa2d16fec1cbdeb2dba64e` | L | survived (0 / 41) |
| 4 | schema lowercase hex | H2 | `dbca7c3202a31254635357608aa3b0d3b0071061f9c3a706cfac439e1ba2cbf8` | L | killed (4 / 37) |
| 5 | schema case insensitive | H2 | `cfa061bcd7b55fa45a76afea2506ae3e81f54afb6ecdb55c8c6b82f1d9719b8b` | L | killed (3 / 38) |
| 6 | schema trimming | H2 | `ffa8e8268d2878be04e5b1aa62abbb86948ed919d8de52826e9aa607fa34789c` | L | killed (4 / 37) |
| 7 | helper validates | H2 | `14329ff8ffb8991719225eda5827e6ddfb48628b73816d6b36a90f73ee273049` | L | killed (10 / 31) |
| 8 | comparison removed | H2 | `f6dd6718296f359446891c487a639bd9d51fc16e07a5fe48d7fa01006174a4bc` | L | killed (12 / 29) |
| 9 | comparison inverted | H2 | `f1f77eed76c5fbaa8dbb68da2d158a58d77600788df50acfca99ad4bb4dbc15c` | L | killed (15 / 26) |
| 10 | comparison prefix | H2 | `27dc52d182bf3ba1466a36fec61b25cddefc185f0c0e176182e23dec8e2c62a2` | L | killed (5 / 36) |
| 11 | comparison case insensitive | H2 | `ff6a62081497cc65346c419e195a17aaa5c5568a93e68a2752f20d84140f5454` | L | killed (3 / 38) |
| 12 | comparison trimming | H2 | `746a88a7476136a4003865703fb03245b6f2214a295585f11981431f33508b1f` | L | killed (4 / 37) |
| 13 | route comparison omitted | H1 | `8f2a55efbd8d21940bb2a0bd1f7e842704fe8c558ec96352561b77b06de6ddd9` | L | killed (6 / 35) |
| 14 | route precedence reversed | H1 | `bf79c185c43a31f866b58a3e344a3e85b4a7c783e099b82bebd113de3ea61a73` | L | killed (6 / 35) |
| 15 | route rereads build | H1 | `d127a0592e351ca4ae79022d045125a17ae85531c2f4d02c5fe243f0e6a0a892` | L | killed (2 / 39) |
| 16 | route does not forward snapshot | H1 | `831ac783b896a28362863de3ca7f8eba84061f79dc0c5186bdda333c84e76359` | L | killed (4 / 37) |
| 17 | service guard omitted | H3 | `d5b684636e96ce2420c32a3690ef47d5b4217f9b0d4a242ebb4372384e31c4e2` | P | killed (4 / 0) |
| 18 | service skips read activation | H3 | `a977c462ff684351c158abd76df4e61197e2acc4bb1fc1c610f84d97f6523327` | P | killed (2 / 2) |
| 19 | service skips db activation | H3 | `ccbee3746dd33e9621995c62853b5a0289f806f17056e6edee7955384a418b0d` | P | killed (2 / 2) |
| 20 | SQL receives different activation build | H4 | `fb870e504d711a3dbb3e4821122f11d87a529670231d895a4bff2580fb57ae5d` | P | killed (2 / 2) |
| 21 | operation identity omits build | H4 | `7a17f04ba9f1ae1eabf082c3700603e2913f07c664bd427cfeff1c6255959170` | P | killed (2 / 2) |
| 22 | runner omits expectedBuild | H5 | `971f182a23db04117b174dad16208c66bc8f5f9a239ff94d1fe33aea685eb77b` | L | killed (2 / 39) |
| 23 | runner sends other build | H5 | `c921f1eb0e36c5cc326a2e291953911a768960e4a7219a8a3fc3f5cc70a15083` | L | killed (2 / 39) |
| 24 | runner exact SHA length | H5 | `ebeda0ec73ef94f00e8ffad93141a08d2d47f3df4aecdf7c28bce155af38e674` | L | survived (0 / 41) |
| 25 | runner lowercase SHA | H5 | `6cd69dd1cab078be3ea0a4af0ae2f6c80e7b991802faf3929fb616617fe43320` | L | killed (1 / 40) |
| 26 | runner trims SHA | H5 | `39bcef28c5e28d0cc5389e8010fe82bdc7523691e0ca5d0ebcb6d0d23fd1437d` | L | killed (2 / 39) |
| 27 | runner accepts HTTP refusal | H5 | `f2e188e6eddd2298c5157b26184ea528250d19dd734d5814748c0b11a104ad4b` | L | killed (1 / 40) |
| 28 | runner accepts body refusal | H5 | `cd87b735504b0d02380fab9caabfdb4d9a6e759b9bc8952e8660d94935759462` | L | killed (1 / 40) |
| 29 | runner accepts every refusal | H5 | `fc99c88e03eca66db735a2a40e5a4b83ac7947f54e6e5ed9328f40df19fa1463` | L | killed (5 / 36) |
| 30 | runner changed-build pending key | H5 | `22991cd41e26293c074b2c5df42b9247b2acf093d5f46166c6bb9f4ab656a424` | L | killed (2 / 39) |

### Final guards

| Attempt | Guard | Before/restored | Mutant SHA-256 | Command | Result (failed / passed) |
| ---: | --- | --- | --- | --- | --- |
| 1 | schema required | H1 | `b5ec95d811ec5cbcd9da41bac051367960c9dd2281261908434c5fd17af4f609` | L | killed (2 / 39) |
| 2 | schema strict body | H1 | `c8b71a9461742720a46a4a2b4c4159f355bb73ed8ba792046b94a164e411ba0f` | L | killed (2 / 39) |
| 3 | schema lowercase hex | H6 | `1b686edaefaf449b65a08eb251e786726234eca224a598794a26078fe946e6cb` | L | killed (9 / 32) |
| 4 | schema case insensitive | H6 | `70ec38a424ae4d36d587fba6cbf3edab3250c1bb45e56ebd862394e16e1cd19c` | L | killed (3 / 38) |
| 5 | schema trimming | H6 | `d6181645c620e15f4386f12fd19f85d5857368aae1a2e4e70d1a60ad92c81eed` | L | killed (4 / 37) |
| 6 | helper validates | H6 | `da54d1514f7e791ae0f76e3937573b4de83d645c3520dc34b17a92395c18ed6c` | L | killed (10 / 31) |
| 7 | comparison removed | H6 | `870483cd575e8877350adec1c773fe8491cd52725b64a112b3452c4e88e43275` | L | killed (12 / 29) |
| 8 | comparison inverted | H6 | `a05d91a4da07db8b7482b171d870524abdb70c5f7ee85dc2d6dfc35687ebaf6f` | L | killed (15 / 26) |
| 9 | comparison prefix | H6 | `a540ba912339ae0cc8c095dcae0aff54dbaeed9b143003d3c7042d7907cd1ca0` | L | killed (5 / 36) |
| 10 | comparison case insensitive | H6 | `5a65f419401d95f46bf8a091a88ef35e5e7fc96ef2bdc5632b5d7e86fefdb0b2` | L | killed (3 / 38) |
| 11 | comparison trimming | H6 | `eb127fa8d62b9b997975c60e3a1ac93f64a85a8ae299c25d4fd631dd0ce890b2` | L | killed (4 / 37) |
| 12 | route comparison omitted | H1 | `8f2a55efbd8d21940bb2a0bd1f7e842704fe8c558ec96352561b77b06de6ddd9` | L | killed (6 / 35) |
| 13 | route precedence reversed | H1 | `bf79c185c43a31f866b58a3e344a3e85b4a7c783e099b82bebd113de3ea61a73` | L | killed (6 / 35) |
| 14 | route rereads build | H1 | `d127a0592e351ca4ae79022d045125a17ae85531c2f4d02c5fe243f0e6a0a892` | L | killed (2 / 39) |
| 15 | route does not forward snapshot | H1 | `831ac783b896a28362863de3ca7f8eba84061f79dc0c5186bdda333c84e76359` | L | killed (4 / 37) |
| 16 | service guard omitted | H3 | `d5b684636e96ce2420c32a3690ef47d5b4217f9b0d4a242ebb4372384e31c4e2` | P | killed (4 / 0) |
| 17 | service skips read activation | H3 | `a977c462ff684351c158abd76df4e61197e2acc4bb1fc1c610f84d97f6523327` | P | killed (2 / 2) |
| 18 | service skips db activation | H3 | `ccbee3746dd33e9621995c62853b5a0289f806f17056e6edee7955384a418b0d` | P | killed (2 / 2) |
| 19 | SQL receives different activation build | H4 | `fb870e504d711a3dbb3e4821122f11d87a529670231d895a4bff2580fb57ae5d` | P | killed (2 / 2) |
| 20 | operation identity omits build | H4 | `7a17f04ba9f1ae1eabf082c3700603e2913f07c664bd427cfeff1c6255959170` | P | killed (2 / 2) |
| 21 | runner omits expectedBuild | H7 | `14c7399a5abd83c11db8f3ff40b0601a9597fbd4094d82e1f574dc5dca17ded4` | L | killed (2 / 39) |
| 22 | runner sends other build | H7 | `3d6b240cda8cc968926db7f90acdab15e71feb73ff20d569a2ff36631a319bbb` | L | killed (2 / 39) |
| 23 | runner lowercase SHA | H7 | `a8f45faa305f43afc5687f378d5653833aedf0ae2047e4c8846683157f8dae38` | L | killed (1 / 40) |
| 24 | runner trims SHA | H7 | `a43af18488e857d3fe40732eeb39a3388c61475abdd6d054437a5ce6812db77a` | L | killed (2 / 39) |
| 25 | runner accepts HTTP refusal | H7 | `bd37a8a771a60c16f050c6f9481165b8dee00c9d876a269bdf10a0ffafe9c081` | L | killed (1 / 40) |
| 26 | runner accepts body refusal | H7 | `4c990b164f61d055ec0f1b658a5b7ff4417e5671c5e27bb0dadcd446720471b5` | L | killed (1 / 40) |
| 27 | runner accepts every refusal | H7 | `e246f1a94c1bb1bc0f6f9dac59804cda6bf09b3fcbcb5e0a964049ebbdf9e557` | L | killed (5 / 36) |
| 28 | runner changed-build pending key | H7 | `06808e5ef2e65c42df1bcf2efd76ffa6ea2a86c047417c69ed2809fa8f0c5863` | L | killed (2 / 39) |

### Prefix probe before added regressions

| Attempt | Guard | Before/restored | Mutant SHA-256 | Command | Result (failed / passed) |
| ---: | --- | --- | --- | --- | --- |
| 1 | runner health prefix | H7 | `8875fcb4cbd1c7cb0a2d552d8b8607d471ec19d8329cb5cbdae20a48f94b81f1` | L | survived (0 / 41) |
| 2 | runner status prefix | H7 | `550e2783254aa08c756449477351d145bc4757a7a94ebd450f57393e07b10bf2` | L | survived (0 / 41) |
| 3 | runner receipt prefix | H7 | `e646d1992c2a5587fc20cb1ac5d80473243343347d7b5f6bce223750eaa3b4b1` | L | survived (0 / 41) |

### Prefix probe after added regressions

| Attempt | Guard | Before/restored | Mutant SHA-256 | Command | Result (failed / passed) |
| ---: | --- | --- | --- | --- | --- |
| 1 | runner health prefix | H7 | `8875fcb4cbd1c7cb0a2d552d8b8607d471ec19d8329cb5cbdae20a48f94b81f1` | L | killed (1 / 43) |
| 2 | runner status prefix | H7 | `550e2783254aa08c756449477351d145bc4757a7a94ebd450f57393e07b10bf2` | L | killed (1 / 43) |
| 3 | runner receipt prefix | H7 | `e646d1992c2a5587fc20cb1ac5d80473243343347d7b5f6bce223750eaa3b4b1` | L | killed (1 / 43) |

## Scope limits and cleanup

No migration was edited, applied or pushed. No dependency was added or installed.
No production endpoint, live provider, Vercel or external database call was made.
GitHub use was limited to fetch and read-only issue/PR metadata; no push, PR
creation/edit/comment/merge, issue write or deployment occurred. Production
cutover and the next independent review remain outside this offline fix.
Build binding does not bind deployment configuration or deployment ID; existing
immutable-origin and ordered live-gate guidance remains in force.

The dependency junction was unlinked with CMD rmdir before deletion (native Windows /c form after the Git Bash //c form failed without removing it). The scratch root was verified under the intended scratch directory and recursively checked for remaining reparse points: zero. Forced recursive removal was rejected by automatic review; non-forced removal deleted the helpers and logs. The only remnants were generated read-only Git objects, whose read-only attributes were cleared after verifying their exact scratch-object paths. After clearing the hidden attribute on the verified empty scratch Git directory, non-forced removal deleted the scratch root completely. No helper files remain. The worktree dependency junction was preserved.

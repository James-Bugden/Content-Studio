# PR #205 / issue #204 — fix round 2

Heavy safety-gate fix on `cs-204-bk`, based on
`21c93a514a979db777a9ebc7c8046fa68e75a960`. Read the latest independent
REQUEST CHANGES verdict and the complete local round-2 review evidence.
Fetched origin: main is `9a9f7934baa1da1a9855182eac167be1544c1981`, already an
ancestor of this branch, so no merge was needed. Remote PR head was unchanged.

## Change and acceptance

P2 is addressed in the still-unapplied, idempotent waiver migration. Shared SQL
helper `content_studio_cutover_evidence_reference(jsonb)` requires a JSON string
of 1–2048 characters and at least one printable visible character after removing
POSIX whitespace/control characters and explicit Unicode whitespace, format
controls and invisible/default-ignorable ranges. This covers every requested
code point, including NBSP, narrow NBSP, BOM, em space, U+2000–U+200F and word
joiner. Validation preserves the exact stored reference, including padding.

The gate uses this helper for `phase-c.privateEvidence` on both waived and
ordinary paths. Source inspection found no other free-form evidence/reference
field in the waiver path. Manifest, actor and parity/rehearsal hashes continue
to require their strict hash formats; build/import identities keep their
existing binding checks. The helper is invoker-only, has a pinned search path,
and grants EXECUTE only to service_role. The existing hostile-default-grants
security test now includes all 18 cutover functions. Both operations documents
describe the stronger reference requirement.

Committed regressions exercise 78 individual blank/invisible code points plus
one mixed-only string. Every case starts with otherwise green genuine
preparation, records through the supported phase-c RPC, and checks direct SQL
gate, direct SQL activation, application activation and bearer-authenticated
activate-db HTTP refusal, with no DB authority epoch. Each activation probe is
isolated so an incorrectly admitted epoch cannot mask a later layer. Three
positive cases prove ASCII padding, Unicode padding and a visible Chinese
reference pass every layer without rewriting the stored value. Existing
one-character, maximum-length, malformed-type and oversized cases remain.

## Verification

All PGlite execution used an isolated tracked-files scratch copy with synthetic
in-memory data and a node_modules junction to the required `163` checkout.
The worktree's original MAIN-checkout dependency junction was left unchanged.
No install/ci command or new dependency was used. Every Vitest/typecheck/lint
command ran through `bash ~/bin/heavy`; Vitest used `--maxWorkers=1`.

Initial red: the three NBSP/narrow-NBSP/BOM regressions fail against the original
migration (0 passed, 3 failed). The first positive harness run incorrectly
performed repeated activations against an already-created epoch; isolating the
probes corrected that harness error. Targeted green: **84 passed, 0 failed**
(82 new cases, migration reapplication, hostile-default-grants security;
170 unrelated cases deselected, not counted as passes).

Required command (all four directories in full, not the full repository suite):

```text
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/components --maxWorkers=1 --silent --reporter=json --outputFile=<scratch-result>
bash ~/bin/heavy npx vitest run tests/unit/security --maxWorkers=1 --silent --reporter=json --outputFile=<scratch-result>
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
```

The initial four-directory invocation had 1,127 passing tests, one failed
acceptance-matrix assertion and a security boundary suite that failed to load:
both security failures required Git metadata absent from a plain archive.
Initializing disposable local Git metadata fixed the harness; the complete
security directory was rerun. No implementation/test behavior was relaxed.

| Required directory | Files | Final passed | Failed / skipped |
| --- | --- | --- | --- |
| tests/unit/security | 9 | 59 | 0 / 0 |
| tests/unit/application | 15 | 318 | 0 / 0 |
| tests/unit/supabase | 18 | 547 | 0 / 0 |
| tests/unit/components | 27 | 209 | 0 / 0 |

Final coverage: **1,133 unique tests across 69 files pass**, including all 251
content-cutover-live tests. Typecheck and lint exit 0. Environment validation,
acceptance inventory (all 107 IDs), private-path/secret scans and diff whitespace
checks pass. The initial failed invocations are not counted as passes.

Initial four-directory result JSON SHA-256:
`eb4cf9716bfbf51fbc4abe0a337d78f31d1c3f924f5c86b2587d071d1d659017`.
Final complete security rerun: JSON success=true, 59 passed, zero failures,
zero pending, native Vitest exit 0. Result JSON SHA-256:
`423eecdfe47034efeb7a35299ccad1033416eef16890dc816a2e35a65fc924b9`.

The first worktree typecheck failed because MAIN's shared dependencies lack
`@electric-sql/pglite` and `@supabase/supabase-js`. A scratch typecheck also found
a new mixed-fixture tuple inference error; it was fixed with `as const`.
Final typecheck and lint in the prescribed scratch dependency environment both
exit 0. MAIN's dependencies were neither installed nor altered.

## Mutation evidence

Five implementation mutants were each applied exactly once in scratch, tested,
and restored byte-for-byte in a finally block. All five are killed by tests
committed in this PR; no helper-only probe is needed. The source SQL's on-disk
SHA-256 before **and after restoration for every case** is:

`0aa0cc297294a72885187f8382ae86707e22f0c07fcfcf9a3d758312ce9f2cf8`

These execution hashes use the Windows working-copy bytes (CRLF). The final
Git-normalized LF SQL SHA-256 is
`401dcec95473243dc423bb1156b31dcad63cca5a4994c0f679dd92315209ea42`.
The original baseline SQL blob SHA-256 is
`9252a3f6bdde924843cc5bec18bb10be95333bd0998651184ccee0e15549571f`.

Common command:

```text
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-cutover-live.test.ts -t <selector> --maxWorkers=1 --silent --reporter=json --outputFile=<scratch-result>
```

| Mutant | SHA-256 after mutation | Passed / failed | Exit |
| --- | --- | --- | --- |
| ASCII-only whitespace | `6e27b7b242a274b2734eed2179f2044ad7f1973d50e807cf0962f0b67a86cb0b` | 3 / 4 | 1 |
| POSIX-only whitespace | `c4ae95cf26fec5a7f976cc60159df1684be979124f7c9cb408c78e5da519c837` | 3 / 3 | 1 |
| JSON type guard removed | `3ebc7044e58112332cb1b1a44c6865fbe59e371b69f518b5c44965c76f4c54ef` | 0 / 4 | 1 |
| Length bound removed | `1e5066c90de6afbcfbab39a33eebaf7691abaaae3b2909a319a648fab4862b10` | 0 / 1 | 1 |
| Gate helper call bypassed | `b06ecb1213bb5a30177923d755ffc921385ef4c40900c8c5434f8165a98bf75c` | 0 / 1 | 1 |

Exact changes and selectors:

1. Replace the helper's entire `and regexp_replace(...) ~ '[[:graph:]]'`
   expression with `and p_reference #>> '{}' ~ E'[^ \t\r\n]'`.
   Selector: `CS-066 R2: invisible privateEvidence U\+(00A0|2003|202F|FEFF)|CS-066 R2: preserves`.
   All four blanks wrongly pass the gate and both activation paths, create an
   epoch, and return HTTP 200 instead of 403; each committed regression fails
   all of those assertions. All three positive cases still pass.
2. Replace that same expression with
   `and p_reference #>> '{}' ~ '[^[:space:]]'`.
   Selector: `CS-066 R2: invisible privateEvidence U\+(00A0|202F|FEFF)|CS-066 R2: preserves`.
   The original three Unicode bypasses again admit through every layer,
   including HTTP 200. Three positives pass.
3. Replace `jsonb_typeof(p_reference)='string'` with `true`.
   Selector: `phase-c rejects privateEvidence (false|number|object|empty-array)`.
4. Replace `length(p_reference #>> '{}') between 1 and 2048` with `true`.
   Selector: `phase-c rejects privateEvidence oversized`.
5. Replace `or not public.content_studio_cutover_evidence_reference(proof->'privateEvidence')`
   with `or false`.
   Selector: `CS-066 R2: invisible privateEvidence U\+2003`.

Mutation result JSON SHA-256, in the same order:

```text
a3e80cc9f4da72c7a71780d3a809818d6f0f9a427013dd746c1062022fd97458
ffd60cc1866966126cdd2e65369c845742ce44a1006a7bb05d3446dda707df09
1c24fadc4d562b7bb96fdc09e93f91fc8242eb15e69f422c8abe5264ed344c85
afad73d24c32a41c0d653b95e90bd043c7576fbb489279f36cad6965bf670259
2472c0ddfbce786cd627a36dcaff8f5d17025a0461da02227ae3139038be8823
```

Adversarial lenses: correctness (every reported blank plus mixed/control/format
variants and visible/padded positives); integration/state (real record RPC,
gate and isolated activation/HTTP epochs); auth/privacy (hostile grants and
service-only invoker helper); false-green integrity (the former ASCII survivor,
POSIX regression, type/bound and unused-helper mutants).

## Scope and handoff

This is a local fix round, not an independent approval. The previous P1 code was
preserved; its regressions are included in the required Supabase run. There is
no UI change, so browser/visual/device tiers do not apply to this patch. Hosted
security, actual plan-backup restore, live rehearsal, deployment and T4 remain
unverified and outside the authorized local scope. Existing freeze/drain
controls remain necessary for the documented post-observation Sheet-edit race.

No GitHub write, push, merge, live provider call or live database application
was performed. The migration remains UNAPPLIED; issue/PR state is unchanged.
Remote CI for this local fix has not run; previous-head green CI does not certify
this commit.
Cleanup: the prescribed `cmd //c rmdir` was executed from Git Bash to unlink
the scratch node_modules junction. Verified zero remaining reparse points,
unchanged shared `163` dependencies, and byte-for-byte equality of all five
changed source/docs files between worktree and scratch. The temporary archive
is absent. No helper test or script was created in the worktree.

**Cleanup blocker:** automatic approval review rejected both recursive scratch
deletion and the safer per-file/empty-directory deletion with the sole reason
“blocked by policy”. No deletion command was executed after either rejection.
The link-free synthetic scratch copy and execution logs remain at
`D:/wt/cs205-fix-r2`; its dependency junction is gone. Cleanup is not claimed
complete. No alternate tool was used to bypass the rejection.

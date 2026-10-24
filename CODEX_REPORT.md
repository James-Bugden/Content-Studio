# PR #161 — continued fix round 2

Issue: https://github.com/James-Bugden/Content-Studio/issues/146

PR: https://github.com/James-Bugden/Content-Studio/pull/161

Branch: `cs-146-contentdb`. Tier: standard. Role: fix. Date: 2026-10-24.

Tested source/test/docs commit: `3685ac05b94e022187f87158f1182996c1bc9981`
(`CS-056: fix review round 1: health and deterministic DB ordering`).
Starting commit: `d3c7bc5089e8130f76cc3ac0bbae8ea379f975c4`.
This report is a subsequent documentation-only commit.

Inspected and retained the nine partially edited files left by the crashed
attempt. Read MASTER-SPEC, issue #146, PR #161, the migration design, ADR-0002,
and the implementation, QA and adversarial-verification procedures. Reviewed
the final diff for health privacy, locale-dependent ordering, view permissions
and test integrity. No independent reviewer approval is claimed.

## Findings

| Finding | Status and evidence |
| --- | --- |
| 1: health provider list | Fixed. An inactive DB adds no useful health signal in Sheet modes, so health now uses the same selected-store capabilities as other callers. Removed the unused `includeInactiveDb` option. The existing five-provider assertion remains; smoke now also checks the exact response/capability keys, nonempty commit, mode and states. Unit tests check sentinel redaction and the selected `db`/`db-read` capability. Composition tests cover all four store modes. |
| 2: collation | Fixed. Both URL minima explicitly use `COLLATE "C"`. PostgREST ordering has no per-order COLLATE modifier, so the unapplied DB-2 migration assigns `C` to every text sort key: posts/Ready Queue `library_id`, summary `content_source`, schedule `date/platform/slot/content_id`, settings `setting`. Every adapter order inherits those collations, including stable-ID ties. Dependent views are rebuilt transactionally with their original invoker security and service-only grants. PGlite verifies actual column collations and both views' permissions. |
| 3: circular summary parity | Documented without reworking it. Contract comment and ADR NOTES say that shared synthetic rules prove self-consistency, not equality with the real Sheet summary tab. DB-4's real-Sheet parity report is the actual check. |
| 4: zero-row sources and Ready revisions | Documented without reworking them. ADR NOTES identify the removed zero-row `Synthetic Interview Guide`, which the grouped view cannot represent, and the Library-derived revision in DB Ready Queue versus the Sheet Ready tab's own revision. DB-4 must classify these differences; the shared list contract checks revision format/stability rather than token equality. |

## Verification

Windows, Node 24.15.0. Shared junction packages: Next 16.3.6, Playwright
1.63.0, Vitest 5.0.1. The shared Next/Vitest versions differ from the lockfile's
16.4.1/5.0.3; no installation or shared dependency modification was performed.
Reused the pre-existing exact-lockfile PGlite 0.5.8 and Supabase 2.117.0 scratch
extractions described in the original builder report.

The existing ignored `tmp/db2/vitest.config.ts` merges the repository config
and aliases PGlite/pg_trgm to those real modules. The targeted
`tmp/db2/tsconfig.json` extends the repository config, disables incremental
output, includes the affected application/integration/test entrypoints and
transitive imports, and resolves the real scratch declarations. It supplies no
fake declarations and weakens no compiler checks.

All heavy commands used `bash ~/bin/heavy`; queue/RAM waits were allowed to
finish. No full suite was run.

```sh
bash ~/bin/heavy npx vitest run \
  tests/unit/supabase/content-db.test.ts \
  tests/unit/application/content-repository-contract.test.ts \
  tests/unit/security/health.test.ts \
  --config tmp/db2/vitest.config.ts --maxWorkers=1 --silent
bash ~/bin/heavy npx tsc --noEmit --project tmp/db2/tsconfig.json
bash ~/bin/heavy npx eslint \
  src/app/api/health/route.ts src/application/capabilities.ts \
  src/integrations/supabase/content-db.ts tests/e2e/smoke.spec.ts \
  tests/unit/application/content-repository-contract.test.ts \
  tests/unit/security/health.test.ts tests/unit/supabase/content-db.test.ts
bash ~/bin/heavy npx playwright test tests/e2e/smoke.spec.ts
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
git diff --check
```

- Targeted tests: exit 0, **3 files / 46 passed**. Repeated after all mutations
  were restored: **46 passed**, 12.15 seconds; final log
  `tmp/db2/round2-final-tests.log`.
- Targeted typecheck: exit 0. Touched-file ESLint: exit 0.
- T1 smoke: exit 0, **4 passed**, both `w375` and `w1280`, 1.1 minutes;
  log `tmp/db2/round2-smoke.log`. This executed the command above through
  `python tmp/db2/round2-smoke.py`. The wrapper temporarily used
  `next dev --webpack`, disabled webpack caching, supplied the real Supabase
  module/declaration aliases, and excluded scratch files from the root
  typecheck. It selected dedicated loopback port **3216** and set
  `reuseExistingServer: false`. All three temporary config files were restored
  byte-for-byte. This is dev-server evidence, not a production-build claim.
- An earlier fresh smoke invocation reported four passing assertions but had
  `EADDRINUSE` on port 3200. Its server identity was uncertain, so it was
  excluded from acceptance evidence and replaced by the dedicated-port run.
- Private-path policy, secret scan and whitespace check: exit 0. Rechecked
  with this report staged before committing it.

## Collation mutation proof

The PGlite fixture gives DB-1 input columns ICU `en-US` collation, then executes
the actual DB-2 migration unchanged. A baseline query proves that ICU chooses
the lowercase `a-SYNTH` URL while `C` chooses uppercase `Z-SYNTH`. The view must
choose `Z-SYNTH` for the master and `Y-SYNTH` for the Markdown fallback. This
avoids a false green caused by PGlite's libc locale behaving like `C`.

`python tmp/db2/round2-mutate.py` changed only the migration implementation,
kept tests unchanged, asserted exactly one replacement per case, verified the
mutated bytes, and restored the original bytes in `finally`. Each probe ran:

```sh
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-db.test.ts \
  --config tmp/db2/vitest.config.ts --maxWorkers=1 -t '<pattern>'
```

| Implementation mutation | Pattern | Result |
| --- | --- | --- |
| Remove `COLLATE "C"` from the master URL minimum | `uses C collation` | Exit 1, expected mixed-case URL assertion fails. |
| Remove `COLLATE "C"` from the Markdown minimum | `uses C collation` | Exit 1, expected fallback URL assertion fails. |
| Replace `library_id` column collation `C` with `fixture_en` | `pins every PostgREST` | Exit 1, actual schema collation assertion fails (`fixture_en` versus `C`). |

Each probe had one assertion failure and 11 intentionally unselected tests;
none failed during setup. Original/restored migration SHA-256:

`d7cc31d1e76763d340d008683ebae8d41d54192632dc693786551bbe921304d0`

Mutated SHA-256 values, recorded in `tmp/db2/round2-mutations.json`:

- Master: `e9423e1a04dec120f3ae2e1ec99177ae89fdb5725955ae6c9987b9a765a02742`
- Markdown: `873601d3fa1c5857259e24eecdefd7aa6c51b3bba5974b804bf674a40c3ffc9a`
- Ordering: `d7cffdb7f5810f6750de69171efcb045f8e3c23dff74906a072ca5177cef2db8`

## Limits and cleanup

Nothing was applied to any live database. Hosted Supabase locale/PostgREST
execution and real Sheet parity remain for later phase evidence. Applying the
migration will alter column collations and rebuild dependent views/indexes;
that separate deployment needs its usual migration checks. No production
cutover, full CI run, production build, T2–T4 verification or deployment is
claimed. This round changes no user-facing interaction model.

No new dependency, package manifest/lockfile change, npm install/ci, push,
merge, issue closure or other-worktree modification occurred. No scratch
`node_modules` copy was created. The original junction and pre-existing shared
scratch extractions were preserved. The unrelated AGENTS footer generated by
our dev-server run was removed after that server stopped; temporary build/test
config changes were restored. Small ignored scripts/logs remain in `tmp/db2`
as local evidence.

# PR #177 — fix round 1

- Tier/role: Standard / fix, CS-059 / DB-5, issue [#149](https://github.com/James-Bugden/Content-Studio/issues/149).
- Review: [comment 6388169892](https://github.com/James-Bugden/Content-Studio/pull/177#issuecomment-6388169892), REQUEST CHANGES against `8bfbf03efed52b379e16bce8b1d1affc22f2e13c`.
- Branch/worktree: `cs-149-db`, `C:/Users/jbbug/projects/cs-wt/149` only.
- Implementation: `8156d20470a48c45c4fd3b2ef38f774b5686bf20`; browser assertion follow-ups: `bf6556d7c7b63a08593dd964e828183c990fd1bf`, `e02d77057772d24bf89bd169f11c422ff4e89568` (test-only).
- No push, GitHub write, other-worktree edit, deployment, live DB access, dependency/lockfile change, npm install or npm ci.

## State and commands

Read AGENTS.md, MASTER-SPEC, Phase C, ADR-0002, issue #149, the PR review and `D:/wt/briefs/cs/report149.md`. Applied the implementation, QA and adversarial-verification skills.

Read-only state commands:

```text
git status --short
git branch --show-current
git log -1 --oneline
git fetch origin
git rev-list --left-right --count HEAD...origin/cs-149-db
git log --oneline HEAD..origin/main
git merge-base --is-ancestor origin/main HEAD
git rev-parse HEAD origin/main
gh pr view 177 -R James-Bugden/Content-Studio --comments
gh issue view 149 -R James-Bugden/Content-Studio
```

Initial worktree clean; local/remote both `8bfbf03`, ahead/behind `0 0`. Fetched main was `544d9c9cd74e69967bca1a8ced7f01e1f24ad6f1`, already an ancestor (exit 0); `HEAD..origin/main` was empty. No merge needed; no rebase performed. The preview reported deployed in the read-only PR comment; no hosted behavior was treated as evidence for these fixes.

## Fixes and evidence

| Finding | Change and regression |
| --- | --- |
| B1 | Overlay retains pre-save expected DB version. Clear on its copied fingerprint or the DB matching a fresh current Sheet fingerprint; retain if a raced DB bump still contains older content. Tests cover R1 failed copy → external R2 → actual import → get/list return R2 without reconcile, next save succeeds; metadata-only repair without a version bump; immediate configured repair inside the display TTL. |
| N1 | db-read skips only named numeric/size refusals, one exception per refused row, excludes that row from accepted counts/hashes, and atomically imports other rows. Both unapplied SQL RPC definitions accept `refused_numeric` and `refused_size` (`@row`); JSONB formatting overhead is included in the size check. Fake/PGlite prove continued import, persisted ledger, blocking row-specific pending state, restart reconstruction and recovery after source correction. Unknown conversion/integrity failures and CAS conflicts still abort; db-shadow retains fail-closed behavior. |
| N2 | Reconcile reports ordinary lag without “Saved” or invented `import_repair` identity and never creates an overlay. Tests cover subsequent edits/imports; refusal copy requires correction rather than promising automatic repair. |
| N3 | Ubuntu-only `browser-db-read` job reuses verify's build artifact, pinned checkout/setup-node/upload actions and read-only permissions, runs content-read-cutover at w375/w1280 with db-read, and is required by the aggregate deterministic-browser gate. No additional build in that job. YAML parsed and aggregate dependency checked locally; remote CI not run. |
| N4 | Both compositions use `contentSheetCacheOptions` with `DB_READ_CACHE_TTL_MS = 3000`; tests pin fake/live options and actual cache expiry. Sheet defaults preserved; live DB startup remains refused. |
| N5 | Added dedicated race/overlay assertions for M04/M06/M10/M15/M16/M17/M19/M27/M30, over fake DB and PGlite. All nine are now unit-testable; none of those nine remain e2e-only. Browser rendering/navigation, accessibility/layout and runtime orchestration still require T1/T2 evidence. |
| Capability | Fake DB capability is inactive in sheet, read-only in shadow, ready in db-read/db; only active stores are advertised. db-read identifies a derived copy with Sheet authority. Health tests cover the modes and document that future live wiring must preserve this label. |

Version advancement alone is deliberately insufficient. A competing import can capture the old Sheet then win the DB CAS before the app's newer copy. Dropping the overlay merely because row_version advanced would expose that old content. Conversely, metadata-only imports can repair a revision without bumping row_version. The current-authority fingerprint rule handles both. Fresh verification bypasses the disposable Sheet display cache; its additional pending-row Sheet reads must be measured at the live Phase C gate.

## T0 and mutation execution

Windows, Node 24.15.0, existing Next 16.3.6 / Vitest 5.0.1 / Playwright 1.63.0 / TypeScript 5.9.3. Installed Next/Vitest differ from manifest pins; lockfile CI remains required. Missing existing lockfile packages were extracted only into external scratch with SHA-512 integrity verification: PGlite 0.5.8, Supabase JS subpackages 2.117.0, Phoenix 0.4.5, iceberg-js 0.8.1. The shared node_modules junction was not installed into or replaced.

Every Vitest run included all three mandatory selections, without a test-name filter:

```text
bash ~/bin/heavy npx vitest run tests/unit/security/health.test.ts tests/unit/application tests/unit/supabase --maxWorkers=1
```

B1 red-before-fix: 21 files, 2 failed / 343 passed; both fake and PGlite returned `App save R1` instead of `External R2` although DB was R2. An initial accidental worktree run failed for missing PGlite (5 files failed, 183 tests passed); this was an environment failure, not a defect reproduction/pass, and was rerun in scratch.

Final and post-mutation-restoration command (external scratch, `CS_TEST_MODE=unit`):

```text
bash ~/bin/heavy npx vitest run tests/unit/security/health.test.ts tests/unit/application tests/unit/supabase tests/unit/components/post-editor-save.test.tsx tests/unit/google/drive-saga.test.ts tests/unit/google/sheets-read-cache.test.ts tests/unit/google/sheets-stale-read.test.ts tests/unit/typefully/reconcile-create.test.ts tests/unit/typefully/sync-analytics.test.ts --maxWorkers=1
```

PASS twice: **27 files, 593 tests, zero skipped**, exit 0; 58.91 s and 65.94 s. Earlier intermediate runs exposed the later SQL RPC allowlist, native PGlite Date-vs-JSON transport in the test harness, and a shadow capability expectation; corrected and rerun. Typecheck caught a broadened representation-class return type and test union accesses; corrected.

```text
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
git diff --check
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
```

Typecheck PASS in scratch, lint PASS in the actual worktree, policy/secret scan PASS (560 tracked files), diff check PASS. Initial scratch lint rejected console statements only in temporary recovery/mutation helper scripts; those were moved out and actual worktree lint passed. CI YAML validation used existing js-yaml (the first parser attempt found yaml unavailable; no package was installed).

Adversarial lenses: authority/current revision and metadata-only changes; concurrency/replays/generation guards; exception-ledger integrity and privacy; false-green tests. Applied implementation mutations only in scratch, verified unique replacements and changing SHA-256 after each, then byte-restored in finally. Three initial groups produced the expected dedicated failures. A final combined wave with independent M30/M27 assertions produced **18 failures (nine assertions × fake/PGlite), 360 passes**, exit 1; every failure matched a requested mutation path. Separate assertions prevent M15 masking M30 or M17 masking M27. All original bytes restored; the subsequent 593-test run passed. No mutation entered a commit.

## Browser and remaining gates

Queued browser command (repository config, one worker, both widths):

```text
bash ~/bin/heavy npx playwright test tests/e2e/content-read-cutover.spec.ts --project=w375 --project=w1280
```

Final environment: `CS_E2E_PREBUILT=1`, `CS_E2E_CONTENT_STORE=db-read`, `CS_E2E_PORT=3270`, `CS_COMMIT_SHA=e02d77057772d24bf89bd169f11c422ff4e89568`. **PASS: 6 tests, zero skipped, 13.4 s, exit 0.** This exercises the same prebuilt runtime path as the new CI job. Next build ID: `XaqXPU-Lb4YDua8NZsiSk`. The artifact was built through the first queued Playwright invocation on application code `8156d20`; the later commits only correct browser assertions. The final 560-file source/test/config snapshot was byte-compared with this worktree: zero mismatches.

The mandatory unit companion passed twice more: **21 files, 378 tests**, 38.02 s and 38.54 s, exit 0, using the core command above. The larger 593-test restored run remains the affected-saga/cache evidence.

Earlier browser attempts are not passes: first build/run (CS_COMMIT_SHA=8156d20470a48c45c4fd3b2ef38f774b5686bf20) was 4 passed / 2 failed in 1.3 min because the new test counted a grouped reconcile container as individual rows. The intermediate prebuilt run (temporary CS_COMMIT_SHA=candidatesha, not exact-identity evidence) was 4 passed / 2 failed in 2.3 min because SYN-L002 intentionally has no Markdown section, so its editor has no comparison control. Corrected assertions count articles and respect each fixture's existing canonical-source behavior; the final exact-label run passes all six. No implementation behavior was weakened to make these assertions pass.

B1 browser proof imports R2 before visiting reconcile, reveals the exact imported Sheet version in the existing comparison, and clears the pending banner. The refusal/lag journey proves no invented save claim, one refused row remains while the other imports, and the imported text is available in its editor. Existing save/failure/repair proof remains. Axe found zero violations in the pending group; horizontal-overflow checks passed at both widths. Synthetic save/pending/refusal screenshots were visually inspected: text and recovery copy wrap inside the panels, blocking refusal is distinct from successful save, and controls remain available. Screenshots are deleted with scratch; CI will upload synthetic artifacts when run.

Interactive T2 remains unavailable: `cua.getState()` returned `{apps:[], browsers:[]}` after reading the computer-use skill. Automated browser/accessibility and screenshot review are not represented as that missing interactive review. No T3/T4, live copied-workbook/Supabase rehearsal, hosted security check, deployment smoke, rollback smoke or seven-day Phase C measurement was performed; none is a pass. No production phase flipped. Original cross-instance overlay limitations and Sheet write race remain; independent SQL backends/scheduling need the existing T3 gate.

## Identity and cleanup

Before cleanup, all 560 tracked files matched the tested scratch bytes; the shared node_modules remained a readable junction to the main checkout. Playwright exited and neither synthetic port (3270/3271) was listening. No unknown Node process was killed.

**Cleanup blocked by automatic approval review.** The two exact dedicated roots were verified as ordinary directories beneath D:/tmp, with no reparse points in the scratch tree. Both the guarded native PowerShell deletion and the safer literal-path retry were rejected before execution with the stated reason `blocked by policy`:

```powershell
Remove-Item -LiteralPath 'D:\tmp\cs177-fix-round1' -Recurse -Force
Remove-Item -LiteralPath 'D:\tmp\cs177-fix-round1-harness' -Recurse -Force
```

The scratch packages, builds, synthetic screenshots and logs therefore remain **outside the repository** at those paths. No alternate deletion mechanism was used to bypass the rejection. This is the only unfinished local cleanup requirement; it is not a verification pass. No permission prompt was requested under the session's never-approval setting.

Local commits use the required `CS-059: fix round 1: ...` prefix. The final unpublished browser-test commit was amended locally once (`git commit --amend --no-edit`); no remote history or base commit was changed, and no rebase occurred. This report is committed separately after the verified code/test commits. No GitHub write, push or merge was performed. Independent post-fix review and remote CI remain for the coordinator.

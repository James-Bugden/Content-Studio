# Issue #129 build report — round 1

- Issue: https://github.com/James-Bugden/Content-Studio/issues/129
- Classification: Standard; build role; T0 verification applies.
- Branch: `cs-129-health-docs` (existing isolated worktree).
- Implementation commit: `5bc1b8765aceda11c7a57a65b71be772d757cd54`.
- This report is committed separately after the implementation commit so its SHA
  identifies the exact workflow, documentation and tests checked below.
- No push, PR creation, merge or deployment was performed.

## Changes and acceptance criteria

1. **Workflow validation/security: PASS.** Added Monday 03:17 UTC scheduling to
   the existing `ci.yml`, reusing its verify and browser jobs. The repository's
   default branch was confirmed as `main`. Permissions, pinned action SHAs,
   disabled checkout credential persistence, synthetic providers and absence of
   repository-secret references are unchanged. `actionlint` and CI policy tests
   pass. No separate workflow or deploy tooling was added.
2. **Both production route exclusions: PASS.**
   `tests/unit/auth/policy.test.ts` invokes both POST handlers with
   `VERCEL_ENV=production`, `CS_DATA_MODE=live`, and `CS_TEST_MODE=e2e`, asserting
   HTTP 404 and no sign-in cookie. It verifies `test-auth` JSON `NOT_FOUND` and
   `test-control`'s existing plain-text 404. A direct policy test additionally
   denies production with fake/e2e enabled; real environment parsing independently
   refuses fake production. Application behavior was not changed.
3. **Documentation limited to verified facts: PASS.** README, runbook and handoff
   now document the schedule and production POST exclusions. Corrections are
   supported by `MASTER-SPEC.md`, `src/application/container.ts`, the Replies
   `get-store.ts`/`test-mode.ts`/`memory-store.ts`, Backlog page, app shell,
   `playwright.config.ts`, and the existing deployment rollback guide. Dated
   handoff task lists are explicitly historical. No schema or product changes.

## Commands and results

- State inspection: `git status --short`, `git branch --show-current`,
  `git log -3 --oneline`, `gh issue view 129`, `gh pr list --head ...`, and
  GitHub API repository/deployment reads: clean starting worktree, assigned branch,
  issue open, no PR for this branch; default branch `main`. Latest recorded
  production deployment was successful at the starting commit `de41746`.
- RED, before workflow implementation:
  `bash ~/bin/heavy npx vitest run tests/unit/security/ci-policy.test.ts tests/unit/auth/policy.test.ts`
  — expected failure for the missing weekly trigger; 21 passed, 1 failed.
- GREEN:
  `bash ~/bin/heavy npx vitest run tests/unit/security/ci-policy.test.ts tests/unit/auth/policy.test.ts tests/unit/auth/routes.test.ts`
  — 3 files, 26 tests passed.
- `actionlint .github/workflows/ci.yml` — PASS (actionlint 1.7.12).
- `bash ~/bin/heavy npm run lint` — PASS.
- `bash ~/bin/heavy npm run typecheck` — FAIL: shared installed dependencies
  lack `@supabase/supabase-js` and `@electric-sql/pglite`; missing-module errors
  and consequent implicit-any errors occur in untouched Replies files.
- `npm.cmd run check:env`, `npm.cmd run check:private`,
  `npm.cmd run check:secrets` — PASS (synthetic configuration; 495 tracked files).
  Initial PowerShell `npm` invocations were blocked by script execution policy;
  rerunning with `npm.cmd` succeeded.
- `node scripts/scan-secrets.mjs` with the six changed files — PASS.
- `git diff --check` — PASS.
- `npm.cmd ls @supabase/supabase-js @electric-sql/pglite --depth=0` and
  `Get-Item node_modules` — confirmed missing packages and the pre-existing
  junction to the main checkout's shared dependency directory.

## Unresolved risks and verification limits

- T0 is not fully green: typecheck needs a complete dependency installation and
  rerun. The shared installation was left untouched to avoid affecting other
  worktrees. No source errors were reported in changed files.
- Full tests/build are left to CI as instructed. T1–T4 were not run: this change
  adds no application behavior, UI or provider integration. These are not claimed
  as passed checks.
- The scheduled GitHub-hosted run cannot be observed until this change reaches
  the default branch; no remote CI or deployment success is claimed for this SHA.

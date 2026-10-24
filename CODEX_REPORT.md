# CS-051 build report — issue #137, round 1

- Issue: https://github.com/James-Bugden/Content-Studio/issues/137
- Classification/role: Standard / build; branch `cs-137-devdeps`.
- Verified implementation SHA: `fffebb9400dae3e04772ccc13a3c2a12438169e4`.
- Base SHA: `08cabe1d8c16e4406dd1a51712a4964dd97a37c5` (origin/main, including #134).
- This report is a subsequent documentation-only commit; its parent is the verified implementation SHA.
- Environment: Windows x64; Node 24.15.0, npm 11.12.1; synthetic providers only.
- Build ID: `GdnEYbfniZiCqC-AN2qqx`; smoke health asserted commit `fffebb9400da` and mode `fake` at both widths.
- No push, PR creation, merge, deployment, or issue closure performed. The issue is open; no PR existed for this branch when checked.

## Changes and minimum versions

| Package | Before | After | Reason |
| --- | --- | --- | --- |
| vitest | 5.0.1 | 5.0.3 | First release outside the audited mocker affected range |
| @vitest/mocker, @vitest/spy | 5.0.1 | 5.0.3 | Required Vitest dependency alignment |
| vite | 8.3.0 | 8.3.3 | Affected range ends at 8.3.2 |
| undici | 8.11.0 | 8.12.2 | Affected range ends at 8.12.1 |
| eslint-config-next, @next/eslint-plugin-next | 16.3.6 | 16.4.1 | Match unchanged Next.js 16.4.1 |
| rolldown and platform bindings | 1.2.9 | 1.2.11 | Minimum supported by Vite 8.3.3 (`~1.2.11`) |
| @oxc-project/types | 0.150.0 | 0.151.0 | Exact dependency of Rolldown 1.2.11 |
| why-is-node-running | 2.3.0 | 3.2.1 | Exact dependency of Vitest 5.0.3 |

Vitest's dependency change removes unused `siginfo` and `stackback`. npm places Rolldown, its types, and platform bindings beneath Vite in the final lockfile. A structural comparison covered all 45 changed/added/removed lockfile entries (including root and relocated entries): every non-root entry is dev-only; every production package entry and the root production dependency manifest are unchanged. No application, configuration, or test source changes are committed. Direct changed pins remain exact. No permanent overrides or extra direct dependencies were added.

The initial full audit reproduced four vulnerable packages: two high (`vite`, `undici`) and two moderate (`@vitest/mocker`, its dependent `vitest`). Audit advisory ranges establish the minimum fixed versions, rather than the higher suggested Vitest 5.0.5. Relevant mocker advisories are GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp. All findings are cleared; no advisory exceptions remain.

## Isolation and lock reproducibility

The worktree's `node_modules` remains a junction to the main checkout and was never installed into or replaced. No other worktree was modified. Temporary files live outside the repository under the OS temporary directory, prefix `cs137-`:

- `manifest/`: only package manifests; all lock regeneration occurred here.
- `source/`: `git archive` of the implementation SHA, with a fresh non-junction `node_modules`; all dependency execution occurred here. A standalone temporary Git index supports repository policy checks. No local environment files were copied.

Manifest-only commands/results:

1. `npm audit --json`: reproduced the issue before changes.
2. `npm view vitest@5.0.3 dependencies --json`, `npm view eslint-config-next@16.4.1 dependencies --json`, `npm view vite@8.3.3 version`, `npm view undici@8.12.2 version`: confirmed published versions and dependency requirements.
3. Updated the two direct pins; temporarily constrained Vite 8.3.3 and Undici 8.12.2 using manifest overrides; `npm install --package-lock-only --ignore-scripts --no-fund`: PASS. Removed temporary overrides and repeated the command: PASS.
4. Constrained required Rolldown to minimum 1.2.11 temporarily and preserved original unrelated magic-string/platform metadata entries; repeated lock generation, removed the temporary override, and regenerated again: PASS. The final manifest contains no overrides.
5. `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`: PASS; repeated generation preserved SHA-256 exactly.
6. `npm ci --dry-run --ignore-scripts --no-fund`: PASS.

Lockfile SHA-256, identical in worktree, manifest directory, and source copy after fresh install:

`17a10593ec964fed92fd5b6b5920b63efab66c1de7f2a5423e07bdb9c06ffc2b`

## T0 and T1 evidence

Every command below exited 0. Heavy commands used the shared `bash ~/bin/heavy` queue. Only targeted unit/browser files were executed.

| Command/check | Result |
| --- | --- |
| `git diff --check` | PASS |
| Structural lockfile comparison against base | PASS; production entries unchanged, scoped dev changes only |
| `bash ~/bin/heavy npm ci --no-fund` | PASS; 464 packages installed, zero vulnerabilities |
| `npm audit` (full, source copy) | PASS; zero vulnerabilities |
| `npm ls vitest @vitest/mocker vite undici rolldown eslint-config-next next` | PASS; intended versions, no invalid graph entries |
| `npm run check:private` | PASS; 495 tracked files |
| `npm run check:secrets` | PASS; 495 tracked files |
| `npm run check:env` | PASS; fake mode, provider credentials unset |
| `bash ~/bin/heavy npm run typecheck` | PASS |
| `bash ~/bin/heavy npm run lint` | PASS; no lint warnings |
| Targeted Vitest below | PASS; 13 files, 114 tests |
| `bash ~/bin/heavy npm run build` | PASS; Next.js 16.4.1/Turbopack, including TypeScript |
| Targeted Playwright below | PASS; 38 checks, Chromium, 375/1280 CSS px, one worker, zero retries |

```sh
bash ~/bin/heavy npx vitest run \
  tests/unit/auth/actor.test.ts \
  tests/unit/auth/policy.test.ts \
  tests/unit/auth/routes.test.ts \
  tests/unit/auth/setup.test.ts \
  tests/unit/security/boundaries.test.ts \
  tests/unit/security/health.test.ts \
  tests/unit/application/backlog.test.ts \
  tests/unit/application/backlog-readiness.test.ts \
  tests/unit/domain/library-backlog.test.ts \
  tests/unit/domain/library-backlog-sort.test.ts \
  tests/unit/components/dirty-guard.test.tsx \
  tests/unit/components/next-up-view.test.tsx \
  tests/replies/unit/components/sections.test.tsx --maxWorkers=1

bash ~/bin/heavy npx playwright test \
  --config=playwright.cs137.config.ts \
  tests/e2e/auth.spec.ts tests/e2e/smoke.spec.ts tests/e2e/backlog.spec.ts \
  tests/e2e/cs137-identity.spec.ts \
  --grep 'anonymous|JSON session endpoint|stranger|viewer and owner|SEC-07|SEC-09|health reports|security headers|the Backlog nav|a throttled Library|Content Library is the primary|Backlog search, status|editing a hook in place|a second in-place edit|a viewer sees Platform|closing the panel with an unsaved edit|the post editor saves a chosen hook|CS-051 exact build identity'
```

The temporary, uncommitted Playwright config extends the checked-in config, changes loopback port/base URL to 41370, disables server reuse, supplies the implementation commit SHA, and starts the already verified production build. Build-time fake-provider settings match the checked-in synthetic server environment. The additional temporary identity spec asserts `ok`, fake mode, and the exact implementation commit through `/api/health` at both widths. No harness files enter the worktree or commit.

Unit selection includes `vi.mock`/`vi.hoisted`, jsdom React components, role boundaries, conflict/replay logic, and backlog readiness. Browser coverage includes login/access boundaries, no-store/security headers, session protection, sign-out cleanup, backlog navigation/search, consecutive hook saves, dirty-edit preservation, and chosen-hook save (SEC-05/07/08/09, OBS-01, UX-04, CS-056).

Non-failing output: existing ESLint 9 deprecation during install; jsdom's unimplemented document-navigation messages; Playwright color-environment warnings; expected `FORBIDDEN` logs from negative auth cases. Their assertions passed. Initial tooling attempts hit PowerShell's npm.ps1 execution policy and Git Bash tar's drive-letter parsing; retried with `npm.cmd` and `tar --force-local`. One `npm ci` attempt in the then-empty disposable source directory failed before extraction was corrected; the subsequent real fresh install passed. These setup failures made no worktree dependency changes.

## Acceptance and remaining risks

| Issue acceptance criterion | Status |
| --- | --- |
| Full npm audit exits 0, or only unfixable documented advisories | PASS; full audit exits 0, zero vulnerabilities |
| Typecheck, lint, unit, build, targeted Playwright smoke, clean npm ci | PASS for requested local targeted scope; 114 unit tests and 38 browser checks |
| Exact pins and deterministic lockfile; no unrelated/production bumps or behavior changes | PASS; structural comparison and stable regeneration hash; no intended behavior changes |

Builder self-review found no defects in the final dependency-only diff. T2/T3/T4 are not applicable to this dev-dependency maintenance change; no user-visible UX or native behavior was changed. Full suites/remote required CI, independent review, and deployed-build verification have not run in this commit-only, unpushed handoff and are not claimed as passes. No live provider/OIDC integration or production data was exercised. Future audits can introduce new advisories; these results describe the registry audit at verification time.

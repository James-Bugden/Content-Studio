# CS-049 build report — issue #132, round 1

- Issue: https://github.com/James-Bugden/Content-Studio/issues/132
- Tier/role: Heavy / build. Branch: `cs-132-deps`.
- Validated implementation commit: `0128ad0c8ab8f78cb38c88001546ca286c0b09c5`.
- Base: `de41746`. This report is a subsequent documentation-only commit.
- Environment: Windows x64, Node `24.15.0`, npm `11.12.1`; synthetic providers only.
- Production build ID: `3XQLv-LN-uJWLlEXuCONy`. The running smoke server's health response reported commit `0128ad0c8ab8`, mode `fake`.
- No push, PR creation, merge, deployment, or issue closure was performed.

## Change and minimum fixed versions

| Package | Before | After |
| --- | --- | --- |
| next | 16.3.6 | 16.4.1 |
| zod | 4.6.5 | 4.6.6 |
| sharp (transitive) | 0.35.4 | 0.35.5 |
| source-map-js (transitive) | 1.2.1 | 1.2.2 |

The initial production audit reproduced four vulnerable packages (one critical, three high). Its affected ranges end at Next.js 16.4.0, Zod below 4.6.6, Sharp below 0.35.5, and source-map-js below 1.2.2. The selected versions clear the production audit completely. Direct dependency pins remain exact; no overrides were needed.

Next.js's [16.4.1 security release](https://github.com/vercel/next.js/releases/tag/v16.4.1) and its [cache RCE advisory](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr) confirm the minimum fixed Next.js version. The [image RCE advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) also requires Sharp 0.35.5 or newer. npm's suggested Next.js 16.4.3 and Zod 4.6.7 are unnecessary to clear the audited advisories.

Only the four packages above and the required Next.js/Sharp platform, environment, and libvips packages changed in the lockfile. A structural comparison checked all 40 changed lockfile entries (including the root manifest), with no unrelated entries changed, added, or removed. Application code, configuration, and tests are unchanged, including `eslint-config-next`.

## Dependency isolation and reproducibility

The worktree's shared `node_modules` junction was neither installed into nor replaced. A temporary directory outside the repository received only the manifests for lock regeneration. A separate source export received the resulting manifests and its own fresh, non-junction `node_modules` for execution. No local environment files were copied.

Commands in the manifest-only temporary directory:

```sh
npm install --package-lock-only
npm update source-map-js --package-lock-only
npm audit --omit=dev --audit-level=high
npm ci --dry-run --ignore-scripts
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
```

All exited 0. The audit found **zero vulnerabilities**. Repeating lock generation preserved its SHA-256 exactly:

`ad45e5ec1365ac36b0173fdb3598fa71a399890af5b71f4738e6278b04495d98`

The fresh source copy additionally passed `bash ~/bin/heavy npm ci`, `npm ls next zod sharp source-map-js`, and the production audit. Its lock hash remained identical. `npm ls` confirmed Next/Auth and all Zod consumers resolve to the intended versions, with Sharp 0.35.5 beneath Next.js and source-map-js 1.2.2 shared by the relevant consumers.

## T0 and T1 evidence

| Command/check | Result |
| --- | --- |
| `git diff --check` | PASS |
| `npm run check:private` | PASS |
| `npm run check:secrets` | PASS |
| `npm run check:env` | PASS; fake mode, no provider credentials configured |
| `bash ~/bin/heavy npm run typecheck` | PASS |
| `bash ~/bin/heavy npm run lint` | PASS; final run had no warnings |
| Targeted Vitest command below | PASS: 14 files, 174 tests |
| `bash ~/bin/heavy npm run build` | PASS: Next.js 16.4.1, Turbopack, including TypeScript |
| Targeted Playwright command below | PASS: 36 checks, Chromium at 375 and 1280 CSS px, one worker, no retries |

All dependency execution used the fresh source copy. Heavy commands used the shared queue; the full unit and browser suites were deliberately not run.

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
  tests/unit/ai/gateway.test.ts \
  tests/unit/ai/english-qa.test.ts \
  tests/replies/unit/contracts/contracts.test.ts \
  tests/replies/unit/ai/tasks.test.ts --maxWorkers=1

bash ~/bin/heavy npx playwright test \
  --config=playwright.cs132.config.ts \
  tests/e2e/auth.spec.ts tests/e2e/smoke.spec.ts tests/e2e/backlog.spec.ts \
  --grep 'anonymous|JSON session endpoint|stranger|viewer and owner|SEC-07|SEC-09|health reports|security headers|the Backlog nav|a throttled Library|Content Library is the primary|Backlog search, status|editing a hook in place|a second in-place edit|a viewer sees Platform|closing the panel with an unsaved edit|the post editor saves a chosen hook'
```

The temporary Playwright config inherited the checked-in projects, fixtures, and synthetic server environment. It changed the loopback port/base URL to 41320, set the implementation commit identity, disabled server reuse, and started the already verified production build instead of rebuilding it. No harness file was committed. Build-time synthetic settings matched the server settings.

The first typecheck found a union-type error in that temporary harness, which was corrected; subsequent typecheck and build passed without application changes. Its initial lint-only default-export warning was also corrected, and the final full lint passed cleanly. Next.js logged a harmless warning that it ignored the separate parent temporary lockfile outside the verification Git repository. Expected forbidden-account test requests logged `FORBIDDEN`; their redirect/access assertions passed.

## Vulnerable feature use

- **Image optimization: no application use found.** No optimizer imports or `getImageProps` calls exist in application source. `post-thumb.tsx`, `platform-preview.tsx`, and `visual-editor.tsx` use plain `<img>` elements. Private visual previews use the application's render route; comments explicitly avoid optimizer caching. `next.config.ts` does not enable custom image handling. The framework optimizer route is not explicitly disabled, so this finding is not a claim that the bundled feature is unreachable.
- **`use cache`: no application use found.** No directives or `cacheComponents` enablement exist in application source or Next.js configuration. Request-local/disposable application caches are separate from this Next.js feature.
- The upgrade applies regardless of feature usage. No exploit attempt was made against production.

## Adversarial checks and acceptance

Three builder verification lenses found no defects: version/range and dependency-graph correctness; integration/state behavior (stale revisions, replay, sequential edits, recovery); and auth/privacy (anonymous/stranger/viewer boundaries, cookies, no-store responses, private search, server-only imports). The smoke server could not reuse another checkout's server, and its health identity matched the implementation commit.

| Acceptance criterion | Status |
| --- | --- |
| Production high-severity audit exits 0 | PASS; zero vulnerabilities |
| Typecheck, lint, unit, build, login + backlog smoke | PASS for the requested targeted local scope: 174 unit tests and 36 browser checks |
| Deterministic lockfile / clean `npm ci` | PASS; stable regeneration hash, dry run, fresh install |
| No behavior change | No intended behavior change; dependency-only diff and targeted flows passed |

Residual gates/limits: independent **Opus verification is pending before merge**, as required by the issue; this builder's checks do not replace it. Remote required CI/full suites and deployed-build verification have not run because this handoff is commit-only and unpushed. The unrestricted audit still reports four findings in unchanged development dependencies (`undici`, `vite`, `vitest`, `@vitest/mocker`); the production audit is clean. No real provider/OIDC integration or production data was exercised.

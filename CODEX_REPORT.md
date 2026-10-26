# CS-076 fix handoff - PR #232, round 1

Issue: https://github.com/James-Bugden/Content-Studio/issues/230
PR: https://github.com/James-Bugden/Content-Studio/pull/232
Classification: Standard; role: fix. Branch: `feat/230-owner-cutover-panel`.
Parent: `d1f99bfa9c6322262cd1cc2bd3ddc3425e11304a` (already merges main).
Commit subject: `CS-076: keep the existing import button on /reconcile and fix sweep findings (#230)`.
This report supersedes the earlier build report, including its incomplete auth-log
claim. The independent review found a real Auth.js expiry-logger privacy leak.

## Implementation and regression coverage

- Restored the existing `ContentImportButton` in the Content import and parity
  section, outside the collapsed import-details disclosure. Its default accessible
  name is exactly `Run content import`; its existing request, idempotency/retry,
  refresh and `Content import completed.` text in `role=status` remain unchanged.
  As before, that control is owner-only and appears when typed parity is active
  (`db-shadow`/`db-read`), not in inactive Sheet or database-authority mode.
- The panel's `Import now` continues to render that same component with its label
  prop and status-refresh callbacks. It is disabled with a recovery explanation
  when report construction fails or any reconciliation source is unreadable.
  This covers the sweep's `noWrites` contract for Sheet/Drive/Typefully faults
  while preserving the existing recovery control's behavior.
- Kept the supplied partial page/panel/component-test work and verified it.
  New component regressions exercise the real import component for both entry
  points: exact label/status, POST endpoint/UUID, router refresh, readiness
  refresh, owner visibility and fault/recovery disabling.
- Added all three Auth.js `logger` handlers to the shared lazy auth config.
  They ignore every argument and emit only `AUTH_ERROR`, `AUTH_WARNING` or
  `AUTH_DEBUG`. No exception, library code, cause, stack, metadata or decrypted
  claims are forwarded to the console. The debug handler uses `console.warn`
  to comply with the repository's console policy.
- Added `cutover-expired-cookie.test.ts`: real Auth.js `encode`/`decode`, shared
  auth config, session parsing, `requireMutation`, and cutover GET/POST run
  without an auth mock. Both HTTP and `__Secure-` cookie names are covered.
  A real encrypted owner JWE authenticates successfully on both methods first;
  advancing only Date beyond expiry and Auth.js's clock tolerance causes both
  to return 401 with private/no-store headers and no provider execution.
  Captured console methods plus stdout/stderr and responses exclude the owner
  subject, actual generated jti, email, entire encrypted token, secret, and
  literal payload/sub/jti/email/token text. Exactly two fixed error codes are
  required, preventing a missing-cookie/unreached-auth false green.
- Vitest inlines `next-auth` through Vite so the real wrapper's extensionless
  Next imports resolve and only Next's request context can be faked.
- No authorization, same-origin, bearer precedence, SQL gate, expected-build,
  replay, audit or typed-ACTIVATE guard was weakened or changed.

## CI diagnosis and browser selector audit

Read-only inspection: run `40319491678`, PR status/comments and issue #230.
The four DB-read failures at 375/1280 were missing `Run content import` at
`content-read-cutover.spec.ts:38,72`; the component is restored, so these
unchanged selectors and role/status assertions are reachable again.

The exploratory job `121562682565` was CANCELLED during `Install Chromium` at
12:20:21 UTC after slow package downloads. It never extracted the server or
started the sweep; no sweep artifact existed. This was an infrastructure/setup
timeout, not evidence of a new panel accessibility or console failure. No CI
workflow change is bundled. The unreadable-source guard above addresses a
separate implementation risk found by reading its fault assertions.

No e2e tests were modified in this fix. Reviewed all matches for `/reconcile`,
import labels/status and panel names/IDs, including:

| Specs | Selector/behavior review |
| --- | --- |
| `content-read-cutover` | Exact legacy button and completed status restored; row-specific pending recovery selectors unchanged. |
| `content-parity` | Panel Import now still uses the same component; UUID replay and completed status retained. |
| `content-parity-sheet`, `content-write-cutover` | Legacy button remains absent when typed parity is inactive or database is authoritative. |
| `database-switch` | Panel name, status labels, native dialog, exact ACTIVATE label, switch/cancel/refresh names and focus hooks unchanged. |
| `sweep`, `sweep-faults`, `sweep-checks` | Readiness, noWrites, keyboard, axe, console/network, overflow contracts retained; panel import disabled on unreadable-source faults. |
| `a11y`, `states`, `ux-polish`, `zz-screens` | Page heading, provider state, folded Diagnostics and existing fix actions retained. |
| `markdown-authority`, `navigation-counts`, `schedule` (and editor reconcile-text match) | Markdown controls, data-reconcile-kind sections, nav badges, stale headings and dismiss/review controls retained. |

Markup review found one panel heading and unique reason/confirmation IDs, a
proper confirmation label, native controls with no interactive nesting, shared
44px button/input classes, existing color tokens, a fixed-width table and
wrapping build/text. This is static review only: browser/a11y/overflow/console
results at both widths still require CI. Browser suites were not run locally,
as requested; neither cancellation nor static review is recorded as a pass.

## Verification

Windows, synthetic fixtures and fake/PGlite providers only. Every Vitest,
TypeScript and lint invocation used `bash ~/bin/heavy`; one Vitest worker.
No full repository test suite, dependency installation or new dependency.

- `bash ~/bin/heavy npx vitest run tests/unit/components tests/unit/application tests/unit/security tests/unit/supabase --maxWorkers=1`: PASS, 85 files / 1649 tests.
- `bash ~/bin/heavy npm run typecheck`: PASS.
- `bash ~/bin/heavy npm run lint`: PASS after using an allowed console method.
- Final restored-source retest of both UI regressions, real expired-cookie
  regression and all four existing auth test files: PASS, 7 files / 88 tests.
  After aligning the synthetic email with the scanner's reserved example.com
  domain convention, the real-cookie regression was rerun: PASS, 2/2 tests.
- `node scripts/check-private-paths.mjs`, `node scripts/scan-secrets.mjs` and `git diff --check`: PASS (rechecked before commit).

The original node_modules junction lacked the already-declared PGlite/Supabase
packages: initial run had 71 passing files / 1023 tests and 14 import failures.
Validation temporarily used the complete existing dependency tree at
`C:/Users/jbbug/projects/cs-wt/163/node_modules` (including declared versions
Vitest 5.0.3, Next 16.4.1, Auth.js beta.32, PGlite 0.5.8). No install occurred.
An initial typecheck was stopped after a temporary backup-junction name entered
its wildcard scan; that junction was removed and the clean typecheck passed.
The original worktree junction is restored before handoff. Synthetic logs and
mutation hashes are retained locally under `tmp/cs076/` (ignored).

Adversarial lenses: import reachability/recovery, privacy/auth integration, and
false-green test integrity. Three implementation mutations were applied one at
a time, killed by behavioral assertions (not compile/import failures), and
restored with matching SHA-256 hashes before the final 88-test retest:

| Mutation | Observed failure |
| --- | --- |
| Remove the shared Auth.js logger override | Both real expired-cookie tests fail; captured default-logger diagnostics contain the synthetic subject, jti field and email. |
| Remove the restored legacy import component from the page | Both db-shadow/db-read visibility journeys fail on the missing exact button. |
| Remove importsBlocked from the panel import disabled condition | Fault/recovery test fails because Import now is enabled during the fault. |

No mutation was retained. The owner/CSRF, bearer/replay/build-binding and
typed-confirmation assertions in the existing security/component suites pass.

## Remaining evidence and boundaries

CI T1/T2 at 375/1280, including the previously unstarted sweep, must be rerun on
the fix commit. Local unit/static results do not establish deployed behavior.
No push, gh write, merge, deployment, live provider call, production-data change,
cutover, new dependency or auth/ACTIVATE relaxation was performed. The only
commit in this fix includes this report and mentions the redacted logger in
its body. The exact resulting commit identity is supplied in the handoff.

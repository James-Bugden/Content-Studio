# CS-061b / issue #164 — fix round 1

Status: **requested fix round complete locally; overall native-transfer
acceptance remains partial, not merge-ready**. No production build, CI run,
external composer or physical-phone pass is claimed.

- Issue: https://github.com/James-Bugden/Content-Studio/issues/164
- Branch: `cs-164-img` (existing isolated worktree).
- Actual starting HEAD: `13d1537`, after implementation `9e0c015`; clean at start.
  The request mentioned `c2d0227`, which was not this checkout's HEAD.
- Verified code/docs commit: `41329594ecf7a63db8d8ae37a97297825686393b`.
  This report is committed separately afterwards; no application/test changes
  followed verification.
- Classification: Standard; scoped review fixes, no new surface or PRD.
- Read: AGENTS.md, previous CODEX_REPORT.md, MASTER-SPEC.md, implementation and
  QA skills, issues #164/#162, repository Playwright/server/CI contracts.
- Read-only GitHub state: issue open; no PR for `cs-164-img`. No push, PR/issue
  write, merge, deployment, dependency installation or other-worktree operation.

## Fixes

1. Deleted `playwright.image-transfer.config.ts`. The committed spec has no
   special server, port or config dependency. Repository config discovery lists
   five ordinary tests in each of `w375` and `w1280`; CI runs that config against
   a production build. The test-only HTML receiver remains because the
   controlled drop test uses it.
2. Removed the two expected-failing native cross-frame cases (one per width).
   No `test.fail()` or skipped acceptance remains in the image-transfer spec.
   Real mouse dragstart inspects the native store and then cancels. Controlled
   dragstart/drop additionally asserts strict File object identity, plus PNG
   name/type/signature/size. This does not establish native cross-site receipt.
3. Moved the owner T4 checklist/results table to the PR-facing
   [docs/testing/image-transfer.md](docs/testing/image-transfer.md). It states
   plainly that Chromium strips the JS-created File in native cross-frame drops
   and that drag-out may fail in targets. Copy image and Download are the
   reliable offered paths; paste depends on destination support. All external
   composer/browser/phone results remain owner-pending.
4. Investigated native raster `<img draggable>` once in disposable scratch
   tooling. It exposed the session asset URL in dragged data and did not produce
   a completed cross-site receiver drop in this run. No workaround was shipped.

Application implementation is unchanged this round: prepared PNG File-only
drag; clipboard `image/png`; PNG Download; capability-gated file-only Share;
SVG rasterisation at design dimensions; Schedule-backed Published images.
No dependency or package/lockfile change.

## Verification

Windows; Node `v24.15.0`, installed Next `16.3.6`, Playwright `1.63.0`,
Vitest `5.0.1`; synthetic fake providers only. Shared installed versions do not
all match the manifest. Every heavy command used `bash ~/bin/heavy`.
Only targeted test files ran; no full test suite.

| Check | Exact command | Result |
| --- | --- | --- |
| T0 lint | `bash ~/bin/heavy npx eslint .` | **Passed**, exit 0. |
| T0 targeted units | `bash ~/bin/heavy npx vitest run tests/unit/components/image-transfer.test.tsx tests/unit/visuals/render-route.test.ts` | **12 passed**, 2 files, exit 0; 2.55s test duration. Includes stale/cached sources, unsupported actions, file-only payload and authenticated Schedule asset validation. |
| Normal config discovery | `bash ~/bin/heavy npx playwright test tests/e2e/image-transfer.spec.ts --project=w375 --project=w1280 --list` | **10 tests discovered**, exit 0; no special config/port. |
| Production-config T1 | `bash ~/bin/heavy npx playwright test tests/e2e/image-transfer.spec.ts --project=w375 --project=w1280` | **Blocked before tests**, exit 1: Turbopack rejects node_modules junction pointing outside its filesystem root. |
| Typecheck | `bash ~/bin/heavy npx tsc --noEmit` | **Blocked**, exit 1: missing shared `@supabase/supabase-js`, `@electric-sql/pglite` and its `contrib/pg_trgm` declarations, with consequent existing Replies/database implicit-any errors. No diagnostics in changed files. |
| Production build without Turbopack | `bash ~/bin/heavy npx next build --webpack` | **Blocked**, exit 1: existing Replies route cannot resolve `@supabase/supabase-js`. No production artifact validated. |
| Development browser evidence + scratch investigation | `bash ~/bin/heavy npx playwright test --config=C:/Users/jbbug/AppData/Local/Temp/cs164-fix-r1/local.config.ts --project=w375 --project=w1280 --project=investigation` | **All 10 committed-spec checks passed**, zero expected failures/skips. **1 scratch-only investigation failed** waiting for native cross-site drop; combined exit 1, 1.6m. Local development evidence, not production/CI acceptance. |
| Privacy / secrets / whitespace | `node scripts/check-private-paths.mjs`; `node scripts/scan-secrets.mjs`; `git diff --cached --check` | Passed for staged fix files; repeated for final report. |

Typecheck and the Webpack build are locally blocked by missing shared packages,
not a new dependency requirement. Both packages already exist in manifest and
lockfile; CI installs them through its own `npm ci`. Stock Turbopack additionally
hits this worktree's junction restriction. No environment workaround was
committed. CI was not run by this local-only round; its results remain unknown.

The disposable config imported repository projects/settings and restricted
execution to this spec plus one investigation. It started a fake-provider
Webpack dev server at normal local port 3200 and warmed the existing render
route in its readiness check. Both scratch files and their directory were
deleted afterwards. Next dev's generated AGENTS.md append was restored to the
clean starting contents after the server stopped. Playwright owned its server
processes; no unrelated Node process was killed.

The committed-spec passes cover native dragstart PNG name/type/items and no
URL/token strings; controlled receiver File identity; real clipboard read-back
PNG signature; Download signature/name and SVG-derived 1080 × 1080 dimensions;
keyboard activation, no document overflow and zero axe violations at both
widths; finished raster Download and mocked file-only Share; Published Schedule
asset content type and anonymous refusal. Share mocks are not phone OS/app
acceptance. No product UI changed this round.

## One-off native raster finding for the coordinator

Chromium `153.0.8010.12` (Playwright, Windows), desktop 1280 px. A scratch-only
same-origin source page used a plain `<img draggable="true">` pointing directly
at existing session-protected `/api/library/SYN-L009/asset`, after owner test
login and synthetic finished-raster row setup. The receiver was a distinct site,
`http://receiver.test`, fulfilled entirely by local Playwright routing.
No external service or private content was involved.

Native dragstart, recovered from the retained trace's DOM snapshot:

- Types: `["text/uri-list", "text/html", "Files"]`.
- URI string: `http://127.0.0.1:3200/api/library/SYN-L009/asset`.
- HTML string: `<img id="source" draggable="true" src="http://127.0.0.1:3200/api/library/SYN-L009/asset" width="180" height="180">`.
- File: `{name: "asset", type: "image/png", size: 67}` (synthetic fixture).

Chromium supplied a native PNG File at dragstart, but also disclosed the image
URL in URI and HTML data. The cross-site receiver's output stayed empty until
the 10-second assertion timeout: **no completed native drop observed**, not
successful File receipt. This differs from the earlier generated-File native
cross-frame result (`files: []` in an actual drop event). Investigation stopped
here, with no repeated workaround search, URL-clearing variant or product code.

Even if native delivery works in other targets, this observed payload violates
AC4, “no image URL or token appears in the dragged data (asserted).” Session
protection alone does not satisfy that stricter criterion. No native-img
alternative was shipped.

Ignored synthetic evidence:
`test-results/image-transfer-native-inve-160f5-rop-and-URL-disclosure-once-investigation/trace.zip`.
That failed investigation is not part of the committed CI spec.

## Handoff and residual acceptance

AC1 and AC4 have local development browser evidence at both widths. AC2 has a
controlled receiver File-identity pass, not native cross-site proof. AC3's
PR-facing checklist is committed; all owner results are pending. The original
native cross-frame finding remains a limitation, not an expected-failure CI
success. Production-config CI, deployed-build verification, external composers
and physical Share remain unverified. No PR, deployment or issue closure was
attempted under this round's explicit local-only scope.

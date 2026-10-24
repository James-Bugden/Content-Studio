# CS-061b / issue #164 — build round 1

Status: implemented locally, **partial acceptance; not merge-ready**. Copy image,
PNG Download and capability-gated file Share are implemented. Native cross-frame
drag does **not** deliver the generated File in the tested Chromium. This report
does not claim external composer drag support or physical-phone verification.

- Issue: https://github.com/James-Bugden/Content-Studio/issues/164
- Branch: `cs-164-img`; base `544d9c9cd74e69967bca1a8ced7f01e1f24ad6f1` (`origin/main`).
- Tested code: `9e0c0150bea068ba4accd943065e0c4062f9f54a`.
- Classification: Standard, scoped existing-surface feature; no new PRD needed.
- Read: AGENTS.md; MASTER-SPEC assets, Visual Studio, Ready/Schedule, Published,
  privacy and verification contracts; issues #164 and #162; existing asset/render
  routes, Visuals editor, thumbnails, post/slot panels and Published views.
- No PR exists for this branch at the read-only check. No push, GitHub write,
  merge, deployment, dependency installation or shared-node_modules edit occurred.

## Implementation

`TransferImage` prepares a PNG from the already-loaded image, with no additional
fetch. SVG previews retain their 1080px design width; raster images retain their
dimensions. Filenames are sanitised and end in `-1.png`. Actions remain disabled
until preparation finishes; cached images are prepared after hydration too.
Changing the source discards the previous prepared file.

The image's wrapper starts the file drag; the inner image suppresses native image
dragging, which otherwise inserted URL/HTML data in Chromium. The handler clears
the native store and adds only the PNG File. It never adds DownloadURL, URI lists,
HTML, Drive URLs, blob URLs or tokens. Unsupported drag preparation cancels safely.
The on-screen hint offers Copy image and Download when a target rejects the drop.

Copy writes a real clipboard `image/png`; Download creates a short-lived local
blob URL outside DataTransfer; Share passes only `{files}` and appears only when
both Share and `canShare({files})` support the prepared PNG. Denial/failure gives
fallback feedback. No server mutation or approval state changes.

The shared component covers Visuals draft/full-size/phone previews, screenshot
assets, post/slot platform previews and existing small thumbnails. Thumbnails
remain compact, with actions in the full preview. Published now displays its
recorded Schedule image through an authenticated Schedule asset route, using the
existing byte validation, size limit, sandbox and private-cache pattern. No
Library-to-Schedule image substitution is introduced for Published.

The model has one `Image File` per post. No carousel model or all-images action
was invented. No npm dependency or package/lockfile change was made.

## Verification results

Environment: Windows, Node `v24.15.0`, installed Next `16.3.6`, Playwright `1.63.0`,
synthetic fake providers only. The manifest declares Next `16.4.1`; the shared
installation does not match it. Every Vitest, typecheck, build and Playwright
command ran through `bash ~/bin/heavy`.

| Check | Command / evidence | Result |
| --- | --- | --- |
| T0 focused tests | `bash ~/bin/heavy npx vitest run tests/unit/components/image-transfer.test.tsx tests/unit/visuals/render-route.test.ts` | **12 passed** across 2 files. Includes cache/hydration, stale source, failure/unsupported states, file-only payloads, and actual Schedule route session/validation/private headers/SVG refusal. |
| T0 lint | `npx.cmd eslint` on all changed TS/TSX files, including the fallback config and specs | Passed. |
| T0 privacy/secrets | `node scripts/check-private-paths.mjs`; `node scripts/scan-secrets.mjs`; `git diff --cached --check` | Passed, including staged new files. |
| Full typecheck | `bash ~/bin/heavy npx tsc --noEmit` | **Blocked/red**: missing shared `@supabase/supabase-js` and `@electric-sql/pglite`, plus consequent existing Replies/Supabase typing errors. No diagnostics remain in the changed files. This is not a full typecheck pass. |
| Stock production-config T1 | `bash ~/bin/heavy npx playwright test tests/e2e/image-transfer.spec.ts --project=w375 --project=w1280` | **Blocked before tests**: Turbopack rejects the shared node_modules junction pointing outside its filesystem root. |
| Alternative production build | `bash ~/bin/heavy npx next build --webpack` | **Blocked/red**: missing `@supabase/supabase-js` imported by existing Replies routes. No production artifact was validated. |
| Development fallback T1 | `bash ~/bin/heavy npx playwright test tests/e2e/image-transfer.spec.ts --config=playwright.image-transfer.config.ts --project=w375 --project=w1280` | Final run: **8 ordinary passes + 2 expected native-drop failures**, 50.1s, exit 0. Playwright prints “10 passed” because it counts expected failures as successful test outcomes. The two failed native acceptances are **not passes**. |
| T2 responsive/accessibility | Real Chromium at repository project widths 375 and 1280; screenshots `test-results/image-transfer-VIS-real-cl-afa3d-wnload-and-keyboard-actions-w{375,1280}/image-actions.png` | Visuals screenshots reviewed: compact focusable actions below the existing full-size scrolling viewport; no document overflow; Enter activates Copy. WCAG 2 A/AA and 2.1 AA axe scan has **zero violations** at both widths. Screenshots are synthetic and stay in ignored test output. |
| Physical/browser integration | External composers, Safari, Firefox, phone OS Share | Not run; owner checklist below. Share capability is mocked in browser tests, not a physical Share-sheet pass. |

The committed fallback config imports the repository config and retains its
Chromium projects, widths, motion setting, timeouts and fixture conventions. It
uses a local fake-provider Webpack **dev** server on port 3264 and warms the render
route before tests. It does not replace the repository production-build gate.
Earlier dev iterations exposed native URL leakage and cached-image preparation;
both were corrected and retested. One cold dev iteration also hit a transient
empty manifest; the final warmed run completed without that error.

## Acceptance evidence and remaining limitation

| Acceptance | Evidence / result |
| --- | --- |
| AC1: dragstart PNG type/name/items at both widths | Passed in actual mouse drags: only `Files`; one `file`, MIME `image/png`, `researched-range-1.png`. SVG is never the exported file. |
| AC1: Copy/Download and SVG conversion | Passed: granted real clipboard read/write permissions, read back `image/png` and PNG magic bytes, verified download name/magic bytes and 1080 x 1080 PNG dimensions. Finished raster download also passed. |
| AC2: dropzone File receipt | Controlled browser dragstart/drop dispatch uses the actual prepared File and the test-only page in `tests/e2e/fixtures/image-dropzone.html`; File identity, name/type, bytes and size pass at both widths. **This is not native cross-site proof.** |
| Native cross-frame drop / goal of dragging into another app | **Failed at both widths**: dragstart has the File, but Chromium's native receiver sees `files: []`. The real native assertion remains in the spec, marked expected-failing only after the type/name/privacy assertions succeed. If Chromium starts forwarding the File, it becomes an unexpected pass requiring review. |
| AC3: owner T4 results table | Supplied below; owner actions remain unverified. |
| AC4: no dragged URLs/tokens | Passed in real native dragstart: exactly `Files`, no string data; asserted absence of HTTP/blob/data/API/Drive/token/bearer data. No DownloadURL workaround is used. |

The observed native failure is why this work is not merge-ready against the
complete drag goal. A synthetic drop is not offered as evidence that LinkedIn,
Threads or Instagram accept a real cross-tab drag. Adding a URL-based drag
workaround would violate this round's explicit no-URLs-in-DataTransfer rule.
For an unsupported target, Download followed by selecting the saved file in its
upload picker is the available fallback. Clipboard paste also depends on what
the destination accepts. Phone mouse-style drag is not implemented.

## T4 owner checklist — results table

Use a synthetic image on the exact deployed candidate; record browser/OS/version,
filename, visible image result and fallback result. Open an empty composer and
cancel afterwards; publishing is outside this issue. These rows are pending,
not passes. No external uploads were made during this build round.

| Target | Owner steps | Result this round / what cannot be claimed |
| --- | --- | --- |
| LinkedIn web, desktop Chrome | Drag the Content Studio image into the composer's upload area. Then Copy image and Ctrl/Cmd+V. Check Download and upload the saved PNG if either fails. | **Owner pending.** Native Chromium test-frame drop loses the generated File; LinkedIn cross-tab drag is not established. Record whether paste is accepted. |
| Threads web, desktop Chrome | Repeat drag, Copy/paste, and downloaded-PNG upload in a new post composer. Verify the intended image appears. | **Owner pending.** No successful native cross-tab delivery claim; Download is the fallback if drag/paste is rejected. |
| Instagram web, desktop Chrome | Try drag into Create/upload. Try Copy/paste only if the composer accepts it; otherwise upload the downloaded PNG. | **Owner pending.** Neither drag nor image-paste acceptance is established. No SVG is supplied. |
| Desktop Safari | Repeat the composer checks with a synthetic PNG and note macOS/Safari version; verify Download even if Clipboard/drag is unavailable. | **Not tested.** No Chromium-parity claim; no URL-based native drag fallback. Copy is disabled when required clipboard APIs are absent. |
| Desktop Firefox | Repeat drag, clipboard and Download checks; note Firefox/OS version and any disabled Copy control. | **Not tested.** File-drag and clipboard-image support must be checked on that browser; Download remains the offered fallback. |
| iPhone / Safari | Open a post image; if Share appears, tap it and choose an available image-capable destination. Verify the image arrives, then cancel posting. Also verify Download. | **Physical device pending.** Share appears only for `canShare({files})`; a particular app's presence/acceptance in the OS sheet is not guaranteed. Desktop mouse drag is not a phone workflow. |
| Android / Chrome | Repeat file Share and Download; record whether the target app accepts the PNG and whether Share is offered. | **Physical device pending.** Browser test verifies only the file-only Share call with a mock capability, not a real OS/app transfer. |

No deployed build, CI, T4 or external-app acceptance is claimed. The issue remains
open, and this branch/report are local only under the requested build-role scope.

# Issue #156: build round 1

- Issue: https://github.com/James-Bugden/Content-Studio/issues/156
- Standard change, build role, branch `cs-156-fonts`.
- Base: `7f33aec` (origin/main at assignment).
- Tested implementation: `76fa7df2653291e98dcfac1608f7d8cde19d4e4b`.
- Windows, Node v24.15.0, Next.js 16.4.1, Playwright Chromium; 2026-10-24.
- No push, PR creation, merge, deployment or issue closure. No existing PR found for this branch; 156 is the issue number here.

## Scope decision

The issue names obsolete Plex Sans/Source Serif typography. Current main uses Inter 400/500/600, deliberately introduced by CS-042 (`b8c1e61`, PR #92), explicitly removing serif typography. To preserve the current approved appearance and satisfy the no-font-change requirement, this implementation self-hosts Inter. An optional clarification received no response before proceeding with that evidence-based recommendation.

`src/app/fonts.ts` uses `next/font/local` with normal-style Latin WOFF2 files, `display: swap`, and the existing `--font-sans-polished`. Layout/global CSS remain unchanged; the serif token remains the current sans alias. No `--font-serif-polished` exists at the base, so none is introduced. The literal Plex/Serif asset request is not implemented because it conflicts with the current approved design.

`package.json`, `package-lock.json`, `next.config.ts`, `src/app/layout.tsx` and `src/app/globals.css` are byte-identical to the base. Actual existing CSP is `font-src 'self' data:` and is unchanged.

## Provenance and licence

Ran `npm pack @fontsource/ibm-plex-sans @fontsource/source-serif-4 @fontsource/inter --json` in a throwaway directory outside the repository. Extracted only `package/LICENSE` and normal-style Latin WOFF2 members: Plex 400/600, Serif 600, Inter 400/500/600. Only the current Inter assets and complete, unmodified SIL OFL 1.1 text were copied into Git. No dependency was added.

| Package | Version | Disposition |
| --- | --- | --- |
| `@fontsource/ibm-plex-sans` | 5.3.0 | Downloaded/extracted outside repo; obsolete family, not committed |
| `@fontsource/source-serif-4` | 5.3.1 | Downloaded/extracted outside repo; obsolete family, not committed |
| `@fontsource/inter` | 5.3.0 | Exact package bytes vendored; licence `src/app/fonts/Inter-OFL.txt` |

## Verification commands and results

Every memory-heavy command ran through `bash ~/bin/heavy`. No install ran in this worktree or through its shared dependency junction. A source copy from `git archive HEAD` received its own fresh `bash ~/bin/heavy npm ci --no-audit --no-fund`: PASS, 466 packages. The shared queue initially waited for memory. No other worktree was touched or unrelated process killed.

All builds ran in that isolated copy, with fake-provider settings from `playwright.config.ts`: `CS_DATA_MODE=fake`, `CS_TEST_MODE=e2e`, `AI_PROVIDER=fake`, its synthetic test-only `AUTH_SECRET`, and loopback `APP_BASE_URL`. No private environment file was copied. Offline build command:

```sh
bash ~/bin/heavy env HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 NO_PROXY= NEXT_TELEMETRY_DISABLED=1 npm run build
```

- Original source: expected FAIL, exit 1, requesting `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap`; `Failed to fetch Inter from Google Fonts`.
- Original source without invalid proxy: PASS, including TypeScript; used for baseline browser evidence.
- Local-font source under invalid proxy: PASS, including TypeScript/page generation/optimization. Repeated final build of final source/test bytes: PASS, exit 0, no Google fetch warning.
- Initial local build caught an unchecked-index TypeScript error in the new test; fixed before final verification.
- `bash ~/bin/heavy npx playwright test tests/e2e/fonts.spec.ts tests/e2e/a11y.spec.ts --config playwright.fonts.config.ts`: PASS, 26/26, 40.9 seconds, 375 and 1280 projects. The temporary config copies repository configuration and changes only webServer to start the already built production output (`npm run start -- --port 3200 --hostname 127.0.0.1`), with reuse disabled.
- New regression: loaded 400/500/600 faces, swap, existing variable, three distinct same-origin font URLs, no font CSP console errors, Google browser requests aborted, zero WCAG 2 A/AA / 2.1 AA axe violations on the synthetic gallery. An initial request-count assertion was corrected to deduplicate preload/refetch URLs when request routing disables cache.
- Existing a11y file: 24 cases PASS across 12 routes, no serious/critical WCAG violations.
- Targeted `eslint src/app/fonts.ts tests/e2e/fonts.spec.ts`: PASS.
- `git diff --check`, `node scripts/check-private-paths.mjs`, `node scripts/scan-secrets.mjs`: PASS, including staged assets/licence.
- Verified copied/worktree SHA-256 equality for changed code/tests and preserved contract files before commit. Self-reviewed actual diff: no unrelated source changes or private data.

## Acceptance

| Criterion | Result |
| --- | --- |
| Build without Google font access | PASS: original fails and fixed build passes under identical refused-loopback proxy settings |
| Rendered font family/weights at 375 and 1280 | PASS via permitted computed-font/weight check, preserving current Inter; pixel identity is not claimed |
| CSP unchanged | PASS: unchanged config bytes, live response policy, same-origin loaded fonts |
| Axe | PASS in repository WCAG scope: 26 targeted cases; zero WCAG violations in new gallery check |
| Licence | PASS: complete unmodified Inter OFL text |
| Literal Plex/Serif assets | Not implemented: documented adaptation to current approved typography |

Baseline/local screenshots and metrics remain outside Git under `%TEMP%/cs156-976c46eccc7d45fea82dbdcfeb8366e3/`: `baseline-375.png`, `baseline-1280.png`, `local-375.png`, `local-1280.png`, `baseline-metrics.json`, `local-metrics.json`. Synthetic `/dev/states` screenshots were visually reviewed with no visible layout change. Temporary `source/font-evidence.mjs` launched Chromium and its own loopback production server through the queue, then stopped that server.

Computed values match: Inter (Google CSS family `Inter`, local generated family `inter`), body 400/16px/24px line-height, buttons 500/14px/20px; H1 600/20px/28px at 375 and 600/24px/32px at 1280. No horizontal overflow before or after.

An additional strict exact canvas-width comparison FAILED for tiny static-instance rounding differences. For `Content Studio 0123456789 Aa Bb fi ffi` at 16px:

| Weight | Google width (px) | Local width (px) |
| --- | --- | --- |
| 400 | 294.875 | 294.875 |
| 500 | 298.068115234375 | 298.0703125 |
| 600 | 301.20654296875 | 301.2109375 |

Maximum difference: 0.00439453125px. This extra strict comparison is recorded as failed; the accepted computed-family/weight comparison and observed layout remain matched.

## Risks and limits

- Pixel/glyph-metric identity is not established; rounding differences above are retained transparently.
- Unfiltered axe on the gallery reported moderate best-practice `landmark-unique` for two Recovery regions sharing a label. This is outside repository WCAG-tagged acceptance and unrelated to font loading. An unfiltered axe pass is not claimed.
- T3/T4, CI, independent review and deployment were not performed in this build-only no-push round. Browser evidence is synthetic desktop Chromium with emulated widths, not physical devices. No full test suite was run, as instructed.
- Invalid proxies provide the requested network-blocking evidence, not an OS-wide firewall guarantee.
- Disk filled while initially writing this report. Removed only this task's verified throwaway `source/.next` and `source/node_modules` after all checks completed, recovering space. Browser evidence, scripts, source copy and font packages remain outside Git. No other worktree/dependencies were altered.

## Delivered file SHA-256

Hashes identify tested bytes. The report excludes its own self-referential hash.

| File | SHA-256 |
| --- | --- |
| src/app/fonts/inter-latin-400-normal.woff2 | 8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc |
| src/app/fonts/inter-latin-500-normal.woff2 | f3779f1efccc4bdcdf9c0a02ab95bf6bd092ed09c48c08cedc725889edd1d19f |
| src/app/fonts/inter-latin-600-normal.woff2 | f9a06e79cd3a2a20951c0f0e28f66dd0e6d3fda73911d640a2125c8fcb78f21a |
| src/app/fonts/Inter-OFL.txt | 3b0a5fca3d17942cde889069889dedbbbd075e9b599968c82a95f4d944e9b345 |
| src/app/fonts.ts | 46f23c7ff88a3d22c857322e9546c42cbb4d46dbbbb137014416dfd5666ebb74 |
| tests/e2e/fonts.spec.ts | 8343e42e920c6f6dbc9800e69565f0090a6a73daa03bde7d2e945b5aa2286c60 |

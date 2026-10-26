# CS-073 / issue #212 — stage 1, build round 1

Implementation commit: `8e6b96f` — `CS-073: UI foundation, tokens, shell, platform logos (#212 stage 1)`.
Branch: `feat/212-ui-foundation`; base: `13c59e3`.
Risk: Heavy. Build role; self-review and adversarial checks completed locally, independent review still required.

Issue: https://github.com/James-Bugden/Content-Studio/issues/212
Parent (read only): https://github.com/James-Bugden/Content-Studio/issues/209
There is no GitHub PR #212 and no open PR for this branch at inspection time. No GitHub writes or push were performed.
This work is held for the database cutover. No merge, deployment, production verification, or issue closure was attempted.

## Delivered scope

1. Cool page/surface/card/line/rail tokens; existing token names and semantic status/PESTO colours retained. Radius scale 8/10/12, one card elevation, type scale and existing tabular-number utility. Nunito Sans uses built-in `next/font/google`, the existing CSS variable, and system/CJK fallbacks. Fonts remain self-hosted at runtime.
2. Desktop charcoal icon rail with small labels, count badges, active states and collapse/expand. One Primary navigation list switches to phone tabs at **800px inclusive**: Next up, Posts, Calendar, Backlog, More. Published, Fix issues and Replies remain available. Existing count source, dirty-navigation guards, no-prefetch policy and skip link are preserved. Top bar includes search presentation, New post, notifications and an account disclosure containing the existing sign-out control. Phone controls are at least 44px; safe-area CSS and viewport-fit cover are included; reduced-motion rules are present.
3. Shared banner slot directly below the top bar. Existing capability configuration supplies the server-rendered default; existing page-specific capability and stale-read messages move into the slot after hydration. React portal unmount removes a departing page's warnings. A no-JavaScript fallback retains page-specific warnings inline. Provider filtering/messages, timestamps, read-only enforcement and retry links are unchanged. Count context remains outside streamed page/editor content.
4. Exported `XLogo`, `LinkedInLogo` and `ThreadsLogo` inline SVGs. Font Awesome Free 6.5.2 brand paths, CC BY 4.0 attribution/source comments. X/Threads are black; only the LinkedIn logo uses brand blue.
5. No extra primitive library or dependency was needed. No data/API/database changes or page-content redesign.

**Top-bar limitation:** there is no existing global-search, blank-post-creation or notification-feed flow in the app. These three new controls are visible but disabled with explanations. The slash is a visual hint only; no search shortcut is bound. A clarification was sent, with no answer during this build. New flows were kept outside this foundation stage's no-behaviour-change scope. The account menu and sign-out remain functional. This limitation needs review before treating those controls as completed product functionality.

## Commands and results

All Vitest, typecheck, Playwright, CSS compilation and Next dev commands used `bash ~/bin/heavy`. Only targeted tests were run. No install or modification of the shared dependency junction occurred.

| Command / check | Result |
| --- | --- |
| `gh issue view 212`, `gh issue view 209`, branch/status/log and read-only PR inspection | Read; clean assigned branch before editing |
| `bash ~/bin/heavy npm run typecheck` | **Failed**: shared dependencies lack `@supabase/supabase-js`, `@electric-sql/pglite` and its contrib module; diagnostics and resulting implicit-any errors are in unchanged Reply/database files. No clean typecheck claimed. A final retry was suspended by the memory governor and its own compiler process was stopped; that retry is incomplete. |
| `bash ~/bin/heavy npm run lint` | **Passed**, including final restored code |
| `bash ~/bin/heavy npx vitest run tests/unit/components/shell-foundation.test.tsx tests/unit/components/app-shell-counts.test.tsx tests/unit/components/navigation-counts.test.tsx tests/unit/components/theme.test.ts tests/unit/components/next-up-page.test.tsx tests/unit/components/review-page.test.tsx tests/unit/components/dirty-guard.test.tsx tests/unit/components/status.test.tsx tests/unit/components/next-up-view.test.tsx --maxWorkers=1` | **41 passed / 9 files**. jsdom emitted its existing document-navigation notices in guard tests. |
| `bash ~/bin/heavy npx vitest run tests/unit/components/shell-foundation.test.tsx tests/unit/security/boundaries.test.ts --maxWorkers=1` after restoring mutations | **9 passed / 2 files** (includes 5 additional security-boundary checks) |
| `node scripts/check-private-paths.mjs`, `node scripts/scan-secrets.mjs` after staging implementation | **Passed**, 667 indexed files |
| `git diff --check` | **Passed** |
| `bash ~/bin/heavy npm run dev -- --port 3327 --hostname 127.0.0.1` | Turbopack refused the external node_modules junction. This server attempt failed. |
| `bash ~/bin/heavy npm run dev -- --webpack --port 3327 --hostname 127.0.0.1` in synthetic mode | Served `/dev/states` successfully; used for visual review and a rendered-shell capture. Stopped its own process tree afterwards. |
| `bash ~/bin/heavy npx playwright test --config=tmp/shell-playwright.config.ts shell-foundation.spec.ts shell.spec.ts fonts.spec.ts` and a targeted foundation retry | **Incomplete, not passed**. Initial requests failed when Turbopack exited; the webpack retry's browser runner was suspended by the memory governor and cancelled. Full application/browser journeys and the revised font spec remain for CI. |
| `bash ~/bin/heavy node tmp/compile-shell.mjs`, then `bash ~/bin/heavy npx playwright test --config=tmp/probe.config.ts` | **4 passed** at 375/800/801/1280. A temporary low-memory harness used the app's server-rendered shell markup and compiled actual `globals.css`, with scripts removed. Verified visible destinations, rail/tab positioning, collapse-control visibility and page overflow. A final run also passed axe on the rail/top bar at all four widths. This is a presentation probe, not a hydrated application T1 pass. |

Temporary probe/config/capture files are ignored under `tmp/`; they are local evidence aids, not application code. The static probe omits font assets/hydration and is not credited as dynamic count, portal, account-interaction or CJK-font verification. Those component behaviours have targeted tests; hydrated browser coverage remains pending.

The shared junction also supplies locally installed Next 16.3.6 and Vitest 5.0.1, which differ from package.json's versions. CI with the locked dependencies remains necessary.

## Adversarial verification and mutations

Used the committed implementation with three lenses: integration/lifecycle, accessibility/responsiveness, and false-green test integrity.

- Integration: tested nested active route, all destinations, retained count source, narrow count-context boundary, banner relocation, stale-read retry target and removal of warnings on page unmount. No provider logic or write paths changed.
- Accessibility: preserved skip link and GuardedLink; tested account Escape/focus restoration; inspected real Chrome gallery on desktop and at 375px. Reviewed exact 1280/375 static shell captures as limited layout evidence. Scoped axe passed on actual compiled rail/top-bar CSS at all four probe widths. Full hydrated-page axe and complete T2 route review are **not passed**.
- Responsive mutation: changed **implementation** `@media (max-width: 800px)` to `300px`, printed the changed rule, recompiled actual CSS and ran the 375px probe. It **failed** because Published/Fix issues/Replies incorrectly remained directly visible. Restored source and reran all four widths: **passed**.
- Banner mutation: changed **implementation** `createPortal(..., slot.target)` to inline rendering, printed the changed return, and ran `bash ~/bin/heavy npx vitest run tests/unit/components/shell-foundation.test.tsx -t 'puts capability' --maxWorkers=1`. The selected test **failed** because Integration status was absent from the shared slot (three unrelated tests intentionally unselected). Restored source; the final two-file component/security run passed.
- Both mutations were restored byte-for-byte; they are absent from the committed implementation.

## Remaining gates / risks

- T0 is not fully green because typecheck is blocked/incomplete; a production build was not run. Missing shared packages must be supplied by the normal dependency owner/CI, without this worktree installing them.
- Run the committed `shell-foundation.spec.ts`, existing shell/nav/font specs and every existing browser journey in CI. New foundation tests include 800/801 boundary checks, large counts, shared banners, phone target sizes, collapse/resize and overflow.
- T2 is partial visual evidence only; complete hydrated-route/accessibility review at 375 and 1280 remains outstanding. Native phone safe-area behaviour has not been physically verified.
- Review the explicitly disabled top-bar controls before calling search/create/notifications functional.
- Heavy independent review remains outstanding. No merge readiness or deployment readiness is claimed; retain the database-cutover hold.

# CS-059c / issue #162 build report, round 1

Date: 2026-10-25 (Asia/Taipei). Classification: Standard; role: build.
Branch: `cs-162-ux`. Base: `9364427b62be94d0c01204e69ce396a9c112f1c2` (`origin/main`, including image actions #178).
Code commit tested (with blockers below): `16517d5f89cdfb119dd0d735f0506053abf913f8`.
Issue: https://github.com/James-Bugden/Content-Studio/issues/162 (open).
Read-only `gh pr view 162` reports no PR with that number. No push, GitHub write, merge, deployment or issue closure performed.

## Approved scope delivered

- A: Post panel automatically fetches the exact-cells preview for the earliest usable slot, including after Approve and queue. Explicit confirmation remains the only write trigger. The full promotion page also defaults to the earliest usable option. Slot options were already date-ascending; sorting now uses date, then configured time, then slot order. Confirmation uses the selected slot's existing British date/time format in all three consumers (post panel, slot panel, full promotion page). A request sequence prevents a slow default preview replacing a later manual selection. Confirm components reset their operation/result state when the target or preview revisions change.
- B: Direct Platform chips on both Library Backlog and Ideas; the existing URL enum validation, pagination reset and dirty-editor guard remain. Filtered Ideas groups open automatically, including when moving between active filter values. Library groups already render inline without a closed disclosure. Posts exposes Target platform and Review status as chips outside Filters; those filters no longer force the secondary Filters disclosure open. Selected chips toggle off, All clears that dimension, and Clear filters remains available.
- C: Operation IDs remain readable inside closed Operation disclosures. Adapter health was already inside closed Diagnostics on this base; retained and covered by the new browser spec. Full-page Fix issues links are unchanged.
- D: Next up renders the existing CapabilityBanner below its title, including on the page error path. Ready integrations remain omitted by the existing component. Shared route skeletons reuse StateView loading copy, surface tokens and reduced-motion handling. Route fallbacks cover Next up, Backlog, Posts, Calendar, Ready queue, Published, Fix issues, Visual studio and Replies. The base already had a text-only studio fallback; it is extended rather than duplicated.

No dependency added. No shared dependency junction modified; no install/ci command run. No scratch checkout or scratch dependency installation created. Fixtures are synthetic. No excluded proposal was implemented.

## Click counts

These are component/code-path counts, not observed browser measurements: local browser startup is blocked below. Each pointer click/tap counts once; selecting an option counts as opening the select plus choosing its value. Start signed in on the named surface.

| Flow | Before | After | Explanation |
| --- | ---: | ---: | --- |
| Schedule an approved post, panel already open | 2 | 1 | Choose slot, confirm becomes confirm; preview is automatic. |
| Schedule from a Next up Schedule action | 3 | 2 | Open panel, choose slot, confirm becomes open panel, confirm. |
| Find a Library Backlog post by platform | 2 | 1 | Open select and choose becomes one chip click. |
| Find Ideas by platform across N matching source groups | 2 + N | 1 | Select costs two interactions; filtered groups now open automatically. With four groups: 6 to 1. |
| Find Posts by target platform from default closed Filters | 3 | 1 | Open Filters, open select, choose becomes one chip click. |
| Fix one issue via a full-page action, one fix action, return to Fix issues | 3 | 3 | Navigation intentionally unchanged; diagnostic folding saves no clicks. Sheet-only fixes vary and are not counted. |
| Review and approve from Next up | 2 | 2 | Open Review, Approve and queue; no auto-advance. |

The research's Backlog prose has an inconsistent general count; its concrete four-group example (6 before) matches the explicit 2 + N breakdown above.

## Copy changes

- `Confirm and write to <Content ID>` becomes `Confirm and write to <existing slot date/time>`, for example `Confirm and write to Thu 1 Oct · 21:00`.
- `Operation <operation ID>` becomes the existing word `Operation` as a disclosure summary, with the unchanged ID inside it.
- All filter labels, values, All, Clear filters, route titles, capability messages and loading copy reuse existing wording. No other product copy introduced.

## Verification

All memory-heavy commands used the shared queue. No full test suite was run.

| Command | Result |
| --- | --- |
| `bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/components` | Final run: 285 tests passed in 32 files; 1 application file failed to load because `@electric-sql/pglite` is absent. Exit 1; overall run is not green. Log: `artifacts-162-units.log`. |
| `bash ~/bin/heavy npx vitest run tests/unit/application/schedule.test.ts tests/unit/components/filter-bar.test.tsx tests/unit/components/reconcile-list.test.tsx` | 36 tests passed in 3 files. Log: `artifacts-162-targeted.log`. |
| `bash ~/bin/heavy npx vitest run tests/unit/components/post-panel-scheduling.test.tsx` | 3 tests passed; final required-directory run also includes this file. Log: `artifacts-162-panel-unit.log`. |
| `bash ~/bin/heavy npm run typecheck` | Blocked/failing: missing shared `@supabase/supabase-js`, `@electric-sql/pglite` and resulting implicit-any errors in existing Replies/database files. No errors reported in changed files. Exit 1. Log: `artifacts-162-typecheck.log`. |
| `bash ~/bin/heavy npm run lint` | Final run clean, exit 0, no warnings. Log: `artifacts-162-lint.log`. |
| `bash ~/bin/heavy npx playwright test tests/e2e/ux-polish.spec.ts tests/e2e/panel.spec.ts tests/e2e/schedule.spec.ts tests/e2e/backlog.spec.ts tests/e2e/backlog-pagination.spec.ts tests/e2e/review.spec.ts --project=w375 --project=w1280` | Blocked before any browser test: repository-config production build rejects the node_modules junction. Turbopack: `Symlink [project]/node_modules is invalid, it points out of the filesystem root`. Exit 1. Log: `artifacts-162-playwright.log`. |
| Same Playwright command with `--list` | 120 tests discovered in 6 files across w375/w1280; exit 0. Discovery is not a test pass. Log: `artifacts-162-playwright-list.log`. |
| `node scripts/check-private-paths.mjs`; `node scripts/scan-secrets.mjs`; `git diff --cached --check` | Clean before code commit. |

New regression coverage: chronological options with reversed Sheet input; one-click chip filtering/removal and dirty guard; closed support details; automatic preview with zero writes; explicit write with captured revisions; late preview race; no-slot state. Browser specs extend existing scheduling/Backlog selectors and add default preview, one-click filtering, automatic Ideas disclosure opening, removable Posts filters, closed health and unchanged full-page fix action checks. New UX checks require zero axe violations and no horizontal page overflow at both configured widths.

## Screenshots and remaining verification

No screenshots were generated: production server startup failed before browser launch. No screenshot is committed. The added spec writes these paths through Playwright `testInfo.outputPath` when run successfully (the following are expected output globs, not existing evidence):

- `test-results/ux-polish-*/schedule-preview.png`
- `test-results/ux-polish-*/backlog-platform.png`
- `test-results/ux-polish-*/backlog-ideas-filtered.png`
- `test-results/ux-polish-*/posts-filters.png`
- `test-results/ux-polish-*/fix-issues.png`

The test-result directories include the project (`w375` or `w1280`). Logs and test artifacts are ignored and remain local.

T1, axe, agentic T2 visual review/screenshots, zoom/keyboard browser review and production-build verification remain blocked, not passed. CI must run these specs with complete dependencies before this change can be called verified or merge-ready. No production behavior or deployment is claimed. No native/device behavior changed; physical-device checks were not run. Builder self-review covered the staged diff, explicit confirmation, preview races, URL/dirty guards, disclosure defaults, token/copy reuse and excluded scope; no independent review or multi-agent work was performed in this build round.

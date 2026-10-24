# Issue #128 build report — round 1

- Issue: https://github.com/James-Bugden/Content-Studio/issues/128
- Classification: Standard. Role: build. Branch: `cs-128-backlog-window`.
- Base: `de41746`; implementation commit: `bcf509a5450431a6eb309ff8f3e098eb039c3ba4`.
- Tested production-mode Next build ID: `Z3cDHj5HXAH341UoMMQOv`.
- Environment: Windows, local loopback port 3288, synthetic Sheet/Drive/providers,
  Chromium at 375 and 1280 CSS px; live Chrome for agentic UX inspection.
- No push, PR creation, merge, deployment or issue closure performed, as requested
  for this local build handoff. No existing PR was returned for this branch.

## Change and review

The current base already paginates Content Library posts at 40 rows and filters
and sorts the whole inventory before slicing. Reused that implementation rather
than replacing it. Added an exact-2,000-row synthetic test seed and Playwright
coverage of the actual DOM, including the hidden responsive representation.

Fixed two reproduced keyboard defects: search page controls unmounted during
loading, and the PESTO select lost focus when disabled during saving. Page
controls now remain mounted with guarded `aria-disabled` activation. The select
still disables writes while saving and restores focus only when focus fell to
the document body; it does not reclaim focus from another control.

Self-reviewed the actual diff against the issue and atomicity contract. No
schema or production API changes. Mutation authentication, validation, operation
IDs, expected revisions, stale-read handling and audit behavior are unchanged.
The additional seed option remains behind the existing fake/e2e-only test gate.

## Acceptance evidence

| Criterion | Status and evidence |
| --- | --- |
| Bounded DOM with 2,000 synthetic rows | PASS: 50 pages, 40 visible records, 40 `tbody` rows and 80 total record elements including the hidden mobile/desktop representation. The next page remains bounded. |
| Global filters/search/sort and existing edits | PASS: search from page 2 finds `SYN-B1988`, absent from the original DOM; X filter plus descending Sheet sort brings that distant row first. Consecutive PESTO saves persist through filtering/search. Existing Backlog edit/navigation/dirty-guard flows pass at both widths. |
| axe and recorded T2 review | axe PASS: no WCAG 2 A/AA or 2.1 AA violations on the 40-record and distant-search views at both widths. T2 agentic review RECORDED below, with the native-zoom limitation explicitly retained. |

TDD: wrote the browser regressions before production changes. On the base they
failed for lost pagination focus and the missing 2,000-row seed. After the first
fix, both widths exposed the PESTO focus defect. After its fix and added boundary
and focus-noninterference assertions, all four acceptance cases passed.

## Commands and results

All Vitest, typecheck, lint, Playwright and child Next builds ran through
`bash ~/bin/heavy`; no full suite was run.

| Command | Result |
| --- | --- |
| `gh issue view 128 --json title,body,state,url`; `gh pr list --head cs-128-backlog-window --json number,state,url`; Git status/log inspection | Issue open, branch initially clean on supplied base, no PR for branch. Required policy/spec/atomicity files read. |
| `bash ~/bin/heavy npm ci --no-audit --no-fund` | PASS: installed 466 locked packages locally after safely removing only this worktree's dependency junction. No manifest/lockfile edits; shared target untouched. |
| `bash ~/bin/heavy npx playwright test tests/e2e/backlog-pagination.spec.ts --project=w1280` | Setup failed: Turbopack rejected the original shared dependency junction. Not a regression-test pass. |
| `bash ~/bin/heavy npx playwright test --config=tmp/playwright.local.config.ts tests/e2e/backlog-pagination.spec.ts --project=w1280` | Setup recovery attempts first encountered the same junction error, then a missing Supabase dependency, then Webpack's unrelated Replies `node:crypto` import error. After local install and restoring the normal Turbopack build, the intended two red tests ran and failed as described above. |
| `bash ~/bin/heavy npx playwright test --config=tmp/playwright.local.config.ts tests/e2e/backlog-pagination.spec.ts` | Intermediate: 2 passed / 2 failed at the newly exposed PESTO focus assertion. Final run after fixes and stronger assertions: **4 passed**, no skips, 26.7 seconds. |
| `bash ~/bin/heavy npx playwright test --config=tmp/playwright.local.config.ts tests/e2e/backlog-pagination.spec.ts tests/e2e/backlog.spec.ts` | **65 passed, 1 existing skip**, 2 minutes; normal production-mode build passed. The existing long-post table test skips at 375 px and passes at 1280 px; the skip is not counted as a pass. All new acceptance checks and existing edit flows passed. |
| `bash ~/bin/heavy bash -lc 'npx vitest run tests/unit/domain/library-backlog.test.ts tests/unit/domain/library-backlog-sort.test.ts tests/unit/domain/backlog-navigation.test.ts tests/unit/application/backlog.test.ts && npm run typecheck && npx eslint src/components/backlog/library-backlog-explorer.tsx src/components/backlog/library-pesto-field.tsx src/app/api/test-control/route.ts tests/e2e/backlog-pagination.spec.ts'` | PASS: 4 files / **34 unit tests**, typecheck and targeted lint. |
| `bash ~/bin/heavy bash -lc 'npm run typecheck && npx eslint src/components/backlog/library-backlog-explorer.tsx src/components/backlog/library-pesto-field.tsx src/app/api/test-control/route.ts tests/e2e/backlog-pagination.spec.ts'` | PASS after final test-only strengthening. |
| `bash ~/bin/heavy npx playwright test --config=tmp/qa.config.ts` | Temporary idle server harness for live Chrome review; its final trace cleanup failed because the concurrent acceptance run replaced the default artifact directory. This helper failure is not counted as a passed check. Acceptance results and copied screenshots remain available. |
| `node scripts/check-private-paths.mjs`; `node scripts/scan-secrets.mjs`; `git diff --cached --check` | PASS on staged implementation, including the new test file. |

The ignored local Playwright config uses repository settings and the normal
`npm run build` / `npm run start`, with port/base URL changed to 3288. The final
four-case retest reused that exact built server. Temporary browser bootstrap HTML
was removed before committing. No other worktree was edited or process killed.

## T2 agentic UX review — 2026-10-24

Inspected live Chrome screenshots and accessibility state at 375, 500, 750 and
1280 CSS px with 2,000 synthetic records. Filters wrap, search stays accessible,
phone cards fit, and desktop scrolling stays within the table region. Confirmed
80 record elements and no document-level horizontal overflow. The desktop table
retains its existing horizontal scroll for the wide column set.

On the phone layout, searched for synthetic post 1,988, opened its existing
editor, inspected copy and controls, then closed it. Focus returned to the Edit
link and the private search remained intact without entering the URL. Live
browser console inspection returned no warnings or errors.

Reviewed the 640 × 450 CSS-pixel reflow equivalent of a 1280 × 900 viewport at
200% zoom: the result card and controls remain usable with no horizontal document
overflow. Browser zoom shortcuts had no observable effect in this automation
runtime, so this is **reflow-equivalent evidence, not a claimed native 200% zoom
pass**.

Synthetic screenshots are retained locally (ignored):
`artifacts/cs128/backlog-375.png` and `artifacts/cs128/backlog-1280.png`.

## Unresolved risks and limits

- Native browser 200% zoom remains unverified; responsive/reflow-equivalent
  evidence is recorded separately above.
- The temporary UX server helper had the artifact-cleanup failure described
  above; it was not a product acceptance test. Dedicated output directories
  should be used if running concurrent Playwright processes in future.
- The DOM bound is 40 visible records / 80 responsive record elements, not 40
  total elements. Full-inventory server reads/readiness calculation are unchanged;
  this does not establish a production provider latency improvement.
- Full-suite CI, independent PR review and deployment verification are outside
  this unpushed build handoff. T3/T4 were not run: no provider contract, native
  hardware or deployment behavior changed. Existing provider atomicity residual
  windows remain as documented in `docs/implementation/atomicity.md`.

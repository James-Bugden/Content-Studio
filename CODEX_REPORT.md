# CS-054 build report: #140 and #154

- Tier / role / round: Standard / build / 1. Date: 2026-10-24.
- Branch: `cs-140-work`, assigned worktree only.
- Baseline: `bb40bcb49872ad5463069736b0cb662e7a4a468a` (`origin/main` at start).
- Implementation SHA: `ddf84745e3a2bc5ad21aaafd2bed742066c6eb10`.
- This report is committed separately after the implementation. Nothing was pushed. No PR, merge, deployment or issue closure was performed.
- Issues: [#140](https://github.com/James-Bugden/Content-Studio/issues/140), [#154](https://github.com/James-Bugden/Content-Studio/issues/154).
- Prerequisites present: stale recovery `2083ba4` (#144), paging `7f33aec` (#136), protected fixes `bb40bcb` (#160).

## State inventory and changes

All listed routes inherit shared `StateView` loading and a styled unexpected-error boundary. Expected provider failures use the existing catalogue. No new workflow screen, provider read, write path or source of truth was introduced.

| Surface | Loading / error / empty / stale outcome |
| --- | --- |
| Backlog posts | Search loading, error and no-match use shared states. Empty Library and filtered-out posts are distinct. Cold failures use `ErrorState`. Stale results use the existing warning `InlineResult`, with shared empty/no-match states where needed. |
| Backlog ideas | Empty Queue and no filter match are distinct. Read failures use `ErrorState` with query-preserving retry. |
| Review / Posts | Existing shared typed errors, empty Library, no-match and partial Schedule-failure states retained. |
| Ready | Existing shared errors/empty queue retained; empty groups now use shared empty states. |
| Schedule / Calendar | Same `/schedule` surface. An unreadable Schedule now fails visibly instead of becoming an empty calendar. Successful empty date ranges use shared empty states across week/month/list. Other board consumers retain Library-only fallback. |
| Published | Existing typed errors, empty/no-match and per-row sync freshness retained. No cached-data fallback added. |
| Visuals | Existing errors/provider warning retained; empty subsections use shared states. |
| Fix issues | Unreadable-source state retained. “Everything agrees” is suppressed when sources are unreadable. Empty diagnostics use a shared state. |
| Editors / panels | Existing shared loading/errors retained. Network rejection now reaches the error state instead of staying on Loading. Adjacent-post loading/error feedback and empty hook alternatives use shared components. AI error wording is unchanged. |

The Backlog page owns its panel host and passes the server's read-only decision on first render. The layout host excludes Backlog. A URL-opened stale post therefore never mounts an editor. Stale totals cannot trigger a follow-up request after earlier edits.

Cached rows now carry their original read timestamp. The banner formats it in Taipei time. Retry retains the query string, including the post; a fresh successful read can open that post. Disabled Edit actions retain exactly their live row names. The five-minute cap, fallback codes and mutation behaviour are unchanged.

`/dev/states` additionally demonstrates route loading and all typed AI errors. Recovery landmarks use their existing headings, fixing duplicate names found by axe. The read-audit contract was updated.

## Acceptance

| Criterion | Status / evidence |
| --- | --- |
| #140: no bare errors or empty results presented as real data | PASS for inventoried flows. Shared states and provider/network failure regressions cover the gaps found, including Calendar and Fix issues. |
| #140: states spec at both widths; T2 recorded | PASS: 34 states-spec cases across 375 and 1280; visual review below. |
| #154: no `/editor` request for URL-opened stale post | PASS for both fallback codes at both widths. Also asserts zero search/totals requests while stale. |
| #154: preserved Retry query; timestamp; axe | PASS: exact href, restored editing, timestamp, unchanged action names and zero axe violations. Unit tests prove unchanged cutoff/original timestamp without extra reads. |
| Protected #160 tests | Unchanged: `tests/e2e/backlog.spec.ts` and `tests/e2e/ai.spec.ts`. Existing keyboard/bulk tests were run without editing them. |

## Commands and results

Every Vitest, TypeScript and Playwright invocation used `bash ~/bin/heavy`. No full suite or package installation was run.

| Command | Result |
| --- | --- |
| `bash ~/bin/heavy npx vitest run tests/unit/google/sheets-stale-read.test.ts tests/unit/components/state-view.test.tsx tests/unit/components/conflict-recovery.test.tsx tests/unit/application/board-posts.test.ts` | PASS: 4 files, 49 tests. Includes age/read counts and Calendar-required reads versus Library-only fallback. |
| `node tmp/cs140-static.mjs` | PASS: ESLint on 29 changed TypeScript files. Ignored helper generates a scoped tsconfig extending the repository config, using changed files as roots with incremental output disabled. |
| `bash ~/bin/heavy npx tsc --noEmit -p tmp/tsconfig.states.json` | PASS: changed files and imported dependencies. |
| `bash ~/bin/heavy npx tsc --noEmit` | BLOCKED / FAIL: missing shared `@supabase/supabase-js` and `@electric-sql/pglite` packages, plus consequent unrelated implicit-any errors. Not a full typecheck pass. |
| `bash ~/bin/heavy npx playwright test tests/e2e/states.spec.ts tests/e2e/backlog-stale.spec.ts` | BLOCKED: default production-build server failed with `ENOSPC` on C:. Not a production-build pass. |
| `bash ~/bin/heavy npx playwright test --config tmp/playwright.states.config.ts tests/e2e/states.spec.ts tests/e2e/backlog-stale.spec.ts` | Test runner PASS: 40 tests, 2.4 minutes, both widths, zero axe violations. Log: `tmp/cs140-final-e2e.log`. Runner JSON reported passed/no failed tests. PowerShell's redirected native stderr returned wrapper exit 1 for a `NO_COLOR` warning despite successful tests. |
| `bash ~/bin/heavy npx playwright test --config tmp/playwright.states.config.ts tests/e2e/backlog.spec.ts --grep 'keyboard review\|bulk pass\|moves across page'` | Keyboard review/bulk pass: 4 PASS at both widths. Paging initially failed because an edit changed the count separator's encoding; original line bytes were restored. |
| `bash ~/bin/heavy npx playwright test --config tmp/playwright.states.config.ts tests/e2e/backlog.spec.ts tests/e2e/states.spec.ts --grep 'moves across page\|Backlog distinguishes'` | Final correction retest: 4 PASS, exit 0. Paging, private search, retry, error feedback and dirty guard work at both widths. |
| `git diff --exit-code -- tests/e2e/backlog.spec.ts tests/e2e/ai.spec.ts` | PASS: protected files unchanged. |
| `git diff --cached --check`; `node scripts/check-private-paths.mjs`; `node scripts/scan-secrets.mjs` | PASS before implementation commit, including new staged files. |

Earlier selector/assertion mistakes, duplicate Recovery names, Calendar's hidden read failure and the encoding error were corrected. An earlier Chrome/axe process crash was rerun successfully. Earlier red runs are not counted as passes. The final count-only correction was covered by the four-case retest above.

Local browser configuration inherits fake-provider/auth settings and width projects, uses installed Chrome on loopback port 34140, and starts `next dev --webpack`. `NODE_PATH` points to the existing dependency junction. Traces are off; test output/Chrome temporary profiles use `D:/codex-cs140-verify`. This is an ignored local workaround, not deployment configuration.

## T2 UX review

Inspected rendered synthetic screenshots at 375 and 1280: shared patterns, English/CJK wrapping, state hierarchy, stale banner, disabled controls and Retry. Stale views additionally exercised 500, 750 and CSS 200% zoom. No page-level horizontal overflow; the existing wide Backlog table remains its own scroll region. States have visible labels/glyphs and readable recovery copy. Retry remains usable. The stale panel stays closed and opens after fresh recovery.

Local evidence: `artifacts/states-gallery-{375,1280}.png`, `states-patterns-{375,1280}.png`, `stale-backlog-{375,500,750,1280}.png`, `stale-backlog-zoom.png`. Screenshots are synthetic and uncommitted. Gallery/panel tests assert no unhandled page errors; expected network failures are deliberately injected. This is emulated desktop-Chrome evidence, not physical-device or deployed-build evidence.

## Copy

- New production fragment: `(as of HH:MM Taipei)` in the existing stale sentence; timezone matches product conventions.
- New gallery-only labels: `Route loading`, `AI errors`.
- Other messages/actions/names reuse shared defaults, catalogue wording or the same surface's existing text. No ad-hoc recovery wording was added.

## Risks and handoff

- Full typecheck and production build remain blocked as above. CI and a production-build retest with complete lockfile dependencies are required before merging. No green-CI claim is made.
- Shared installed tools differ from some manifest pins, including Next 16.3.6. Browser evidence used Chrome 155.0.8059.85 and Node 24.15.0. Installed Next error/loading and server/client guides were read; the boundary uses `retry` to re-fetch.
- `node_modules` remains the original MAIN junction, untouched. No other worktree or unrelated Node process was changed. Only task-owned servers were stopped.
- Ignored `.next` and screenshot output were moved to `D:/codex-cs140-verify` with junctions because C: filled up. Helpers/artifacts remain locally available. Next's generated AGENTS.md addition was restored after test servers stopped.
- Standard build self-review completed. Independent PR review, CI, deployment and post-merge verification remain for the next phase. T3/T4 were not required for these browser state changes and were not performed.
- Publish one PR for this branch when authorised, with both closing references:

```text
Closes #140
Closes #154
```

# CODEX_REPORT — CS-046 / issue #127

- Role: build; tier: Standard; round: 1.
- Branch: `cs-127-stale`, in the supplied isolated worktree.
- Verified implementation SHA: `bfbd8c63f7783b4b4bd57f65efcae80c2a5b6f5b`.
- Base: `63153aa` (shared Sheets read cache, #135).
- Issue: https://github.com/James-Bugden/Content-Studio/issues/127
- This report is a separate documentation commit after the verified implementation.
- No push, PR creation, merge, deployment, issue closure, installation, or changes to another worktree.

## Result

Reused the shared Sheets read-cache entries for last-good Library recovery. Backlog posts fall back only for RATE_LIMITED / PROVIDER_UNAVAILABLE and only when the snapshot is under five minutes old. Selection performs zero provider reads. Ordinary reads still observe their existing TTL, including zero display retention in fake mode. Failures do not extend snapshot age. Existing invalidation and in-flight identity checks remain intact.

The stale page uses the shared warning InlineResult and a Retry link, disables Edit post and inline PESTO changes, and blocks panels opened via URL. It shows a bounded read-only inventory rather than starting search/editor requests. A successful Retry restores editing. Cold starts and other error codes retain the current error screen. Mutation reads continue to bypass the cache; a regression proves a failed fresh precondition writes nothing. The states gallery includes the warning. Axe exposed an empty shared table header; it now has an accessible Actions label.

## Acceptance

| Criterion | Status | Evidence |
| --- | --- | --- |
| AC1: fallback selection unit test; injected RATE_LIMITED banner and disabled editing | PASS | Targeted cache/fallback tests; Playwright verifies rows retained, disabled Edit post, no PESTO edit or URL-opened dialog, then successful Retry. PROVIDER_UNAVAILABLE is also covered. |
| AC2: cold start plus failure retains error screen | PASS | Unit test and both browser projects show Try again and no inventory. |
| AC3: established copy/component conventions and axe | PASS | Shared InlineResult warning and states gallery demo; zero axe violations in both browser projects. Responsive warning/Retry and CSS 200% zoom checked. |

## Commands and results

All heavy commands ran through `bash ~/bin/heavy`. No dependency installation and no full test suite. The known #133 bulk Save & next test was neither edited nor run.

- `bash ~/bin/heavy npx vitest run tests/unit/google/sheets-stale-read.test.ts tests/unit/google/sheets-read-cache.test.ts` — PASS, final run 24 tests across 2 files. Covers eligible errors, cold start, other errors, age boundary, failure age, valid empty cache, live TTL expiry, write isolation, coalescing, invalidation races and provider counts.
- `bash ~/bin/heavy npx tsc --project tmp/tsconfig.stale.json --noEmit` — PASS. Temporary config extends root tsconfig with incremental disabled; includes next-env and only the ten changed TS/TSX entry files plus their imported dependencies.
- `bash ~/bin/heavy npx eslint 'src/app/(studio)/backlog/page.tsx' src/app/dev/states/page.tsx src/application/ports.ts src/components/backlog/backlog-navigation.tsx src/components/backlog/library-backlog-table.tsx src/components/backlog/stale-backlog-banner.tsx src/components/panel/panel-host.tsx src/integrations/google/sheets-repository.ts tests/unit/google/sheets-stale-read.test.ts tests/e2e/backlog-stale.spec.ts` — PASS.
- `bash ~/bin/heavy npx playwright test tests/e2e/backlog-stale.spec.ts` — BLOCKED at default production-build startup: Turbopack rejects node_modules junction pointing outside its filesystem root. No test ran in that attempt.
- `bash ~/bin/heavy npx playwright test --config tmp/playwright.stale.config.ts tests/e2e/backlog-stale.spec.ts` — PASS, final run 6/6 (w375 and w1280), 42.7 seconds, synthetic fake adapters. First temporary config attempt needed explicit root cwd. First completed browser run found the empty header; fixed and rerun twice successfully, including the final code/copy.
- `node scripts/check-private-paths.mjs` and `node scripts/scan-secrets.mjs` — PASS, 500 tracked files after staging implementation.
- `git diff --cached --check` — PASS before implementation commit.

Local Playwright workaround, untracked `tmp/playwright.stale.config.ts`:

```ts
import config from '../playwright.config';
export default {
  ...config,
  testDir: '../tests/e2e',
  webServer: {
    ...config.webServer,
    cwd: process.cwd(),
    command: 'npx next dev --webpack --port 3200 --hostname 127.0.0.1',
    reuseExistingServer: false,
  },
};
```

Playwright owned and stopped its local server. Next dev generated a policy block in AGENTS.md; that generated-only change was restored after the server stopped, preserving the original policy. The repository Playwright configuration and dependency junction are unchanged.

## Review and T2 evidence

Builder self-reviewed the complete diff, eligibility, expiry, invalidation races, mutation preconditions, cold/empty states, recovery and panel gating. No independent review is claimed in this build role.

Browser assertions cover widths 375/500/750/1280, no document overflow, accessible Retry, CSS body zoom 200%, and no pageerror events. Agent visually inspected synthetic screenshots at 375, 1280 and 200% zoom: warning text wraps, Retry remains readable, and editing controls appear disabled. Local evidence is ignored: `artifacts/stale-backlog-{375,500,750,1280}.png`, `artifacts/stale-backlog-zoom.png`. Wide inventories retain the existing horizontal table scrolling. These are emulated browser/CSS zoom checks, not physical-device evidence.

## Risks and limits

- Recovery is implemented for Backlog posts first. Ideas, other lists and editor/API reads retain their existing failure behaviour.
- Snapshots are process-local, disposable, and usable for recovery for less than five minutes; deploys/restarts/another instance can still have no good snapshot.
- The stale inventory is the existing bounded page; private search/editor controls are unavailable until a successful fresh read. Retry returns to the main Backlog URL.
- Existing Sheet read/write atomicity limits are unchanged. Every actual mutation still checks fresh authoritative state.
- Production build verification is blocked by the existing Turbopack/junction setup. Targeted types/lint and Webpack development-server browser verification passed; no production or deployed-build claim.
- No live account/provider, T3/T4, CI or deployment verification was performed. Those are outside this local build-only handoff. No owner action is needed to review this commit.

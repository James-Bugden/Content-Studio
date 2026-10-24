# CS-044 / PR #165 — fix round 1

Standard fix on `cs-93-work`, in the assigned worktree. Starting local/remote
head: `2e8ed979922945d87113e9bf776c0cbbf6c1f088`.
Implementation commit: `ffcf32dbbbf384f7abea0c53610e000415ff0d3e`.
This report is committed separately so it can name the exact code commit.
Final production build: `LhCedZxIk7A6-Itc9qJse`.

Read AGENTS.md, MASTER-SPEC.md, issue #93, PR #165 and the implementation/QA
procedures. Inspected all four failed shard logs, saved under the requested
local evidence directory, and downloaded shard 1/3 trace artifacts. No push,
other-worktree change, shared dependency change, merge or deployment occurred.

## Root causes and fixes

**Duplicated Backlog controls/count text and calendar month grid:** the new
counts provider surrounded the entire shell, including streamed page content
and editor boundaries. Its asynchronous state/context update could render the
page on the client before the server stream fragment had been adopted. CI's
duplicates are the live page plus its hidden streamed copy, not two badge
spans or responsive table/card representations. The calendar trace shows
`S:0` hidden before the counts response at monotonic time 104297 ms, and both
the live month grid in `main` and the hidden `S:0` month grid at 104407 ms.
Backlog's duplicate Source selects have client `_r_0_` and server `_R_...` IDs.
The calendar failure happens at the visibility assertion, before any overflow
measurement. No phone CSS change or assertion workaround was warranted.

The provider now wraps only the primary navigation list. Count fetches,
retries and expiry updates cannot propagate context through the page/editor.
A new shell regression passes with this boundary and fails against the exact
old shell (the page receives the navigation count). Existing end-to-end
assertions and their readiness/dirty-guard checks are unchanged.

**Missing Next up badge at both widths:** every completed Sheet read received
a new cache generation, even when its rows were identical. The home trace
records the existing thumbnail render request and automatic Review/Calendar
prefetches; these refresh the zero-retention fake cache after the board load,
invalidating its count witness. The original badge failure reproduced locally.
The cache now preserves the witness only for identical completed snapshots.
Pending, failed, changed and mutation-invalidated snapshots remain unknown.
The endpoint also returns the original total's expiry, so an identical refresh
cannot extend its 15-second life. The endpoint still performs zero provider
reads; no loader fallback or new polling was added. Known zero remains zero,
and unknown remains no number.

The existing stale-witness unit assertion is retained; its fixture now actually
changes a source row before refreshing it. New cases cover identical refresh,
original expiry, pending reads and changed snapshots. Cache retention, provider
call counts and mutation semantics remain unchanged.

## Per-failure status

Each listed case passed in its complete file at both projects and then **3/3
consecutive repeats per project**. Calendar's phone describe explicitly sets
375 px even when selected through the desktop project.

| CI failure | Root cause | Final status |
| --- | --- | --- |
| `backlog-pagination.spec.ts:28`, duplicate 2000-post total | Shell context crossed streamed page boundary | Passed; bounded rows, search, filters, sorting and edits retained |
| `backlog.spec.ts:74`, duplicate 57-post total | Same streamed-page duplication | Passed; cross-page editor/search/dirty guard retained |
| `backlog.spec.ts:144`, duplicate Source control | Same streamed-page duplication | Passed; Library filter and separate Ideas view retained |
| `backlog.spec.ts:453`, phone sort entry failure | Same duplicate total before sorting | Passed; both desktop header sort and phone controls retained |
| `calendar.spec.ts:150`, duplicate month grid | Same streamed-page duplication; not measured overflow | Passed; original no-horizontal-overflow assertion retained |
| `navigation-counts.spec.ts:9`, missing expected 8 | Identical existing reads invalidated cache witnesses | Passed; Next up 8, blocking Fix issues 2, reuse, viewport and axe checks |

## Verification and commands

Used a throwaway source copy with its own `npm ci`, because the worktree's
shared dependency junction did not match the lockfile. No install ran in this
worktree. Final dependencies match the lockfile: Node 24.15.0, Next 16.4.1,
React 19.3.0, Playwright 1.63.0. All data/providers/screenshots were synthetic.
Byte-compared changed code and all four requested specs between the copy and
the assigned worktree before acceptance. Every heavy command used the shared
queue. No full suite ran.

Commands below run from the source copy. `playwright.built.config.ts` spreads
the repository config and changes only the reporter to list and server startup
to `npm run start -- --port 3200 --hostname 127.0.0.1`, with reuse disabled.
The production build is created separately with the exact synthetic environment
from playwright.config.ts. Both widths and all repeats use the same build,
one worker and zero retries.

```bash
bash ~/bin/heavy npm ci
bash ~/bin/heavy npx vitest run tests/unit/navigation-counts.test.ts tests/unit/components/navigation-counts.test.tsx tests/unit/components/app-shell-counts.test.tsx tests/unit/http/navigation-counts-route.test.ts tests/unit/google/sheets-read-cache.test.ts --maxWorkers=1
bash ~/bin/heavy npx eslint src/components/app-shell.tsx src/application/navigation-counts.ts src/integrations/google/sheets-repository.ts tests/unit/navigation-counts.test.ts tests/unit/components/app-shell-counts.test.tsx
CS_DATA_MODE=fake CS_TEST_MODE=e2e CS_FAKE_TODAY=2026-09-30 AI_PROVIDER=fake AUTH_SECRET=e2e-only-auth-secret-not-a-real-value-000000 APP_BASE_URL=http://127.0.0.1:3200 bash ~/bin/heavy npm run build
CI=1 bash ~/bin/heavy npx playwright test tests/e2e/backlog-pagination.spec.ts tests/e2e/backlog.spec.ts tests/e2e/calendar.spec.ts tests/e2e/navigation-counts.spec.ts --project=w375 --config=playwright.built.config.ts
CI=1 bash ~/bin/heavy npx playwright test tests/e2e/backlog-pagination.spec.ts tests/e2e/backlog.spec.ts tests/e2e/calendar.spec.ts tests/e2e/navigation-counts.spec.ts --project=w1280 --config=playwright.built.config.ts
CI=1 bash ~/bin/heavy npx playwright test tests/e2e/backlog-pagination.spec.ts tests/e2e/backlog.spec.ts tests/e2e/calendar.spec.ts tests/e2e/navigation-counts.spec.ts --project=w375 --project=w1280 --config=playwright.built.config.ts --grep '2,000 posts|across page 1/2|Content Source filter|headers sort|month view fits|cached Next up' --repeat-each=3
```

| Check | Final result / local evidence under `D:/wt/briefs/cs` |
| --- | --- |
| T0 targeted unit/route/cache | 5 files, **34 passed**, exit 0; `165-final-t0.log` |
| Targeted ESLint | Exit 0; `165-lint.log` |
| Production build, including TypeScript | Exit 0; `165-final-build.log`; build ID above |
| Full requested files, w375 | **49 passed, 1 existing skip**, exit 0; `165-final-w375.log` |
| Full requested files, w1280 | **50 passed**, exit 0; `165-final-w1280.log` |
| Six previously failing cases, 3 repeats at each project | **36 passed**, no skips/retries, exit 0; `165-final-loops.log` |
| Boundary regression against old shell | Expected failure, exit 1; `165-shell-before.log`; source restored before final checks |
| T2 scoped responsive review | Inspected final 375/1280 navigation and 375 Backlog screenshots; badges, More menu and content fit; original overflow/axe journeys passed. `165-screens-w375`, `165-screens-w1280` |
| Public repository checks | Private-path policy, changed-file secret scan and `git diff --check` passed |

The existing skip is Backlog's desktop-only long-post case at w375; it passed
at w1280 and is not counted as a phone pass. The original duplicate symptoms
did not recur in the local baseline; their evidence comes from CI traces/logs.
The missing-badge baseline did fail locally. An experimental blocked-JavaScript
probe prevented Next's whole initial bootstrap in both versions and was
discarded; no assertion or workaround from it is included in the change.

## Risks and cleanup blocker

Counts remain best effort per process, cache-only and limited to the original
15-second lifetime. Identical-snapshot comparison adds bounded in-memory JSON
comparison work, without provider calls. Full CI and deployed/live-provider
verification remain outside this no-push fix round; no T3/T4 pass is claimed.

Automatic approval review rejected recursive removal of the verified scratch
directory and a narrower removal of only its `node_modules`, stating only
"blocked by policy". No active scratch Node process remains, but cleanup is
**blocked, not complete**: the source/dependency copy remains at
`~/tmp/cs165-fix-r1`. The worktree's original node_modules junction is unchanged.
Logs, scripts/config and synthetic screenshots were preserved in the requested
local evidence directory. No deletion safeguard was bypassed.

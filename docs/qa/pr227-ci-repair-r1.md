# UI foundation CI repair, build round 1

2026-10-27. Standard change on `feat/212-ui-foundation`, based on
`f6335be59dff174bb6698d6ace82ef1ecfcd04bd`.
Scope: the supplied rescope for [PR #227](https://github.com/James-Bugden/Content-Studio/pull/227),
continuing [#212](https://github.com/James-Bugden/Content-Studio/issues/212).
Local synthetic Next build: `mBGLmgblcC3y81p7ZQB-J`.

## Changes and acceptance

- The mobile overflow menu has `display: none` by default. Only an open
  disclosure below the 800px breakpoint displays it. Desktop secondary links
  retain their existing phone-only hiding rule. Tests cover one accessible copy
  of each destination, including resizing an open menu across 800/801px.
  Existing accessible names, rail collapse, badges and keyboard behavior remain.
- Fixed a second duplication cause exposed by the fault sweep: the status-slot
  ref synchronously updated context around a still-streaming page. This could
  leave an unhydrated copy in Next's hidden `S:0` container, duplicating raw
  provider-state selectors and label-based editor selectors. The provider now
  holds a stable ref; each banner resolves its own portal destination on mount.
  The small, documented effect-lint exception applies only to synchronizing that
  banner with its DOM destination. The provider never updates on attachment.
- New browser regression visits the editor and Typefully detail repeatedly and
  requires one raw selector match, an editable editor and one navigation landmark.
  Existing fault and cutover assertions were retained without visibility filters.
- The gallery's long-heading action can legitimately fall below the fold after
  the font/status-slot redesign. Its layout test scrolls it into view before
  requiring the whole button in the viewport; page overflow checks remain.
- `/reconcile`, `Run content import` and `DatabaseSwitchPanel` are unchanged.
  Existing import/recovery and owner-confirmation journeys pass at both widths.

## Verification

Windows; synthetic fake/PGlite providers only. Every heavy command used
`bash ~/bin/heavy`; Vitest and Playwright used one worker. No full repository
suite was run. All `tests/unit` files were covered in bounded groups:

| Vitest scope | Result |
| --- | --- |
| `tests/unit/components` | 29 files, 247 tests passed |
| `tests/unit/application tests/unit/security tests/unit/supabase` | 57 files, 1,406 tests passed |
| `tests/unit/{ai,auth,domain,google,http,replies,typefully,visuals}` (expanded paths) | 41 files, 654 tests passed |
| Eight explicit `tests/unit/*.test.ts` root files | 8 files, 296 tests passed |
| Final shell component/counts retest after the provider fix | 2 files, 5 tests passed |

Total unit coverage: 135 files, 2,603 tests, plus the final targeted retest.
`npm run typecheck`, `npm run lint`, private-path policy, secret scan and
`git diff --check` passed.

Browser commands use `CS_E2E_PREBUILT=1` and `--workers=1`:

- `playwright test tests/e2e/shell-foundation.spec.ts tests/e2e/shell.spec.ts tests/e2e/navigation-counts.spec.ts --project=w375 --project=w1280`: 48 passed.
- `playwright test tests/e2e/sweep-faults.spec.ts --project=sweep-fault-375 --project=sweep-fault-1280 --grep 'PROVIDER_UNAVAILABLE|FORBIDDEN'`: 4 passed.
- With `CS_E2E_CONTENT_STORE=db-read`: `playwright test tests/e2e/content-read-cutover.spec.ts tests/e2e/database-switch.spec.ts --project=w375 --project=w1280`: 10 passed.
- With `CS_E2E_CONTENT_STORE=db`: `playwright test tests/e2e/content-write-cutover.spec.ts tests/e2e/markdown-authority.spec.ts --project=w375 --project=w1280`: 6 passed.

T1 includes labels, focus, dirty-edit protection, axe, overflow, 200% zoom and
375/500/750/800/801/1280px layouts. Synthetic screenshots at 375 and 1280 were
visually inspected: phone tabs/More and desktop rail fit, with the Database
switch panel intact. Emulated layout is not physical-device evidence.

Local setup: the original `node_modules` junction points at an older install.
Verification temporarily used the existing dependency tree in worktree `163`
(Next 16.4.1 / Vitest 5.0.3), then restored the original junction. Turbopack
needed a temporary common root for that junction; `next.config.ts` was restored
after the build. A Webpack attempt failed on the pre-existing Replies
`node:crypto` client import; the normal Turbopack build passed. No dependency,
lockfile, runtime config or Replies changes are included.

Raw local logs and synthetic screenshots are under ignored `tmp/ui-foundation/`.
No push, `gh`, remote mutation, merge or deployment was performed. Full browser
shards, remaining sweep codes and deployment verification remain CI work; this
record does not claim remote CI is green.

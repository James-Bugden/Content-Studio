# CS-050 / issue #133 — build round 1

Scope: Standard product-race fix on `cs-133-flaky`, based on
`de41746e9397d2928c060fe5c9c3491a07847dd5` (origin/main at task start).
Issue: https://github.com/James-Bugden/Content-Studio/issues/133
No open PR exists for this branch. No push is authorised.

Implementation commit: `efc2d8dc0fd13d20c27568102ed026c1b796f38a`
(`CS-050: Advance after the saved draft reaches the leave guard`).
The report is committed separately so it can name the exact implementation SHA.

## Root cause (established before changing product code)

The failed CI report from run 40090685117, shard 1, shows a successful
`POST /api/library/SYN-L001/draft` (HTTP 200), followed by both the saved-copy
message and an unexpected **Leave without saving?** dialog. The copy is saved;
navigation is blocked by stale dirty state. This is a product race, not an
editor-readiness/test race or a failed provider write.

`PostEditor.attemptSave` queues React state updates and calls `onSaved`
immediately. `PanelHost.onDraftSaved` guesses that two animation frames are
enough for `useDirtyGuard`'s passive effect to publish the clean state. React
does not guarantee that commit/effect ordering relative to animation frames.
Under CI load, guarded navigation reads the old dirty store and opens the
leave dialog. Waiting before the initial keyboard action cannot fix this race.

The CI evidence is particularly specific: the draft request completed with
HTTP 200 in 12.93 ms; the failure snapshot shows **Matches the saved version**,
the successful save message, disabled Save/Undo controls, and the leave dialog.
The next editor's prefetch also returned HTTP 200. No save-readiness wait or
provider retry is indicated by that evidence.

## Change

`PostEditor` now emits its once-per-save success notification in an effect
registered after `useDirtyGuard`, after React commits the saved base and the
dirty-store effect runs. `PanelHost` then uses the normal guarded navigation
directly. Removed the two-animation-frame guess; added no sleeps or retries.

Three synthetic component regressions cover callback/guard ordering, repeated
saves and callback replacement, newer edits during an in-flight save, and failed
saves. All e2e specs, their assertions, Playwright timeouts and retry settings
are unchanged.

## Environment and commands

Windows / Git Bash; Node 24.15.0; Playwright 1.63.0 bundled Chromium;
production Next.js 16.3.6 server, synthetic providers, 375 x 812 viewport.
The final Backlog file campaign uses build ID `4Uf2-GWFdTqHAA904VS_o`.
All Playwright, Vitest, ESLint and typecheck commands used `bash ~/bin/heavy`.
No full test suite was run.

| Check | Command | Result |
| --- | --- | --- |
| CI investigation | `gh run view 40090685117 -R James-Bugden/Content-Studio --log-failed`; downloaded shard-1 report with `gh run download` | Confirmed successful save followed by stale dirty confirmation. |
| Unchanged-source local loop | `bash ~/bin/heavy npx playwright test tests/e2e/backlog.spec.ts --project=w375 --grep 'bulk pass:' --repeat-each=20 --workers=1 --max-failures=1` | 20/20 passed (1.3m). The intermittent browser failure did not recur locally. |
| Deterministic regression before fix | `bash ~/bin/heavy npx vitest run tests/unit/components/post-editor-save.test.tsx` | Expected red: 1 failed, 2 passed. Success callback observed `[true]` dirty state instead of `[false]`. |
| T0 regression after fix | `bash ~/bin/heavy npx vitest run tests/unit/components/post-editor-save.test.tsx tests/unit/components/dirty-guard.test.tsx` | 8/8 passed (2.81s). |
| Targeted lint | `bash ~/bin/heavy npx eslint src/components/editor/post-editor.tsx src/components/panel/panel-host.tsx tests/unit/components/post-editor-save.test.tsx` | Passed, exit 0. |
| Targeted types | `bash ~/bin/heavy npx tsc --project tmp/cs-133/tsconfig.json --noEmit` | Passed, exit 0. Config extends repository tsconfig and includes only the two changed source files, regression file and next-env.d.ts. |
| Fixed single-test acceptance loop | `CI=1 bash ~/bin/heavy npx playwright test tests/e2e/backlog.spec.ts --project=w375 --grep 'bulk pass:' --repeat-each=20 --workers=1 --max-failures=1` | 20/20 passed (1.1m), zero retries. |
| Fixed whole-file campaign | `CI=1 bash ~/bin/heavy npx playwright test tests/e2e/backlog.spec.ts --project=w375 --repeat-each=20 --workers=1 --max-failures=1` | All 20 file runs completed: 600 passed, 20 pre-existing skips (9.9m), exit 0. Bulk pass passed 20/20 in its original file order. |
| Public-repo checks | `node scripts/scan-secrets.mjs src/components/editor/post-editor.tsx src/components/panel/panel-host.tsx tests/unit/components/post-editor-save.test.tsx CODEX_REPORT.md`; `node scripts/check-private-paths.mjs`; `git diff --check` | Clean. |

`CI=1` above denotes the environment; it was set as `$env:CI='1'` in
PowerShell. The shared queue governs each heavy command; the Playwright config
builds the production server inside that queued command. Playwright retains
`fullyParallel: false`, `workers: 1`, and `retries: 0`, matching CI. The
whole-file campaign preserves the original file order, including the keyboard
review immediately before bulk pass. The complete four-shard suite is left to
CI, as instructed to run targeted files only.

Each file run had 30 passes and one existing skip: the wide-table-only long-post
test at line 620 deliberately skips below 768 px. Those skips are not claimed
as passes or as desktop verification. No new skip was introduced.

The generated targeted typecheck config is reproducible at
`tmp/cs-133/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.json",
  "include": [
    "../../src/components/editor/post-editor.tsx",
    "../../src/components/panel/panel-host.tsx",
    "../../tests/unit/components/post-editor-save.test.tsx",
    "../../next-env.d.ts"
  ],
  "exclude": ["../../node_modules", "./ci-report"]
}
```

Initial browser launches were blocked by the pre-existing shared dependency
junction (Turbopack disallows its external target), then by an incomplete shared
dependency copy and a temporary backup junction being included by TypeScript.
These were setup failures, not browser passes. Resolved with a worktree-local
`npm.cmd ci --ignore-scripts --no-audit --no-fund` (466 packages) and removal of
the temporary backup link. No dependency manifests or other worktrees changed.

During regression development, the added second-save assertion exposed a test
fixture reusing an already-consumed mock Response (1 failed / 7 passed).
Returning a fresh Response per request fixed the fixture; the final T0 result
above includes that repeated-save assertion.

## Acceptance and handoff

- Root cause: established from CI before product edits and reproduced by the
  failing component regression; documented here for the eventual PR.
- Exact single test: 20 consecutive passing local w375 runs after the fix.
- Full-file repetition: all 20 w375 file runs completed without failures;
  bulk pass passed in all 20, with 600 passes overall and the 20 existing
  wide-table-only skips explicitly excluded from the pass count.
- No other e2e spec weakened: no e2e file or Playwright config was edited.
- Self-review: product diff is limited to save notification timing
  and removal of the animation-frame delay; the normal dirty guard is retained.
- No push, PR creation, merge, deployment or issue closure performed.

## Risks and limits

Low-risk change to the shared editor's success-callback timing. Callbacks now
run after commit rather than immediately after receiving the server response.
New text typed while a save is in flight must still trigger the leave guard;
the regression explicitly verifies this. No server mutation, revision,
idempotency, authentication or caching behavior changed.

Evidence is synthetic local T0/T1, not live-provider, physical-device or
production verification. No new layout, visual design or device integration is
introduced. The CI scheduling failure itself was not reproduced by the local
browser baseline; its stale-guard cause was reproduced deterministically at the
component boundary. A PR/CI run remains for the subsequent shipping round.

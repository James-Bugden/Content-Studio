# Post panel polish — build round 1

Scope: task/PR 241, `fix/241-panel-polish`, based on `d2f7bda20a14f99019c3228a50878ada2031209d`. Standard change. Local commit only; no push or deployment.

## Acceptance coverage

- **241-1:** Removed the database/Drive explanatory sentence. Markdown authority coverage now asserts its absence and retains the save, import, failure and authority checks.
- **241-2:** Compaction normalises excessive blank lines, joins hard wraps, preserves lists and the hook paragraph boundary, and groups short body paragraphs into at most three sentences. The toolbar reports the number of breaks removed briefly. Generated Chinese, selected hook bodies and saved platform versions use the same function. The master draft remains exact on a normal save. Tests cover word order, idempotence, Chinese, lists, hook separation and source-hash freshness.
- **241-3:** Request changes remains available with unsaved copy or approval blockers, including previously approved posts. Its returned revision advances the editor's next save precondition without discarding the local copy. Approval still applies to saved content. Readable reasons sit beside approval controls, with a direct save action and links to the relevant checks. Copyright and duplicate decisions can be edited through the existing guarded field endpoint.
- **241-4:** Both the lightweight Backlog panel and general post panel show an inline Image section: saved verdict, editable reason, brief, status and actions. The structured brief, screenshot selection, rendering and exact-revision review are available inline; the full editor remains linked. Collapsing the controls preserves unsaved briefs, and conflicting image decisions wait until those edits are saved. Reasons use the existing image next-action field, preserve workflow stamps and are encoded to prevent stamp injection.

## Verification environment

Synthetic providers only. Chromium at 375 and 1280 CSS pixels; the existing platform-version journey also checks intermediate widths and accessibility. No live Content, Drive or Typefully mutations.

Every memory-heavy command ran through `bash ~/bin/heavy`, with one Vitest worker. The local dependency junction requires a temporary Turbopack root at the parent worktree directory for production builds; `next.config.ts` is restored byte-for-byte afterwards. Browser checks use the same production build with a temporary single-server Playwright config inheriting the repository's fake-provider environment, reducing memory use without changing tests or assertions.

Production build identity: `zZc70jNgGI7MQ1MPpCYLf`. Build, explicit typecheck and lint passed.

Final results (all final commands exited 0):

| Check | Result |
| --- | --- |
| Production build, explicit typecheck, lint | Pass |
| Entire `tests/unit/application`, `tests/unit/components`, `tests/unit/security`, plus format, hooks and visual-service regressions | 73 files, 863 tests passed |
| DB browser journeys: panel polish, panel, Markdown authority and platform versions | 36 passed at 375/1280 |
| Legacy browser regressions: Backlog, editor, review and Markdown authority | 100 passed at 375/1280 |
| Screenshot/UX review and serious/critical accessibility checks | Pass; no horizontal overflow in the checked views |

The Supabase directory was also exercised in the earlier combined 102-file run. No Supabase test failed; that run's application schema failure was corrected and is covered by the final green application run above.

Commands:

```sh
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
bash ~/bin/heavy npx vitest run tests/unit/application tests/unit/components tests/unit/security tests/unit/domain/format.test.ts tests/unit/ai/hooks.test.ts tests/unit/visuals/services.test.ts --maxWorkers=1
CS_E2E_CONTENT_STORE=db bash ~/bin/heavy npx playwright test --config=tmp/241.playwright.config.ts tests/e2e/panel-polish.spec.ts tests/e2e/panel.spec.ts tests/e2e/markdown-authority.spec.ts tests/e2e/post-versions.spec.ts --project=w375 --project=w1280
CS_E2E_CONTENT_STORE=sheet bash ~/bin/heavy npx playwright test --config=tmp/241.playwright.config.ts tests/e2e/backlog.spec.ts tests/e2e/editor.spec.ts tests/e2e/review.spec.ts tests/e2e/markdown-authority.spec.ts --project=w375 --project=w1280
```

Local logs are `tmp/241-{typecheck,lint,unit,e2e-db,e2e-sheet}.log`. Synthetic screenshots are `test-results/panel-polish-w375.png` and `test-results/panel-polish-w1280.png`. These artifacts and the temporary Playwright config are intentionally uncommitted. The same target files can also run with the repository config and `CS_E2E_PREBUILT=1` after building.

Live-provider integration and production smoke were outside this local build round.

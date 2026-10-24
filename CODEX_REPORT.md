# CS-058b / issue #157 — build round 1

Issue: https://github.com/James-Bugden/Content-Studio/issues/157

Standard change on `cs-157-e2e-race`, based on
`7f33aec117e1b538970262b2171b65bb1c6a5bad` (origin/main at task start).
Implementation: `fcc50974318f96675fde79be95a1dc19ced6e767`
(`CS-058b: guard editor hydration and wait for selected keyboard targets`).
This report is committed separately so it can identify the exact code commit.
Final production build: `ERu1JW7cRkpN_pM47_n9Y`.

## Root causes, established before product edits

Read AGENTS.md, MASTER-SPEC.md, the issue, implementation/QA procedures,
the requested editor/guard/test/CI files, the earlier report133 analysis, and
`git log -p -3 -- src/components/editor/post-editor.tsx src/components/panel/panel-host.tsx`.
Inspected both failed Actions logs and downloaded their shard-3 report traces.
PR #142 is merged; there was no PR for this branch at task start. Neither failure
below reaches a save, so changing the dirty-store protocol would address the
wrong cause. The earlier Save & next notification ordering remains intact.

### Backlog keyboard review — test readiness race

Run https://github.com/James-Bugden/Content-Studio/actions/runs/40094603013
fails at the third shortcut, ArrowDown, in the initial navigation loop, before
typing or Ctrl+S. J and K succeeded. The trace records K at 39255 ms, the URL
assertion for SYN-L001 at 39263 ms, then a successful visibility assertion at
39275 ms whose snapshot still contains SYN-L002's textarea (`_r_5_`).
The test focuses Close and sends ArrowDown at 39286 ms. SYN-L001's new editor
(`_r_a_`) mounts during that action and runs its intended autofocus effect.
ArrowDown consequently targets a textarea; the typing guard correctly ignores
it, and the URL remains SYN-L001. There is no dirty-confirmation dialog or save
failure involved.

`history.replaceState` makes the URL observable before React replaces the keyed
panel. A generic visible textarea is therefore insufficient readiness evidence.
The test now waits for the selected post's position and focused copy before
moving focus to Close. Initial opening also waits for copy focus. Every shortcut,
URL, save, dirty-guard and exact-copy assertion is retained; readiness is stronger.

### AI ENQA-01/02 — editable SSR/hydration race

Run https://github.com/James-Bugden/Content-Studio/actions/runs/40092721197
fails at the unchanged-copy assertion, before accepting any finding or saving.
Its trace starts `fill()` at 29437 ms against the server-rendered textarea.
The fill finishes at 29665 ms with the requested QA text prepended to the entire
original draft, rather than replacing it. QA correctly checks that malformed
input; it did not append or apply anything itself.

The textarea advertised editability before React hydration owned its controlled
value and selection. Filling across that boundary can lose the selection and
insert into the original value. This is a product readiness race, not an AI
finding/rebinding or post-save race. A deterministic regression holds all Next
JavaScript requests while inspecting the SSR copy: the old build fails because
the textarea is editable. The server-render component regression also fails
before the fix (1 failed, 3 passed).

`PostEditor` now uses stable `useSyncExternalStore` hydration snapshots: read-only
on the server and during hydration, editable for the owner after hydration.
Client-only panel mounts remain immediately editable; viewers remain read-only.
The browser regression releases its request barrier, waits for editability,
fills exact replacement text and verifies the dirty notice. Its cleanup drains
route handlers. There are no test sleeps, added retries or timeout increases.

## Verification environment and commands

Windows / Git Bash, Node 24.15.0, Playwright 1.63.0 / bundled Chromium.
Final dependencies match package-lock.json, including Next.js 16.4.1,
React 19.3.0 and zod 4.6.6. All providers and screenshots are synthetic.
Every Playwright, Vitest, TypeScript, ESLint and Next build invocation ran inside
`bash ~/bin/heavy`. Only targeted test files ran; no full suite ran.

Final browser commands use `tmp/cs-157/playwright.built.config.mjs`, which spreads
the repository config, sets `testDir: '../../tests/e2e'`, `outputDir: './results'`,
and changes only webServer startup to
`npm run start -- --port 3200 --hostname 127.0.0.1`, with reuse disabled.
The production build was made separately through heavy using the synthetic
environment from playwright.config.ts. Both final campaigns therefore test the
same build without recompilation. Widths, browser, reduced motion, timeouts,
fake-provider environment, `fullyParallel: false`, one worker and zero retries
match CI. Target files retain CI's relative order (AI before Backlog); the
unrelated remainder of shard 3 is left to CI.

| Check | Command / evidence | Result |
| --- | --- | --- |
| CI investigation | `gh run view 40094603013 -R James-Bugden/Content-Studio --log-failed`; same for `40092721197`; `gh run download` shard-3 reports | Root causes above. |
| Unchanged product baseline | `CI=1 bash ~/bin/heavy node node_modules/@playwright/test/cli.js test --config=tmp/cs-157/playwright.built.config.mjs tests/e2e/ai.spec.ts:54 tests/e2e/backlog.spec.ts:499 --repeat-each=10 --workers=1 --max-failures=1` | 40/40: each original failing test 10/10 at each width. Intermittent CI symptoms did not recur. Preliminary shared dependency versions; not final acceptance. |
| Regression before fix | `bash ~/bin/heavy node node_modules/vitest/vitest.mjs run tests/unit/components/post-editor-save.test.tsx`; browser `ai.spec.ts:31 --project=w1280` against the old build | Expected red: SSR textarea editable, both at component and browser boundaries. Initial browser barrier teardown also reported an error; cleanup now drains handlers. |
| Final T0 | `bash ~/bin/heavy node node_modules/vitest/vitest.mjs run tests/unit/components/post-editor-save.test.tsx tests/unit/components/dirty-guard.test.tsx` | 9/9 passed on lockfile versions. Existing once-per-save, newer-edit-during-save, failure and dirty-navigation cases retained. |
| Final targeted types | `bash ~/bin/heavy node node_modules/typescript/bin/tsc --project tmp/cs-157/tsconfig.json --noEmit` | Passed, exit 0. Config extends root tsconfig; includes the four changed code/test files and next-env.d.ts. |
| Final targeted lint | `bash ~/bin/heavy node node_modules/eslint/bin/eslint.js src/components/editor/post-editor.tsx tests/e2e/ai.spec.ts tests/e2e/backlog.spec.ts tests/unit/components/post-editor-save.test.tsx` | Passed, exit 0. |
| Production build | `bash ~/bin/heavy node node_modules/next/dist/bin/next build`, with Playwright's synthetic environment | Passed, exit 0; compile and TypeScript checks enabled. Build identity above; log `tmp/cs-157/build-lockfile.log`. |
| Final single-test campaign | Exact command below. | 120/120 passed, exit 0 (3.3m test time). Each original failing test passed 30/30 consecutive runs at w375 and 30/30 at w1280. Log `tmp/cs-157/final-loops.log`. |
| Final full target files | Exact command below; both complete files, both projects, same config and one worker | 85 passed, 1 existing skip, exit 0 (1.2m). AI: 12/12 at each width. Backlog: 30 passes plus the existing desktop-only skip at w375; 31/31 at w1280. Log `tmp/cs-157/final-full-files.log`. |
| Responsive review | Synthetic editor/QA/hook screenshots at 375 and 1280, inspected visually; exact edit/save and focus/guard interactions exercised in browser tests | Controls and copy remain readable, no horizontal clipping. Screenshots stay ignored under `tmp/cs-157/screens`. |
| Public-repository checks | `node scripts/scan-secrets.mjs src/components/editor/post-editor.tsx tests/e2e/ai.spec.ts tests/e2e/backlog.spec.ts tests/unit/components/post-editor-save.test.tsx CODEX_REPORT.md`; `node scripts/check-private-paths.mjs`; `git diff --check` | Passed. |

Single-test acceptance command (Git Bash):

```bash
CI=1 HEAVY_MIN_FREE_MB=2000 bash ~/bin/heavy node node_modules/@playwright/test/cli.js test --config=tmp/cs-157/playwright.built.config.mjs tests/e2e/ai.spec.ts tests/e2e/backlog.spec.ts --grep 'ENQA-01/02|keyboard review:' --repeat-each=30 --workers=1 --max-failures=1
```

Complete target files, after the successful 30-run campaign:

```bash
CI=1 HEAVY_MIN_FREE_MB=1500 CS_SHOT_DIR=tmp/cs-157/screens bash ~/bin/heavy node node_modules/@playwright/test/cli.js test --config=tmp/cs-157/playwright.built.config.mjs tests/e2e/ai.spec.ts tests/e2e/backlog.spec.ts --workers=1 --max-failures=1
```

The existing long-post test at backlog.spec.ts:623 deliberately skips widths
below 768 px; its desktop execution passed. That skip is not counted as a pass.
Neither original failing test nor the new hydration regression was skipped.

### Setup failures and additional evidence (excluded from acceptance)

The initial node_modules junction pointed into the main checkout and lacked
required packages. No npm install/ci ran and no shared dependency contents were
written. It was replaced by worktree-local dependencies copied from that source;
identical immutable package files share hardlinks to conserve disk space.
Missing and mismatched local package directories were restored from lockfile
tarballs after integrity verification. Old package directories were moved into
the local node_modules exclusion before the final build. Manifests/lockfile and
other worktrees were not changed.

Early startup attempts encountered a missing package, disk exhaustion and a
TypeScript scan of temporary dependency backups. These were setup failures,
never browser passes. Automatic review also blocked generated-cache/archive
deletion; work continued without those deletions.

A preliminary fixed campaign passed 120/120 (each test 30/30 per width) using the
older shared Next.js 16.3.6 dependency. It is excluded from final acceptance.
After lockfile alignment, the first full-file run stopped with 68 passed,
1 failed, 1 existing skip and 16 not run. The failure was Backlog's second-inline-
edit test: its stylesheet request failed with `net::ERR_NO_BUFFER_SPACE`, so both
desktop and phone rows were visible and the locator correctly rejected two
matches. There was no edit request. Socket counts were far below the Windows
dynamic-port limit; free physical RAM was about 1 GB. This is host buffer/resource
pressure, not a changed locator/product contract. Assertions remain unchanged;
the final campaign requests a larger free-memory reserve from the shared queue.
The installed queue caps its free-memory wait, so the requested reserve is not
a guarantee of available RAM; host resource pressure remains a local limitation.

## Acceptance and limits

- [x] Root cause per original failing test: documented above for the eventual PR.
- [x] Each original failing test 30 consecutive final runs per width: passed
  (ENQA w375 30/30, ENQA w1280 30/30, keyboard w375 30/30, keyboard w1280 30/30).
- [x] Both full target files after the fix at both widths: all applicable cases
  passed; the pre-existing desktop-only mobile skip is accounted for above.
- Self-review: scoped hydration gate and condition-based keyboard readiness;
  shared dirty store, leave dialogs, mutation envelopes, conflict checks,
  idempotency and provider behavior are unchanged.
- No push, PR creation, merge, deployment or issue closure was performed.

The change intentionally keeps copy read-only until its React handlers are ready.
Evidence is local synthetic browser/component verification, not live-provider,
physical-device or deployed-build verification. A shipping/CI round remains
outside this build-only request.

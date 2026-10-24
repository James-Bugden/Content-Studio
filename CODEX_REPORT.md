# CS-061b / PR #178: fix round 1

Requested code fixes are complete locally. Production-config verification and
owner T4 acceptance remain open; no deployment or merge readiness is claimed.

- Issue: https://github.com/James-Bugden/Content-Studio/issues/164
- PR: https://github.com/James-Bugden/Content-Studio/pull/178
- Review: https://github.com/James-Bugden/Content-Studio/pull/178#issuecomment-6388252123
- Classification: Standard; existing scoped feature, no new surface or dependency.
- Branch: `cs-164-img`, this worktree only; clean at start.
- Starting local/remote HEAD: `2254815797c0f261befb5feb7391571218541150`.
- Verified code/docs/tests commit: `71457433803ae9616551103678b7677a92ddb5ec`.
  This report is committed separately afterwards. No application/test changes
  followed final verification.
- Date: 2026-10-25, Asia/Taipei. Windows; Node `24.15.0`, installed Next `16.3.6`,
  Vitest `5.0.1`, Playwright `1.63.0`. Shared installed versions differ from the
  manifest; no installation or shared-checkout modification was attempted.

## State and scope

Read AGENTS.md, MASTER-SPEC.md, issue #164, implementation/QA skills, prior
`D:/wt/briefs/cs/report164.md`, PR body/review comments, the owner T4 document,
repository test/server configuration and affected implementation/tests.
Self-reviewed the final diff against the review.

Read-only GitHub commands:

```text
gh pr view 178 -R James-Bugden/Content-Studio --comments
gh issue view 164 -R James-Bugden/Content-Studio
gh pr view 178 -R James-Bugden/Content-Studio --json body,headRefName,headRefOid,baseRefName,state
```

`git fetch origin` succeeded. Fetched `origin/main` was
`544d9c9cd74e69967bca1a8ced7f01e1f24ad6f1`;
`git merge-base --is-ancestor origin/main HEAD` exited 0. Main was already
included, so no merge was needed. No rebase, push, GitHub write, other-worktree
operation, dependency change, install/ci, merge or deployment occurred.

Review item 2 was already corrected in the live PR body: it uses `Refs #164`
and includes acceptance, verification and risk sections. Its older local report
pointer can now be replaced by this repository report by the coordinator;
this local-only round did not edit the PR.

## Fixes and evidence

1. **Published provider reads:** list cards render no image. The existing
   `/published/[contentId]` detail alone retains the Schedule image/actions.
   Unit coverage checks that distinction; browser checks observe zero Schedule
   asset requests on the list and exactly one on detail, plus authentication.
3. **Thumbnail preparation:** shared PostThumb covers calendar, backlog, home,
   queue and review. Loading creates no canvas/PNG File. First pointer entry,
   focus, touch or click prepares from already-loaded bytes, including intent
   before load. Repeated intent reuses the File; drag enables after preparation.
   Source/filename changes remount and discard old state; unmounted async
   preparation is ignored, canvas storage is zeroed after encoding and pending
   download URLs are revoked on unmount. Full previews own preparation/actions.
   Cached-image hydration/StrictMode effect replay no longer duplicates encoding.
4. **Visuals duplicates:** one action group and one polite transfer status on
   the saved full-size preview. The 360/390 px copies only display the image,
   without preparation, actions, drag File or transfer status. Browser assertions
   count one action group, one transfer status, two phone previews and one encode.
5. **Live draft decision:** only saved Library/Schedule images are transferable.
   The live brief preview has no Copy/Download/Share, PNG preparation or drag.
   A one-line hint states the rule. Saved rendered revisions retain exports;
   this does not add an approval requirement to saved assets.
6. **Unsupported clipboard:** visible polite-status text explains the missing
   capability and Download fallback; `aria-describedby` associates it with
   disabled Copy. Unit coverage checks both text and association.
7. **Filenames:** Library slug metadata reaches thumbnails and panel previews.
   Non-ASCII (including mixed English/zh-TW) or empty slugs fall back to the
   unique content ID. Unit tests distinguish two IDs with the same zh-TW slug;
   browser tests verify slug-based panel export and zh-TW ID fallback in both
   thumbnail drag and panel Download. Schedule has no slug field, so Published
   detail uses Content ID without another Library/provider read.
8. **Surviving mutations:** added out-of-order completion on the same mounted
   image and Share cancellation versus genuine-error tests. Both requested
   mutations now fail their regression, as detailed below.

The [owner T4 document](docs/testing/image-transfer.md) now describes these
behaviours and adds checklist checks. All external-app/device results are pending.

## Verification commands and results

All memory-heavy commands used `bash ~/bin/heavy`. Only full affected unit
directories and the image-transfer browser spec ran, never the full suite.
Tests used synthetic fake providers only.

| Check | Exact command | Final result |
| --- | --- | --- |
| Full affected unit directories | `bash ~/bin/heavy npx vitest run tests/unit/components tests/unit/domain tests/unit/visuals tests/unit/typefully tests/unit/application --maxWorkers=2 --silent` | **545 passed, 49 files**, exit 0, 31.78s. |
| T0 lint | `bash ~/bin/heavy npx eslint . --max-warnings=0` | **Passed**, exit 0; no warnings. |
| Typecheck | `bash ~/bin/heavy npx tsc --noEmit` | **Blocked**, exit 2: shared install lacks existing Supabase/PGlite packages and declarations; resulting existing Replies/Supabase errors. No final diagnostic in changed files. |
| Production-config browser run | `bash ~/bin/heavy npx playwright test tests/e2e/image-transfer.spec.ts --project=w375 --project=w1280` | **Blocked before tests**, exit 1: Turbopack rejects the node_modules junction outside its filesystem root. No production artifact validated. |
| Local development T1/UX evidence | `bash ~/bin/heavy npx playwright test --config=C:/Users/jbbug/AppData/Local/Temp/cs164-pr178-r1/local.config.ts --project=w375 --project=w1280` | **12 passed**, exit 0, 1.5m; no skipped or expected failures. Development evidence, not production/CI acceptance. |
| Policy | `node scripts/check-private-paths.mjs`; `node scripts/scan-secrets.mjs`; `git diff --cached --check` | **Passed** for staged code and repeated with this report. |

Missing shared packages are `@supabase/supabase-js`, `@electric-sql/pglite` and
its `contrib/pg_trgm` declarations, already present in the manifest/lockfile.
No package was installed to work around this environment.

Final unit/browser/typecheck output was redirected to disposable scratch logs
in the shell; result codes were preserved. The outside-repo browser config
imported repository projects/settings, restricted execution to the committed
image-transfer spec and replaced only the server with a fake-provider Webpack
dev server at normal port 3200. Exact server command:

```text
node node_modules/next/dist/bin/next dev --webpack --port 3200 --hostname 127.0.0.1
```

Playwright owned and stopped the server; no unrelated Node process was killed.
Port 3200 had no listener afterwards. Next dev's generated AGENTS.md append was
restored to the original bytes. The absolute scratch target above was checked;
its five known files were deleted individually, then the empty directory was
deleted. `Test-Path` returned false. No scratch config, log or dependency was
added to the repository, and package/lockfile diffs against remote are empty.

Earlier verification caught and resolved an outdated exact Thumb expectation,
a duplicate encode during hydration, a ref-cleanup lint warning and a test-only
canvas-context typing error. The first local browser run was 10/12 with encode
count assertions red; final 12/12 includes that fix. The table records final results.

### Mutation proof

Each mutation changed only `src/components/image-transfer.tsx`, was verified
to apply, ran separately and was restored in a `finally` block. The normal
affected-directory run subsequently passed against restored code. Filtered-out
tests in these experiments are not counted as acceptance passes.

| Mutation | Exact test command | Result |
| --- | --- | --- |
| Replace `if (!alive.current || current !== generation.current) return;` with `if (!alive.current) return;` | `bash ~/bin/heavy npx vitest run tests/unit/components/image-transfer.test.tsx -t 'ignores a stale preparation' --maxWorkers=1` | **Killed**: Vitest exit 1, stale 13-byte File exported instead of latest 27-byte File. |
| Remove the `AbortError` conditional before Share error feedback | `bash ~/bin/heavy npx vitest run tests/unit/components/image-transfer.test.tsx -t 'leaves the polite status unchanged' --maxWorkers=1` | **Killed**: Vitest exit 1, cancellation changed the status to an error instead of retaining the previous status. |

### Browser/visual scope and remaining acceptance

At both widths the spec checks real native dragstart File-only privacy,
controlled receiver File identity, actual clipboard PNG read-back, PNG
name/signature and SVG-derived 1080 x 1080 dimensions, Download, keyboard
activation, capability-gated file-only Share, duplicate/live preview restrictions,
lazy thumbnail encoding, Published request counts/detail authentication, no
document overflow and zero axe violations on Visuals and the thumbnail list.

Agent screenshot review covered full-size actions, display-only phone copies
and the live-draft hint at 375/1280. Buttons fit and text is readable; oversized
previews stay inside labelled scroll regions. Synthetic PNGs remain ignored
in `test-results/`. Interactive CUA T2 was unavailable: its in-app browser was
unavailable and browser inventory was empty. Screenshot review and deterministic
browser UX checks are the available T2 evidence; no separate live exploratory
pass is claimed. Touch/focus unit coverage is not physical-phone/T3 acceptance.

AC1/AC4 have local development browser evidence. AC2 has controlled-event File
receipt only. Chromium native cross-frame File loss remains documented; real
cross-site/external composer receipt is unproven. AC3's checklist is updated,
with every owner T4 target pending. CI at this new code commit, a deployed build,
Safari/Firefox and physical-phone Share remain unverified. Issue #164 must stay
open pending the required acceptance/post-merge verification.

# #243 image pipeline — build round 1

Heavy / build role. Branch `feat/243-image-pipeline`; parent `d2f7bda`.
Verified synthetic Next build ID: `9XcrJnSTmzGv7Jeuh4UP5`.
Scope and acceptance IDs: `docs/implementation/image-pipeline.md`, IMG-1–IMG-7.
The owner's supplied A–D contract is the implementation baseline.

## Result

Copyright no longer participates in gates, approval, review filters, backlog
pills, next steps or Needs Fix summaries. Its DB column and import mapping
remain intact, including unknown imported values.

The bounded Backlog table and phone cards support selection and image checks.
Image-required posts get a persisted ASCII sketch; both post panels support
approval, revision notes and creation. Approval starts rendering. Bulk creation
refuses unapproved/stale plans per row. Existing images are retained until a new
asset is linked. Image writes use the existing DB CAS, ledger and audit path.

The original Python tool is bundled with its authored catalogue, presets and
OFL fonts. Only `make.py`'s explicit output-directory guard is adapted for the
system temporary directory. All other renderer code/catalogue/preset/font files
were compared with the supplied originals. No samples or generated outputs are
in the bundle. The mapper chooses from the original catalogue; Python performs
the final format, copy, glyph and geometry validation.

PNG previews use the authenticated Drive asset route. Final visual approval
checks the stored digest against the exact Drive bytes. Image mutations refresh
a clean editor and invalidate prefetched editors, preserving unsaved writing.
Pipeline posts refuse the historical SVG render/draft-preview paths, preserving
the sketch approval and original Python renderer requirements.

## Verification

All memory-heavy commands ran through `~/bin/heavy`; Vitest used one worker.
No full repository test-suite command was run. Only the required directories
and targeted regressions were executed.

| Check | Evidence |
| --- | --- |
| Required application/Supabase/security/component directories plus gates/backlog/Visuals | First corrected run: 108 files / 1,826 passed. Final sweep: 1,828 passed and one stale CI-command assertion failed after adding the image journey. That assertion now requires all three DB journeys; the entire security directory plus image application regressions then passed: 15 files / 177 tests, exit 0. No unresolved failures. |
| Follow-up UI and integration regressions | 38 files / 329 tests passed, then 18 files / 189 tests passed after editor refresh/PNG preview changes. Final render-gate, Visuals, image application, board and security retest: 21 files / 238 passed, exit 0. |
| Python handler | 4 tests passed, including the original real PNG renderer, PNG dimensions/mode/digest, strict copy errors, missing/wrong secret, real HTTP malformed/oversized requests and temporary cleanup. |
| TypeScript | `npm run typecheck` passed. |
| ESLint | `npm run lint` passed. |
| Production Next build | Normal Turbopack build passed using a temporary local filesystem-root setting for the shared `node_modules` symlink. `next.config.ts` was restored without a committed change. |
| T1 DB fake-provider browser flow | Final build: 4 tests passed, exit 0, across 375 and 1280 px: selection, per-row decisions/summary, approve-and-create, decoded PNG preview, bulk creation, partial failure and viewer restrictions. |
| T2 | Inspected synthetic selection/sketch screenshots at 375 and 1280 px. Layout checks passed at 500/750 px and 200% CSS zoom emulation; scoped axe returned zero violations. Real synthetic Python PNG inspected at full size. No physical-device evidence is claimed. |
| Private-path and secret scans | Clean after staging code and bundled assets. Negative scanner fixtures in unit-test output are intentional synthetic tests. |

Core commands:

```sh
bash ~/bin/heavy npx vitest run tests/unit/application tests/unit/supabase tests/unit/security tests/unit/components tests/unit/domain/gates.test.ts tests/unit/domain/backlog.test.ts tests/unit/visuals --maxWorkers=1
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
CS_E2E_PREBUILT=1 CS_E2E_CONTENT_STORE=db CS_E2E_PORT=3243 bash ~/bin/heavy npx playwright test tests/e2e/image-pipeline.spec.ts --project=w375 --project=w1280
python -m unittest discover -s tests/python -v
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
```

The DB-write CI browser job now explicitly includes the image pipeline spec.
Sheet-mode skips are not image-pipeline evidence. CI has no configured Python
toolchain; the Python command is documented separately as requested.

## Skeptical verification

- Concurrency/state: stale selection refuses before AI; concurrent draft edits
  refuse at final CAS. Sketch source/material stamps invalidate approval after
  copy, platform, plan, brief, alt-text or visual-decision changes. Rechecking
  does not delete an existing asset. A failed post save can reuse the prepared
  upload under the same operation; newer edits remain protected by CAS.
- Cost/retries: cap zero prevents model and renderer calls. All three new AI
  tasks appear in the shared ledger. Malformed model output is bounded by the
  existing repair loop and leaves the row unchanged. Bulk work caps at 25,
  limits concurrency to three and completes other rows after partial failure.
- Auth/privacy: owner/same-origin guarded writes; server-only renderer secret;
  fail-closed Python header authentication; bounded request/response sizes;
  private response caching; strict parser; field-only Python errors. Bulk
  requests carry IDs/revisions only. The mapper catalogue, renderer sidecars
  and credentials stay server-side. Inventory projections omit sketches; the
  Backlog client gets bounded excerpts and individual image states. Full post
  bodies load only in an authenticated individual editor.

This is builder self-verification. Independent PR review and remote CI are not
claimed by this build-role handoff.

## Unapplied/runtime limits

- Neither new migration was applied to an external database. SQL ran only in
  disposable PGlite fixtures, including repeated migration execution, CAS,
  ledger/history, summary behavior, feature constraints and role denial.
- Vercel mixed Python/Next routing, `includeFiles` packaging, deployment
  protection and server-to-server invocation cannot be proved by a local Next
  build. Verify `/api/render-image` on a synthetic Vercel preview before enabling
  live rendering. The production adapter and fake are complete.
- No real AI, Google/Drive, Typefully or Supabase provider calls; no account,
  secret, production data or deployment changes. No push and no `gh` use.
- The original renderer supports English only. Unsupported/overlong copy fails
  with an offending field label. Owner review of real output and factual/chart
  evidence remains necessary; sketch approval does not approve the final PNG.
- Same-process upload recovery is bounded/disposable, matching the existing
  Visuals pattern. A cold start after upload but before linking can leave an
  unlinked Drive file; CAS still prevents overwriting a newer post.

Final confirmation: build, typecheck, lint, focused security/regressions, Python,
responsive browser journeys, axe and privacy scans pass. Migrations, deployment,
remote CI and independent review remain outside this local build handoff.

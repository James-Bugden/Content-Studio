# Builder handoff: #237, stages 3–5

Merge-fix round 1 now incorporates #235; current verification and integration
fixes are recorded in [the merge report](docs/qa/pr237-merge-r1.md).

Heavy / build / round 1. Branch: `feat/237-ui`. Base: `4a1fd99`.
No push, GitHub writes, migration application, secret access or production changes.
The supplied task brief is the implementation contract; the issue connector returned 404 for #237.

## Delivered

- English master editor opens directly in the post panel. Exact copy, recovery,
  conflicts, hooks, QA, review actions, visual links and existing Typefully flows remain.
- LinkedIn, Threads and X reading previews update from the current editor text.
  Real brand logos, platform reading layouts, reading folds, image previews and
  character counts; desktop columns and a stacked phone layout.
- Save as selects LinkedIn / Threads / X and optionally reviewed Chinese from
  English. The existing zh-TW task, terminology and validation are reused.
  Changing English invalidates its Chinese proposal. English and selected version
  snapshots save atomically in the existing database post under one revision,
  idempotency ledger and audit/history transaction. They remain drafts; this
  action does not create schedule rows or publish versions automatically.
- Platform choices and Chinese participate in the leave guard and tab recovery.
  Adopting the current version after a conflict reloads all saved versions.
- Delete uses a tombstone, removes the post from active reads, and blocks later
  writes to it. Undo is offered for 12 seconds; the database permits 30 seconds
  for transport grace and uses its own deletion clock. Existing schedule copies
  and Typefully drafts are retained, as stated beside Delete.
- Posts and Backlog show compact excerpts, keep filters/grouping/paging/inline
  edits, and retain the phone layout. Idea excerpts sent to the table are capped
  at 240 characters. List logos do not import the interactive preview bundle.
- Fewer line breaks is an explicit formatting action; ordinary saves never
  normalize copy. Empty drafts still save and do not grant release approval.

## Migration — applied in production per owner

`supabase/migrations/20261027000200_post_versions_and_soft_delete.sql`

Adds `platform_versions` and `deleted_at`, extends guarded writes, preserves
service-only grants and rebuilds the derived Ready view to exclude tombstones.
The owner confirmed during merge-fix round 1 that this existing migration is
already applied to production. This fix adds no migration and inspects or changes
no live database. Rows and their history are retained.

## Verification

Every Vitest, typecheck, build and Playwright command used `bash ~/bin/heavy`.
The full repository suite was not run. No unrelated Node process was killed.

- Required directory run: `npx vitest run tests/unit/application tests/unit/security tests/unit/components tests/unit/supabase --maxWorkers=1`
  — **91 files / 1,675 tests passed**.
- After the last editor/presentation refinements: focused application, SQL,
  editor-save, preview and panel tests — **5 files / 30 tests passed**.
- `npm run typecheck` and `npm run lint` — passed.
- Production build — passed. Final synthetic build ID:
  `-2Z7CCiHRlFyUB3fuUY7b`.
- Existing journeys at w375 and w1280: editor, panel, backlog, backlog pagination,
  AI, review, Typefully, visuals, image transfer and UX polish — 199 passed in
  the broad run. Two failures from an extra empty-state live region were fixed;
  all **20 UX polish retests passed** on the final build. One existing test
  explicitly skips the wide-table-only expansion check below 768px; its desktop
  case passed. That skip is not counted as a pass.
- Final DB browser run: `post-versions.spec.ts`, both widths — **10 passed**.
  Covers persisted selections/copy, stale Chinese, Delete/Undo, owner/origin/CAS
  boundaries, and reflow at 375/500/640/750/1280 CSS px. Axe found no serious or
  critical WCAG A/AA violations in the editor at 375 and 1280.
- `node scripts/check-private-paths.mjs`, `node scripts/scan-secrets.mjs`, and
  `git diff --check` — passed with the new files staged.

Local synthetic evidence is in `artifacts/237/`: backlog, editor and preview PNGs
for both widths. Screenshots were visually reviewed; no production screenshots
or private voice files are included. The browser tool blocked the local mockup
file URL; its source was read. An extra local manual-QA server was rejected by
automatic approval review with only “blocked by policy”, so no separate manual
Chrome session is claimed. Native 200% zoom and physical-device testing are not
claimed. Browser tests and intermediate-width reflow are emulated evidence.

The provided worktree uses a node_modules junction outside Turbopack's inferred
root. Local builds used a temporary common-parent root setting; it was restored
and is absent from the committed diff. Default Turbopack failed on that junction;
Webpack also hit an existing Replies `node:crypto` import. Neither unrelated
problem was changed.

## Adversarial checks and remaining review

1. Correctness/concurrency: real SQL and fake tests cover stale revisions,
   same-operation replay, changed-patch conflict, exact round trips, stale Chinese,
   tombstone edit refusal, expired restore and server deletion time. Conflict
   adoption and a Chinese response arriving after changed platform selections
   have component regressions.
2. Auth/privacy: owner/origin checks run before services; validated IDs and bodies;
   service-only SQL access; viewer refusal; explicit write freeze; no private copy
   in audit output or fixtures. The private voice files were not read or printed.
3. UX/performance: stable editor height; live exact-copy previews; list excerpts
   and bounded paging; no new whole-library client payload; existing review,
   scheduling, image and publishing journeys retested.

Independent review, hosted CI, migration application and deployed verification
remain coordinator steps. This builder did not push, use gh, merge, deploy or
close an issue. Live AI voice fidelity and native-platform pixel equivalence
cannot be established by deterministic synthetic providers.

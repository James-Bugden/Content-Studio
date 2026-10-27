# #235 list document payload

Standard performance fix on `perf/235-payload`, based on `4a1fd99`.
The owner's build request is the acceptance contract. No GitHub commands,
deployment or live provider access are part of this build round.

## Findings and changes

The 4.7 MB home document is reproducible with `seed_library_pages(total: 2000)`.
Next up rendered every urgent task and every upcoming task, including the
contents of the closed “Show all” details element. CSS/native collapse did not
remove any HTML, RSC nodes or client link instances. Next up is a server
component; it was the rendered inventory, rather than a full Board prop crossing
a client boundary, that dominated this route.

Both urgency lists now paginate on the server, 12 at a time. Their totals remain
global, and independent `nowPage`/`nextPage` links retain the other list's page.
Every task remains reachable. Navigation counts still use the complete board.

Backlog already filtered/sorted/grouped the complete inventory on the server and
sliced a 40-row page. Its initial client prop nevertheless contained each full
LibraryRecord (including draft text duplicated in raw cells). Search also
returned complete LibraryItem values. Both boundaries now explicitly project
inventory fields, a 220-character draft excerpt and bounded hook alternatives.
Full copy and alternatives remain available in the existing guarded panel;
“Show full post” now opens that panel. Search still matches the complete body
on the server, including text beyond the excerpt. Revisions, review actions,
in-place PESTO editing, private search, global grouping/sort and dirty-edit
navigation retain their existing contracts.

DB Backlog derives Ready candidates from its Library snapshot, avoiding another
transfer/mapping of the same queued bodies. Legacy modes retain independent
Ready reads for drift checks. Supabase list queries explicitly select mapped
domain columns and revision/link metadata instead of `*`, excluding storage
bookkeeping and future administrative columns.

Loading states use the short neutral “Loading” text and retain existing skeletons.
There are no `/calendar` or `/posts` routes: those surfaces are `/schedule` and
`/review`. Both were measured; they already paginate/window their displays and
contain bounded previews rather than full draft bodies.

## Measurements

Production Next build, synthetic fixture, authenticated local HTTP requests.
Final build ID: `MJYHv1WS0vxovwmRt2POf` (commit identity is the commit containing
this report; all runtime checks use the built artifact from this branch).
Bytes are **uncompressed complete document bodies**, including inline RSC.
After one warm-up per route, three sequential requests measure elapsed time
through reading the complete response body. This is an upper bound on local
server rendering, not a production Sydney/Supabase network benchmark.

The before build used the legacy fake provider with the same 2,000-row fixture.
The after build was measured with both that provider and fake DB authority.
Fake DB and legacy modes produced identical after document sizes. The fixture
control now seeds DB authority too, rather than silently measuring its original
small fixture. PGlite is exercised by the required Supabase test directory;
the HTTP server uses FakeContentDb, not an embedded PGlite HTTP service.

| Route | Before bytes | After bytes | Before warm ms | After legacy fake warm ms | After fake DB warm ms |
| --- | ---: | ---: | --- | --- | --- |
| `/` | 4,836,626 | 96,879 | 518 / 477 / 517 | 285 / 248 / 248 | 21 / 24 / 20 |
| `/backlog` | 323,198 | 258,915 | 246 / 270 / 292 | 248 / 276 / 282 | 18 / 20 / 22 |
| `/schedule` | 143,940 | 143,690 | 255 / 283 / 253 | 272 / 289 / 276 | 26 / 27 / 27 |
| `/review` | 410,617 | 410,367 | 292 / 281 / 293 | 331 / 296 / 308 | 50 / 44 / 47 |

Both requested routes meet <300,000 bytes and <500 ms warm complete response.
The small shared-shell difference on unchanged routes comes from shorter loading
fallback copy. No claim is made that `/review` meets a 300 KB budget.

## Verification

All heavy commands use `bash ~/bin/heavy`. No full repository test suite was run.

- Required directories: `npx vitest run tests/unit/application tests/unit/supabase tests/unit/security --maxWorkers=1 --silent`: **60 files / 1,417 tests passed** on the final read-path changes.
- Targeted tests: Backlog projection, source reuse, sorting, page/view, loading,
  hydration/error and PostgREST projection regressions.
- `npm run typecheck`, `npm run lint`, `npm run build`.
- Legacy fake T1: `npx playwright test tests/e2e/home.spec.ts tests/e2e/backlog.spec.ts tests/e2e/backlog-pagination.spec.ts tests/e2e/backlog-stale.spec.ts tests/e2e/payload.spec.ts --project=w375 --project=w1280`
  using `CS_E2E_PREBUILT=1`: **84 passed**. Includes stale-state recovery,
  no editor reads from the read-only fallback, exact full-body fetching and
  the document byte budget at both widths.
- DB T1: with `CS_E2E_CONTENT_STORE=db`, home, backlog-pagination and payload
  specs: **16 passed**, widths 375 and 1280. This covers 2,000-row DOM bounds,
  global body search, sorting/filtering, editable cells, task paging, accessible
  layout and fetching exact full copy only when the panel opens.
- T2: inspected the 375/1280 synthetic Backlog screenshots; controls remain
  usable, cards fit the phone and the desktop table retains its horizontal
  scroll region. Axe and overflow checks passed in the targeted journeys.

Build note: this worktree's shared `node_modules` junction points to sibling
worktree `163`. Turbopack's default root rejected that junction. Builds used a
temporary local `turbopack.root` covering their shared parent, then restored
`next.config.ts`. No machine-specific root is included in the commit. The
webpack fallback was unsuitable because of an existing Replies `node:crypto`
client import; the successful evidence uses Turbopack.

## Limits

Full SQL pagination/aggregate gate summaries are **not implemented**. Private
server reads still traverse domain records for global counts, body search,
release fingerprints, screenshot reuse and readiness/lineage checks. Only the
rendered/client inventories are bounded; full bodies stay server-side until
the editor is opened. Exact global semantics were retained rather than
duplicating the release-gate engine in SQL. Warm DB reads use the existing
short-lived disposable cache; cold full-collection cost can still grow with the
library. This is a remaining part of the requested query-level optimization.

No production render timings or deployment verification are attested by this
local build. T3/T4 do not apply to this server/document change.

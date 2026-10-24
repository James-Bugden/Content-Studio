# CS-045: Sheets read audit (#126)

Scope: the single server-process `SheetsContentRepository` shared by pages and
route handlers in `application/container.ts`. No schema or write-semantic change.

## Read paths

| Entry points | Tabs / range | Decision |
| --- | --- | --- |
| Backlog posts page, private search, totals, editor navigation | Library; readiness also needs Ready Queue and Schedule | Share each tab's paged snapshot and pending promise. Whole Library remains necessary for global filters, sorting, grouping, totals and search. Forty displayed rows cannot replace that source read. |
| Backlog Ideas, ideas filters and panel | Content Queue | Same cache mechanism. The page already supplies its loaded rows to both filter/group loaders. |
| Review/editor, board, Ready, promotion, calendar, published, reconciliation, visuals | Library / Ready Queue / Schedule as needed | Reuse the same repository reads. Keep complete row values, formulas and links: revisions and gates depend on them. |
| Workflow Settings | A:C, paged | Narrow from A:Z to the three consumed columns (Setting, Value, Notes). Request formatted values only. |
| Queue summary | A:Z, paged | Retain dynamic summary headers/counts and master hyperlinks. |
| Schema health | One header row per content tab | Keep header-only reads; include them in `sheet.read` telemetry. Do not widen health checks to full tabs to share display snapshots. |
| Library/Queue/Schedule update and queue append | Fresh full-tab identity lookup, then fresh readback | Bypass and invalidate the display snapshot. Never share a mutation's precondition/readback promise. Full-row revisions, duplicate-ID detection and row movement checks remain intact. |
| Optional snapshot reconciliation | Existing repository methods | Shares Content reads; does not introduce a second writable authority. |

All Sheet provider reads enter through `SheetTransport.readTab`: repository
pagination or header-only schema checks. Pagination stays bounded at 500 rows
per call and 10,000 rows per tab. No transport consumer bypasses the repository.
The Google field mask omits formula/link data when neither is requested.

## Cache contract

Pending reads coalesce even with retention disabled or when a provider call
outlasts the configured TTL. Retention begins on successful completion. Only the
currently registered entry can expire or evict itself: an invalidated older
promise cannot replace or delete a newer snapshot. Rejections are not retained.

Every actual write attempt, including failed/uncertain writes and appends,
invalidates all display entries (Library changes can change derived Ready Queue).
Fresh mutation reads bypass the cache and invalidate that tab's display entry;
they never seed the display cache. Existing callers awaiting an old read may
finish with their snapshot, but subsequent callers cannot reuse it after
invalidation. The next display read calls the provider.

Current main already configures Library/Ready Queue/Schedule at **60 seconds**
and other tabs at **3 seconds** in live mode. This issue preserves those values;
the issue/spec's older 15-second setting is exercised in unit tests. Fake mode
retains no completed results, preserving deterministic external-edit and
failure-injection journeys, but now coalesces concurrent reads.

## CS-046: last-good Backlog recovery (#127)

The same cache entries now retain a last successful complete tab snapshot after
display expiry or failure. Expired entries still call the provider on the next
normal read; rejected promises are never served as cache hits. Fake mode still
has zero normal display retention, so injected failures reach the provider.

Backlog posts alone explicitly select the cached Library snapshot after
`RATE_LIMITED` or `PROVIDER_UNAVAILABLE`, provided it is less than five minutes
old and has valid headers. Selection makes no provider calls. A missing or older
snapshot keeps the existing error screen; a genuinely empty cached Library is
still visibly labelled stale. Repeated failures do not extend snapshot age.

The warning uses the shared warning-result pattern and offers Retry. The stale
inventory disables Edit post and inline PESTO edits and blocks URL-opened panels.
It renders the bounded read-only table rather than starting private search or
editor requests. Readiness is unknown where provider data is missing. Retry
loads the page normally; a successful read restores editing. Other list pages,
Ideas and editor/API reads retain their existing failure behaviour. Mutation
preconditions/readbacks still bypass the cache, invalidate last-good data with
the same entries and never select fallback. No additional provider reads,
persistent cache, or writable authority is introduced.

## Before/after fake transport counts (PR evidence)

Baseline: `de41746` (the branch base). Synthetic default tabs fit in one 500-row
page each. A Backlog posts load is the actual page's three repository calls:
`listLibrary`, `listReadyQueue`, `listSchedule`.

| Scenario | Before | After |
| --- | ---: | ---: |
| One cold Backlog posts load | 3 | 3 |
| Two simultaneous cold Backlog loads, fake mode / zero retention | 6 | 3 |
| Eight concurrent Library reads, zero retention | 8 | 1 |
| Second sequential load within configured live TTL | 0 | 0 |
| Second Library request while first is still pending beyond TTL | 2 | 1 |

The existing live cache already saves warm page loads. This change closes its
pending/expiry/invalidation races; it does not claim every cold 2,000-post tab
fits into one provider request. A 2,000-post Library plus header requires five
bounded page calls; concurrent consumers share that one traversal.

Reproduce with the targeted `sheets-read-cache.test.ts` tests. Provider count is
`FakeSheetTransport.reads`; `sheet.read` telemetry supplies the same count plus
tab, start row, maximum rows and latency, without IDs or content. Existing Fix
issues adapter health reports Sheet Calls from timed transport events, excluding
the additional mutation-result/schema-drift events. Cache hits emit no provider
call. The existing Errors/Conflicts columns count outcome events (including
validation or stale-read refusals), not distinct transport calls; they can exceed
Calls when a provider failure also produces a mutation failure outcome.
Counts are per process, within the existing bounded 500-event buffer;
transport-internal HTTP retries are not separate repository calls. This lets
#88/#93 compare logical read costs without introducing a new diagnostics surface.

## CS-044: cache-only navigation counts (#93)

Next up and Fix issues publish only their derived task/blocking totals after
their existing reads complete. Navigation uses an authenticated, private/no-store
endpoint that only inspects those totals and existing Library/Schedule cache
witnesses. It never calls a loader, Sheet transport, Drive or Typefully. Cold,
incomplete, invalidated, replaced or older-than-15-second snapshots produce no
badge; a successfully derived zero remains a real zero. Existing last-good
snapshots also permit synthetic zero-retention mode without changing its reads.

Counts are best effort per server process. Next up becomes available after a
board load; Fix issues after a complete reconciliation load. Visiting an unrelated
page does not run either workflow just to populate a badge. The phone keeps its
existing four tabs and displays Fix issues' badge in More. Browser expiry removes
numbers even when the page remains open. Mutation code is unchanged; the existing
cache invalidation makes its witnesses unavailable to subsequent navigation reads.

`tests/unit/navigation-counts.test.ts` asserts zero extra adapter calls for cold,
warm and expired navigation: a board plus reconciliation requires seven Sheet
calls (three board tabs and four existing schema checks), and ten navigation
reads add zero Sheet, Drive or Typefully calls. Route and component tests also
cover authentication, private caching, unknown/zero display and expiry.

## Unchanged limits

Caches do not span server instances; external Sheet edits can remain invisible
to display reads until expiry. Writes still compare against a fresh authoritative
revision. Sheets has no conditional update: the residual read/write window in
[atomicity.md](atomicity.md) remains unchanged. No production/private data is used
for this evidence.

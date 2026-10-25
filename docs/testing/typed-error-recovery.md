# Typed Content error recovery (#174)

The existing [exploratory sweep](exploratory-sweep.md) already covers all 18
requested page/code combinations. No sweep cases or Playwright files were
added or changed for #174, so its execution workload and budget are unchanged.

`tests/e2e/sweep-checks.ts` defines `SHEET_READERS` and `FAULTS`;
`tests/e2e/sweep-faults.spec.ts` takes their Cartesian product. Every cell below
runs for owner **and** viewer at 375 and 1280 CSS px. Each scenario resets the
fake providers, injects ten read failures on the named Sheet tab, navigates to
the page, waits for readiness, asserts the designated recovery state, rejects
false empty/no-match states, checks that writes are unavailable, and checks
overflow and browser diagnostics. No live provider data is used.

| Page / route | Injected primary Sheet tab | RATE_LIMITED | SCHEMA_DRIFT | STALE_READ |
|---|---|---|---|---|
| Next up `/` | Content Schedule | Existing: `rate_limited` | Existing: `blocked` | Existing: `conflict` |
| Review (Posts) `/review` | Content Library | Existing: `rate_limited` | Existing: `blocked` | Existing: `conflict` |
| Ready `/ready` | Content Library | Existing: `rate_limited` | Existing: `blocked` | Existing: `conflict` |
| Calendar `/schedule` | Content Schedule | Existing: `rate_limited` | Existing: `blocked` | Existing: `conflict` |
| Published `/published` | Content Schedule | Existing: `rate_limited` | Existing: `blocked` | Existing: `conflict` |
| Visuals `/visuals` | Content Library | Existing: `rate_limited` | Existing: `blocked` | Existing: `conflict` |

Calendar month/list variants and representative detail pages also exist in
`SHEET_READERS`; they are additional coverage rather than missing cells.
No requested cell is untestable with the existing fixtures.

The registry brand is `Symbol.for('content-studio.AppError')`, distinct from
Replies. Plain JSON and a well-formed unbranded Error cannot impersonate it.
Code intentionally applying the registry symbol inside the process can still
impersonate the class; this is an identity marker, not a sandbox for hostile
in-process code. Branded foreign values still need a recognised Content code
and non-null, non-array object details. The initial `instanceof AppError`
fast path preserves same-graph behaviour. Cross-realm coverage executes the
actual compiled domain module inside `node:vm`, with its own Error prototype.

The local Markdown and Backlog workarounds now delegate to `isAppError` and
retain their previous unknown defaults (`PROVIDER_UNAVAILABLE` and `UNKNOWN`).
The source search also found API-envelope handling in `editor-cache.ts`,
`backlog-post-panel.tsx` and `editor/ai-error.tsx`; these intentionally handle
serialised HTTP data, not cross-graph AppError instances, and remain unchanged.
The Replies recovery helper and Supabase SQLSTATE parser belong to separate
error vocabularies and remain unchanged. No #144 stale fallback rule changed.

Exact build identity, commands, red-before-change proofs, fresh results and
remaining review/CI limits are recorded in the build round's `CODEX_REPORT.md`.

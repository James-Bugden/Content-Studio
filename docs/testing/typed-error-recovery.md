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

## Round 1 production-build evidence (2026-10-25)

Validated code: `fa1e7d43359df0fd544f772c000081c54ddc27a6`.
Synthetic Next production BUILD_ID: `yZZRTG0A7v1Bspim5khXA`.
The unchanged fault spec passed all six selected tests at both repository
widths, with 240 passing report rows. Filtering those rows to the six routes
above yields exactly 72 passes (18 combinations × two roles × two widths).
Execution was 55,432.16 ms. This is the three-code subset, not a new full-sweep
runtime measurement. No case was added, skipped or declared untestable.

```powershell
$env:CS_E2E_PREBUILT='1'; $env:CS_E2E_PORT='3274'
bash ~/bin/heavy npx playwright test sweep-faults.spec.ts --project=sweep-fault-375 --project=sweep-fault-1280 --grep 'fault sweep: (RATE_LIMITED|SCHEMA_DRIFT|STALE_READ)$' --reporter=list,./tests/e2e/sweep-reporter.ts
```

The command ran in a physical scratch copy with the same source/tests/config
as the validated commit, using existing locked dependencies copied from
worktree 163. No packages were installed. Ignored evidence is retained at
`sweep-report/cs174/coverage.json` and `coverage.md` in the assigned worktree.

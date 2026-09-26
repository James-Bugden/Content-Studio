# CS-034 Backlog UX rollup

## Purpose

Make the Sheet-backed Backlog fast to scan and trustworthy about publishing readiness, while preserving the owner-only editing and canonical Sheet, Drive and Typefully boundaries. This plan complements the existing combined-product `_build_plan/prd.md` without replacing it.

## Scope

1. Measure read-only page, filter and editor latency with content-free metrics; avoid needless repeated full Sheet reads while keeping mutation preconditions fresh.
2. Show the difference between drafting, approved, ready to schedule and ready to send to Typefully. Use the existing Ready Queue and Schedule gates; unknown or unavailable input fails closed.
3. Search and sort the Content Library inventory, filter by status and source, and keep bounded pagination in URLs. Never place post copy in query strings.
4. Make the default table easier to scan while retaining the requested columns, with optional density and column choices.
5. Prioritise draft and save in the editor, reveal optional QA/hook panels on demand, and make adjacent navigation fast without weakening dirty or revision guards.
6. Preserve the same information and semantics on narrow screens, with keyboard and phone checks.

## Non-goals

No Sheet schema or authority change, bulk approval, direct publishing, new design language, or duplicate persisted status. No private content in test fixtures, telemetry or public review evidence.

## Milestones

- Read model and measurement: bounded projection, existing gates, failure states, latency evidence.
- Find and scan: filters, sort, compact table, responsive cards.
- Edit and ship: progressive editor, safe next-post navigation, T0/T1/T2/T3, adversarial review, green PR and exact production smoke.

The physical-device T4 check requires a real phone with owner access. If that device is unavailable in the active runtime, record the specific outstanding check rather than substituting emulation.

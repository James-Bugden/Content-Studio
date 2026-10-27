# AI usage and monthly cap (#218 / PR #238)

Heavy, bounded feature on the existing AI/account surfaces. Supabase is the only
live ledger. The default cap is US$20; the owner can edit it at `/ai-usage` (zero
pauses AI). The account menu shows the meter and links to the last 25 calls.
No provider billing/account changes are involved.

Acceptance:

- AI-USE-1: timestamp, feature, provider model, input/output tokens and estimated
  USD cost for each Content attempt, including repair, refusal and invalid output.
  Replies ideas/rewrite/translation and embeddings use the same budget.
- AI-USE-2: atomic admission refuses at/above the cap before provider invocation;
  the 80% threshold warns. Months reset at midnight on the 1st in Asia/Taipei.
- AI-USE-3: owner-only private read/edit routes; cap edits use operation identity,
  expected version and hashed actor audit. Call settlement is idempotent and
  conflicting repeats are refused. No prompts or writing enter the ledger.
- AI-USE-4: mobile meter, progress, recent calls and a small editable cap field;
  empty/loading/unavailable/conflict/refusal states preserve manual work.

The migration `20261027000300_ai_usage.sql` is idempotent, enables RLS and grants
only the service role access. **This build does not apply it.** Apply it through
the repository's normal deployment migration process before enabling this code
with a live AI provider. Missing database configuration/schema fails closed for
AI while manual editing remains available.

Amounts are integer USD microdollars. Rates are a versioned estimate, verified
2026-10-27 against [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
and [OpenAI embedding pricing](https://developers.openai.com/api/docs/pricing).
Unknown configured models are refused until their rate is added. Returned
fallback models are priced using their rate, or a conservative $15/$75 per
million input/output tokens. Cache reads use the full input rate and cache
creation up to 2x input; actual stored token counts remain intact. This is an
estimate, not a provider invoice.

Admission locks the singleton budget, checks month spend including reservations,
and inserts one pending call before provider work. The check tests current spend;
the call which crosses the cap is allowed to finish. Concurrent calls see pending
estimates. UTF-8 input bytes plus framing/schema allowance and maximum output
tokens form the reservation. Actual returned usage replaces it before output
validation. SDK automatic retries are disabled; the bounded pipeline repair gets
its own admission and ledger record.

Timeouts, unknown usage and failed settlements retain a conservative reservation
and can reach the cap early. They never silently become free calls. Pending calls
do not expire automatically because a lost response may still have been billed.
These entries are labelled in the recent list; raising the cap remains an explicit
owner action. History remains after a month rollover. No historical provider
invoice backfill or production-data reconciliation is in scope.

Regression areas: provider repairs/cancellation/fallbacks, Replies generation and
retrieval, owner auth and CSRF, cap update retries/stale views, month boundaries,
multi-process admission and private responses. Verification: T0 unit/PGlite/RLS,
typecheck/lint, T1 synthetic AI-button journeys at 375 and 1280, T2 responsive
visual/accessibility review. No native hardware behavior changes require T4.

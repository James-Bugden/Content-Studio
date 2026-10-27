# #218 / PR #238 — build round 1

Branch: `feat/238-ai-usage`. Base: `0e52caa`. Heavy; role: build.
The commit containing this evidence is the build handoff identity (`git rev-parse
HEAD` after checkout). Issue: <https://github.com/James-Bugden/Content-Studio/issues/218>.
No push, merge, deployment, production calls or migration application was performed.

Implemented AI-USE-1–4 from [the implementation contract](../implementation/ai-usage.md).
The account menu meter, recent-call page and editable default US$20 cap share the
Supabase service-role ledger across Content, Replies and embeddings. Tests use
synthetic fakes and PGlite only.

## T0

All heavy commands used `bash ~/bin/heavy`. Vitest used `--maxWorkers=1`.

- Requested directories plus existing AI/retrieval regressions:
  `npx vitest run tests/unit/application tests/unit/supabase tests/unit/security tests/unit/components tests/unit/ai tests/replies/unit/ai tests/replies/unit/retrieval --maxWorkers=1`.
  110 files / 1,914 tests initially passed; the additional embedding worker file
  exposed three unpriced mock-model fixtures. Those fixtures now use a priced
  embedding model with the same mocked transport. Its complete 11 tests passed
  on retest. No failing test was removed or skipped.
- Final affected-file retest: `npx vitest run tests/unit/application/ai-usage.test.ts tests/unit/application/reply-ai-usage.test.ts tests/unit/ai/usage.test.ts tests/unit/supabase/ai-usage.test.ts tests/unit/security/ai-usage-route.test.ts tests/unit/components/ai-usage.test.tsx tests/unit/components/state-view.test.tsx tests/replies/unit/retrieval/worker.test.ts --maxWorkers=1`.
  **8 files / 73 tests passed**, including the additional review regressions.
- `npm run typecheck`: passed. Final production build also ran TypeScript with
  build errors enabled and passed.
- `npm run lint`: passed. `git diff --check`: passed.
- Private-path and secret scans: passed; repeated on the staged handoff.
- `npm run build`: passed. This workstation's shared `node_modules` junction
  requires temporarily widening Turbopack's root to `C:/Users/jbbug/projects/cs-wt`.
  The final build temporarily used `experimental.cpus=1` to avoid memory pressure.
  Both local build settings were reverted; `next.config.ts` has no final diff.
  An initial default-root Turbopack attempt and webpack fallback failed on local
  junction/client `node:crypto` tooling. A later seven-worker build was stopped
  when the memory governor suspended owned jobs; only owned jobs were stopped.

## T1 / T2

Production build, `CS_DATA_MODE=fake`, `CS_CONTENT_STORE=db`, fake AI, no real keys:

`CS_E2E_PREBUILT=1 CS_E2E_CONTENT_STORE=db CS_E2E_PORT=3220 npx playwright test tests/e2e/ai-usage.spec.ts tests/e2e/ai.spec.ts --grep 'AI button records|account meter warns|ENQA-03|HOOK-01/02/04|viewer sees' --project=w375 --project=w1280`

**10 / 10 passed**. Both widths prove real AI-button recording, token/cost history,
meter, cap update to zero, refusal without another call, continued manual editing,
80% warning, owner/viewer and cross-origin boundaries, stale QA acceptance refusal
and the existing three-hook proposal flow.

The first browser attempt exposed a test-only isolated API cookie context, fixed
to use `page.request`. The next exposed a real mobile account-popover overlap:
navigation now closes the menu, verified by component and browser regressions.
The warning fixture now contains a deterministic spelling finding.

Agent browser review in Chrome on the same final production artifact checked the
account meter, empty history, cap label/control, save confirmation and zero-cap
warning at desktop size and a 375×812 viewport. No clipped fields or horizontal
overflow; 44px controls remain usable above the mobile navigation. Browser console
warning/error log was empty. Temporary browser viewport was reset and the review
tab closed. Synthetic screenshots remain local in ignored `test-results/`.
Layout emulation covers the responsive change; no native hardware behavior was
introduced and no physical-device pass is claimed.

## Builder adversarial verification

- **Concurrency/state:** real SQL singleton locking, pending reservation inclusion,
  duplicate admission refusal, idempotent settlement, conflicting replay refusal,
  cap CAS/idempotency/audit and rollover verified. Additional raw-SQL tests reject
  missing expected versions and null settlement replays. The admission timestamp
  is captured once for the month check and insertion to avoid a boundary race.
- **Auth/privacy/RLS:** PGlite executes the migration twice, verifies RLS enabled
  and denies both public roles table reads and RPC access. Owner API checks,
  same-origin browser refusal, no-store responses and hashed cap actor verified.
  Ledger schema contains no prompts, drafts, provider errors or owner identifiers.
- **Cost/retries:** repairs are separate admitted calls; refusals and invalid
  output still count. SDK automatic retry disabled. Failed admissions never call
  a provider. Unknown usage retains conservative reservations; missing database
  accounting fails closed. Actual cached-input token counts remain intact while
  cost estimation is conservative. Unknown configured model prices refuse early.

Remaining deployment prerequisite: apply the new migration through the normal
deployment process before live AI use. No production behavior is attested.
The per-call overshoot and uncertain-reservation behavior are documented in the
implementation contract. Independent PR review belongs to the next review round;
this evidence is builder verification, not an independent approval.

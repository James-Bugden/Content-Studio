# Content Studio — handover to a new Claude Code account

Written: 2026-09-24 18:52 Asia/Taipei, at commit `5a7a023` on `main`.
Written by the Claude Code session that had been building this project all
week, handing off because its weekly usage is about to run out. James is
starting a second Claude Code subscription (separate account) to keep going
without a gap. This document is the only context that session will start
with — it has no memory of this project and no conversation history.

**If you are that new session: read this whole file before touching
anything.** Then read `AGENTS.md` at the repo root — that is the real,
authoritative, tool-neutral engineering policy for this repo (autonomy
rules, verification tiers, PR/merge rules, PRD gate). This document is just
the "what's going on right now and how to get moving fast" briefing on top
of it.

---

## 1. What Content Studio is

A Next.js 16 (App Router) + React 19 + TypeScript dashboard that gives James
an owner-only control surface over his content pipeline, which otherwise
lives entirely in:

- **Google Sheet** — the operational source of truth (content calendar,
  backlog ideas, review state, hooks, images, schedule). Tabs: `Content
  Library`, `Content Queue` (idea-stage rows), `Content Schedule`, `Content
  Queue Summary`, `Ready Queue`, `Workflow Settings`.
- **Google Drive** — canonical Markdown/source assets.
- **Typefully** — final editing/publishing surface (X, Threads, LinkedIn).

The app reads/writes the Sheet directly via a Google service account (no
Supabase, no separate database — Supabase is a documented *later* migration
option, not a current dependency: see `docs/MASTER-SPEC.md` §11). **The full
domain vocabulary, exact Sheet column mapping, and architecture are in
`docs/MASTER-SPEC.md` — read it, don't re-derive it.**

- **Repo**: `github.com/James-Bugden/Content-Studio` (public; see the
  "Public code and private data" rule in `AGENTS.md` — synthetic fixtures
  only, never real Sheet/Drive content, ever).
- **Local path** (if this is the same machine): `C:\Users\jbbug\projects\content-studio`
- **Production**: https://content-studio-blond-rho.vercel.app
- **Vercel project**: `james-projects-1242b366/content-studio` — auto-deploys
  `main` on every merge (no manual "Deploy" step, unlike HireSign/GTO).
- **Ticket tracker**: GitHub Issues, prefix `CS-NNN` (issue number). **Not
  Linear** — this repo never used Linear.

## 2. The one rule that overrides everything else

**Never add or rename a column in the live Google Sheet.** The Sheet's
schema is James's (or another tool's) to change, not this agent's. The app
only ever reads and writes fields that *already exist* in
`src/domain/sheet-schema.ts` (`LIBRARY_HEADERS` / `SCHEDULE_HEADERS`). If a
feature needs a field that doesn't exist yet, that is a **blocker to hand
back to James**, not something to work around by writing to the Sheet
directly. This came up explicitly this week (see §6, repurpose tracking) —
James caught it and corrected an in-progress plan that would have added a
new column. Don't repeat that.

Everything else procedural is in `AGENTS.md`. The short version, since it's
dense: James wants maximum autonomy on routine engineering (build, test,
open PRs, merge green PRs, deploy) and only wants to be asked about a
handful of things — new/ambiguous product direction, access-control/privacy,
money, irreversible prod-data operations, and credentials only he holds.
Read the full "Ask James only for" list in `AGENTS.md` before assuming
something needs his sign-off.

## 3. Environment setup checklist (do this first)

If this is a **different Claude Code session on the same Windows machine**
(most likely — James is just switching subscriptions to keep working, not
switching computers), most of this is probably already in place. Verify,
don't assume:

- [ ] `cd C:\Users\jbbug\projects\content-studio` and confirm it's a clean
      checkout of `main` (`git status`, `git fetch origin`, `git log -1`).
      If usage ran out mid-task there may be an open branch or PR — check
      `gh pr list --state open` before starting anything new (see §5 for
      what's open right now).
- [ ] `.env.local` should already exist in the repo root (it's gitignored,
      never committed — see `.env.example` for the field names only, no
      values). If it's missing, James needs to supply it or you need
      `vercel env pull .env.local` after `vercel link` — this needs his
      Vercel login, so ask him rather than guessing values.
- [ ] `npm install` if `node_modules` looks stale or missing.
- [ ] `npx playwright install` if e2e tests fail with a missing-browser
      error.
- [ ] `gh auth status` — GitHub CLI auth is machine-level, not
      Claude-account-level, so it should already work. Same for
      `npx vercel whoami` (Vercel CLI auth).
- [ ] Check whether this Claude account can see the skills at
      `C:\Users\jbbug\.claude\skills\` (in particular `coding-workflow`,
      `wireframe`, `ux-copy`) and the auto-memory at
      `C:\Users\jbbug\.claude\projects\...\memory\`. These are tied to the
      Claude Code *installation* on this machine, which may or may not
      carry over to a second Anthropic account logged into the same CLI —
      untested. **Don't rely on it either way** — this document and
      `AGENTS.md` are written to be self-sufficient without them. If the
      skills/memory *do* carry over, treat that as a bonus, not a
      dependency.

### What James needs to set up (not the agent's job)

- The new Claude Code subscription itself (billing/login) — obviously his.
- Confirming `.env.local` is present or supplying fresh values if a fresh
  clone was used instead of the existing local checkout.
- Nothing else should be required — GitHub, Vercel, and the Google
  service-account credentials are already wired into this checkout/repo.

## 4. How to actually work (condensed from `AGENTS.md`)

1. **Reconcile state first.** `git fetch origin`, check `gh issue list
   --state open` and `gh pr list --state open` before starting anything —
   don't duplicate in-flight work. See §5 for the exact state as of this
   handover.
2. **Every change gets a GitHub issue** (`CS-NNN`), even a small one — this
   repo's convention this week has been: open the issue with Current
   state / Why it matters / Proposed change / Acceptance criteria (see any
   recent closed issue for the exact shape, e.g. issue #46 or #48), then
   build directly. James said "move fast" and "doesn't have to be
   extensive" for routine follow-ups — a full committed plan file isn't
   required for small, well-scoped changes; use judgement, and write a
   fuller plan for anything Heavy per `AGENTS.md`'s classification.
3. **UI/UX changes need a design gate before code** — `AGENTS.md` calls
   this out via the PRD/issue-scoping skills; in practice this week that
   meant: for a small tweak, describe it in one line and just build it; for
   a real redesign, produce wireframe options (the `wireframe` skill, if
   available) and wait for James's explicit pick before writing page code.
   **Never invent copy or values** — always build from what's already live
   in the Sheet/UI, never a plausible-sounding guess.
4. **Test before every PR:**
   ```bash
   npx tsc --noEmit -p .
   npx eslint <touched files>
   npx vitest run
   rm -rf .next && npx playwright test tests/e2e/<relevant spec>.spec.ts --reporter=line
   ```
   `rm -rf .next` before Playwright matters — `reuseExistingServer` in
   `playwright.config.ts` will happily serve a stale build otherwise and
   you'll "pass" against old code.
5. **Open the PR**, `Closes #NNN` in the body, then `gh pr checks <N>
   --watch`. **Merge green PRs without asking** — squash + delete branch —
   unless the PR touches auth, RLS/access-control, payments, or the Sheet
   schema (see §2). No CI / pending CI / skipped CI is not green; don't
   merge on a partial result.
6. **Verify live after merge.** Vercel auto-deploys `main` — no manual
   promote step. Give it ~30-60s, then check
   `npx vercel ls --yes` for a `Ready`/`Production` deployment, and load the
   actual production URL in a browser to confirm the change is really
   there (a merge alone doesn't prove the deploy succeeded).
7. **Rename with `git mv`**, not delete+recreate, or the file's history
   (and any in-flight review context) is lost.

## 5. Exact state as of this handover (2026-09-24, commit `5a7a023`)

**Open PRs:**
- **#49** `jb/cs-023-backlog-editable-fields` — "CS-023: Platform/PESTO/Hook
  template editable per row in Backlog". Just opened, CI was running when
  this handover was written. **First thing to do: check `gh pr checks 49`.**
  If green, merge it (squash + delete branch, per §4.5 — it's a routine UI
  change, no auth/RLS/payments/schema). If James's new session starts and
  this is still open, that's the very first task.
- **#32** `fix/cadence-2x2x1-20260923` — looks stale/superseded: PR #33
  ("Use the new 2+2+1 content cadence and weekly pillars") merged the same
  day with what looks like the same intent. **Don't just close it** —
  investigate first (`gh pr diff 32` vs what actually landed in #33) before
  deciding whether it's genuinely redundant or has something #33 missed.

**Open issues** (besides #48, closed by #49 once merged):
- **#1** `CS-EPIC` — Content Studio MVP epic, still open (parent of
  everything).
- **#19** `CS-018` — Independent acceptance campaign, accessibility and
  security release gate. P0, phase M3.
- **#20** `CS-019` — Isolated Vercel deployment, production smoke and
  rollback. P0, phase M3.
- **#21** `CS-020` — Optional Supabase migration seam and evidence-based
  cutover plan. P1, phase "later" — not urgent, it's explicitly optional.

**What shipped this week** (for context, don't redo it): Sheets pagination
fix for tabs >1000 rows (#37), Content Queue tab read/write support (#38),
a full UX redesign across Next up/Posts/Calendar/Published/Fix issues/panel
— several iterations landing on a black-text + one-blue-accent palette with
red reserved for genuine blockers, no colored status-pill clutter (#31,
#39, #40, #45), a new Backlog page that mirrors the Content Queue Sheet tab
grouped by source with inline spreadsheet-style editing (#39, #45), and
most recently Backlog gained Platform/PESTO/Hook template/Approved columns
with filters (#47, merged) and — the PR open right now (#49) — made those
three fields directly editable per row (Platform as a closed-enum select,
PESTO/Hook template as click-to-edit text with datalist suggestions pulled
from values already used elsewhere in the Sheet, never invented).

## 6. Known next steps, in priority order

1. **Land PR #49** (see §5) if still open.
2. **Investigate and resolve stale PR #32** (see §5).
3. **The "repurpose tracking" feature is designed but blocked, not
   started.** James wants to track when a post gets repurposed from one
   platform to another (any platform → any platform, not just X→LinkedIn —
   he corrected the scope from the narrower version when it was first
   proposed). This needs a new field to record "repurposed from / to"
   somewhere. **Per §2, this agent must not create that field itself.**
   James needs to add it to the Sheet (or his other tool needs to), and
   tell this session the exact column name/placement, before any code
   gets written. Don't propose a workaround that avoids asking him — that's
   exactly the mistake this session caught itself making mid-plan.
4. **CS-018/CS-019** (accessibility/security release gate, isolated
   deployment + rollback) are P0 but not time-pressured — pick up when
   nothing higher-priority is queued.
5. **CS-020** (optional Supabase seam) is explicitly low-priority/optional
   — don't start it unprompted.
6. Two loose ends mentioned but not chased down this week: an Anthropic API
   key still needed for the interview-answer-quality eval feature on the
   HireSign side (unrelated repo, just noted in passing — not a Content
   Studio blocker), and confirming what AI key `replies.jamesbugden.com`
   needs. Worth asking James if either is still outstanding, not assuming.

## 7. Things that will burn time if you don't know them going in

- **Playwright + stale build**: `reuseExistingServer: true` in
  `playwright.config.ts` means a `.next` left over from a previous run gets
  served as-is. Always `rm -rf .next` before trusting a Playwright result
  that's supposed to prove a code change works.
- **The synthetic test fixture has non-obvious defaults.** Every row in
  `src/fixtures/synthetic.ts`'s `LIBRARY_DEFAULTS` defaults to
  `targetPlatform: 'LinkedIn'` and `hookTemplate: 'Contrarian #12 -
  Everyone says X, but Y'` unless a row overrides it. This bit a test this
  week — asserting an exact list of "distinct values in the sheet" without
  accounting for the shared default produced a false failure. Check
  `LIBRARY_DEFAULTS` before writing an assertion that depends on exactly
  which fixture rows have which values.
- **`LIBRARY_WRITABLE` in `src/domain/sheet-schema.ts` is an explicit
  allow-list**, enforced server-side in
  `src/integrations/google/sheets-repository.ts`'s generic `update()`
  method (`VALIDATION_FAILED: field_not_writable` if you try to patch a
  field not on the list). If a feature needs to write a field that already
  exists in `LIBRARY_HEADERS` but isn't in `LIBRARY_WRITABLE` yet, adding it
  to that list is the correct fix (that's not the same thing as §2's rule —
  §2 is about the *Sheet's* columns, this is about which of the *existing*
  columns the app is permitted to write).
- **Header discovery is by name, never by position** — Sheet column order
  can change without breaking anything, per `docs/MASTER-SPEC.md`. Never
  hardcode a column letter/index.
- **Browser-typing into a live Google Sheet cell silently fails to save.**
  If a task ever seems to require writing to the Sheet directly (it
  shouldn't, given §2, but just in case for read-only inspection that turns
  into an accidental edit) — the app's own Sheets API write path is the
  only reliable way to persist a change, not manual browser interaction
  with sheets.google.com.
- **Vercel auto-deploys `main` on every merge** — there is no separate
  manual "Deploy" step like some of James's other projects. Don't wait for
  him to promote anything; don't ask.

## 8. Quick reference — commands used constantly this week

```bash
# state check
git fetch origin && git status
gh issue list --state open
gh pr list --state open

# new work
gh issue create --title "CS-NNN - <title>" --body "..."
git checkout -b jb/cs-NNN-<slug>

# verify before a PR
npx tsc --noEmit -p .
npx eslint <files>
npx vitest run
rm -rf .next && npx playwright test tests/e2e/<spec>.spec.ts --reporter=line

# ship
git add <files> && git commit -m "CS-NNN: <summary>

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -u origin <branch>
gh pr create --title "..." --body "...Closes #NNN..."
gh pr checks <N> --watch
gh pr merge <N> --squash --delete-branch

# verify live
npx vercel ls --yes
# then load https://content-studio-blond-rho.vercel.app in a browser and check the actual change
```

---

That's the whole picture. Read `AGENTS.md` next for the full policy this
was condensed from, then `docs/MASTER-SPEC.md` for the domain/architecture
detail, then get moving on §6 item 1.

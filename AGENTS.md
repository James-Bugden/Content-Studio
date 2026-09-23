# Content Studio agent instructions

This file is the canonical tool-neutral engineering policy for Content Studio.
Claude, Codex, Orca, or another capable coding agent may drive the workflow.
The process must not depend on First Mate.

## Read before editing

Read `docs/MASTER-SPEC.md`, the assigned GitHub issue, and any linked
implementation/testing contracts before changing code. Resolve current
repository/issue/PR/deployment state first. Preserve unrelated work and use an
isolated branch/worktree or managed isolated checkout.

## Sources of truth

- Google Sheet: operational source of truth.
- Drive: canonical Markdown/source assets.
- Typefully: final editing/publishing surface.
- Supabase: later migration option, not an MVP dependency.

Do not create a parallel source of truth.

## Default autonomy

James is non-technical and prefers maximum safe autonomy. Routine engineering
work should proceed end-to-end without asking him to approve each step.

Agents are authorised to:
- inspect state and refine issue scope
- create/update issues, plans, branches and worktrees
- implement and write tests
- fix test/review failures
- commit and open/update PRs
- run independent review and adversarial verification
- run required T0–T4 QA
- enable auto-merge / merge green PRs
- deploy/promote through repository-supported tooling when permitted
- run staged/production smoke checks
- close issues and update durable docs/QA evidence

Ask James only for:
- two materially different product outcomes that cannot be resolved from evidence
- a genuinely new design direction, a new major user-facing surface whose
  interaction model is not specified, or a large/material UX change
- access-control/privacy decisions that could expose user data
- payment/billing or money-movement changes
- irreversible/destructive production-data operations without proven rollback
- credentials/account permissions that literally require the owner

Routine UI fixes and work that follows the approved design system do not need
James approval; verify them at T2 instead.

## Public code and private data

Public GitHub content must use synthetic fixtures only. Never commit private
post copy, Drive contents, spreadsheet rows, OAuth tokens, Typefully
credentials, owner identifiers, production screenshots, secrets or environment
values.

Use shared typed adapters and fake implementations so UI work does not require
live credentials.

Every mutation needs authentication, validation, an idempotency key, conflict
detection and an auditable result. Never silently overwrite a newer Sheet row,
Markdown revision, Typefully edit or user draft.

## Change classification and PRD

Classify every code change:
- Trivial: mechanical/localized, low ambiguity, small blast radius.
- Standard: bounded logic or multi-file change.
- Heavy: architecture, schema, auth/access, migrations, broad refactor,
  cross-system work, or ambiguous/high-risk behavior.

For a new app, new major feature, new user-visible surface, or epic that
plausibly breaks into multiple issues, use
`.agents/skills/bm-prd-creator/SKILL.md` before implementation. Skip PRD for
bugs, refactors, copy tweaks, chores, and already-specced child issues.

The PRD process must inspect the repo/specs/issues first and infer routine
answers from evidence. Do not re-ask established stack/product decisions.

## Issue readiness

Before implementation, a bug issue should define:
- current vs expected behavior
- reproduction steps and evidence
- affected flows
- acceptance criteria
- non-goals
- likely regression areas
- required verification tier/evidence

A feature issue should define:
- desired outcome/context
- user flow and in-scope behavior
- dependencies/constraints
- non-goals
- failure/edge states
- acceptance criteria
- likely regression areas
- required verification/evidence

Use `.agents/skills/issue-scoping/SKILL.md` for the detailed procedure.

## Build and verification

One logical task per branch/PR unless an issue explicitly defines a rollup.
Implement the smallest safe change that satisfies the issue. Add the lowest-cost
reliable regression for confirmed bugs where practical.

Verification:
- T0 for every relevant code change.
- T1 Playwright for deterministic browser/user-flow changes.
- T2 agentic browser/UX review for user-visible UI/UX changes.
- T3 simulator/emulator for mobile-sensitive behavior.
- T4 physical device/browser when native hardware/browser behavior matters.

A skipped, blocked, inconclusive, advisory-red, or never-started check is not a
pass.

For Heavy/high-risk or multi-agent work:
- keep builder and independent reviewer separate where practical
- run `.agents/skills/adversarial-verify/SKILL.md`
- scrutinize provider conflicts, stale revisions, idempotency, concurrency,
  auth/privacy and false-green tests

For implementation handoff, record exact commit/build identity,
commands/results, applicable acceptance IDs, unresolved risks and issue/PR
links.

## PR, review and auto-merge

Every PR must link its issue and include:
- why the change exists
- acceptance-criteria status
- tests/environments/evidence
- unresolved risk/limitations

Routine review findings are fixed automatically and relevant tests rerun.
Do not ask James whether ordinary review findings should be fixed.

Auto-merge/self-merge when:
- every repository-required CI/check context positively reports green
- required acceptance criteria are evidenced
- blocking review findings are resolved
- final acceptance retest passes
- no human-only carve-out above applies

No CI, skipped CI, pending CI, blocked CI or unknown CI is not green.

## Deployment and closure

After merge, verify the staged/deployed build rather than assuming the merged
commit is production behavior. Use repository-supported deployment tooling to
promote and smoke-test production when the active runtime has permission. If
the runtime genuinely lacks required account permission, record that single
owner-only blocker.

Close the linked issue only after required post-merge verification is complete.
Update workflow/docs/QA evidence when the change makes them stale.

## Portable skills

Shared tool-neutral procedures live under `.agents/skills/`:
- `bm-prd-creator`
- `issue-scoping`
- `implementation`
- `code-review`
- `adversarial-verify`
- `qa-regression`
- `ship`

Harness-specific instructions may describe invocation mechanics but must not
replace this policy with a different workflow.

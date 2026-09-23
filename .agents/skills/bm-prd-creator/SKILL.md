---
name: bm-prd-creator
description: Create a PRD for a new app, major feature, new user-visible surface, or epic and break it into buildable milestones.
---
# PRD Creator
Adapted from Builder Methods bm-skills/bm-prd-creator for maximum safe autonomy.
Use for new apps, major features, new user-visible surfaces, or epics that
plausibly break into multiple issues. Skip for bugs, refactors, copy tweaks,
chores, and already-specced child issues.

Before asking anything, read AGENTS.md, the repo, existing specs/decisions,
related GitHub issues, and current product behavior. Fill routine answers from
evidence. Ask James only when two plausible answers materially change the
product or the design gate in AGENTS.md is triggered.

Process: brain dump/request → core purpose → in-scope features → explicit
out-of-scope → existing stack/starter → required integrations → conceptual data
model → per-feature user-facing scope → dependency-ordered milestones → write
`_build_plan/prd.md` and milestone prompts → create/update an epic and one
issue per milestone. The PRD locks what, not how. Routine UI following an
approved design system does not require James approval; new design directions
or large/material UX changes do.
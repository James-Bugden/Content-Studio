---
name: ship
description: Open the PR, prove merge readiness, auto-fix review findings, auto-merge permitted work, verify deployment and close the issue.
---
# Ship
Open/update the linked PR with why, acceptance status, test evidence and risk.
Run independent review and final functional/UX/device retest. Fix routine
blocking findings automatically. Require positive green evidence from every
required check; missing/skipped/pending/blocked/inconclusive/never-started is
not green. Auto-merge routine work when green unless AGENTS.md carve-outs apply.
New design directions or large/material UX changes require approval before
implementation, then return to the normal autonomous ship path. After merge
verify staged/deployed behavior, promote automatically when tooling/permission
allow, smoke-test production, close only after post-merge verification.
---
name: implementation
description: Execute one scoped issue safely from isolated branch/worktree through PR-ready verified code.
---
# Implementation
Read AGENTS.md, issue, specs/contracts and live state. Classify risk/T0–T4.
Work in one isolated branch/worktree. Implement the smallest safe change,
preserve unrelated work, add a reliable regression for confirmed bugs where
practical, self-review the actual diff, run T0 and targeted tests, and invoke
adversarial-verify for Heavy/high-risk/multi-agent work. Resolve routine
ambiguity and document it rather than handing it back to James.
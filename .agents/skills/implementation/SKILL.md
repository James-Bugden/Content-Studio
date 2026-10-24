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

Before handing off a Content database/read-path change, run all of
`tests/unit/security`, the entire `tests/unit/application` directory and
`tests/unit/supabase` (not just the edited files). This includes health and
server-boundary checks; a targeted cutover test alone is insufficient. On a
memory-limited workstation use the shared queue, for example:

```sh
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase --maxWorkers=1
```

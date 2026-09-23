---
name: code-review
description: Independently review a PR/diff against the issue, architecture, risk and tests.
---
# Independent code review
Prefer a reviewer that did not implement Heavy/high-risk work. Check acceptance
criteria, unrelated changes, integration seams, auth/privacy/secrets,
RLS/access control, data loss, idempotency/retries/races, stale state,
error/loading/empty/recovery states, accessibility/i18n/design regressions,
vacuous/skipped tests, migration/deployment mismatch, dead code and unnecessary
complexity. Fix routine blocking findings automatically, rerun tests, re-review.
---
name: adversarial-verify
description: Try to falsify a green build before PR/merge, especially for Heavy, high-risk or multi-agent work.
---
# Adversarial verification
Run 2–4 skeptical lenses: correctness/edges, integration/state/concurrency,
auth/privacy/RLS, cost/abuse/retries, UX/a11y/i18n, false-green test integrity,
or performance/pathological input. Use committed diff and real execution
evidence. For test-integrity checks mutate the implementation, not the test,
and prove the mutation applied. Fix verified defects, add regressions, rerun.
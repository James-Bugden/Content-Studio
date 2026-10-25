# CS-065 build report — round 1

Role: build. Tier: Standard. Branch: `cs-200-env`.

Implementation commit: `b86550ed8cfb4f5e70656a52f260fba258d0e237`.
Base/local `origin/main`: `daa475f580b1a3860c786eb48e463418a4f80576`.
This report is committed separately after the implementation.

Task identifier supplied: PR 200. Read-only `gh pr view 200` and
`gh issue view 200` could not resolve that number in the repository; the owner's
request was the implementation contract. No GitHub writes, push, deployment,
or live Vercel/LastPass/health calls were made.

## Delivered acceptance evidence

| ID | Outcome | Evidence |
| --- | --- | --- |
| ENV-1 | Complete schema inventory, requiredness, secrets, defaults, capabilities and LastPass convention | `scripts/env-manifest.json`; every Zod key, schema requiredness and schema default checked by unit test; provisioning defaults validated against Zod |
| ENV-2 | Repeatable names-only Production bootstrap | `npm run env:setup`; dry run, capability filter, explicit rotation, CI/TTY refusal, correct project link, conflict recheck and post-write name verification |
| ENV-3 | Secrets isolated from arguments, child environment, logs and errors | Piped stdin, no shell, suppressed provider output/raw errors; inherited app settings and Vercel project overrides removed; mocked process failure tests |
| ENV-4 | Recoverable cron generation | Explicit opt-in; 32 random bytes hex; vault absence check; LastPass save before Vercel; no generation for rotation or other secrets |
| ENV-5 | Deployed public health verifier | `npm run env:verify`; HTTPS origin, no redirects, timeout, capability table, nonzero for missing required configuration/provider error/invalid response/fake mode |
| ENV-6 | Owner instructions, no paid CI | `docs/ops/env-setup.md` and deployment runbook updated; no workflow/dependency additions |

The only application source change exports the existing server-only Zod schema
for the drift test. Parsing and production gates are unchanged. Defaults retain
Sheet authority and disable Google writes, database writes and Supabase mirror.
Deployment/test metadata is inventoried but never provisioned.

## Verification

All Vitest, TypeScript and ESLint invocations used `bash ~/bin/heavy`. Only
requested directories and the new focused file were tested, never the full
suite. New tests mock all child-process and HTTP interactions.

| Command/check | Result |
| --- | --- |
| `bash ~/bin/heavy npx vitest run tests/unit/env-bootstrap.test.ts --maxWorkers=1` | PASS: final 47 tests |
| `bash ~/bin/heavy npx vitest run tests/unit/env-bootstrap.test.ts tests/unit/security tests/unit/application --maxWorkers=1` | INCOMPLETE: 317 tests passed, 21 files passed; one application suite could not import missing `@electric-sql/pglite`. This run had 46 bootstrap tests; the final additional guard test passed in the focused run. |
| `bash ~/bin/heavy npm run typecheck` | BLOCKED/RED: shared dependencies lack `@supabase/supabase-js`, `@electric-sql/pglite` and its contrib module, with downstream existing type errors. No bootstrap-file diagnostics. |
| `bash ~/bin/heavy npm run lint` | PASS |
| `bash ~/bin/heavy npx eslint scripts/env-setup.mjs scripts/env-verify.mjs tests/unit/env-bootstrap.test.ts src/lib/env.ts` | PASS on final source/tests |
| `npm.cmd run check:private` | PASS, including staged additions |
| `npm.cmd run check:secrets` | PASS, including staged additions |
| `git diff --cached --check` | PASS |
| Guard mutation checks | PASS: 48 distinct mutations caught; original source restored after each run |

Mutation runs used the shared queue and focused mocked tests. Coverage included
CI, TTY/bypass, project link, managed metadata, capability selection/validation,
existing values, AI defaults, dry run, LastPass status/missing/empty entries,
required-entry failures, generator opt-in/cron-only/no-rotation, vault success/
absence, save-before-Vercel, concurrent additions, write result/name recheck,
rotation existence/target/operation/capability/validation, listing success/table
format, inherited secret/project filtering, output bounds, timeout, failed-output
suppression, no-shell execution, unknown arguments, health live/required/
duplicate/origin/userinfo/path/HTTP/redirect guards, and manifest name/
requiredness/default drift. An initially uncovered managed-metadata guard gained
a regression test and its mutation was rerun successfully. No selected mutations
survived the final checks.

T1–T4/browser QA is not applicable to this CLI/documentation change. Live
integration, redeployment and post-deploy verification were explicitly excluded
and are not claimed as passing.

## Limits and handoff

- Overall verification is not green until the missing shared dependencies are
  available and application tests/typecheck finish. No install/ci was run;
  `node_modules` is the main checkout's shared junction.
- Health proves configuration presence, not credential validity or provider
  connectivity. Supabase/cron are absent from the current health contract and
  show `unreported` / `unverified`. Sheet/Drive read-only states are accepted
  because bootstrap leaves writes disabled.
- Names-only verification cannot compare existing values. Rotation explicitly
  updates one existing name. Vercel has no atomic compare-and-set here; avoid
  concurrent setup/rotation sessions. Rechecks protect observed add conflicts.
- Native Windows supports the standard npm Vercel shim without a shell and
  requires native `lpass.exe`; otherwise use one POSIX environment for the
  complete workflow. No live platform/provider execution was performed.
- Tests used synthetic sentinels only. No secret values were written to files,
  arguments, child environments, logs, or public artifacts.

Scratch was outside the repository. Its absolute path and absence of junctions
were verified; files were deleted individually and the empty directory removed.
No scratch leftovers remain. The original `node_modules` junction is preserved.

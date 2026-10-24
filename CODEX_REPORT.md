# CS-059d build report — round 1

Implemented the bounded follow-ups from [#183](https://github.com/James-Bugden/Content-Studio/issues/183)
and [#184](https://github.com/James-Bugden/Content-Studio/issues/184).
Tier: Standard. Role: build. Branch: `cs-185-fu`.
Base: `d2c0ab58eef2e5af621d07c0a1c53620773b608f` (`origin/main`).
Implementation commit: `41dd7aae50fe8e20fa7d0adda4dfb7aa8b493fee`.
This report is committed separately after verification and scratch cleanup.

## Scope and results

| Finding | Result |
| --- | --- |
| #183.1 | Parameterized the existing failed import-ID read test with/without an import before save, across fake and PGlite implementations. No production change needed. |
| #183.2 | Latest-import first-row queries omit the unused `Prefer: count=exact`. Other paginated reads retain their count preference. No index/migration added or applied. |
| #183.3 | Documentation only: preserve the 60-second backoff; explicitly measure old-overlay duration and lag-caused `STALE_READ` around an import in Phase C before deciding the trade-off. |
| #183.4 | Documentation only: watch `sweep-fault-375`; on recurrence retain SHA/trace/fault seed and diagnose rather than accepting a rerun. No speculative flake fix. |
| #184.1 | Added the one-line assertion that the default Sheet Replies append writes boolean `false` for Queue for Schedule. No production change needed. |
| #184.2 | Fresh parity compares unknown cells against the export checkpoint for DB-origin ideas. Hand edits block exact parity and reconciliation says parity is blocked; rollback continues refusing. Owned projection hashes may still match, which the runbook now explains. |
| #184.3 | A duplicate stable ID invalidates its tab once per export run, generating one lag issue instead of one per DB row. Regression also removes the duplicate and proves repair clears the issue. |
| #184.4 | Added named recovery `change_authoritative_value` / “Change authoritative value” to the refusal and reconcile facts. The runbook specifies the normal audited, revision-checked replacement patch and retry. Leading-equals text remains blocked; no new mutation endpoint or automatic copy transformation. |
| #184.5 | Took the permitted documentation option. The archive verifier and SQL restore both require the compiled schema version; a safe historical reader needs a matching restore contract. Added the pre/post-bump re-backup procedure, matching-build preservation, old/new empty-branch restore drills, retained hashes and stop conditions. No backup format or verification behavior changed. |
| #184.6 | Queue append serializes only cells owned by that DB row; an unknown Queue header named Posted receives blank text instead of boolean false. |
| #184.7 | Documentation only: a same-cell hand edit between fresh read and write can be silently lost, and read-back cannot detect it. Phase D must record the owner's measurement/acceptance or stronger-control decision. No race policy invented. |

Read AGENTS.md, MASTER-SPEC, ADR-0002, migration contracts, relevant read/export,
parity/reconciliation, archive verification and SQL restore code. The issue texts
were supplied in the task. A read-only `gh pr view 185` found no PR with that number;
no PR was created or changed. This is a local build handoff, not a CI/merge claim.

## Regression and mutation evidence

The four new export/recovery regressions failed against the original implementation
before their production fixes. Final committed regressions also killed each isolated
reverse mutation below in scratch. Test-only findings intentionally pass on the
original implementation and fail under the specified mutants.

| Probe | Isolated mutation | Observed red result |
| --- | --- | --- |
| Y02 / #183.1 | Failed latestImportId read returns null instead of undefined | New no-prior-import variant fails for both fake and PGlite (2 failures); the prior-import variants still pass, demonstrating the original coverage gap. |
| N21 / #184.1 | Replies append writes the domain string directly | 1 failure: received string FALSE, expected boolean false. |
| #183.2 | Restore exact-count preference on the latest-import query | 2 failures (empty/nonempty import history): preference present, expected absent. |
| #184.2 | Disable checkpoint comparison for unknown cells | 1 failure: parity exact true, expected false. |
| #184.3 | Remove the skip for a tab already rejected for duplicate IDs | 1 failure: five lag items, expected one. |
| #184.4 | Remove the named recovery marker | 1 failure: reconcile facts lack Change authoritative value. |
| #184.6 | Restore serialization of every append header | 1 failure: received boolean false for unknown Posted, expected blank text. |

Each mutant was restored before subsequent checks. The four changed test files
passed together: **158 tests**. The final required directory run passed:

```text
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase tests/unit/google/queue-repository.test.ts --maxWorkers=1
30 files passed; 516 tests passed; exit 0

bash ~/bin/heavy npm run typecheck
exit 0

bash ~/bin/heavy npm run lint
exit 0

git diff --check
passed
```

Verification used an isolated copy at `C:\Users\jbbug\tmp\cs185-verification`.
The shared dependencies lacked PGlite and Supabase JS. Their already-declared,
lock-version packages were fetched with `npm pack --ignore-scripts` and unpacked
only in scratch, including required Supabase transitive packages. No npm install/ci,
new dependency, manifest/lockfile change, or main dependency installation was made.
Scratch received its own Git index because security/acceptance checks use git ls-files.
Initial missing-package/missing-Git failures were setup failures, not green results;
the final directory run, typecheck and lint passed after correcting that setup.
Mutation tooling initially hit Windows text encoding errors; UTF-8 capture fixed
the harness, and the red results above are actual test failures.

The inherited toolchain reported Vitest 5.0.1 and Next 16.3.6, differing from the
package.json versions. These are local results using the supplied dependency tree,
not proof of a fresh lockfile installation or hosted CI.

## Browser evidence and acceptance limits

Synthetic localhost only, fake DB/Sheet/Drive/Typefully, no live provider access.
Ran a Playwright recovery journey through the shared heavy queue: owner test login,
editor save of leading-equals text, blocking reconcile message, replacement editor
save, then exact export parity and no mismatch. No page errors. Inspected screenshots
at 375/500/750/1280 CSS px and the recovery card at 200% CSS zoom; text wrapped and
no horizontal overflow was detected. CSS zoom is not native browser zoom evidence.
Browser commands were `bash ~/bin/heavy node browser-check.mjs` and
`bash ~/bin/heavy node browser-zoom.mjs` in scratch; both exited 0. These temporary
scripts/screenshots are included in the leftover inventory below.

The scratch server used `bash ~/bin/heavy node node_modules/next/dist/bin/next dev
--webpack --port 3195 --hostname 127.0.0.1`. Turbopack first rejected junction-backed
Next resolution; webpack served the same committed sources successfully. Both owned
server launches were stopped by verifying their launcher command and port; no other
Node processes were stopped. Final committed changed files matched verified scratch.

MIG-11/12 regression behavior is locally evidenced. MIG-05/12/13 live/copied-workbook
and Supabase-branch rehearsals, hosted backup confirmation, production smoke and the
14-day comparison remain open under #150. T3/T4 were not run, as live systems were
out of scope. No live schema/workbook, deployment, flag or schedule was changed.
Default store remains sheet; live DB gates remain intact. No push, gh write, merge,
deployment or issue closure occurred. Independent review remains the next role.

## Scratch cleanup and exact leftovers

Detached **363 junctions individually**, then verified **zero reparse points**
before attempting recursive deletion. The repository node_modules junction remains
`C:\Users\jbbug\projects\content-studio\node_modules`.

Automatic approval review rejected recursive scratch deletion with **“blocked by
policy”**, including a separate literal-path attempt after junction detachment.
No alternate deletion mechanism was used. Exact remaining roots/artifacts:

- `C:\Users\jbbug\tmp\cs185-verification`: 2,188 files and 576 directories below
  the root, zero reparse points; includes the detached verification copy, unpacked
  declared packages, local Git metadata, logs, scripts and synthetic screenshots.
- `C:\Users\jbbug\tmp\cs185-leftovers.txt`: exhaustive sorted directory/file
  inventory with byte sizes for that directory. SHA-256:
  `408BBAB6A977F8B34C42B70CC0DC6343641EB0EFF466951A924CED17C35823DD`.

These leftovers are outside the repository. No junction target was recursively deleted.

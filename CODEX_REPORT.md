# CS-072 review fix report - PR #225, round 1

Heavy / fix; branch `fix/224-angle-label`, assigned worktree `225`.
Issue: https://github.com/James-Bugden/Content-Studio/issues/224
PR: https://github.com/James-Bugden/Content-Studio/pull/225
Reviewed head: `1332df027d29b2e948e10e4ba4190b50f897bc60`.
Fix identity: the commit containing this report (`git rev-parse HEAD`).
Date: 2026-10-26. The earlier build report is superseded by this review-fix evidence.

## Scope and acceptance

Read the PR's REQUEST CHANGES verdict through `gh pr view 225 --comments`
(read only), issue #224, MASTER-SPEC, database migration contract and write
cutover runbook. Applied implementation, adversarial-verify, code-review and
qa-regression procedures. No implementation, migration, authority, or gate
behavior changed; only two test files, the mutation runner and this report.

- Non-ASCII digits: `\uFF17. x` (fullwidth 7) and `\u0667. x`
  (Arabic-Indic 7) are refused. Fake-store tests assert the validation reason,
  `refused_numeric` class, `content_angle` field, refusal count, redacted ledger
  and absent imported row. PGlite repeats both cells for Library and Queue,
  asserting the persisted SQL ledger class/field and absent SQL row while other
  rows commit.
- Exact bytes: Library AND Queue each exercise `7. Cafe\u0301` (decomposed
  Unicode) and `7. exact\t` (terminal tab), alongside the existing padded label.
  Assertions cover the imported integer/raw metadata, rendered bytes, export
  bytes, unchanged rollback bytes and exact equal rollback hashes. Editing or
  clearing the integer still discards a stale label.
- Exact parity: both collections compare equal before alteration and report a
  blocking `cells.contentAngle` change for NFC-composed Unicode or tab removal.
  PGlite repeats these byte checks after the complete Content migration chain,
  actual shadow import/measurement RPCs, and SQL persistence. Its full parity
  evidence requires every measured field equal and zero refused rows for valid
  labels; the changed-angle CAS RPC remains covered.

## Verification

All heavy commands ran through `bash ~/bin/heavy`, with one Vitest worker.
The mutation runner asserts `HEAVY_LOCK_HELD=1`; its child Vitest runs inherit
that shared-queue slot. No full suite, dependency install, push, GitHub write,
merge, deployment or live provider operation was performed.

PGlite, mutation checks, broader validation, typecheck and lint ran in a scratch
COPY at `D:/wt/cs224-fix-r1`. Tracked repository files only were copied, without
private environment files. Its `node_modules` junction targeted exactly
`C:/Users/jbbug/projects/cs-wt/163/node_modules`. A scratch Git index supports
Git-aware security checks. The junction was unlinked with `cmd //c rmdir` after
validation; the scratch copy and synthetic evidence are retained. Shared
dependencies were preserved. No recursive deletion under `cs-wt` was attempted.

```text
bash ~/bin/heavy npx vitest run tests/unit/supabase/content-angle.test.ts tests/unit/supabase/content-import-pglite.test.ts --maxWorkers=1
bash ~/bin/heavy node tests/support/content-angle-mutations.mjs
bash ~/bin/heavy npx vitest run tests/unit/security tests/unit/application tests/unit/supabase --maxWorkers=1 --reporter=json --outputFile=D:/wt/cs224-fix-r1-validation.json
bash ~/bin/heavy npm run typecheck
bash ~/bin/heavy npm run lint
node --check tests/support/content-angle-mutations.mjs
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
git diff --check
```

- Focused real-code run: **76 tests passed** (56 angle, 20 import PGlite).
- Mutation baseline AND final restored run: **76 passed each**, zero failed or
  pending. **21/21 mutants killed** with actual assertion failures.
- Broader targeted run: **47 files / 1,131 tests passed**, zero failed or pending,
  native exit 0. Covers all application, Supabase and security test files,
  including content-angle, content-import, export, parity and PGlite suites.
- Typecheck, repository lint, runner syntax check, private-path and secret scans,
  and diff whitespace check: **pass**, exit 0.
- T0 applies. T1-T4 are not applicable to this tests-only change. No hosted CI
  or deployment result is claimed for the unpushed fix.

Machine-readable broader results and log: `D:/wt/cs224-fix-r1-validation.json`
and `D:/wt/cs224-fix-r1-validation.log`. Mutation baseline, restored, per-mutant
JSON/logs and `summary.json` (including failing test names and hashes) are under
`D:/wt/cs224-fix-r1/angle-mutation-results`.

## Adversarial mutation evidence

Lenses: ASCII grammar/refusal/privacy; exact text and state across SQL/import/
export/rollback; false-green parity and test integrity. Replacements are
asserted to match once and change SHA-256. Each mutation restores the original
Buffer in `finally` and compares it byte-for-byte; all files are checked again
at final exit. Tests are never mutated. Assigned-worktree implementation hashes
also match the original reviewed implementation.

Before = after SHA-256:

| File | SHA-256 |
| --- | --- |
| `src/domain/content-angle.ts` | `684810235fc65f3132a34f5de1026aa8ee6d2089c3a84dc26e1b9b2445ac112c` |
| `src/application/content-import.ts` | `23f84c76fd7920a9ea256db5c6970a635af2e69361771db1eb3a5d8f3c863c95` |
| `src/integrations/supabase/content-repository.ts` | `cee399c473df2ec77957f682e5c671b5b33568e759c32382283d82da77716a08` |
| `src/application/content-parity.ts` | `d45c233d088a92b67436021f298f1af928fb62ea16390e682aad925b3b39760b` |

| New mutation | Changed SHA-256 | Actual failing tests |
| --- | --- | --- |
| G19: parser `.exec(text.normalize('NFKC'))` | `e8073b533674f9f2596d9b2f460bceb72ab1afe8b5976e85ce71673533b870ef` | 3: fullwidth fake refusal + Library/Queue SQL refusals |
| G20: store `text.normalize('NFC')` | `ad7963fee8ec9a788db8cb7e99445718059fab1f9451c4df8dffc05b7a4af939` | 6: Library/Queue fake rollback, fake parity, SQL round trips |
| G21: store `text.replace(/\t+$/, '')` | `707e578ad832cd8ba4e301215c98ba76baab24a584af94e4784030c605b44c8b` | 6: Library/Queue fake rollback, fake parity, SQL round trips |

Every new mutation must fail actual assertions in BOTH test files, enforced by
the runner. Arabic-Indic refusals remain green under NFKC because that transform
does not convert those digits; they pass on real code as required.
Existing G01-G18 also remain killed (failed-test counts respectively:
16, 1, 1, 1, 2, 2, 3, 1, 1, 52, 22, 26, 35, 1, 4, 6, 34, 6).

Self-review confirmed each reported failure belongs to the intended new fixture
and both collections are covered. The PR's independent reviewer verdict is the
source of this fix; no new independent-review or remote CI verdict is claimed.
No unresolved implementation defect was found. All three review test-integrity
findings are covered and mutation-proven. The issue remains open and the commit
is local, as required by the no-push/no-GitHub-writes instruction.

# CS-075 — issue #229, build round 1

Implemented [issue #229](https://github.com/James-Bugden/Content-Studio/issues/229) on `fix/229-parity-shape`. Classification: **Heavy**; scoped bug fix, no PRD required.

Base/main: `4f82166e44a66fced4d3db75e5060093b4cee0c1`.
Verified implementation Git tree, before adding this report and mutation evidence: `e570015a410ef4fc5605bd9fe9913638bdb55872`.
The containing commit is the final build identity. All 15 implementation, test and runbook files matched the verified scratch copy byte-for-byte by SHA-256.

## Result and acceptance evidence

| Concern | Implemented behavior and regression evidence |
| --- | --- |
| Schedule timestamps | Shared timestamp parsing/comparison/formatting covers import and DB rendering. Parity classifies equivalent instants in both `cells.*` and schedule `value.*` as `timestamp_formatting`, counting them equal. Offset/date-boundary, fractional-second, microsecond and previously accepted minute-only representations pass. Different seconds/fractions and changed/missing final-copy hashes remain blocking. Timestamp-looking copy remains exact text. |
| Ready Queue placeholder | One exact predicate is shared by the Sheet adapter, mirror/import snapshot and parity. Only `No posts queued` with all other cells/links/extra-cell values blank is skipped. Snapshot counts exclude it. Similar IDs, nonblank data and other collections remain records; DB-side unexpected rows still block. |
| Absent summary tab | Cached reads retain explicit absence metadata. Only the existing first-page typed validation-error path derives the Sheet summary from its own stable-ID **Content Queue** rows. Present, empty and malformed-present tabs retain their existing comparison behavior; unrelated errors propagate. Cache expiry and absent/present transitions are tested. |
| Exact SQL semantics | PGlite loads the existing migration chain and compares against the actual `content_studio_queue_summary` and Ready views. Fixtures cover multiple sources, raw mixed review statuses, all five counts, overlapping Needs Fix reasons counted once, boolean import semantics, queue-only scope, master-link precedence, Markdown/empty fallbacks and UTF-8 `C` ordering. Real count and ID-set mismatches block. |
| Exact text and mirror shape | NFC/NFKC/tab differences remain distinct, including timestamp hashes and summary grouping keys. Blank, whitespace-only and trim-colliding sources have collision-free quoted mirror IDs and round-trip through the legacy mirror reader. Exact duplicate sources still conflict; nonstring sources remain refused. Existing #225/#228 regressions run in the complete Supabase directory. |
| Import lag | No lag code changed. A new complete unchanged import witnesses a fresh capture; replay, in-progress, failed and read-only work do not refresh it. The regression delays completion and asserts lag uses capture time. Live-path inspection confirms zero-TTL import reads, durable claim-start capture, and replay return before capture/apply/journal updates. The 15-minute limit remains unchanged. |

## Verification

All Vitest, typecheck and lint invocations used `bash ~/bin/heavy`. Tests ran in a scratch **copy** under `D:/wt`, with the requested existing `node_modules` junction; no dependencies were installed. Fixtures and database execution were synthetic/local PGlite only.

Final commands and results:

```text
bash ~/bin/heavy npx vitest run tests/unit/application tests/unit/supabase tests/unit/security tests/unit/google/sheets-missing-summary.test.ts tests/unit/google/sheets-repository.test.ts tests/unit/google/sheets-read-cache.test.ts tests/unit/google/sheets-stale-read.test.ts tests/unit/env-bootstrap.test.ts --maxWorkers=1
PASS: 55 files, 1409 tests; 258.21 seconds; no skipped tests

bash ~/bin/heavy npm run typecheck
PASS

bash ~/bin/heavy npm run lint
PASS

node scripts/check-env.mjs
node scripts/check-private-paths.mjs
node scripts/scan-secrets.mjs
git diff --cached --check
PASS
```

`env-bootstrap.test.ts` checks env-manifest/schema drift. The whole application, Supabase and security directories ran, not only edited tests. An earlier broad run exposed an obsolete test requiring blank summary-source rejection; it was replaced with preservation plus exact-duplicate rejection to match the SQL view, and the final broad run above passed.

Adversarial verification covered correctness/precision, integration/cache/identity, auth/privacy/fail-closed behavior, and test integrity. **53/53 distinct implementation guard mutations were detected by failing assertions.** SHA-256 changed for each mutation and matched the original bytes after restoration; timestamp mutations were repeated after preserving minute-only compatibility. [Mutation evidence](docs/qa/cs-075-mutations.json) records each guard, command, exit result, assertion and before/mutated/restored hashes. Every recorded original/restored hash matches the final corresponding workspace source.

Independent review used a separate read-only reviewer. Its three findings were fixed: microsecond truncation, trimmed summary-ID collisions, and blank-source rejection in the legacy mirror reader. Re-review found no remaining blockers. Review did not substitute for execution evidence.

T0 is complete. No UI/interaction changes require T1/T2; device/live T3/T4, remote CI and deployment verification were not performed in this explicitly local build scope. No production readiness or authority flip is claimed.

## Scope and handoff

Existing migrations, gate SQL, all thresholds, dependencies and the all-rows measurement runner are unchanged. No migration is required. Only explicitly requested read-only GitHub inspection occurred; no live provider calls, GitHub writes, push, deployment or issue closure occurred.

No unresolved implementation blocker remains. The coordinator can review this local commit and run the repository's remote CI/deployment workflow separately. Full local execution logs and the mutation runner are retained outside the repository in `D:/wt/cs-229-parity-artifacts-r1`. The scratch junction was removed with `cmd //c rmdir`; the dependency source remains intact. Automatic approval review rejected the combined recursive scratch-cleanup/commit command as “blocked by policy.” The unlinked scratch copy remains at `D:/wt/cs-229-parity-shape-r1`; recursive deletion was not retried.

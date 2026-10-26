# CS-076 build handoff — issue #230, round 1

Implemented [issue #230](https://github.com/James-Bugden/Content-Studio/issues/230)
on `feat/230-owner-cutover-panel`. Classification: Heavy; role: build.
Base commit: `4f82166e44a66fced4d3db75e5060093b4cee0c1`.
Implementation commit: `deeee551a166bce541db340b85bd755ca59eaea0`.
Implementation tree: `9f40396518da5dc7d52c2a7c708783535c33f8f4`.
Commit subject: `CS-076: in-app Database switch panel (owner session) for the cutover (#230)`.
This report is a separate documentation-only follow-up; application source is
identical to that implementation commit.

## Result and boundaries

- Owner sessions can read status and run the six cutover actions through the
  existing mutation identity and same-origin checks. The exact cutover path has
  the same maintenance exception as import/parity, allowing recovery during a
  Content freeze. Operation-specific guards still apply.
- A supplied Authorization header always uses the original constant-time bearer
  checker. Failed bearer credentials never fall back to a cookie. The cron
  export and backup routes remain bearer-only.
- The Database switch panel includes plain status/reasons, evidence and waiver
  state, the 15-minute import countdown, import/preparation actions and both
  exact-build, typed-ACTIVATE confirmations. It re-fetches on opening and again
  before activation, refusing changed decisions or expired import evidence.
- Pending UUIDs are saved before POST in tab-local sessionStorage, reused after
  unconfirmed results/reloads, and cleared only after a verified receipt.
  Pending activations cannot be reassigned to a different build.
- Existing private operation rows persist `owner_session` versus `cron_bearer`
  in an audit envelope. HTTP results unwrap it; legacy raw jobs replay unchanged.
  Redacted operation telemetry records actor class on success/failure. Owner
  response schemas discard private IDs, field names, arbitrary facts and copy.
- Phone dialogs use the shared native dialog as a bottom sheet, with 44px
  controls, exact build text, rollback instructions and keyboard focus recovery.
  The panel remains available when the surrounding reconciliation report fails.
- Fake previews return explicitly synthetic, red status. All six cutover actions
  disable; existing fake imports remain usable. Live failures never fall back
  to fake data. The owner quickstart and coordinator runbook document this path.

No runner, constant-time bearer checker, SQL, thresholds, waiver rules, authority
defaults, dependency or lockfile changed. No live call, migration, deployment,
authority switch, push, GitHub write or issue closure was performed.

## Verification commands and results

All Vitest, typecheck, build and Playwright commands used `bash ~/bin/heavy`.
PGlite ran only in a scratch COPY at `D:/wt/cs230-owner-panel`, with the requested
node_modules junction to the existing `163/node_modules`. No install ran. The
original worktree junction was preserved. No scratch recursive deletion ran.

| Command / environment | Result |
| --- | --- |
| `gh issue view 230 --repo James-Bugden/Content-Studio --json number,title,body,state,url` | Read issue contract; open. Read-only PR lookup found no PR at number 230. |
| `bash ~/bin/heavy npx vitest run tests/unit/application tests/unit/supabase tests/unit/security tests/unit/components tests/unit/env-bootstrap.test.ts tests/unit/cutover-runner.test.ts tests/unit/cutover-cli.test.ts tests/unit/cutover-acl.test.ts --maxWorkers=1 --reporter=dot` (scratch, final directory run) | **84 files, 1,737 tests passed**, 291.57s. This is the required directory selection, not the full repository suite. |
| Same directory selection before final additions | 82 files, 1,723 tests passed. |
| Targeted owner SQL/legacy/export retest using `-t 'owner export\|legacy completed\|owner-session'` | 4 selected tests passed; the other 258 were deliberately outside that targeted selection. The subsequent complete directory run above covered them all. |
| `bash ~/bin/heavy npx vitest run tests/unit/components --maxWorkers=1 --reporter=dot` after native-browser focus correction | **28 files, 232 tests passed**, 52.75s. Includes shared dialog and panel regressions. |
| `bash ~/bin/heavy npx vitest run tests/unit/security/cutover-owner.test.ts --maxWorkers=1` after explicitly adding POST same-origin-metadata success assertion | **32/32 passed**. |
| `bash ~/bin/heavy npm run typecheck` (scratch, final source) | Passed. |
| `bash ~/bin/heavy npm run lint` (original worktree, final source) | Passed. |
| `tests/unit/env-bootstrap.test.ts` in the required directory command | Manifest/schema drift coverage passed; no app env variable was added. |
| `node scripts/check-private-paths.mjs`; `node scripts/scan-secrets.mjs`; `git diff --cached --check` | Passed after staging the implementation. Repeated with the report before commit. |
| `bash ~/bin/heavy npm run build -- --webpack` (scratch) | **Blocked/failed** on unchanged Replies client import of `node:crypto` and cross-drive Next client module resolution. See limitations below. |
| `bash ~/bin/heavy npx playwright test --config=panel-harness/playwright.config.ts` (scratch-only synthetic component harness) | **2/2 passed**, Chromium 375×812 and 1280×900, 8.1s. Actual panel/shared dialog/CSS; router and HTTP are test doubles. |

T0 additionally proves real SQL operation claims, private actor envelopes,
cross-auth replay, unchanged atomic activation, changed-build refusal, legacy
raw-result replay, export mode/key conflicts and fresh verification on export
retry. Unit tests cover malformed status/receipts, unknown/expired import ages,
pending build mismatch, typed confirmation, disabled controls, stale decisions
and raw-text suppression. Secret-scanner tests intentionally plant synthetic
sentinels in temporary files; their expected diagnostics are not repo findings.

The committed T1 spec `tests/e2e/database-switch.spec.ts` runs at the existing
375 and 1280 projects on the fake-store app, with synthetic cutover HTTP fixtures.
It covers owner/viewer visibility, typed confirmation, reload/retry identity,
stale refusal, focus, overflow, phone sheet positioning, touch sizes and axe.
The existing shadow reconciliation import spec now targets Import now in the
new panel. The full Next app T1 journey was **not passed locally** because its
prerequisite build failed; CI browser evidence is still required.

The supplemental Chromium harness verified real rendered panel behavior at both
widths: lowercase/padded ACTIVATE refusal, successful exact confirmation, pending
UUID reuse after reload/timeout, stale gate refusal, native modal focus return,
375px bottom sheet placement, 44px inputs/buttons, no page overflow and zero axe
violations. Both phone panel and phone/desktop dialog screenshots were visually
inspected. It caught a real disabled-trigger focus race, which was fixed before
the final 2/2 run. This is component-level T2 evidence, not a deployed-app pass.

## Exact authentication matrix tested

GET and POST are both exercised unless a row states otherwise. Valid actions use
synthetic operation adapters/SQL, never production providers.

| Credentials / request proof | Expected and observed |
| --- | --- |
| Configured immutable owner subject; matching Origin; no Authorization | 200 status / valid mutation, including while Content is frozen and admission is red. Audit actor `owner_session`. |
| Same owner; no Origin; `Sec-Fetch-Site: same-origin` | GET and POST accepted through the shared fallback; metadata guard mutation was killed. |
| Same owner; CRON_SECRET unset; matching Origin | GET and POST accepted; owner auth needs no cron secret. |
| Viewer subject, unrelated subject or unbound subject; matching Origin | 403 before status/provider/service execution. |
| Anonymous; matching Origin | 401 before execution. |
| Unreadable session | 401; session exception text suppressed from responses and logs. |
| Owner; Origin missing and fetch metadata missing | 403 before execution. |
| Owner; literal `Origin: null` | 403. |
| Owner; foreign Origin, including with `Sec-Fetch-Site: same-origin` | 403; metadata cannot override an explicit foreign Origin. |
| Owner; no Origin; `Sec-Fetch-Site: cross-site` | 403. |
| Foreign request hostname and foreign Origin while APP_BASE_URL is configured | 403; configured origin prevents host spoofing. |
| Exact valid cron bearer; anonymous cookie and foreign Origin | 200; original bearer path ignores session/CSRF and returns original public bytes. Audit actor `cron_bearer`. |
| Empty Authorization, wrong bearer, lowercase `bearer`, or suffixed bearer; otherwise-valid owner session | 403 `cron_auth`; no cookie downgrade. |
| Missing CRON_SECRET with supplied bearer, including `Bearer undefined` | 403; no provider call. |
| Invalid bearer lengths/content | Refused using the existing two 32-byte digests and `timingSafeEqual`. |
| Exact `/api/ops/content-cutover` path during freeze | Owner maintenance allowed after CSRF/identity checks; SQL/action guards remain authoritative. |
| Lookalike `/api/ops/content-cutover/other` and ordinary Content write path during freeze | 403 `rollback_read_only`. |
| Owner session with matching Origin sent to scheduled export/backup GET | 403; cron routes remain bearer-only. |
| Owner/bearer: all six actions with valid UUID/body | Same execution/claim path; activation has the same exact expectedBuild binding. |
| Missing UUID or strict-body extra property | Refused before operation execution; activation-invalid bodies return 422, other invalid bodies 400. |
| Missing, malformed, uppercase, shortened or padded expectedBuild | 422 before claim/audit/epoch effects. |
| Different full expectedBuild, including common-prefix mismatch and changed-build replay | 409 before new durable effects. |
| Same UUID crossing owner/bearer after a completed activation | Same unwrapped receipt and unchanged authority epoch; original job actor retained. |
| Same UUID reused for another mode/action | Conflict; new export UUID in a non-DB mode also hits the original mode refusal. |
| Success, auth failure, validation failure, build refusal and unsupported methods | Private/no-store headers preserved. |
| Provider errors and unexpected private fields in status/results | Private copy, identity, cookie and credential text excluded from response/log assertions. |

## Independent review and adversarial checks

An independent Sol reviewer at xhigh reviewed auth/privacy, authority/state/replay,
test integrity and UI confirmation. No remaining blocking findings. Initial
export diagnostics were narrowed to aggregate receipts; fake action disabled
states and native focus recovery were also corrected and independently reviewed.

Thirteen separate implementation mutations were applied in the reviewer's own
scratch copy, their application/restoration checked by SHA-256, and each was
killed by behavioral assertion failures rather than compilation failure:

1. Remove owner-session boundary: 11 failed tests.
2. Remove bearer verifier: 4 failed tests.
3. Permit bad-bearer downgrade: 4 failed tests.
4. Remove missing-secret refusal: 1 failed test.
5. Remove constant-time comparison: 3 failed tests.
6. Remove same-origin delegation: 6 failed tests.
7. Weaken exact Origin match: 3 failed tests.
8. Permit missing/cross-site fetch metadata: 2 failed tests.
9. Admit viewer role: 1 failed test.
10. Broaden exact maintenance exception: 1 failed test.
11. Remove typed disabled-control guard: 2 failed tests.
12. Remove typed handler guard alone: 1 failed test invoking the actual wired callback.
13. Remove final decision comparison: 8 failed changed-decision tests.

Restored review baseline: 111/111 passed. Subsequent independent follow-ups:
86/86 auth/status, 27/27 helper/panel, and 23/23 latest focus-corrected panel tests.
Authorization, decision and typed guards were unchanged by the later focus fix.

Local evidence is retained under `D:/wt/cs230-owner-panel` (required-final.log,
component-final.log, build.log and panel-harness browser log/PNGs) and
`D:/wt/cs230-review/review-evidence` (mutation JSON and per-mutant assertion logs).
These contain synthetic evidence only and are not committed.

## Residual risks and next required evidence

- Full app build/T1 and repository CI have not been demonstrated green here.
  The local webpack attempt fails at unchanged
  `src/replies/lib/contracts/text.ts` → Replies Workspace (`node:crypto`) and
  cross-drive Next client entry resolution. Original-worktree typecheck attempts
  also lacked Supabase/PGlite through its existing junction; the authorized
  scratch environment passed complete typecheck without installation. No unrelated
  dependency or Replies fix was bundled into this issue.
- SessionStorage is tab-local. Closing/clearing it can lose the client retry UUID;
  durable operations remain on the server. The docs require coordinator inspection
  before recovery rather than forcing a new operation.
- Separate status/import timestamp reads are observations, not reservations.
  Server build binding and the existing atomic SQL admission remain final authority.
- This build performs no production flip. The owner/coordinator must still satisfy
  live gates, apply reviewed migrations/deployment settings and verify the actual
  deployed build. Native-device/T4 and live provider behavior were not exercised.
- No push, PR/CI write, merge, deployment or closure is authorized in this build turn.

# PR #237 merge fix, round 1

Heavy fix on `feat/237-ui`, merging `origin/main` at
`e8698ce00c2f93c658bd05831615400722a2dd16` (#235) into
`0748254860796bb373a45347c9cc8be3bc267910` (#237).
Task contract: preserve stages 3–5 and bounded list payloads. Related UI issue:
[#212](https://github.com/James-Bugden/Content-Studio/issues/212).
PR: [#237](https://github.com/James-Bugden/Content-Studio/pull/237).

## Resolution

- Keep the compact table, platform logos, filters, sorting, grouping, paging,
  revision-safe inline edits and phone cards. Each row shows a two-line excerpt.
- Keep the explicit inventory projection: draft excerpts are at most 220
  characters; raw cells, full bodies and platform-version bodies do not cross
  the list boundary. “Show full post” opens the guarded editor, with a 44px target.
- Preserve `deleted_at` in the private database projection so tombstones remain
  excluded from lists, global counts and derived Ready candidates. Platform
  versions remain available through point reads only.
- Refresh private search after Delete/Undo without putting the query in the URL.
  New search generations invalidate pending navigation and ignore aborted replies.

The owner reports that the existing soft-delete migration is already applied to
production. No migration is added or applied by this fix. No live database,
credentials, secret files, push, GitHub write or deployment is involved.

## Verification

All Vitest, typecheck, build and Playwright commands use `bash ~/bin/heavy`.
Only the requested unit directories and selected regression files are run;
the full repository suite is left to CI.

Synthetic Next production artifact `3dXJOW8xk9L0hbA402oRi` passed the initial
DB browser run. The final production build is `ptvDXd88jtS1ZIAcL3FhP`
(Next exit status 0); application code is identical in both builds. The build
wrapper temporarily sets the common-parent Turbopack root for this workstation's
shared `node_modules` junction and restores `next.config.ts` afterward. The
first shell wrapper reported a native-stderr error from queue wait messages,
despite completed build output; the clean repeat records Next's exit status.

- `npm run typecheck` and `npm run lint`: passed.
- `npx vitest run tests/unit/application tests/unit/supabase tests/unit/security tests/unit/components tests/unit/domain/backlog-payload.test.ts tests/unit/domain/library-backlog-sort.test.ts --maxWorkers=1 --silent`:
  **94 files / 1,696 tests passed**, no skips, on the final implementation.
- Legacy T1 on the final build, `CS_E2E_PREBUILT=1 CS_E2E_CONTENT_STORE=sheet CS_E2E_PORT=3237`
  `npx playwright test tests/e2e/backlog.spec.ts tests/e2e/backlog-pagination.spec.ts tests/e2e/backlog-stale.spec.ts tests/e2e/editor.spec.ts tests/e2e/panel.spec.ts tests/e2e/payload.spec.ts --project=w375 --project=w1280 --workers=1`:
  **108 passed**, no skips. Includes exact emoji/CJK/whitespace saves (REV-07),
  external Markdown conflicts (REV-08), partial-save retry (DRV-04), dirty-edit
  protection (UX-04), keyboard navigation (CS-043), bulk editing (CS-047),
  inline PESTO (CS-054/055), viewer restrictions and stale-provider fallback.
- DB T1: `CS_E2E_PREBUILT=1 CS_E2E_CONTENT_STORE=db CS_E2E_PORT=3237`
  `npx playwright test tests/e2e/post-versions.spec.ts tests/e2e/backlog-pagination.spec.ts tests/e2e/payload.spec.ts --project=w375 --project=w1280 --workers=1`:
  **20 passed**, no skips. Covers English/Chinese drafts and previews, saved
  platform selections, stale saves, owner/origin restrictions, Delete/Undo,
  private-search lifecycle refresh, global filters/sort, revision-safe cells,
  2,000-post paging and full-body fetching only after opening the panel.
  The same **20 checks passed again on final build `ptvDXd88jtS1ZIAcL3FhP`**
  (44.5 seconds), with Backlog still 281,828 bytes at both widths. Together with
  the legacy run, this gives **128 browser checks on the final build**, no skips.
- T2: visually reviewed synthetic Backlog and editor screenshots at 375 and
  1280. Phone cards retain readable excerpts, filters and 44px full-post links;
  the desktop table keeps the intended scroll region and editor/preview columns.
  Automated overflow/reflow checks passed at 375/500/640/750/1280, with no serious
  or critical editor axe violations at 375/1280. The 2,000-post inventory also
  passes its axe scan. Screenshots stay in ignored `artifacts/237/`.
- `node scripts/check-private-paths.mjs`, `node scripts/scan-secrets.mjs`,
  `git diff --check`: passed.

DB measurements, complete uncompressed HTTP documents with 2,000 seeded posts,
including inline RSC, at both viewport projects:

| Route | Bytes | Warm complete-response samples (ms), 375 / 1280 |
| --- | ---: | --- |
| `/` | 96,300 | 39 / 30 / 33; 25 / 23 / 25 |
| `/backlog` | **281,828** | 26 / 27 / 24; 26 / 23 / 23 |

Backlog remains below the required **300,000-byte** budget. Body-tail sentinels
are absent from both list documents and search responses, even when the full
body matches the search. The editor returns the exact full body on open.

The first broad unit run intentionally caught the two new tombstone regressions
before the projection fix (deleted Library and Queue records returned). One
legacy SQL case also exceeded its 30-second test timeout under machine load.
The isolated post-fix projection retest passed both cases (other cases excluded
by the name filter are not counted as passes). The full final unit run also
passed the SQL case without timeout changes.

## Independent and adversarial review

A separate read-only reviewer checked the conflict and automatic merge seams,
phone layout first. Review found the omitted tombstone projection and stale
private-search result after lifecycle actions; both receive focused regressions.
The PostgREST regression honours the actual selected columns instead of returning
complete fake rows, which previously concealed the missing tombstone field.
The reviewer rechecked both fixes and their test integrity and reported no
remaining blockers within the merge scope. The existing React component review
checklist was also applied to effect cleanup, query dependencies, serialization
and responsive/accessibility behavior.

No hosted CI, production smoke or physical-device evidence is claimed for this
local-only merge round.

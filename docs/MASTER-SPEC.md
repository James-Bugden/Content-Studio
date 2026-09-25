# Content Studio master specification

Status: implementation baseline, updated 2026-09-25 for the unified Content and Replies application.

## 1. Product contract

Content Studio is an owner-only internal dashboard for two related workflows: outbound Content and manually posted social Replies. Content sits over the current Google Sheet, Drive Markdown/assets and Typefully. Replies uses Supabase for its private library, retrieval, resources and facts. Google Sheets remains the only writable authority for Content.

Canonical flow:

```text
Content / Editing Markdown/master
  -> Content Library
  -> Ready Queue
  -> Content Schedule
  -> Typefully
  -> published/final-copy/analytics sync to Content Schedule

Replies
  -> draft and edit in Content Studio
  -> post manually on the social platform
  -> record exact final reply in Supabase
  -> reuse recorded replies prospectively
  -> optionally save an explicit idea to Sheet Content Queue
```

Goals:

- Make the next required action and every publishing blocker obvious.
- Protect James's edits while supporting English QA, hook alternatives and X-to-Threads zh-TW adaptation.
- Treat original visuals, screenshot reuse and image approval as release gates.
- Reconcile with Typefully before creating anything and sync exact final copy back.
- Preserve a clear audit trail and recover safely from partial external failures.
- Provide a replaceable integration boundary so a later Supabase migration does not require rewriting the UI.
- Draft and record social replies under the same Google owner session and shared application shell.
- Learn reply style prospectively from replies explicitly recorded after launch.

Non-goals for MVP:

- A public creator SaaS, multi-tenant workspace or general CMS.
- Replacing the Sheet, Drive, Typefully or the canonical Markdown intake path.
- Direct social-platform publishing, autonomous approval, automatic hook selection or silent copy rewriting.
- A duplicate Content calendar, arbitrary web scraping, importing historical social replies, or embedding private content in public logs/tests.
- Instagram, rich collaborative editing, drag-and-drop scheduling, or automatic social-platform posting.

## 2. Ground truth and authority

| Concern | Authority |
| --- | --- |
| Source/reference material and pre-approval master files | Google Drive `Content / Editing` and canonical workflow/reference files |
| Operational review, gates, schedule and historical platform records | Google Sheet `Content Tracker / X, LinkedIn & Threads` |
| Ready handoff | Sheet `Ready Queue`, derived from `Content Library`; never separately persisted by the app |
| Final human edit and publishing | Typefully |
| Exact final copy, published metadata and available analytics | Synced back to `Content Schedule` |
| Reply sessions, recorded replies, retrieval, resources and facts | Isolated Supabase Reply tables |
| Explicit Reply-to-Content idea | New row in existing Sheet `Content Queue`; never scheduled automatically |
| UI cache | Disposable only; never authoritative |

The app may keep request-local data, encrypted session data and bounded cache entries. Supabase Reply records and optional `content_studio_*` snapshots are isolated: snapshots are disposable and never writable Content authority. Cache keys include source revision/fingerprint; Content writes always re-read and compare the authoritative Sheet record.

Canonical Drive references consulted for this baseline are `AI-WORKFLOWS-INDEX.md`, `CONTENT-WORKFLOW.md`, `STYLE-GUIDE.md`, `REPRODUCE.md`, `REVIEW.md`, `PLATFORM-PRODUCTION.md` and the workflow-folder `README.md`. The former Google Doc index is superseded; the Markdown index is canonical. Runtime code must discover configured Drive IDs rather than hard-code private file IDs in the public repository.

## 3. Proposed architecture

Next.js App Router + TypeScript on Vercel, with server-only integration modules:

```text
Browser
  -> authenticated server actions/API routes
    -> application services and gate engine
      -> ContentRepository interface
        -> GoogleSheetsContentRepository (MVP)
      -> MarkdownRepository -> Google Drive
      -> PublisherGateway -> Typefully
      -> AI services -> structured, validated proposals only
      -> Reply services -> server-only Supabase client
      -> TelemetrySink -> redacted events/metrics
```

Use Zod at every boundary. Keep domain types in one package/module. UI components consume view models, never raw row arrays. Adapters expose capability and health states so no-match, not-configured, rate-limited, conflict and provider failure remain distinct.

Recommended modules: `src/domain`, `src/application`, `src/integrations/google`, `src/integrations/typefully`, `src/integrations/ai`, `src/components`, `src/observability`, and `tests/{unit,integration,e2e,fixtures}`.

### Integrated Replies workflow

The mature Social Replies workspace is hosted at `/replies`, with utility pages below `/replies/*` and server routes below `/api/replies/*`. It reuses the Content Studio Auth.js Google owner session. Supabase credentials remain server-only. A service-role-only RPC resolves the single enabled owner from `private.app_owner`; every subsequent Reply query also carries that owner UUID explicitly.

Replies retains its Supabase persistence, reply counters, retrieval, resources and facts. No historical export/import is required: only replies explicitly recorded going forward become retrieval evidence. Replies never write Typefully or Content Schedule. “Save as content idea” is a separate, explicit, idempotent append to the existing Sheet `Content Queue`.

### Authentication and permissions

- Auth.js Google OIDC login; no public signup or account chooser after owner binding.
- Authorise by immutable Google `sub` stored only in server configuration; email is display/defence-in-depth, not sole identity.
- Google Sheets/Drive, Typefully and Supabase credentials remain server-side. Request the minimum scopes needed; read-only adapters are usable before write scopes are configured.
- Roles in MVP: `owner` (read/write/approve/publish actions) and optional `viewer` (read-only). Default deny.
- Every mutation verifies session, role, same-origin/CSRF protection, resource identity, expected revision/fingerprint and idempotency key.
- Private responses use `Cache-Control: private, no-store`. Content, URLs containing private IDs and tokens do not enter analytics or error messages.

## 4. Canonical identifiers and state

Primary identity:

- Library work: `Library ID` is stable. `Pair Key` links legacy/platform variants.
- Scheduled/published work: `Content ID` is stable. Threads uses `Parent Content ID` to link to the final approved X source.
- Drive: file ID plus targeted Markdown section/Library ID and Drive revision/modified time.
- Typefully: `Typefully Draft ID`; otherwise a reconciliation candidate is matched by platform, local planned time, slot and content similarity, and requires confirmation when ambiguous.

Content stage is the canonical workflow enum already defined by the workflow: `Idea -> Drafting -> EN Review -> EN Approved -> Translation -> ZH Review -> Ready`. LinkedIn skips translation states. Publishing status is represented by `Typefully Status`: `Not Sent -> Typefully Draft -> Planned -> Scheduled -> Published -> Error`.

The UI derives, but does not persist as competing state:

- `blocked`: one or more hard gates fail.
- `needs_action`: a human or integration action is required.
- `in_sync`: authoritative sources agree for the fields relevant to the current stage.
- `conflict`: the source changed after the editor loaded it.
- `partial_failure`: a multi-provider operation completed only some writes and has a deterministic recovery action.

Allowed stage transitions are server validated. Backward transitions are explicit and audited. Approval is invalidated by a material change to the approved text, hook, language, visual copy, asset, platform or placement.

## 5. Exact current Sheet mapping

The live workbook is `Content Tracker / X, LinkedIn & Threads`, locale `en_GB`, timezone `Asia/Taipei`.

### Content Library and Ready Queue (A:AG)

| Domain group | Current columns |
| --- | --- |
| Identity/source | `Library ID`, `State`, `Content Source`, `Source Platform`, `Target Platform`, `Post / Slug`, `Workflow Role`, `Source Master File`, `Source Markdown`, `Pair Key`, `Source Theme`, `Content Angle (1-14)` |
| Risk and approval | `Copyright QA`, `Duplicate QA`, `Review Status`, `Queue for Schedule`, `Next Action` |
| Editorial | `PESTO`, `Funnel Stage`, `Current Hook`, `Hook Template`, `Hook Alternatives`, `Hook Score`, `Hook Type`, `Draft Content` |
| Visual | `Visual Source`, `Image Status`, `Image Brief`, `Image File`, `Image Alt Text`, `Visual Version`, `Has Image`, `Image Next Action` |

`Ready Queue` has the same 33 columns and is a derived view. The app never writes directly to it. It becomes eligible only when `Review Status = Approved` and `Queue for Schedule = TRUE`; the gate engine still rechecks risk, editorial, visual and platform requirements.

### Content Schedule (A:AR; header row 2)

| Domain group | Current columns |
| --- | --- |
| Schedule identity | `Posted`, `Date`, `Platform`, `Slot`, `Content ID`, `Parent Content ID`, `Publish Time (Taipei)`, `Source MD / Drive Link` |
| Copy/workflow | `Hook Template`, `Hook`, `Content`, `Chinese Content`, `PESTO`, `Post type`, `Funnel Stage`, `Book Reference`, `Potential Post`, `Content Stage`, `AI Review Notes`, `Hook Alternatives`, `Final Content`, `AI Action`, `Hook Score`, `Hook Type` |
| Typefully/publication | `Typefully Draft ID`, `Typefully Status`, `Published At`, `Final Synced From Typefully`, `Post Link` |
| Analytics | `Views`, `Likes`, `Reposts/Shares`, `Replies/Comments`, `Bookmarks`, `New Followers`, `Analytics Synced At` |
| Visual | `Visual Source`, `Image Status`, `Image Brief`, `Image File`, `Image Alt Text`, `Visual Version`, `Has Image`, `Image Next Action` |

`Posted` is not a workflow state; scheduled future rows may already be true. Use `Content Stage` and `Typefully Status`.

### Live vocabulary (verified 2026-09-23, CS-002)

Values observed in the live workbook, mapped to the canonical enums in `src/domain/enums.ts`. Only vocabulary, never row content, is recorded here.

| Column | Live values | Canonical |
| --- | --- | --- |
| Library `State` | `Editing` | Display only; the canonical stage lives in Schedule `Content Stage` |
| `Copyright QA` | `Cleared`, `REWORK` | `PASS`, `REWORK`; blank = `Unchecked` (blocks) |
| `Duplicate QA` | `No flag`, `CHECK` | `PASS`, `CHECK`; `DUPLICATE` confirmed; blank = `Unchecked` (blocks) |
| `Review Status` | `Not Reviewed` | `Pending`; plus `Approved`, `Changes Requested`, `Skipped` |
| `Source Platform` | `LinkedIn`, `Threads (legacy)` | Platform enum with alias |
| `Source Markdown` | `Open master` (hyperlink) | Link target read from the cell hyperlink or `HYPERLINK()` formula |
| `Has Image`, `Next Action`, `Image Next Action` | Display or formula text | Never written when the cell holds a formula |
| Schedule `Slot` | `Main`, `2nd`; legacy `3rd` remains readable | `3rd` is never a new promotion target |
| Schedule `Content ID` | `YYYY-MM-DD-<SLOT>-<X/TH/LI>` | Pre-created slot rows; promotion fills an available row |
| `Workflow Settings` | `Setting / Value / Notes` rows for active times plus Monday–Sunday cadence; deprecated X/Threads 3rd rows remain `TBD` | Runtime slot + pillar policy |

Unrecognised values are never defaulted: they become an `UNRECOGNISED_VALUE` blocker.

Approval evidence lives in existing cells: an approval stamp `[cs:approved:<hash>]` in `Next Action`, a visual stamp `[cs:visual:<hash>]` in `Image Next Action`, and a zh-TW lineage stamp `[cs:zh-src:<parent Content ID>:<hash>]` in the Threads row `AI Action`. A stamp is written only when its cell is not a formula; an approval without a stamp is treated as a legacy approval with a visible warning.

### Other tabs

- `Content Queue Summary`: read-only source-level counts and master links.
- `Workflow Settings`: read-only runtime policy input for canonical paths, Taipei slots and gates. Unknown/missing values block affected actions rather than falling back silently.
- Legacy `Backlog Ideas` and `Example` tabs remain out of write scope. The supported backlog is the mapped `Content Queue` tab.

Header discovery is by exact name, not fixed column index. Startup fails safely on duplicate/missing required headers. Unknown extra columns are preserved.

## 6. Workflow surfaces

### Review Queue

Filter by source, target platform, state, QA flags, review status and next action. Cards show source, current hook, short copy preview, hard/soft gates and the single next action. Clean review, copyright rework and duplicate decision are visibly distinct. No destructive bulk approval in MVP.

### Post Editor and English QA

Load the authoritative Library row and referenced Markdown section with revision fingerprints. Preserve exact text and line breaks. English QA checks spelling, grammar, punctuation, banned words, clarity, British English, voice, factual consistency and platform fit. Results are proposals/notes; they never overwrite the draft. Saving a changed draft updates the targeted Markdown section and `Draft Content` mirror through a recoverable saga with precondition checks. Partial success is explicit and retryable; no false success.

### Hook review

Keep the current hook. Generate exactly three alternatives, each naming the canonical hook framework and an editorial score. Score uses five two-point dimensions: specificity, tension/curiosity, audience/platform fit, credibility/evidence, and value promise. James explicitly chooses. Selection updates `Current Hook`/`Hook` and matching opening lines together, plus template, score and type. LinkedIn alternatives include the LinkedInify audience/role/keyword check.

### X to Threads zh-TW

Only final `EN Approved` X copy is eligible. Generate a Taiwan Traditional Chinese adaptation, not literal translation; preserve established terminology such as 求職者 when appropriate. The Threads record is linked through `Parent Content ID`. Store a source hash/version; any later X change marks the adaptation stale and invalidates ZH/visual approval. Chinese QA checks meaning, naturalness, terminology, line breaks and Taiwan usage.

### Visual Studio

Visual decisions are `Text only`, `Original graphic` or an exact screenshot identifier. Original graphics follow SOAR v1.1 Analysis output 3 / C-light Notebook: ASCII structure first; simplest useful grammar; 2–4 main ideas; large text and generous whitespace; one yellow `#FFE76B` focal highlight; near-white `#FAFBFC`; ink `#172023`; green `#0A3D26` sparingly; minimal truthful hand-drawn connectors/annotation; default 50–70% of the lesson; deterministic rendering where possible. English and zh-TW are separately composed/reflowed.

Required brief data: lesson, grammar, exact line-broken copy, focal phrase, optional caveat, platform, language, placement, alt text and source version. Approval belongs to the exact asset revision `SOAR-v1.1 / rNN / <platform> / <language>`. Review at full size and 360/390 px. A material change invalidates approval.

Screenshot rule: one source screenshot may be used at most once per platform. Check both Library and Schedule `Visual Source`. An uncertain match blocks with review; derivative ideas must be text-only or use a fresh original graphic. Existing approved/published v1.0 assets remain historical.

### Ready Queue and schedule

Ready Queue is a live derived handoff. Hard blockers include copyright `REWORK`, unresolved duplicate `CHECK`, non-approved review, missing platform copy, stale Threads adaptation, missing hook decision when required, or an image decision/revision that fails its gate. Promotion creates/updates an available Content Schedule row only after a preview and explicit confirmation. New content never jumps directly into Content Schedule.

Active Taipei slots come from Workflow Settings: X 08:00/20:00; Threads 08:15/20:15; LinkedIn 21:00. X/Threads 3rd rows are deprecated legacy compatibility only: blank legacy rows are hidden from the active calendar and can never be promotion targets; already-filled/scheduled/published legacy rows remain visible and reconcilable.

The weekly pillar plan is also read from Workflow Settings:

| Day | X + Threads morning | X + Threads evening | LinkedIn |
|---|---|---|---|
| Monday | Personal story | Expertise | Expertise |
| Tuesday | Social proof | Expertise | Build in public (Soar) |
| Wednesday | Personal story | Expertise | Expertise |
| Thursday | Trending | Expertise | Personal story |
| Friday | Build in public (Soar) | Expertise | Trending |
| Saturday | Personal story | Expertise | Opinions |
| Sunday | Opinions | Expertise | Social proof |

PESTO remains the core five-pillar framework; Build in public (Soar) is an additional explicit operational pillar. Calendar cards show the expected pillar for active slots. Calendar MVP is a list/week view; drag/drop is follow-on.

### Typefully reconciliation

Before create, check `Typefully Draft ID`; if absent, search likely drafts by platform, date/time, slot and content similarity. One confident exact match may be linked after a preview; multiple/uncertain matches require human selection. Create uses an idempotency key based on the promotion operation, never just content text. Store returned ID/status in the same Schedule row.

Never overwrite a newer Typefully edit. Reconciliation shows Sheet versus Typefully and offers explicit direction. Sync Typefully's exact final text into `Final Content` without changing working `Content`; update final-sync time, status, published URL/time and available platform-specific metrics. Missing metrics remain blank.

### Published and analytics

Show exact final copy, asset revision, URL, timestamps, sync freshness and available metrics per platform row. Never combine X/Threads analytics or infer unavailable metrics. Analytics views aggregate only recorded facts and expose last sync/error state.

## 7. Mutation, conflicts and auditability

Every mutation uses `{operation_id, actor, target, expected_revision, exact_patch}`. Same operation/same patch replays safely; same operation/different patch conflicts. Re-read before write. Sheet writes update only named target cells and preserve formulas/validation/unknown columns. Drive writes use file revision/modified-time preconditions and target the Library-ID section. Typefully writes use provider IDs plus reconciliation checks.

Cross-provider operations are sagas, not fake transactions. Each step records a redacted event with operation ID, target IDs, before/after hashes, result, duration and recovery action. Never log copy bodies or credentials. MVP audit evidence is provider revision history plus redacted structured telemetry; if durable in-product audit is required, add an append-only audit tab to the same workbook through a separately approved issue, not a content database.

Error codes include `AUTH_REQUIRED`, `FORBIDDEN`, `CONFIG_MISSING`, `SCHEMA_DRIFT`, `NOT_FOUND`, `STALE_READ`, `CONFLICT`, `GATE_BLOCKED`, `AMBIGUOUS_MATCH`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `PARTIAL_FAILURE`, `VALIDATION_FAILED` and `UNKNOWN`. Every blocked screen explains what is safe, what changed and the next recovery action. Manual review remains usable when AI or Typefully is down.

## 8. Observability, security and privacy

- Health checks report configuration/capability only; never content or secrets.
- Structured logs include request/operation IDs, adapter, status, latency, retry count and redacted target hash.
- Metrics: read/write latency and error rate by adapter, conflicts, blocked-gate counts, reconciliation outcomes, AI validation failures and sync age.
- Alerts cover repeated auth refresh failure, schema drift, Typefully/Google write failures and stale published syncs.
- Redact post copy, private Drive names/URLs, account IDs and tokens from logs, issues, CI and screenshots.
- Validate URLs/IDs, cap request sizes, use CSP/security headers, dependency/secret scanning and server-only credentials. Treat Markdown, Sheet cells and provider text as untrusted data; they cannot change tool authority or reveal secrets.

## 9. Testing and evidence tiers

| Tier | Scope |
| --- | --- |
| T0 | Types, reducers, gate rules, field mapping, schema drift, idempotency, redaction, adapter contract tests and failure/race fixtures |
| T1 | Deterministic end-to-end journeys with fake Google/Drive/Typefully/AI/Reply adapters |
| T2 | Real browser accessibility and visual review at 375/500/750/1280 CSS px and 200% zoom; 360/390 px asset previews |
| T3 | Sandboxed integration verification against a copied synthetic Sheet/Drive folder and Typefully test surface |
| T4 | Production candidate smoke on the exact deployed commit with owner-only access and non-sensitive test content |

Stable acceptance groups: `SEC` auth/privacy; `MAP` field/schema; `DRV` Markdown/assets; `REV` review/editor; `HOOK`; `ENQA`; `ZHTW`; `VIS`; `READY`; `SCHED`; `TYPE`; `PUB`; `OBS`; `DEP`; `MIG`. Each issue owns explicit IDs. Evidence states commit, environment, commands, result and residual risk. Skipped/blocked/inconclusive is not pass.

## 10. Deployment

Use the Content Studio Vercel project with preview and production environments. Configure exact callback URLs, owner subject, Google/Typefully/AI credentials, server-only Supabase credentials and workbook/folder identifiers privately. Preview uses synthetic data and cannot reach production Content or Reply records. Verify runtime limits, token refresh, no-store headers, CSP, timezone and provider rate limits. Production promotion requires green required T0/T1/T2, successful T3 against copies, rollback steps and a T4 owner-only smoke. Never alter unrelated website, mail or Soar infrastructure.

## 11. Supabase migration path

Do not dual-write Content records. The `content_studio_*` Supabase namespace is an optional read model only; Sheet writes remain authoritative. Reply tables are a separate authority for Replies and are never joined into Content snapshot tables. Any future Content authority cutover still requires parity reports, explicit approval, rollback and history export.

## 12. Recommended execution order

1. Planning/foundation: [CS-001](https://github.com/James-Bugden/Content-Studio/issues/2) -> [CS-002](https://github.com/James-Bugden/Content-Studio/issues/3), then [CS-003](https://github.com/James-Bugden/Content-Studio/issues/4), [CS-004](https://github.com/James-Bugden/Content-Studio/issues/5), [CS-005](https://github.com/James-Bugden/Content-Studio/issues/6) and [CS-006](https://github.com/James-Bugden/Content-Studio/issues/7) behind the shared contracts.
2. Core review slice: [CS-007](https://github.com/James-Bugden/Content-Studio/issues/8) -> [CS-008](https://github.com/James-Bugden/Content-Studio/issues/9) -> [CS-009](https://github.com/James-Bugden/Content-Studio/issues/10) -> [CS-010](https://github.com/James-Bugden/Content-Studio/issues/11) -> [CS-011](https://github.com/James-Bugden/Content-Studio/issues/12).
3. Visual and handoff: [CS-012](https://github.com/James-Bugden/Content-Studio/issues/13) -> [CS-013](https://github.com/James-Bugden/Content-Studio/issues/14).
4. Scheduling/publishing: [CS-014](https://github.com/James-Bugden/Content-Studio/issues/15) -> [CS-015](https://github.com/James-Bugden/Content-Studio/issues/16) -> [CS-016](https://github.com/James-Bugden/Content-Studio/issues/17).
5. Hardening/release: [CS-017](https://github.com/James-Bugden/Content-Studio/issues/18) -> [CS-018](https://github.com/James-Bugden/Content-Studio/issues/19) -> [CS-019](https://github.com/James-Bugden/Content-Studio/issues/20).
6. Follow-on migration option: [CS-020](https://github.com/James-Bugden/Content-Studio/issues/21) only after measured need.
7. Unified application: [CS-025](https://github.com/James-Bugden/Content-Studio/issues/61) -> [CS-026](https://github.com/James-Bugden/Content-Studio/issues/62) -> [CS-027](https://github.com/James-Bugden/Content-Studio/issues/63) -> [CS-028](https://github.com/James-Bugden/Content-Studio/issues/64).

Parallel work is safe only behind the shared contracts and fake adapters. The first vertical demo should be: login -> read one synthetic Library row and Markdown section -> review/edit with conflict protection -> approve -> see the derived Ready Queue state. Typefully and live AI are not required for that slice.

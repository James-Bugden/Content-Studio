# Unified Content Operations PRD

Status: approved for implementation, 2026-09-25

## Core purpose

Combine Content Studio and Social Replies into one owner-only application, one
repository, one deployment and one coherent navigation system. Content Studio
remains the canonical repository. The product supports two related workflows:

- **Content**: create, review, schedule and reconcile outbound posts.
- **Replies**: draft, edit, copy and record replies to external posts.

The combination is an application-shell and operational consolidation. It does
not merge the workflows' authorities or silently promote replies into scheduled
content.

## Product decisions

- Google OAuth through the existing Content Studio Auth.js owner boundary is the
  single login.
- Google Sheets remains the sole writable source of truth for Content Studio.
- Supabase remains the durable store for Social Replies and the optional,
  disposable Content Studio read model. Namespaces stay isolated.
- Historical social-platform exports are not required. The reply library starts
  with replies recorded from the combined app and improves prospectively.
- The private 50–100 historical-pair voice evaluation is removed as a release
  gate. Voice and Taiwan-Chinese quality are checked on synthetic fixtures and
  then monitored through accepted/edited replies saved going forward.
- Replies are posted manually. They never go directly to Typefully or Content
  Schedule.
- A useful reply may be explicitly saved as a new Content Idea through the
  existing Google Sheet intake boundary.
- The approved black/white design system, status colours and coloured content
  tags apply to the combined shell.

## In scope

1. Shared authenticated shell and navigation for Content, Replies, Library,
   Resources, Facts and Settings.
2. Social Replies workspace hosted at `/replies` inside Content Studio.
3. Social Replies utility surfaces hosted under `/replies/*`.
4. Social Replies server routes namespaced under `/api/replies/*` to avoid
   collisions with Content Studio routes.
5. Auth adapter that maps the existing Google owner session to the server-side
   Social Replies owner boundary without exposing Supabase service credentials.
6. Existing reply generation, retrieval, editor protection, exact recording,
   Taipei counters, resources and facts.
7. Forward-only reply learning: every explicitly recorded reply becomes eligible
   library evidence according to the existing provenance rules.
8. Explicit “Save as content idea” action that writes through the existing Sheet
   repository with conflict/idempotency protection.
9. One CI pipeline, one Vercel deployment and one production smoke plan.
10. Redirect or retirement guidance for the standalone Social Replies deployment.

## Out of scope

- Importing LinkedIn, X, Threads or Drive historical reply exports.
- A private historical-pair evaluation dataset.
- Automatic social posting, social OAuth or scraping/discovery.
- Sending replies directly to Typefully or Content Schedule.
- Replacing Google Sheets as Content Studio's writable authority.
- Merging reply tables with `content_studio_*` read-model tables.
- Multi-user roles, billing or public signup.
- A new visual direction beyond the already approved combined theme.

## Conceptual data model

- **Content record**: authoritative Google Sheet row plus Drive/Typefully links.
- **Reply session**: target post/comment, platform, current draft and generation
  lineage stored in the existing Social Replies schema.
- **Recorded reply**: exact final text explicitly marked posted; becomes future
  retrieval evidence.
- **Resource/fact**: owner-managed Social Replies grounding records.
- **Content idea bridge**: an idempotent mutation that creates a Backlog Ideas
  row from selected reply/session text; it does not schedule or publish.

## User flow

1. James signs in once with Google.
2. The shared shell opens Content or Replies without another authentication step.
3. In Replies, James pastes a source post/comment and chooses the platform.
4. The app retrieves replies recorded from prior use, shows eligible resources,
   and generates three meaningfully different ideas.
5. James edits, copies and posts manually, then records the exact final reply.
6. The recorded reply becomes eligible retrieval evidence for future sessions.
7. If the exchange suggests a standalone post, James explicitly saves it as a
   Content Idea; the idea enters the existing Sheet workflow and nothing else.

## Failure and edge states

- AI unavailable: retrieval, editing, copying and recording remain usable.
- Supabase unavailable: Content Studio remains usable; Replies shows a scoped
  provider failure and preserves local draft recovery.
- Sheet unavailable during Save as content idea: no false success; retry uses the
  same operation id and cannot create duplicates.
- Stale generation/translation responses never replace newer human edits.
- Anonymous/non-owner requests receive no private content or mutation access.
- A reply recorded twice is idempotent and does not increment the daily count.

## Milestones

### M1 — Shared shell and route integration

Import Social Replies into the Content Studio repository, namespace its routes,
reuse the Content Studio Google owner session, and make `/replies` reachable from
the shared navigation. Preserve existing fake/test modes.

### M2 — Forward-only learning and Content Idea bridge

Remove historical-import/evaluation requirements from active product scope,
verify newly recorded replies feed retrieval, and add the explicit idempotent
Sheet-backed Content Idea action.

### M3 — Unified QA, cutover and retirement

Merge CI/e2e coverage, run T0/T1/T2 plus adversarial verification, deploy one
candidate, smoke-test exact production behavior and document retirement or
redirect of the standalone app.

## Release evidence

- T0: typecheck, lint, secret/private-path scans, unit/integration/database tests.
- T1: deterministic combined journeys covering navigation, reply workflow,
  recording, forward retrieval and Content Idea creation/failure.
- T2: visual/accessibility review at 375/500/750/1280 CSS px and 200% zoom.
- T3/T4 only where the existing policy triggers them, particularly clipboard and
  physical mobile behavior.
- Exact merged and deployed commit, CI checks, rollback path and remaining
  owner-only credential/device steps are recorded.


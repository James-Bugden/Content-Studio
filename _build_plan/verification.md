# Unified Content Operations verification

Status: local implementation gates green; CI and production smoke pending.

## Evidence captured 2026-09-25

- `npm run verify`: green — typecheck, lint, private-path scan, secret scan and
  1,074 unit/integration/database tests across 81 files.
- `npm run build`: green — production build includes `/replies`, all five Reply
  utility pages, namespaced Reply APIs and the Sheet-backed Content Idea bridge.
- Database tests execute the Reply store as `service_role`, proving explicit
  owner scoping even when RLS is bypassed. A planted second-owner corpus cannot
  be read or changed.
- Supabase project `avpntrdnqlrjfmfdagfj` was `ACTIVE_HEALTHY` before migration.
- Hosted migration `google_auth_service_rpcs` applied as version
  `20260925145809`.
- Hosted verification proved the configured owner resolves and counters execute
  as `service_role`; `authenticated` and `anon` cannot execute the owner resolver.
- Supabase security/performance advisors were rerun after migration. No new
  bridge finding appeared. Existing warnings relate to the legacy authenticated
  Reply surface, deliberate deny-all RLS tables, unused early-life indexes and
  Supabase Auth settings; the combined browser app exposes no Supabase login or
  publishable credential.

## Remaining release gates

- T1 combined Playwright journeys in GitHub CI. The local runner could not fetch
  Chromium from the Playwright CDN, so CI is the deterministic browser authority.
- T2 screenshots/accessibility at the configured viewports in CI.
- Post-merge production deployment and owner-authenticated smoke of Content,
  Replies, exact recording and Save as Content Idea.

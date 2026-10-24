# Content Studio

Owner-only Content and Replies dashboard. Content uses the existing Google Drive, Google Sheet and Typefully workflow; Replies uses an isolated Supabase library and is posted manually.

The product contract, architecture, field mappings, state model, testing tiers and delivery order are in [docs/MASTER-SPEC.md](docs/MASTER-SPEC.md).

The Content flow is fixed:

```text
Content / Editing Markdown/master
  -> Content Library
  -> Ready Queue
  -> Content Schedule
  -> Typefully
```

Content Studio is a control surface over that system. It is not a replacement content database. Implementers read [AGENTS.md](AGENTS.md) and their assigned GitHub issue first.

The Replies workspace lives at `/replies`. One Google login protects both workflows. Replies recorded after launch become future retrieval evidence; no historical reply import is required. An explicit “Save as content idea” action appends to the existing Sheet `Content Queue` and never schedules or publishes automatically.

## Development

Node 24 (see `.nvmrc`) and npm.

```bash
npm ci
npm run dev          # fake mode: synthetic Content providers, no credentials
npm run verify       # typecheck, lint, private-path policy, secret scan, unit tests
npm run test:e2e     # deterministic browser journeys against a production build
```

`CS_DATA_MODE=fake` (the default) uses synthetic Content fixtures in `src/fixtures/synthetic.ts`. The synthetic Replies store additionally requires `CS_TEST_MODE=e2e` outside production; its seeds live in `src/replies/lib/server/memory-store.ts`. Fake mode is refused in production. `.env.example` lists variable names only; values live in Vercel or an untracked `.env.local`.

CI runs on pushes to `main`, pull requests, manual dispatch and weekly on `main`
(Monday 03:17 UTC). The scheduled run uses the existing verify and browser jobs,
synthetic providers, no repository secrets, read-only permissions and actions pinned
to commit SHAs. See [.github/workflows/ci.yml](.github/workflows/ci.yml).

`POST /api/test-auth` and `POST /api/test-control` return HTTP 404 in production. Both
handlers use `testAuthEnabled`, which requires fake data and e2e mode outside
production; `tests/unit/auth/policy.test.ts` covers both production exclusions.
Operational recovery and rollback are in [the runbook](docs/ops/runbook.md) and
[deployment guide](docs/ops/deploy.md).

| Path | Responsibility |
| --- | --- |
| `src/domain` | Single typed vocabulary: enums, Sheet mapping, state machine, gate engine, Markdown sections |
| `src/application` | Services, sagas and view models |
| `src/integrations/{google,typefully,ai}` | Server-only adapters plus fakes |
| `src/replies` | Reply contracts, workspace, retrieval and server-only Supabase boundary |
| `src/observability` | Redacted structured events |
| `src/fixtures` | Synthetic data only |
| `tests/{unit,integration,e2e}` | T0 and T1 evidence |

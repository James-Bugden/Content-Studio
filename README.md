# Content Studio

Internal content-operations dashboard for James's existing Google Drive, Google Sheet and Typefully workflow.

The product contract, architecture, field mappings, state model, testing tiers and delivery order are in [docs/MASTER-SPEC.md](docs/MASTER-SPEC.md).

The canonical flow is fixed:

```text
Content / Editing Markdown/master
  -> Content Library
  -> Ready Queue
  -> Content Schedule
  -> Typefully
```

Content Studio is a control surface over that system. It is not a replacement content database. Implementers read [AGENTS.md](AGENTS.md) and their assigned GitHub issue first.

## Development

Node 24 (see `.nvmrc`) and npm.

```bash
npm ci
npm run dev          # fake mode: synthetic Sheet/Drive/Typefully/AI, no credentials
npm run verify       # typecheck, lint, private-path policy, secret scan, unit tests
npm run test:e2e     # deterministic browser journeys against a production build
```

`CS_DATA_MODE=fake` (the default) seeds every adapter from `src/fixtures/synthetic.ts` and is refused in production. `.env.example` lists variable names only; values live in Vercel or an untracked `.env.local`.

| Path | Responsibility |
| --- | --- |
| `src/domain` | Single typed vocabulary: enums, Sheet mapping, state machine, gate engine, Markdown sections |
| `src/application` | Services, sagas and view models |
| `src/integrations/{google,typefully,ai}` | Server-only adapters plus fakes |
| `src/observability` | Redacted structured events |
| `src/fixtures` | Synthetic data only |
| `tests/{unit,integration,e2e}` | T0 and T1 evidence |


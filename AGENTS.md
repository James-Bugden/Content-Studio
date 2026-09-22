# Content Studio agent instructions

Read `docs/MASTER-SPEC.md` and the assigned GitHub issue before editing. Resolve current repository and issue state first. Preserve the canonical flow and do not introduce a parallel source of truth.

The Google Sheet is the operational source of truth. Drive holds canonical Markdown/source assets. Typefully is the final editing and publishing surface. Supabase is a later migration option, not an MVP dependency.

Public GitHub content must use synthetic fixtures only. Never commit private post copy, Drive contents, spreadsheet rows, OAuth tokens, Typefully credentials, owner identifiers, production screenshots or environment values.

Use shared typed adapters and fake implementations so UI work does not require live credentials. Every mutation needs authentication, validation, an idempotency key, conflict detection and an auditable result. Never silently overwrite a newer Sheet row, Markdown revision, Typefully edit or user draft.

For implementation handoff, report the exact commit, environment, commands/results, applicable acceptance IDs, unresolved risks and issue/PR links. A skipped, blocked or inconclusive check is not a pass.


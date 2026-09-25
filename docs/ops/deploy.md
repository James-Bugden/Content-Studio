# Deployment (CS-019)

Content Studio deploys to its **own** Vercel project, separate from every other site, mail and Soar service. Nothing here touches unrelated infrastructure.

## Environments

| Environment | Data | Sign-in | Purpose |
| --- | --- | --- | --- |
| Preview (every PR and branch) | `CS_DATA_MODE=fake`, synthetic fixtures only | "Continue as synthetic owner" (`CS_ALLOW_PREVIEW_SYNTHETIC=true`), behind Vercel deployment protection | Click-through demo and T2 review. Cannot reach any real Sheet, Drive, Typefully or model. |
| Production | `CS_DATA_MODE=live` | Google, owner `sub` only | The real workspace. Fake mode is refused here by code. |

Preview must never receive production credentials. Production variables are set for the Production target only.

## Variables

Names only; values live in Vercel. See `.env.example`.

| Name | Preview | Production | Notes |
| --- | --- | --- | --- |
| `CS_DATA_MODE` | `fake` | `live` | |
| `CS_ALLOW_PREVIEW_SYNTHETIC` | `true` | unset | Ignored outside preview + fake. |
| `AUTH_SECRET` | random, preview-only | random, production-only | 32+ characters. Not a provider credential. |
| `APP_BASE_URL` | unset | production URL | Used for the same-origin check. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | unset | Google OAuth web client | Callback: `<production URL>/api/auth/callback/google`. |
| `CS_OWNER_GOOGLE_SUB` | unset | owner's Google subject | Leave unset for the first sign-in: the login page then shows the subject to copy (first-run setup mode, grants no access). |
| `CS_OWNER_EMAIL` | unset | owner email | Optional deny-only check; also limits who sees the setup subject. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | unset | service account | The Sheet and Drive folders are shared with this email. |
| `GOOGLE_WRITE_ENABLED` | unset | `false` first, then `true` | Read-only scopes until the T4 smoke is ready to write. |
| `CS_SHEET_ID` | unset | workbook id | First do T3 against a **copy**. |
| `CS_ASSET_FOLDER_ID` | unset | Drive folder for rendered visuals | |
| `TYPEFULLY_API_KEY`, `TYPEFULLY_SOCIAL_SET_ID` | unset | optional | Without them publishing actions are disabled; review still works. |
| `SUPABASE_READ_MODEL_MODE` | `off` | `off` until copied-data proof | `mirror` enables owner-triggered Sheet snapshots; `shadow` is reserved for parity reads. Sheets remain authoritative. |
| `SUPABASE_READ_MODEL_URL`, `SUPABASE_READ_MODEL_SERVICE_KEY` | unset | dedicated Content Studio project only | Server-only. Never use either existing unrelated Supabase project. |
| `SUPABASE_READ_MODEL_SOURCE_KEY` | unset | opaque workbook alias | Stable 8–64 character lowercase alias; never put the Sheet ID here. |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | unset | `anthropic` + key, optional | Without them AI proposals are off; manual review still works. |

## Owner-only steps

These need the owner's own accounts and cannot be done by an agent: credential values are never typed by the agent, and OAuth consent is a human decision.

1. **Google Cloud** (one project for Content Studio):
   - Enable the Google Sheets API and the Google Drive API.
   - OAuth consent screen: internal or testing, owner account only.
   - Create an OAuth client (Web). Authorised redirect URI: `<production URL>/api/auth/callback/google`. Paste the client id and secret into Vercel Production as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.
   - Create a service account and a JSON key. Paste `client_email` into `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `private_key` into `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`. Delete the downloaded key file afterwards.
2. **Share** a *copy* of the workbook and a *copy* of the `Content / Editing` folder with the service account email (Editor), for T3. Set `CS_SHEET_ID` to the copy's id.
3. **Sign in once** at the production URL with Google. The login page shows your account ID; paste it into `CS_OWNER_GOOGLE_SUB` and redeploy.
4. **Optional:** Typefully API key and a test social set; Anthropic API key.
5. **Optional Supabase read model:** create a dedicated non-production Content Studio project, apply the committed migration, and configure the four `SUPABASE_READ_MODEL_*` variables against a copied Sheet first. Do not reuse another product's project. Keep mode `off` in production until MIG-02 through MIG-05 evidence is accepted.

## Sheet mirror operation (MIG-02)

The mirror is one-way: Google Sheets to Supabase. Typefully and Drive never call
Supabase. A successful mirror cannot alter the Sheet.

1. Apply `supabase/migrations/20260925030000_sheet_read_model.sql` to the dedicated project.
2. Run Supabase database/security advisors and resolve every finding before adding credentials to Vercel.
3. Configure a copied Sheet and set `SUPABASE_READ_MODEL_MODE=mirror` only in the authorised test environment.
4. As the owner, send a same-origin `POST /api/ops/sheet-mirror`. The response contains only run ID, counts and hashes.
5. Repeat the same source snapshot and confirm its snapshot hash is unchanged. Run the parity report before enabling `shadow`.

### Shadow proof (MIG-03)

1. Set `SUPABASE_READ_MODEL_MODE=shadow` only after a complete mirror run.
2. As the owner, send a same-origin `POST /api/ops/sheet-mirror/parity`.
3. Require `exact: true`, no mismatches, and equal expected/active row counts. Mismatch entries contain only collection, kind and a one-way fingerprint; they never expose content or stable IDs.
4. Keep application reads on Sheets. The snapshot adapter is read-only and all three mutation methods return `CONFIG_MISSING`; it is used for adapter-parity proof, not production authority.
5. Repeat after every mapped-field or Sheet-parser change. Any mismatch blocks read cutover unless a dated, reviewed exception is added to the decision record.

For later continuous reconciliation, use a secured server-side scheduler to invoke the complete snapshot operation. Vercel Cron sends a `GET` with `Authorization: Bearer <CRON_SECRET>`; do not register that schedule until the dedicated Supabase project, copied Sheet, secret and first manual snapshot have all been verified. Overlapping snapshot finalizers are serialized per source and an older run is refused, so duplicate scheduler delivery cannot regress the active mirror.

If Supabase is unavailable, leave the mode `off`; normal Sheet, Drive and
Typefully work is unaffected.

## Verification (DEP-03..07)

Run against the exact deployed SHA (shown by `/api/health`):

- `curl -sI <url>` shows `content-security-policy`, `x-frame-options: DENY`, `strict-transport-security`, and `cache-control: private, no-store`.
- `/api/health` shows the SHA, `mode: live`, and the capability states; no values.
- Anonymous `/review` redirects to `/login`; anonymous `/api/me` is 401; a second Google account is refused.
- The preview URL requires Vercel authentication, and its `/api/health` reports `mode: fake`.
- T4 smoke (owner, non-sensitive test content): sign in; load a Library row and its Markdown; protected edit; QA and hook; visual or text-only decision; approve and queue; promote to a safe test slot; reconcile or create only an explicitly authorised test draft; sync final copy and status; check `/reconcile` and the logs. Clean up only the synthetic test records, by verified id.

## Rollback (DEP-07)

Rollback restores the previous verified **deployment and configuration**. It never deletes or restores Sheet, Drive or Typefully content.

1. Vercel, then Deployments: pick the last deployment whose SHA passed T4 and choose "Promote to Production" (instant rollback).
2. If a variable change caused the problem, restore the previous value in Settings, then Environment Variables, and redeploy the same SHA.
3. Emergency brake: set `GOOGLE_WRITE_ENABLED=false` and remove `TYPEFULLY_API_KEY`, then redeploy. The app becomes read-only; review keeps working.
4. Record the rolled-back SHA, the reason and the time in the CS-019 issue.

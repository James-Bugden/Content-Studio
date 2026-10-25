# Repeatable Production environment setup (CS-065)

The setup command copies missing configuration from LastPass into **Content
Studio Production only**, then re-lists names to confirm each successful write.
It never downloads existing Vercel values. Run it locally, with terminal/session
recording disabled. Do not put credential values in commands, `.env` files,
screenshots, GitHub, or chat.

## First-time preparation

1. Have Node 20.11+, the Vercel CLI and the LastPass CLI (`lpass`) available on
   PATH. Sign into Vercel using your own account (`vercel login`). These tools are
   prerequisites; this repository adds no package dependency. On native Windows,
   the script supports the standard npm Vercel shim by launching its Node entry
   point directly, and requires a native `lpass.exe`. If your LastPass CLI lives
   in WSL, run the entire workflow inside WSL with its own Node and CLIs.
2. From this checkout, link the project once:

   ```sh
   vercel link --project content-studio --scope james-projects-1242b366
   ```

   Confirm `.vercel/project.json` has `projectName: content-studio`. The setup
   refuses a missing or differently named link. That local file is ignored by Git.
3. In the LastPass application, create one entry per secret/private setting named
   **exactly** `content-studio/<NAME>`. Put the complete value in its **password**
   field, including real line breaks in the Google private key. For example,
   `content-studio/AUTH_SECRET` contains the production Auth.js secret. All
   secret-marked entries and capability memberships are listed in
   [`scripts/env-manifest.json`](../../scripts/env-manifest.json). It contains
   names and safe defaults only.

   In the manifest, `required` means required for this Production bootstrap;
   `schemaRequired` and `schemaDefault` describe Zod exactly. `default` is the
   safe Production provisioning default (for example, live rather than fake
   data). The unit test checks every schema name, requiredness and default.
4. Required entries for the normal Production workspace:

   - `content-studio/APP_BASE_URL` (the HTTPS production origin)
   - `content-studio/AUTH_SECRET` (at least 32 characters)
   - `content-studio/AUTH_GOOGLE_ID`
   - `content-studio/AUTH_GOOGLE_SECRET`
   - `content-studio/CS_OWNER_GOOGLE_SUB`
   - `content-studio/GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `content-studio/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
   - `content-studio/CS_SHEET_ID`

   Optional entries include the owner email, Drive folder/reference IDs,
   Typefully key and social-set ID, AI key, Supabase settings and cron secret.
   Private identifiers and URLs use LastPass too. A missing required entry fails
   setup; a missing optional entry is reported and skipped. For first owner
   sign-in, follow the subject discovery instructions in [deploy.md](deploy.md);
   populate LastPass afterwards and rerun setup.
5. Unlock LastPass locally (enter your email, then password at its private prompt):

   ```sh
   lpass login <your-email>
   lpass status
   ```

## The repeatable command

Preview the names that would change:

```sh
npm run env:setup -- --dry-run
```

Dry run lists current Vercel Production names, but does not read LastPass,
generate secrets, or change anything. Conditional AI defaults are only planned
when the AI key is already present; a real run also handles a newly added key.

Then apply missing settings:

```sh
npm run env:setup
```

The command reports added/skipped/failed **names only**. Successful writes are
verified by a fresh name listing. Run it again safely after any partial failure;
existing values are always skipped. A required missing LastPass entry or failed
write exits non-zero. Fix the named entry/access problem, then rerun.

Safe defaults are `CS_DATA_MODE=live`, `CS_CONTENT_STORE=sheet`,
`CS_CONTENT_WRITE_ENABLED=false`, `GOOGLE_WRITE_ENABLED=false`,
`SUPABASE_READ_MODEL_MODE=off`, and `APP_TIMEZONE=Asia/Taipei`. When an AI key
exists or has just been added, missing `AI_PROVIDER` and `AI_MODEL` receive
`anthropic` and `claude-sonnet-5-5`. Existing settings are preserved, so the
command cannot repair a previously wrong value without explicit rotation.
Commit/deployment/test variables are inventoried but never bootstrapped.
Database cutover and write-enable gates remain subject to the existing runbooks.

To limit setup, or explicitly replace one existing value after updating LastPass:

```sh
npm run env:setup -- --only ai
npm run env:setup -- --rotate AI_API_KEY
```

Capabilities are `auth`, `sheet`, `drive`, `typefully`, `ai`, `supabase`, `cron`,
and `db-store`. Sheet/Drive share service-account settings. Rotation uses Vercel
`env update`, never remove/add, affects only the named existing setting, and
does not change your LastPass entry. Non-secret rotations use manifest defaults.
Do not run competing setup sessions: Vercel's CLI offers no atomic
compare-and-set for environment updates. A name recheck before add avoids
observed conflicts; add never requests force/overwrite. Existing values cannot
be compared or validated by a names-only check.

To create a missing cron secret automatically:

```sh
npm run env:setup -- --only cron --generate-cron-secret
```

Only when the entry is absent from a successfully listed vault, the command
generates 32 random bytes (64 hex characters), saves the password to LastPass
first, and then adds it to Vercel over stdin. If Vercel fails, rerun: LastPass
already holds the recoverable value. Existing entries and rotations never
generate replacement secrets. This does not enable a cron schedule.

Local non-interactive shells require `--yes`. `CI=true` always refuses setup,
even with `--yes`. Provider stdout/stderr and raw errors are suppressed; they
may contain credentials. Failed CLI operations show only safe instructions and
names. The script has no rollback/delete operation and never writes secrets to
disk or to a child environment/argument.

## Redeploy and verify

Vercel variable changes apply to the **next deployment**. Redeploy the approved
Production commit through the existing [deployment workflow](deploy.md).
Then set the public origin locally and run:

```powershell
$env:APP_BASE_URL = 'https://your-production-host.example'
npm run env:verify
```

For a POSIX shell: `APP_BASE_URL=https://your-production-host.example npm run env:verify`.
The command requests only public `/api/health`, refuses redirects, and prints
each capability's expectation and observed state. Required auth must be
`ready`; Sheet/Drive may be `read_only` because bootstrap leaves writes off.
Optional AI/Typefully may be `not_configured`. A required missing capability,
any reported provider error, invalid response, or fake-mode deployment exits
non-zero. `not_configured` remains distinct from `error`.

The endpoint currently has **no Supabase or cron capability probe**: these show
`unreported / unverified`, not a pass. An absent DB capability is expected while
the content store remains Sheet. Health proves configuration presence, not
credential correctness, provider connectivity, or a successful owner workflow.
Perform the remaining deployment smoke checks in deploy.md and compare the
health commit to the approved deployment. No paid CI or scheduled job is added.

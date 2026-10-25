# Repeatable Production environment setup (CS-065)

The setup command copies missing configuration from a hidden terminal prompt,
LastPass CLI, or a private local file into **Content Studio Production only**, then re-lists names to confirm each successful write.
It never downloads existing Vercel values. Run it locally, with terminal/session
recording disabled. Do not put credential values in commands, `.env` files,
screenshots, GitHub, or chat.

## First-time preparation

1. Have Node 20.11+ and the Vercel CLI on PATH. Sign into Vercel with
   `vercel login`. No LastPass connector or CLI is needed for prompt mode.
   Native Windows supports the standard npm Vercel shim by launching its Node
   entry point directly. Use PowerShell, cmd, or Git Bash with a real terminal.
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
   Private identifiers and URLs use LastPass too. A missing required file/vault
   entry fails setup; a missing optional entry is reported and skipped. For first owner
   sign-in, follow the subject discovery instructions in [deploy.md](deploy.md);
   populate LastPass afterwards and rerun setup.
5. For CLI mode only, install `lpass` (native `lpass.exe` on Windows), then
   unlock LastPass locally (email, then password at its private prompt):

   ```sh
   lpass login <your-email>
   lpass status
   ```

## Choose a secret source

`--from prompt|lastpass|file` selects the source. Without it, setup uses
LastPass only if `lpass status --quiet` succeeds (installed and logged in);
otherwise it uses the hidden prompt. Safe defaults always come from the manifest.

### Windows without lpass: hidden prompt

```powershell
npm run env:setup -- --from prompt
```

Open the LastPass **web vault**, copy the password for the displayed variable,
and paste it into the terminal. Input is hidden: no characters or stars appear.
Press Enter to submit once; a blank answer skips the variable, including required
variables (skips are not proof of complete configuration). The prompt displays
only names and progress such as `AUTH_SECRET (2 of 5)`. Clear your clipboard
and clipboard history afterwards. No confirmation/re-entry is needed.

For multiline keys, use bracketed paste in a supporting terminal, then Enter.
If your terminal does not support bracketed paste, use file mode or LastPass CLI
for multiline values; ordinary Enter submits the current prompt.
`--yes` cannot bypass the prompt's real-TTY requirement.

### LastPass CLI

```sh
npm run env:setup -- --from lastpass
```

This mode requires an installed, logged-in CLI and uses the vault entries above.
An explicit choice never silently falls back. Cron generation remains available
only in this mode, with the existing save-to-vault-before-Vercel safeguard.

### Private plaintext file

```powershell
npm run env:setup -- --from file --secrets-file C:\private\production-secrets.txt
```

The file is **plaintext**. Create it outside every Git work tree, restrict it to
your account, and remove it yourself after success. The script never copies,
rewrites, or deletes it. The optional `--shred` facility is not included.
Keep it out of synced folders/backups.
Use simple `NAME=value` lines, one secret-marked manifest name per line. Blank
lines and `#` comments are allowed; duplicate, unknown and non-secret names are
refused. The first `=` separates name and value; later `=` characters are kept.
Empty/missing required entries fail; optional ones skip. For multiline private
keys use escaped `\n` in a single line (supported by the application's key parser).

Resolved paths inside this repository or another detected Git work tree are
refused, including symlinks into one. POSIX group/other permissions are refused
(use `chmod 600`); Windows uses `icacls` and refuses failed checks or detectable
Everyone/Users/Authenticated Users read grants. Localized/custom Windows groups
may require you to check permissions manually; prefer prompt mode if uncertain.
The script never prints file contents or raw filesystem/ACL errors.

## The repeatable command

Preview the names that would change:

```sh
npm run env:setup -- --dry-run
```

Dry run lists current Vercel Production names, but does not probe LastPass,
read files, prompt, generate secrets, or change anything. Conditional AI defaults
are only planned when the AI key is already present; a real run also handles a newly added key.

Then apply missing settings:

```sh
npm run env:setup
```

The command reports added/skipped/failed **names only**. Successful writes are
verified by a fresh name listing. Run it again safely after any partial failure;
existing values are always skipped. A required missing file/LastPass entry or
failed write exits non-zero. Fix the named entry/access problem, then rerun.

Safe defaults are `CS_DATA_MODE=live`, `CS_CONTENT_STORE=sheet`,
`CS_CONTENT_WRITE_ENABLED=false`, `GOOGLE_WRITE_ENABLED=false`,
`SUPABASE_READ_MODEL_MODE=off`, and `APP_TIMEZONE=Asia/Taipei`. When an AI key
exists or has just been added, missing `AI_PROVIDER` and `AI_MODEL` receive
`anthropic` and `claude-sonnet-5-5`. Existing settings are preserved, so the
command cannot repair a previously wrong value without explicit rotation.
Commit/deployment/test variables are inventoried but never bootstrapped.
Database cutover and write-enable gates remain subject to the existing runbooks.

To limit setup, or explicitly replace one existing value from the selected source:

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
npm run env:setup -- --from lastpass --only cron --generate-cron-secret
```

Only when the entry is absent from a successfully listed vault, the command
generates 32 random bytes (64 hex characters), saves the password to LastPass
first, and then adds it to Vercel over stdin. If Vercel fails, rerun: LastPass
already holds the recoverable value. Existing entries and rotations never
generate replacement secrets. This does not enable a cron schedule.

Local non-interactive shells require `--yes`. `CI=true` always refuses setup,
even with `--yes`. Provider stdout/stderr and raw errors are suppressed; they
may contain credentials. Failed CLI operations show only safe instructions and
names. The script has no rollback/delete operation and never writes secret
values to disk or to a child environment/argument.

## Troubleshooting

- **Nothing appears when pasting:** hidden input is intentional. Press Enter once.
- **TTY required:** open an interactive PowerShell/cmd/Git Bash terminal. Do not
  pipe values into this script or run it from an IDE output panel. In Git Bash
  mintty, use `winpty node scripts/env-setup.mjs --from prompt` if Node lacks a
  TTY. `--yes` only permits deliberate non-interactive LastPass/file runs; CI remains refused.
- **LastPass unavailable/logged out:** use `--from prompt` and the web vault, or
  repair/login to the CLI for `--from lastpass`. WSL users should run the complete
  workflow with WSL's own Node and CLIs.
- **File refused:** move it outside Git trees, check owner-only permissions and
  line format. Avoid symlinks, duplicate names and non-secret settings.
- **Write/list failed:** verify Vercel login, project link and scope, then rerun.
  Existing names stay untouched; use explicit `--rotate NAME` to replace one.

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

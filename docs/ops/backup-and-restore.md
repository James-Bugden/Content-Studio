# Weekly backup and restore

The Supabase database is the only copy of the posts and replies data, so a
full copy is saved off-project every week to the owner's private Google Drive.

## What is backed up

One file per run, `content-studio-backup-YYYY-MM-DD-HHmm.json.gz` (Taipei time),
plus a small `...manifest.json` next to it. The `.json.gz` is one gzip JSON
document: every table under `tables`, and the manifest at the end.

| Section | Rows |
| --- | --- |
| posts (all columns, incl. `image_sketch`, `image_sketch_options`, `platform_versions`, `deleted_at`), schedule, workflow_settings, schema_version | all |
| row_history, audit_events | newest 5,000 each (the manifest records the real total) |
| ai_budget, ai_calls, ai_cap_operations | all |
| reply settings, source posts, resources, facts, sessions, suggestions, library, revisions | all |
| reply generation runs | newest 5,000 |
| reply bank images | metadata incl. `sha256` (no bytes) |
| reply bank image files | ids only, so a restore can see which image bytes are missing |

Never included: auth tables, tokens, keys, env values, the idempotency ledger,
embeddings and search indexes, image bytes. The manifest holds per-table row
counts and sha256, the schema version, the build commit and the time (UTC and
Taipei). Migration file names are not readable from the app; the schema version
and the `schema_version` table are recorded instead.

## Where and when

- Vercel Cron calls `GET /api/ops/backup` every Sunday 19:00 UTC (03:00 Monday Taipei). It needs `CRON_SECRET`; without it the route refuses (fail closed).
- The owner can press **Back up now** in the Backup card on **Fix issues**.
- Target: the private Drive folder in `BACKUP_DRIVE_FOLDER_ID`, shared with the service account (editor). The folder must not be shared by link or domain; the app refuses a folder that is.
- Setting names only (values live in the environment): `BACKUP_DRIVE_FOLDER_ID`, `CRON_SECRET`, `GOOGLE_WRITE_ENABLED=true`, the existing Google service account and Supabase settings. Optional: `HEALTHCHECK_PING_URL` (https; pinged on success, `<url>/fail` on failure, never blocks a backup).
- Run history is stored in `content_studio_backup_runs` (migration `20261029000100_weekly_backup_runs.sql`).

## Safety rules

- A run succeeds only after Drive's md5 and size equal the local file and the manifest re-reads and parses.
- Only after that are older backups trimmed: the newest 8 complete backups stay; older ones go to the Drive trash (recoverable for 30 days). Only files this feature created are ever touched (name pattern plus the app marker); nothing else in the folder is.
- A failed run never trims anything, and is recorded with a code-only error message.

## Warnings

The Backup card and the **Fix issues** count show a warning when the last run failed, when the last success is more than 8 days old, or when no backup has ever succeeded. An unset folder is shown as "not set up".

## Verify a backup

```
node scripts/restore-backup.mjs content-studio-backup-2026-11-01-0300.json.gz --manifest content-studio-backup-2026-11-01-0300.manifest.json
```

This is a dry run. It checks the gzip, the format, every table's row count and
sha256, the allow-listed table names, and (with `--manifest`) that the file
matches its sidecar checksum, then prints the rows per table. It changes nothing.

## Restore

1. Create or pick an empty target database and apply all migrations (`supabase/migrations`).
2. Dry-run the file as above.
3. Apply, with the target URL in the environment (never as an argument):

```
RESTORE_DATABASE_URL=<target connection string> node scripts/restore-backup.mjs <file.json.gz> --apply --confirm
```

It upserts table by table, parents first, one transaction per table, and
re-seeds the history and audit sequences. If a table fails it rolls that table
back and stops; rerunning is safe (upserts). `--apply` without `--confirm`, or
without `RESTORE_DATABASE_URL`, changes nothing. The `pg` package is needed once:
`npm install --no-save pg`.

Reply tables reference `auth.users`; the owner's user must exist in the target.
Image bytes are not in the backup: images listed in `reply_bank_images` need
their files re-uploaded (compare sha256).

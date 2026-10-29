-- #249. UNAPPLIED by the build workflow; the coordinator applies it. Idempotent.
-- History of the weekly off-project backup runs (when, ok or not, file, size, row
-- counts, a code-only error). Owner-only: reachable through the service role
-- exclusively. It holds no post text and no secrets.
begin;

create table if not exists public.content_studio_backup_runs (
  id uuid primary key,
  trigger_kind text not null check (trigger_kind in ('cron', 'manual')),
  status text not null default 'running' check (status in ('running', 'success', 'failure')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  file_name text check (file_name is null or file_name ~ '^content-studio-backup-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}[.]json[.]gz$'),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  row_counts jsonb check (row_counts is null or jsonb_typeof(row_counts) = 'object'),
  error_message text check (error_message is null or length(error_message) <= 300),
  warnings integer not null default 0 check (warnings >= 0),
  build_commit text check (build_commit is null or length(build_commit) <= 64),
  constraint content_studio_backup_runs_finished_shape check (
    (status = 'running' and finished_at is null) or (status <> 'running' and finished_at is not null))
);

create index if not exists content_studio_backup_runs_started on public.content_studio_backup_runs (started_at desc);
create index if not exists content_studio_backup_runs_success on public.content_studio_backup_runs (finished_at desc) where status = 'success';

alter table public.content_studio_backup_runs enable row level security;
revoke all on public.content_studio_backup_runs from public, anon, authenticated;
grant select, insert, update on public.content_studio_backup_runs to service_role;

commit;

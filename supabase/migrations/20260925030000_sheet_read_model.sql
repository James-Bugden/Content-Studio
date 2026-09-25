-- Sheet-fed, server-only Supabase read model (CS-020).
-- Google Sheets remains the sole writable authority.

create table if not exists public.content_studio_sheet_sync_runs (
  run_id uuid primary key,
  schema_version integer not null check (schema_version = 1),
  source_key text not null check (source_key ~ '^[a-z0-9][a-z0-9_-]{7,63}$'),
  started_at timestamptz not null,
  completed_at timestamptz,
  status text not null check (status in ('applying', 'complete', 'failed')),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{16}$'),
  counts jsonb not null check (jsonb_typeof(counts) = 'object'),
  upserted integer not null default 0 check (upserted >= 0),
  retired integer not null default 0 check (retired >= 0)
);

create table if not exists public.content_studio_sheet_rows (
  source_key text not null check (source_key ~ '^[a-z0-9][a-z0-9_-]{7,63}$'),
  collection text not null check (collection in ('library', 'queue', 'ready', 'schedule', 'queue_summary', 'workflow_settings')),
  stable_id text not null check (stable_id <> ''),
  source_row integer check (source_row is null or source_row > 0),
  source_revision text,
  row_hash text not null check (row_hash ~ '^[0-9a-f]{16}$'),
  payload jsonb not null,
  sync_run_id uuid not null references public.content_studio_sheet_sync_runs(run_id),
  synced_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (source_key, collection, stable_id)
);

create index if not exists content_studio_sheet_rows_active
  on public.content_studio_sheet_rows (source_key, collection, stable_id)
  where retired_at is null;

create index if not exists content_studio_sheet_rows_sync_run
  on public.content_studio_sheet_rows (sync_run_id);

alter table public.content_studio_sheet_sync_runs enable row level security;
alter table public.content_studio_sheet_sync_runs force row level security;
alter table public.content_studio_sheet_rows enable row level security;
alter table public.content_studio_sheet_rows force row level security;

revoke all on table public.content_studio_sheet_sync_runs from anon, authenticated;
revoke all on table public.content_studio_sheet_rows from anon, authenticated;
grant select, insert, update, delete on table public.content_studio_sheet_sync_runs to service_role;
grant select, insert, update, delete on table public.content_studio_sheet_rows to service_role;

create or replace function public.apply_content_studio_sheet_snapshot(
  p_schema_version integer,
  p_source_key text,
  p_run_id uuid,
  p_started_at timestamptz,
  p_snapshot_hash text,
  p_counts jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  existing_hash text;
  changed_count integer := 0;
  retired_count integer := 0;
begin
  if p_schema_version <> 1 then
    raise exception 'unsupported mirror schema version' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'invalid snapshot document' using errcode = '22023';
  end if;

  select snapshot_hash into existing_hash
  from public.content_studio_sheet_sync_runs
  where run_id = p_run_id;

  if existing_hash is not null then
    if existing_hash <> p_snapshot_hash then
      raise exception 'run id already used for another snapshot' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'runId', p_run_id,
      'snapshotHash', existing_hash,
      'replayed', true,
      'upserted', (select upserted from public.content_studio_sheet_sync_runs where run_id = p_run_id),
      'retired', (select retired from public.content_studio_sheet_sync_runs where run_id = p_run_id)
    );
  end if;

  insert into public.content_studio_sheet_sync_runs (
    run_id, schema_version, source_key, started_at, status, snapshot_hash, counts
  ) values (
    p_run_id, p_schema_version, p_source_key, p_started_at, 'applying', p_snapshot_hash, p_counts
  );

  insert into public.content_studio_sheet_rows (
    source_key, collection, stable_id, source_row, source_revision, row_hash, payload, sync_run_id, synced_at, retired_at
  )
  select
    p_source_key,
    item.collection,
    item.stable_id,
    item.source_row,
    item.source_revision,
    item.row_hash,
    item.payload,
    p_run_id,
    now(),
    null
  from jsonb_to_recordset(p_rows) as item(
    collection text,
    stable_id text,
    source_row integer,
    source_revision text,
    row_hash text,
    payload jsonb
  )
  on conflict (source_key, collection, stable_id) do update set
    source_row = excluded.source_row,
    source_revision = excluded.source_revision,
    row_hash = excluded.row_hash,
    payload = excluded.payload,
    sync_run_id = excluded.sync_run_id,
    synced_at = excluded.synced_at,
    retired_at = null;
  get diagnostics changed_count = row_count;

  update public.content_studio_sheet_rows
  set retired_at = now(), sync_run_id = p_run_id, synced_at = now()
  where source_key = p_source_key
    and retired_at is null
    and not exists (
      select 1
      from jsonb_to_recordset(p_rows) as item(collection text, stable_id text)
      where item.collection = content_studio_sheet_rows.collection
        and item.stable_id = content_studio_sheet_rows.stable_id
    );
  get diagnostics retired_count = row_count;

  update public.content_studio_sheet_sync_runs
  set status = 'complete', completed_at = now(), upserted = changed_count, retired = retired_count
  where run_id = p_run_id;

  return jsonb_build_object(
    'runId', p_run_id,
    'snapshotHash', p_snapshot_hash,
    'replayed', false,
    'upserted', changed_count,
    'retired', retired_count
  );
end;
$$;

revoke all on function public.apply_content_studio_sheet_snapshot(integer, text, uuid, timestamptz, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_content_studio_sheet_snapshot(integer, text, uuid, timestamptz, text, jsonb, jsonb) to service_role;

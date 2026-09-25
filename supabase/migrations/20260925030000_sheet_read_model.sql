-- Sheet-fed, server-only Supabase read model (CS-020).
-- Google Sheets remains the sole writable authority.

create table if not exists public.content_studio_sheet_sync_runs (
  run_id uuid primary key,
  schema_version integer not null check (schema_version = 1),
  source_key text not null check (source_key ~ '^[a-z0-9][a-z0-9_-]{7,63}$'),
  started_at timestamptz not null,
  completed_at timestamptz,
  status text not null check (status in ('staging', 'complete', 'failed')),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  counts jsonb not null check (jsonb_typeof(counts) = 'object'),
  upserted integer not null default 0 check (upserted >= 0),
  retired integer not null default 0 check (retired >= 0)
);

create table if not exists public.content_studio_sheet_stage (
  run_id uuid not null references public.content_studio_sheet_sync_runs(run_id) on delete cascade,
  collection text not null check (collection in ('library', 'queue', 'ready', 'schedule', 'queue_summary', 'workflow_settings')),
  stable_id text not null check (stable_id <> ''),
  source_row integer check (source_row is null or source_row > 0),
  source_revision text,
  row_hash text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  primary key (run_id, collection, stable_id)
);

create table if not exists public.content_studio_sheet_rows (
  source_key text not null check (source_key ~ '^[a-z0-9][a-z0-9_-]{7,63}$'),
  collection text not null check (collection in ('library', 'queue', 'ready', 'schedule', 'queue_summary', 'workflow_settings')),
  stable_id text not null check (stable_id <> ''),
  source_row integer check (source_row is null or source_row > 0),
  source_revision text,
  row_hash text not null check (row_hash ~ '^[0-9a-f]{64}$'),
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
alter table public.content_studio_sheet_stage enable row level security;
alter table public.content_studio_sheet_stage force row level security;
alter table public.content_studio_sheet_rows enable row level security;
alter table public.content_studio_sheet_rows force row level security;

revoke all on table public.content_studio_sheet_sync_runs from anon, authenticated;
revoke all on table public.content_studio_sheet_stage from anon, authenticated;
revoke all on table public.content_studio_sheet_rows from anon, authenticated;
grant select, insert, update, delete on table public.content_studio_sheet_sync_runs to service_role;
grant select, insert, update, delete on table public.content_studio_sheet_stage to service_role;
grant select, insert, update, delete on table public.content_studio_sheet_rows to service_role;

create or replace function public.begin_content_studio_sheet_snapshot(
  p_schema_version integer,
  p_source_key text,
  p_run_id uuid,
  p_started_at timestamptz,
  p_snapshot_hash text,
  p_counts jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  existing public.content_studio_sheet_sync_runs%rowtype;
begin
  if p_schema_version <> 1 or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'invalid snapshot header' using errcode = '22023';
  end if;

  select * into existing from public.content_studio_sheet_sync_runs where run_id = p_run_id;
  if found then
    if existing.snapshot_hash <> p_snapshot_hash or existing.source_key <> p_source_key or existing.counts <> p_counts then
      raise exception 'run id already used for another snapshot' using errcode = '23505';
    end if;
    if existing.status = 'complete' then
      return jsonb_build_object(
        'state', 'complete',
        'runId', existing.run_id,
        'snapshotHash', existing.snapshot_hash,
        'replayed', true,
        'upserted', existing.upserted,
        'retired', existing.retired
      );
    end if;
    return jsonb_build_object('state', 'staging', 'staged', (select count(*) from public.content_studio_sheet_stage where run_id = p_run_id));
  end if;

  insert into public.content_studio_sheet_sync_runs (
    run_id, schema_version, source_key, started_at, status, snapshot_hash, counts
  ) values (
    p_run_id, p_schema_version, p_source_key, p_started_at, 'staging', p_snapshot_hash, p_counts
  );
  return jsonb_build_object('state', 'staging', 'staged', 0);
end;
$$;

create or replace function public.stage_content_studio_sheet_snapshot(p_run_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  run_status text;
  staged_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid snapshot rows' using errcode = '22023';
  end if;
  select status into run_status from public.content_studio_sheet_sync_runs where run_id = p_run_id for update;
  if run_status is null then raise exception 'snapshot run not found' using errcode = 'P0002'; end if;
  if run_status <> 'staging' then raise exception 'snapshot run is not staging' using errcode = '55000'; end if;

  insert into public.content_studio_sheet_stage (
    run_id, collection, stable_id, source_row, source_revision, row_hash, payload
  )
  select p_run_id, item.collection, item.stable_id, item.source_row, item.source_revision, item.row_hash, item.payload
  from jsonb_to_recordset(p_rows) as item(
    collection text,
    stable_id text,
    source_row integer,
    source_revision text,
    row_hash text,
    payload jsonb
  )
  on conflict (run_id, collection, stable_id) do update set
    source_row = excluded.source_row,
    source_revision = excluded.source_revision,
    row_hash = excluded.row_hash,
    payload = excluded.payload;

  select count(*) into staged_count from public.content_studio_sheet_stage where run_id = p_run_id;
  return jsonb_build_object('staged', staged_count);
end;
$$;

create or replace function public.finalize_content_studio_sheet_snapshot(p_run_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  run public.content_studio_sheet_sync_runs%rowtype;
  expected_collection text;
  expected_count integer;
  actual_count integer;
  changed_count integer := 0;
  retired_count integer := 0;
begin
  select * into run from public.content_studio_sheet_sync_runs where run_id = p_run_id for update;
  if not found then raise exception 'snapshot run not found' using errcode = 'P0002'; end if;
  if run.status = 'complete' then
    return jsonb_build_object('runId', run.run_id, 'snapshotHash', run.snapshot_hash, 'replayed', true, 'upserted', run.upserted, 'retired', run.retired);
  end if;
  if run.status <> 'staging' then raise exception 'snapshot run is not staging' using errcode = '55000'; end if;

  foreach expected_collection in array array['library', 'queue', 'ready', 'schedule', 'queue_summary', 'workflow_settings'] loop
    begin
      expected_count := (run.counts ->> expected_collection)::integer;
    exception when others then
      raise exception 'invalid snapshot counts' using errcode = '22023';
    end;
    select count(*) into actual_count
    from public.content_studio_sheet_stage
    where run_id = p_run_id and collection = expected_collection;
    if expected_count is null or expected_count <> actual_count then
      raise exception 'snapshot count mismatch for %', expected_collection using errcode = '22023';
    end if;
  end loop;

  insert into public.content_studio_sheet_rows (
    source_key, collection, stable_id, source_row, source_revision, row_hash, payload, sync_run_id, synced_at, retired_at
  )
  select run.source_key, stage.collection, stage.stable_id, stage.source_row, stage.source_revision, stage.row_hash, stage.payload, p_run_id, now(), null
  from public.content_studio_sheet_stage as stage
  where stage.run_id = p_run_id
  on conflict (source_key, collection, stable_id) do update set
    source_row = excluded.source_row,
    source_revision = excluded.source_revision,
    row_hash = excluded.row_hash,
    payload = excluded.payload,
    sync_run_id = excluded.sync_run_id,
    synced_at = excluded.synced_at,
    retired_at = null;
  get diagnostics changed_count = row_count;

  update public.content_studio_sheet_rows as active
  set retired_at = now(), sync_run_id = p_run_id, synced_at = now()
  where active.source_key = run.source_key
    and active.retired_at is null
    and not exists (
      select 1 from public.content_studio_sheet_stage as stage
      where stage.run_id = p_run_id
        and stage.collection = active.collection
        and stage.stable_id = active.stable_id
    );
  get diagnostics retired_count = row_count;

  update public.content_studio_sheet_sync_runs
  set status = 'complete', completed_at = now(), upserted = changed_count, retired = retired_count
  where run_id = p_run_id;
  delete from public.content_studio_sheet_stage where run_id = p_run_id;

  return jsonb_build_object('runId', p_run_id, 'snapshotHash', run.snapshot_hash, 'replayed', false, 'upserted', changed_count, 'retired', retired_count);
end;
$$;

revoke all on function public.begin_content_studio_sheet_snapshot(integer, text, uuid, timestamptz, text, jsonb) from public, anon, authenticated;
revoke all on function public.stage_content_studio_sheet_snapshot(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_content_studio_sheet_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.begin_content_studio_sheet_snapshot(integer, text, uuid, timestamptz, text, jsonb) to service_role;
grant execute on function public.stage_content_studio_sheet_snapshot(uuid, jsonb) to service_role;
grant execute on function public.finalize_content_studio_sheet_snapshot(uuid) to service_role;

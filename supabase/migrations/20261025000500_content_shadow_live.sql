-- UNAPPLIED: DB-9 Phase A only. Builder executes this with PGlite, never hosted SQL.
-- Additive; do not edit previously applied migrations or any Replies object.
begin;

create table if not exists public.content_studio_shadow_jobs (
  operation_id text primary key check (length(operation_id) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  token uuid not null,
  status text not null check (status in ('running','completed','failed')),
  started_at timestamptz not null default clock_timestamp(),
  result jsonb
);
create table if not exists public.content_studio_shadow_lease (
  singleton boolean primary key default true check (singleton),
  operation_id text not null,
  token uuid not null,
  expires_at timestamptz not null
);
create table if not exists public.content_studio_shadow_events (
  event_id uuid primary key,
  at timestamptz not null default clock_timestamp(),
  kind text not null check (kind in ('sample','imported','failed')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);
create index if not exists content_studio_shadow_events_at on public.content_studio_shadow_events (at, event_id);

-- One MVCC snapshot, not offset pages that can skip an overlapping failure
-- insert. A JSON scalar RPC result also avoids PostgREST's table row cap.
create or replace function public.content_studio_shadow_history()
returns jsonb language sql stable security invoker set search_path = pg_catalog, public as $$
  with cutoff as (select now()-interval '30 days' as t),
  prior_import as (select * from public.content_studio_shadow_events where kind='imported' and at < (select t from cutoff) order by at desc,event_id desc limit 1),
  carry_failure as (select * from public.content_studio_shadow_events where kind='failed'
    and at < (select t from cutoff) and (at,event_id) > (coalesce((select at from prior_import),'-infinity'::timestamptz), coalesce((select event_id from prior_import),'00000000-0000-0000-0000-000000000000'::uuid)) order by at,event_id limit 1),
  bounded as (
    select * from (select * from public.content_studio_shadow_events where at >= (select t from cutoff)
      union all select * from prior_import union all select * from carry_failure) e order by at,event_id limit 50001
  ) select coalesce(jsonb_agg(to_jsonb(e) order by at,event_id),'[]'::jsonb) from bounded e;
$$;

create or replace function public.content_studio_shadow_claim(p_operation_id text, p_request_hash text, p_token uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare j public.content_studio_shadow_jobs; l public.content_studio_shadow_lease;
begin
  if p_operation_id is null or p_operation_id !~ '^(owner|scheduled):[a-z0-9][a-z0-9_-]{7,63}:[0-9a-f-]{36}$'
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' or p_token is null then
    raise exception 'invalid claim' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(197, 1);
  select * into j from public.content_studio_shadow_jobs where operation_id=p_operation_id for update;
  if found then
    if j.request_hash <> p_request_hash then raise exception 'claim conflict' using errcode='23505'; end if;
    if j.status='completed' then return jsonb_build_object('status','replayed','result',j.result); end if;
  end if;
  select * into l from public.content_studio_shadow_lease where singleton for update;
  if found and l.expires_at > clock_timestamp() then return jsonb_build_object('status','in_progress'); end if;
  -- An abandoned/expired job is durable failure evidence, even after restart.
  if l.operation_id is not null then
    update public.content_studio_shadow_jobs set status='failed' where operation_id=l.operation_id and status='running';
    insert into public.content_studio_shadow_events(event_id,at,kind,payload)
      values(l.token,l.expires_at,'failed','{}') on conflict do nothing;
  end if;
  insert into public.content_studio_shadow_jobs(operation_id,request_hash,token,status)
    values(p_operation_id,p_request_hash,p_token,'running')
    on conflict(operation_id) do update set token=excluded.token,status='running',started_at=clock_timestamp();
  insert into public.content_studio_shadow_lease values(true,p_operation_id,p_token,clock_timestamp()+interval '65 seconds')
    on conflict(singleton) do update set operation_id=excluded.operation_id,token=excluded.token,expires_at=excluded.expires_at;
  return jsonb_build_object('status','acquired');
end $$;

create or replace function public.content_studio_shadow_release(p_operation_id text, p_token uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  perform pg_advisory_xact_lock(197, 1);
  update public.content_studio_shadow_jobs set status='failed'
    where operation_id=p_operation_id and token=p_token and status='running';
  if found then
    insert into public.content_studio_shadow_events(event_id,kind,payload) values(p_token,'failed','{}') on conflict do nothing;
  end if;
  delete from public.content_studio_shadow_lease where operation_id=p_operation_id and token=p_token;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.content_studio_shadow_import(p_operation_id text,p_token uuid,p_snapshot_hash text,p_actor_hash text,
  p_counts jsonb,p_hashes jsonb,p_exceptions jsonb,p_rows jsonb,p_window_waiver text default null)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare r jsonb; evidence jsonb; captured timestamptz; item jsonb; actual jsonb; expected jsonb;
  field text; fields bigint := 0; equal_fields bigint := 0; unknown_fields bigint := 0;
  ids_equal boolean; source_differences bigint;
begin
  perform pg_advisory_xact_lock(197, 1);
  if p_window_waiver is not null and p_window_waiver <> '2026-10-25' then raise exception 'invalid window waiver' using errcode='22023'; end if;
  -- Hold the lease row through the entire import transaction. A paused worker
  -- cannot commit after another instance has replaced its expired lease.
  perform 1 from public.content_studio_shadow_lease where singleton and operation_id=p_operation_id
    and token=p_token and expires_at>clock_timestamp() for update;
  if not found then raise exception 'expired import lease' using errcode='42501'; end if;
  select started_at into strict captured from public.content_studio_shadow_jobs where operation_id=p_operation_id and token=p_token and status='running' for update;
  r := public.content_studio_import_run(p_operation_id,p_snapshot_hash,p_actor_hash,p_counts,p_hashes,p_exceptions,p_rows);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'import conflict' using errcode='40001'; end if;
  -- Measure every typed source row against its committed representation in the
  -- same transaction. jsonb_populate_record normalises SQL integer/timestamp
  -- representations; source conversion differences remain in the named ledger.
  ids_equal := (select count(*) from public.content_studio_posts) = (p_counts->>'library')::bigint + (p_counts->>'queue')::bigint
    and (select count(*) from public.content_studio_schedule) = (p_counts->>'schedule')::bigint
    and (select count(*) from public.content_studio_workflow_settings) = (p_counts->>'workflow_settings')::bigint;
  for item in select value from jsonb_array_elements(p_rows) loop
    if item->>'target_kind' in ('library','queue') then
      select to_jsonb(t) into actual from public.content_studio_posts t where collection=item->>'target_kind' and library_id=item->>'target_id';
      expected := to_jsonb(jsonb_populate_record(null::public.content_studio_posts,item->'row'));
    elsif item->>'target_kind' = 'schedule' then
      select to_jsonb(t) into actual from public.content_studio_schedule t where content_id=item->>'target_id';
      expected := to_jsonb(jsonb_populate_record(null::public.content_studio_schedule,item->'row'));
    else
      select to_jsonb(t) into actual from public.content_studio_workflow_settings t where setting=item->>'target_id';
      expected := to_jsonb(jsonb_populate_record(null::public.content_studio_workflow_settings,item->'row'));
    end if;
    if actual is null then ids_equal := false; end if;
    for field in select jsonb_object_keys(item->'row') loop
      fields := fields + 1;
      if actual->field is not distinct from expected->field then equal_fields := equal_fields + 1;
      else unknown_fields := unknown_fields + 1; end if;
    end loop;
  end loop;
  select count(*) into source_differences from jsonb_array_elements(p_exceptions) e
    where e->>'class' not in ('formula_display','blank_boolean');
  evidence := jsonb_build_object('snapshotHash',p_snapshot_hash,'counts',p_counts,'hashes',p_hashes,'exceptions',p_exceptions,
    'fullParity',jsonb_build_object('rows',jsonb_array_length(p_rows),'idsEqual',ids_equal,'fields',fields,
      'equal',greatest(0,equal_fields-source_differences),'unclassified',unknown_fields),
    'windowWaiver',case when p_window_waiver is null then null else jsonb_build_object('by','owner','on',p_window_waiver,'recordedAt',clock_timestamp()) end);
  update public.content_studio_shadow_jobs set status='completed',result=evidence where operation_id=p_operation_id;
  insert into public.content_studio_shadow_events(event_id,kind,payload)
    values(p_token,'imported',jsonb_build_object('snapshotAt',floor(extract(epoch from captured)*1000),'evidence',evidence));
  delete from public.content_studio_shadow_lease where singleton and token=p_token;
  return r;
end $$;

create or replace function public.content_studio_shadow_sample(p_event_id uuid,p_sample jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare prior jsonb;
begin
  if p_event_id is null or p_sample is null or jsonb_typeof(p_sample) <> 'object'
    or not (p_sample ?& array['at','collection','idsEqual','fields','equal','blocking','lagMs','facts'])
    or p_sample - array['at','collection','idsEqual','fields','equal','blocking','lagMs','facts'] <> '{}'::jsonb
    or p_sample->>'collection' not in ('library','queue','ready','schedule','queue_summary','workflow_settings')
    or jsonb_typeof(p_sample->'idsEqual') <> 'boolean' or jsonb_typeof(p_sample->'facts') <> 'array'
    or not (p_sample->>'at' ~ '^\d+$' and p_sample->>'fields' ~ '^\d+$' and p_sample->>'equal' ~ '^\d+$' and p_sample->>'blocking' ~ '^\d+$')
    or (p_sample->'lagMs' <> 'null'::jsonb and not (p_sample->>'lagMs' ~ '^\d+$'))
    or (p_sample->>'at')::numeric < 0 or (p_sample->>'fields')::numeric < 0 or (p_sample->>'equal')::numeric < 0
    or (p_sample->>'equal')::numeric > (p_sample->>'fields')::numeric or (p_sample->>'blocking')::numeric < 0
    then raise exception 'invalid sample' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_sample->'facts') f where
      jsonb_typeof(f) <> 'object' or not (f ?& array['collection','field','kind','fingerprint'])
      or f - array['collection','field','kind','fingerprint'] <> '{}'::jsonb
      or f->>'collection' is distinct from p_sample->>'collection'
      or jsonb_typeof(f->'field') <> 'string' or length(f->>'field') > 512
      or f->>'fingerprint' !~ '^[a-f0-9]{16}$'
      or f->>'kind' not in ('equal','missing','unexpected','changed','number_formatting','trailing_whitespace','blank_boolean','boolean_formatting','timestamp_formatting','zero_row_source'))
    then raise exception 'invalid sample fact' using errcode='22023'; end if;
  insert into public.content_studio_shadow_events(event_id,kind,payload) values(p_event_id,'sample',p_sample) on conflict do nothing;
  select payload into prior from public.content_studio_shadow_events where event_id=p_event_id and kind='sample';
  if prior is distinct from p_sample then raise exception 'sample conflict' using errcode='23505'; end if;
  return jsonb_build_object('ok',true);
end $$;

alter table public.content_studio_shadow_jobs enable row level security;
alter table public.content_studio_shadow_jobs force row level security;
alter table public.content_studio_shadow_lease enable row level security;
alter table public.content_studio_shadow_lease force row level security;
alter table public.content_studio_shadow_events enable row level security;
alter table public.content_studio_shadow_events force row level security;
revoke all on public.content_studio_shadow_jobs, public.content_studio_shadow_lease, public.content_studio_shadow_events from public, anon, authenticated;
grant select,insert,update,delete on public.content_studio_shadow_jobs, public.content_studio_shadow_lease, public.content_studio_shadow_events to service_role;
revoke all on function public.content_studio_shadow_claim(text,text,uuid), public.content_studio_shadow_release(text,uuid),
  public.content_studio_shadow_import(text,uuid,text,text,jsonb,jsonb,jsonb,jsonb,text), public.content_studio_shadow_sample(uuid,jsonb), public.content_studio_shadow_history() from public, anon, authenticated;
grant execute on function public.content_studio_shadow_claim(text,text,uuid), public.content_studio_shadow_release(text,uuid),
  public.content_studio_shadow_import(text,uuid,text,text,jsonb,jsonb,jsonb,jsonb,text), public.content_studio_shadow_sample(uuid,jsonb), public.content_studio_shadow_history() to service_role;
commit;

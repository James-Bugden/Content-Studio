-- UNAPPLIED. DB-10: private operational evidence/locks only. No authority flip.
begin;
create table public.content_studio_cutover_state (
  name text primary key check (name in ('sheet-export','markdown-export','backup')),
  token uuid,
  lease_until timestamptz,
  state jsonb,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.content_studio_cutover_evidence (
  name text primary key check (name in ('parity','phase-c','rehearsal','backup')),
  build text not null check (build ~ '^[a-f0-9]{40}$'),
  import_id text not null,
  payload jsonb not null,
  at timestamptz not null default clock_timestamp()
);
create table public.content_studio_cutover_jobs (
  operation_id uuid primary key,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  token uuid,
  result jsonb,
  at timestamptz not null default clock_timestamp()
);
-- An epoch survives compatible deployments. Only activate checks a build SHA.
create table public.content_studio_cutover_authority (
  singleton boolean primary key default true check(singleton),
  mode text not null check(mode in ('sheet','db-read','db')),
  build text not null,
  contract text not null,
  schema_version integer not null,
  activated_at timestamptz not null default clock_timestamp()
);
alter table public.content_studio_cutover_authority enable row level security;
alter table public.content_studio_cutover_authority force row level security;
revoke all on public.content_studio_cutover_authority from public, anon, authenticated;
grant select,insert,update on public.content_studio_cutover_authority to service_role;
alter table public.content_studio_cutover_state enable row level security;
alter table public.content_studio_cutover_state force row level security;
alter table public.content_studio_cutover_evidence enable row level security;
alter table public.content_studio_cutover_evidence force row level security;
alter table public.content_studio_cutover_jobs enable row level security;
alter table public.content_studio_cutover_jobs force row level security;
revoke all on public.content_studio_cutover_state, public.content_studio_cutover_evidence, public.content_studio_cutover_jobs from public, anon, authenticated;
grant select,insert,update,delete on public.content_studio_cutover_state, public.content_studio_cutover_evidence, public.content_studio_cutover_jobs to service_role;

create function public.content_studio_cutover_operation(p_id uuid,p_hash text,p_token uuid,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare j public.content_studio_cutover_jobs;
begin
  if p_id is null or p_token is null or p_hash is null then raise exception 'operation required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(198,1);
  select * into j from public.content_studio_cutover_jobs where operation_id=p_id for update;
  if found then
    if j.request_hash<>p_hash then raise exception 'operation conflict' using errcode='23505'; end if;
    if j.result is not null then return jsonb_build_object('status','replayed','result',j.result); end if;
    if p_result is null and (j.token is null or j.at < clock_timestamp()-interval '2 minutes') then
      update public.content_studio_cutover_jobs set token=p_token,at=clock_timestamp() where operation_id=p_id;
      return jsonb_build_object('status','acquired');
    end if;
    if p_result is null or j.token is distinct from p_token or j.at<clock_timestamp()-interval '2 minutes' then raise exception 'operation in progress' using errcode='55000'; end if;
    if p_result='{"retry":true}'::jsonb then
      update public.content_studio_cutover_jobs set token=null where operation_id=p_id;
      return jsonb_build_object('status','completed');
    end if;
    update public.content_studio_cutover_jobs set result=p_result where operation_id=p_id;
    return jsonb_build_object('status','completed','result',p_result);
  end if;
  if p_result is not null then raise exception 'operation not claimed' using errcode='42501'; end if;
  insert into public.content_studio_cutover_jobs(operation_id,request_hash,token) values(p_id,p_hash,p_token);
  return jsonb_build_object('status','acquired');
end $$;

create function public.content_studio_cutover_claim(p_name text,p_token uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare s public.content_studio_cutover_state;
begin
  if p_token is null then raise exception 'token required' using errcode='22023'; end if;
  insert into public.content_studio_cutover_state(name) values(p_name) on conflict do nothing;
  select * into s from public.content_studio_cutover_state where name=p_name for update;
  if s.token is not null and s.lease_until > clock_timestamp() then raise exception 'worker leased' using errcode='55000'; end if;
  update public.content_studio_cutover_state set token=p_token,lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() where name=p_name;
  return jsonb_build_object('ok',true,'state',s.state);
end $$;
create function public.content_studio_cutover_read(p_name text)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
  select state from public.content_studio_cutover_state where name=p_name;
$$;
create function public.content_studio_cutover_save(p_name text,p_token uuid,p_state jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare cp jsonb; k jsonb;
begin
  update public.content_studio_cutover_state set state=p_state,updated_at=clock_timestamp() where name=p_name and token=p_token and lease_until>clock_timestamp();
  if not found then raise exception 'stale worker' using errcode='42501'; end if;
  if p_name='sheet-export' then
    for cp in select value from jsonb_array_elements(p_state->'checkpoints') loop
      k := (cp->>0)::jsonb;
      -- Tuple keys avoid PostgreSQL's prohibition on JSON NUL characters.
      if k->>0 in ('library','queue') then
        update public.content_studio_posts set exported_sheet_revision=cp->1->>'fingerprint'
          where collection=k->>0 and library_id=k->>1 and row_version=(cp->1->>'version')::bigint and exported_sheet_revision is distinct from cp->1->>'fingerprint';
      elsif k->>0='schedule' then
        update public.content_studio_schedule set exported_sheet_revision=cp->1->>'fingerprint'
          where content_id=k->>1 and row_version=(cp->1->>'version')::bigint and exported_sheet_revision is distinct from cp->1->>'fingerprint';
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok',true);
end $$;
create function public.content_studio_cutover_fence(p_name text,p_token uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  update public.content_studio_cutover_state set lease_until=clock_timestamp()+interval '2 minutes'
    where name=p_name and token=p_token and lease_until>clock_timestamp();
  if not found then raise exception 'stale worker' using errcode='42501'; end if;
  return jsonb_build_object('ok',true);
end $$;
create function public.content_studio_cutover_release(p_name text,p_token uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  update public.content_studio_cutover_state set token=null,updated_at=clock_timestamp() where name=p_name and token=p_token;
  if not found then raise exception 'stale worker' using errcode='42501'; end if;
  return jsonb_build_object('ok',true);
end $$;

-- Single MVCC snapshot, independent of PostgREST row caps. Derived outbox is
-- deliberately not restored: reconstruction may not guess a Drive baseline.
-- DB bodies/history are authoritative even when Drive export is blocked.
create function public.content_studio_cutover_snapshot()
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
  return jsonb_build_object(
    'posts',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.content_studio_posts t),
    'schedule',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.content_studio_schedule t),
    'workflow_settings',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.content_studio_workflow_settings t),
    'row_history',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.content_studio_row_history t),
    'operations',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.content_studio_operations t),
    'audit_events',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.content_studio_audit_events t));
end $$;

create function public.content_studio_cutover_record(p_name text,p_build text,p_import_id text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if p_import_id is distinct from (select operation_id from public.content_studio_import_runs order by at desc,operation_id desc limit 1)
    or p_import_id is null then raise exception 'import changed or missing' using errcode='40001'; end if;
  insert into public.content_studio_cutover_evidence values(p_name,p_build,p_import_id,p_payload,clock_timestamp())
    on conflict(name) do update set build=excluded.build,import_id=excluded.import_id,payload=excluded.payload,at=excluded.at;
  return jsonb_build_object('ok',true);
end $$;

create function public.content_studio_cutover_gate(p_mode text,p_build text)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare e public.content_studio_cutover_evidence; s jsonb; c text; latest text; proof jsonb;
begin
  if p_mode not in ('db-read','db') or p_build is null or p_build !~ '^[a-f0-9]{40}$' then raise exception 'invalid gate' using errcode='42501'; end if;
  select operation_id into latest from public.content_studio_import_runs order by at desc,operation_id desc limit 1;
  select * into e from public.content_studio_cutover_evidence where name='parity' and build=p_build and import_id=latest;
  if not found or e.payload->>'coverage' is distinct from 'all-rows' or e.at < clock_timestamp()-interval '15 minutes' then raise exception 'full parity required' using errcode='42501'; end if;
  foreach c in array array['library','queue','ready','schedule','queue_summary','workflow_settings'] loop
    s := e.payload->'samples'->c;
    if s is null or s->>'idsEqual' is distinct from 'true' or s->>'blocking' is distinct from '0'
      or (s->>'lagMs')::numeric is null or (s->>'lagMs')::numeric not between 0 and 900000
      or (s->>'fields')::numeric is null or (s->>'fields')::numeric < 0
      or (s->>'equal')::numeric is null or (s->>'equal')::numeric < (s->>'fields')::numeric*.999
      or (s->>'equal')::numeric > (s->>'fields')::numeric then raise exception 'parity not green' using errcode='42501'; end if;
  end loop;
  if p_mode='db' then
    foreach c in array array['phase-c','rehearsal','backup'] loop
      select payload into proof from public.content_studio_cutover_evidence where name=c and build=p_build and import_id=latest;
      if not found then raise exception 'write proof missing' using errcode='42501'; end if;
      if (select at from public.content_studio_cutover_evidence where name=c) < clock_timestamp()-interval '24 hours' then raise exception 'write proof expired' using errcode='42501'; end if;
      if c='phase-c' and (proof->>'smoke' is distinct from 'true' or proof->>'t4' is distinct from 'true'
        or proof->>'writeThrough' is distinct from 'true' or proof->>'freeze' is distinct from 'true'
        or proof->>'dailyPlanBackup' is distinct from 'true' or proof->>'restoreExact' is distinct from 'true'
        or proof->>'importsStopped' is distinct from 'true' or proof->>'flagRoundTrip' is distinct from 'true'
        or proof->>'hostedSecurity' is distinct from 'true' or proof->>'independentConcurrency' is distinct from 'true'
        or proof->>'sheetRaceAccepted' is distinct from 'true'
        or coalesce(length(proof->>'privateEvidence'),0)=0
        or proof->>'sheetRead429' is distinct from '0' or proof->>'lagStale' is distinct from '0'
        or (proof->>'warmP95Ms')::numeric is null or (proof->>'warmP95Ms')::numeric not between 0 and 999.999
        or (proof->>'coldP95Ms')::numeric is null or (proof->>'coldP95Ms')::numeric not between 0 and 2499.999)
        then raise exception 'phase C proof missing' using errcode='42501'; end if;
      if c='rehearsal' and (proof->>'exact' is distinct from 'true' or proof->>'dbHash' is null
        or proof->>'dbHash' !~ '^[a-f0-9]{64}$' or proof->>'dbHash' is distinct from proof->>'sheetHash') then raise exception 'rollback proof missing' using errcode='42501'; end if;
      if c='backup' and (proof->>'manifestHash' is null or proof->>'manifestHash' !~ '^[a-f0-9]{64}$') then raise exception 'backup proof missing' using errcode='42501'; end if;
    end loop;
  end if;
  return jsonb_build_object('ok',true);
end $$;

create function public.content_studio_cutover_retire(p_operation_id uuid,p_build text,p_rehearsal_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare e public.content_studio_cutover_evidence; a public.content_studio_cutover_authority; t uuid:=gen_random_uuid(); h text; claim jsonb; result jsonb;
begin
  h:=encode(sha256(convert_to('retire:'||p_build||':'||p_rehearsal_hash,'UTF8')),'hex');
  claim:=public.content_studio_cutover_operation(p_operation_id,h,t,null);
  if claim->>'status'='replayed' then return claim->'result'; end if;
  perform pg_advisory_xact_lock(198,2);
  select * into a from public.content_studio_cutover_authority where singleton for update;
  select * into e from public.content_studio_cutover_evidence where name='rehearsal';
  if a.mode is null or e.build is distinct from p_build or e.payload->>'exact' is distinct from 'true'
    or e.import_id is distinct from (select operation_id from public.content_studio_import_runs order by at desc,operation_id desc limit 1)
    or exists(select 1 from public.content_studio_posts where updated_at>e.at)
    or exists(select 1 from public.content_studio_schedule where updated_at>e.at)
    or p_rehearsal_hash is null or p_rehearsal_hash !~ '^[a-f0-9]{64}$'
    or e.payload->>'dbHash' is distinct from p_rehearsal_hash or e.payload->>'sheetHash' is distinct from p_rehearsal_hash
    or e.at<clock_timestamp()-interval '15 minutes' then raise exception 'verified rollback required' using errcode='42501'; end if;
  -- Coordinator calls only AFTER verifying the frozen Sheet deployment, BEFORE
  -- resuming Sheet writes. Frozen flag round-trip rehearsals need not retire.
  if a.mode<>'sheet' then update public.content_studio_cutover_authority set mode='sheet',activated_at=clock_timestamp() where singleton; end if;
  result:=jsonb_build_object('ok',true,'mode','sheet','build',p_build);
  perform public.content_studio_cutover_operation(p_operation_id,h,t,result);
  return result;
end $$;

create function public.content_studio_cutover_activate(p_mode text,p_build text,p_contract text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v integer; a public.content_studio_cutover_authority;
begin
  perform pg_advisory_xact_lock(198,2);
  select * into a from public.content_studio_cutover_authority where singleton;
  if a.mode='sheet' and not exists(select 1 from public.content_studio_import_runs where at>a.activated_at) then
    raise exception 'new import required after Sheet rollback' using errcode='42501';
  end if;
  select version into v from public.content_studio_schema_version;
  if p_contract is distinct from 'schema-'||v||':cutover-1' then raise exception 'contract mismatch' using errcode='42501'; end if;
  perform public.content_studio_cutover_gate(p_mode,p_build);
  -- Never downgrade a DB epoch by running a Phase C activation.
  if p_mode='db-read' and exists(select 1 from public.content_studio_cutover_authority where mode='db') then raise exception 'DB authority exists' using errcode='42501'; end if;
  insert into public.content_studio_cutover_authority(singleton,mode,build,contract,schema_version)
    values(true,p_mode,p_build,p_contract,v) on conflict(singleton) do update
    set mode=excluded.mode,build=excluded.build,contract=excluded.contract,schema_version=excluded.schema_version,activated_at=clock_timestamp();
  return jsonb_build_object('ok',true);
end $$;

create function public.content_studio_cutover_authorize(p_mode text,p_build text,p_contract text,p_write boolean default false,p_recovery boolean default false)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare a public.content_studio_cutover_authority; blocked text; v integer; latest text;
begin
  select * into a from public.content_studio_cutover_authority where singleton;
  if not found then
    if p_mode='db' then raise exception 'activate DB authority first' using errcode='42501'; end if;
    perform public.content_studio_cutover_gate('db-read',p_build);
    return jsonb_build_object('ok',true,'readOnly',false);
  end if;
  if a.mode='sheet' then raise exception 'DB epoch retired; activate with a new import' using errcode='42501'; end if;
  if a.mode='db' then
    if p_mode<>'db' then raise exception 'DB authority exists' using errcode='42501'; end if;
    -- Owner emergency exit never depends on measured admission or contract.
    if p_recovery then return jsonb_build_object('ok',true,'readOnly',false); end if;
  end if;
  select version into v from public.content_studio_schema_version;
  if a.contract is distinct from p_contract or a.schema_version is distinct from v then blocked:='cutover_contract_mismatch'; end if;
  if a.mode='db-read' then
    if p_mode='db' then raise exception 'activate DB authority first' using errcode='42501'; end if;
    select operation_id into latest from public.content_studio_import_runs order by at desc,operation_id desc limit 1;
    -- Re-evaluate current evidence without imposing the current deploy SHA.
    begin perform public.content_studio_cutover_gate('db-read',(select build from public.content_studio_cutover_evidence where name='parity' and import_id=latest));
    exception when others then blocked:='cutover_measurement_required'; end;
  end if;
  if p_write and blocked is not null then raise exception '%',blocked using errcode='42501'; end if;
  return jsonb_build_object('ok',true,'readOnly',blocked is not null,'blocking',blocked);
end $$;

-- Serialize the actual authority write with activation/retirement, not just the
-- preceding HTTP authorization. No epoch is the pre-cutover DB-3 test/import
-- contract; once an epoch exists, only compatible DB authority may patch/insert.
create function content_studio_private.content_studio_cutover_assert_write()
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare a public.content_studio_cutover_authority; v integer;
begin
  perform pg_advisory_xact_lock(198,2);
  select * into a from public.content_studio_cutover_authority where singleton;
  if not found then return; end if;
  select version into v from public.content_studio_schema_version;
  if a.mode<>'db' or a.schema_version is distinct from v or a.contract is distinct from 'schema-'||v||':cutover-1' then
    raise exception 'DB write epoch changed' using errcode='42501';
  end if;
end $$;
revoke all on function content_studio_private.content_studio_cutover_assert_write() from public,anon,authenticated;
grant execute on function content_studio_private.content_studio_cutover_assert_write() to service_role;

create or replace function public.content_studio_insert_queue_idea(
  p_operation_id text, p_patch_hash text, p_actor_hash text, p_library_id text, p_row jsonb
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin
  perform content_studio_private.content_studio_cutover_assert_write();
  return content_studio_private.content_studio_mutate('queue',p_operation_id,p_patch_hash,p_actor_hash,'queue',p_library_id,null,p_row);
end $$;

create or replace function public.content_studio_apply_patch(
  p_operation_id text, p_patch_hash text, p_actor_hash text, p_target_kind text,
  p_target_id text, p_expected_version bigint, p_patch jsonb
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result jsonb;
  before_row public.content_studio_posts;
  after_row public.content_studio_posts;
begin
  perform content_studio_private.content_studio_cutover_assert_write();
  perform pg_advisory_xact_lock(hashtextextended('content_studio_authority', 0));
  if p_target_kind = 'library' then
    select * into before_row from public.content_studio_posts where collection='library' and library_id=p_target_id;
  end if;
  if p_target_kind = 'library' and p_patch ? 'draft_content' and before_row.draft_content is distinct from p_patch->>'draft_content' and before_row.review_status = 'Approved' then
    p_patch := p_patch || jsonb_build_object('review_status','Not Reviewed');
  end if;
  result := content_studio_private.content_studio_mutate('patch', p_operation_id, p_patch_hash, p_actor_hash,
    p_target_kind, p_target_id, p_expected_version, p_patch);
  if p_target_kind = 'library' and result->>'ok' = 'true' and result#>>'{steps,0,state}' = 'applied'
    and coalesce((result->>'replayed')::boolean, false) = false then
    select * into after_row from public.content_studio_posts where collection='library' and library_id=p_target_id;
    if coalesce(after_row.source_markdown_url,'')='' and coalesce(after_row.source_master_file_url,'')='' then
      delete from public.content_studio_markdown_export where library_id=p_target_id;
    elsif before_row.draft_content is distinct from after_row.draft_content
      or before_row.source_markdown_url is distinct from after_row.source_markdown_url
      or before_row.source_master_file_url is distinct from after_row.source_master_file_url then
      insert into public.content_studio_markdown_export as q (library_id,row_version,expected_body,body)
      values (p_target_id,after_row.row_version,before_row.draft_content,after_row.draft_content)
      on conflict (library_id) do update set row_version=excluded.row_version,body=excluded.body;
    end if;
  end if;
  return result;
end;
$$;

-- Narrow recovery for edited rows with no Drive destination. Normal patches
-- still cannot edit source identity. A DB body is never a guessed Drive baseline:
-- the worker can acknowledge this job only when the linked section is exact.
create function public.content_studio_restore_markdown_link(
  p_operation_id text,p_patch_hash text,p_actor_hash text,p_library_id text,p_expected_version bigint,p_url text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare r public.content_studio_posts; result jsonb;
begin
  perform content_studio_private.content_studio_cutover_assert_write();
  if not exists(select 1 from public.content_studio_cutover_authority where mode='db') then
    raise exception 'DB authority required' using errcode='42501';
  end if;
  if p_url is null or length(p_url)>2048 or p_url !~ '^https://drive[.]google[.]com/file/d/[A-Za-z0-9_-]{10,200}/view$'
    or p_expected_version is null then raise exception 'invalid recovery link or version' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('content_studio_authority',0));
  select * into r from public.content_studio_posts where collection='library' and library_id=p_library_id for update;
  if not found then raise exception 'library row required' using errcode='22023'; end if;
  if not exists(select 1 from public.content_studio_operations where operation_id=p_operation_id)
    and (coalesce(r.source_markdown_url,'')<>'' or coalesce(r.source_master_file_url,'')<>''
      or r.source_markdown ~ 'https?://' or r.source_master_file ~ 'https?://') then
    raise exception 'no-link recovery only' using errcode='42501';
  end if;
  result:=content_studio_private.content_studio_mutate('copy',p_operation_id,p_patch_hash,p_actor_hash,'library',p_library_id,p_expected_version,
    jsonb_build_object('source_markdown',p_url,'source_markdown_url',p_url));
  if result->>'ok'='true' and coalesce((result->>'replayed')::boolean,false)=false then
    select * into r from public.content_studio_posts where collection='library' and library_id=p_library_id;
    insert into public.content_studio_markdown_export as q(library_id,row_version,expected_body,body)
      values(p_library_id,r.row_version,r.draft_content,r.draft_content)
      on conflict(library_id) do update set row_version=excluded.row_version,expected_body=excluded.expected_body,body=excluded.body;
  end if;
  return result;
end $$;
revoke all on function public.content_studio_restore_markdown_link(text,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.content_studio_restore_markdown_link(text,text,text,text,bigint,text) to service_role;

-- A Sheet-sourced write (typed import or Phase C copy/write-through) must never
-- reach a DB that is the authority. The check runs inside the same transaction
-- and under the same epoch lock as retirement and activation, so a deployment or
-- env mistake (db-shadow while the epoch is db) or an old import cron fails
-- closed instead of replacing newer DB-only saves. A db-read epoch (Phase C),
-- no epoch (first import) and a retired epoch (mode sheet) stay allowed.
create function content_studio_private.content_studio_cutover_assert_not_db()
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(198,2);
  if exists(select 1 from public.content_studio_cutover_authority where singleton and mode='db') then
    raise exception 'DB write epoch is authoritative; Sheet-sourced writes refused' using errcode='42501';
  end if;
end $$;
revoke all on function content_studio_private.content_studio_cutover_assert_not_db() from public,anon,authenticated;
grant execute on function content_studio_private.content_studio_cutover_assert_not_db() to service_role;

create or replace function public.content_studio_write_through(
  p_operation_id text, p_patch_hash text, p_actor_hash text, p_target_kind text,
  p_target_id text, p_expected_version bigint, p_row jsonb
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform content_studio_private.content_studio_cutover_assert_not_db();
  return content_studio_private.content_studio_mutate('copy', p_operation_id, p_patch_hash, p_actor_hash,
    p_target_kind, p_target_id, p_expected_version, p_row);
end $$;

create or replace function public.content_studio_import_run(
  p_operation_id text, p_snapshot_hash text, p_actor_hash text,
  p_counts jsonb, p_hashes jsonb, p_exceptions jsonb, p_rows jsonb
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  item jsonb;
  response jsonb;
  old_operation public.content_studio_operations%rowtype;
  kind text;
begin
  perform content_studio_private.content_studio_cutover_assert_not_db();
  if p_operation_id is null or length(p_operation_id) not between 1 and 180
     or p_snapshot_hash is null or p_snapshot_hash !~ '^[0-9a-f]{64}$'
     or p_actor_hash is null or p_actor_hash !~ '^[0-9a-f]{64}$'
     or p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or p_counts is null or jsonb_typeof(p_counts) <> 'object'
     or p_hashes is null or jsonb_typeof(p_hashes) <> 'object'
     or p_exceptions is null or jsonb_typeof(p_exceptions) <> 'array' then
    raise exception 'invalid import envelope' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_exceptions) e
    where jsonb_typeof(e) <> 'object' or e ->> 'class' is null
      or e ->> 'class' not in ('formula_display','number_formatting','trailing_whitespace','blank_boolean','boolean_formatting','timestamp_formatting','refused_numeric','refused_size')
      or not (e ?& array['class','collection','field','hash'])
      or e - array['class','collection','field','hash'] <> '{}'
      or e ->> 'hash' is null or e ->> 'hash' !~ '^[0-9a-f]{64}$'
      or e ->> 'collection' is null or e ->> 'collection' not in ('library','queue','schedule','workflow_settings')
      or e ->> 'field' is null or not (e ->> 'class' = 'refused_size' and e ->> 'field' = '@row') and not exists (
        select 1 from pg_attribute a where a.attnum > 0 and not a.attisdropped
          and a.attrelid = (case e ->> 'collection'
            when 'schedule' then 'public.content_studio_schedule'
            when 'workflow_settings' then 'public.content_studio_workflow_settings'
            else 'public.content_studio_posts' end)::regclass
          and a.attname = e ->> 'field')) then
    raise exception 'unclassified import exception' using errcode = '22023';
  end if;
  foreach kind in array array['library','queue','schedule','workflow_settings'] loop
    if (p_counts ->> kind)::integer is distinct from
       (select count(*)::integer from jsonb_array_elements(p_rows) r where r ->> 'target_kind' = kind)
       or p_hashes ->> kind is null or p_hashes ->> kind !~ '^[0-9a-f]{64}$' then
      raise exception 'import count/hash mismatch' using errcode = '22023';
    end if;
  end loop;
  if p_counts - array['library','queue','schedule','workflow_settings'] <> '{}'
     or p_hashes - array['library','queue','schedule','workflow_settings'] <> '{}'
     or exists (select 1 from jsonb_array_elements(p_rows) r group by r ->> 'target_kind', r ->> 'target_id' having count(*) > 1) then
    raise exception 'invalid import collections or duplicate target' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('content_studio_authority', 0));
  select * into old_operation from public.content_studio_operations where operation_id = p_operation_id;
  if found then
    if old_operation.mode <> 'import' or old_operation.patch_hash <> p_snapshot_hash or old_operation.target_kind <> 'import'
       or old_operation.actor_hash <> p_actor_hash then
      return jsonb_build_object('ok',false,'code','CONFLICT','steps',
        jsonb_build_array(jsonb_build_object('state','conflict','reason','operation_reused_with_different_patch')), 'revision',null);
    end if;
    return old_operation.result || jsonb_build_object('replayed', true);
  end if;
  -- Children may precede their parent in a complete snapshot.
  set constraints content_studio_schedule_parent_content_id_fkey deferred;
  for item in select value from jsonb_array_elements(p_rows) loop
    response := content_studio_private.content_studio_mutate('import', p_operation_id,
      encode(sha256(convert_to(item::text, 'UTF8')), 'hex'), p_actor_hash,
      item ->> 'target_kind', item ->> 'target_id', (item ->> 'expected_version')::bigint, item -> 'row');
    if not (response ->> 'ok')::boolean then
      raise exception 'import row conflict' using errcode = '40001';
    end if;
  end loop;
  insert into public.content_studio_import_runs(operation_id,snapshot_hash,counts,hashes,exceptions)
    values (p_operation_id,p_snapshot_hash,p_counts,p_hashes,p_exceptions);
  response := jsonb_build_object('ok',true,'code',null,'steps',jsonb_build_array(jsonb_build_object('state','applied')), 'revision',null);
  insert into public.content_studio_operations(operation_id,patch_hash,target_kind,target_id,actor_hash,result,mode)
    values (p_operation_id,p_snapshot_hash,'import','import',p_actor_hash,response,'import');
  return response;
end;
$$;

-- Explicit inventory, no grants to browser roles or PUBLIC execution.
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'content_studio_cutover_%' loop
    execute format('revoke all on function %s from public, anon, authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
commit;

-- CS-055 / DB-1. Apply this file explicitly, never a repository-wide db push.
-- Additive schema only: no runtime cutover, import or provider calls.

-- Keep creation and deny-by-default ACL/RLS changes atomic even under psql
-- without --single-transaction. Any error must roll back the whole migration.
begin;

create table public.content_studio_posts (
  collection text not null check (collection in ('library', 'queue')),
  library_id text not null check (library_id <> ''),
  state text not null default '',
  content_source text not null default '',
  source_platform text not null default '',
  target_platform text not null default '',
  slug text not null default '',
  workflow_role text not null default '',
  source_master_file text not null default '',
  source_markdown text not null default '',
  pair_key text not null default '',
  source_theme text not null default '',
  content_angle integer,
  copyright_qa text not null default '',
  duplicate_qa text not null default '',
  review_status text not null default '',
  queue_for_schedule boolean not null default false,
  next_action text not null default '',
  pesto text not null default '',
  funnel_stage text not null default '',
  current_hook text not null default '',
  hook_template text not null default '',
  hook_alternatives text not null default '',
  hook_score integer,
  hook_type text not null default '',
  draft_content text not null default '',
  visual_source text not null default '',
  image_status text not null default '',
  image_brief text not null default '',
  image_file text not null default '',
  image_alt_text text not null default '',
  visual_version text not null default '',
  has_image text not null default '',
  image_next_action text not null default '',
  source_markdown_url text not null default '',
  source_master_file_url text not null default '',
  image_file_url text not null default '',
  passthrough jsonb not null default '{}' check (jsonb_typeof(passthrough) = 'object'),
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_op text,
  updated_by_op text,
  source_sheet_row integer check (source_sheet_row > 0),
  sheet_revision text,
  exported_sheet_revision text,
  primary key (collection, library_id)
);

create table public.content_studio_schedule (
  content_id text primary key check (content_id <> ''),
  parent_content_id text check (parent_content_id <> content_id) references public.content_studio_schedule(content_id) deferrable initially deferred,
  posted boolean not null default false,
  date text not null default '',
  platform text not null default '',
  slot text not null default '',
  publish_time text not null default '',
  source_link text not null default '',
  hook_template text not null default '',
  hook text not null default '',
  content text not null default '',
  chinese_content text not null default '',
  pesto text not null default '',
  post_type text not null default '',
  funnel_stage text not null default '',
  book_reference text not null default '',
  potential_post text not null default '',
  content_stage text not null default '',
  ai_review_notes text not null default '',
  hook_alternatives text not null default '',
  final_content text not null default '',
  ai_action text not null default '',
  hook_score integer,
  hook_type text not null default '',
  typefully_draft_id text not null default '',
  typefully_status text not null default '',
  final_synced_at timestamptz,
  final_synced_hash text not null default '',
  published_at timestamptz,
  post_link text not null default '',
  views integer check (views >= 0),
  likes integer check (likes >= 0),
  reposts integer check (reposts >= 0),
  replies integer check (replies >= 0),
  bookmarks integer check (bookmarks >= 0),
  new_followers integer check (new_followers >= 0),
  analytics_synced_at timestamptz,
  visual_source text not null default '',
  image_status text not null default '',
  image_brief text not null default '',
  image_file text not null default '',
  image_alt_text text not null default '',
  visual_version text not null default '',
  has_image text not null default '',
  image_next_action text not null default '',
  source_link_url text not null default '',
  image_file_url text not null default '',
  passthrough jsonb not null default '{}' check (jsonb_typeof(passthrough) = 'object'),
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_op text,
  updated_by_op text,
  source_sheet_row integer check (source_sheet_row > 0),
  sheet_revision text,
  exported_sheet_revision text
);
create index content_studio_schedule_parent on public.content_studio_schedule(parent_content_id);

create table public.content_studio_workflow_settings (
  setting text primary key check (setting <> ''),
  value text not null default '',
  notes text not null default '',
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_op text,
  updated_by_op text,
  source_sheet_row integer check (source_sheet_row > 0),
  sheet_revision text,
  exported_sheet_revision text
);

create table public.content_studio_operations (
  operation_id text primary key,
  patch_hash text not null,
  target_kind text not null,
  target_id text not null,
  actor_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create table public.content_studio_row_history (
  history_id bigserial primary key,
  operation_id text not null,
  target_kind text not null,
  target_id text not null,
  before_image jsonb,
  row_version_before bigint,
  changed_fields text[] not null,
  at timestamptz not null default now()
);
create index content_studio_row_history_target on public.content_studio_row_history(target_kind, target_id, history_id);
create table public.content_studio_audit_events (
  event_id bigserial primary key,
  operation_id text not null,
  actor_hash text not null,
  target_kind text not null,
  target_id text not null,
  changed_fields text[] not null,
  before_hash text,
  after_hash text,
  outcome text not null,
  at timestamptz not null default now()
);
create table public.content_studio_schema_version (
  singleton boolean primary key default true check (singleton),
  version integer not null check (version > 0),
  applied_at timestamptz not null default now()
);
insert into public.content_studio_schema_version (version) values (1);

-- Run metadata is separate from the content-free operation result. No payloads
-- or copy bodies belong in counts/hashes/the named exception ledger.
create table public.content_studio_import_runs (
  operation_id text primary key,
  snapshot_hash text not null,
  counts jsonb not null,
  hashes jsonb not null,
  exceptions jsonb not null,
  at timestamptz not null default now()
);

create view public.content_studio_ready_queue with (security_invoker = true) as
  select * from public.content_studio_posts
  where collection = 'library' and review_status = 'Approved' and queue_for_schedule;
create view public.content_studio_queue_summary with (security_invoker = true) as
  select content_source, source_master_file_url as master_link, count(*) as count
  from public.content_studio_posts where collection = 'queue'
  group by content_source, source_master_file_url;

-- Private-to-service implementation shared by the public RPCs. The mode is a
-- closed allowlist; table/column identifiers never come from executable input.
-- One namespaced transaction lock serializes this small owner-only corpus and
-- the ledger check, including concurrent first deliveries and full imports.
create function public.content_studio_mutate(
  p_mode text, p_operation_id text, p_patch_hash text, p_actor_hash text,
  p_target_kind text, p_target_id text, p_expected_version bigint, p_data jsonb
) returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  table_name text;
  key_column text;
  key_filter text;
  key_data jsonb;
  before_row jsonb;
  after_row jsonb;
  candidate jsonb;
  old_operation public.content_studio_operations%rowtype;
  protected text[] := array['collection','library_id','content_id','setting','row_version',
    'created_at','updated_at','created_by_op','updated_by_op','exported_sheet_revision'];
  fields text[];
  assignments text;
  insert_columns text;
  insert_values text;
  current_version bigint;
  content_changed boolean;
  outcome text;
  code text;
  response jsonb;
begin
  if p_mode is null or p_mode not in ('patch','queue','copy','import')
     or p_operation_id is null or length(p_operation_id) not between 1 and 200
     or p_patch_hash is null or p_patch_hash !~ '^[0-9a-f]{64}$'
     or p_actor_hash is null or p_actor_hash !~ '^[0-9a-f]{64}$'
     or p_target_id is null or length(p_target_id) not between 1 and 500
     or p_data is null or jsonb_typeof(p_data) <> 'object' or p_data = '{}'
     or octet_length(p_data::text) > 262144
     or (p_expected_version is not null and p_expected_version < 1) then
    raise exception 'invalid mutation envelope' using errcode = '22023';
  end if;
  case p_target_kind
    when 'library' then table_name := 'content_studio_posts'; key_column := 'library_id';
    when 'queue' then table_name := 'content_studio_posts'; key_column := 'library_id';
    when 'schedule' then table_name := 'content_studio_schedule'; key_column := 'content_id';
    when 'workflow_settings' then table_name := 'content_studio_workflow_settings'; key_column := 'setting';
    else raise exception 'invalid target kind' using errcode = '22023';
  end case;
  if p_mode = 'queue' and p_target_kind <> 'queue' then
    raise exception 'invalid queue target' using errcode = '22023';
  end if;
  if p_mode not in ('copy','import') then
    protected := protected || array['source_sheet_row','sheet_revision','passthrough'];
  end if;
  if exists (
    select 1 from jsonb_each(p_data) as item
    where item.key = any(protected)
      or not exists (select 1 from pg_attribute where attrelid = ('public.' || table_name)::regclass
                     and attname = item.key and attnum > 0 and not attisdropped)
      or (jsonb_typeof(item.value) = 'string' and length(item.value #>> '{}') > 50000)
  ) then
    raise exception 'invalid mutation fields' using errcode = '22023';
  end if;
  -- Match LIBRARY_WRITABLE, plus the real URL counterparts. Imports/creation
  -- accept the full typed row, but normal patches cannot edit source identity.
  if p_mode = 'patch' and (
    (p_target_kind in ('library','queue') and exists (
      select 1 from jsonb_object_keys(p_data) as f(name) where name <> all(array[
        'state','copyright_qa','duplicate_qa','review_status','queue_for_schedule','next_action',
        'target_platform','pesto','current_hook','hook_template','hook_alternatives','hook_score',
        'hook_type','draft_content','visual_source','image_status','image_brief','image_file',
        'image_file_url','image_alt_text','visual_version','has_image','image_next_action'])))
    or (p_target_kind = 'schedule' and p_data ? 'posted')
  ) then
    raise exception 'field is not writable' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('content_studio_authority', 0));
  -- Imports have ONE enclosing ledger entry, avoiding derived operation-id
  -- collisions and keeping every row's history tied to the actual run id.
  if p_mode <> 'import' then
    select * into old_operation from public.content_studio_operations where operation_id = p_operation_id;
    if found then
      if old_operation.patch_hash <> p_patch_hash or old_operation.target_kind <> p_target_kind
         or old_operation.target_id <> p_target_id or old_operation.actor_hash <> p_actor_hash then
        return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'steps',
          jsonb_build_array(jsonb_build_object('state','conflict','reason','operation_reused_with_different_patch')), 'revision', null);
      end if;
      return old_operation.result;
    end if;
  end if;

  key_data := jsonb_build_object(key_column, p_target_id);
  if table_name = 'content_studio_posts' then
    key_data := key_data || jsonb_build_object('collection', p_target_kind);
  end if;
  key_filter := format('t.%I = ($1 ->> %L)', key_column, key_column);
  if table_name = 'content_studio_posts' then
    key_filter := key_filter || ' and t.collection = ($1 ->> ''collection'')';
  end if;
  execute format('select to_jsonb(t) from public.%I t where %s for update', table_name, key_filter)
    into before_row using key_data;
  current_version := (before_row ->> 'row_version')::bigint;
  -- Normalize through the actual row type before testing equality (timestamps,
  -- nullable integers and booleans must compare as typed values).
  execute format('select to_jsonb(jsonb_populate_record(null::public.%I, $1))', table_name)
    into candidate using coalesce(before_row, key_data) || p_data;

  if before_row is null and p_mode = 'patch' then
    outcome := 'not_found'; code := 'NOT_FOUND';
  elsif before_row is not null and (select bool_and(candidate -> k = before_row -> k) from jsonb_object_keys(p_data) k) then
    outcome := 'already_applied';
  elsif before_row is not null and p_mode = 'queue' then
    outcome := 'conflict'; code := 'CONFLICT';
  elsif current_version is distinct from p_expected_version then
    outcome := 'stale'; code := 'STALE_READ';
  else
    select array_agg(k order by k) into fields from jsonb_object_keys(p_data) k
      where before_row is null or candidate -> k is distinct from before_row -> k;
    content_changed := exists (select 1 from unnest(fields) f
      where f not in ('sheet_revision','source_sheet_row'));
    if before_row is null then
      -- Only supplied columns are inserted so SQL defaults remain authoritative.
      select string_agg(format('%I', k), ', ' order by k),
             string_agg(format('r.%I', k), ', ' order by k)
        into insert_columns, insert_values from jsonb_object_keys(key_data || p_data) k;
      execute format('insert into public.%I as t (%s, created_by_op, updated_by_op)
        select %s, $2, $2 from jsonb_populate_record(null::public.%I, $1) r returning to_jsonb(t)',
        table_name, insert_columns, insert_values, table_name)
        into after_row using key_data || p_data, p_operation_id;
    else
      select string_agg(format('%I = r.%I', k, k), ', ' order by k)
        into assignments from jsonb_object_keys(p_data) k;
      execute format('update public.%I t set %s, row_version = t.row_version + $5,
        updated_at = now(), updated_by_op = $3 from jsonb_populate_record(null::public.%I, $2) r
        where %s and t.row_version = $4 returning to_jsonb(t)',
        table_name, assignments, table_name, key_filter)
        into after_row using key_data, candidate, p_operation_id, p_expected_version,
          case when content_changed then 1 else 0 end;
      if after_row is null then raise exception 'concurrent row change' using errcode = '40001'; end if;
    end if;
    current_version := (after_row ->> 'row_version')::bigint;
    outcome := 'applied';
    insert into public.content_studio_row_history
      (operation_id,target_kind,target_id,before_image,row_version_before,changed_fields)
      values (p_operation_id,p_target_kind,p_target_id,before_row,(before_row ->> 'row_version')::bigint,fields);
  end if;
  response := jsonb_build_object('ok', code is null, 'code', code,
    'steps', jsonb_build_array(jsonb_build_object('state', outcome)), 'revision', current_version);
  insert into public.content_studio_audit_events
    (operation_id,actor_hash,target_kind,target_id,changed_fields,before_hash,after_hash,outcome)
    values (p_operation_id,p_actor_hash,p_target_kind,p_target_id,coalesce(fields, array[]::text[]),
      encode(sha256(convert_to(before_row::text, 'UTF8')), 'hex'),
      encode(sha256(convert_to(coalesce(after_row,before_row)::text, 'UTF8')), 'hex'),outcome);
  -- Match the Sheet repository: only successful outcomes consume an operation
  -- ID. Failed attempts remain audited and re-execute on retry with fresh state.
  if p_mode <> 'import' and code is null then
    insert into public.content_studio_operations
      (operation_id,patch_hash,target_kind,target_id,actor_hash,result)
      values (p_operation_id,p_patch_hash,p_target_kind,p_target_id,p_actor_hash,response);
  end if;
  return response;
end;
$$;

create function public.content_studio_apply_patch(
  p_operation_id text, p_patch_hash text, p_actor_hash text, p_target_kind text,
  p_target_id text, p_expected_version bigint, p_patch jsonb
) returns jsonb language sql security invoker
set search_path = pg_catalog, public, pg_temp
as $$ select public.content_studio_mutate('patch', p_operation_id, p_patch_hash, p_actor_hash,
  p_target_kind, p_target_id, p_expected_version, p_patch); $$;

create function public.content_studio_insert_queue_idea(
  p_operation_id text, p_patch_hash text, p_actor_hash text, p_library_id text, p_row jsonb
) returns jsonb language sql security invoker
set search_path = pg_catalog, public, pg_temp
as $$ select public.content_studio_mutate('queue', p_operation_id, p_patch_hash, p_actor_hash,
  'queue', p_library_id, null, p_row); $$;

-- Caller supplies the version observed before reading the Sheet. Null asserts
-- absence. A stale copy is refused; retries replay without overwriting editors.
create function public.content_studio_write_through(
  p_operation_id text, p_patch_hash text, p_actor_hash text, p_target_kind text,
  p_target_id text, p_expected_version bigint, p_row jsonb
) returns jsonb language sql security invoker
set search_path = pg_catalog, public, pg_temp
as $$ select public.content_studio_mutate('copy', p_operation_id, p_patch_hash, p_actor_hash,
  p_target_kind, p_target_id, p_expected_version, p_row); $$;

-- Atomic typed upsert batch, not the Sheet reader/import scheduler (DB-4).
-- Each item: {target_kind,target_id,expected_version,row}. No deletion implied.
-- Counts/hashes/exception ledger are content-free run evidence supplied by the
-- importer. Expected versions prevent an older snapshot overwriting a new row.
create function public.content_studio_import_run(
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
      or e ->> 'class' not in ('formula_display','number_formatting','trailing_whitespace','blank_boolean','boolean_formatting','timestamp_formatting')
      or not (e ?& array['class','collection','field','hash'])
      or e - array['class','collection','field','hash'] <> '{}'
      or e ->> 'hash' is null or e ->> 'hash' !~ '^[0-9a-f]{64}$'
      or e ->> 'collection' is null or e ->> 'collection' not in ('library','queue','schedule','workflow_settings')
      or e ->> 'field' is null or not exists (
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
    if old_operation.patch_hash <> p_snapshot_hash or old_operation.target_kind <> 'import'
       or old_operation.actor_hash <> p_actor_hash then
      return jsonb_build_object('ok',false,'code','CONFLICT','steps',
        jsonb_build_array(jsonb_build_object('state','conflict','reason','operation_reused_with_different_patch')), 'revision',null);
    end if;
    return old_operation.result;
  end if;
  -- Children may precede their parent in a complete snapshot.
  set constraints content_studio_schedule_parent_content_id_fkey deferred;
  for item in select value from jsonb_array_elements(p_rows) loop
    response := public.content_studio_mutate('import', p_operation_id,
      encode(sha256(convert_to(item::text, 'UTF8')), 'hex'), p_actor_hash,
      item ->> 'target_kind', item ->> 'target_id', (item ->> 'expected_version')::bigint, item -> 'row');
    if not (response ->> 'ok')::boolean then
      raise exception 'import row conflict' using errcode = '40001';
    end if;
  end loop;
  insert into public.content_studio_import_runs(operation_id,snapshot_hash,counts,hashes,exceptions)
    values (p_operation_id,p_snapshot_hash,p_counts,p_hashes,p_exceptions);
  response := jsonb_build_object('ok',true,'code',null,'steps',jsonb_build_array(jsonb_build_object('state','applied')), 'revision',null);
  insert into public.content_studio_operations(operation_id,patch_hash,target_kind,target_id,actor_hash,result)
    values (p_operation_id,p_snapshot_hash,'import','import',p_actor_hash,response);
  return response;
end;
$$;

-- Explicit ACLs, including Supabase's default anon/authenticated function grants.
-- Only the objects created above are touched; no default-privilege changes.
do $$
declare obj text;
begin
  foreach obj in array array['content_studio_posts','content_studio_schedule','content_studio_workflow_settings',
    'content_studio_operations','content_studio_row_history','content_studio_audit_events',
    'content_studio_schema_version','content_studio_import_runs'] loop
    execute format('alter table public.%I enable row level security', obj);
    execute format('alter table public.%I force row level security', obj);
    execute format('revoke all on table public.%I from public, anon, authenticated', obj);
    execute format('grant select, insert, update, delete on table public.%I to service_role', obj);
  end loop;
  foreach obj in array array['content_studio_ready_queue','content_studio_queue_summary'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', obj);
    execute format('grant select on table public.%I to service_role', obj);
  end loop;
  foreach obj in array array['content_studio_row_history_history_id_seq','content_studio_audit_events_event_id_seq'] loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated', obj);
    execute format('grant usage, select on sequence public.%I to service_role', obj);
  end loop;
  for obj in select oid::regprocedure::text from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('content_studio_mutate','content_studio_apply_patch','content_studio_insert_queue_idea',
                    'content_studio_write_through','content_studio_import_run') loop
    execute format('revoke all on function %s from public, anon, authenticated', obj);
    execute format('grant execute on function %s to service_role', obj);
  end loop;
end;
$$;

commit;

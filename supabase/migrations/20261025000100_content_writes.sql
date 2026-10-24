-- CS-057 / DB-3. Unapplied, additive; PGlite only in this issue.
begin;
alter table public.content_studio_operations add column mode text not null default 'legacy'
  check (mode in ('legacy','patch','queue','copy','import'));
-- Legacy entries cannot safely infer their original entry point; fail closed.
update public.content_studio_operations set mode = 'import' where target_kind = 'import';
create schema content_studio_private;
revoke all on schema content_studio_private from public, anon, authenticated;
grant usage on schema content_studio_private to service_role;
create or replace function content_studio_private.content_studio_mutate(
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
  if p_mode = 'patch' and p_data ? key_column then
    if p_data ->> key_column is distinct from p_target_id then
      raise exception 'cannot rename stable identity' using errcode = '22023';
    end if;
    p_data := p_data - key_column;
    if p_data = '{}' then p_data := jsonb_build_object(key_column, p_target_id); protected := array_remove(protected, key_column); end if;
  end if;
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
      if old_operation.mode <> p_mode or old_operation.patch_hash <> p_patch_hash or old_operation.target_kind <> p_target_kind
         or old_operation.target_id <> p_target_id or old_operation.actor_hash <> p_actor_hash then
        return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'steps',
          jsonb_build_array(jsonb_build_object('state','conflict','reason','operation_reused_with_different_patch')), 'revision', null);
      end if;
      return old_operation.result || jsonb_build_object('replayed', true);
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
      (operation_id,patch_hash,target_kind,target_id,actor_hash,result,mode)
      values (p_operation_id,p_patch_hash,p_target_kind,p_target_id,p_actor_hash,response,p_mode);
  end if;
  return response;
end;
$$;

create or replace function public.content_studio_apply_patch(
  p_operation_id text, p_patch_hash text, p_actor_hash text, p_target_kind text,
  p_target_id text, p_expected_version bigint, p_patch jsonb
) returns jsonb language sql security invoker
set search_path = pg_catalog, public, pg_temp
as $$ select content_studio_private.content_studio_mutate('patch', p_operation_id, p_patch_hash, p_actor_hash,
  p_target_kind, p_target_id, p_expected_version, p_patch); $$;

create or replace function public.content_studio_insert_queue_idea(
  p_operation_id text, p_patch_hash text, p_actor_hash text, p_library_id text, p_row jsonb
) returns jsonb language sql security invoker
set search_path = pg_catalog, public, pg_temp
as $$ select content_studio_private.content_studio_mutate('queue', p_operation_id, p_patch_hash, p_actor_hash,
  'queue', p_library_id, null, p_row); $$;

-- Caller supplies the version observed before reading the Sheet. Null asserts
-- absence. A stale copy is refused; retries replay without overwriting editors.
create or replace function public.content_studio_write_through(
  p_operation_id text, p_patch_hash text, p_actor_hash text, p_target_kind text,
  p_target_id text, p_expected_version bigint, p_row jsonb
) returns jsonb language sql security invoker
set search_path = pg_catalog, public, pg_temp
as $$ select content_studio_private.content_studio_mutate('copy', p_operation_id, p_patch_hash, p_actor_hash,
  p_target_kind, p_target_id, p_expected_version, p_row); $$;

-- Atomic typed upsert batch, not the Sheet reader/import scheduler (DB-4).
-- Each item: {target_kind,target_id,expected_version,row}. No deletion implied.
-- Counts/hashes/exception ledger are content-free run evidence supplied by the
-- importer. Expected versions prevent an older snapshot overwriting a new row.
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

drop function public.content_studio_mutate(text,text,text,text,text,text,bigint,jsonb);
revoke all on function content_studio_private.content_studio_mutate(text,text,text,text,text,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function content_studio_private.content_studio_mutate(text,text,text,text,text,text,bigint,jsonb) to service_role;
update public.content_studio_schema_version set version = 2, applied_at = now() where singleton;
commit;

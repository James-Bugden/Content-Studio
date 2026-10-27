-- Owner decision 2026-10-27: personal DB-only content store. No migration
-- evidence, activation epoch or calendar/backup waiver is a serving requirement.
-- Existing RPCs retain service-role grants, validation, CAS, ledger and audit.
begin;
create or replace function content_studio_private.content_studio_cutover_assert_write()
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  -- Keep the lock ordering used by the legacy import/activation operations.
  perform pg_advisory_xact_lock(198,2);
  if (select version from public.content_studio_schema_version where singleton) is distinct from 2 then
    raise exception 'unsupported content schema' using errcode='42501';
  end if;
end $$;
revoke all on function content_studio_private.content_studio_cutover_assert_write() from public,anon,authenticated;
grant execute on function content_studio_private.content_studio_cutover_assert_write() to service_role;

create or replace function public.content_studio_restore_markdown_link(
  p_operation_id text,p_patch_hash text,p_actor_hash text,p_library_id text,p_expected_version bigint,p_url text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare r public.content_studio_posts; result jsonb;
begin
  perform content_studio_private.content_studio_cutover_assert_write();
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

commit;

-- DB-7 preparation only. Never applied live by this change.
begin;

create table public.content_studio_markdown_export (
  library_id text primary key,
  row_version bigint not null,
  expected_body text not null,
  body text not null,
  queued_at timestamptz not null default now()
);
alter table public.content_studio_markdown_export enable row level security;
alter table public.content_studio_markdown_export force row level security;
revoke all on public.content_studio_markdown_export from public, anon, authenticated;
grant select, insert, update, delete on public.content_studio_markdown_export to service_role;

-- Wrap the existing single atomic patch: outbox failure rolls the patch,
-- history, audit and ledger back too. Import/write-through never enqueue.
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
    if before_row.draft_content is distinct from after_row.draft_content
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
revoke all on function public.content_studio_apply_patch(text,text,text,text,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.content_studio_apply_patch(text,text,text,text,text,bigint,jsonb) to service_role;

-- Completion cannot drop a newer queued save. Its baseline advances only from
-- the exact previous baseline; duplicate/stale completions cannot move it back.
create function public.content_studio_complete_markdown_export(
  p_library_id text, p_version bigint, p_expected_body text, p_body text
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('content_studio_authority', 0));
  delete from public.content_studio_markdown_export where library_id=p_library_id
    and row_version=p_version and expected_body=p_expected_body and body=p_body;
  update public.content_studio_markdown_export set expected_body=p_body
    where library_id=p_library_id and row_version>p_version and expected_body=p_expected_body;
  return jsonb_build_object('ok',true,'code',null,'steps',jsonb_build_array(jsonb_build_object('state','applied')),'revision',p_version);
end;
$$;
revoke all on function public.content_studio_complete_markdown_export(text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.content_studio_complete_markdown_export(text,bigint,text,text) to service_role;
commit;

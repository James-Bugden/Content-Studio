-- CS-025. Server-only bridge between Content Studio's existing Google/Auth.js
-- session and the Reply store.
--
-- Reply originally used Supabase Auth, so its atomic functions derive ownership
-- from auth.uid(). The combined app deliberately has one browser login (Google
-- through Auth.js) and calls Supabase only from authenticated server routes. These
-- wrappers are therefore callable only by service_role, validate the requested
-- owner against private.app_owner, install that owner as the transaction-local
-- JWT subject, and delegate to the original atomic functions.

grant usage on schema private to service_role;
grant usage on schema extensions to service_role;
grant select on table private.app_owner to service_role;

-- Least-privilege table grants for the exact Reply operations used by the
-- combined server. No Content read-model table, import table or DELETE grant is
-- included.
grant select, insert, update on table
  public.app_settings,
  public.embedding_jobs,
  public.facts,
  public.generation_runs,
  public.mutation_keys,
  public.reply_library,
  public.reply_revisions,
  public.reply_sessions,
  public.reply_suggestions,
  public.resources,
  public.search_documents,
  public.source_posts
to service_role;

grant execute on function public.record_reply(uuid, text, uuid, integer, text, text, text, text, timestamptz, jsonb, text) to service_role;
grant execute on function public.record_manual_reply(uuid, text, public.platform, text, text, text, public.date_precision, timestamptz, date, text, text, text, text, text, text) to service_role;
grant execute on function public.correct_reply(uuid, integer, text, text, text, text, text) to service_role;
grant execute on function public.set_reply_withdrawn(uuid, boolean) to service_role;
grant execute on function public.daily_counts(text, date) to service_role;
grant execute on function public.search_reply_candidates_fulltext(text, integer, uuid, text[], text[], boolean, boolean) to service_role;
grant execute on function public.search_reply_candidates_trigram(text, text[], integer, double precision, uuid, text[], text[], boolean, boolean) to service_role;

create or replace function public.server_owner_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if current_user <> 'service_role' then
    raise exception 'server credential required' using errcode = 'SR401';
  end if;

  select o.user_id into v_owner
  from private.app_owner o
  where o.enabled;

  if v_owner is null then
    raise exception 'enabled owner not configured' using errcode = 'SR401';
  end if;

  return v_owner;
end;
$$;

create or replace function public.server_record_reply(
  p_owner_id uuid,
  p_operation_key uuid,
  p_fingerprint text,
  p_session_id uuid,
  p_editor_version integer,
  p_final_text text,
  p_content_hash text,
  p_search_text text,
  p_reply_url text default null,
  p_posted_at timestamptz default null,
  p_resource_snapshots jsonb default '[]'::jsonb,
  p_embedding_model text default 'unconfigured'
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role'
     or not exists (
       select 1 from private.app_owner o
       where o.user_id = p_owner_id and o.enabled
     ) then
    raise exception 'server owner mismatch' using errcode = 'SR401';
  end if;

  perform set_config('request.jwt.claim.sub', p_owner_id::text, true);
  return public.record_reply(
    p_operation_key, p_fingerprint, p_session_id, p_editor_version,
    p_final_text, p_content_hash, p_search_text, p_reply_url, p_posted_at,
    p_resource_snapshots, p_embedding_model
  );
end;
$$;

create or replace function public.server_record_manual_reply(
  p_owner_id uuid,
  p_operation_key uuid,
  p_fingerprint text,
  p_platform public.platform,
  p_final_text text,
  p_content_hash text,
  p_search_text text,
  p_date_precision public.date_precision,
  p_posted_at timestamptz default null,
  p_posted_date date default null,
  p_source_timezone text default null,
  p_source_text text default null,
  p_parent_text text default null,
  p_source_url text default null,
  p_reply_url text default null,
  p_embedding_model text default 'unconfigured'
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role'
     or not exists (
       select 1 from private.app_owner o
       where o.user_id = p_owner_id and o.enabled
     ) then
    raise exception 'server owner mismatch' using errcode = 'SR401';
  end if;

  perform set_config('request.jwt.claim.sub', p_owner_id::text, true);
  return public.record_manual_reply(
    p_operation_key, p_fingerprint, p_platform, p_final_text, p_content_hash,
    p_search_text, p_date_precision, p_posted_at, p_posted_date,
    p_source_timezone, p_source_text, p_parent_text, p_source_url, p_reply_url,
    p_embedding_model
  );
end;
$$;

create or replace function public.server_correct_reply(
  p_owner_id uuid,
  p_reply_id uuid,
  p_expected_revision integer,
  p_final_text text,
  p_content_hash text,
  p_search_text text,
  p_reason text default '',
  p_embedding_model text default 'unconfigured'
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role'
     or not exists (
       select 1 from private.app_owner o
       where o.user_id = p_owner_id and o.enabled
     ) then
    raise exception 'server owner mismatch' using errcode = 'SR401';
  end if;

  perform set_config('request.jwt.claim.sub', p_owner_id::text, true);
  return public.correct_reply(
    p_reply_id, p_expected_revision, p_final_text, p_content_hash,
    p_search_text, p_reason, p_embedding_model
  );
end;
$$;

create or replace function public.server_set_reply_withdrawn(
  p_owner_id uuid,
  p_reply_id uuid,
  p_withdrawn boolean
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role'
     or not exists (
       select 1 from private.app_owner o
       where o.user_id = p_owner_id and o.enabled
     ) then
    raise exception 'server owner mismatch' using errcode = 'SR401';
  end if;

  perform set_config('request.jwt.claim.sub', p_owner_id::text, true);
  return public.set_reply_withdrawn(p_reply_id, p_withdrawn);
end;
$$;

create or replace function public.server_daily_counts(
  p_owner_id uuid,
  p_timezone text default 'Asia/Taipei',
  p_local_day date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role'
     or not exists (
       select 1 from private.app_owner o
       where o.user_id = p_owner_id and o.enabled
     ) then
    raise exception 'server owner mismatch' using errcode = 'SR401';
  end if;

  perform set_config('request.jwt.claim.sub', p_owner_id::text, true);
  return public.daily_counts(p_timezone, p_local_day);
end;
$$;

revoke all on function public.server_owner_id() from public, anon, authenticated;
revoke all on function public.server_record_reply(uuid, uuid, text, uuid, integer, text, text, text, text, timestamptz, jsonb, text) from public, anon, authenticated;
revoke all on function public.server_record_manual_reply(uuid, uuid, text, public.platform, text, text, text, public.date_precision, timestamptz, date, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.server_correct_reply(uuid, uuid, integer, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.server_set_reply_withdrawn(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.server_daily_counts(uuid, text, date) from public, anon, authenticated;

grant execute on function public.server_owner_id() to service_role;
grant execute on function public.server_record_reply(uuid, uuid, text, uuid, integer, text, text, text, text, timestamptz, jsonb, text) to service_role;
grant execute on function public.server_record_manual_reply(uuid, uuid, text, public.platform, text, text, text, public.date_precision, timestamptz, date, text, text, text, text, text, text) to service_role;
grant execute on function public.server_correct_reply(uuid, uuid, integer, text, text, text, text, text) to service_role;
grant execute on function public.server_set_reply_withdrawn(uuid, uuid, boolean) to service_role;
grant execute on function public.server_daily_counts(uuid, text, date) to service_role;

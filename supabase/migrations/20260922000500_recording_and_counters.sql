-- SR-004 (#5) and SR-017 (#18). The atomic recording contract from C09.
--
-- All four functions are SECURITY INVOKER on purpose: they run with the caller's
-- row-level security, so a forged user_id fails inside the function exactly as it
-- would fail from a direct table write. Nothing here uses a service-role bypass.
--
-- Error signalling uses a user-defined SQLSTATE class so the API layer can map an
-- outcome to a status code without parsing message text:
--   SR401 unauthenticated
--   SR404 not found or not owned
--   SR409 version, idempotency or correction conflict

-- ---------------------------------------------------------------------------
-- record_reply: the Mark posted transaction.
-- ---------------------------------------------------------------------------

create or replace function public.record_reply(
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
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_claimed uuid;
  v_existing public.mutation_keys;
  v_session public.reply_sessions;
  v_existing_reply public.reply_library;
  v_reply public.reply_library;
  v_posted_at timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'SR401';
  end if;

  -- Claim the operation key first. A concurrent duplicate blocks here until the
  -- first attempt commits, then takes the replay path below rather than inserting
  -- a second event.
  insert into public.mutation_keys (user_id, key, request_fingerprint, operation)
  values (v_user, p_operation_key, p_fingerprint, 'record_reply')
  on conflict (user_id, key) do nothing
  returning key into v_claimed;

  if v_claimed is null then
    select * into v_existing
    from public.mutation_keys
    where user_id = v_user and key = p_operation_key;

    if not found then
      -- The conflicting row belongs to a different owner. Do not disclose that.
      raise exception 'operation key unavailable' using errcode = 'SR409';
    end if;

    if v_existing.request_fingerprint is distinct from p_fingerprint then
      raise exception 'operation key reused with a different payload' using errcode = 'SR409';
    end if;

    select * into v_existing_reply
    from public.reply_library
    where user_id = v_user and id = v_existing.result_id;

    return jsonb_build_object(
      'reply_id', v_existing.result_id,
      'replayed', true,
      'recorded_at', v_existing_reply.recorded_at,
      'embedding_status', 'queued'
    );
  end if;

  select * into v_session
  from public.reply_sessions
  where user_id = v_user and id = p_session_id
  for update;

  if not found then
    raise exception 'session not found' using errcode = 'SR404';
  end if;

  -- A session that is already recorded never gains a second event, whatever key
  -- arrives. Identical text replays; different text is a correction, which is an
  -- explicit separate operation.
  if v_session.state = 'recorded' then
    select * into v_existing_reply
    from public.reply_library
    where user_id = v_user and session_id = p_session_id;

    if found and v_existing_reply.content_hash = p_content_hash then
      update public.mutation_keys
      set result_id = v_existing_reply.id
      where user_id = v_user and key = p_operation_key;

      return jsonb_build_object(
        'reply_id', v_existing_reply.id,
        'replayed', true,
        'recorded_at', v_existing_reply.recorded_at,
        'embedding_status', 'queued'
      );
    end if;

    raise exception 'session already recorded with different text' using errcode = 'SR409';
  end if;

  if v_session.state = 'discarded' then
    raise exception 'session was discarded' using errcode = 'SR409';
  end if;

  if v_session.editor_version <> p_editor_version then
    raise exception 'editor version is stale' using errcode = 'SR409';
  end if;

  -- Mark posted defaults to the confirmation time. It never invents a past time,
  -- and it never leaves the date unknown: the owner just attested to posting it.
  v_posted_at := coalesce(p_posted_at, now());

  insert into public.reply_library (
    user_id, source_post_id, session_id, platform,
    final_text, search_text,
    provenance, publication_evidence,
    posted_at, posted_date, date_precision, source_timezone,
    reply_url, content_hash, resource_snapshots
  )
  values (
    v_user, v_session.source_post_id, p_session_id, v_session.platform,
    p_final_text, p_search_text,
    'posted_confirmed', 'user_confirmed',
    v_posted_at, null, 'timestamp', null,
    p_reply_url, p_content_hash, coalesce(p_resource_snapshots, '[]'::jsonb)
  )
  returning * into v_reply;

  update public.reply_sessions
  set state = 'recorded'
  where user_id = v_user and id = p_session_id;

  insert into public.search_documents (user_id, entity_kind, entity_id, text_hash, search_text)
  values (v_user, 'reply', v_reply.id, p_content_hash, p_search_text)
  on conflict (user_id, entity_kind, entity_id)
  do update set text_hash = excluded.text_hash, search_text = excluded.search_text;

  insert into public.embedding_jobs (user_id, entity_kind, entity_id, text_hash, model)
  values (v_user, 'reply', v_reply.id, p_content_hash, p_embedding_model)
  on conflict (user_id, entity_kind, entity_id, text_hash, model) do nothing;

  update public.mutation_keys
  set result_id = v_reply.id
  where user_id = v_user and key = p_operation_key;

  return jsonb_build_object(
    'reply_id', v_reply.id,
    'replayed', false,
    'recorded_at', v_reply.recorded_at,
    'embedding_status', 'queued'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- record_manual_reply: Add past reply, and replies written outside the app.
-- ---------------------------------------------------------------------------

create or replace function public.record_manual_reply(
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
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_claimed uuid;
  v_existing public.mutation_keys;
  v_existing_reply public.reply_library;
  v_source_id uuid;
  v_reply public.reply_library;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'SR401';
  end if;

  insert into public.mutation_keys (user_id, key, request_fingerprint, operation)
  values (v_user, p_operation_key, p_fingerprint, 'record_manual_reply')
  on conflict (user_id, key) do nothing
  returning key into v_claimed;

  if v_claimed is null then
    select * into v_existing
    from public.mutation_keys
    where user_id = v_user and key = p_operation_key;

    if not found then
      raise exception 'operation key unavailable' using errcode = 'SR409';
    end if;

    if v_existing.request_fingerprint is distinct from p_fingerprint then
      raise exception 'operation key reused with a different payload' using errcode = 'SR409';
    end if;

    select * into v_existing_reply
    from public.reply_library
    where user_id = v_user and id = v_existing.result_id;

    return jsonb_build_object(
      'reply_id', v_existing.result_id,
      'replayed', true,
      'recorded_at', v_existing_reply.recorded_at,
      'embedding_status', 'queued'
    );
  end if;

  if p_source_text is not null then
    insert into public.source_posts (user_id, platform, target_kind, source_text, parent_text, source_url, from_import)
    values (v_user, p_platform, 'post', p_source_text, p_parent_text, p_source_url, true)
    returning id into v_source_id;
  end if;

  insert into public.reply_library (
    user_id, source_post_id, session_id, platform,
    final_text, search_text,
    provenance, publication_evidence,
    posted_at, posted_date, date_precision, source_timezone,
    reply_url, content_hash
  )
  values (
    v_user, v_source_id, null, p_platform,
    p_final_text, p_search_text,
    'posted_confirmed', 'user_confirmed',
    p_posted_at, p_posted_date, p_date_precision, p_source_timezone,
    p_reply_url, p_content_hash
  )
  returning * into v_reply;

  insert into public.search_documents (user_id, entity_kind, entity_id, text_hash, search_text)
  values (v_user, 'reply', v_reply.id, p_content_hash, p_search_text)
  on conflict (user_id, entity_kind, entity_id)
  do update set text_hash = excluded.text_hash, search_text = excluded.search_text;

  insert into public.embedding_jobs (user_id, entity_kind, entity_id, text_hash, model)
  values (v_user, 'reply', v_reply.id, p_content_hash, p_embedding_model)
  on conflict (user_id, entity_kind, entity_id, text_hash, model) do nothing;

  update public.mutation_keys
  set result_id = v_reply.id
  where user_id = v_user and key = p_operation_key;

  return jsonb_build_object(
    'reply_id', v_reply.id,
    'replayed', false,
    'recorded_at', v_reply.recorded_at,
    'embedding_status', 'queued'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- correct_reply: an explicit correction. It appends a private revision and
-- reindexes. It does not create a second reply event, so counts do not move.
-- ---------------------------------------------------------------------------

create or replace function public.correct_reply(
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
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_reply public.reply_library;
  v_next integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'SR401';
  end if;

  select * into v_reply
  from public.reply_library
  where user_id = v_user and id = p_reply_id
  for update;

  if not found then
    raise exception 'reply not found' using errcode = 'SR404';
  end if;

  if v_reply.revision <> p_expected_revision then
    raise exception 'reply revision is stale' using errcode = 'SR409';
  end if;

  v_next := v_reply.revision + 1;

  -- The revision stores the text as it was before this correction, so the audit
  -- trail reads forwards from the original.
  insert into public.reply_revisions (user_id, reply_id, revision_number, text, reason)
  values (v_user, p_reply_id, v_next, v_reply.final_text, coalesce(p_reason, ''));

  update public.reply_library
  set final_text = p_final_text,
      search_text = p_search_text,
      content_hash = p_content_hash,
      revision = v_next
  where user_id = v_user and id = p_reply_id;

  update public.search_documents
  set text_hash = p_content_hash,
      search_text = p_search_text,
      embedded_at = null
  where user_id = v_user and entity_kind = 'reply' and entity_id = p_reply_id;

  insert into public.embedding_jobs (user_id, entity_kind, entity_id, text_hash, model)
  values (v_user, 'reply', p_reply_id, p_content_hash, p_embedding_model)
  on conflict (user_id, entity_kind, entity_id, text_hash, model) do nothing;

  return jsonb_build_object('reply_id', p_reply_id, 'revision', v_next);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_reply_withdrawn: Undo recorded status.
--
-- This reverses the application's record. It cannot and does not touch the reply
-- that exists on the social platform.
-- ---------------------------------------------------------------------------

create or replace function public.set_reply_withdrawn(
  p_reply_id uuid,
  p_withdrawn boolean
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_updated integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'SR401';
  end if;

  update public.reply_library
  set withdrawn_at = case when p_withdrawn then now() else null end
  where user_id = v_user and id = p_reply_id;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'reply not found' using errcode = 'SR404';
  end if;

  return jsonb_build_object('reply_id', p_reply_id, 'withdrawn', p_withdrawn);
end;
$$;

-- ---------------------------------------------------------------------------
-- daily_counts: derived, never an incremented integer.
--
-- A record counts only when its local day in the counting timezone is *proven*:
--   * date_precision = 'timestamp'  -> convert the instant into the timezone;
--   * date_precision = 'date_only'  -> count only when the record's own source
--     timezone is the counting timezone, because otherwise the Taipei day is a
--     guess dressed as a fact;
--   * date_precision = 'unknown'    -> never counts.
-- Drafts, main posts, AI drafts, copies and withdrawn records never count.
-- ---------------------------------------------------------------------------

create or replace function public.daily_counts(
  p_timezone text default 'Asia/Taipei',
  p_local_day date default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_day date;
  v_counts jsonb;
  v_targets public.app_settings;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'SR401';
  end if;

  v_day := coalesce(p_local_day, (now() at time zone p_timezone)::date);

  select jsonb_object_agg(platform, n) into v_counts
  from (
    select r.platform::text as platform, count(*)::int as n
    from public.reply_library r
    where r.user_id = v_user
      and r.provenance = 'posted_confirmed'
      and r.withdrawn_at is null
      and (
        (r.date_precision = 'timestamp' and (r.posted_at at time zone p_timezone)::date = v_day)
        or (r.date_precision = 'date_only' and r.posted_date = v_day and r.source_timezone = p_timezone)
      )
    group by r.platform
  ) counted;

  select * into v_targets from public.app_settings where user_id = v_user;

  return jsonb_build_object(
    'local_day', v_day,
    'timezone', p_timezone,
    'counts', jsonb_build_object(
      'linkedin', coalesce((v_counts ->> 'linkedin')::int, 0),
      'x', coalesce((v_counts ->> 'x')::int, 0),
      'threads', coalesce((v_counts ->> 'threads')::int, 0)
    ),
    'targets', jsonb_build_object(
      'linkedin', coalesce(v_targets.target_linkedin, 10),
      'x', coalesce(v_targets.target_x, 10),
      'threads', coalesce(v_targets.target_threads, 10)
    )
  );
end;
$$;

-- Only the authenticated owner session may call these.
--
-- Both revokes are required. A hosted Supabase project's default privileges grant
-- EXECUTE on new public functions directly to `anon`, and a direct grant is not
-- removed by revoking from PUBLIC. A test asserts no anon-executable function
-- remains, so a function added later without this cannot pass unnoticed.
revoke all on function public.record_reply(uuid, text, uuid, integer, text, text, text, text, timestamptz, jsonb, text) from public;
revoke all on function public.record_manual_reply(uuid, text, public.platform, text, text, text, public.date_precision, timestamptz, date, text, text, text, text, text, text) from public;
revoke all on function public.correct_reply(uuid, integer, text, text, text, text, text) from public;
revoke all on function public.set_reply_withdrawn(uuid, boolean) from public;
revoke all on function public.daily_counts(text, date) from public;

revoke all on function public.record_reply(uuid, text, uuid, integer, text, text, text, text, timestamptz, jsonb, text) from anon;
revoke all on function public.record_manual_reply(uuid, text, public.platform, text, text, text, public.date_precision, timestamptz, date, text, text, text, text, text, text) from anon;
revoke all on function public.correct_reply(uuid, integer, text, text, text, text, text) from anon;
revoke all on function public.set_reply_withdrawn(uuid, boolean) from anon;
revoke all on function public.daily_counts(text, date) from anon;

grant execute on function public.record_reply(uuid, text, uuid, integer, text, text, text, text, timestamptz, jsonb, text) to authenticated;
grant execute on function public.record_manual_reply(uuid, text, public.platform, text, text, text, public.date_precision, timestamptz, date, text, text, text, text, text, text) to authenticated;
grant execute on function public.correct_reply(uuid, integer, text, text, text, text, text) to authenticated;
grant execute on function public.set_reply_withdrawn(uuid, boolean) to authenticated;
grant execute on function public.daily_counts(text, date) to authenticated;


-- SR-004 (#5). The C03 schema contract.
--
-- Rules applied uniformly below:
--   * every user-owned row carries a non-null `user_id`;
--   * every parent has `unique (user_id, id)` so children can reference it with a
--     composite foreign key, which makes a cross-owner parent reference impossible
--     rather than merely unlikely;
--   * exact text and normalised search text are separate columns, always;
--   * unknown dates stay null. Nothing defaults an unknown date to now().

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- app_settings
-- ---------------------------------------------------------------------------

create table public.app_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  target_linkedin integer not null default 10 check (target_linkedin between 0 and 100),
  target_x integer not null default 10 check (target_x between 0 and 100),
  target_threads integer not null default 10 check (target_threads between 0 and 100),
  timezone text not null default 'Asia/Taipei' check (length(timezone) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger app_settings_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- source_posts
-- ---------------------------------------------------------------------------

create table public.source_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform public.platform not null,
  target_kind public.target_kind not null,
  source_text text,
  parent_text text,
  source_url text,
  detected_language text check (detected_language is null or length(detected_language) between 2 and 16),
  -- C03: source_text may be null only for imported or manually captured records
  -- whose original context is genuinely unavailable. An in-app target must have text.
  from_import boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_posts_owner_key unique (user_id, id),
  constraint source_posts_text_present check (source_text is not null or from_import),
  constraint source_posts_text_nonblank check (source_text is null or btrim(source_text) <> ''),
  constraint source_posts_text_bounded check (source_text is null or length(source_text) <= 16000),
  constraint source_posts_parent_bounded check (parent_text is null or length(parent_text) <= 8000),
  constraint source_posts_url_shape check (source_url is null or source_url ~ '^https://[^\s/]+')
);

create trigger source_posts_updated_at
before update on public.source_posts
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- resources
-- ---------------------------------------------------------------------------

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type public.resource_type not null,
  ownership public.resource_ownership not null,
  title_en text not null check (btrim(title_en) <> '' and length(title_en) <= 300),
  title_zh_tw text check (title_zh_tw is null or btrim(title_zh_tw) <> ''),
  description text not null default '' check (length(description) <= 2000),
  aliases text[] not null default '{}',
  tags text[] not null default '{}',
  canonical_path text,
  zh_tw_path text,
  external_url text,
  cta_en text check (cta_en is null or length(cta_en) <= 300),
  cta_zh_tw text check (cta_zh_tw is null or length(cta_zh_tw) <= 300),
  allowed_platforms public.platform[] not null default '{linkedin,x,threads}',
  access_notes text,
  active boolean not null default true,
  verified boolean not null default false,
  last_checked_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resources_owner_key unique (user_id, id),
  -- An owned resource is a path resolved against RESOURCE_BASE_URL at read time,
  -- never a stored absolute URL: the resource origin can move without rewriting rows.
  constraint resources_own_uses_path check (
    ownership <> 'own' or (canonical_path is not null and external_url is null)
  ),
  -- A book is either an approved external URL or a text-only recommendation.
  constraint resources_book_has_no_own_path check (
    ownership <> 'book' or (canonical_path is null and zh_tw_path is null)
  ),
  -- Path shape: rooted, single-slash, no backslash ambiguity, no scheme smuggled in.
  constraint resources_canonical_path_shape check (
    canonical_path is null
    or (canonical_path ~ '^/[^/\\]' and canonical_path !~ '\\' and canonical_path !~ ':')
  ),
  constraint resources_zh_path_shape check (
    zh_tw_path is null
    or (zh_tw_path ~ '^/[^/\\]' and zh_tw_path !~ '\\' and zh_tw_path !~ ':')
  ),
  -- External URL shape: https only, no embedded credentials, no javascript/data URL.
  constraint resources_external_url_shape check (
    external_url is null
    or (external_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/|$)' and external_url !~ '@')
  ),
  constraint resources_allowed_platforms_nonempty check (array_length(allowed_platforms, 1) >= 1)
);

create trigger resources_updated_at
before update on public.resources
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- facts
-- ---------------------------------------------------------------------------

create table public.facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  fact_text text not null check (btrim(fact_text) <> '' and length(fact_text) <= 2000),
  tags text[] not null default '{}',
  source_reference jsonb not null default '{}'::jsonb,
  -- Four independent gates. Importing an anecdote sets none of them.
  approved boolean not null default false,
  sensitivity public.fact_sensitivity not null default 'private_context_only',
  active boolean not null default true,
  valid_from date,
  valid_to date,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facts_owner_key unique (user_id, id),
  constraint facts_validity_ordered check (valid_from is null or valid_to is null or valid_from <= valid_to)
);

create trigger facts_updated_at
before update on public.facts
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- reply_sessions
-- ---------------------------------------------------------------------------

create table public.reply_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_post_id uuid,
  platform public.platform not null,
  source_version integer not null default 1 check (source_version >= 1),
  editor_version integer not null default 0 check (editor_version >= 0),
  draft_text text not null default '',
  draft_hash text not null,
  state public.session_state not null default 'draft',
  last_copied_hash text,
  english_meaning text,
  meaning_source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reply_sessions_owner_key unique (user_id, id),
  constraint reply_sessions_source_fk
    foreign key (user_id, source_post_id) references public.source_posts (user_id, id) on delete set null,
  constraint reply_sessions_draft_bounded check (length(draft_text) <= 16000),
  -- A meaning without the hash it was derived from cannot be checked for staleness.
  constraint reply_sessions_meaning_paired check (
    (english_meaning is null and meaning_source_hash is null)
    or (english_meaning is not null and meaning_source_hash is not null)
  )
);

create trigger reply_sessions_updated_at
before update on public.reply_sessions
for each row execute function public.set_updated_at();

-- editor_version is monotonic. A client that replays an old version cannot wind it
-- back, which is what makes optimistic concurrency meaningful rather than advisory.
create or replace function public.enforce_monotonic_editor_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.editor_version < old.editor_version then
    raise exception 'editor_version cannot decrease (% -> %)', old.editor_version, new.editor_version
      using errcode = '23514';
  end if;
  if new.source_version < old.source_version then
    raise exception 'source_version cannot decrease (% -> %)', old.source_version, new.source_version
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger reply_sessions_monotonic_versions
before update on public.reply_sessions
for each row execute function public.enforce_monotonic_editor_version();

-- ---------------------------------------------------------------------------
-- generation_runs and reply_suggestions
-- ---------------------------------------------------------------------------

create table public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  source_version integer not null,
  editor_base_version integer not null,
  request_key text not null check (btrim(request_key) <> '' and length(request_key) <= 128),
  context_version integer not null,
  prompt_version text not null,
  provider text not null,
  model text not null,
  status public.generation_status not null default 'pending',
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  constraint generation_runs_owner_key unique (user_id, id),
  constraint generation_runs_session_fk
    foreign key (user_id, session_id) references public.reply_sessions (user_id, id) on delete cascade,
  constraint generation_runs_request_key_unique unique (user_id, session_id, request_key)
);
-- There is deliberately no column for a raw prompt or a raw provider response (C08).

create table public.reply_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  generation_run_id uuid not null,
  position integer not null check (position between 0 and 2),
  angle_label text not null check (btrim(angle_label) <> '' and length(angle_label) <= 80),
  reply_text text not null check (btrim(reply_text) <> '' and length(reply_text) <= 16000),
  english_meaning text,
  resource_id uuid,
  cta_text text,
  fact_ids uuid[] not null default '{}',
  based_on_reply_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint reply_suggestions_owner_key unique (user_id, id),
  constraint reply_suggestions_run_fk
    foreign key (user_id, generation_run_id) references public.generation_runs (user_id, id) on delete cascade,
  constraint reply_suggestions_resource_fk
    foreign key (user_id, resource_id) references public.resources (user_id, id) on delete set null,
  constraint reply_suggestions_position_unique unique (user_id, generation_run_id, position),
  constraint reply_suggestions_cta_needs_resource check (cta_text is null or resource_id is not null)
);

-- ---------------------------------------------------------------------------
-- reply_library
--
-- Named for what it holds. It contains confirmed replies, user-edited drafts,
-- published main posts and AI drafts, each labelled. Calling it posted_replies
-- would make every read of it a small lie.
-- ---------------------------------------------------------------------------

create table public.reply_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_post_id uuid,
  session_id uuid,
  platform public.platform not null,
  final_text text not null,
  search_text text not null,
  provenance public.provenance not null,
  publication_evidence public.publication_evidence not null,
  posted_at timestamptz,
  posted_date date,
  date_precision public.date_precision not null,
  source_timezone text,
  native_reply_id text,
  reply_url text,
  recorded_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  content_hash text not null,
  resource_snapshots jsonb not null default '[]'::jsonb,
  suggestion_id uuid,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reply_library_owner_key unique (user_id, id),
  constraint reply_library_source_fk
    foreign key (user_id, source_post_id) references public.source_posts (user_id, id) on delete set null,
  constraint reply_library_session_fk
    foreign key (user_id, session_id) references public.reply_sessions (user_id, id) on delete set null,
  constraint reply_library_suggestion_fk
    foreign key (user_id, suggestion_id) references public.reply_suggestions (user_id, id) on delete set null,
  -- A database check may reject all-whitespace. It must never rewrite text (C09).
  constraint reply_library_text_nonblank check (btrim(final_text) <> ''),
  constraint reply_library_text_bounded check (length(final_text) <= 16000),
  -- Date precision and the date columns cannot disagree.
  constraint reply_library_precision_consistent check (
    (date_precision = 'timestamp' and posted_at is not null)
    or (date_precision = 'date_only' and posted_date is not null and posted_at is null)
    or (date_precision = 'unknown' and posted_at is null and posted_date is null)
  ),
  constraint reply_library_snapshots_is_array check (jsonb_typeof(resource_snapshots) = 'array'),
  constraint reply_library_url_shape check (reply_url is null or reply_url ~ '^https://[^\s/]+')
);

create trigger reply_library_updated_at
before update on public.reply_library
for each row execute function public.set_updated_at();

-- One recorded reply per session. A second operation key for a session that is
-- already recorded cannot insert a second event (C09).
create unique index reply_library_one_per_session
  on public.reply_library (user_id, session_id)
  where session_id is not null;

-- Strong platform identity, when the source supplied one.
create unique index reply_library_native_identity
  on public.reply_library (user_id, platform, native_reply_id)
  where native_reply_id is not null;

create unique index reply_library_canonical_url
  on public.reply_library (user_id, reply_url)
  where reply_url is not null;

-- Deliberately NOT unique: identical wording on two different target posts is two
-- legitimate events (IMP-02).
create index reply_library_content_hash on public.reply_library (user_id, content_hash);

create table public.reply_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reply_id uuid not null,
  revision_number integer not null check (revision_number >= 1),
  text text not null,
  reason text not null default '',
  recorded_at timestamptz not null default now(),
  constraint reply_revisions_owner_key unique (user_id, id),
  constraint reply_revisions_reply_fk
    foreign key (user_id, reply_id) references public.reply_library (user_id, id) on delete cascade,
  constraint reply_revisions_number_unique unique (user_id, reply_id, revision_number)
);

-- ---------------------------------------------------------------------------
-- imports
-- ---------------------------------------------------------------------------

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_type public.import_source_type not null,
  source_file_hash text not null,
  adapter_version text not null,
  status public.import_status not null default 'open',
  checkpoint jsonb not null default '{}'::jsonb,
  count_seen integer not null default 0 check (count_seen >= 0),
  count_imported integer not null default 0 check (count_imported >= 0),
  count_duplicate integer not null default 0 check (count_duplicate >= 0),
  count_needs_review integer not null default 0 check (count_needs_review >= 0),
  count_invalid integer not null default 0 check (count_invalid >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_batches_owner_key unique (user_id, id)
);
-- The private filename or locator is never stored here; only its hash.

create trigger import_batches_updated_at
before update on public.import_batches
for each row execute function public.set_updated_at();

create table public.import_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid not null,
  source_locator text not null,
  source_hash text not null,
  disposition public.import_disposition not null,
  reply_id uuid,
  warning_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint import_items_owner_key unique (user_id, id),
  constraint import_items_batch_fk
    foreign key (user_id, batch_id) references public.import_batches (user_id, id) on delete cascade,
  constraint import_items_reply_fk
    foreign key (user_id, reply_id) references public.reply_library (user_id, id) on delete set null,
  -- Rerunning a batch cannot process the same source record twice.
  constraint import_items_identity_unique unique (user_id, batch_id, source_locator)
);

-- ---------------------------------------------------------------------------
-- search index and embedding outbox
-- ---------------------------------------------------------------------------

create table public.search_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entity_kind public.search_entity_kind not null,
  entity_id uuid not null,
  text_hash text not null,
  search_text text not null,
  embedding_model text,
  embedding_version integer,
  embedded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint search_documents_owner_key unique (user_id, id),
  constraint search_documents_entity_unique unique (user_id, entity_kind, entity_id)
);
-- The `embedding` column is added by the pgvector migration, which is optional.

create trigger search_documents_updated_at
before update on public.search_documents
for each row execute function public.set_updated_at();

create table public.embedding_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entity_kind public.search_entity_kind not null,
  entity_id uuid not null,
  text_hash text not null,
  model text not null,
  status public.embedding_job_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint embedding_jobs_owner_key unique (user_id, id),
  constraint embedding_jobs_identity_unique unique (user_id, entity_kind, entity_id, text_hash, model)
);

create trigger embedding_jobs_updated_at
before update on public.embedding_jobs
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- mutation_keys
--
-- The idempotency ledger. The key is a stable operation UUID chosen by the client
-- before the first attempt; the fingerprint is derived from the submitted payload.
-- Same key + same fingerprint replays. Same key + different fingerprint conflicts.
-- ---------------------------------------------------------------------------

create table public.mutation_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  key uuid not null,
  request_fingerprint text not null,
  operation text not null,
  result_id uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------------------------------------------------------------------------
-- Trigger functions are not API. Revoke them explicitly.
--
-- Supabase's default privileges grant EXECUTE on new public functions to anon
-- and authenticated, which would leave these two callable over the REST API.
-- Trigger firing is unaffected: EXECUTE on a trigger function is checked when
-- the trigger is created, not each time it runs. A test asserts that no public
-- function is anon-executable, so this cannot silently regress.
-- ---------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.enforce_monotonic_editor_version() from public, anon, authenticated;


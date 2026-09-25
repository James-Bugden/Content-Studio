-- SR-004 (#5). Row level security, grants and the indexes that make the owner
-- predicate cheap.
--
-- Every policy is the same pair of conditions: the row belongs to the caller AND
-- the caller is the one enabled owner. Both halves matter. `user_id = auth.uid()`
-- alone would let a second authenticated account build its own private universe
-- inside this database; `is_app_owner()` alone would not stop a forged user_id.
--
-- The policies are generated in a loop so that no table can be forgotten, and a
-- test asserts afterwards that every table in `public` actually carries them.

do $$
declare
  t text;
  owned_tables text[] := array[
    'app_settings',
    'source_posts',
    'resources',
    'facts',
    'reply_sessions',
    'generation_runs',
    'reply_suggestions',
    'reply_library',
    'reply_revisions',
    'import_batches',
    'import_items',
    'search_documents',
    'embedding_jobs',
    'mutation_keys'
  ];
begin
  foreach t in array owned_tables loop
    execute format('alter table public.%I enable row level security', t);
    -- FORCE also applies the policies to the table owner, so an accidental
    -- privileged connection does not quietly bypass them.
    execute format('alter table public.%I force row level security', t);

    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated', t);

    execute format($p$
      create policy %I on public.%I
      for select to authenticated
      using (user_id = (select auth.uid()) and private.is_app_owner())
    $p$, t || '_owner_select', t);

    execute format($p$
      create policy %I on public.%I
      for insert to authenticated
      with check (user_id = (select auth.uid()) and private.is_app_owner())
    $p$, t || '_owner_insert', t);

    execute format($p$
      create policy %I on public.%I
      for update to authenticated
      using (user_id = (select auth.uid()) and private.is_app_owner())
      with check (user_id = (select auth.uid()) and private.is_app_owner())
    $p$, t || '_owner_update', t);

    execute format($p$
      create policy %I on public.%I
      for delete to authenticated
      using (user_id = (select auth.uid()) and private.is_app_owner())
    $p$, t || '_owner_delete', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Daily counters read only non-withdrawn confirmed replies with a proven date.
create index reply_library_counter
  on public.reply_library (user_id, platform, posted_at)
  where provenance = 'posted_confirmed'
    and withdrawn_at is null
    and date_precision = 'timestamp';

create index reply_library_counter_date_only
  on public.reply_library (user_id, platform, posted_date)
  where provenance = 'posted_confirmed'
    and withdrawn_at is null
    and date_precision = 'date_only';

create index reply_library_recent
  on public.reply_library (user_id, recorded_at desc);

create index reply_library_provenance
  on public.reply_library (user_id, provenance);

-- English full-text search is one lexical signal.
create index search_documents_fts
  on public.search_documents
  using gin (to_tsvector('english', search_text));

-- Trigram search covers Chinese and short keywords, where English FTS stemming
-- does nothing useful.
create index search_documents_trgm
  on public.search_documents
  using gin (search_text extensions.gin_trgm_ops);

create index search_documents_entity
  on public.search_documents (user_id, entity_kind, entity_id);

create index embedding_jobs_claimable
  on public.embedding_jobs (status, next_attempt_at)
  where status in ('pending', 'retry');

create index resources_active
  on public.resources (user_id, active, verified);

create index facts_eligible
  on public.facts (user_id, approved, active, sensitivity);

create index import_items_batch
  on public.import_items (user_id, batch_id, disposition);

create index reply_sessions_state
  on public.reply_sessions (user_id, state, updated_at desc);

create index generation_runs_session
  on public.generation_runs (user_id, session_id, created_at desc);


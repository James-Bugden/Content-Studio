-- SR-009 (#10). The lexical candidate queries, as callable functions.
--
-- Why these live in SQL rather than in the TypeScript that builds them.
--
-- `@supabase/supabase-js` speaks PostgREST, which has no raw-SQL channel. So a
-- retrieval module that assembles its own SQL can run against a Postgres client
-- (the verification harness) but cannot run in production at all. The options were
-- a direct database driver holding its own credentials, a second copy of the query
-- written for PostgREST, or this: one function, called through plain SQL by the
-- harness and through `rpc()` by the application.
--
-- One definition, two callers, no drift. Every filter is a typed parameter, so this
-- is not a raw-SQL endpoint: a caller can choose platforms and provenances, and
-- nothing else.
--
-- Both functions are SECURITY INVOKER, so row-level security applies exactly as it
-- would to a direct select. `p_owner_id` is an additional explicit predicate for the
-- worker and import paths, where the connection is administrative and RLS is not the
-- boundary (C01).

-- pg_trgm lives in `extensions`. On a hosted Supabase project `authenticated`
-- already has USAGE there; on any other Postgres the schema is created by this
-- repo's first migration with no grants at all, and every extensions.similarity()
-- call then fails with "permission denied for schema extensions". Granting it here
-- makes the migrations self-sufficient rather than dependent on a platform default.
grant usage on schema extensions to authenticated;

-- English full-text candidates.
--
-- `plainto_tsquery` ANDs the terms, so this answers "replies containing all of
-- these ideas". A pure Chinese query parses to nothing here and returns zero rows,
-- which is correct rather than broken: the trigram and containment function below
-- is what carries a Chinese search.
create or replace function public.search_reply_candidates_fulltext(
  p_query text,
  p_limit integer default 40,
  p_owner_id uuid default null,
  p_platforms text[] default null,
  p_provenances text[] default null,
  p_include_ai_drafts boolean default false,
  p_include_unknown_dates boolean default true
)
returns table (
  id text,
  platform text,
  final_text text,
  provenance text,
  publication_evidence text,
  posted_at text,
  posted_date text,
  date_precision text,
  recorded_at text,
  score double precision
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  select
    r.id::text,
    r.platform::text,
    r.final_text,
    r.provenance::text,
    r.publication_evidence::text,
    to_char(r.posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    to_char(r.posted_date, 'YYYY-MM-DD'),
    r.date_precision::text,
    to_char(r.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    ts_rank_cd(to_tsvector('english', d.search_text), plainto_tsquery('english', p_query))::float8
  from public.search_documents d
  join public.reply_library r
    on r.id = d.entity_id
   and r.user_id = d.user_id
  where d.entity_kind = 'reply'
    and to_tsvector('english', d.search_text) @@ plainto_tsquery('english', p_query)
    -- Eligibility is applied here, inside the candidate query, not afterwards.
    -- Taking forty rows and then discarding the withdrawn ones silently shrinks
    -- the result while relevant writing sat at rank forty-one (C05).
    and r.withdrawn_at is null
    and (p_owner_id is null or (r.user_id = p_owner_id and d.user_id = p_owner_id))
    and (p_platforms is null or r.platform::text = any(p_platforms))
    and (
      case
        when p_provenances is not null then r.provenance::text = any(p_provenances)
        when p_include_ai_drafts then true
        else r.provenance::text <> 'ai_draft'
      end
    )
    and (p_include_unknown_dates or r.date_precision::text <> 'unknown')
  order by 10 desc, r.recorded_at desc, r.id
  limit p_limit;
$$;

-- Trigram and containment candidates: the signal that makes Chinese work.
--
-- `similarity` compares whole strings and is punishing when a short query meets a
-- long reply. `word_similarity` compares the query against the best-matching extent,
-- which is closer to the question being asked.
--
-- Neither of them finds Chinese. Measured against this schema:
-- `word_similarity('面試', '今天分享一個面試準備的技巧')` is exactly 0, because
-- pg_trgm pads a standalone word, so the query yields "  面", " 面試", "面試 " while
-- the same characters inside an unspaced Han run yield "個面試", "面試準". They share
-- nothing. Containment is therefore not a nicety here; it is the only signal that
-- works for Traditional Chinese and for two-character keywords, which is why C05
-- names escaped substring matching separately from trigram matching.
--
-- Containment scores the fraction of query terms that literally appear, with a
-- verbatim whole-query match scoring 1. That is a statement about the text, not a
-- confidence estimate, and it is never rendered as a percentage.
--
-- Terms combine with `greatest` rather than summing: someone searching
-- "interview 面試" wants either language's writing, not only replies containing both.
create or replace function public.search_reply_candidates_trigram(
  p_query text,
  p_terms text[] default '{}',
  p_limit integer default 40,
  p_min_score double precision default 0.08,
  p_owner_id uuid default null,
  p_platforms text[] default null,
  p_provenances text[] default null,
  p_include_ai_drafts boolean default false,
  p_include_unknown_dates boolean default true
)
returns table (
  id text,
  platform text,
  final_text text,
  provenance text,
  publication_evidence text,
  posted_at text,
  posted_date text,
  date_precision text,
  recorded_at text,
  score double precision
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  select * from (
    select
      r.id::text as id,
      r.platform::text as platform,
      r.final_text as final_text,
      r.provenance::text as provenance,
      r.publication_evidence::text as publication_evidence,
      to_char(r.posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as posted_at,
      to_char(r.posted_date, 'YYYY-MM-DD') as posted_date,
      r.date_precision::text as date_precision,
      to_char(r.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as recorded_at,
      greatest(
        extensions.similarity(d.search_text, p_query),
        coalesce(
          (select max(extensions.word_similarity(t, d.search_text))
             from unnest(coalesce(p_terms, '{}'::text[])) as t),
          0
        ),
        case
          when strpos(d.search_text, p_query) > 0 then 1::float8
          when coalesce(array_length(p_terms, 1), 0) = 0 then 0::float8
          else (
            select count(*)::float8 / array_length(p_terms, 1)
              from unnest(p_terms) as t
             where strpos(d.search_text, t) > 0
          )
        end
      )::float8 as score
    from public.search_documents d
    join public.reply_library r
      on r.id = d.entity_id
     and r.user_id = d.user_id
    where d.entity_kind = 'reply'
      and r.withdrawn_at is null
      and (p_owner_id is null or (r.user_id = p_owner_id and d.user_id = p_owner_id))
      and (p_platforms is null or r.platform::text = any(p_platforms))
      and (
        case
          when p_provenances is not null then r.provenance::text = any(p_provenances)
          when p_include_ai_drafts then true
          else r.provenance::text <> 'ai_draft'
        end
      )
      and (p_include_unknown_dates or r.date_precision::text <> 'unknown')
  ) candidates
  where score >= p_min_score
  order by score desc, recorded_at desc, id
  limit p_limit;
$$;

revoke all on function public.search_reply_candidates_fulltext(
  text, integer, uuid, text[], text[], boolean, boolean) from public, anon;
revoke all on function public.search_reply_candidates_trigram(
  text, text[], integer, double precision, uuid, text[], text[], boolean, boolean) from public, anon;

grant execute on function public.search_reply_candidates_fulltext(
  text, integer, uuid, text[], text[], boolean, boolean) to authenticated;
grant execute on function public.search_reply_candidates_trigram(
  text, text[], integer, double precision, uuid, text[], text[], boolean, boolean) to authenticated;


-- SR-004 (#5). Extensions and the canonical vocabulary from C02.
--
-- Extensions live in a dedicated `extensions` schema rather than `public`, and every
-- reference to them elsewhere in these migrations is schema-qualified. That keeps
-- `search_path = ''` usable inside security-definer functions.
--
-- pgvector is deliberately NOT installed here. It is a separate, later migration so
-- that the whole schema can be created and policy-tested on a Postgres build without
-- pgvector. Lexical search is the floor; vectors only improve ranking (C05).

create schema if not exists extensions;

create extension if not exists pg_trgm with schema extensions;

-- `gen_random_uuid()` is core Postgres since 13; pgcrypto is not required for it.

-- ---------------------------------------------------------------------------
-- C02 canonical vocabulary. Legacy aliases are translated at import boundaries
-- only (see the importer); nothing but these values is ever persisted.
-- ---------------------------------------------------------------------------

create type public.platform as enum ('linkedin', 'x', 'threads');

create type public.target_kind as enum ('post', 'comment', 'keyword');

create type public.provenance as enum (
  'posted_confirmed',
  'user_edited_unconfirmed',
  'published_main_post',
  'ai_draft'
);

create type public.publication_evidence as enum (
  'user_confirmed',
  'platform_export',
  'verified_url',
  'unknown'
);

create type public.date_precision as enum ('timestamp', 'date_only', 'unknown');

create type public.session_state as enum ('draft', 'recorded', 'discarded');

-- Not in C02's client-facing list, but the database needs them to be explicit
-- rather than free text.

create type public.generation_status as enum (
  'pending',
  'succeeded',
  'invalid_output',
  'provider_error',
  'timeout',
  'rate_limited',
  'withheld'
);

create type public.resource_type as enum ('guide', 'tool', 'article', 'book');

create type public.resource_ownership as enum ('own', 'book');

create type public.fact_sensitivity as enum ('public_safe', 'private_context_only');

create type public.import_source_type as enum ('linkedin', 'x', 'threads', 'drive');

create type public.import_status as enum ('open', 'completed', 'failed', 'abandoned');

create type public.import_disposition as enum ('imported', 'duplicate', 'needs_review', 'invalid');

create type public.search_entity_kind as enum ('reply', 'resource');

create type public.embedding_job_status as enum ('pending', 'running', 'retry', 'dead', 'done');


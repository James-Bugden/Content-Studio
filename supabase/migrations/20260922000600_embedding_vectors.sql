-- requires-extension: vector
--
-- SR-004 (#5) / SR-009 (#10). The optional vector column.
--
-- This file is separated from the core schema deliberately. The local verification
-- harness runs on a Postgres build without pgvector, so everything above it — tables,
-- constraints, policies, the recording transaction, lexical search — is proven there.
-- This migration is applied to the hosted project, where pgvector exists, and the
-- application treats vectors as a ranking improvement rather than a dependency (C05).
--
-- 1536 is this schema's first engineering choice, matching the dimension the selected
-- embedding model returns natively. It is not a claim about every provider. A model
-- that returns a different dimension is rejected by the column type rather than
-- silently truncated, and switching model means a new versioned index, not a reuse of
-- this one.

create extension if not exists vector with schema extensions;

alter table public.search_documents
  add column if not exists embedding extensions.vector(1536);

-- A stored vector must say which model produced it. Comparing vectors from two
-- models is meaningless, so the pairing is enforced rather than assumed.
alter table public.search_documents
  add constraint search_documents_embedding_provenance check (
    embedding is null
    or (embedding_model is not null and embedding_version is not null and embedded_at is not null)
  );

create index if not exists search_documents_embedding_cosine
  on public.search_documents
  using hnsw (embedding extensions.vector_cosine_ops);


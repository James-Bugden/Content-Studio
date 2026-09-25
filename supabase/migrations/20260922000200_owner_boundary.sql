-- SR-004 (#5). The private owner boundary from C01.
--
-- There is exactly one enabled owner. Their id lives in a schema no API role can
-- reach, not in Git, not in client code and not in an editable profile row. The
-- only thing any client can learn is a boolean.

create schema if not exists private;

revoke all on schema private from public;

create table private.app_owner (
  user_id uuid primary key references auth.users (id) on delete restrict,
  enabled boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

-- At most one enabled owner, enforced by the database rather than by convention.
create unique index app_owner_one_enabled on private.app_owner ((true)) where enabled;

alter table private.app_owner enable row level security;
-- No policies: RLS with zero policies denies every non-superuser. The table is
-- reachable only by the security-definer function below and by direct database
-- administration.

revoke all on table private.app_owner from public;

-- Narrow, stable, and incapable of changing anything. `search_path = ''` means every
-- reference must be fully qualified, so no caller-controlled schema can shadow a name.
create or replace function private.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.app_owner o
    where o.user_id = (select auth.uid())
      and o.enabled
  );
$$;

revoke all on function private.is_app_owner() from public;
revoke all on function private.is_app_owner() from anon;

-- EXECUTE is required because every RLS policy calls this function, and policy
-- expressions are evaluated with the querying role's privileges. USAGE on the
-- schema is deliberately NOT granted: without it, `authenticated` cannot write
-- `private.anything` by name, so this grant does not open the schema. Verified
-- by a test that calls it both ways.
grant execute on function private.is_app_owner() to authenticated;

comment on function private.is_app_owner() is
  'Returns whether the current session is the single enabled owner. Cannot mutate the owner table.';

-- The API needs to ask "am I the owner?", and PostgREST can only reach functions
-- in an exposed schema. This wrapper is the entire public surface of the private
-- schema: one boolean, no arguments, no way to name a row.
--
-- It is SECURITY DEFINER precisely so that `authenticated` needs no USAGE on the
-- `private` schema at all. The schema stays closed; only this function can see in.
create or replace function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_app_owner();
$$;

-- `revoke ... from public` is NOT enough on a hosted Supabase project: its default
-- privileges grant EXECUTE on every new function in `public` directly to `anon` and
-- `authenticated`, and a direct grant survives a revoke from PUBLIC. The hosted
-- security advisor caught this on a schema whose local tests were already green,
-- so anon is revoked by name here and in every other function this app defines.
revoke all on function public.is_app_owner() from public;
revoke all on function public.is_app_owner() from anon;
grant execute on function public.is_app_owner() to authenticated;

-- Bootstrapping is a private operation performed against the provisioned project:
--   insert into private.app_owner (user_id) values ('<the owner auth user id>');
-- No owner identifier belongs in this repository (SECURITY.md).


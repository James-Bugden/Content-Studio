-- UNAPPLIED
-- CS-074 / #226: apply explicitly AFTER 20261025000800_content_cutover_status.sql.
-- No provider calls or authority flip. Atomic and re-runnable with existing rows.
begin;

-- The SELECT * view has a stored integer output type and blocks ALTER TYPE.
-- Do not CASCADE: an unexpected dependency must abort rather than be removed.
drop view if exists public.content_studio_ready_queue;
alter table public.content_studio_posts
  alter column hook_score type numeric(6,2) using hook_score::numeric(6,2);
alter table public.content_studio_schedule
  alter column hook_score type numeric(6,2) using hook_score::numeric(6,2);
create view public.content_studio_ready_queue with (security_invoker = true) as
  select * from public.content_studio_posts
  where collection = 'library' and review_status = 'Approved' and queue_for_schedule;

-- Audited dependencies: no hook_score check constraint or integer cast exists.
-- mutate/import_run/write_through and shadow_import use jsonb_populate_record
-- with the current table composite type. cutover_snapshot uses to_jsonb(t);
-- export/rehearsal use the adapter renderer. queue_summary does not read scores.
-- Their invoker functions and pinned search_path need no redefinition.
-- ALTER preserves data, row versions, defaults, constraints, RLS and table ACLs.
-- A legacy integer outside numeric(6,2) fails atomically; never truncate it.
revoke all on public.content_studio_ready_queue from public, anon, authenticated;
grant select on public.content_studio_ready_queue to service_role;

commit;

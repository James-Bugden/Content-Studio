-- DB-2: preserve existing columns while adding the domain's per-column counts.
-- One row per source. Multiple master URLs use the first nonblank URL in
-- C lexical order; never split a source or multiply its totals by master count.
begin;
-- PostgREST cannot attach COLLATE to an order parameter. Pin every text sort
-- column instead, so every adapter ORDER BY (including stable-ID tie breaks)
-- uses C regardless of the hosted database's default locale. Rebuild dependent
-- views in this transaction; preserve their invoker security and grants below.
drop view public.content_studio_ready_queue;
drop view public.content_studio_queue_summary;
alter table public.content_studio_posts
  alter column library_id type text collate "C",
  alter column content_source type text collate "C";
alter table public.content_studio_schedule
  alter column date type text collate "C",
  alter column platform type text collate "C",
  alter column slot type text collate "C",
  alter column content_id type text collate "C";
alter table public.content_studio_workflow_settings
  alter column setting type text collate "C";
create view public.content_studio_ready_queue with (security_invoker = true) as
  select * from public.content_studio_posts
  where collection = 'library' and review_status = 'Approved' and queue_for_schedule;
create or replace view public.content_studio_queue_summary with (security_invoker = true) as
  select content_source, coalesce(min(nullif(source_master_file_url, '') collate "C"), min(nullif(source_markdown_url, '') collate "C"), '') as master_link,
    count(*) as count,
    jsonb_build_object(
      'Total', count(*),
      'Not Reviewed', count(*) filter (where review_status in ('', 'Not Reviewed', 'Pending')),
      'Approved', count(*) filter (where review_status = 'Approved'),
      'Queued', count(*) filter (where queue_for_schedule),
      'Needs Fix', count(*) filter (where review_status = 'Changes Requested' or copyright_qa = 'REWORK' or duplicate_qa in ('CHECK', 'DUPLICATE'))
    ) as counts
  from public.content_studio_posts where collection = 'queue'
  group by content_source;
revoke all on public.content_studio_ready_queue, public.content_studio_queue_summary from public, anon, authenticated;
grant select on public.content_studio_ready_queue, public.content_studio_queue_summary to service_role;
commit;

-- #243. UNAPPLIED. Also applies to the retained legacy Content SQL chain.
begin;
create or replace view public.content_studio_queue_summary with (security_invoker = true) as
  select content_source, coalesce(min(nullif(source_master_file_url, '') collate "C"), min(nullif(source_markdown_url, '') collate "C"), '') as master_link,
    count(*) as count,
    jsonb_build_object(
      'Total', count(*),
      'Not Reviewed', count(*) filter (where review_status in ('', 'Not Reviewed', 'Pending')),
      'Approved', count(*) filter (where review_status = 'Approved'),
      'Queued', count(*) filter (where queue_for_schedule),
      'Needs Fix', count(*) filter (where review_status = 'Changes Requested' or duplicate_qa in ('CHECK', 'DUPLICATE'))
    ) as counts
  from public.content_studio_posts where collection = 'queue'
  group by content_source;

revoke all on public.content_studio_queue_summary from public, anon, authenticated;
grant select on public.content_studio_queue_summary to service_role;
commit;

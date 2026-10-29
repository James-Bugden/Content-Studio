-- #248. UNAPPLIED by the build workflow; the coordinator applies it. Idempotent.
-- Ranked ASCII sketch options from the image check: a nullable jsonb array of
-- {id,title,reason,layout,sketch} on each post (1 to 9 entries). The chosen,
-- approved sketch stays in image_sketch. The column is written through the
-- guarded mutate function, so it needs the writable allow-list entry; no AI
-- feature name is added (more options reuse 'ascii_sketch').
begin;

alter table public.content_studio_posts add column if not exists image_sketch_options jsonb;
alter table public.content_studio_posts drop constraint if exists content_studio_image_sketch_options_shape;
alter table public.content_studio_posts add constraint content_studio_image_sketch_options_shape check (
  image_sketch_options is null or (
    jsonb_typeof(image_sketch_options) = 'array'
    and jsonb_array_length(image_sketch_options) between 1 and 9
    and octet_length(image_sketch_options::text) <= 60000));

-- Patch the writable allow-list in place instead of redefining the whole mutate
-- function: read its current definition, add the key once, and re-create it.
-- CREATE OR REPLACE keeps the owner, the service-only ACL and the invoker mode.
do $patch$
declare
  def text;
  fragment constant text := '''platform_versions'',''deleted_at'',''image_sketch''';
begin
  def := pg_get_functiondef('content_studio_private.content_studio_mutate(text,text,text,text,text,text,bigint,jsonb)'::regprocedure);
  if position('''image_sketch_options''' in def) > 0 then return; end if;
  if position(fragment in def) = 0 then
    raise exception 'content_studio_mutate allow-list fragment not found; refusing to patch';
  end if;
  execute replace(def, fragment, fragment || ',''image_sketch_options''');
end
$patch$;

-- The derived view lists columns at creation time; recreate it to include the new one.
drop view if exists public.content_studio_ready_queue;
create view public.content_studio_ready_queue with (security_invoker = true) as
  select * from public.content_studio_posts where collection = 'library' and deleted_at is null and review_status = 'Approved' and queue_for_schedule;
revoke all on public.content_studio_ready_queue from public, anon, authenticated;
grant select on public.content_studio_ready_queue to service_role;

commit;

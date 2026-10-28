-- #245. UNAPPLIED by the build workflow; the coordinator applies it. Idempotent.
-- Owner-only image bank for Replies, plus the AI usage feature list for the new
-- 'bank_image_tags' feature. Rows are reachable only through the service role;
-- the browser never receives a URL, only bytes proxied by an owner-checked route.
begin;

create table if not exists public.reply_bank_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Idempotency: a replayed create returns the row it already made.
  request_key text not null check (length(request_key) between 1 and 128),
  request_hash text not null check (length(request_hash) between 1 and 128),
  title text not null check (btrim(title) <> '' and length(title) <= 200),
  alt_text text not null default '' check (length(alt_text) <= 500),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  origin text not null default 'upload' check (origin in ('upload', 'created')),
  -- 'sketch' is a created image whose ASCII sketch is awaiting approval/render.
  status text not null default 'ready' check (status in ('sketch', 'ready')),
  mime_type text check (mime_type is null or mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size integer not null default 0 check (byte_size between 0 and 5242880),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  sketch text not null default '' check (octet_length(sketch) <= 16000),
  -- What a created image is about; the render step reads it again after approval.
  brief text not null default '' check (octet_length(brief) <= 16000),
  sketch_approved_hash text check (sketch_approved_hash is null or sketch_approved_hash ~ '^[0-9a-f]{8,64}$'),
  active boolean not null default true,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reply_bank_images_owner_key unique (user_id, id),
  constraint reply_bank_images_request_unique unique (user_id, request_key),
  constraint reply_bank_images_ready_has_file check (
    (status = 'ready') = (mime_type is not null and byte_size > 0 and sha256 is not null)
  )
);

-- Bytes live in their own table so listing the bank can never drag megabytes along.
create table if not exists public.reply_bank_image_files (
  image_id uuid primary key references public.reply_bank_images (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  bytes bytea not null check (octet_length(bytes) between 1 and 5242880)
);

-- Survives deletion of the image on purpose: it records that something happened.
create table if not exists public.reply_bank_image_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  image_id uuid not null,
  action text not null check (action in ('create', 'update', 'delete', 'attach', 'approve')),
  request_key text not null check (length(request_key) between 1 and 128),
  at timestamptz not null default now()
);

create index if not exists reply_bank_images_owner_active on public.reply_bank_images (user_id, active, status);
create index if not exists reply_bank_image_audit_image on public.reply_bank_image_audit (user_id, image_id, at desc);

drop trigger if exists reply_bank_images_updated_at on public.reply_bank_images;
create trigger reply_bank_images_updated_at
before update on public.reply_bank_images
for each row execute function public.set_updated_at();

alter table public.reply_bank_images enable row level security;
alter table public.reply_bank_image_files enable row level security;
alter table public.reply_bank_image_audit enable row level security;
revoke all on public.reply_bank_images, public.reply_bank_image_files, public.reply_bank_image_audit
  from public, anon, authenticated;
grant select, insert, update, delete on public.reply_bank_images, public.reply_bank_image_files to service_role;
grant select, insert on public.reply_bank_image_audit to service_role;

-- AI usage: the full feature list, including the new 'bank_image_tags'.
alter table public.content_studio_ai_calls drop constraint if exists content_studio_ai_calls_feature_check;
alter table public.content_studio_ai_calls add constraint content_studio_ai_calls_feature_check check
  (feature in ('english_qa','hooks','zh_tw','zh_qa','replies_ideas','replies_rewrite','replies_translation','embeddings',
               'image_check','ascii_sketch','image_render','image_need','bank_image_tags'));

commit;

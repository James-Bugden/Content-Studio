-- #242. Adds the image-need check to the AI usage feature list. Deliberately unapplied by the build workflow.
alter table public.content_studio_ai_calls drop constraint if exists content_studio_ai_calls_feature_check;
alter table public.content_studio_ai_calls add constraint content_studio_ai_calls_feature_check
  check (feature in ('english_qa','hooks','zh_tw','zh_qa','image_need','replies_ideas','replies_rewrite','replies_translation','embeddings'));

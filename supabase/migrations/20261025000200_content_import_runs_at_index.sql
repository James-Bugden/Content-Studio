-- Pending before live db-read. Never applied live; unapplied in CS-059g.
-- Supports the bounded latest-import identity query and its stable tie-break.
create index content_studio_import_runs_at_operation_id_idx
  on public.content_studio_import_runs (at desc, operation_id desc);

# DB-9: enable live Phase A (db-shadow)

DB-10's [cutover runbook](cutover.md) extends this preparation with live read
and write compositions, an additional unapplied migration and measured gates
in place of calendar waits. Its exact ordered procedure supersedes the earlier
live-mode refusal and waiting instructions below. No production flip is claimed.

Status: implementation only; **all SQL below is UNAPPLIED by the builder**.
Issue [#197](https://github.com/James-Bugden/Content-Studio/issues/197).
The owner authorised Phase A. This does not authorise live `db-read` or `db`:
both remain refused by environment validation and the live import boundary.
Sheet and Drive authority remain unchanged. No production cutover date is recorded.

## Apply and deployment order (owner/coordinator)

1. Obtain the independent Opus review and green required CI for the exact code
   commit. Confirm the existing shared **Career** project privately; do not
   create a second project or touch Replies objects. Record the deployed SHA,
   migration file hashes and deployment identity privately.
2. Keep Production `CS_CONTENT_STORE=sheet`; disable the Sheet-mirror cron
   while applying. Inspect the project's migration ledger and object definitions.
   Previously shipped files were fake/PGlite-only. If any listed file was
   already applied in a different form, stop and prepare an additive repair;
   do not replay a one-shot migration over it. No repository-wide `db push`.
3. Apply each reviewed, still-unapplied file explicitly, in this order:

   | Order | File | Contract |
   | --- | --- | --- |
   | 1 | `20261024000100_content_authority.sql` | DB-1 tables/import/version 1 |
   | 2 | `20261024000200_content_summary_reads.sql` | DB-2 views/collation |
   | 3 | `20261025000100_content_writes.sql` | DB-3 ledger/private helper/version 2 |
   | 4 | `20261025000200_content_import_runs_at_index.sql` | latest-import index |
   | 5 | `20261025000400_content_markdown_export.sql` | DB-7 wrapper/outbox dependency; does not enable body authority |
   | 6 | `20261025000500_content_shadow_live.sql` | DB-9 lease/jobs/durable parity |

   The legacy `20260925030000_sheet_read_model.sql` is already deployed per
   MIG-04. Verify that fact; it is not permission to reapply Replies migrations.
4. Execute the verification queries below. Require zero failing rows, then
   run hosted anon/authenticated denial checks against every new table, view
   and RPC, and the Supabase security/database advisors. PGlite cannot prove
   hosted PostgREST configuration or independent-backend concurrency.
5. Reuse **existing** Production variables `SUPABASE_READ_MODEL_URL` and
   `SUPABASE_READ_MODEL_SERVICE_KEY` for the typed DB clients in Career.
   No new secret names are needed. Keep them server-only and Production-only;
   preview stays fake. Set the existing `SUPABASE_READ_MODEL_SOURCE_KEY` to a
   stable non-personal alias (8–64 lower-case characters, never the Sheet ID).
   Keep `AUTH_SECRET` stable for HMAC evidence. Verify existing Google config
   and `CRON_SECRET` privately. `SUPABASE_READ_MODEL_MODE=off` is allowed:
   the typed importer is selected by `CS_CONTENT_STORE`, independently.
6. Set Production `CS_CONTENT_STORE=db-shadow`, deploy the reviewed build,
   and follow the first-import checklist. Google write permission is unchanged:
   ordinary app saves still write Sheet; imports never write Sheet or Drive.

## Verification SQL (read only)

Run privately with an authorised SQL session. Every new relation must be
prefixed, force RLS, have zero policies, and deny all browser-role privileges.
Views must be security invoker. Functions must be invoker with a pinned path.

```sql
select version from public.content_studio_schema_version; -- exactly one row: 2

-- Must return zero rows.
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and left(c.relname,15)='content_studio_'
  and c.relkind='r' and (not c.relrowsecurity or not c.relforcerowsecurity);
select tablename,policyname from pg_policies
where schemaname='public' and left(tablename,15)='content_studio_';
select c.relname,r.role,v.privilege
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join (values ('anon'),('authenticated')) r(role)
cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(privilege)
where n.nspname='public' and left(c.relname,15)='content_studio_'
  and c.relkind in ('r','v') and has_table_privilege(r.role,c.oid,v.privilege);
select c.relname,r.role from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join (values ('anon'),('authenticated')) r(role)
where n.nspname='public' and left(c.relname,15)='content_studio_' and c.relkind='S'
  and (has_sequence_privilege(r.role,c.oid,'USAGE') or has_sequence_privilege(r.role,c.oid,'SELECT') or has_sequence_privilege(r.role,c.oid,'UPDATE'));
select p.oid::regprocedure,r.role from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join (values ('anon'),('authenticated')) r(role)
where n.nspname in ('public','content_studio_private') and p.proname like '%content_studio%'
  and has_function_privilege(r.role,p.oid,'EXECUTE');
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','content_studio_private') and p.proname like '%content_studio%'
  and (p.prosecdef or not exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%'));
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and left(c.relname,15)='content_studio_' and c.relkind='v'
  and not coalesce(c.reloptions @> array['security_invoker=true'],false);

-- Inventory: three new tables and five new RPCs; inspect service_role grants.
select table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name like 'content_studio_shadow_%';
select p.oid::regprocedure,has_function_privilege('service_role',p.oid,'EXECUTE')
from pg_proc p where p.proname like 'content_studio_shadow_%';
```

## First import and scheduler checklist

1. On the exact deployed SHA, check owner login, Sheet reads and ordinary
   conflict/idempotent saves. As anonymous/viewer, owner import must refuse;
   wrong/missing cron bearer must refuse before any provider call.
2. Open `/reconcile` as owner and click **Run content import**. The browser
   sends `POST /api/ops/sheet-mirror` with a UUID `Idempotency-Key` and
   same-origin/session authentication. Retain that key privately for retries.
   Expect counts, hashes, named DB-4 exceptions and `completed`; no row copy
   is returned. A repeated key returns the original durable evidence even on
   a fresh instance, without capturing another Sheet snapshot.
3. Check `content_studio_shadow_jobs`, `content_studio_import_runs` and the
   `imported` event. Confirm all four collection counts and exact stable-ID
   sets against the complete source; inspect exceptions privately. Three
   consecutive full imports with identical sets/counts and only allowed
   field differences are required. Absent Sheet rows are retained in DB and
   reported as unexpected IDs; deletion/retirement is not automatic.
4. Force an overlapping request from another instance. Expect `in_progress`
   before Sheet capture. Both routes have maxDuration=60 seconds; the lease is
   65 seconds (5-second kill-recovery margin). A killed run may block another
   key until expiry while capturing source data; the next claim records failure
   and replaces it. An in-flight SQL transaction retains its row lock until
   commit/rollback: the hosted kill-recovery rehearsal must also verify that
   abandoned transactions drain before retry. Stale
   tokens cannot commit. Rehearse with independent Postgres backends on a
   branch, including delayed/lost responses. Do not infer this from PGlite.
5. Configure the **existing Vercel project's production cron configuration**
   with the entry below, preserving any other schedules, then redeploy. Use
   the project's existing configuration mechanism for the `crons` property;
   if the plan/config UI cannot set it, the coordinator must add a reviewed
   `vercel.json` with this exact entry before enabling. No repository file
   was added here because the current project has no checked-in config and
   its existing plan/schedule inventory is unavailable to this build role.

   ```json
   { "crons": [{ "path": "/api/ops/sheet-mirror/reconcile", "schedule": "*/15 * * * *" }] }
   ```

   Confirm the plan supports 15-minute frequency. Vercel supplies
   `Authorization: Bearer <CRON_SECRET>`; the route hashes both strings and
   compares constant-time. Scheduled deliveries in the same UTC 15-minute
   slot share an idempotency identity. A failed attempt can retry that slot;
   a completed attempt replays. Confirm one real scheduled completion.
6. `/reconcile` must say **durable database history**. Samples contain only
   counts, collection/field names, kinds and keyed fingerprints. Import
   evidence contains hashes/counts and the private exception ledger. Never
   publish production hashes. Full history is read in one MVCC snapshot via
   a scalar JSON RPC, avoiding REST row caps and shifting offset pages.
7. Owner instruction **2026-10-25** waives the multi-day/sample-count wait for
   this one cutover. Set `CS_PARITY_WINDOW_WAIVED=2026-10-25` explicitly and run
   a fresh import. The import event and replay job record `windowWaiver` with
   `by: owner`, the authorisation date, and database `recordedAt`. `/reconcile`
   shows **Window waived by owner** only when both the switch and this durable
   audit exist. Unset the switch to restore the seven-day/200-sample gate.
   The waiver never substitutes for measurements: the same import transaction
   measures **100% of typed source rows** against stored rows, checks exact ID
   sets including unexpected retained DB rows, counts field equality >=99.9%,
   and requires zero unclassified differences. Source conversion differences
   remain classified in the exception ledger (blank checkboxes are equivalent;
   formula display is preserved). All stored-field differences are unclassified
   and block. Refused rows block. Missing old-format full-import evidence blocks.
   Full-import parity is close to a read-back: it compares typed inputs with the
   rows `import_run` just wrote, using `jsonb_populate_record` on both sides.
   It catches missing/retained rows and stored-field defects; it does not prove
   adapter, derived-view or read-path parity. Independent sampled comparisons
   therefore stay mandatory for **all six collections**: library, queue, ready,
   schedule, queue_summary and workflow_settings. Each needs at least one
   successful comparison in the evaluation window, including explicitly measured
   empty results. Unmeasured collections and 100% provider failures never pass.
   At most **one provider failure per collection** in that window is tolerated,
   and only alongside a successful comparison for that collection. A second
   failure blocks even if equality among successful comparisons is 100%.
   Provider failures are counted and displayed, not treated as equal comparisons.
   Sampled ID equality, >=99.9% field equality and zero unclassified blocking
   differences remain required. Lag p95 over measured samples and **current
   import age at evaluation time** must both be <=15 minutes; missing lag blocks.
   Failed equality, unknown exceptions, failed persistence and failed lag remain
   red, as does an import failure lasting over one hour. A sample-persistence gap
   survives history refresh (including failed refresh); it clears on a subsequent
   successfully persisted sample. A late completion of the timed-out sample or
   a concurrent save begun before the failure cannot clear it. History outages
   still require a successful refresh before availability returns.
   Without the waiver, 199 samples or six days fail; all collection, freshness,
   unknown-lag and one-hour failure checks still apply. The legacy per-day rule
   remains for that unwaived historical gate only.
   History is one MVCC snapshot of the last 30 days, plus the last prior import
   and first unresolved prior failure (carry-in preserves the one-hour gate).
   It returns at most 50,001 events; over 50,000 is explicitly unavailable, never
   truncated into a pass. Archive/volume remediation is needed at that bound.
   Shadow work is bounded (500 ms read and 500 ms persistence budgets); failures
   preserve the Sheet result and are visible as named gaps.
8. Live `db-read` and `db` remain errors even after these numbers pass.
   Read/write phase enablement requires separately reviewed code and gates.

## Rollback (Phase A only)

First remove/disable the cron, set `CS_CONTENT_STORE=sheet`, redeploy and
drain old invocations for at least the route/lease lifetime (65 seconds).
Check the exact deployed SHA serves Sheet responses. Setting legacy mirror
mode `off` alone does **not** disable the typed importer. Flag rollback
requires no data movement; preserve evidence privately if needed.

If the coordinator also elects to remove the derived DB objects, execute
this reviewed transaction only while Sheet is authoritative. It drops typed
`content_studio_*` objects including DB-7 and DB-9, with no `CASCADE`; unexpected
dependencies abort. Keep the previously deployed jsonb mirror/staging and all
Replies objects. This is not the Phase D rollback procedure.

```sql
begin;
drop function if exists public.content_studio_shadow_history();
drop function if exists public.content_studio_shadow_sample(uuid,jsonb);
drop function if exists public.content_studio_shadow_import(text,uuid,text,text,jsonb,jsonb,jsonb,jsonb,text);
drop function if exists public.content_studio_shadow_release(text,uuid);
drop function if exists public.content_studio_shadow_claim(text,text,uuid);
drop table if exists public.content_studio_shadow_events;
drop table if exists public.content_studio_shadow_lease;
drop table if exists public.content_studio_shadow_jobs;
drop function if exists public.content_studio_complete_markdown_export(text,bigint,text,text);
drop view if exists public.content_studio_ready_queue;
drop view if exists public.content_studio_queue_summary;
drop function if exists public.content_studio_apply_patch(text,text,text,text,text,bigint,jsonb);
drop function if exists public.content_studio_insert_queue_idea(text,text,text,text,jsonb);
drop function if exists public.content_studio_write_through(text,text,text,text,text,bigint,jsonb);
drop function if exists public.content_studio_import_run(text,text,text,jsonb,jsonb,jsonb,jsonb);
drop function if exists content_studio_private.content_studio_mutate(text,text,text,text,text,text,bigint,jsonb);
drop schema if exists content_studio_private;
drop table if exists public.content_studio_markdown_export;
drop table if exists public.content_studio_import_runs;
drop table if exists public.content_studio_schema_version;
drop table if exists public.content_studio_audit_events;
drop table if exists public.content_studio_row_history;
drop table if exists public.content_studio_operations;
drop table if exists public.content_studio_workflow_settings;
drop table if exists public.content_studio_schedule;
drop table if exists public.content_studio_posts;
commit;
```

After rollback verify the typed tables/functions are absent, Replies and the
legacy Sheet mirror match their prior catalog inventory, and the app's
normal Sheet read/save/replay/conflict flows still work. Re-enablement needs
the same migration/apply/security/import checklist from the start.

## Configuration and verification limits

`SUPABASE_READ_MODEL_MODE=mirror` with `db-shadow` is explicitly refused by
the cron/import entry point with `legacy_mirror_refused_in_db_shadow_disable_mirror_mode`.
Set it to `off` before using typed imports. The legacy jsonb mirror will no
longer refresh and must not be used as current data; this is not a silent cron
takeover. Invalid/missing shadow URL/key leaves Sheet reads and writes working
and shows `CONFIG_MISSING` on `/reconcile`; import refuses until corrected.

PGlite has one connection: it verifies token/status/expiry predicates and
transaction rollback, but cannot falsify a missing advisory lock or establish
independent-backend concurrency. That hosted rehearsal remains required.

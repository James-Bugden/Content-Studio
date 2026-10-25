-- UNAPPLIED. CS-066: audited owner waiver of the private Drive archive only.
-- Coordinator applies after independent approval; no authority/data flip here.
begin;
create table if not exists public.content_studio_backup_waivers (
  operation_id uuid primary key,
  build text not null check (build ~ '^[a-f0-9]{40}$'),
  import_id text not null,
  "by" text not null default 'owner' check ("by"='owner'),
  "on" text not null check ("on"='2026-10-25'),
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table public.content_studio_backup_waivers enable row level security;
alter table public.content_studio_backup_waivers force row level security;
revoke all on public.content_studio_backup_waivers from public,anon,authenticated,service_role;
grant select,insert on public.content_studio_backup_waivers to service_role;

-- Explicit private coordinator attestation. Append-only; same UUID replays,
-- changed actor/build/import/decision conflicts. No provider evidence invented.
create or replace function public.content_studio_cutover_waive_backup(
  p_operation_id uuid,p_build text,p_import_id text,p_waiver text,p_actor_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare h text; t uuid:=gen_random_uuid(); claim jsonb; result jsonb;
begin
  if p_build is null or p_build !~ '^[a-f0-9]{40}$'
    or p_waiver is distinct from '2026-10-25'
    or p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid owner waiver' using errcode='22023';
  end if;
  h:=encode(sha256(convert_to(jsonb_build_array('backup-waiver',p_build,p_import_id,p_waiver,p_actor_hash)::text,'UTF8')),'hex');
  claim:=public.content_studio_cutover_operation(p_operation_id,h,t,null);
  if claim->>'status'='replayed' then return claim->'result'; end if;
  if p_import_id is null or p_import_id is distinct from
    (select operation_id from public.content_studio_import_runs order by at desc,operation_id desc limit 1) then
    raise exception 'import changed or missing' using errcode='40001';
  end if;
  insert into public.content_studio_backup_waivers(operation_id,build,import_id,"on",actor_hash)
    values(p_operation_id,p_build,p_import_id,p_waiver,p_actor_hash)
    returning jsonb_build_object('by',"by",'on',"on",'recordedAt',recorded_at) into result;
  perform public.content_studio_cutover_operation(p_operation_id,h,t,result);
  return result;
end $$;

-- SQL cannot read deployment environment. Runtime passes the switch on EVERY
-- check. Omission (including the two-argument gate) is a strict, revoked waiver.
create or replace function public.content_studio_cutover_backup_waiver(p_backup_waiver text,p_build text default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object('by',"by",'on',"on",'recordedAt',recorded_at)
  from public.content_studio_backup_waivers
  where p_backup_waiver='2026-10-25' and "on"=p_backup_waiver
    and (p_build is null or build=p_build)
    and import_id=(select operation_id from public.content_studio_import_runs order by at desc,operation_id desc limit 1)
  order by recorded_at desc,operation_id desc limit 1;
$$;

-- Shared free-form evidence-reference validator. POSIX space/graph coverage is
-- locale-dependent, so strip explicit Unicode whitespace, format controls and
-- default-ignorable/invisible characters before requiring a printable glyph.
-- Validation never trims or rewrites the stored reference; padded refs survive.
create or replace function public.content_studio_cutover_evidence_reference(p_reference jsonb)
returns boolean language sql immutable security invoker set search_path=pg_catalog,public as $$
  select coalesce(jsonb_typeof(p_reference)='string'
    and length(p_reference #>> '{}') between 1 and 2048
    and regexp_replace(p_reference #>> '{}',
      U&'[[:space:][:cntrl:]\0085\00a0\00ad\034f\0600-\0605\061c\06dd\070f\0890-\0891\08e2\115f-\1160\1680\17b4-\17b5\180b-\180f\2000-\200f\2028-\202f\205f\2060-\206f\2800\3000\3164\fe00-\fe0f\feff\ffa0\fff0-\fffb\+0110bd\+0110cd\+013430-\+013440\+01bca0-\+01bca3\+01d173-\+01d17a\+0e0000-\+0e0fff]',
      '', 'g') ~ '[[:graph:]]', false);
$$;

-- Remove old signatures to prevent PostgREST overload ambiguity. Reapplication
-- is safe: the new signatures use CREATE OR REPLACE, originals no longer exist.
drop function if exists public.content_studio_cutover_gate(text,text);
drop function if exists public.content_studio_cutover_activate(text,text,text);
create or replace function public.content_studio_cutover_gate(p_mode text,p_build text,p_backup_waiver text default null)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare e public.content_studio_cutover_evidence; s jsonb; c text; latest text; proof jsonb; export_proof jsonb;
begin
  if p_mode not in ('db-read','db') or p_build is null or p_build !~ '^[a-f0-9]{40}$' then raise exception 'invalid gate' using errcode='42501'; end if;
  select operation_id into latest from public.content_studio_import_runs order by at desc,operation_id desc limit 1;
  select * into e from public.content_studio_cutover_evidence where name='parity' and build=p_build and import_id=latest;
  if not found or e.payload->>'coverage' is distinct from 'all-rows' or e.at < clock_timestamp()-interval '15 minutes' then raise exception 'full parity required' using errcode='42501'; end if;
  foreach c in array array['library','queue','ready','schedule','queue_summary','workflow_settings'] loop
    s := e.payload->'samples'->c;
    if s is null or s->>'idsEqual' is distinct from 'true' or s->>'blocking' is distinct from '0'
      or (s->>'lagMs')::numeric is null or (s->>'lagMs')::numeric not between 0 and 900000
      or (s->>'fields')::numeric is null or (s->>'fields')::numeric < 0
      or (s->>'equal')::numeric is null or (s->>'equal')::numeric < (s->>'fields')::numeric*.999
      or (s->>'equal')::numeric > (s->>'fields')::numeric then raise exception 'parity not green' using errcode='42501'; end if;
  end loop;
  if p_mode='db' then
    if public.content_studio_cutover_backup_waiver(p_backup_waiver,p_build) is not null then
      -- A historical rehearsal cannot hide a retained conflict or a newer red
      -- export. Runtime also reads fresh provider parity on each activation.
      select state into s from public.content_studio_cutover_state where name='sheet-export';
      export_proof:=s->'reports'->-1;
      if s->'issues' is distinct from '[]'::jsonb
        or jsonb_typeof(s->'reports') is distinct from 'array'
        or export_proof->'exact' is distinct from 'true'::jsonb
        or export_proof->'differences' is distinct from '[]'::jsonb
        or export_proof->>'dbHash' is null or export_proof->>'dbHash' !~ '^[a-f0-9]{64}$'
        or export_proof->>'dbHash' is distinct from export_proof->>'sheetHash'
        or jsonb_typeof(export_proof->'at') is distinct from 'number' then
        raise exception 'waived backup requires exact Sheet export' using errcode='42501';
      end if;
      if (export_proof->>'at')::numeric < extract(epoch from clock_timestamp()-interval '15 minutes')*1000
        or (export_proof->>'at')::numeric > extract(epoch from clock_timestamp())*1000 then
        raise exception 'waived backup requires exact Sheet export' using errcode='42501';
      end if;
    end if;
    foreach c in array array['phase-c','rehearsal','backup'] loop
      select payload into proof from public.content_studio_cutover_evidence where name=c and build=p_build and import_id=latest;
      if not found and c='backup'
        and not exists(select 1 from public.content_studio_cutover_evidence where name='backup')
        and (select state->>'failureSince' from public.content_studio_cutover_state where name='backup') is null
        and public.content_studio_cutover_backup_waiver(p_backup_waiver,p_build) is not null then continue; end if;
      if not found then raise exception 'write proof missing' using errcode='42501'; end if;
      if (select at from public.content_studio_cutover_evidence where name=c) < clock_timestamp()-interval '24 hours' then raise exception 'write proof expired' using errcode='42501'; end if;
      if c='phase-c' and (proof->>'smoke' is distinct from 'true' or proof->>'t4' is distinct from 'true'
        or proof->>'writeThrough' is distinct from 'true' or proof->>'freeze' is distinct from 'true'
        or proof->>'dailyPlanBackup' is distinct from 'true' or proof->>'restoreExact' is distinct from 'true'
        or proof->>'importsStopped' is distinct from 'true' or proof->>'flagRoundTrip' is distinct from 'true'
        or proof->>'hostedSecurity' is distinct from 'true' or proof->>'independentConcurrency' is distinct from 'true'
        or proof->>'sheetRaceAccepted' is distinct from 'true'
        or not public.content_studio_cutover_evidence_reference(proof->'privateEvidence')
        or proof->>'sheetRead429' is distinct from '0' or proof->>'lagStale' is distinct from '0'
        or (proof->>'warmP95Ms')::numeric is null or (proof->>'warmP95Ms')::numeric not between 0 and 999.999
        or (proof->>'coldP95Ms')::numeric is null or (proof->>'coldP95Ms')::numeric not between 0 and 2499.999)
        then raise exception 'phase C proof missing' using errcode='42501'; end if;
      if c='rehearsal' and (proof->>'exact' is distinct from 'true' or proof->>'dbHash' is null
        or proof->>'dbHash' !~ '^[a-f0-9]{64}$' or proof->>'dbHash' is distinct from proof->>'sheetHash'
        or proof->'differences' is distinct from '[]'::jsonb) then raise exception 'rollback proof missing' using errcode='42501'; end if;
      if c='backup' and (proof->>'manifestHash' is null or proof->>'manifestHash' !~ '^[a-f0-9]{64}$') then raise exception 'backup proof missing' using errcode='42501'; end if;
    end loop;
  end if;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.content_studio_cutover_activate(p_mode text,p_build text,p_contract text,p_backup_waiver text default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v integer; a public.content_studio_cutover_authority;
begin
  perform pg_advisory_xact_lock(198,2);
  select * into a from public.content_studio_cutover_authority where singleton;
  if a.mode='sheet' and not exists(select 1 from public.content_studio_import_runs where at>a.activated_at) then
    raise exception 'new import required after Sheet rollback' using errcode='42501';
  end if;
  select version into v from public.content_studio_schema_version;
  if p_contract is distinct from 'schema-'||v||':cutover-1' then raise exception 'contract mismatch' using errcode='42501'; end if;
  perform public.content_studio_cutover_gate(p_mode,p_build,p_backup_waiver);
  -- Never downgrade a DB epoch by running a Phase C activation.
  if p_mode='db-read' and exists(select 1 from public.content_studio_cutover_authority where mode='db') then raise exception 'DB authority exists' using errcode='42501'; end if;
  insert into public.content_studio_cutover_authority(singleton,mode,build,contract,schema_version)
    values(true,p_mode,p_build,p_contract,v) on conflict(singleton) do update
    set mode=excluded.mode,build=excluded.build,contract=excluded.contract,schema_version=excluded.schema_version,activated_at=clock_timestamp();
  return jsonb_build_object('ok',true);
end $$;


revoke all on function public.content_studio_cutover_waive_backup(uuid,text,text,text,text),
  public.content_studio_cutover_evidence_reference(jsonb),
  public.content_studio_cutover_backup_waiver(text,text),
  public.content_studio_cutover_gate(text,text,text),
  public.content_studio_cutover_activate(text,text,text,text) from public,anon,authenticated;
grant execute on function public.content_studio_cutover_waive_backup(uuid,text,text,text,text),
  public.content_studio_cutover_evidence_reference(jsonb),
  public.content_studio_cutover_backup_waiver(text,text),
  public.content_studio_cutover_gate(text,text,text),
  public.content_studio_cutover_activate(text,text,text,text) to service_role;
commit;

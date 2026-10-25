-- UNAPPLIED. CS-067: read-only owner status and audited backup receipt.
-- No gate, authority, evidence or provider write is changed by this migration.
begin;
create or replace function public.content_studio_cutover_status(
  p_build text,p_backup_waiver text default null,p_calendar_waiver text default null)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare m text; verdict jsonb; gates jsonb:='{}'; reason text; ages jsonb; epoch text;
begin
  if p_build is null or p_build !~ '^[a-f0-9]{40}$' then
    raise exception 'invalid status build' using errcode='22023';
  end if;
  foreach m in array array['db-read','db'] loop
    begin
      verdict:=public.content_studio_cutover_gate(m,p_build,p_backup_waiver);
      if verdict is distinct from '{"ok":true}'::jsonb then raise exception 'unexpected gate verdict'; end if;
      verdict:=jsonb_build_object('ok',true,'reasons','[]'::jsonb);
    exception when others then
      -- Never return SQL/provider text, including unexpected conversion errors.
      reason:=case SQLERRM
        when 'invalid gate' then 'invalid_gate'
        when 'full parity required' then 'full_parity_required'
        when 'parity not green' then 'parity_not_green'
        when 'waived backup requires exact Sheet export' then 'backup_waiver_export_not_exact'
        when 'write proof missing' then 'write_proof_missing'
        when 'write proof expired' then 'write_proof_expired'
        when 'phase C proof missing' then 'phase_c_proof_missing'
        when 'rollback proof missing' then 'rollback_proof_missing'
        when 'backup proof missing' then 'backup_proof_missing'
        else 'gate_unavailable' end;
      verdict:=jsonb_build_object('ok',false,'reasons',jsonb_build_array(reason));
    end;
    gates:=gates||jsonb_build_object(m,verdict);
  end loop;
  select case mode when 'sheet' then 'retired' when 'db-read' then 'read' else 'db' end
    into epoch from public.content_studio_cutover_authority where singleton;
  select jsonb_object_agg(n.name,case when e.at is null then null else
    greatest(0,floor(extract(epoch from clock_timestamp()-e.at)*1000)) end) into ages
    from unnest(array['parity','phase-c','rehearsal','backup']) n(name)
    left join public.content_studio_cutover_evidence e on e.name=n.name and e.build=p_build
      and e.import_id=(select operation_id from public.content_studio_import_runs order by at desc,operation_id desc limit 1);
  return jsonb_build_object('epoch',coalesce(epoch,'none'),'gates',gates,'evidenceAgesMs',ages,
    'waivers',jsonb_build_object(
      'backup',jsonb_build_object('audited',public.content_studio_cutover_backup_waiver(p_backup_waiver,p_build) is not null),
      'calendar',jsonb_build_object('audited',coalesce(p_calendar_waiver='2026-10-25' and
        (select payload->'evidence'->'windowWaiver'->>'by'='owner'
          and payload->'evidence'->'windowWaiver'->>'on'=p_calendar_waiver
          and payload->'evidence'->'windowWaiver'->>'recordedAt' is not null
          and payload->'evidence'->>'snapshotHash'=(select snapshot_hash from public.content_studio_import_runs order by at desc,operation_id desc limit 1)
         from public.content_studio_shadow_events where kind='imported' order by at desc,event_id desc limit 1),false))));
end $$;

create or replace function public.content_studio_cutover_backup_receipt(p_build text,p_backup_waiver text default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object('status','backup_waived','waiver',jsonb_build_object(
    'audited',true,'build',p_build,'auditHash',encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex')))
  from public.content_studio_backup_waivers w
  where public.content_studio_cutover_backup_waiver(p_backup_waiver,p_build) is not null
    and w.build=p_build and w."on"=p_backup_waiver
    and w.import_id=(select operation_id from public.content_studio_import_runs order by at desc,operation_id desc limit 1)
  order by w.recorded_at desc,w.operation_id desc limit 1;
$$;
revoke all on function public.content_studio_cutover_status(text,text,text),
  public.content_studio_cutover_backup_receipt(text,text) from public,anon,authenticated;
grant execute on function public.content_studio_cutover_status(text,text,text),
  public.content_studio_cutover_backup_receipt(text,text) to service_role;
commit;

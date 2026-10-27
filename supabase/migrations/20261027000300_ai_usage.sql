-- #218. Deliberately unapplied by the build workflow. Owner-only, no prompt/copy storage.
create table if not exists public.content_studio_ai_budget (
  singleton boolean primary key default true check (singleton),
  cap_micros bigint not null default 20000000 check (cap_micros between 0 and 1000000000),
  version integer not null default 1 check (version > 0)
);
insert into public.content_studio_ai_budget(singleton) values (true) on conflict do nothing;
create table if not exists public.content_studio_ai_calls (
  id uuid primary key,
  timestamp timestamptz not null default clock_timestamp(),
  feature text not null check (feature in ('english_qa','hooks','zh_tw','zh_qa','replies_ideas','replies_rewrite','replies_translation','embeddings')),
  model text not null check (length(model) between 1 and 100),
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  cost_micros bigint not null check (cost_micros >= 0),
  status text not null check (status in ('pending','completed','uncertain'))
);
create index if not exists content_studio_ai_calls_timestamp on public.content_studio_ai_calls(timestamp desc, id);
create table if not exists public.content_studio_ai_cap_operations (
  operation_id uuid primary key,
  timestamp timestamptz not null default clock_timestamp(),
  payload jsonb not null,
  previous_cap_micros bigint not null,
  resulting_version integer not null
);
alter table public.content_studio_ai_budget enable row level security;
alter table public.content_studio_ai_calls enable row level security;
alter table public.content_studio_ai_cap_operations enable row level security;
revoke all on public.content_studio_ai_budget, public.content_studio_ai_calls, public.content_studio_ai_cap_operations from public, anon, authenticated;
grant select, insert, update on public.content_studio_ai_budget, public.content_studio_ai_calls, public.content_studio_ai_cap_operations to service_role;

create or replace function public.content_studio_ai_usage(p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  budget public.content_studio_ai_budget;
  existing public.content_studio_ai_calls;
  previous jsonb;
  month_start timestamptz;
  month_end timestamptz;
  spent bigint;
  result jsonb;
  admitted_at timestamptz;
begin
  -- The singleton lock serializes admission, settlement and cap edits across processes.
  select * into strict budget from public.content_studio_ai_budget where singleton for update;
  admitted_at := clock_timestamp();
  month_start := date_trunc('month', admitted_at at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
  month_end := (date_trunc('month', admitted_at at time zone 'Asia/Taipei') + interval '1 month') at time zone 'Asia/Taipei';
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception using errcode = '22023', message = 'invalid data'; end if;
  if p_action in ('begin','finish') then
    if coalesce(p_data->>'model','') = '' or length(p_data->>'model') > 100
      or coalesce(p_data->>'inputTokens','') !~ '^[0-9]+$' or coalesce(p_data->>'outputTokens','') !~ '^[0-9]+$'
      or coalesce(p_data->>'costMicros','') !~ '^[0-9]+$' then
      raise exception using errcode = '22023', message = 'invalid call data';
    end if;
  end if;
  select coalesce(sum(cost_micros),0) into spent from public.content_studio_ai_calls where timestamp >= month_start and timestamp < month_end;
  if p_action = 'summary' then
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'timestamp', c.timestamp, 'feature', c.feature, 'model', c.model,
      'inputTokens', c.input_tokens, 'outputTokens', c.output_tokens, 'costMicros', c.cost_micros, 'status', c.status) order by c.timestamp desc, c.id), '[]')
      into result from (select * from public.content_studio_ai_calls order by timestamp desc, id limit 25) c;
    return jsonb_build_object('month',to_char(month_start at time zone 'Asia/Taipei','YYYY-MM'), 'resetsAt',month_end,
      'spentMicros',spent,'capMicros',budget.cap_micros,'version',budget.version,'calls',result);
  elsif p_action = 'begin' then
    if not p_data ?& array['id','feature','model','inputTokens','outputTokens','costMicros'] then
      raise exception using errcode = '22023', message = 'missing call fields';
    end if;
    if exists (select 1 from public.content_studio_ai_calls where id = (p_data->>'id')::uuid) then
      raise exception using errcode = 'AC001', message = 'call already admitted';
    end if;
    if spent >= budget.cap_micros then raise exception using errcode = 'AL001', message = 'Monthly AI limit reached'; end if;
    insert into public.content_studio_ai_calls(id, timestamp, feature, model, input_tokens, output_tokens, cost_micros, status)
      values ((p_data->>'id')::uuid, admitted_at, p_data->>'feature', p_data->>'model', (p_data->>'inputTokens')::bigint,
        (p_data->>'outputTokens')::bigint, (p_data->>'costMicros')::bigint, 'pending');
  elsif p_action = 'finish' then
    if not p_data ?& array['id','model','inputTokens','outputTokens','costMicros','status'] or p_data->>'status' is null
      or p_data->>'status' not in ('completed','uncertain') then raise exception using errcode = '22023', message = 'invalid settlement'; end if;
    select * into existing from public.content_studio_ai_calls where id = (p_data->>'id')::uuid;
    if not found then raise exception using errcode = 'AC001', message = 'call missing'; end if;
    if existing.status <> 'pending' then
      if existing.model <> p_data->>'model' or existing.input_tokens <> (p_data->>'inputTokens')::bigint
        or existing.output_tokens <> (p_data->>'outputTokens')::bigint or existing.cost_micros <> (p_data->>'costMicros')::bigint
        or existing.status <> p_data->>'status' then raise exception using errcode = 'AC001', message = 'settlement conflict'; end if;
    else
      update public.content_studio_ai_calls set model = p_data->>'model', input_tokens = (p_data->>'inputTokens')::bigint,
        output_tokens = (p_data->>'outputTokens')::bigint, cost_micros = (p_data->>'costMicros')::bigint,
        status = p_data->>'status' where id = existing.id;
    end if;
  elsif p_action = 'set_cap' then
    if not p_data ?& array['operationId','expectedVersion','capMicros','actorHash'] or p_data->>'expectedVersion' is null then
      raise exception using errcode = '22023', message = 'invalid cap change';
    end if;
    if coalesce(p_data->>'expectedVersion','') !~ '^[1-9][0-9]*$' or coalesce(p_data->>'capMicros','') !~ '^[0-9]+$' then
      raise exception using errcode = '22023', message = 'invalid cap values';
    end if;
    if p_data->>'actorHash' !~ '^[a-f0-9]{64}$' or p_data->>'actorHash' is null then
      raise exception using errcode = '22023', message = 'invalid actor';
    end if;
    select payload into previous from public.content_studio_ai_cap_operations where operation_id = (p_data->>'operationId')::uuid;
    if found then
      if previous <> p_data then raise exception using errcode = 'AC001', message = 'operation conflict'; end if;
      return jsonb_build_object('ok',true);
    end if;
    if (p_data->>'expectedVersion')::integer <> budget.version then raise exception using errcode = 'AS001', message = 'stale cap'; end if;
    update public.content_studio_ai_budget set cap_micros = (p_data->>'capMicros')::bigint, version = version+1 where singleton;
    insert into public.content_studio_ai_cap_operations(operation_id,payload,previous_cap_micros,resulting_version)
      values ((p_data->>'operationId')::uuid,p_data,budget.cap_micros,budget.version+1);
  else
    raise exception using errcode = '22023', message = 'unknown action';
  end if;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.content_studio_ai_usage(text,jsonb) from public, anon, authenticated;
grant execute on function public.content_studio_ai_usage(text,jsonb) to service_role;

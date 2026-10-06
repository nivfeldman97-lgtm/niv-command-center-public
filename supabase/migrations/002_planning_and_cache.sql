begin;

create table if not exists public.planning_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  microsoft_task_id text,
  title text not null check (length(trim(title)) > 0),
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists planning_blocks_user_start_idx on public.planning_blocks(user_id, start_at);

create table if not exists public.cached_calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  microsoft_event_id text not null,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at >= start_at),
  is_all_day boolean not null default false,
  location text,
  microsoft_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  unique(user_id, microsoft_event_id)
);
create index if not exists cached_events_user_start_idx on public.cached_calendar_events(user_id, start_at);

create table if not exists public.cached_todo_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  microsoft_task_id text not null,
  microsoft_list_id text not null,
  title text not null,
  list_name text not null,
  list_type text,
  category text,
  due_at timestamptz,
  important boolean not null default false,
  status text not null check (lower(status) <> 'completed'),
  microsoft_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  unique(user_id, microsoft_task_id)
);

-- Metadata is required even for a successfully synced EMPTY calendar/task list.
create table if not exists public.microsoft_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_id text,
  snapshot_started_at timestamptz,
  synced_at timestamptz,
  calendar_start timestamptz,
  calendar_end timestamptz
);

do $$
declare table_name text;
begin
  foreach table_name in array array['planning_blocks', 'cached_calendar_events', 'cached_todo_tasks', 'microsoft_sync_state'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('drop policy if exists dashboard_owner on public.%I', table_name);
    execute format('create policy dashboard_owner on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists dashboard_boundary on public.%I', table_name);
    execute format('create policy dashboard_boundary on public.%I as restrictive for all to public using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name);
  end loop;
end;
$$;

create or replace function public.microsoft_sync_clock()
returns timestamptz language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return clock_timestamp();
end;
$$;

-- One transaction replaces the entire bounded snapshot. Never invoke this after
-- partial Graph success. Failed writes retain the old cache, including metadata.
-- Row locking + server start timestamps prevent a slow older sync overwriting a
-- newer device's successful snapshot. No Microsoft tokens are accepted/stored.
create or replace function public.replace_microsoft_cache(
  p_tasks jsonb, p_events jsonb,
  p_calendar_start timestamptz, p_calendar_end timestamptz,
  p_started_at timestamptz, p_account_id text, p_expected_user_id uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  previous_start timestamptz;
  saved_time timestamptz;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if p_expected_user_id is distinct from owner_id then raise exception 'Dashboard account changed; reconnect Microsoft'; end if;
  if p_tasks is null or p_events is null or jsonb_typeof(p_tasks) <> 'array' or jsonb_typeof(p_events) <> 'array' then
    raise exception 'Complete task and event arrays are required';
  end if;
  if p_calendar_start is null or p_calendar_end is null or p_calendar_end <= p_calendar_start then
    raise exception 'Valid calendar coverage is required';
  end if;
  if p_started_at is null or p_started_at > clock_timestamp() or p_account_id is null then
    raise exception 'Server sync timestamp and account are required';
  end if;
  insert into public.microsoft_sync_state(user_id) values(owner_id) on conflict(user_id) do nothing;
  select snapshot_started_at, synced_at into previous_start, saved_time
    from public.microsoft_sync_state where user_id = owner_id for update;
  if previous_start is not null and previous_start >= p_started_at then
    return jsonb_build_object('accepted', false, 'synced_at', saved_time);
  end if;
  saved_time := clock_timestamp();
  delete from public.cached_todo_tasks where user_id = owner_id;
  insert into public.cached_todo_tasks(user_id, microsoft_task_id, microsoft_list_id, title, list_name,
    list_type, category, due_at, important, status, microsoft_updated_at, synced_at)
  select owner_id, t.microsoft_task_id, t.microsoft_list_id, t.title, t.list_name,
    t.list_type, t.category, t.due_at, coalesce(t.important, false), coalesce(t.status, 'notStarted'), t.microsoft_updated_at, saved_time
  from jsonb_to_recordset(p_tasks) as t(microsoft_task_id text, microsoft_list_id text, title text, list_name text,
    list_type text, category text, due_at timestamptz, important boolean, status text, microsoft_updated_at timestamptz)
  where lower(coalesce(t.status, 'notStarted')) <> 'completed';

  delete from public.cached_calendar_events where user_id = owner_id;
  insert into public.cached_calendar_events(user_id, microsoft_event_id, title, start_at, end_at,
    is_all_day, location, microsoft_updated_at, synced_at)
  select owner_id, e.microsoft_event_id, e.title, e.start_at, e.end_at,
    coalesce(e.is_all_day, false), e.location, e.microsoft_updated_at, saved_time
  from jsonb_to_recordset(p_events) as e(microsoft_event_id text, title text, start_at timestamptz, end_at timestamptz,
    is_all_day boolean, location text, microsoft_updated_at timestamptz);

  update public.microsoft_sync_state set account_id = p_account_id, snapshot_started_at = p_started_at,
    synced_at = saved_time, calendar_start = p_calendar_start, calendar_end = p_calendar_end where user_id = owner_id;
  return jsonb_build_object('accepted', true, 'synced_at', saved_time);
end;
$$;
revoke all on function public.microsoft_sync_clock() from public, anon;
revoke all on function public.replace_microsoft_cache(jsonb, jsonb, timestamptz, timestamptz, timestamptz, text, uuid) from public, anon;
grant execute on function public.microsoft_sync_clock() to authenticated;
grant execute on function public.replace_microsoft_cache(jsonb, jsonb, timestamptz, timestamptz, timestamptz, text, uuid) to authenticated;
commit;

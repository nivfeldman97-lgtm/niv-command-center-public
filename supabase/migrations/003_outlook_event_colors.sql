begin;

-- Nullable for existing snapshots and older clients that omit color_hex.
alter table public.cached_calendar_events
  add column if not exists color_hex text
  constraint cached_calendar_events_color_hex_check
  check (color_hex is null or color_hex ~ '^#[0-9a-f]{6}$');

-- Preserve the existing RPC signature, owner checks, RLS, atomic replacement,
-- completed-task filtering and stale-sync protection. Only event color storage changes.
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
    is_all_day, location, microsoft_updated_at, color_hex, synced_at)
  select owner_id, e.microsoft_event_id, e.title, e.start_at, e.end_at,
    coalesce(e.is_all_day, false), e.location, e.microsoft_updated_at, lower(e.color_hex), saved_time
  from jsonb_to_recordset(p_events) as e(microsoft_event_id text, title text, start_at timestamptz, end_at timestamptz,
    is_all_day boolean, location text, microsoft_updated_at timestamptz, color_hex text);

  update public.microsoft_sync_state set account_id = p_account_id, snapshot_started_at = p_started_at,
    synced_at = saved_time, calendar_start = p_calendar_start, calendar_end = p_calendar_end where user_id = owner_id;
  return jsonb_build_object('accepted', true, 'synced_at', saved_time);
end;
$$;

revoke all on function public.replace_microsoft_cache(jsonb, jsonb, timestamptz, timestamptz, timestamptz, text, uuid) from public, anon;
grant execute on function public.replace_microsoft_cache(jsonb, jsonb, timestamptz, timestamptz, timestamptz, text, uuid) to authenticated;
commit;

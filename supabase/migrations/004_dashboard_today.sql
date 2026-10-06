begin;

-- Independent of cached_todo_tasks: atomic Microsoft cache replacement must
-- never delete dashboard choices. Task/list IDs are Microsoft's canonical IDs.
create table if not exists public.dashboard_today_selections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  microsoft_task_id text not null,
  microsoft_list_id text not null,
  local_date date not null,
  created_at timestamptz not null default now(),
  unique(user_id, local_date, microsoft_list_id, microsoft_task_id)
);

alter table public.dashboard_today_selections enable row level security;
grant select, insert, update, delete on public.dashboard_today_selections to authenticated;
drop policy if exists dashboard_owner on public.dashboard_today_selections;
create policy dashboard_owner on public.dashboard_today_selections for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists dashboard_boundary on public.dashboard_today_selections;
create policy dashboard_boundary on public.dashboard_today_selections as restrictive for all to public
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

commit;

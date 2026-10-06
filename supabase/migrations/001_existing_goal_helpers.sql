-- Apply after 000_initial_goals.sql. Install owner policies and goal helpers.
-- Also supports compatible existing schemas without replacing their foreign keys.
begin;

alter table public.goals enable row level security;
alter table public.milestones enable row level security;
grant select, insert, update, delete on public.goals, public.milestones to authenticated;

-- The restrictive policy also protects against an older permissive policy.
drop policy if exists dashboard_goal_owner on public.goals;
create policy dashboard_goal_owner on public.goals for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists dashboard_goal_boundary on public.goals;
create policy dashboard_goal_boundary on public.goals as restrictive for all to public
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists dashboard_milestone_owner on public.milestones;
create policy dashboard_milestone_owner on public.milestones for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists dashboard_milestone_boundary on public.milestones;
create policy dashboard_milestone_boundary on public.milestones as restrictive for all to public
  using ((select auth.uid()) = user_id and exists (
    select 1 from public.goals g where g.id = goal_id and g.user_id = (select auth.uid())
  ))
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.goals g where g.id = goal_id and g.user_id = (select auth.uid())
  ));

create index if not exists dashboard_milestones_goal_idx on public.milestones (user_id, goal_id);

-- Used only if direct goal deletion finds a non-cascading milestone FK.
-- A failure anywhere rolls back both deletes; RLS applies to the caller.
create or replace function public.delete_dashboard_goal(p_goal_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform 1 from public.goals where id = p_goal_id and user_id = auth.uid() for update;
  if not found then raise exception 'Goal not found or access denied'; end if;
  delete from public.milestones where goal_id = p_goal_id and user_id = auth.uid();
  delete from public.goals where id = p_goal_id and user_id = auth.uid();
end;
$$;
revoke all on function public.delete_dashboard_goal(uuid) from public, anon;
grant execute on function public.delete_dashboard_goal(uuid) to authenticated;
commit;

-- Fresh-install foundation. Apply every migration in ascending numeric order.
begin;
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  start_date date not null,
  target_date date not null check (target_date >= start_date),
  category text not null default 'Personal',
  progress integer not null default 0 check (progress between 0 and 100),
  status text not null default 'Planned' check (status in ('Planned', 'Active', 'Done', 'Paused')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  target_date date not null,
  status text not null default 'Planned' check (status in ('Planned', 'Active', 'Done', 'Paused')),
  created_at timestamptz not null default now()
);
-- Closed to browser roles until 001 grants access and installs owner policies.
alter table public.goals enable row level security;
alter table public.milestones enable row level security;
revoke all on public.goals, public.milestones from public, anon;
create index if not exists goals_user_start_idx on public.goals(user_id, start_date);
commit;

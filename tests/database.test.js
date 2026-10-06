import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('color migration preserves an existing pre-color event and can be reapplied', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      insert into auth.users values ('11111111-1111-4111-8111-111111111111');
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/002_planning_and_cache.sql', import.meta.url), 'utf8'))
    await db.exec(`insert into public.cached_calendar_events(user_id, microsoft_event_id, title, start_at, end_at)
      values ('11111111-1111-4111-8111-111111111111', 'legacy', 'Existing meeting', '2026-09-15T08:00:00Z', '2026-09-15T09:00:00Z')`)
    const before = (await db.query('select * from public.cached_calendar_events')).rows[0]
    const migration = await readFile(new URL('../supabase/migrations/003_outlook_event_colors.sql', import.meta.url), 'utf8')
    for (let pass = 0; pass < 2; pass++) {
      await db.exec(migration)
      assert.deepEqual((await db.query('select * from public.cached_calendar_events')).rows, [{ ...before, color_hex: null }])
    }
  } finally { await db.close() }
})

test('migrations are repeatable; RLS, atomic cache pruning and goal deletion hold', async () => {
  const db = new PGlite()
  const alice = '11111111-1111-4111-8111-111111111111', bob = '22222222-2222-4222-8222-222222222222'
  const goal = '33333333-3333-4333-8333-333333333333'
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated, anon;
      create table public.goals(id uuid primary key default gen_random_uuid(), user_id uuid, title text, start_date date, target_date date, category text, progress integer, status text, notes text, updated_at timestamptz);
      create table public.milestones(id uuid primary key default gen_random_uuid(), user_id uuid, goal_id uuid references public.goals(id), title text, target_date date, status text);
      create policy legacy_open_goals on public.goals for all to public using (true) with check (true);
      create policy legacy_open_milestones on public.milestones for all to public using (true) with check (true);
      grant select on public.goals, public.milestones to anon;
      insert into auth.users values ('${alice}'), ('${bob}');
    `)
    const migrations = await Promise.all(['001_existing_goal_helpers.sql', '002_planning_and_cache.sql', '003_outlook_event_colors.sql', '004_dashboard_today.sql'].map((file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')))
    for (let pass = 0; pass < 2; pass++) for (const migration of migrations) await db.exec(migration)
    async function asUser(user) {
      await db.exec('reset role; set role authenticated;')
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
    }
    const count = async (table) => Number((await db.query(`select count(*) as count from public.${table}`)).rows[0].count)
    await asUser(alice)
    const selectToday = (owner, date = '2026-09-15') => db.query(`insert into public.dashboard_today_selections(user_id,microsoft_task_id,microsoft_list_id,local_date)
      values ($1,'task1','list1',$2) on conflict (user_id,local_date,microsoft_list_id,microsoft_task_id) do nothing`, [owner, date])
    await selectToday(alice)
    await selectToday(alice)
    assert.equal(await count('dashboard_today_selections'), 1, 'concurrent/repeated Adds are idempotent')
    await selectToday(alice, '2026-09-14')
    await assert.rejects(db.query('update public.dashboard_today_selections set user_id=$1', [bob]), /row-level security/)
    await db.query('insert into public.goals(id,user_id,title) values($1,$2,$3)', [goal, alice, 'Goal'])
    await db.query('insert into public.milestones(user_id,goal_id,title,target_date,status) values($1,$2,$3,$4,$5)', [alice, goal, 'Milestone', '2026-12-01', 'Planned'])
    await db.query('insert into public.planning_blocks(user_id,title,start_at,end_at) values($1,$2,$3,$4)', [alice, 'Plan', '2026-09-15T08:00:00Z', '2026-09-15T09:00:00Z'])
    await assert.rejects(db.query('insert into public.planning_blocks(user_id,title,start_at,end_at) values($1,$2,$3,$4)', [alice, 'Bad dates', '2026-09-15T09:00:00Z', '2026-09-15T08:00:00Z']))
    await asUser(bob)
    assert.equal(await count('dashboard_today_selections'), 0)
    await assert.rejects(selectToday(alice), /row-level security/)
    assert.equal((await db.query('delete from public.dashboard_today_selections returning id')).rows.length, 0)
    assert.equal((await db.query("update public.dashboard_today_selections set local_date='2026-09-16' returning id")).rows.length, 0)
    for (const table of ['goals', 'milestones', 'planning_blocks']) assert.equal(await count(table), 0)
    await assert.rejects(db.query('insert into public.milestones(user_id,goal_id,title) values($1,$2,$3)', [bob, goal, 'Cross-user child']))
    await assert.rejects(db.query('insert into public.planning_blocks(user_id,title,start_at,end_at) values($1,$2,$3,$4)', [alice, 'Spoof owner', '2026-09-15T08:00:00Z', '2026-09-15T09:00:00Z']))
    await assert.rejects(db.query('select public.delete_dashboard_goal($1)', [goal]))
    await asUser(alice)
    const clock = async () => (await db.query('select public.microsoft_sync_clock()::text as stamp')).rows[0].stamp
    const started = await clock()
    const task = { microsoft_task_id: 'task1', microsoft_list_id: 'list1', title: 'Active', list_name: 'Certification', status: 'notStarted' }
    const event = { microsoft_event_id: 'event1', title: 'Outlook', start_at: '2026-09-15T08:00:00Z', end_at: '2026-09-15T09:00:00Z' }
    const replace = async (tasks, events, stamp) => (await db.query('select public.replace_microsoft_cache($1::jsonb,$2::jsonb,$3,$4,$5,$6,$7) as result', [JSON.stringify(tasks), JSON.stringify(events), '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', stamp, 'test-account', alice])).rows[0].result
    assert.equal((await replace([task, { ...task, microsoft_task_id: 'done', status: 'completed' }], [event], started)).accepted, true)
    assert.equal(await count('cached_todo_tasks'), 1)
    assert.equal(await count('cached_calendar_events'), 1)
    const cachedColor = async () => (await db.query('select color_hex from public.cached_calendar_events')).rows[0].color_hex
    assert.equal(await cachedColor(), null, 'older clients may omit color_hex')
    assert.equal((await replace([task], [{ ...event, color_hex: '#A4262C' }], await clock())).accepted, true)
    assert.equal(await cachedColor(), '#a4262c', 'the RPC persists normalized color')
    await assert.rejects(replace([], [{ ...event, color_hex: 'red; background: url(x)' }], await clock()), /cached_calendar_events_color_hex_check/)
    assert.equal(await cachedColor(), '#a4262c', 'invalid colors roll back the previous snapshot')
    assert.equal(await count('cached_todo_tasks'), 1)
    await replace([task], [{ ...event, color_hex: null }], await clock())
    assert.equal(await cachedColor(), null, 'explicit null colors remain compatible')
    const failedStamp = await clock()
    await assert.rejects(replace([], [{ ...event, title: null }], failedStamp))
    assert.equal(await count('cached_todo_tasks'), 1, 'failed event write rolls back task pruning')
    assert.equal(await count('cached_calendar_events'), 1)
    const newer = await clock()
    assert.equal((await replace([], [], newer)).accepted, true)
    assert.equal(await count('cached_todo_tasks'), 0)
    assert.equal(await count('dashboard_today_selections'), 2, 'empty Microsoft replacement preserves all local selections')
    assert.equal(await count('cached_calendar_events'), 0)
    assert.equal(await count('microsoft_sync_state'), 1, 'empty snapshots retain sync metadata')
    assert.equal((await replace([task], [event], started)).accepted, false, 'older device snapshot cannot overwrite newer')
    assert.equal(await count('cached_todo_tasks'), 0)
    await replace([task], [event], await clock())
    assert.equal(await count('dashboard_today_selections'), 2, 'successful Microsoft sync preserves selections')
    await asUser(bob)
    for (const table of ['cached_todo_tasks', 'cached_calendar_events', 'microsoft_sync_state']) assert.equal(await count(table), 0)
    await assert.rejects(replace([task], [event], await clock()), /Dashboard account changed/)
    await asUser(alice)
    assert.equal((await db.query("select * from public.dashboard_today_selections where local_date='2026-09-15'")).rows.length, 1, 'another session for the owner reads today only')
    await db.query("delete from public.dashboard_today_selections where local_date='2026-09-15'")
    assert.equal(await count('dashboard_today_selections'), 1, 'Remove only deletes the requested date')
    await db.query('select public.delete_dashboard_goal($1)', [goal])
    assert.equal(await count('goals'), 0)
    assert.equal(await count('milestones'), 0)
    await db.exec("reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);")
    assert.equal(await count('goals'), 0)
    await assert.rejects(db.query('select public.microsoft_sync_clock()'))
    await assert.rejects(db.query('select * from public.dashboard_today_selections'), /permission denied/)
  } finally { await db.close() }
})

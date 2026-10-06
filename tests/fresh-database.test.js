import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('fresh install creates the complete schema with owner isolation and valid CRUD', async () => {
  const db = new PGlite()
  const alice = '11111111-1111-4111-8111-111111111111'
  const bob = '22222222-2222-4222-8222-222222222222'
  const goal = '33333333-3333-4333-8333-333333333333'
  try {
    await db.exec(`
      create role authenticated; create role anon; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated, anon;
      insert into auth.users values ('${alice}'), ('${bob}');
    `)
    const folder = new URL('../supabase/migrations/', import.meta.url)
    const names = (await readdir(folder)).filter((name) => name.endsWith('.sql')).sort()
    assert.equal(names.length, 5)
    for (let pass = 0; pass < 2; pass++) for (const name of names) {
      await db.exec(await readFile(new URL(name, folder), 'utf8'))
    }
    const tables = (await db.query("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname")).rows
    assert.deepEqual(tables.map((row) => row.relname), ['cached_calendar_events', 'cached_todo_tasks', 'dashboard_today_selections', 'goals', 'microsoft_sync_state', 'milestones', 'planning_blocks'])
    assert.ok(tables.every((row) => row.relrowsecurity))
    const asUser = async (user) => {
      await db.exec('reset role; set role authenticated;')
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
    }
    const count = async (table) => Number((await db.query(`select count(*) as n from public.${table}`)).rows[0].n)
    await asUser(alice)
    await db.query('insert into goals(id,user_id,title,start_date,target_date) values($1,$2,$3,$4,$5)', [goal, alice, 'Project Launch', '2026-09-01', '2026-12-01'])
    await db.query('insert into milestones(user_id,goal_id,title,target_date) values($1,$2,$3,$4)', [alice, goal, 'First release', '2026-10-01'])
    await db.query('insert into planning_blocks(user_id,title,start_at,end_at) values($1,$2,$3,$4)', [alice, 'Exercise', '2026-09-15T08:00:00Z', '2026-09-15T09:00:00Z'])
    await db.query('update goals set progress=25 where id=$1', [goal])
    assert.equal((await db.query('select progress from goals')).rows[0].progress, 25)
    await assert.rejects(db.query('update goals set progress=101 where id=$1', [goal]), /check constraint/)
    await assert.rejects(db.query("update goals set target_date='2025-01-01' where id=$1", [goal]), /check constraint/)
    const stamp = (await db.query('select microsoft_sync_clock()::text as stamp')).rows[0].stamp
    const task = { microsoft_task_id: 'demo-task', microsoft_list_id: 'study', title: 'Complete Certification', list_name: 'Study', status: 'notStarted' }
    const event = { microsoft_event_id: 'demo-event', title: 'Project review', start_at: '2026-09-15T08:00:00Z', end_at: '2026-09-15T09:00:00Z', color_hex: '#4056d6' }
    await db.query('select replace_microsoft_cache($1::jsonb,$2::jsonb,$3,$4,$5,$6,$7)', [JSON.stringify([task]), JSON.stringify([event]), '2026-09-01', '2026-10-01', stamp, 'fictional-account', alice])
    await db.query('insert into dashboard_today_selections(user_id,microsoft_task_id,microsoft_list_id,local_date) values($1,$2,$3,$4)', [alice, 'demo-task', 'study', '2026-09-15'])
    for (const { relname } of tables) assert.equal(await count(relname), 1)
    await asUser(bob)
    for (const { relname } of tables) {
      assert.equal(await count(relname), 0)
      assert.equal((await db.query(`delete from public.${relname} returning user_id`)).rows.length, 0)
    }
    await assert.rejects(db.query('insert into milestones(user_id,goal_id,title,target_date) values($1,$2,$3,$4)', [bob, goal, 'Forbidden child', '2026-10-01']), /row-level security/)
    await assert.rejects(db.query('insert into goals(user_id,title,start_date,target_date) values($1,$2,$3,$4)', [alice, 'Spoofed owner', '2026-09-01', '2026-12-01']), /row-level security/)
    assert.equal((await db.query('update goals set progress=75 where id=$1 returning id', [goal])).rows.length, 0)
    await asUser(alice)
    await db.query('delete from goals where id=$1', [goal])
    assert.equal(await count('milestones'), 0)
    await db.exec("reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);")
    for (const { relname } of tables) {
      try { assert.equal(await count(relname), 0) }
      catch (error) { assert.match(error.message, /permission denied/) }
    }
    await assert.rejects(db.query('select microsoft_sync_clock()'), /permission denied/)
  } finally { await db.close() }
})

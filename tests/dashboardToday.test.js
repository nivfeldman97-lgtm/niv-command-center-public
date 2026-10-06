import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { filterTasks, todaySelectionKeys } from '../src/lib/dashboardToday.js'

const today = '2026-09-15'
const task = (id, extra = {}) => ({ id, listId: 'list', status: 'notStarted', dueDate: null, ...extra })
const row = (id, date = today, list = 'list') => ({ microsoft_task_id: id, microsoft_list_id: list, local_date: date })
const ids = (tasks, filter, rows = []) => filterTasks(tasks, filter, today, todaySelectionKeys(rows, today)).map((task) => task.id)

test('Dashboard Today unions due today and undated manual choices, with no double counting', () => {
  const tasks = [task('due', { dueDate: today }), task('manual'), task('other')]
  assert.deepEqual(ids(tasks, 'Today'), ['due'])
  assert.deepEqual(ids(tasks, 'Today', [row('due'), row('manual')]), ['due', 'manual'])
  assert.deepEqual(ids(tasks, 'Today', [row('manual', '2026-09-14')]), ['due'])
  assert.deepEqual(ids(tasks, 'Today', [row('manual', today, 'different-list')]), ['due'])
  assert.deepEqual(ids(tasks, 'Today', []), ['due'], 'removing a selection keeps due-today tasks')
})

test('stale selections never resurrect completed or missing Microsoft tasks', () => {
  assert.deepEqual(ids([task('done', { status: 'Completed', dueDate: today })], 'Today', [row('done'), row('missing')]), [])
  assert.deepEqual(ids([], 'Today', [row('missing')]), [])
})

test('Important, Courses and Overdue retain their independent rules', () => {
  const tasks = [task('important', { important: true }), task('course', { listType: 'course' }),
    task('late', { dueDate: '2026-09-14' }), task('future', { dueDate: '2026-09-16' }), task('done', { status: 'completed', important: true, listType: 'course', dueDate: '2026-09-14' })]
  const rows = tasks.map((task) => row(task.id))
  for (const [filter, expected] of [['Important', ['important']], ['Courses', ['course']], ['Overdue', ['late']]]) {
    assert.deepEqual(ids(tasks, filter, rows), expected)
    assert.deepEqual(ids(tasks, filter, []), expected)
  }
  assert.deepEqual(ids(tasks, 'Today'), [])
  assert.deepEqual(ids(tasks, 'Today', rows), ['important', 'course', 'late', 'future'])
})

test('local dates and cached/live due dates agree across UTC boundaries in both directions', () => {
  for (const [zone, instant, date] of [
    ['Etc/GMT-3', '2026-09-14T21:30:00Z', '2026-09-15'],
    ['America/Los_Angeles', '2026-09-15T06:30:00Z', '2026-09-14'],
    ['America/New_York', '2026-11-01T05:30:00Z', '2026-11-01'],
  ]) {
    const code = `
      import assert from 'node:assert/strict';
      import { isoLocal } from './src/lib/dates.js';
      import { normalizeCachedTasks, normalizeGraphTasks } from './src/lib/microsoftModels.js';
      import { filterTasks, todaySelectionKeys } from './src/lib/dashboardToday.js';
      const date = isoLocal(new Date('${instant}'));
      assert.equal(date, '${date}');
      const cached = normalizeCachedTasks([{ microsoft_task_id: 'due', microsoft_list_id: 'list', list_name: 'Home', due_at: '${instant}' }]);
      const live = normalizeGraphTasks([{ id: 'due', dueDateTime: { dateTime: '${instant}' } }], { id: 'list', displayName: 'Home' });
      for (const tasks of [cached, live]) assert.equal(filterTasks(tasks, 'Today', date).length, 1);
      const selected = todaySelectionKeys([{ microsoft_task_id: 'manual', microsoft_list_id: 'list', local_date: date }], date);
      assert.equal(filterTasks([{ id: 'manual', listId: 'list' }], 'Today', date, selected).length, 1);
    `
    execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: zone } })
  }
})

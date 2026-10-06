import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeGraphTasks, normalizeCachedTasks, normalizeGraphEvents, graphDateTime } from '../src/lib/microsoftModels.js'
import { graphPages, fetchMicrosoftSnapshot } from '../src/lib/graph.js'
import { listMapping, COURSE_LISTS, goalFromRow, goalToRow } from '../src/lib/mappings.js'
import { weekStart, addDays, isoLocal, dueLabel } from '../src/lib/dates.js'
import { daySegments } from '../src/lib/calendarLayout.js'

test('completed tasks never cross either live or cached data boundary', () => {
  const raw = [{ id: 'open', status: 'inProgress', title: 'Certification', importance: 'high' }, { id: 'done', status: 'completed', importance: 'high' }, { id: 'done2', status: 'Completed' }]
  const tasks = normalizeGraphTasks(raw, { id: 'list', displayName: 'Certification' })
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].important, true)
  assert.equal(tasks[0].listType, 'course')
  const cached = normalizeCachedTasks(raw.map((row) => ({ ...row, microsoft_task_id: row.id, list_name: 'Certification' })))
  assert.deepEqual(cached.map((task) => task.id), ['open'])
  assert.deepEqual(normalizeGraphTasks(raw.slice(1), { id: 'list', displayName: 'Certification' }), [])
})
test('generic study lists and life areas map correctly', () => {
  for (const name of COURSE_LISTS) assert.deepEqual(listMapping(name), { category: 'Study', listType: 'course' })
  assert.equal(listMapping('Growth').category, 'Growth')
  assert.equal(listMapping('Routine').category, 'Routine')
  assert.equal(listMapping('Work').category, 'Work')
  assert.equal(listMapping('Personal').category, 'Personal')
})
test('UTC, offsets, Israeli DST, and cancelled Outlook events normalize', () => {
  assert.equal(graphDateTime({ dateTime: '2026-09-15T10:00:00.0000000', timeZone: 'UTC' }), '2026-09-15T10:00:00.000Z')
  assert.equal(graphDateTime({ dateTime: '2026-09-15T10:00:00', timeZone: 'Israel Standard Time' }), '2026-09-15T07:00:00.000Z')
  assert.equal(graphDateTime({ dateTime: '2026-01-15T10:00:00', timeZone: 'Israel Standard Time' }), '2026-01-15T08:00:00.000Z')
  assert.equal(graphDateTime({ dateTime: '2026-09-15T10:00:00+03:00' }), '2026-09-15T07:00:00.000Z')
  assert.deepEqual(normalizeGraphEvents([{ isCancelled: true }]), [])
})
test('dates cross week, year, leap-year and overdue boundaries', () => {
  assert.equal(isoLocal(weekStart(new Date(2027, 0, 1))), '2026-12-27')
  assert.equal(isoLocal(addDays(new Date(2028, 1, 28), 1)), '2028-02-29')
  assert.equal(dueLabel('2026-09-14', '2026-09-15'), 'Overdue')
  assert.equal(dueLabel('2026-09-15', '2026-09-15'), 'Today')
  assert.equal(dueLabel(null), 'No due date')
})
test('goal database mapping preserves editable fields', () => {
  const row = { id: 'goal', title: 'Complete Certification', category: 'Study', start_date: '2026-01-01', target_date: '2028-03-01', progress: 50, status: 'Paused', notes: 'Keep this' }
  const { updated_at, ...roundTrip } = goalToRow(goalFromRow(row))
  const { id, ...expected } = row
  assert.deepEqual(roundTrip, expected)
  assert.ok(updated_at)
})
test('calendar clips overnight events and lays out overlaps', () => {
  const day = new Date(2026, 8, 15)
  const events = [
    { id: 'overnight', start: new Date(2026, 8, 14, 23).toISOString(), end: new Date(2026, 8, 15, 1).toISOString() },
    { id: 'a', start: new Date(2026, 8, 15, 9).toISOString(), end: new Date(2026, 8, 15, 11).toISOString() },
    { id: 'b', start: new Date(2026, 8, 15, 10).toISOString(), end: new Date(2026, 8, 15, 12).toISOString() },
  ]
  const segments = daySegments(events, day)
  assert.equal(segments[0].startMinute, 0)
  assert.equal(segments[0].endMinute, 60)
  assert.equal(segments[1].lanes, 2)
  assert.notEqual(segments[1].lane, segments[2].lane)
})
test('Graph pages lists/tasks/events fully, filters completion, and uses GET only', async () => {
  const calls = []
  const fetcher = async (url, options) => {
    calls.push({ url, method: options.method })
    let body
    if (url.includes('/todo/lists?')) body = { value: [{ id: 'certification', displayName: 'Certification' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/list-page-2' }
    else if (url.endsWith('/list-page-2')) body = { value: [{ id: 'home', displayName: 'Home' }] }
    else if (url.includes('/certification/tasks')) body = { value: [{ id: 'done', status: 'completed' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/task-page-2' }
    else if (url.endsWith('/task-page-2')) body = { value: [{ id: 'open', status: 'notStarted', title: 'Study' }] }
    else body = { value: [] }
    return Response.json(body)
  }
  const result = await fetchMicrosoftSnapshot('test-token', { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' }, new AbortController().signal, fetcher)
  assert.deepEqual(result.tasks.map((task) => task.id), ['open'])
  assert.equal(calls.length, 7)
  assert.equal(calls.filter((call) => call.url.includes('/outlook/masterCategories?')).length, 1)
  assert.ok(calls.every((call) => call.method === 'GET'))
})
test('partial Graph errors reject the entire snapshot and foreign nextLinks receive no token', async () => {
  let calls = 0
  await assert.rejects(graphPages('me/todo/lists', 'test-token', undefined, async () => {
    calls++; return Response.json({ value: [], '@odata.nextLink': 'https://untrusted.example/steal' })
  }), /Unexpected Microsoft paging URL/)
  assert.equal(calls, 1)
  await assert.rejects(fetchMicrosoftSnapshot('test-token', {}, undefined, async (url) => {
    if (url.includes('/todo/lists?')) return Response.json({ value: [{ id: 'list', displayName: 'Home' }] })
    return new Response('', { status: 403 })
  }), /403/)
})

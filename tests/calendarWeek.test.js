import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { addDays, isoLocal, weekStart } from '../src/lib/dates.js'
import { daySegments } from '../src/lib/calendarLayout.js'

test('every day belongs to a Sunday-Saturday week at local midnight without mutating its input', () => {
  for (let day = 13; day <= 19; day++) {
    const input = new Date(2026, 8, day, 23, 59, 59, 999)
    const original = input.getTime()
    const start = weekStart(input)
    assert.equal(isoLocal(start), '2026-09-13')
    assert.deepEqual([start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()], [0, 0, 0, 0])
    assert.deepEqual(Array.from({ length: 7 }, (_, index) => addDays(start, index).getDay()), [0, 1, 2, 3, 4, 5, 6])
    assert.equal(isoLocal(addDays(start, 6)), '2026-09-19')
    assert.equal(input.getTime(), original)
  }
})

test('Saturday ends the current week and Sunday midnight begins the next week', () => {
  assert.equal(isoLocal(weekStart(new Date(2026, 8, 12, 23, 59, 59, 999))), '2026-09-06')
  assert.equal(isoLocal(weekStart(new Date(2026, 8, 13))), '2026-09-13')
  assert.equal(isoLocal(weekStart(new Date(2026, 8, 19, 23, 59, 59, 999))), '2026-09-13')
  assert.equal(isoLocal(weekStart(new Date(2026, 8, 20))), '2026-09-20')
})

test('previous and next Sunday boundaries cross months and years', () => {
  for (const [today, first, last, previous, next] of [
    [new Date(2026, 8, 1), '2026-08-30', '2026-09-05', '2026-08-23', '2026-09-06'],
    [new Date(2027, 0, 1), '2026-12-27', '2027-01-02', '2026-12-20', '2027-01-03'],
  ]) {
    const start = weekStart(today)
    assert.equal(isoLocal(start), first)
    assert.equal(isoLocal(addDays(start, 6)), last)
    assert.equal(isoLocal(addDays(start, -7)), previous)
    assert.equal(isoLocal(addDays(start, 7)), next)
    assert.equal(addDays(start, -7).getDay(), 0)
    assert.equal(addDays(start, 7).getDay(), 0)
  }
})

test('Sunday and Saturday overnight events retain clipping and planning overlap lanes', () => {
  for (const day of [new Date(2026, 8, 13), new Date(2026, 8, 19)]) {
    const at = (date, hour) => { const value = new Date(date); value.setHours(hour); return value.toISOString() }
    const events = [
      { id: 'overnight', start: at(addDays(day, -1), 23), end: at(day, 1) },
      { id: 'outlook', start: at(day, 9), end: at(day, 11) },
      { id: 'planning', source: 'planning', start: at(day, 10), end: at(day, 12) },
      { id: 'late', start: at(day, 23), end: at(addDays(day, 1), 1) },
      { id: 'all-day', isAllDay: true, start: at(day, 0), end: at(addDays(day, 1), 0) },
      { id: 'next-day', start: at(addDays(day, 1), 0), end: at(addDays(day, 1), 1) },
      { id: 'ends-at-midnight', start: at(addDays(day, -1), 23), end: at(day, 0) },
    ]
    const segments = daySegments(events, day)
    assert.deepEqual(segments.map((event) => event.id), ['overnight', 'outlook', 'planning', 'late'])
    assert.deepEqual([segments[0].startMinute, segments[0].endMinute], [0, 60])
    assert.deepEqual([segments[3].startMinute, segments[3].endMinute], [1380, 1440])
    assert.equal(segments[1].lanes, 2)
    assert.equal(segments[2].lanes, 2)
    assert.notEqual(segments[1].lane, segments[2].lane)
  }
})

test('week boundaries use local dates east/west of UTC and calendar days across DST', () => {
  for (const [zone, instant, expected, hours] of [
    ['Asia/Jerusalem', '2026-09-12T21:30:00Z', '2026-09-13', 168],
    ['America/Los_Angeles', '2026-09-13T06:30:00Z', '2026-09-06', 168],
    ['America/New_York', '2026-03-08T16:00:00Z', '2026-03-08', 167],
    ['America/New_York', '2026-11-01T17:00:00Z', '2026-11-01', 169],
    ['Asia/Jerusalem', '2026-10-25T10:00:00Z', '2026-10-25', 169],
  ]) {
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { weekStart, addDays, isoLocal } from './src/lib/dates.js';
      const start = weekStart(new Date('${instant}'));
      const next = addDays(start, 7);
      assert.equal(isoLocal(start), '${expected}');
      assert.equal(start.getDay(), 0);
      assert.equal(next.getDay(), 0);
      assert.equal(start.getHours(), 0);
      assert.equal(next.getHours(), 0);
      assert.equal((next - start) / 3600000, ${hours});
      assert.equal(addDays(next, -7).getTime(), start.getTime());
    `], { env: { ...process.env, TZ: zone } })
  }
})

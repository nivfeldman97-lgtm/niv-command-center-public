import { isoLocal } from './dates.js'
import { listMapping } from './mappings.js'
import { normalizeColorHex, outlookEventColor } from './outlookColors.js'

const windowsZones = { UTC: 'UTC', 'Israel Standard Time': 'Asia/Jerusalem', 'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin', 'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver', 'Pacific Standard Time': 'America/Los_Angeles', 'AUS Eastern Standard Time': 'Australia/Sydney' }
export function graphDateTime(value) {
  if (!value?.dateTime) return null
  const raw = value.dateTime.replace(/(\.\d{3})\d+/, '$1')
  if (/(Z|[+-]\d{2}:\d{2})$/i.test(raw)) return new Date(raw).toISOString()
  const zone = windowsZones[value.timeZone] || value.timeZone || 'UTC'
  if (zone === 'UTC' || zone === 'Etc/UTC') return new Date(`${raw}Z`).toISOString()
  const format = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const wall = new Date(`${raw}Z`).getTime()
  let instant = wall
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
    const rendered = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
    const correction = wall - rendered
    instant += correction
    if (!correction) break
  }
  return new Date(instant).toISOString()
}
export const isActiveTask = (task) => String(task.status || '').toLowerCase() !== 'completed'
export function normalizeGraphTasks(tasks, list) {
  return tasks.filter(isActiveTask).map((task) => {
    const dueAt = graphDateTime(task.dueDateTime)
    return { id: task.id, title: task.title || 'Untitled task', listId: list.id, list: list.displayName,
      ...listMapping(list.displayName), dueAt, dueDate: dueAt ? isoLocal(new Date(dueAt)) : null,
      important: task.importance === 'high', status: task.status || 'notStarted', updatedAt: task.lastModifiedDateTime || null }
  })
}
export function normalizeCachedTasks(rows) {
  // All task boundaries apply this rule, including old cloud caches.
  return rows.filter(isActiveTask).map((row) => ({ id: row.microsoft_task_id, title: row.title,
    listId: row.microsoft_list_id, list: row.list_name, ...listMapping(row.list_name),
    dueAt: row.due_at, dueDate: row.due_at ? isoLocal(new Date(row.due_at)) : null,
    important: row.important, status: row.status, updatedAt: row.microsoft_updated_at }))
}
export function normalizeGraphEvents(events, categoryColors = new Map(), calendar = null) {
  return events.filter((event) => !event.isCancelled).map((event) => ({ id: event.id, title: event.subject || 'Untitled event',
    start: graphDateTime(event.start), end: graphDateTime(event.end), isAllDay: !!event.isAllDay,
    location: event.location?.displayName || '', updatedAt: event.lastModifiedDateTime || null, source: 'outlook',
    colorHex: outlookEventColor(event, categoryColors, calendar) }))
}
export const normalizeCachedEvents = (rows) => rows.map((row) => ({ id: row.microsoft_event_id, title: row.title, start: row.start_at, end: row.end_at, isAllDay: row.is_all_day, location: row.location, updatedAt: row.microsoft_updated_at, source: 'outlook', colorHex: normalizeColorHex(row.color_hex) }))
export const taskCacheRow = (task) => ({ microsoft_task_id: task.id, microsoft_list_id: task.listId, title: task.title, list_name: task.list, list_type: task.listType, category: task.category, due_at: task.dueAt, important: task.important, status: task.status, microsoft_updated_at: task.updatedAt })
export const eventCacheRow = (event) => ({ microsoft_event_id: event.id, title: event.title, start_at: event.start, end_at: event.end, is_all_day: event.isAllDay, location: event.location, microsoft_updated_at: event.updatedAt, color_hex: normalizeColorHex(event.colorHex) })

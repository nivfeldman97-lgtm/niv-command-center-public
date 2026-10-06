import { supabase } from './supabase.js'
import { eventCacheRow, taskCacheRow, isActiveTask, normalizeCachedEvents, normalizeCachedTasks } from './microsoftModels.js'
async function readAll(table, userId) {
  const rows = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from(table).select('*').eq('user_id', userId).order('id').range(offset, offset + 499)
    if (error) throw error
    rows.push(...data)
    if (data.length < 500) return rows
  }
}
async function metadata(userId) {
  const { data, error } = await supabase.from('microsoft_sync_state').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}
export async function readMicrosoftCache(userId) {
  // Guard paginated reads against a concurrent replacement from another device.
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await metadata(userId)
    const [tasks, events] = await Promise.all([readAll('cached_todo_tasks', userId), readAll('cached_calendar_events', userId)])
    const after = await metadata(userId)
    if (before?.synced_at !== after?.synced_at) continue
    return { tasks: normalizeCachedTasks(tasks), events: normalizeCachedEvents(events), syncedAt: after?.synced_at || null,
      coverage: after ? { start: after.calendar_start, end: after.calendar_end } : null }
  }
  throw new Error('Another device is syncing. Retry loading the cache.')
}
export async function startMicrosoftSync() {
  const { data, error } = await supabase.rpc('microsoft_sync_clock')
  if (error) throw error
  return data
}
export async function saveMicrosoftCache(snapshot, range, startedAt, accountId, userId) {
  const { data, error } = await supabase.rpc('replace_microsoft_cache', {
    p_tasks: snapshot.tasks.filter(isActiveTask).map(taskCacheRow), p_events: snapshot.events.map(eventCacheRow),
    p_calendar_start: range.start, p_calendar_end: range.end, p_started_at: startedAt, p_account_id: accountId,
    p_expected_user_id: userId,
  })
  if (error) throw error
  return data
}

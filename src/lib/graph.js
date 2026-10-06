import { normalizeGraphEvents, normalizeGraphTasks } from './microsoftModels.js'
import { outlookCategoryColors, outlookEventColor } from './outlookColors.js'
const ROOT = 'https://graph.microsoft.com/v1.0/'
async function graphGet(path, token, signal, fetcher) {
  const target = new URL(path, ROOT)
  if (target.origin !== 'https://graph.microsoft.com' || !target.pathname.startsWith('/v1.0/')) throw new Error('Unexpected Microsoft paging URL')
  let response
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetcher(target.href, { method: 'GET', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(30000)]), headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } })
    if (![429, 503].includes(response.status) || attempt === 2) break
    const retryAfter = response.headers.get('Retry-After'), seconds = Number(retryAfter)
    if (retryAfter && (!Number.isFinite(seconds) || seconds > 10)) break
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, seconds || 2 ** attempt) * 1000))
    signal?.throwIfAborted()
  }
  if (!response.ok) {
    const failure = new Error(`Microsoft Graph returned HTTP ${response.status}`)
    failure.status = response.status
    throw failure
  }
  return response.json()
}

export async function graphPages(path, token, signal, fetcher = fetch) {
  let url = new URL(path, ROOT).href
  const rows = [], visited = new Set()
  while (url) {
    if (visited.has(url)) throw new Error('Repeated Microsoft paging URL')
    visited.add(url)
    const page = await graphGet(url, token, signal, fetcher)
    if (!Array.isArray(page.value)) throw new Error('Invalid Microsoft Graph response')
    rows.push(...page.value)
    url = page['@odata.nextLink'] || null
  }
  return rows
}
export async function fetchMicrosoftSnapshot(token, range, signal, fetcher = fetch) {
  const lists = await graphPages('me/todo/lists?$top=100', token, signal, fetcher)
  const tasks = []
  // Complete every list before committing; sequential requests avoid bursts.
  for (const list of lists) {
    const rows = await graphPages(`me/todo/lists/${encodeURIComponent(list.id)}/tasks?$top=100`, token, signal, fetcher)
    tasks.push(...normalizeGraphTasks(rows, list))
  }
  const query = new URLSearchParams({ startDateTime: range.start, endDateTime: range.end, '$top': '1000' })
  const rows = await graphPages(`me/calendarView?${query}`, token, signal, fetcher)
  const categoryColors = outlookCategoryColors(await graphPages('me/outlook/masterCategories?$select=displayName,color', token, signal, fetcher))
  // /me/calendarView contains only the default calendar. Resolve that calendar
  // once per sync, only when a non-cancelled event needs its color. No per-event
  // lookups or metadata retained across Microsoft accounts/syncs.
  let calendar = null
  if (rows.some((event) => !event.isCancelled && !outlookEventColor(event, categoryColors))) {
    calendar = await graphGet('me/calendar?$select=id,hexColor,color', token, signal, fetcher)
    if (!calendar || typeof calendar.id !== 'string') throw new Error('Invalid Microsoft calendar response')
  }
  const events = normalizeGraphEvents(rows, categoryColors, calendar)
  return { tasks, events }
}
export function microsoftError(error) {
  const code = String(error.errorCode || error.code || ''), message = String(error.message || '')
  if (code === 'interaction_in_progress') return 'Microsoft sign-in is still active. Finish it or close the popup and wait for sign-in to time out before connecting again.'
  if (code === 'timed_out') return 'Microsoft sign-in did not finish. Close any remaining sign-in popup, then use Connect Microsoft to try again.'
  if (code === 'access_denied') return 'Microsoft sign-in was cancelled or access was denied. Use Connect Microsoft to try again.'
  if (/consent|65001|90094/i.test(`${code} ${message}`)) return 'Microsoft requires approval from your organization. See MICROSOFT_SETUP.md.'
  if (/53000|53001|53003|conditional|device/i.test(`${code} ${message}`)) return 'Your organization requires an approved device or access policy. Try your corporate PC with IT approval.'
  if (/user_cancelled|popup_window_error/i.test(code)) return 'Microsoft sign-in was cancelled or the popup was blocked. Try Connect Microsoft again.'
  if (error.status === 401 || /interaction_required|login_required/i.test(code)) return 'Microsoft sign-in has expired. Connect Microsoft again.'
  if (error.status === 403) return 'Microsoft denied access. Check delegated permissions and organizational approval.'
  if (error.status === 429) return 'Microsoft is limiting requests. Wait a little and sync again.'
  return 'Microsoft is unavailable. Your last available snapshot is still shown; you can retry later.'
}

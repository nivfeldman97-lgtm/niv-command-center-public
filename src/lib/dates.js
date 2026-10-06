export const dateFromIso = (value) => new Date(`${value}T00:00:00`)
export function isoLocal(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
export function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
export function weekStart(date = new Date()) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  // Native getDay() is Sunday = 0; every calendar week starts at local Sunday midnight.
  return addDays(start, -start.getDay())
}
export const timeLabel = (date) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
export function dueLabel(date, today = isoLocal(new Date())) {
  if (!date) return 'No due date'
  if (date < today) return 'Overdue'
  if (date === today) return 'Today'
  if (date === isoLocal(addDays(dateFromIso(today), 1))) return 'Tomorrow'
  return dateFromIso(date).toLocaleDateString([], { day: 'numeric', month: 'short' })
}
export function localInput(date) {
  const value = new Date(date)
  return `${isoLocal(value)}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}
export function humanUntil(date, now = new Date()) {
  const minutes = Math.max(0, Math.ceil((new Date(date) - now) / 60000))
  if (!minutes) return 'now'
  if (minutes < 60) return `in ${minutes}m`
  if (minutes < 1440) return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `in ${Math.floor(minutes / 1440)}d`
}

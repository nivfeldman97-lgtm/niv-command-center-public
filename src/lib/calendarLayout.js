import { addDays } from './dates.js'

// Clip multi-day events to each local day and assign lanes to overlapping events.
export function daySegments(events, day) {
  const dayEnd = addDays(day, 1)
  const segments = events.filter((event) => !event.isAllDay && new Date(event.start) < dayEnd && new Date(event.end) > day).map((event) => {
    const start = new Date(Math.max(new Date(event.start), day))
    const end = new Date(Math.min(new Date(event.end), dayEnd))
    const startMinute = start.getHours() * 60 + start.getMinutes()
    const endMinute = end.getTime() === dayEnd.getTime() ? 1440 : end.getHours() * 60 + end.getMinutes()
    return { ...event, startMinute, endMinute: Math.max(endMinute, startMinute + 15) }
  }).sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute)
  let group = [], ends = [], groupEnd = -1
  function finish() { group.forEach((event) => { event.lanes = ends.length }) }
  for (const event of segments) {
    if (event.startMinute >= groupEnd) { finish(); group = []; ends = []; groupEnd = -1 }
    let lane = ends.findIndex((end) => end <= event.startMinute)
    if (lane === -1) lane = ends.length
    ends[lane] = event.endMinute
    event.lane = lane
    group.push(event)
    groupEnd = Math.max(groupEnd, event.endMinute)
  }
  finish()
  return segments
}

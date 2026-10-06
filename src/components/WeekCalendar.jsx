import { useEffect, useRef } from 'react'
import { addDays, isoLocal, timeLabel, weekStart } from '../lib/dates.js'
import { daySegments } from '../lib/calendarLayout.js'
import { outlookEventStyle } from '../lib/outlookColors.js'
import DataNotice from './DataNotice.jsx'

export default function WeekCalendar({ start, onWeekChange, events, blocks, onNewBlock, onEditBlock, now, coverage }) {
  const scroll = useRef(null)
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 7 * 58 }, [])
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index))
  const items = [...events, ...blocks.rows]
  const rangeEnd = addDays(start, 7)
  const covered = coverage && new Date(coverage.start) <= start && new Date(coverage.end) >= rangeEnd
  const visible = items.filter((event) => new Date(event.start) < rangeEnd && new Date(event.end) > start)
  return <section className="panel">
    <div className="panel-head"><div><h2>Week calendar</h2><div className="subtle">{start.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} – {days[6].toLocaleDateString([], { day: 'numeric', month: 'short' })}</div></div>
      <div className="legend"><span><i className="dot" style={{ background: '#2563eb' }} />Outlook · read only</span><span><i className="dot" style={{ background: 'var(--planning)' }} />Planning · editable</span></div></div>
    <div className="calendar-tools"><div className="gantt-tools"><button className="btn compact" aria-label="Previous week" onClick={() => onWeekChange(addDays(start, -7))}>←</button><button className="btn compact" onClick={() => onWeekChange(weekStart(now))}>Today</button><button className="btn compact" aria-label="Next week" onClick={() => onWeekChange(addDays(start, 7))}>→</button></div><button className="btn compact" disabled={blocks.loading || blocks.busy || !!blocks.error} onClick={() => onNewBlock()}>+ Planning block</button></div>
    <DataNotice data={blocks} />
    {!covered && <div className="calendar-notice subtle">No Microsoft snapshot for this week yet. Connect or sync to refresh it.</div>}
    {!visible.length && <div className="calendar-notice subtle">No events or planning blocks this week.</div>}
    <div className="calendar-wrap" ref={scroll}><div className="calendar">
      <div className="cal-head"><div /><>{days.map((day) => <div className={isoLocal(day) === isoLocal(now) ? 'today' : ''} key={isoLocal(day)}>{day.toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</div>)}</></div>
      <div className="all-day-label">All day</div>{days.map((day) => <div className="all-day" key={isoLocal(day)}>{events.filter((event) => event.isAllDay && new Date(event.start) < addDays(day, 1) && new Date(event.end) > day).map((event) => <div key={event.id} style={outlookEventStyle(event.colorHex)} title={event.title}>{event.title}</div>)}</div>)}
      <div className="time-col">{Array.from({ length: 24 }, (_, hour) => <div className="time" key={hour}>{String(hour).padStart(2, '0')}:00</div>)}</div>
      {days.map((day) => <div className="daycol" key={isoLocal(day)}>
        {isoLocal(day) === isoLocal(now) && <div className="now-line" style={{ top: (now.getHours() + now.getMinutes() / 60) * 58 }} />}
        {daySegments(items, day).map((event) => {
          const planning = event.source === 'planning'
          const style = { top: event.startMinute / 60 * 58, height: Math.max(22, (event.endMinute - event.startMinute) / 60 * 58 - 3), left: `calc(${event.lane * 100 / event.lanes}% + 3px)`, width: `calc(${100 / event.lanes}% - 6px)`, right: 'auto' }
          if (!planning) Object.assign(style, outlookEventStyle(event.colorHex))
          const title = `${event.title}\n${timeLabel(event.start)}–${timeLabel(event.end)}${event.location ? `\n${event.location}` : ''}\n${planning ? 'Click to edit planning block' : 'Outlook · read only'}`
          return planning ? <button type="button" key={`plan:${event.id}`} className="event plan" style={style} title={title} disabled={blocks.busy} onClick={() => onEditBlock(blocks.rows.find((block) => block.id === event.id))}><b>{timeLabel(event.start)}</b>{event.title}</button> : <div key={`outlook:${event.id}`} className="event outlook" style={style} title={title}><b>{timeLabel(event.start)}</b>{event.title}</div>
        })}
      </div>)}
    </div></div>
    <div className="calendar-notice subtle">Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}. Click a planning block to edit its dates and times.</div>
  </section>
}

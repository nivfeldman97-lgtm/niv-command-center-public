import { humanUntil, isoLocal, timeLabel } from '../lib/dates.js'
import { filterTasks } from '../lib/dashboardToday.js'

export default function SummaryCards({ tasks, events, blocks, now, microsoftLoading, dashboardToday }) {
  const today = isoLocal(now)
  const next = events.filter((event) => new Date(event.end) > now).sort((a, b) => new Date(a.start) - new Date(b.start))[0]
  const todayTasks = filterTasks(tasks, 'Today', today, dashboardToday.selected)
  const courses = tasks.filter((task) => task.listType === 'course')
  const counts = courses.reduce((all, task) => ({ ...all, [task.list]: (all[task.list] || 0) + 1 }), {})
  const planningToday = blocks.filter((block) => isoLocal(new Date(block.start)) === today).length
  return <section className="summary">
    <div className="metric summary-image"><img src="/focus.svg" alt="Abstract blue gradient" /></div>
    <div className="metric"><div className="metric-head"><small>Next event</small><span className="metric-icon">↗</span></div>
      <strong>{next?.title || (microsoftLoading ? 'Loading schedule…' : 'No upcoming Outlook event')}</strong>
      <span className="meta">{next ? `${new Date(next.start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${next.isAllDay ? 'All day' : timeLabel(next.start)} · ${humanUntil(next.start, now)}` : 'Connect Microsoft or refresh your cached schedule.'}</span>
    </div>
    <div className="metric"><div className="metric-head"><small>Today focus</small><span className="metric-icon">◎</span></div><strong>{todayTasks.length} task{todayTasks.length === 1 ? '' : 's'} in Dashboard Today</strong><span className="meta">{tasks.filter((task) => task.important).length} important · {planningToday} planning blocks today · {tasks.length} open</span></div>
    <div className="metric"><div className="metric-head"><small>Study snapshot</small><span className="metric-icon">▤</span></div><strong className="accent">{courses.length} course task{courses.length === 1 ? '' : 's'}</strong><span className="meta">{Object.entries(counts).map(([name, count]) => `${name} ${count}`).join(' · ') || 'No active course tasks'}</span></div>
  </section>
}

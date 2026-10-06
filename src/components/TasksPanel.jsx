import { useState } from 'react'
import { CATEGORIES } from '../lib/mappings.js'
import { dueLabel, isoLocal } from '../lib/dates.js'
import { filterTasks, taskKey } from '../lib/dashboardToday.js'
import DataNotice from './DataNotice.jsx'
const FILTERS = ['All', 'Today', 'Important', 'Courses', 'Overdue']
export default function TasksPanel({ tasks, now, loading, onPlan, planningAvailable, dashboardToday }) {
  const [filter, setFilter] = useState('All')
  const today = isoLocal(now)
  const filtered = filterTasks(tasks, filter, today, dashboardToday.selected)
  return <aside className="panel">
    <div className="panel-head"><div><h2>Microsoft To Do</h2><div className="subtle">Read only · active tasks</div></div><span className="subtle">{tasks.length} open</span></div>
    <div className="filters">{FILTERS.map((item) => <button key={item} aria-pressed={filter === item} className={`chip ${filter === item ? 'active' : ''}`} onClick={() => setFilter(item)}>{item}</button>)}</div>
    <div className="subtle today-help">Dashboard Today: due today + your selections for today.</div>
    <DataNotice data={dashboardToday} />
    <div className="tasks">{loading ? <div className="empty" role="status">Loading tasks…</div> : filtered.length ? filtered.map((task) => <div className="task" key={`${task.listId}:${task.id}`}>
      <div className="check" aria-hidden="true" /><div><div className="task-title">{task.title} {task.important && <span className="star" aria-label="Important">★</span>}</div><div className="task-meta"><span className="listrow"><i className="listcolor" style={{ background: CATEGORIES[task.category] }} />{task.list}</span><span className="badge">{task.category}</span></div>
        <div className="task-actions"><button className="plan-task" disabled={!planningAvailable} onClick={() => onPlan(task)}>Plan time</button>
          <button className="today-task" disabled={dashboardToday.loading || dashboardToday.busy || !!dashboardToday.error}
            aria-pressed={dashboardToday.selected.has(taskKey(task))}
            title={`${dashboardToday.selected.has(taskKey(task)) ? 'Remove from' : 'Add to'} Dashboard Today for this device’s local date. Microsoft due date stays unchanged.`}
            aria-label={`${dashboardToday.selected.has(taskKey(task)) ? 'Remove from Today' : 'Add to Today'}: ${task.title}`}
            onClick={() => dashboardToday.setSelected(task, !dashboardToday.selected.has(taskKey(task)))}>
            {dashboardToday.selected.has(taskKey(task)) ? 'Remove from Today' : 'Add to Today'}
          </button></div></div>
      <div className={`due ${task.dueDate && task.dueDate < today ? 'overdue' : ''}`}>{dueLabel(task.dueDate, today)}</div>
    </div>) : <div className="empty">No active tasks in this view.</div>}</div>
  </aside>
}

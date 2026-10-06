export const CATEGORIES = {
  Work: '#4056d6', Study: '#7c3aed', Personal: '#f59e0b', Home: '#8b5e3c',
  Health: '#1597d4', Finance: '#16a34a', Leisure: '#e11d48',
  Growth: '#64748b', Routine: '#8b5cf6',
}
export const STATUSES = ['Planned', 'Active', 'Done', 'Paused']
// Generic examples. Match these names to your own Microsoft To Do lists.
export const COURSE_LISTS = ['Study', 'Learning', 'Training', 'Certification']
const domains = Object.fromEntries(Object.keys(CATEGORIES).map((name) => [name, name]))
export function listMapping(name) {
  const normalized = name.trim().toLowerCase()
  const course = COURSE_LISTS.some((list) => list.toLowerCase() === normalized)
  const match = Object.keys(domains).find((list) => list.toLowerCase() === normalized)
  return { category: course ? 'Study' : domains[match] || 'Personal', listType: course ? 'course' : 'list' }
}
export const goalFromRow = (row) => ({
  id: row.id, title: row.title, start: row.start_date, end: row.target_date,
  category: row.category || 'Personal', progress: row.progress ?? 0,
  status: row.status || 'Planned', notes: row.notes || '',
})
export const goalToRow = (goal) => ({
  title: goal.title.trim(), start_date: goal.start, target_date: goal.end,
  category: goal.category, progress: Number(goal.progress), status: goal.status,
  notes: goal.notes || '', updated_at: new Date().toISOString(),
})
export const milestoneFromRow = (row) => ({ id: row.id, goalId: row.goal_id, title: row.title, date: row.target_date, status: row.status || 'Planned' })
export const milestoneToRow = (item) => ({ goal_id: item.goalId, title: item.title.trim(), target_date: item.date, status: item.status })
export const blockFromRow = (row) => ({ id: row.id, taskId: row.microsoft_task_id, title: row.title, start: row.start_at, end: row.end_at, category: row.category || 'Personal', source: 'planning' })
export const blockToRow = (item) => ({ microsoft_task_id: item.taskId || null, title: item.title.trim(), start_at: new Date(item.start).toISOString(), end_at: new Date(item.end).toISOString(), category: item.category, updated_at: new Date().toISOString() })

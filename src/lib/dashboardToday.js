import { isActiveTask } from './microsoftModels.js'

export const taskKey = (task) => JSON.stringify([task.listId, task.id])
export function todaySelectionKeys(rows, today) {
  return new Set(rows.filter((row) => row.local_date === today).map((row) =>
    taskKey({ listId: row.microsoft_list_id, id: row.microsoft_task_id })))
}

// Filter the authoritative open task set; selection rows never create tasks.
export function filterTasks(tasks, filter, today, selected = new Set()) {
  return tasks.filter((task) => isActiveTask(task) && (filter === 'All'
    || (filter === 'Today' && (task.dueDate === today || selected.has(taskKey(task))))
    || (filter === 'Important' && task.important)
    || (filter === 'Courses' && task.listType === 'course')
    || (filter === 'Overdue' && task.dueDate && task.dueDate < today)))
}

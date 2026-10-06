import { useCloudRows } from './useCloudRows.js'
import { goalFromRow, goalToRow, milestoneFromRow, milestoneToRow } from '../lib/mappings.js'

export function useGoals(userId) {
  const goals = useCloudRows(userId, 'goals', goalFromRow, goalToRow)
  const milestones = useCloudRows(userId, 'milestones', milestoneFromRow, milestoneToRow)
  async function removeGoal(id) {
    await goals.remove(id)
    milestones.setRows((rows) => rows.filter((row) => row.goalId !== id))
  }
  return { goals, milestones, removeGoal }
}

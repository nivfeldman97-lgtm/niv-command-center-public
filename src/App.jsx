import { useState } from 'react'
import { useAuth } from './hooks/useAuth.js'
import { useGoals } from './hooks/useGoals.js'
import { useCloudRows } from './hooks/useCloudRows.js'
import { useMicrosoftData } from './hooks/useMicrosoftData.js'
import { useNow } from './hooks/useNow.js'
import { useDashboardToday } from './hooks/useDashboardToday.js'
import { blockFromRow, blockToRow } from './lib/mappings.js'
import { addDays, isoLocal, weekStart } from './lib/dates.js'
import Login from './components/Login.jsx'
import SummaryCards from './components/SummaryCards.jsx'
import WeekCalendar from './components/WeekCalendar.jsx'
import TasksPanel from './components/TasksPanel.jsx'
import Gantt from './components/Gantt.jsx'
import GoalDrawer from './components/GoalDrawer.jsx'
import PlanningBlockDrawer from './components/PlanningBlockDrawer.jsx'
import MicrosoftSync from './components/MicrosoftSync.jsx'
import DataNotice from './components/DataNotice.jsx'

function Dashboard({ userId, signOut, authError }) {
  const { goals, milestones, removeGoal } = useGoals(userId)
  const blocks = useCloudRows(userId, 'planning_blocks', blockFromRow, blockToRow)
  const now = useNow()
  const dashboardToday = useDashboardToday(userId, isoLocal(now))
  const [week, setWeek] = useState(() => weekStart())
  const microsoft = useMicrosoftData(userId, week)
  const [goalDrawer, setGoalDrawer] = useState(null)
  const [blockDrawer, setBlockDrawer] = useState(null)
  function newGoal() {
    setGoalDrawer({ title: '', start: isoLocal(new Date()), end: isoLocal(addDays(new Date(), 90)), category: 'Personal', progress: 0, status: 'Planned', notes: '' })
  }
  function newBlock(task) {
    const start = new Date()
    start.setMinutes(0, 0, 0)
    start.setHours(start.getHours() + 1)
    // Calendar toolbar uses the viewed week; task planning starts from today.
    if (!task && week.getTime() !== weekStart().getTime()) { start.setFullYear(week.getFullYear(), week.getMonth(), week.getDate()); start.setHours(9) }
    setBlockDrawer({ title: task?.title || '', taskId: task?.id || null, category: task?.category || 'Personal', start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString() })
  }
  async function saveGoal(goal) {
    const saved = await goals.save(goal)
    if (goal.id) setGoalDrawer(null)
    else setGoalDrawer(saved) // Keep a newly saved goal open for its first milestones.
  }
  async function deleteGoal(id) { await removeGoal(id); setGoalDrawer(null) }
  return <>
    <div className="app">
      <div className="topbar"><div className="brand"><h1>Niv Command Center</h1><p>Outlook = time · Microsoft To Do = tasks · Gantt = direction</p></div><div className="top-actions"><button className="btn" onClick={signOut}>Sign out</button><button className="btn primary" disabled={goals.loading || goals.busy || !!goals.error} onClick={newGoal}>+ New goal</button></div></div>
      {authError && <div className="notice error" role="alert">{authError}</div>}
      <MicrosoftSync data={{ ...microsoft, loadCache: () => Promise.all([microsoft.loadCache(), dashboardToday.reload()]) }} />
      <SummaryCards tasks={microsoft.tasks} events={microsoft.events} blocks={blocks.rows} now={now} microsoftLoading={microsoft.loading} dashboardToday={dashboardToday} />
      <div className="grid"><div className="stack">
        <WeekCalendar start={week} onWeekChange={setWeek} events={microsoft.events} blocks={blocks} onNewBlock={newBlock} onEditBlock={setBlockDrawer} now={now} coverage={microsoft.coverage} />
        <div><DataNotice data={goals} /><DataNotice data={milestones} />
          {!goals.loading && <Gantt state={{ goals: [...goals.rows].sort((a, b) => a.start.localeCompare(b.start)), milestones: milestones.rows }} busy={goals.busy || !!goals.error} onNewGoal={newGoal} onEditGoal={(id) => { if (!goals.busy) setGoalDrawer(goals.rows.find((goal) => goal.id === id)) }} onGoalDatesChange={(goal, start, end) => goals.save({ ...goal, start, end })} />}
        </div>
      </div><TasksPanel tasks={microsoft.tasks} now={now} loading={microsoft.loading} onPlan={newBlock} planningAvailable={!blocks.loading && !blocks.busy && !blocks.error} dashboardToday={dashboardToday} /></div>
    </div>
    {goalDrawer && <GoalDrawer key={goalDrawer.id || 'new'} goal={goalDrawer} onClose={() => setGoalDrawer(null)} onSave={saveGoal} onDelete={deleteGoal} milestones={milestones} busy={goals.busy} />}
    {blockDrawer && <PlanningBlockDrawer key={blockDrawer.id || 'new'} block={blockDrawer} onClose={() => setBlockDrawer(null)} onSave={blocks.save} onDelete={blocks.remove} busy={blocks.busy} />}
  </>
}

export default function App() {
  const auth = useAuth()
  if (!auth.ready) return <div className="app"><div className="panel login-panel" role="status">Loading your session...</div></div>
  if (!auth.session) return <Login initialError={auth.error} />
  // Unmount all personal state on logout/account changes; no old user's data can flash.
  return <Dashboard key={auth.session.user.id} userId={auth.session.user.id} signOut={auth.signOut} authError={auth.error} />
}

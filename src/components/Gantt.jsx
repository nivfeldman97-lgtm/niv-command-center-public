import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES } from '../lib/mappings.js'
import { dateFromIso, isoLocal, clamp, addDays } from '../lib/dates.js'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Gantt({ state, onEditGoal, onNewGoal, onGoalDatesChange, busy }) {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const draggingRef = useRef(false)
  const cleanupRef = useRef(null)
  const [preview, setPreview] = useState(null)
  useEffect(() => () => cleanupRef.current?.(), [])

  const yearStart = useMemo(
    () => new Date(`${year}-01-01T00:00:00`),
    [year]
  )

  const yearEnd = useMemo(
    () => new Date(`${year + 1}-01-01T00:00:00`),
    [year]
  )

  function pctForDate(dt) {
    return ((dt - yearStart) / (yearEnd - yearStart)) * 100
  }

  function pointerDown(event, goal) {
    if (event.button !== 0 || busy) return
    cleanupRef.current?.()

    event.preventDefault()

    const timeline = event.currentTarget.parentElement
    const rect = timeline.getBoundingClientRect()
    const startX = event.clientX

    const initialStart = dateFromIso(goal.start)
    const initialEnd = dateFromIso(goal.end)

    let finalStart = new Date(initialStart)
    let finalEnd = new Date(initialEnd)

    const mode = event.target.classList.contains('left')
      ? 'left'
      : event.target.classList.contains('right')
        ? 'right'
        : 'move'

    draggingRef.current = false

    const move = (moveEvent) => {
      const dx = moveEvent.clientX - startX

      if (Math.abs(dx) > 3) {
        draggingRef.current = true
      }

      if (!draggingRef.current) return
      const days = Math.round((dx / rect.width) * ((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000))

      let nextStart = new Date(initialStart)
      let nextEnd = new Date(initialEnd)

      if (mode === 'move') {
        nextStart.setDate(nextStart.getDate() + days)
        nextEnd.setDate(nextEnd.getDate() + days)
      } else if (mode === 'left') {
        nextStart.setDate(nextStart.getDate() + days)

        if (nextStart >= nextEnd) {
          nextStart = addDays(nextEnd, -1)
        }
      } else {
        nextEnd.setDate(nextEnd.getDate() + days)

        if (nextEnd <= nextStart) {
          nextEnd = addDays(nextStart, 1)
        }
      }

      finalStart = new Date(nextStart)
      finalEnd = new Date(nextEnd)

      setPreview({ id: goal.id, start: isoLocal(nextStart), end: isoLocal(nextEnd) })
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      cleanupRef.current = null
    }
    const up = async () => {
      cleanup()
      if (draggingRef.current) {
        try { await onGoalDatesChange(goal, isoLocal(finalStart), isoLocal(finalEnd)) }
        catch { /* DataNotice reports the error; removing the preview restores confirmed dates. */ }
      }
      setPreview(null)
      window.setTimeout(() => { draggingRef.current = false }, 60)
    }
    const cancel = () => { cleanup(); setPreview(null); draggingRef.current = false }
    cleanupRef.current = cleanup
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Long-term Gantt</h2>
          <div className="subtle">
            Editable directly here · drag bars · resize edges · click to edit
          </div>
        </div>

        <div className="gantt-tools">
          <button
            aria-label="Previous year"
            className="btn"
            onClick={() => setYear((current) => current - 1)}
          >
            ←
          </button>

          <span className="subtle">{year}</span>

          <button
            aria-label="Next year"
            className="btn"
            onClick={() => setYear((current) => current + 1)}
          >
            →
          </button>

          <button
            className="btn primary compact"
            disabled={busy} onClick={onNewGoal}
          >
            + Goal
          </button>
        </div>
      </div>

      {!state.goals.length && <div className="empty">No goals yet. Add a goal to start planning.</div>}
      <div className="gantt-wrap">
        <div className="gantt">
          <div className="g-months">
            <div>GOAL</div>

            {MONTHS.map((month) => (
              <div key={month}>{month}</div>
            ))}
          </div>

          {state.goals.map((savedGoal) => {
            const goal = preview?.id === savedGoal.id ? { ...savedGoal, ...preview } : savedGoal
            const start = dateFromIso(goal.start)
            const end = dateFromIso(goal.end)

            let left = clamp(pctForDate(start), 0, 100)
            let right = clamp(pctForDate(addDays(end, 1)), 0, 100)

            if (end < yearStart || start >= yearEnd) {
              left = 0
              right = 0
            }

            const width = Math.max(0, right - left)

            const milestones = state.milestones.filter(
              (item) => item.goalId === goal.id
            )

            return (
              <div className="g-row" key={goal.id}>
                <div
                  className="g-label"
                  role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onEditGoal(goal.id) }} onClick={() => onEditGoal(goal.id)}
                >
                  <i
                    className="dot"
                    style={{
                      background: CATEGORIES[goal.category],
                    }}
                  />

                  <div>
                    <strong>{goal.title}</strong>
                    <small>
                      {goal.progress}% · {goal.status}
                    </small>
                  </div>
                </div>

                <div className="g-timeline">
                  {width > 0 && (
                    <div
                      className="bar"
                      onPointerDown={(event) =>
                        pointerDown(event, goal)
                      }
                      onClick={() => {
                        if (!draggingRef.current) {
                          onEditGoal(goal.id)
                        }
                      }}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: CATEGORIES[goal.category],
                        '--progress': `${goal.progress}%`,
                      }}
                    >
                      <span className="handle left" />

                      {goal.title}

                      <span className="handle right" />
                    </div>
                  )}

                  {milestones.map((milestone) => {
                    const position = pctForDate(
                      dateFromIso(milestone.date)
                    )

                    return position >= 0 && position <= 100
                      ? (
                        <div
                          key={
                            milestone.id ??
                            `${milestone.goalId}-${milestone.date}`
                          }
                          className="milestone"
                          title={`${milestone.title} ? ${milestone.date} ? ${milestone.status}`}
                          style={{
                            left: `calc(${position}% - 7px)`,
                          }}
                        />
                      )
                      : null
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

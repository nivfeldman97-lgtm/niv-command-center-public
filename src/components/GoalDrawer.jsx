import { useState } from 'react'
import { CATEGORIES, STATUSES } from '../lib/mappings.js'
import Drawer from './Drawer.jsx'
import MilestoneEditor from './MilestoneEditor.jsx'

export default function GoalDrawer({ goal, onClose, onSave, onDelete, milestones, busy }) {
  const [draft, setDraft] = useState(goal)
  const [error, setError] = useState('')
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  async function submit(event) {
    event.preventDefault()
    if (!draft.title.trim()) return setError('Enter a goal title.')
    if (draft.end < draft.start) return setError('Target date must be on or after the start date.')
    try { await onSave({ ...draft, title: draft.title.trim(), progress: Number(draft.progress) }) }
    catch (failure) { setError(failure.message) }
  }
  async function remove() {
    if (!window.confirm('Delete this goal and all its milestones?')) return
    try { await onDelete(goal.id) } catch (failure) { setError(failure.message) }
  }
  const locked = busy || milestones.busy
  return <Drawer title={goal.id ? 'Edit goal' : 'New goal'} onClose={onClose} busy={locked}>
    <form className="form" onSubmit={submit}><fieldset disabled={locked}>
      <div className="field"><label htmlFor="goal-title">Title</label><input id="goal-title" value={draft.title} required onChange={(e) => update('title', e.target.value)} /></div>
      <div className="two">
        <div className="field"><label htmlFor="goal-start">Start</label><input id="goal-start" type="date" required value={draft.start} onChange={(e) => update('start', e.target.value)} /></div>
        <div className="field"><label htmlFor="goal-target">Target</label><input id="goal-target" type="date" required value={draft.end} onChange={(e) => update('end', e.target.value)} /></div>
      </div>
      <div className="two">
        <div className="field"><label htmlFor="goal-category">Category</label><select id="goal-category" value={draft.category} onChange={(e) => update('category', e.target.value)}>{Object.keys(CATEGORIES).map((category) => <option key={category}>{category}</option>)}</select></div>
        <div className="field"><label htmlFor="goal-progress">Progress %</label><input id="goal-progress" type="number" min="0" max="100" step="1" required value={draft.progress} onChange={(e) => update('progress', e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="goal-status">Status</label><select id="goal-status" value={draft.status} onChange={(e) => update('status', e.target.value)}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></div>
      <div className="field"><label htmlFor="goal-notes">Notes</label><textarea id="goal-notes" value={draft.notes} onChange={(e) => update('notes', e.target.value)} /></div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="sheet-actions">{goal.id ? <button className="btn danger" type="button" onClick={remove}>Delete goal</button> : <span />}<div><button className="btn" type="button" onClick={onClose}>Cancel</button> <button className="btn primary">{busy ? 'Saving…' : 'Save goal'}</button></div></div>
    </fieldset></form>
    <MilestoneEditor goal={goal} data={milestones} disabled={busy} />
  </Drawer>
}

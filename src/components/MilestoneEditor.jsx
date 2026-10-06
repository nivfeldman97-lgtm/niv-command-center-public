import { useState } from 'react'
import { STATUSES } from '../lib/mappings.js'
import DataNotice from './DataNotice.jsx'

function MilestoneForm({ item, onSave, onDelete, onCancel, busy }) {
  const [draft, setDraft] = useState(item)
  const [error, setError] = useState('')
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  async function save(event) {
    event.preventDefault()
    if (!draft.title.trim()) return setError('Enter a milestone title.')
    try { await onSave(draft); onCancel() } catch (failure) { setError(failure.message) }
  }
  async function remove() {
    if (!window.confirm('Delete this milestone?')) return
    try { await onDelete(item.id); onCancel() } catch (failure) { setError(failure.message) }
  }
  return <form className="form milestone-form" onSubmit={save}>
    <fieldset disabled={busy}>
      <div className="field"><label htmlFor="milestone-title">Milestone title</label><input id="milestone-title" value={draft.title} required onChange={(e) => update('title', e.target.value)} /></div>
      <div className="two">
        <div className="field"><label htmlFor="milestone-date">Milestone date</label><input id="milestone-date" type="date" required value={draft.date} onChange={(e) => update('date', e.target.value)} /></div>
        <div className="field"><label htmlFor="milestone-status">Milestone status</label><select id="milestone-status" value={draft.status} onChange={(e) => update('status', e.target.value)}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="sheet-actions">{item.id && <button className="btn danger compact" type="button" onClick={remove}>Delete milestone</button>}<button className="btn compact" type="button" onClick={onCancel}>Cancel</button><button className="btn primary compact">Save milestone</button></div>
    </fieldset>
  </form>
}
export default function MilestoneEditor({ goal, data, disabled }) {
  const [editing, setEditing] = useState(null)
  if (!goal.id) return <section className="milestone-section"><h4>Milestones</h4><p className="subtle">Save this goal first to add milestones.</p></section>
  const items = data.rows.filter((item) => item.goalId === goal.id).sort((a, b) => a.date.localeCompare(b.date))
  return <section className="milestone-section">
    <h4>Milestones</h4><p className="subtle">Milestone changes save separately from the goal.</p>
    <DataNotice data={data} />
    {!data.loading && !data.error && !items.length && <p className="subtle">No milestones yet.</p>}
    {items.map((item) => <button key={item.id} className="milestone-item" disabled={disabled || data.busy} onClick={() => setEditing(item)}><span>◆ {item.title}</span><small>{item.date} · {item.status}</small></button>)}
    {editing ? <MilestoneForm key={editing.id || 'new'} item={editing} onSave={data.save} onDelete={data.remove} busy={data.busy || disabled} onCancel={() => setEditing(null)} /> : <button className="btn compact" disabled={data.loading || data.busy || disabled || !!data.error} onClick={() => setEditing({ goalId: goal.id, title: '', date: goal.end, status: 'Planned' })}>+ Milestone</button>}
  </section>
}

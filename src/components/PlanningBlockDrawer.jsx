import { useState } from 'react'
import { CATEGORIES } from '../lib/mappings.js'
import { localInput } from '../lib/dates.js'
import Drawer from './Drawer.jsx'

export default function PlanningBlockDrawer({ block, onClose, onSave, onDelete, busy }) {
  const [draft, setDraft] = useState(() => ({ ...block, start: localInput(block.start), end: localInput(block.end) }))
  const [error, setError] = useState('')
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  async function submit(event) {
    event.preventDefault()
    if (!draft.title.trim()) return setError('Enter a planning block title.')
    if (new Date(draft.end) <= new Date(draft.start)) return setError('End time must be after start time.')
    try { await onSave(draft); onClose() } catch (failure) { setError(failure.message) }
  }
  async function remove() {
    if (!window.confirm('Delete this planning block?')) return
    try { await onDelete(block.id); onClose() } catch (failure) { setError(failure.message) }
  }
  return <Drawer title={block.id ? 'Edit planning block' : 'New planning block'} onClose={onClose} busy={busy}>
    <p className="subtle">Plan time here. Outlook events and To Do deadlines stay in Microsoft.</p>
    {block.taskId && <p className="subtle">Linked to a Microsoft To Do task.</p>}
    <form className="form" onSubmit={submit}><fieldset disabled={busy}>
      <div className="field"><label htmlFor="block-title">Title</label><input id="block-title" required value={draft.title} onChange={(e) => update('title', e.target.value)} /></div>
      <div className="field"><label htmlFor="block-start">Start time</label><input id="block-start" type="datetime-local" required value={draft.start} onChange={(e) => update('start', e.target.value)} /></div>
      <div className="field"><label htmlFor="block-end">End time</label><input id="block-end" type="datetime-local" required value={draft.end} onChange={(e) => update('end', e.target.value)} /></div>
      <div className="field"><label htmlFor="block-category">Category</label><select id="block-category" value={draft.category} onChange={(e) => update('category', e.target.value)}>{Object.keys(CATEGORIES).map((category) => <option key={category}>{category}</option>)}</select></div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="sheet-actions">{block.id ? <button className="btn danger" type="button" onClick={remove}>Delete block</button> : <span />}<button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary">{busy ? 'Saving…' : 'Save block'}</button></div>
    </fieldset></form>
  </Drawer>
}

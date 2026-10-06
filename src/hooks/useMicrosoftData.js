import { useCallback, useEffect, useRef, useState } from 'react'
import { addDays, weekStart } from '../lib/dates.js'
import { createMicrosoftConnection, microsoftConfigured } from '../lib/microsoft.js'
import { fetchMicrosoftSnapshot, microsoftError } from '../lib/graph.js'
import { readMicrosoftCache, saveMicrosoftCache, startMicrosoftSync } from '../lib/microsoftCache.js'

export function useMicrosoftData(userId, viewedWeek) {
  const [data, setData] = useState({ tasks: [], events: [], syncedAt: null, coverage: null })
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false), [source, setSource] = useState('none'), [error, setError] = useState('')
  const connection = useRef(null), active = useRef(false), lock = useRef(false), generation = useRef(0), controller = useRef(null)
  const loadCache = useCallback(async () => {
    const request = ++generation.current
    try {
      const cache = await readMicrosoftCache(userId)
      if (active.current && request === generation.current) { setData(cache); setSource(cache.syncedAt ? 'cache' : 'none'); setError('') }
    } catch (failure) {
      console.error('Microsoft cache load failed', failure)
      if (active.current && request === generation.current) setError('Microsoft cache unavailable. Check database setup or retry.')
    } finally { if (active.current && request === generation.current) setLoading(false) }
  }, [userId])
  useEffect(() => {
    active.current = true
    loadCache()
    return () => { active.current = false; generation.current++; controller.current?.abort(); connection.current?.clear().catch(() => {}) }
  }, [loadCache])
  async function sync(interactive = false) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); generation.current++
    const abort = new AbortController()
    controller.current = abort
    try {
      if (!connection.current) connection.current = await createMicrosoftConnection()
      abort.signal.throwIfAborted()
      const credentials = await connection.current.token(interactive)
      abort.signal.throwIfAborted()
      if (active.current) setConnected(true)
      let startedAt = null
      try { startedAt = await startMicrosoftSync() }
      catch (failure) { console.error('Cache sync setup unavailable', failure) }
      const current = weekStart()
      const range = { start: new Date(Math.min(addDays(current, -14), viewedWeek)).toISOString(), end: new Date(Math.max(addDays(current, 42), addDays(viewedWeek, 7))).toISOString() }
      const snapshot = await fetchMicrosoftSnapshot(credentials.token, range, abort.signal)
      abort.signal.throwIfAborted()
      if (!active.current) return
      setData({ ...snapshot, syncedAt: new Date().toISOString(), coverage: range }); setSource('live')
      try {
        if (!startedAt) throw new Error('Cache migration unavailable')
        const saved = await saveMicrosoftCache(snapshot, range, startedAt, credentials.accountId, userId)
        if (active.current) {
          if (saved.accepted) setData((currentData) => ({ ...currentData, syncedAt: saved.synced_at }))
          else { await loadCache(); setError('A newer sync from another device was kept.') }
        }
      } catch (failure) {
        console.error('Microsoft cache save failed', failure)
        if (active.current) setError('Live Microsoft data loaded, but cloud cache was not saved. Other devices still have the previous snapshot. Check database setup and retry.')
      }
    } catch (failure) {
      if (abort.signal.aborted) return
      console.error('Microsoft sync failed', { code: failure.errorCode, status: failure.status, message: failure.message })
      if (active.current) { await loadCache(); setConnected(false); setError(microsoftError(failure)) }
    } finally {
      lock.current = false
      if (abort.signal.aborted || !active.current) connection.current?.clear().catch(() => {})
      if (active.current) { setBusy(false); setLoading(false) }
    }
  }
  async function disconnect() {
    if (busy) return
    try { await connection.current?.clear(); connection.current = null; setConnected(false); await loadCache() }
    catch { setError('Could not clear Microsoft sign-in. Close this browser tab to clear its in-memory session.') }
  }
  return { ...data, loading, busy, connected, source, error, configured: microsoftConfigured, sync, disconnect, loadCache }
}

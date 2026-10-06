import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { isoLocal } from '../lib/dates.js'
import { todaySelectionKeys } from '../lib/dashboardToday.js'

const TABLE = 'dashboard_today_selections'
export function useDashboardToday(userId, today) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const mounted = useRef(false), generation = useRef(0), lock = useRef(false)
  const reload = useCallback(async () => {
    const request = ++generation.current
    const date = isoLocal(new Date())
    setLoading(true)
    try {
      const loaded = []
      for (let offset = 0; ; offset += 500) {
        const { data, error: failure } = await supabase.from(TABLE).select('*')
          .eq('user_id', userId).eq('local_date', date).order('id').range(offset, offset + 499)
        if (failure) throw failure
        if (!mounted.current || request !== generation.current) return
        loaded.push(...data)
        if (data.length < 500) break
      }
      if (mounted.current && request === generation.current) { setRows(loaded); setError('') }
    } catch {
      if (mounted.current && request === generation.current) setError('Could not load Dashboard Today selections. Retry or check database setup.')
    } finally {
      if (mounted.current && request === generation.current) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    mounted.current = true
    reload()
    const activate = () => { if (document.visibilityState === 'visible') reload() }
    window.addEventListener('focus', activate)
    document.addEventListener('visibilitychange', activate)
    return () => {
      mounted.current = false; generation.current++
      window.removeEventListener('focus', activate)
      document.removeEventListener('visibilitychange', activate)
    }
  }, [reload, today])

  async function setSelected(task, selected) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); generation.current++
    // Capture the actual device date at the click, even if a timer was throttled.
    const payload = { user_id: userId, microsoft_task_id: task.id, microsoft_list_id: task.listId, local_date: isoLocal(new Date()) }
    try {
      const query = selected
        ? supabase.from(TABLE).upsert(payload, { onConflict: 'user_id,local_date,microsoft_list_id,microsoft_task_id', ignoreDuplicates: true })
        : supabase.from(TABLE).delete().eq('user_id', userId).eq('local_date', payload.local_date)
          .eq('microsoft_list_id', task.listId).eq('microsoft_task_id', task.id)
      const { error: failure } = await query
      if (failure) throw failure
      if (mounted.current) await reload()
    } catch {
      if (mounted.current) setError('Could not save Dashboard Today selection. Your last confirmed choices are still shown. Please retry.')
    } finally {
      lock.current = false
      if (mounted.current) { setBusy(false); setLoading(false) }
    }
  }
  return { selected: todaySelectionKeys(rows, today), loading, busy, error, reload, setSelected }
}

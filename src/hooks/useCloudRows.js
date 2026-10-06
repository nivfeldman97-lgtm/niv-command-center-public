import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Only confirmed database rows enter this state. Drag previews live in the Gantt.
export function useCloudRows(userId, table, fromRow, toRow) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const mounted = useRef(false)
  const generation = useRef(0)
  const reload = useCallback(async () => {
    const request = ++generation.current
    setLoading(true)
    setError('')
    try {
      const rows = []
      for (let offset = 0; ; offset += 500) {
        const { data, error: failure } = await supabase.from(table).select('*').eq('user_id', userId).order('id').range(offset, offset + 499)
        if (failure) throw failure
        if (!mounted.current || request !== generation.current) return
        rows.push(...data)
        if (data.length < 500) break
      }
      if (mounted.current && request === generation.current) setRows(rows.map(fromRow))
    } catch (failure) {
      console.error(`Load ${table} failed`, failure)
      if (mounted.current && request === generation.current) setError(`Could not load ${table.replaceAll('_', ' ')}. Retry, or check database setup.`)
    } finally {
      if (mounted.current && request === generation.current) setLoading(false)
    }
  }, [userId, table, fromRow])
  useEffect(() => {
    mounted.current = true
    reload()
    return () => { mounted.current = false; generation.current++ }
  }, [reload])

  async function mutate(action) {
    if (lock.current) throw new Error('Please wait for the current save to finish.')
    lock.current = true
    setBusy(true)
    setError('')
    generation.current++
    try { return await action() }
    catch (failure) {
      console.error(`Change ${table} failed`, failure)
      const message = `Could not save ${table.replaceAll('_', ' ')}. Your last confirmed data is still shown. Please retry.`
      if (mounted.current) setError(message)
      throw new Error(message)
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const save = (item) => mutate(async () => {
    const payload = { ...toRow(item), user_id: userId }
    const query = item.id
      ? supabase.from(table).update(payload).eq('id', item.id).eq('user_id', userId)
      : supabase.from(table).insert(payload)
    const { data, error: failure } = await query.select().single()
    if (failure) throw failure
    const saved = fromRow(data)
    if (mounted.current) setRows((current) => [...current.filter((row) => row.id !== saved.id), saved])
    return saved
  })
  const remove = (id) => mutate(async () => {
    const result = await supabase.from(table).delete().eq('id', id).eq('user_id', userId).select('id')
    if (table === 'goals' && result.error?.code === '23503') {
      // Existing installations may use a non-cascading FK. The SQL helper makes
      // child + parent deletion atomic without changing that production FK.
      const { error: failure } = await supabase.rpc('delete_dashboard_goal', { p_goal_id: id })
      if (failure) throw failure
    } else {
      if (result.error) throw result.error
      if (!result.data?.length) throw new Error('Row not found or access denied')
    }
    if (mounted.current) setRows((current) => current.filter((row) => row.id !== id))
  })
  return { rows, loading, busy, error, reload, save, remove, setRows }
}

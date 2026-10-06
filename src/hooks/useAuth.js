import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

export function useAuth() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!supabase) { setReady(true); return }
    let active = true
    let authChanged = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      authChanged = true
      if (active) { setSession(next); setReady(true) }
    })
    supabase.auth.getSession().then(({ data, error: failure }) => {
      if (!active || authChanged) return
      if (failure) throw failure
      setSession(data.session)
      setReady(true)
    }).catch((failure) => {
      console.error('Session load failed', failure)
      if (active) { setError('Unable to restore your session. Please sign in again.'); setReady(true) }
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])
  async function signOut() {
    setError('')
    try {
      const { error: failure } = await supabase.auth.signOut({ scope: 'local' })
      if (failure) throw failure
      setSession(null)
    } catch (failure) {
      console.error('Sign out failed', failure)
      setError('Could not sign out. Please try again.')
    }
  }
  return { session, ready, error, signOut }
}

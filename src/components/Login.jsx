import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Login({ initialError }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function signIn(event) {
    event.preventDefault()
    // Read the actual controls so password-manager autofill does not depend on
    // React change events. Credentials are used only for this sign-in request.
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const { error: failure } = await supabase.auth.signInWithPassword({
        email: String(form.get('email') || ''), password: String(form.get('password') || ''),
      })
      if (failure) throw failure
    } catch (failure) {
      console.error('Sign in failed', { code: failure.code, status: failure.status })
      setError('Sign in failed. Check your email and password, then try again.')
    } finally { setBusy(false) }
  }
  return <div className="app"><div className="panel login-panel">
    <h2>Niv Command Center</h2><p className="subtle">Private sign in</p>
    {!supabase ? <p role="alert">Supabase is not configured. Follow SUPABASE_SETUP.md to configure this device.</p> :
      <form className="form" method="post" onSubmit={signIn}>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
        {(error || initialError) && <div className="error" role="alert">{error || initialError}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>}
  </div></div>
}

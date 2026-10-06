// Reproducible PWA fixture build: no local .env files or inherited VITE values.
import { spawnSync } from 'node:child_process'
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_')))
Object.assign(env, {
  VITE_SUPABASE_URL: 'https://dashboard-test.supabase.invalid',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  VITE_SUPABASE_ANON_KEY: '', VITE_MS_CLIENT_ID: '', VITE_MS_TENANT_ID: '', VITE_MS_REDIRECT_URI: '',
})
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'test'], { env, stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)

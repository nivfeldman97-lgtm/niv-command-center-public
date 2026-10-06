import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
// Missing configuration presents a private setup screen, never a demo dashboard.
export const supabase = url && key ? createClient(url, key, {
  // Supabase manages tokens in browser localStorage using its existing project
  // key. Preserve SDK storage detection and automatic token refresh.
  auth: { persistSession: true, autoRefreshToken: true },
}) : null

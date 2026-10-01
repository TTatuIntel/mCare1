/**
 * Connection to the mCare backend (Supabase: Postgres, sign-in, storage, real-time).
 *
 * The app runs in two modes:
 *   • demo    — no keys set: everything stays in memory, as the prototype always has
 *   • live    — VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set in `.env.local`
 *
 * The anon key is safe to ship in the browser: it grants nothing by itself.
 * Every table is protected by the row-level rules in supabase/migrations.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/** True when the app has been pointed at a Supabase project. */
export const backendConfigured = !!url && !!anonKey

let client: Promise<SupabaseClient> | undefined

/** The shared client. Loaded on first use, so demo mode never downloads it. */
export function getSupabase(): Promise<SupabaseClient> {
  if (!backendConfigured) return Promise.reject(new Error('Backend not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'))
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }))
  return client
}

export type BackendHealth =
  | { mode: 'demo' }
  | { mode: 'live'; ok: true; vitals: number }
  | { mode: 'live'; ok: false; error: string }

/**
 * Confirms the project is reachable and the schema is installed. Vital
 * definitions are readable only when signed in, so before sign-in a healthy
 * project answers with zero rows rather than an error.
 */
export async function checkBackend(): Promise<BackendHealth> {
  if (!backendConfigured) return { mode: 'demo' }
  try {
    const supabase = await getSupabase()
    const { count, error } = await supabase.from('vital_defs').select('id', { count: 'exact', head: true })
    if (error) return { mode: 'live', ok: false, error: /does not exist|schema cache/i.test(error.message) ? 'Database tables are missing — run supabase/migrations/0001_core.sql.' : error.message }
    return { mode: 'live', ok: true, vitals: count ?? 0 }
  } catch (e) {
    return { mode: 'live', ok: false, error: e instanceof Error ? e.message : 'Could not reach the backend.' }
  }
}

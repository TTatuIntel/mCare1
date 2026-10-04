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

const configured = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
/**
 * A URL starting with "/" means "the address this page was opened from": the
 * local backend sits behind the dev server (see vite.config.ts), so the same
 * setting works on the laptop and on a phone that opened the laptop's address.
 */
const url = configured?.startsWith('/') && typeof window !== 'undefined'
  ? `${window.location.origin}${configured.replace(/\/+$/, '')}` : configured

/** True when the app has been pointed at a Supabase project. */
export const backendConfigured = !!url && !!anonKey
/** The backend's address and public key, for the few requests made outside supabase-js (the local backend's change notices). */
export const backendUrl = url ?? ''
export const backendAnonKey = anonKey ?? ''

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
  | { mode: 'live'; ok: true }
  | { mode: 'live'; ok: false; error: string }

/**
 * Confirms the project is reachable and the schema is installed. It asks with
 * the public key only, never with a session: a session that has just ended
 * (the sign-in page right after "Sign out") would be refused and look like an
 * outage. Vital definitions are readable only when signed in, so a healthy
 * project answers this anonymous question with zero rows rather than an error.
 */
export async function checkBackend(): Promise<BackendHealth> {
  if (!backendConfigured) return { mode: 'demo' }
  try {
    const res = await fetch(`${url}/rest/v1/vital_defs?select=id&limit=1`, {
      headers: { apikey: anonKey!, Authorization: `Bearer ${anonKey}` }, cache: 'no-store',
    })
    if (res.ok) return { mode: 'live', ok: true }
    const body = await res.json().catch(() => ({})) as { code?: string; message?: string }
    const missing = body.code === '42P01' || body.code === 'PGRST205' || /does not exist|schema cache/i.test(body.message ?? '')
    return { mode: 'live', ok: false, error: missing ? 'The database tables are missing. Run the migrations in supabase/migrations.' : UNREACHABLE }
  } catch {
    return { mode: 'live', ok: false, error: UNREACHABLE }
  }
}

/**
 * True when the local backend (supabase/dev/server.mjs) is the one configured. It signs people in with
 * email and password only, so "Continue with Google…" is offered on a hosted project alone.
 */
export const localBackend = !!configured?.startsWith('/') || /\/\/(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(:|\/|$)/.test(configured ?? '')
const UNREACHABLE = localBackend
  ? 'mCare cannot reach its backend. Start it on the computer running the app: npm run backend'
  : 'mCare cannot reach its backend. Check your connection and try again.'

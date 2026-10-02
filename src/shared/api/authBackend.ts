/**
 * Real sign-in through Supabase Auth: email and password, emailed codes and
 * links, and "Continue with Google…".
 *
 * Only used in live mode (see ./supabase). Supabase proves who the person is;
 * the account that opens is read from the mCare `profiles` row the database
 * creates for every sign-up. In demo mode none of this runs: accounts stay in
 * memory and the stand-in sheet in SocialAuth.tsx plays the provider.
 */
import type { User } from '@supabase/supabase-js'
import type {
  AccountStatus, AdminUser, AppUser, ApprovalStatus, AssistantPerm, AuthProvider, DoctorUser, PatientUser,
} from '@/shared/lib/types'
import { backendConfigured, getSupabase, localBackend } from './supabase'

export type SocialProvider = Exclude<AuthProvider, 'email'>

/** mCare provider → Supabase provider id. Supabase has no Yahoo or Instagram provider, so those are demo-only. */
const BACKEND_ID: Partial<Record<SocialProvider, 'google' | 'apple' | 'facebook' | 'twitter'>> = {
  google: 'google', apple: 'apple', facebook: 'facebook', x: 'twitter',
}

/** Whether a provider button should be offered: all of them in demo mode, the connected ones on a hosted project, none on the local backend. */
export const providerAvailable = (p: SocialProvider) => !backendConfigured || (!localBackend && !!BACKEND_ID[p])

const landedOn = typeof window === 'undefined' ? '' : window.location.hash + window.location.search
/** True when this page load is a provider or an emailed link sending the person back to us. Read once, before the URL is cleaned. */
export const returningFromProvider = backendConfigured && /access_token=|[?&#]code=|error_description=/.test(landedOn)
/** True when this page load came from the "reset password" link in an email: ask for a new password, don't just sign in. */
export const returningToReset = backendConfigured && /type=recovery/.test(landedOn)

/** True when this browser holds a saved sign-in, so the sign-in page should wait for it instead of flashing up. */
export const mayHaveSession = backendConfigured && (() => {
  try { return Object.keys(localStorage).some(k => /^sb-.+-auth-token$/.test(k)) } catch { return false }
})()

const CONSENT_KEY = 'mcare-terms-accepted-at'

/** Remembers the Terms acceptance across the trip to the provider (or the inbox) and back. */
export function rememberConsent() {
  try { sessionStorage.setItem(CONSENT_KEY, String(Date.now())) } catch { /* private mode: consent is re-asked at next sign-up */ }
}
export function takeConsent(): number | undefined {
  try {
    const at = Number(sessionStorage.getItem(CONSENT_KEY))
    sessionStorage.removeItem(CONSENT_KEY)
    return at || undefined
  } catch { return undefined }
}

const UNREACHABLE = 'Could not reach the sign-in service. Check your connection and try again.'
const reason = (e: unknown) => (e instanceof Error && e.message) || UNREACHABLE

/** Sends the browser to the provider. Resolves with an error message only if it could not start. */
export async function startProviderSignIn(provider: SocialProvider, redirectTo: string): Promise<string | null> {
  const id = BACKEND_ID[provider]
  if (!id) return 'This sign-in option is not available yet.'
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.signInWithOAuth({ provider: id, options: { redirectTo } })
    return error?.message ?? null
  } catch (e) {
    return reason(e)
  }
}

export type BackendSession =
  | { ok: true; user: AppUser }
  | { ok: false; error?: string }

/* ─── The mCare account behind a signed-in person ───────────────────── */

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * Builds the app's user from the database rows for this person: `profiles`
 * plus the row for their role. The role and status come from the database,
 * never from anything the browser sent at sign-up.
 */
async function loadAccount(authUser: User): Promise<BackendSession> {
  const supabase = await getSupabase()
  if (!authUser.email) {
    await supabase.auth.signOut()
    return { ok: false, error: 'That account did not share an email address, which mCare needs. Try another way to sign in.' }
  }
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!profile) return { ok: false, error: 'Your sign-in worked, but your mCare profile is missing. Please contact support.' }

  const raw = authUser.app_metadata.provider
  const social = (Object.keys(BACKEND_ID) as SocialProvider[]).find(p => BACKEND_ID[p] === raw)
  const base = {
    id: authUser.id,
    name: profile.full_name as string,
    email: profile.email as string,
    phone: (profile.phone as string | null) ?? '',
    dob: (profile.dob as string | null) ?? undefined,
    status: profile.status as AccountStatus,
    createdAt: dateLabel(profile.created_at as string),
    avatar: profile.avatar ?? undefined,
    theme: profile.theme ?? undefined,
    fontSize: profile.font_size ?? undefined,
    // Supabase holds the password and the codes; the app never sees them.
    verificationCode: '',
    password: '',
    authProvider: (social ?? 'email') as AuthProvider,
  }

  if (profile.role === 'doctor') {
    const { data: d } = await supabase.from('doctors').select('*').eq('id', authUser.id).maybeSingle()
    const doctor: DoctorUser = {
      ...base, role: 'doctor',
      specialty: d?.specialty ?? '', licenseNo: d?.license_no ?? '', hospital: d?.hospital ?? '',
      approvalStatus: (d?.approval_status ?? 'pending') as ApprovalStatus,
      approvalNote: d?.approval_note ?? undefined, signature: d?.signature ?? undefined,
      assignedPatientIds: [],
    }
    return { ok: true, user: doctor }
  }
  if (profile.role === 'admin' || profile.role === 'assistant') {
    const { data: st } = await supabase.from('staff').select('*').eq('id', authUser.id).maybeSingle()
    const staff: AdminUser = {
      ...base, role: profile.role,
      isAssistant: profile.role === 'assistant' || !!st?.is_assistant,
      permissions: (st?.permissions ?? []) as AssistantPerm[],
    }
    return { ok: true, user: staff }
  }
  const { data: pt } = await supabase.from('patients').select('profile_setup, assigned_doctor_id').eq('id', authUser.id).maybeSingle()
  const patient: PatientUser = {
    ...base, role: 'patient',
    assignedDoctorId: pt?.assigned_doctor_id ?? undefined,
    profileSetup: pt?.profile_setup === 'done' ? 'done' : pt?.profile_setup === 'skipped' ? 'skipped' : 'pending',
    trackedVitalIds: ['bp', 'hr'], thresholds: {}, prescriptions: [], readings: [], emergencyContacts: [],
  }
  return { ok: true, user: patient }
}

/* ─── Session ───────────────────────────────────────────────────────── */

let signingOut: Promise<unknown> = Promise.resolve()
let resumed: Promise<BackendSession> | undefined

/**
 * The account already signed in on this browser, if any: a returning visit,
 * or the trip back from a provider or an emailed link. Read once per page
 * load (and again after a sign-out), so a remount of the sign-in screen gets
 * the same answer, including a refusal already cleared from the URL.
 */
export function resumeBackendSession(): Promise<BackendSession> {
  return (resumed ??= readBackendSession())
}

async function readBackendSession(): Promise<BackendSession> {
  if (!backendConfigured) return { ok: false }
  // A cancelled or refused sign-in, or an expired email link, is reported in the URL.
  const params = new URLSearchParams(window.location.hash.replace(/^#/, '') || window.location.search)
  const refused = params.get('error_description')
  if (refused) {
    window.history.replaceState(null, '', window.location.pathname)
    return { ok: false, error: refused.replace(/\+/g, ' ') }
  }
  try {
    await signingOut
    const supabase = await getSupabase()
    const { data, error } = await supabase.auth.getSession()
    if (error) return { ok: false, error: error.message }
    return data.session ? await loadAccount(data.session.user) : { ok: false }
  } catch (e) {
    return { ok: false, error: reason(e) }
  }
}

/** Ends the Supabase session too, so signing out of mCare is not undone on the next load. */
export function signOutBackend() {
  if (!backendConfigured) return
  resumed = undefined
  signingOut = getSupabase().then(s => s.auth.signOut()).catch(() => undefined)
}

/* ─── Email and password ────────────────────────────────────────────── */

export type EmailSignIn = BackendSession | { ok: false; unconfirmed: true; error?: undefined }

export async function signInWithEmail(email: string, password: string): Promise<EmailSignIn> {
  try {
    const supabase = await getSupabase()
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      if (error.code === 'email_not_confirmed') return { ok: false, unconfirmed: true }
      // One message for a wrong email and a wrong password, so neither is revealed.
      return { ok: false, error: error.code === 'invalid_credentials' ? 'Incorrect email or password.' : error.message }
    }
    return await loadAccount(data.user)
  } catch (e) {
    return { ok: false, error: reason(e) }
  }
}

/** `phone` is the full number with its country code. Birth date is not asked for at sign-up; it is added later from the profile. */
export interface SignUpDetails { name: string; email: string; phone: string; password: string }

/**
 * Creates the account. Resolves with `user` when it can be used straight
 * away, or without one when the emailed code or link must be confirmed first.
 */
export async function signUpWithEmail(d: SignUpDetails, redirectTo: string): Promise<{ ok: true; user?: AppUser } | { ok: false; error: string }> {
  try {
    const supabase = await getSupabase()
    const { data, error } = await supabase.auth.signUp({
      email: d.email.trim(), password: d.password,
      options: { emailRedirectTo: redirectTo, data: { full_name: d.name.trim(), phone: d.phone.trim() } },
    })
    if (error) return { ok: false, error: error.message }
    // Supabase answers a taken email with a look-alike user that has no identities.
    if (data.user && data.user.identities?.length === 0) return { ok: false, error: 'An account with this email already exists. Sign in instead.' }
    if (!data.session || !data.user) return { ok: true }
    const account = await loadAccount(data.user)
    return account.ok ? account : { ok: false, error: account.error ?? UNREACHABLE }
  } catch (e) {
    return { ok: false, error: reason(e) }
  }
}

/** Proves the 6-digit code from the sign-up or reset email. Signs the person in on success. */
export async function verifyEmailCode(email: string, code: string, purpose: 'signup' | 'recovery'): Promise<BackendSession> {
  try {
    const supabase = await getSupabase()
    const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: purpose })
    if (error || !data.user) return { ok: false, error: 'That code is incorrect or has expired.' }
    return await loadAccount(data.user)
  } catch (e) {
    return { ok: false, error: reason(e) }
  }
}

export async function resendSignUpCode(email: string, redirectTo: string): Promise<string | null> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: redirectTo } })
    return error?.message ?? null
  } catch (e) {
    return reason(e)
  }
}

/** Emails a reset code and link. Succeeds whether or not the email is registered, so it can't be used to look people up. */
export async function sendPasswordReset(email: string, redirectTo: string): Promise<string | null> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
    return error?.message ?? null
  } catch (e) {
    return reason(e)
  }
}

/** Sets a new password for the person signed in by a reset code or link. */
export async function setNewPassword(password: string): Promise<string | null> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.updateUser({ password })
    return error?.message ?? null
  } catch (e) {
    return reason(e)
  }
}

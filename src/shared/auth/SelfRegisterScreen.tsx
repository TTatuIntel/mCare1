import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { PatientUser } from '@/shared/lib/types'
import { calcAge } from '@/shared/lib/vitals'
import { MIN_PASSWORD_LEN, isEmail, passwordIssue } from '@/shared/state/auth'
import { AuthButton, AuthField, AuthHeading, IconInput, PasswordInput, PasswordMeter, authInputCls, AuthDivider } from './authKit'
import { SocialButtons } from './SocialAuth'
import { Consent } from './Legal'
import { useAdoptAccount } from './LiveAuth'
import { backendConfigured } from '@/shared/api/supabase'
import { rememberConsent, signUpWithEmail } from '@/shared/api/authBackend'
import { appBaseUrl } from '@/shared/email/emailTemplate'

/**
 * Patient sign-up on one screen: details, password and consent together, so
 * the account is created from here. Email verification follows (see
 * VerificationScreen). The logo above the form is the way back to welcome.
 */
export function SelfRegisterScreen({ onSignIn, onConfirm }: {
  onSignIn?: () => void
  /** Live mode: the account exists and its confirmation email has been sent to this address. */
  onConfirm?: (email: string) => void
}) {
  const { users, addUser, setCurrentUser } = useApp()
  const [form, setForm] = useState({ name: '', email: '', phone: '', dob: '', password: '' })
  const [error, setError] = useState('')
  /** Only complain about the email once the user has left the field. */
  const [emailTouched, setEmailTouched] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const adopt = useAdoptAccount()
  const today = new Date().toISOString().slice(0, 10)

  const set = (key: keyof typeof form, value: string) => { setForm(f => ({ ...f, [key]: value })); setError('') }

  const emailOk = isEmail(form.email)
  const mismatch = !!confirm && confirm !== form.password
  const ready = !!form.name.trim() && emailOk && !passwordIssue(form.password) && confirm === form.password && agreed && !busy
  const age = form.dob ? calcAge(form.dob) : null

  /** Live mode: the backend creates the account and emails the confirmation. */
  const registerLive = async () => {
    setBusy(true)
    rememberConsent()
    const res = await signUpWithEmail(form, appBaseUrl())
    setBusy(false)
    if (!res.ok) setError(res.error)
    else if (res.user) adopt(res.user)
    else onConfirm?.(form.email.trim())
  }

  const handleRegister = () => {
    if (!ready) return
    if (backendConfigured) { registerLive(); return }
    const emailTaken = users.some(u => u.email.toLowerCase() === form.email.trim().toLowerCase())
    if (emailTaken) { setError('An account with this email already exists.'); return }
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const newPatient: PatientUser = {
      id: `p_${Date.now()}`,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      dob: form.dob || undefined,
      role: 'patient',
      status: 'unverified',
      createdAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      verificationCode: code,
      password: form.password,
      authProvider: 'email',
      termsAcceptedAt: Date.now(),
      trackedVitalIds: ['bp', 'hr'],
      thresholds: {},
      prescriptions: [],
      readings: [],
      emergencyContacts: [],
      profileSetup: 'pending',
    }
    addUser(newPatient)
    setCurrentUser(newPatient)
  }

  return (
    <form className="auth-stagger flex flex-col gap-2.5 @2xl:gap-3" onSubmit={e => { e.preventDefault(); handleRegister() }}>
      <AuthHeading center title="Get started" />

      <AuthField label="Full name">
        <IconInput icon="user">
          <input type="text" autoComplete="name" autoFocus required value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="Grace Otieno" className={`${authInputCls} pl-10`} />
        </IconInput>
      </AuthField>

      <AuthField label="Email" error={emailTouched && !!form.email && !emailOk ? 'Enter a valid email address.' : undefined}>
        <IconInput icon="mail">
          <input type="email" autoComplete="email" inputMode="email" required value={form.email}
            onChange={e => set('email', e.target.value)} onBlur={() => setEmailTouched(true)}
            placeholder="you@example.com" className={`${authInputCls} pl-10`} />
        </IconInput>
      </AuthField>

      {/* Every field gets a full row of its own, like the two above. */}
      <AuthField label="Phone (optional)">
        <IconInput icon="phone">
          <input type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
            placeholder="+254 712 345 678" className={`${authInputCls} pl-10`} />
        </IconInput>
      </AuthField>

      <AuthField label={age !== null ? `Birth date · age ${age}` : 'Birth date (optional)'}>
        <IconInput icon="calendar">
          {/* Empty, it reads like the other placeholders. */}
          <input type="date" autoComplete="bday" value={form.dob} max={today} onChange={e => set('dob', e.target.value)}
            className={`${authInputCls} pl-10 ${form.dob ? '' : 'text-gray-400'}`} />
        </IconInput>
      </AuthField>

      <AuthField label="Password">
        <PasswordInput value={form.password} onChange={v => set('password', v)}
          placeholder={`${MIN_PASSWORD_LEN}+ characters, Aa and 1`} autoComplete="new-password" />
      </AuthField>
      <PasswordMeter value={form.password} />

      <AuthField label="Confirm password" error={mismatch ? 'Passwords don’t match.' : undefined}>
        <PasswordInput value={confirm} onChange={v => { setConfirm(v); setError('') }}
          placeholder="Repeat your password" invalid={mismatch} autoComplete="new-password" />
      </AuthField>

      <Consent checked={agreed} onChange={setAgreed} />

      {error && <p role="alert" className="auth-shake text-xs text-red-500 text-center">{error}</p>}

      <AuthButton type="submit" disabled={!ready}>{busy ? 'Creating…' : 'Sign up'}</AuthButton>

      {/* The quick way: the provider vouches for the email, so there is no code to type. */}
      <AuthDivider>or</AuthDivider>
      <SocialButtons />

      {onSignIn && (
        <p className="text-center text-xs text-gray-600">
          Have an account?{' '}
          <button type="button" onClick={onSignIn} className="font-bold text-teal-700 underline underline-offset-4 hover:text-teal-800">Sign in</button>
        </p>
      )}
    </form>
  )
}

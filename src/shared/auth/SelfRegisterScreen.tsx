import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { PatientUser } from '@/shared/lib/types'
import { MIN_PASSWORD_LEN, PHONE_COUNTRIES, fullPhone, isEmail, passwordIssue, type PhoneCountry } from '@/shared/state/auth'
import { AuthButton, AuthField, AuthHeading, AuthSwitch, IconInput, PasswordInput, PasswordMeter, PhoneInput, authInputCls, AuthDivider } from './authKit'
import { SocialButtons } from './SocialAuth'
import { Consent } from './Legal'
import { useAdoptAccount } from './LiveAuth'
import { backendConfigured } from '@/shared/api/supabase'
import { rememberConsent, signUpWithEmail } from '@/shared/api/authBackend'
import { appBaseUrl } from '@/shared/email/emailTemplate'

/**
 * Patient sign-up on one screen: name, email, phone, password and consent, so
 * the account is created from here. Nothing optional is asked: birth date and
 * the rest are added later from the profile. Email verification follows
 * (see VerificationScreen). The logo above the form is the way back to welcome.
 */
export function SelfRegisterScreen({ onSignIn, onConfirm }: {
  onSignIn?: () => void
  /** Live mode: the account exists and its confirmation email has been sent to this address. */
  onConfirm?: (email: string) => void
}) {
  const { users, addUser, setCurrentUser } = useApp()
  /** `phone` is what is typed beside the country code. */
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' })
  const [country, setCountry] = useState<PhoneCountry>(PHONE_COUNTRIES[0])
  const [error, setError] = useState('')
  /** Only complain about the email or phone once the user has left the field. */
  const [emailTouched, setEmailTouched] = useState(false)
  const [phoneTouched, setPhoneTouched] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const adopt = useAdoptAccount()

  const set = (key: keyof typeof form, value: string) => { setForm(f => ({ ...f, [key]: value })); setError('') }

  const emailOk = isEmail(form.email)
  const mismatch = !!confirm && confirm !== form.password
  const phone = fullPhone(country, form.phone)
  const phoneBad = phoneTouched && !!form.phone && !phone
  const ready = !!form.name.trim() && emailOk && !!phone && !passwordIssue(form.password) && confirm === form.password && agreed && !busy

  /** Live mode: the backend creates the account and emails the confirmation. */
  const registerLive = async () => {
    setBusy(true)
    rememberConsent()
    const res = await signUpWithEmail({ ...form, phone: phone ?? '' }, appBaseUrl())
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
      phone: phone ?? '',
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
    <form className="auth-stagger flex flex-col gap-3" onSubmit={e => { e.preventDefault(); handleRegister() }}>
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

      <AuthField label="Phone number" error={phoneBad ? `Enter a valid ${country.name} number.` : undefined}>
        <PhoneInput country={country} onCountry={c => { setCountry(c); setError('') }} invalid={phoneBad}
          value={form.phone} onChange={v => set('phone', v)} onBlur={() => setPhoneTouched(true)} />
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
      <AuthDivider>Or continue with</AuthDivider>
      <SocialButtons />

      {onSignIn && <AuthSwitch prompt="Already have an account?" action="Sign in" onClick={onSignIn} />}
    </form>
  )
}

import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import MCareLogo from '@/shared/layout/MCareLogo'
import type { PatientUser } from '@/shared/lib/types'
import { calcAge } from '@/shared/lib/vitals'
import { MIN_PASSWORD_LEN, isEmail, passwordIssue } from '@/shared/state/auth'
import { AuthBack, AuthButton, AuthField, AuthHeading, PasswordInput, PasswordMeter, StepBar, SIGNUP_STEPS, authInputCls, AuthDivider } from './authKit'
import { SocialButtons } from './SocialAuth'
import { Consent } from './Legal'
import { useAdoptAccount } from './LiveAuth'
import { backendConfigured } from '@/shared/api/supabase'
import { rememberConsent, signUpWithEmail } from '@/shared/api/authBackend'
import { appBaseUrl } from '@/shared/email/emailTemplate'

/** The card steps; email verification follows as the last step (see VerificationScreen). */
const STEPS = [
  { label: 'Your details', title: 'Create your account', subtitle: 'Your name and the email you will sign in with.' },
  { label: 'Password',     title: 'Secure your account', subtitle: `At least ${MIN_PASSWORD_LEN} characters, with upper and lowercase letters and a number.` },
]

export function SelfRegisterScreen({ onBack, onSignIn, onConfirm }: {
  onBack: () => void; onSignIn?: () => void
  /** Live mode: the account exists and its confirmation email has been sent to this address. */
  onConfirm?: (email: string) => void
}) {
  const { users, addUser, setCurrentUser } = useApp()
  const [form, setForm] = useState({ name: '', email: '', phone: '', dob: '', password: '' })
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const adopt = useAdoptAccount()
  const today = new Date().toISOString().slice(0, 10)

  const set = (key: keyof typeof form, value: string) => { setForm(f => ({ ...f, [key]: value })); setError('') }

  const emailOk = isEmail(form.email)
  const stepReady = [
    !!form.name.trim() && emailOk,
    !passwordIssue(form.password) && agreed && !busy,
  ][step]
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
    if (backendConfigured) { registerLive(); return }
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

  const next = () => {
    if (!stepReady) return
    if (step === 0 && !backendConfigured) {
      // Catch a taken email here, before the user fills in the rest.
      const emailTaken = users.some(u => u.email.toLowerCase() === form.email.trim().toLowerCase())
      if (emailTaken) { setError('An account with this email already exists.'); return }
    }
    if (step < STEPS.length - 1) setStep(step + 1)
    else handleRegister()
  }

  const { label, title, subtitle } = STEPS[step]

  return (
    <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); next() }}>
      <div className="flex items-center justify-between gap-2">
        <AuthBack onClick={() => { setError(''); if (step === 0) onBack(); else setStep(step - 1) }} />
        <div className="flex-1 flex justify-center">
          <div className="scale-75 origin-center">
            <MCareLogo size="sm" />
          </div>
        </div>
        <div className="w-6" />
      </div>
      <StepBar step={step + 1} total={SIGNUP_STEPS} label={label} />

      <div key={step} className="screen-in flex flex-col gap-2.5">
        <AuthHeading title={title} subtitle={subtitle} />

        {step === 0 && <>
          <AuthField label="Full Name *">
            <input type="text" autoComplete="name" autoFocus value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Grace Otieno" className={authInputCls} />
          </AuthField>
          <AuthField label="Email Address *">
            <input type="email" autoComplete="email" value={form.email} onChange={e => set('email', e.target.value)}
              placeholder="you@example.com" className={authInputCls} />
          </AuthField>
          {/* Optional, side by side so the whole step fits one screen. */}
          <div className="grid grid-cols-2 gap-3">
            <AuthField label="Phone (optional)">
              <input type="tel" autoComplete="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
                placeholder="+254 7XX…" className={`${authInputCls} px-3`} />
            </AuthField>
            <AuthField label="Date of Birth" hint={age !== null ? `Age: ${age} years` : undefined}>
              <input type="date" autoComplete="bday" value={form.dob} max={today} onChange={e => set('dob', e.target.value)}
                className={`${authInputCls} px-3`} />
            </AuthField>
          </div>
        </>}

        {step === 1 && <>
          {/* One password box: Show lets you check it, so there is nothing to retype. */}
          <AuthField label="Password *">
            <PasswordInput value={form.password} onChange={v => set('password', v)}
              placeholder="Create a password" autoComplete="new-password" />
          </AuthField>
          <PasswordMeter value={form.password} />
          <Consent checked={agreed} onChange={setAgreed} />
        </>}
      </div>

      {error && <p role="alert" className="auth-shake text-xs text-red-500 text-center mt-1">{error}</p>}

      <AuthButton type="submit" disabled={!stepReady} className="mt-1">
        {step < STEPS.length - 1 ? 'Continue' : busy ? 'Creating your account…' : 'Create Account & Verify'}
      </AuthButton>

      {/* The quick way: the provider vouches for the email, so there is no code to type. */}
      {step === 0 && <>
        <AuthDivider>Or sign up with</AuthDivider>
        <SocialButtons />
      </>}

      {onSignIn && (
        <p className="text-xs text-gray-500 text-center mt-1">
          Already have an account?{' '}
          <button type="button" onClick={onSignIn} className="text-teal-700 font-bold">Sign in</button>
        </p>
      )}
    </form>
  )
}

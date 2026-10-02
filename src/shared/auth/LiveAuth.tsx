/**
 * The sign-in card steps that only exist in live mode, where Supabase sends
 * the emails and checks the codes: confirming a new account's email, and
 * resetting a forgotten password. Demo mode uses VerificationScreen and
 * ForgotPassword instead.
 */
import { useEffect, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { AppUser } from '@/shared/lib/types'
import { isEmail, passwordIssue } from '@/shared/state/auth'
import { resendSignUpCode, sendPasswordReset, setNewPassword, takeConsent, verifyEmailCode } from '@/shared/api/authBackend'
import { appBaseUrl } from '@/shared/email/emailTemplate'
import {
  AuthBack, AuthButton, AuthField, AuthHeading, OtpInput, PasswordInput, PasswordMeter, StepBar, SuccessCheck, SIGNUP_STEPS, authInputCls,
} from './authKit'

/** Seconds before another email can be requested (the backend refuses sooner). */
const RESEND_WAIT = 60

/**
 * Opens the app for an account the backend has just signed in. The store loads the person's record
 * first (the sign-in screen shows "Loading your record…" meanwhile) and records the consent given on the sign-up form.
 */
export function useAdoptAccount() {
  const { signIn } = useApp()
  return (account: AppUser) => signIn(account, { acceptedTermsAt: takeConsent() })
}

/** Counts down the wait before "Resend". `restart()` begins a new wait. */
function useResendWait() {
  const [left, setLeft] = useState(RESEND_WAIT)
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft(l => l - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  return { left, restart: () => setLeft(RESEND_WAIT) }
}

function ResendLink({ left, onResend }: { left: number; onResend: () => void }) {
  return (
    <button type="button" disabled={left > 0} onClick={onResend}
      className={`text-xs text-center font-medium ${left > 0 ? 'text-gray-400' : 'text-teal-700'}`}>
      {left > 0 ? <>Resend email in <span className="font-mono">{left}s</span></> : "Didn't receive it? Resend email"}
    </button>
  )
}

/* ─── Confirm a new account's email ─────────────────────────────────── */

export function ConfirmEmail({ email, onBack }: { email: string; onBack: () => void }) {
  const adopt = useAdoptAccount()
  const wait = useResendWait()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const verify = async (entered: string) => {
    if (busy) return
    setBusy(true)
    const res = await verifyEmailCode(email, entered, 'signup')
    setBusy(false)
    if (res.ok) adopt(res.user)
    else setError(res.error ?? 'That code is incorrect or has expired.')
  }

  const resend = async () => {
    setCode(''); setError('')
    const failed = await resendSignUpCode(email, appBaseUrl())
    if (failed) setError(failed)
    else { setStatus(`A new email is on its way to ${email}.`); wait.restart() }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); if (code.length === 6) verify(code) }}>
      <AuthBack onClick={onBack}>Back to sign in</AuthBack>
      <StepBar step={SIGNUP_STEPS} total={SIGNUP_STEPS} label="Verify your email" />
      <AuthHeading center icon="mail" title="Check your email" subtitle={<>
        We sent a message to <span className="font-semibold text-teal-700 break-all">{email}</span>.
        Tap the link in it, or enter the 6-digit code.
      </>} />

      <div>
        <OtpInput value={code} invalid={!!error}
          onChange={v => { setCode(v); setError(''); setStatus(''); if (v.length === 6) verify(v) }} />
        <p role="status" className={`min-h-4 mt-2 text-xs text-center ${error ? 'text-red-500' : 'text-emerald-600'}`}>{error || status}</p>
      </div>

      <AuthButton type="submit" disabled={code.length < 6 || busy}>{busy ? 'Checking…' : 'Verify Account'}</AuthButton>
      <ResendLink left={wait.left} onResend={resend} />
    </form>
  )
}

/* ─── Forgotten password ────────────────────────────────────────────── */

type Step = 'find' | 'code' | 'password' | 'done'

/**
 * Find the account, prove the emailed code (or arrive by the emailed link,
 * which passes `recovered`), then choose a new password. The wording is the
 * same whether or not the email is registered.
 */
export function LiveRecovery({ initialEmail, recovered, onBack }: {
  initialEmail: string
  /** Set when the person arrived by the reset link: they are already proven, so go straight to the new password. */
  recovered?: AppUser
  onBack: () => void
}) {
  const adopt = useAdoptAccount()
  const wait = useResendWait()
  const [step, setStep] = useState<Step>(recovered ? 'password' : 'find')
  const [account, setAccount] = useState<AppUser | undefined>(recovered)
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    if (!isEmail(email) || busy) return
    setBusy(true)
    const failed = await sendPasswordReset(email, appBaseUrl())
    setBusy(false)
    if (failed) { setError(failed); return }
    setCode(''); setError(''); wait.restart(); setStep('code')
  }

  const verify = async (entered: string) => {
    if (busy) return
    setBusy(true)
    const res = await verifyEmailCode(email, entered, 'recovery')
    setBusy(false)
    if (res.ok) { setAccount(res.user); setError(''); setStep('password') }
    else setError(res.error ?? 'That code is incorrect or has expired.')
  }

  const issue = passwordIssue(next)
  const mismatch = !!confirm && next !== confirm
  const save = async () => {
    if (issue || !confirm || mismatch || busy) return
    setBusy(true)
    const failed = await setNewPassword(next)
    setBusy(false)
    if (failed) setError(failed)
    else setStep('done')
  }

  if (step === 'done') {
    return (
      <div className="screen-in flex flex-col text-center gap-4 py-4">
        <SuccessCheck />
        <AuthHeading center title="Password updated" subtitle="Your new password is saved and you are signed in." />
        <AuthButton onClick={() => { if (account) adopt(account); else onBack() }}>Continue to mCare</AuthButton>
      </div>
    )
  }

  if (step === 'find') {
    return (
      <form key="find" className="screen-in flex flex-col gap-4" onSubmit={e => { e.preventDefault(); send() }}>
        <AuthBack onClick={onBack}>Back to sign in</AuthBack>
        <StepBar step={1} total={3} label="Find your account" />
        <AuthHeading title="Forgot your password?" subtitle="Enter your email and we will send a code and a link to reset it." />
        <AuthField label="Email Address">
          <input type="email" autoComplete="username" autoFocus value={email} onChange={e => { setEmail(e.target.value); setError('') }}
            placeholder="you@example.com" className={authInputCls} />
        </AuthField>
        {error && <p role="alert" className="auth-shake text-xs text-red-500 text-center">{error}</p>}
        <AuthButton type="submit" disabled={!isEmail(email) || busy}>{busy ? 'Sending…' : 'Send reset email'}</AuthButton>
      </form>
    )
  }

  if (step === 'code') {
    return (
      <form key="code" className="screen-in flex flex-col gap-4" onSubmit={e => { e.preventDefault(); if (code.length === 6) verify(code) }}>
        <AuthBack onClick={() => { setError(''); setStep('find') }} />
        <StepBar step={2} total={3} label="Enter the code" />
        <AuthHeading center icon="mail" title="Check your email" subtitle={<>
          If an account matches <span className="font-semibold text-teal-700 break-all">{email.trim()}</span>, a reset email is on
          its way. Tap the link in it, or enter the 6-digit code.
        </>} />
        <div>
          <OtpInput value={code} invalid={!!error}
            onChange={v => { setCode(v); setError(''); if (v.length === 6) verify(v) }} />
          <p role="status" className="min-h-4 mt-2 text-xs text-center text-red-500">{error}</p>
        </div>
        <AuthButton type="submit" disabled={code.length < 6 || busy}>{busy ? 'Checking…' : 'Verify code'}</AuthButton>
        <ResendLink left={wait.left} onResend={send} />
      </form>
    )
  }

  return (
    <form key="password" className="screen-in flex flex-col gap-4" onSubmit={e => { e.preventDefault(); save() }}>
      <StepBar step={3} total={3} label="New password" />
      <AuthHeading icon="lock" title="Choose a new password" subtitle="Make it different from the one you used before." />
      <AuthField label="New password">
        <PasswordInput value={next} onChange={v => { setNext(v); setError('') }} placeholder="Create a password" autoComplete="new-password" />
      </AuthField>
      <PasswordMeter value={next} />
      <AuthField label="Confirm new password">
        <PasswordInput value={confirm} onChange={v => { setConfirm(v); setError('') }} invalid={mismatch}
          placeholder="Repeat your password" autoComplete="new-password" />
      </AuthField>
      {mismatch && <p className="text-xs text-red-500 -mt-2">Passwords do not match.</p>}
      {error && <p role="alert" className="auth-shake text-xs text-red-500 text-center">{error}</p>}
      <AuthButton type="submit" disabled={!!issue || !confirm || mismatch || busy}>{busy ? 'Saving…' : 'Save new password'}</AuthButton>
    </form>
  )
}

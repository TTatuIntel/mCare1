import { useEffect, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { countdown, isEmail, isPhone, passwordIssue } from '@/shared/state/auth'
import { RESET_TTL_MIN, type ResetChannel } from '@/shared/lib/types'
import { MailboxSheet } from '@/shared/email/Mailbox'
import {
  AuthBack, AuthButton, AuthField, AuthHeading, OtpInput, PasswordInput, PasswordMeter, StepBar, SuccessCheck, authInputCls,
} from './authKit'

/** Demo mode lets you open the sent email on screen. Set to false once real email/SMS delivery exists. */
const DEMO_MODE = true
/** Seconds before another code can be requested. */
const RESEND_WAIT = 30

type Step = 'find' | 'code' | 'password' | 'done' | 'admin' | 'adminDone'

const CHANNELS: { id: ResetChannel; label: string }[] = [
  { id: 'email', label: 'Email me a code' },
  { id: 'sms', label: 'Text me a code' },
]

/**
 * Forgotten password, from the sign-in card: find the account, prove a
 * one-time code (or tap the emailed link), then choose a new password. The
 * wording is the same whether or not the account exists, so this screen can't
 * be used to find out who is registered. People with no working email or
 * phone can ask an administrator instead.
 */
export function ForgotPassword({ initialEmail, onBack, onDone }: {
  initialEmail: string
  onBack: () => void
  /** Back to sign in, with the account's email filled in. */
  onDone: (email: string) => void
}) {
  const { users, requestPasswordReset, verifyResetCode, verifyResetLink, setPasswordAfterVerification, requestAdminPasswordHelp } = useApp()
  const [step, setStep] = useState<Step>('find')
  const [identifier, setIdentifier] = useState(initialEmail)
  const [channel, setChannel] = useState<ResetChannel>('email')
  const [userId, setUserId] = useState<string | null>(null)
  const [sentAt, setSentAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [code, setCode] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [mailOpen, setMailOpen] = useState(false)

  // The code step shows two clocks: time left on the code, and the wait before a resend.
  useEffect(() => {
    if (step !== 'code') return
    const h = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(h)
  }, [step])

  const user = users.find(u => u.id === userId)
  const expiresIn = sentAt + RESET_TTL_MIN * 60_000 - now
  const resendIn = Math.ceil((sentAt + RESEND_WAIT * 1000 - now) / 1000)
  const identifierOk = isEmail(identifier) || isPhone(identifier)

  const send = () => {
    if (!identifierOk) return
    const res = requestPasswordReset(identifier, channel)
    const t = Date.now()
    setUserId(res.ok ? res.userId ?? null : null)
    setSentAt(t); setNow(t); setCode(''); setError('')
    setStep('code')
  }

  const verify = (entered: string) => {
    const res = userId ? verifyResetCode(userId, entered) : { ok: false, error: 'Incorrect code. Check it and try again.' }
    if (res.ok) { setError(''); setStep('password') }
    else setError(res.error ?? 'Incorrect code.')
  }

  const issue = passwordIssue(next)
  const save = () => {
    if (!userId || issue || next !== confirm) return
    const res = setPasswordAfterVerification(userId, next)
    if (res.ok) setStep('done')
    else setError(res.error ?? 'Could not reset password.')
  }

  const adminLink = (
    <button type="button" onClick={() => { setError(''); setStep('admin') }} className="text-xs text-gray-400 text-center">
      No access to your email or phone? <span className="font-semibold text-teal-700">Ask an administrator</span>
    </button>
  )

  if (step === 'done' || step === 'adminDone') {
    return (
      <div key={step} className="screen-in flex flex-col text-center gap-4 py-4">
        <SuccessCheck />
        {step === 'done'
          ? <AuthHeading center title="Password updated" subtitle="You can now sign in with your new password. We have emailed you a confirmation." />
          : <AuthHeading center title="Request sent" subtitle="An administrator has been notified and will help you back into your account." />}
        <AuthButton onClick={() => onDone(user?.email ?? (isEmail(identifier) ? identifier.trim() : ''))}>Back to sign in</AuthButton>
      </div>
    )
  }

  if (step === 'admin') {
    return (
      <form key="admin" className="screen-in flex flex-col gap-4"
        onSubmit={e => { e.preventDefault(); if (isEmail(identifier)) { requestAdminPasswordHelp(identifier, note.trim()); setStep('adminDone') } }}>
        <AuthBack onClick={() => setStep('find')} />
        <AuthHeading icon="users" title="Ask an administrator" subtitle="If you can no longer reach your email or phone, an administrator can confirm who you are and reset your password." />
        <AuthField label="Account email">
          <input type="email" autoComplete="username" value={identifier} onChange={e => setIdentifier(e.target.value)}
            placeholder="you@example.com" className={authInputCls} />
        </AuthField>
        <AuthField label="Anything that helps us reach you (optional)">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="e.g. a phone number we can call" className={`${authInputCls} resize-none`} />
        </AuthField>
        <AuthButton type="submit" disabled={!isEmail(identifier)}>Send request</AuthButton>
      </form>
    )
  }

  if (step === 'find') {
    return (
      <form key="find" className="screen-in flex flex-col gap-4" onSubmit={e => { e.preventDefault(); send() }}>
        <AuthBack onClick={onBack}>Back to sign in</AuthBack>
        <StepBar step={1} total={3} label="Find your account" />
        <AuthHeading title="Forgot your password?" subtitle="Enter your email or phone number and we will send a code to reset it." />
        <AuthField label="Email or phone number">
          <input type="text" autoComplete="username" autoFocus value={identifier} onChange={e => setIdentifier(e.target.value)}
            placeholder="you@example.com" className={authInputCls} />
        </AuthField>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How to send the code">
          {CHANNELS.map(c => (
            <button key={c.id} type="button" role="radio" aria-checked={channel === c.id} onClick={() => setChannel(c.id)}
              className={`rounded-2xl border-2 py-2.5 text-xs font-bold transition-colors ${channel === c.id ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-gray-200 bg-white text-gray-500'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <AuthButton type="submit" disabled={!identifierOk}>Send reset code</AuthButton>
        {adminLink}
      </form>
    )
  }

  if (step === 'code') {
    return (
      <form key="code" className="screen-in flex flex-col gap-4" onSubmit={e => { e.preventDefault(); verify(code) }}>
        <AuthBack onClick={() => { setError(''); setStep('find') }} />
        <StepBar step={2} total={3} label="Enter the code" />
        <AuthHeading center icon={channel === 'sms' ? 'chat' : 'mail'} title="Check your messages" subtitle={<>
          If an account matches <span className="font-semibold text-teal-700 break-all">{identifier.trim()}</span>, a 6-digit code is on
          its way by {channel === 'sms' ? 'text' : 'email'}{channel === 'email' && ', with a link you can tap instead'}.
        </>} />

        <div>
          <OtpInput value={code} invalid={!!error}
            onChange={v => { setCode(v); setError(''); if (v.length === 6) verify(v) }} />
          <p role="status" className={`min-h-4 mt-2 text-xs text-center ${error ? 'text-red-500' : 'text-gray-400'}`}>
            {error || (expiresIn > 0
              ? <>Code expires in <span className="font-mono">{countdown(expiresIn)}</span></>
              : 'That code has expired. Request a new one.')}
          </p>
        </div>

        <AuthButton type="submit" disabled={code.length < 6}>Verify code</AuthButton>

        <button type="button" disabled={resendIn > 0} onClick={send}
          className={`text-xs text-center font-medium ${resendIn > 0 ? 'text-gray-400' : 'text-teal-700'}`}>
          {resendIn > 0 ? <>Resend code in <span className="font-mono">{resendIn}s</span></> : "Didn't receive it? Resend code"}
        </button>

        {DEMO_MODE && user && <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 text-center">
          <p className="text-[10px] font-bold text-teal-600 uppercase tracking-wider">Demo mode only</p>
          <button type="button" onClick={() => setMailOpen(true)} className="mt-1.5 px-4 py-2 rounded-xl bg-white border border-teal-200 text-xs font-bold text-teal-700">
            📧 Open my messages
          </button>
        </div>}
        {adminLink}

        {user && <MailboxSheet address={user.email} phone={user.phone} open={mailOpen} onClose={() => setMailOpen(false)} openLatest
          onLink={e => {
            // Same as tapping "Reset password" in a real inbox: the link proves it's you, no code needed.
            const m = e.content.action?.url.match(/[?&]reset=([^.&]+)\.(\w+)/)
            if (!m || !verifyResetLink(decodeURIComponent(m[1]), m[2]).ok) return false
            setError(''); setStep('password')
            return true
          }} />}
      </form>
    )
  }

  // step === 'password'
  const mismatch = !!confirm && next !== confirm
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
      <AuthButton type="submit" disabled={!!issue || !confirm || mismatch}>Save new password</AuthButton>
    </form>
  )
}

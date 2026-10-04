import { useEffect, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { verifiedTotp, verifyTotp } from '@/shared/api/authBackend'
import { AuthBack, AuthButton, AuthHeading, OtpInput } from './authKit'
import { TotpSetupPanel } from './TotpSetup'

/**
 * The second step of signing in (live mode). Shown when the account has two-step sign-in on and this
 * session has given only the password (or an emailed code), or when an admin requires it for the
 * account's role and it is not set up yet. The database gives the session nothing until this is done.
 */
export function MfaScreen() {
  const { mfa, completeMfa, cancelMfa } = useApp()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (mfa?.step !== 'challenge') return
    void verifiedTotp().then(f => f ? setFactorId(f.id) : setError('Two-step sign-in could not be started. Sign in again.'))
  }, [mfa?.step])

  if (!mfa) return null
  const verify = async (entered: string) => {
    if (!factorId || busy) return
    setBusy(true)
    const failed = await verifyTotp(factorId, entered)
    setBusy(false)
    if (failed) { setError(failed); setCode('') } else completeMfa()
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-8">
      <AuthBack onClick={cancelMfa}>Sign out</AuthBack>
      {mfa.step === 'challenge' ? (
        <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); if (code.length === 6) void verify(code) }}>
          <AuthHeading center icon="shield" title="Two-step sign-in"
            subtitle={<>Enter the 6-digit code from your authenticator app for <span className="font-semibold text-teal-700 break-all">{mfa.account.email}</span>.</>} />
          <OtpInput value={code} invalid={!!error} onChange={v => { setCode(v); setError(''); if (v.length === 6) void verify(v) }} />
          <p role="status" className="min-h-4 text-xs text-center text-red-600">{error}</p>
          <AuthButton type="submit" disabled={code.length < 6 || busy || !factorId}>{busy ? 'Checking…' : 'Continue'}</AuthButton>
          <p className="text-[11px] text-gray-400 text-center leading-relaxed">Lost your phone? Ask an mCare administrator to reset two-step sign-in for your account.</p>
        </form>
      ) : (
        <>
          <AuthHeading center icon="shield" title="Set up two-step sign-in"
            subtitle="mCare asks your role to confirm each sign-in with a code from your phone. It takes a minute, once." />
          <TotpSetupPanel onDone={completeMfa} />
        </>
      )}
    </div>
  )
}

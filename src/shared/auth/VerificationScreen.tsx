import { useEffect, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { DoctorUser, PatientUser } from '@/shared/lib/types'
import { MailboxSheet } from '@/shared/email/Mailbox'
import { AuthShell } from './AuthShell'
import { AuthButton, AuthField, AuthHeading, OtpInput, StepBar, SuccessCheck, SIGNUP_STEPS, authInputCls } from './authKit'

/** Demo mode lets you open the sent email on screen. Set to false once real email/SMS delivery exists. */
const DEMO_MODE = true
/** Seconds before another code can be requested. */
const RESEND_WAIT = 30

export function VerificationScreen() {
  const { currentUser, updateUser, setCurrentUser, getAdmins, notify, resendVerification, verifyByLink, sendWelcomeEmail } = useApp()
  const [mailOpen, setMailOpen] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [verified, setVerified] = useState(false)
  const [resent, setResent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [drForm, setDrForm] = useState({ specialty: '', licenseNo: '', hospital: '' })

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  if (!currentUser) return null
  const isDoctor = currentUser.role === 'doctor'
  // New patients go on to the health-profile setup (see App router).
  const setupNext = currentUser.role === 'patient' && (currentUser as PatientUser).profileSetup === 'pending'

  // Step 2 for doctors: complete professional profile, then submit for admin review
  if (verified && isDoctor) {
    const allFilled = !!(drForm.specialty.trim() && drForm.licenseNo.trim() && drForm.hospital.trim())
    const submit = () => {
      if (!allFilled) return
      updateUser(currentUser.id, {
        specialty: drForm.specialty.trim(),
        licenseNo: drForm.licenseNo.trim(),
        hospital: drForm.hospital.trim(),
        status: 'pending_approval',
      } as Partial<DoctorUser>)
      getAdmins().forEach(a => notify(a.id, 'account', 'New doctor application', `${currentUser.name} · ${drForm.specialty.trim()}`, 'approvals'))
    }
    return (
      <AuthShell>
        <form key="doctor" className="screen-in flex flex-col gap-4" onSubmit={e => { e.preventDefault(); submit() }}>
          <AuthHeading center icon="shield" title="Complete Your Profile"
            subtitle="Provide your professional details to submit your application for admin review." />

          {([
            { label: 'Medical Specialty', key: 'specialty', placeholder: 'e.g. Cardiology' },
            { label: 'License Number',    key: 'licenseNo', placeholder: 'e.g. KMC-2019-04821' },
            { label: 'Hospital / Clinic', key: 'hospital',  placeholder: 'e.g. Kenyatta National Hospital' },
          ] as const).map(({ label, key, placeholder }) => (
            <AuthField key={key} label={label}>
              <input
                value={drForm[key]}
                onChange={e => setDrForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className={authInputCls}
              />
            </AuthField>
          ))}

          <AuthButton type="submit" disabled={!allFilled}>Submit Application for Review</AuthButton>

          <button type="button" onClick={() => setCurrentUser(null)} className="text-xs text-gray-400 text-center">
            ← Sign in with another account
          </button>
        </form>
      </AuthShell>
    )
  }

  // Step 2 for patients / admin / assistant: account is active
  if (verified) {
    return (
      <AuthShell>
        <div key="verified" className="screen-in flex flex-col text-center gap-4 py-4">
          <SuccessCheck />
          <AuthHeading center title="Account Verified!" subtitle={setupNext
            ? 'Next, a few quick questions about your health so your care team can look after you. It takes about 2 minutes.'
            : 'Your account is now active. Welcome to Matendocare.'} />
          <AuthButton onClick={() => updateUser(currentUser.id, { status: 'active' })}>
            {setupNext ? 'Set up my health profile' : 'Continue to App'}
          </AuthButton>
        </div>
      </AuthShell>
    )
  }

  const succeed = () => { setVerified(true); sendWelcomeEmail(currentUser.id) }
  const check = (entered: string) => {
    if (entered.trim() === currentUser.verificationCode) succeed()
    else setError('Incorrect code. Please try again.')
  }

  // Step 1: enter verification code
  return (
    <AuthShell>
      <form key="code" className="screen-in flex flex-col gap-4" onSubmit={e => { e.preventDefault(); check(code) }}>
        {setupNext && <StepBar step={SIGNUP_STEPS} total={SIGNUP_STEPS} label="Verify your email" />}

        <AuthHeading center icon="mail" title="Verify Your Account" subtitle={<>
          Tap the link in your email, or enter the 6-digit code sent to{' '}
          <span className="font-semibold text-teal-700 break-all">{currentUser.email}</span>
        </>} />

        <div>
          {/* The code checks itself as soon as the sixth digit is in. */}
          <OtpInput value={code} invalid={!!error}
            onChange={v => { setCode(v); setError(''); setResent(false); if (v.length === 6) check(v) }} />
          <p role="status" className={`min-h-4 mt-2 text-xs text-center ${error ? 'text-red-500' : 'text-emerald-600'}`}>
            {error || (resent && `A new code has been sent to ${currentUser.email}.`)}
          </p>
        </div>

        <AuthButton type="submit" disabled={code.length < 6}>Verify Account</AuthButton>

        <button type="button" disabled={cooldown > 0}
          onClick={() => { resendVerification(currentUser.id); setResent(true); setError(''); setCode(''); setCooldown(RESEND_WAIT) }}
          className={`text-xs text-center font-medium ${cooldown > 0 ? 'text-gray-400' : 'text-teal-700'}`}>
          {cooldown > 0
            ? <>Resend code in <span className="font-mono">{cooldown}s</span></>
            : "Didn't receive it? Resend code"}
        </button>

        {DEMO_MODE && <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 text-center">
          <p className="text-[10px] font-bold text-teal-600 uppercase tracking-wider">Demo mode only</p>
          <p className="text-xs text-teal-700">Your email has the link and the code{currentUser.phone ? '; your phone gets the code by text' : ''}.</p>
          <button type="button" onClick={() => setMailOpen(true)} className="mt-2 px-4 py-2 rounded-xl bg-white border border-teal-200 text-xs font-bold text-teal-700">
            📧 Open my messages
          </button>
        </div>}

        <button type="button" onClick={() => setCurrentUser(null)} className="text-xs text-gray-400 text-center">
          ← Back to login
        </button>
      </form>
      <MailboxSheet address={currentUser.email} phone={currentUser.phone} open={mailOpen} onClose={() => setMailOpen(false)} openLatest
        onLink={e => {
          // Same as tapping "Verify my email" in a real inbox.
          const m = e.content.action?.url.match(/[?&]verify=([^.&]+)\.(\w+)/)
          if (!m || !verifyByLink(decodeURIComponent(m[1]), m[2])) return false
          succeed()
          return true
        }} />
    </AuthShell>
  )
}

/** Account settings sheets opened from ProfileCard — same for every role. */
import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { ThemePref, FontSizePref } from '@/shared/lib/types'
import { calcAge } from '@/shared/lib/vitals'
import { readSquarePhoto } from '@/shared/lib/photo'
import { Avatar, Pill, AVATAR_GRADIENTS, AVATAR_EMOJIS } from '@/shared/ui/primitives'
import { BottomSheet, SheetButton, Field, inputCls, useToast, SaveError, useSave } from '@/shared/ui/BottomSheet'
import { MailboxSheet } from '@/shared/email/Mailbox'
import { passwordIssue } from '@/shared/state/auth'
import * as api from '@/shared/api/actions'

/* ─── Edit Profile sheet ────────────────────────────────────────────── */
export function EditProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentUser, updateUser } = useApp()
  const [name, setName]   = useState('')
  const [phone, setPhone] = useState('')
  const [dob, setDob]     = useState('')
  const [gradient, setGradient] = useState('teal')
  const [emoji, setEmoji] = useState('')
  const [photo, setPhoto] = useState<string | undefined>(undefined)
  const [photoError, setPhotoError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const { show, node } = useToast()
  const saving = useSave()

  useEffect(() => {
    if (!currentUser || !open) return
    saving.clear()
    setName(currentUser.name)
    setPhone(currentUser.phone)
    setDob(currentUser.dob ?? '')
    setGradient(currentUser.avatar?.gradient ?? 'teal')
    setEmoji(currentUser.avatar?.emoji ?? '')
    setPhoto(currentUser.avatar?.photo)
    setPhotoError('')
  }, [currentUser?.id, open])

  if (!currentUser) return null
  const age = dob ? calcAge(dob) : null
  const today = new Date().toISOString().slice(0, 10)

  const pickPhoto = (file: File | undefined) => {
    if (!file) return
    setPhotoError('')
    readSquarePhoto(file).then(setPhoto, (e: Error) => setPhotoError(e.message))
  }

  const phoneOk = !phone.trim() || phone.replace(/\D/g, '').length >= 7
  const save = async () => {
    if (!name.trim() || !phoneOk) return
    const res = await saving.run(() => updateUser(currentUser.id, {
      name: name.trim(),
      phone: phone.trim(),
      dob: dob || undefined,
      avatar: { gradient, emoji, photo },
    } as Partial<typeof currentUser>))
    if (!res.ok) return
    show('Profile updated')
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Edit Profile" subtitle="Update your details and avatar"
      footer={<><SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton><SheetButton disabled={!name.trim() || !phoneOk || saving.busy} onClick={save}>{saving.busy ? 'Saving…' : 'Save'}</SheetButton></>}>
      <div className="mb-4">
        <div className="mx-auto mb-3 w-fit"><Avatar name={name || currentUser.name} avatar={{ gradient, emoji, photo }} size="lg" /></div>

        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
        <div className="flex gap-2 justify-center mb-1">
          <button onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 rounded-full bg-teal-50 border border-teal-100 text-[11px] font-bold text-teal-700">
            📷 {photo ? 'Change Photo' : 'Upload Photo'}
          </button>
          {photo && (
            <button onClick={() => { setPhoto(undefined); setPhotoError('') }}
              className="px-3 py-1.5 rounded-full bg-red-50 border border-red-100 text-[11px] font-bold text-red-500">
              Remove
            </button>
          )}
        </div>
        {photoError && <p className="text-[11px] text-red-500 font-semibold text-center mb-1">{photoError}</p>}
        <p className="text-[10px] text-gray-400 text-center mb-3">
          {photo ? 'Your photo is used as your avatar.' : 'JPG or PNG, square-cropped automatically.'}
        </p>

        {!photo && (
          <>
            <Field label="Avatar Color">
              <div className="flex gap-2 flex-wrap">
                {Object.keys(AVATAR_GRADIENTS).map(g => (
                  <button key={g} onClick={() => setGradient(g)}
                    className={`w-9 h-9 rounded-full border-2 ${gradient === g ? 'border-gray-800' : 'border-transparent'}`}
                    style={{ background: AVATAR_GRADIENTS[g] }} aria-label={g} />
                ))}
              </div>
            </Field>
            <Field label="Avatar Icon (optional)">
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => setEmoji('')}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold border-2 ${!emoji ? 'border-teal-500 bg-teal-50' : 'border-gray-100 bg-gray-50'}`}>
                  Aa
                </button>
                {AVATAR_EMOJIS.map(e => (
                  <button key={e} onClick={() => setEmoji(e)}
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-base border-2 ${emoji === e ? 'border-teal-500 bg-teal-50' : 'border-gray-100 bg-gray-50'}`}>
                    {e}
                  </button>
                ))}
              </div>
            </Field>
          </>
        )}
      </div>
      <Field label="Full Name">
        <input value={name} maxLength={120} autoComplete="name" onChange={e => setName(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Phone">
        <input type="tel" inputMode="tel" value={phone} maxLength={24} autoComplete="tel" onChange={e => setPhone(e.target.value)} className={inputCls} placeholder="+254 7xx xxx xxx" />
        {!phoneOk && <p className="text-[11px] text-red-500 mt-1">Enter the full phone number, or leave it empty.</p>}
      </Field>
      <Field label="Date of Birth">
        <input type="date" value={dob} max={today} onChange={e => setDob(e.target.value)} className={inputCls} />
        {age !== null && <p className="text-[11px] text-teal-700 font-semibold mt-1">Age: {age} years</p>}
      </Field>
      <SaveError message={saving.error} />
      {node}
    </BottomSheet>
  )
}

/* ─── Change Password sheet ─────────────────────────────────────────── */
/** Live mode: the sign-in service checks the current password, sets the new one and signs the other devices out. */
function LiveChangePasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentUser, run } = useApp()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const saving = useSave()
  useEffect(() => { if (open) { setCurrent(''); setNext(''); setConfirm(''); setDone(false); saving.clear() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!currentUser) return null
  const social = currentUser.authProvider && currentUser.authProvider !== 'email'
  const issue = next ? passwordIssue(next) : null
  const mismatch = !!confirm && confirm !== next
  const ready = !!current && !!next && !issue && confirm === next && next !== current

  const submit = async () => {
    if (!ready) return
    if ((await saving.run(() => run(() => api.changePassword(currentUser.email, current, next)))).ok) setDone(true)
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Change Password"
      subtitle={done ? undefined : 'Enter your current password, then choose a new one.'}
      footer={done || social
        ? <SheetButton onClick={onClose}>Close</SheetButton>
        : <><SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton><SheetButton disabled={!ready || saving.busy} onClick={submit}>{saving.busy ? 'Saving…' : 'Save'}</SheetButton></>}>
      {social ? (
        <p className="text-sm text-gray-600 py-2">You sign in with another account, so there is no mCare password to change. Manage it with that provider.</p>
      ) : done ? (
        <div className="py-4 text-center">
          <p className="text-3xl mb-2">✅</p>
          <p className="text-sm font-semibold text-gray-800">Password changed</p>
          <p className="text-xs text-gray-500 mt-1">Other devices signed in to your account have been signed out.</p>
        </div>
      ) : (
        <>
          <Field label="Current password">
            <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} className={inputCls} />
          </Field>
          <Field label="New password">
            <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} className={inputCls} />
            {issue && <p className="text-[11px] text-red-500 mt-1">{issue}</p>}
            {!issue && !!next && next === current && <p className="text-[11px] text-red-500 mt-1">Choose a password different from the current one.</p>}
          </Field>
          <Field label="Confirm new password">
            <input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className={inputCls} />
            {mismatch && <p className="text-[11px] text-red-500 mt-1">The passwords do not match.</p>}
          </Field>
          <p className="text-[11px] text-gray-400">Forgot the current one? Sign out and use “Forgot password?” on the sign-in page.</p>
          <SaveError message={saving.error} className="mt-2" />
        </>
      )}
    </BottomSheet>
  )
}

export function ChangePasswordSheet(props: { open: boolean; onClose: () => void }) {
  const { live } = useApp()
  return live ? <LiveChangePasswordSheet {...props} /> : <DemoChangePasswordSheet {...props} />
}

/** Demo mode: the code and link are "emailed" to the in-app mailbox. */
function DemoChangePasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentUser, changePassword, requestPasswordReset, verifyResetCode, verifyResetLink, setPasswordAfterVerification } = useApp()
  const [mode, setMode] = useState<'change' | 'forgot'>('change')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [sentCode, setSentCode] = useState('')
  const [codeVerified, setCodeVerified] = useState(false)
  const [mailOpen, setMailOpen] = useState(false)
  const [error, setError] = useState('')
  const { show, node } = useToast()

  useEffect(() => { if (open) { setMode('change'); setCurrent(''); setNext(''); setConfirm(''); setCode(''); setSentCode(''); setCodeVerified(false); setError('') } }, [open])

  if (!currentUser) return null

  /** In-app change now also requires a verified code, same as a forgotten-password reset. */
  const sendChangeCode = () => {
    const res = requestPasswordReset(currentUser.email)
    if (res.ok && res.token) { setSentCode(res.token.code); setError('') }
    else if (!res.ok) setError(res.error ?? 'Could not send a code.')
  }

  const verifyChangeCode = () => {
    setError('')
    const res = verifyResetCode(currentUser.id, code)
    if (!res.ok) return setError(res.error ?? 'Incorrect code.')
    setCodeVerified(true)
  }

  const submitChange = () => {
    setError('')
    if (next !== confirm) return setError('New passwords do not match.')
    const res = changePassword(currentUser.id, current, next)
    if (!res.ok) return setError(res.error ?? 'Could not change password.')
    show('Password changed')
    onClose()
  }

  const requestReset = () => {
    const res = requestPasswordReset(currentUser.email)
    if (res.ok && res.token) { setSentCode(res.token.code); setError('') }
    else if (!res.ok) setError(res.error ?? 'Could not send a code.')
  }

  const submitReset = () => {
    setError('')
    if (next !== confirm) return setError('New passwords do not match.')
    if (!codeVerified) {
      const verify = verifyResetCode(currentUser.id, code)
      if (!verify.ok) return setError(verify.error ?? 'Incorrect code.')
    }
    const res = setPasswordAfterVerification(currentUser.id, next)
    if (!res.ok) return setError(res.error ?? 'Could not reset password.')
    show('Password reset')
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose}
      title={mode === 'change' ? 'Change Password' : 'Reset Password'}
      subtitle={mode === 'change' ? 'Enter your current password to set a new one' : 'Request a reset code and set a new password'}
      footer={
        <>
          <SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton>
          {mode === 'change'
            ? <SheetButton disabled={!current || !codeVerified || next.length < 6 || !confirm} onClick={submitChange}>Save</SheetButton>
            : <SheetButton disabled={!sentCode || (!code && !codeVerified) || next.length < 6 || !confirm} onClick={submitReset}>Reset</SheetButton>}
        </>
      }>
      {mode === 'change' ? (
        <>
          <Field label="Current Password">
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)} className={inputCls} />
          </Field>

          {!sentCode ? (
            <div className="text-center py-2">
              <p className="text-xs text-gray-500 mb-3">For your security, we'll also send a code to {currentUser.email}.</p>
              <SheetButton onClick={sendChangeCode}>Send Code</SheetButton>
            </div>
          ) : !codeVerified ? (
            <>
              <div className="bg-teal-50 border border-teal-100 rounded-xl px-3 py-2.5 mb-3">
                <p className="text-[11px] text-teal-700">We emailed a link and a code to {currentUser.email}. <button onClick={() => setMailOpen(true)} className="font-black underline">📧 Open the email</button> (demo mode)</p>
              </div>
              <Field label="Verification Code">
                <input value={code} onChange={e => setCode(e.target.value)} className={inputCls} placeholder="6-digit code" />
              </Field>
              <SheetButton disabled={!code} onClick={verifyChangeCode}>Verify Code</SheetButton>
            </>
          ) : (
            <>
              <Field label="New Password">
                <input type="password" value={next} onChange={e => setNext(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Confirm New Password">
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} className={inputCls} />
              </Field>
            </>
          )}

          <button onClick={() => setMode('forgot')} className="text-xs text-teal-700 font-semibold">
            Forgot your current password?
          </button>
        </>
      ) : (
        <>
          {!sentCode ? (
            <div className="text-center py-4">
              <p className="text-xs text-gray-500 mb-3">We'll send a reset code to {currentUser.email}.</p>
              <SheetButton onClick={requestReset}>Send Reset Code</SheetButton>
            </div>
          ) : (
            <>
              <div className="bg-teal-50 border border-teal-100 rounded-xl px-3 py-2.5 mb-3">
                <p className="text-[11px] text-teal-700">We emailed a link and a code to {currentUser.email}. <button onClick={() => setMailOpen(true)} className="font-black underline">📧 Open the email</button> (demo mode)</p>
              </div>
              <Field label="Reset Code">
                <input value={code} onChange={e => setCode(e.target.value)} className={inputCls} placeholder="6-digit code" />
              </Field>
              <Field label="New Password">
                <input type="password" value={next} onChange={e => setNext(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Confirm New Password">
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} className={inputCls} />
              </Field>
            </>
          )}
          <button onClick={() => setMode('change')} className="text-xs text-teal-700 font-semibold mt-2">
            ← Back to change password
          </button>
        </>
      )}
      {error && <p className="text-xs text-red-500 font-semibold mt-2">{error}</p>}
      {node}
      <MailboxSheet address={currentUser.email} open={mailOpen} onClose={() => setMailOpen(false)} openLatest
        onLink={e => {
          // Same as tapping "Reset password" in a real inbox: the link proves it's you, no code needed.
          const m = e.content.action?.url.match(/[?&]reset=([^.&]+)\.(\w+)/)
          if (!m || !verifyResetLink(decodeURIComponent(m[1]), m[2]).ok) return false
          setCodeVerified(true); setError('')
          return true
        }} />
    </BottomSheet>
  )
}

/* ─── Theme & Font sheet ─────────────────────────────────────────────── */
const THEME_OPTIONS: { id: ThemePref; label: string; icon: string }[] = [
  { id: 'light', label: 'Light', icon: '☀️' },
  { id: 'dark',  label: 'Dark',  icon: '🌙' },
  { id: 'auto',  label: 'Auto',  icon: '🌗' },
]
const FONT_OPTIONS: { id: FontSizePref; label: string }[] = [
  { id: 'sm', label: 'Small' },
  { id: 'md', label: 'Medium' },
  { id: 'lg', label: 'Large' },
]
export function ThemeFontSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentUser, updateUser } = useApp()
  if (!currentUser) return null
  const theme = currentUser.theme ?? 'light'
  const fontSize = currentUser.fontSize ?? 'md'
  return (
    <BottomSheet open={open} onClose={onClose} title="Theme & Font" subtitle="Personalize how mCare looks for you"
      footer={<SheetButton onClick={onClose}>Done</SheetButton>}>
      <Field label="Theme">
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map(t => (
            <button key={t.id} onClick={() => updateUser(currentUser.id, { theme: t.id } as Partial<typeof currentUser>)}
              className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 ${theme === t.id ? 'border-teal-500 bg-teal-50' : 'border-gray-100 bg-gray-50'}`}>
              <span className="text-lg">{t.icon}</span>
              <span className="text-[11px] font-semibold text-gray-700">{t.label}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Font Size">
        <div className="grid grid-cols-3 gap-2">
          {FONT_OPTIONS.map(f => (
            <button key={f.id} onClick={() => updateUser(currentUser.id, { fontSize: f.id } as Partial<typeof currentUser>)}
              className={`py-3 rounded-xl border-2 font-semibold text-gray-700 ${fontSize === f.id ? 'border-teal-500 bg-teal-50' : 'border-gray-100 bg-gray-50'}`}
              style={{ fontSize: f.id === 'sm' ? 12 : f.id === 'md' ? 14 : 16 }}>
              {f.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Preview">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
          <p className="text-sm font-bold text-gray-900">Blood Pressure</p>
          <p className="text-xs text-gray-500 mt-0.5">142/91 mmHg · sent to your doctor</p>
          <p className="text-[11px] text-gray-400 mt-1">Changes apply across the app instantly.</p>
        </div>
      </Field>
    </BottomSheet>
  )
}

/* ─── Help & Support sheet ───────────────────────────────────────────── */
export function HelpSupportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentUser, supportTickets, createSupportTicket } = useApp()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const { show, node } = useToast()
  const saving = useSave()

  useEffect(() => { if (open) { setSubject(''); setMessage(''); saving.clear() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentUser) return null
  const mine = supportTickets.filter(t => t.userId === currentUser.id)

  const submit = async () => {
    if (!subject.trim() || !message.trim()) return
    if (!(await saving.run(() => createSupportTicket(currentUser.id, subject.trim(), message.trim()))).ok) return
    show('Request sent to admin')
    setSubject(''); setMessage('')
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Help & Support" subtitle="Ask an administrator for help"
      footer={<SheetButton onClick={onClose}>Close</SheetButton>}>
      <Field label="Subject">
        <input value={subject} maxLength={120} onChange={e => setSubject(e.target.value)} className={inputCls} placeholder="e.g. Can't update my phone number" />
      </Field>
      <Field label="Message">
        <textarea value={message} maxLength={2000} onChange={e => setMessage(e.target.value)} rows={3} className={`${inputCls} resize-none`}
          placeholder="Describe what you need help with…" />
      </Field>
      <SheetButton disabled={!subject.trim() || !message.trim() || saving.busy} onClick={submit}>{saving.busy ? 'Sending…' : 'Send to Admin'}</SheetButton>
      <SaveError message={saving.error} className="mt-2" />
      {node}

      {mine.length > 0 && (
        <div className="mt-5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Your Requests</p>
          <div className="flex flex-col gap-2">
            {mine.map(t => (
              <div key={t.id} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-gray-900 truncate">{t.subject}</p>
                  <Pill color={t.status === 'open' ? 'amber' : 'green'}>{t.status}</Pill>
                </div>
                <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{t.message}</p>
                {t.resolutionNote && (
                  <p className="text-[11px] text-emerald-700 mt-1.5 bg-emerald-50 rounded-lg px-2 py-1.5">↳ {t.resolutionNote}</p>
                )}
                <p className="text-[9px] text-gray-400 mt-1">{t.createdAt}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </BottomSheet>
  )
}

/* ─── Deactivate Account sheet ───────────────────────────────────────── */
export function DeactivateAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentUser, setUserStatus, setCurrentUser } = useApp()
  const [confirmText, setConfirmText] = useState('')
  const saving = useSave()

  useEffect(() => { if (open) { setConfirmText(''); saving.clear() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentUser) return null

  const confirmDeactivate = async () => {
    if (!(await saving.run(() => setUserStatus(currentUser.id, 'deactivated'))).ok) return
    setCurrentUser(null)
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Deactivate Account"
      subtitle="This signs you out and closes your account. Your record is kept, and an administrator can make the account active again."
      footer={
        <>
          <SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton>
          <SheetButton tone="danger" disabled={confirmText.trim().toUpperCase() !== 'DEACTIVATE' || saving.busy} onClick={confirmDeactivate}>
            {saving.busy ? 'Deactivating…' : 'Deactivate'}
          </SheetButton>
        </>
      }>
      <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 mb-4">
        <p className="text-[11px] text-red-600 leading-relaxed">
          You won't be able to sign in again until your account is reactivated. Your data is kept and nothing is deleted.
        </p>
      </div>
      <Field label="Type DEACTIVATE to confirm">
        <input value={confirmText} onChange={e => setConfirmText(e.target.value)} className={inputCls} placeholder="DEACTIVATE" />
      </Field>
      <SaveError message={saving.error} />
    </BottomSheet>
  )
}

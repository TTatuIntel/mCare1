import { useEffect, useState } from 'react'
import { startTotpSetup, verifyTotp, type TotpSetup as Setup } from '@/shared/api/authBackend'
import { copyText } from '@/shared/lib/clipboard'
import { AuthButton, OtpInput } from './authKit'

/**
 * Setting up an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…):
 * add mCare to it with the QR code (hosted projects), the setup key or the link, then enter the
 * code it shows. `onDone` runs once the code is accepted: this session has then passed the second step.
 * Used at sign-in (when an admin requires it) and from Profile → Two-step sign-in.
 */
export function TotpSetupPanel({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    void startTotpSetup().then(r => { if (!live) return; if ('error' in r) setError(r.error); else setSetup(r) })
    return () => { live = false }
  }, [])

  const verify = async (entered: string) => {
    if (!setup || busy) return
    setBusy(true)
    const failed = await verifyTotp(setup.factorId, entered)
    setBusy(false)
    if (failed) { setError(failed); setCode('') } else onDone()
  }

  if (!setup) return <p role="status" className={`text-xs text-center ${error ? 'text-red-600' : 'text-gray-400'}`}>{error || 'Preparing your setup key…'}</p>
  const grouped = setup.secret.replace(/(.{4})/g, '$1 ').trim()

  return (
    <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); if (code.length === 6) void verify(code) }}>
      <ol className="text-xs text-gray-600 leading-relaxed list-decimal pl-4 flex flex-col gap-1">
        <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password or similar).</li>
        <li>{setup.qr ? 'Scan this code, or add an account with the key below.' : 'Add an account and type in this key (or tap the link on this phone).'}</li>
        <li>Enter the 6-digit code the app shows for mCare.</li>
      </ol>
      {setup.qr && <img src={setup.qr} alt="QR code to add mCare to your authenticator app" className="w-40 h-40 self-center bg-white rounded-xl p-2 border border-gray-100" />}
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Setup key</p>
        <p className="font-mono text-sm text-gray-800 break-all select-all" aria-label="Setup key">{grouped}</p>
        <div className="flex gap-3 mt-1">
          <button type="button" className="text-xs font-semibold text-teal-700"
            onClick={async () => { setCopied(await copyText(setup.secret)); setTimeout(() => setCopied(false), 2000) }}>{copied ? 'Copied' : 'Copy key'}</button>
          <a href={setup.uri} className="text-xs font-semibold text-teal-700">Open in authenticator app</a>
        </div>
      </div>
      <OtpInput value={code} invalid={!!error} onChange={v => { setCode(v); setError(''); if (v.length === 6) void verify(v) }} />
      <p role="status" className="min-h-4 text-xs text-center text-red-600">{error}</p>
      <AuthButton type="submit" disabled={code.length < 6 || busy}>{busy ? 'Checking…' : 'Turn on two-step sign-in'}</AuthButton>
    </form>
  )
}

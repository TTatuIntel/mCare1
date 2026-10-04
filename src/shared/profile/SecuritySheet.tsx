import { useEffect, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SaveError, useSave } from '@/shared/ui/BottomSheet'
import { removeTotp, verifiedTotp } from '@/shared/api/authBackend'
import { TotpSetupPanel } from '@/shared/auth/TotpSetup'
import { dateLabel } from '@/shared/lib/vitals'

/**
 * Profile → Two-step sign-in: each person's own choice (unless an admin requires it for their role).
 * Once on, signing in needs the code from an authenticator app as well as the password, and the
 * database refuses any session that has not given it.
 */
export function SecuritySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { live, currentUser, settings } = useApp()
  const [factor, setFactor] = useState<{ id: string; createdAt?: string } | null | undefined>(undefined)
  const [setting, setSetting] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const save = useSave()
  const required = !!currentUser && settings.security.mfaRequiredRoles.includes(currentUser.role)

  const load = () => { if (live) void verifiedTotp().then(setFactor, () => setFactor(null)) }
  useEffect(() => { if (open) { setSetting(false); setConfirmOff(false); save.clear(); load() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const turnOff = async () => {
    if (!factor) return
    const r = await save.run(async () => { const failed = await removeTotp(factor.id); return failed ? { ok: false as const, error: failed } : { ok: true as const, value: undefined } })
    if (r.ok) { setFactor(null); setConfirmOff(false) }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Two-step sign-in"
      subtitle="A code from your phone as well as your password, so a stolen password alone opens nothing.">
      {!live ? (
        <p className="text-xs text-gray-600 bg-gray-50 rounded-xl px-3 py-2.5">Two-step sign-in works when mCare is connected to its server. Demo mode keeps everything on this device.</p>
      ) : factor === undefined ? (
        <p role="status" className="text-xs text-gray-400">Checking…</p>
      ) : factor ? (
        <div className="flex flex-col gap-3">
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5">
            <p className="text-sm font-bold text-emerald-800">On</p>
            <p className="text-xs text-emerald-700">Signing in asks for the code from your authenticator app{factor.createdAt ? ` · set up ${dateLabel(new Date(factor.createdAt))}` : ''}.</p>
          </div>
          {required ? (
            <p className="text-xs text-gray-500">mCare requires two-step sign-in for your role, so it stays on.</p>
          ) : confirmOff ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-700">Turn it off? Your password alone will open your account again.</p>
              <div className="flex gap-2">
                <button onClick={turnOff} disabled={save.busy} className="flex-1 rounded-xl bg-red-600 text-white text-xs font-bold py-2.5 disabled:opacity-50">{save.busy ? 'Turning off…' : 'Turn off'}</button>
                <button onClick={() => setConfirmOff(false)} className="flex-1 rounded-xl border border-gray-200 text-xs font-bold py-2.5 text-gray-700">Keep it on</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmOff(true)} className="self-start text-xs font-semibold text-red-600">Turn off two-step sign-in</button>
          )}
          <SaveError message={save.error} />
        </div>
      ) : setting ? (
        <TotpSetupPanel onDone={() => { setSetting(false); load() }} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-600 leading-relaxed">
            {required ? 'mCare requires two-step sign-in for your role. ' : 'Recommended for everyone, and especially for doctors and staff. '}
            You need an authenticator app on your phone. If you lose the phone, an mCare administrator can reset it for you.
          </p>
          <button onClick={() => setSetting(true)} className="rounded-xl bg-teal-700 text-white text-sm font-bold py-3">Set up two-step sign-in</button>
        </div>
      )}
    </BottomSheet>
  )
}

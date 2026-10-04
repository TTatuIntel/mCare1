import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'

/** What counts as using mCare. */
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

/**
 * Signs out a session nobody is using, after the minutes an admin set for the role (Settings →
 * Security; 0 = never), so a clinic computer left open does not stay open. A notice comes a
 * minute before; any touch, key or scroll keeps the session. Time is measured by the clock, so a
 * phone that slept past the limit is signed out when it wakes.
 */
export function IdleSignOut() {
  const { currentUser, settings, signOut } = useApp()
  const minutes = currentUser ? settings.security.idleMinutes[currentUser.role] ?? 0 : 0
  const last = useRef(Date.now())
  const [warn, setWarn] = useState(false)

  useEffect(() => {
    if (!minutes) { setWarn(false); return }
    last.current = Date.now()
    const used = () => { last.current = Date.now(); setWarn(false) }
    ACTIVITY.forEach(e => window.addEventListener(e, used, { passive: true, capture: true }))
    const check = () => {
      const idle = Date.now() - last.current
      if (idle >= minutes * 60_000) signOut(`You were signed out after ${minutes} minutes without use.`)
      else setWarn(minutes > 1 && idle >= (minutes - 1) * 60_000)
    }
    const timer = setInterval(check, 5_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      ACTIVITY.forEach(e => window.removeEventListener(e, used, { capture: true }))
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [minutes]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!warn) return null
  return (
    <div role="alertdialog" aria-live="assertive" aria-label="Still there?"
      className="fixed inset-x-4 bottom-28 z-50 mx-auto max-w-sm rounded-2xl bg-white shadow-xl border border-amber-200 p-4 flex items-center gap-3 sheet-fade @2xl:bottom-8">
      <span className="text-2xl" aria-hidden="true">⏳</span>
      <p className="flex-1 text-xs text-gray-700"><b className="text-gray-900">Still there?</b> You will be signed out in under a minute to keep this record private.</p>
      <button onClick={() => { last.current = Date.now(); setWarn(false) }} className="text-xs font-bold text-white bg-teal-700 px-3 py-2 rounded-full flex-shrink-0">Stay signed in</button>
    </div>
  )
}

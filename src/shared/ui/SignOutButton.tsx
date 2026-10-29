import { useEffect, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'

/** A door with an arrow leaving it. The arrow slides out on hover and when pressed. */
function DoorIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={`w-5 h-5 flex-shrink-0 ${className}`} aria-hidden="true">
      <path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14" />
      <g className="transition-transform duration-300 ease-out motion-safe:group-hover:translate-x-1 motion-safe:group-focus-visible:translate-x-1 group-data-[leaving]:translate-x-2">
        <path d="M10 12h10" />
        <path d="m17 8.5 3.5 3.5-3.5 3.5" />
      </g>
    </svg>
  )
}

/**
 * The way out, the same in every portal: `sidebar` (web, full width with the label), `rail` (tablet, icon
 * with a label under it), `card` (the Profile page), `icon` (the phone header). Always visible, red, and
 * animated on hover and press. The header icon sits beside the avatar, so its first tap only asks
 * ("Sign out?") and a second tap within a few seconds signs out.
 */
export function SignOutButton({ variant }: { variant: 'sidebar' | 'rail' | 'card' | 'icon' }) {
  const { setCurrentUser } = useApp()
  const [leaving, setLeaving] = useState(false)
  const out = () => { setLeaving(true); setCurrentUser(null) }
  const base = 'group relative overflow-hidden flex items-center justify-center font-bold text-red-600 transition-all duration-200 motion-safe:animate-[rise-in_.45s_ease-out_both] active:scale-[.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400'
  const shine = <span aria-hidden="true" className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/60 to-transparent -skew-x-12 -translate-x-full motion-safe:group-hover:translate-x-[400%] transition-transform duration-700" />

  const [asking, setAsking] = useState(false)
  useEffect(() => { if (!asking) return; const t = setTimeout(() => setAsking(false), 3500); return () => clearTimeout(t) }, [asking])

  if (variant === 'icon') return (
    <button type="button" onClick={() => (asking ? out() : setAsking(true))} data-leaving={leaving || undefined}
      aria-label={asking ? 'Tap again to sign out' : 'Sign out'}
      className={`${base.replace('text-red-600', '')} h-10 rounded-full border shadow-sm transition-[width,background-color] duration-300 ${asking ? 'w-28 gap-1.5 bg-red-600 text-white border-red-600' : 'w-10 bg-red-50 text-red-600 border-red-100'}`}>
      <DoorIcon />{asking && <span className="text-xs whitespace-nowrap motion-safe:animate-[rise-in_.25s_ease-out_both]">Sign out?</span>}
    </button>
  )
  if (variant === 'rail') return (
    <button type="button" onClick={out} data-leaving={leaving || undefined} title="Sign out"
      className={`${base} flex-col gap-1 w-full py-2 rounded-xl bg-red-50 hover:bg-red-100`}>
      {shine}<DoorIcon /><span className="text-[9px]">Sign out</span>
    </button>
  )
  if (variant === 'sidebar') return (
    <button type="button" onClick={out} data-leaving={leaving || undefined}
      className={`${base} gap-2 w-full py-2.5 rounded-xl text-sm bg-red-50 border border-red-100 hover:bg-red-100 hover:border-red-200 hover:shadow-sm`}>
      {shine}<DoorIcon /><span>{leaving ? 'Signing out…' : 'Sign out'}</span>
    </button>
  )
  return (
    <button type="button" onClick={out} data-leaving={leaving || undefined}
      className={`${base} gap-2 w-full py-3 rounded-2xl text-sm bg-red-50 border-2 border-red-100 hover:bg-red-100 hover:border-red-200`}>
      {shine}<DoorIcon /><span>{leaving ? 'Signing out…' : 'Sign Out'}</span>
    </button>
  )
}

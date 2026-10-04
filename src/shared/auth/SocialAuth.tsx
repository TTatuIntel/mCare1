import { useRef, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { SOCIAL_PROVIDERS, isEmail, type ProviderStyle } from '@/shared/state/auth'
import { BottomSheet } from '@/shared/ui/BottomSheet'
import { backendConfigured } from '@/shared/api/supabase'
import { reducedMotion } from '@/shared/layout/motion'
import { providerAvailable, rememberConsent, startProviderSignIn } from '@/shared/api/authBackend'
import { appBaseUrl } from '@/shared/email/emailTemplate'
import { AuthButton, AuthField, authInputCls } from './authKit'
import { Consent, LegalSheet } from './Legal'

function ProviderMark({ mark, outline, colors, className = 'w-[18px] h-[18px]' }: { mark: string; outline?: boolean; colors?: string[]; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true"
      {...(outline ? { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const } : { fill: 'currentColor' })}>
      {mark.split('|').map((d, i) => <path key={d} d={d} fill={outline ? undefined : colors?.[i]} />)}
    </svg>
  )
}

/** The row behaves like a dock: buttons swell and lift as the pointer nears them. */
const DOCK_GROW = 0.2
const DOCK_LIFT_PX = 5
/** How far the swell spreads, in button widths. */
const DOCK_REACH = 1.6

/**
 * "Continue with Google / Apple / Facebook / Instagram / X / Yahoo": one compact row, so the sign-in page never scrolls. Signs in an existing account or
 * creates a patient on first use (`socialAuth`).
 *
 * Live mode (backend keys set): a tap goes straight to the provider's own
 * sign-in page, with no sheet of ours in between, and LoginScreen opens the
 * account when it comes back. Continuing is the agreement to the Terms, as the
 * line under the row says. Only providers the backend supports are shown.
 * Demo mode: there is no real provider to go to, so a sheet stands in for it
 * and asks for the name and email it would hand back.
 */
/** mCare launches with Google and Apple (Supabase has no Yahoo provider; one can be added later as custom OpenID Connect). */
const LAUNCH_PROVIDERS: string[] = ['google', 'apple']
const PROVIDERS = SOCIAL_PROVIDERS.filter(p => LAUNCH_PROVIDERS.includes(p.id) && providerAvailable(p.id))
/** False when no provider can be used (the local backend): the "Or continue with" row is then left out. */
export const socialSignInAvailable = PROVIDERS.length > 0
const GRID = PROVIDERS.length > 1 ? 'grid-cols-2' : 'grid-cols-1'

export function SocialButtons() {
  const { socialAuth, setCurrentUser, updateUser } = useApp()
  const [provider, setProvider] = useState<ProviderStyle | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  /** Live mode: the provider whose sign-in page is being opened. */
  const [leaving, setLeaving] = useState<ProviderStyle | null>(null)
  const [legalOpen, setLegalOpen] = useState(false)

  const ready = agreed && isEmail(email)

  /** Live mode: off to the provider's own page. Only a failure to start comes back here. */
  const leave = async (p: ProviderStyle) => {
    if (leaving) return
    setError('')
    rememberConsent()
    setLeaving(p)
    const failed = await startProviderSignIn(p.id, appBaseUrl())
    if (failed) { setError(failed); setLeaving(null) }
  }

  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const frame = useRef(0)
  /** Swell the buttons around the pointer (`x` in viewport px), or settle them all with `null`. */
  const dock = (x: number | null) => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const still = x === null || reducedMotion()
      buttons.current.forEach(el => {
        if (!el) return
        if (still) { el.style.transform = ''; el.style.zIndex = ''; return }
        // offsetWidth, not the measured box: that one grows with the swell.
        const r = el.getBoundingClientRect()
        const near = Math.max(0, 1 - Math.abs(x - (r.left + r.width / 2)) / (el.offsetWidth * DOCK_REACH))
        el.style.transform = `translateY(${(-near * DOCK_LIFT_PX).toFixed(1)}px) scale(${(1 + near * DOCK_GROW).toFixed(3)})`
        el.style.zIndex = String(Math.round(near * 10))
      })
    })
  }
  /** Demo mode: the stand-in sheet plays the provider. */
  const submit = () => {
    if (!provider || !ready) return
    const res = socialAuth(provider.id, email, name)
    if (!res.ok || !res.user) { setError(res.error ?? 'Could not sign you in. Please try again.'); return }
    if (res.isNew) updateUser(res.user.id, { termsAcceptedAt: Date.now() })
    setProvider(null)
    setCurrentUser(res.user)
  }

  return (
    <>
      <div className={`grid ${GRID} gap-1.5 @5xl:gap-2`}
        onPointerMove={e => dock(e.clientX)} onPointerDown={e => dock(e.clientX)}
        onPointerLeave={() => dock(null)} onPointerUp={e => { if (e.pointerType !== 'mouse') dock(null) }} onPointerCancel={() => dock(null)}>
        {PROVIDERS.map((p, i) => (
          <button key={p.id} ref={el => { buttons.current[i] = el }} type="button" aria-label={`Continue with ${p.label}`}
            onClick={() => { if (backendConfigured) leave(p); else { setProvider(p); setError('') } }}
            aria-busy={leaving?.id === p.id || undefined} style={{ animationDelay: `${i * 60}ms` }}
            className={`${leaving?.id === p.id ? 'animate-pulse' : leaving ? 'opacity-50' : ''} social-btn auth-tile-in group relative h-11 rounded-2xl border flex items-center justify-center shadow-sm transition-all duration-200 ease-out hover:shadow-lg focus-visible:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 active:scale-[.92] ${p.bg} ${p.border} ${p.text} ${p.glow}`}>
            {/* Clipped to the button, so the sheen never spills past its corners. */}
            <span aria-hidden className="absolute inset-0 overflow-hidden rounded-[inherit]">
              <span className="social-sheen absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
            </span>
            <span className="social-mark relative flex">
              <ProviderMark mark={p.mark} outline={p.outline} colors={p.colors} className="w-[18px] h-[18px] @2xl:w-5 @2xl:h-5" />
            </span>
            <span className="relative ml-2 text-xs font-semibold">{p.label}</span>
            {/* The platform's name, for pointers that can hover. */}
            <span aria-hidden className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-white opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
              {p.label}
            </span>
          </button>
        ))}
      </div>

      {backendConfigured && <>
        <p className="text-center text-[11px] text-gray-500" aria-live="polite">
          {leaving ? `Opening ${leaving.label}…` : <>
            By continuing you agree to the{' '}
            <button type="button" onClick={() => setLegalOpen(true)} className="font-semibold text-teal-700 underline underline-offset-2">Terms &amp; Privacy Policy</button>
          </>}
        </p>
        {error && <p role="alert" className="auth-shake text-xs text-red-500 text-center">{error}</p>}
        <LegalSheet open={legalOpen} onClose={() => setLegalOpen(false)} />
      </>}

      {!backendConfigured && (
        <BottomSheet open={!!provider} onClose={() => setProvider(null)}
          title={`Continue with ${provider?.label ?? ''}`}
          subtitle={`Demo mode: this stands in for ${provider?.label ?? 'the provider'}’s own sign-in window.`}>
          {/* stopPropagation: React bubbles this through the portal to the sign-in form the buttons sit in. */}
          <form className="flex flex-col gap-3 pb-2" onSubmit={e => { e.preventDefault(); e.stopPropagation(); submit() }}>
            <AuthField label={`${provider?.label ?? ''} account email`}>
              <input type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setError('') }}
                placeholder="you@example.com" className={authInputCls} />
            </AuthField>
            <AuthField label="Name (new accounts)">
              <input type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Grace Otieno" className={authInputCls} />
            </AuthField>
            <Consent checked={agreed} onChange={setAgreed} />
            {error && <p role="alert" className="auth-shake text-xs text-red-500 text-center">{error}</p>}
            <AuthButton type="submit" disabled={!ready}>Continue</AuthButton>
          </form>
        </BottomSheet>
      )}
    </>
  )
}

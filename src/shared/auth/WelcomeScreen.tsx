import { useRef, useState } from 'react'
import { BottomSheet } from '@/shared/ui/BottomSheet'
import MCareLogo from '@/shared/layout/MCareLogo'
import { AuthDivider, AuthIcon, AuthRights, AuthSwitch, OWNER } from './authKit'
import { SocialButtons, socialSignInAvailable } from './SocialAuth'
import { backendConfigured } from '@/shared/api/supabase'
import { reducedMotion } from '@/shared/layout/motion'

const SUPPORT_EMAIL = 'support@matendocare.com'

/* ─── Help & support (signed out) ───────────────────────────────────── */

const HELP: { q: string; a: string }[] = [
  { q: 'I did not get my verification code',
    a: 'Check your spam folder first. On the verification step, tap “Resend code” to get a new one; the older code stops working.' },
  { q: 'I am a doctor or care staff',
    a: 'Staff accounts are created by your administrator. Sign in with the email they registered for you, then verify it with the code we send.' },
  { q: 'I cannot sign in',
    a: 'Make sure you are using the email you registered with. If you have forgotten your password, tap “Forgot password?” on the sign-in step to reset it with a code.' },
  { q: 'Who can see my health information?',
    a: 'Only you and the care team looking after you. You choose what to share from inside the app.' },
]

function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Help & Support" subtitle="Quick answers before you sign in">
      <div className="flex flex-col gap-2">
        {HELP.map(h => (
          <details key={h.q} className="group rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-gray-900">
              {h.q}
              <AuthIcon name="arrow" className="w-3.5 h-3.5 shrink-0 text-teal-700 transition-transform group-open:rotate-90" />
            </summary>
            <p className="mt-2 text-xs text-gray-500 leading-relaxed">{h.a}</p>
          </details>
        ))}
        <a href={`mailto:${SUPPORT_EMAIL}`}
          className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-teal-700 py-3 text-sm font-bold text-white">
          <AuthIcon name="mail" className="w-4 h-4" />
          Email support
        </a>
        <p className="text-center text-[11px] text-gray-400">{SUPPORT_EMAIL}</p>
      </div>
    </BottomSheet>
  )
}

/* ─── About the application ─────────────────────────────────────────── */

const DEVELOPER = 'Tattu Intel'
const YEAR = new Date().getFullYear()
/** From package.json. A dev server started before the version was wired in has no value yet. */
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''

function AboutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows = [
    ...(VERSION ? [{ label: 'Version', value: VERSION, mono: true }] : []),
    { label: 'Owner', value: OWNER },
    { label: 'Developed by', value: DEVELOPER },
    { label: 'Support', value: SUPPORT_EMAIL },
  ] as { label: string; value: string; mono?: boolean }[]
  return (
    <BottomSheet open={open} onClose={onClose} title="About mCare" subtitle="Your health, our priority">
      <div className="flex flex-col gap-3">
        <div className="flex justify-center py-1"><MCareLogo size="sm" /></div>
        <p className="text-center text-xs text-gray-500 leading-relaxed">
          One app for you and your care team: vitals, medicines and meals, appointments, records and emergency help.
        </p>
        <dl className="rounded-xl border border-gray-100 bg-gray-50 px-3">
          {rows.map(r => (
            <div key={r.label} className="flex items-center justify-between gap-3 border-b border-gray-100 py-2.5 text-xs last:border-0">
              <dt className="text-gray-500">{r.label}</dt>
              <dd className={`font-semibold text-gray-900 truncate ${r.mono ? 'font-mono' : ''}`}>{r.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-center text-[11px] text-gray-400">
          © <span className="font-mono">{YEAR}</span> {OWNER}. All rights reserved.
        </p>
      </div>
    </BottomSheet>
  )
}

/* ─── Get Started ───────────────────────────────────────────────────── */

/** How far (px) the button leans towards a mouse pointer over it. */
const LEAN_X = 6, LEAN_Y = 3

/**
 * The way in. At rest: a glow breathes under it, a ring pulses out from it, a
 * sheen crosses it and the arrow nudges forward. Under a mouse: it leans
 * towards the pointer, a light follows the pointer across it, and the arrow
 * flies out of its tile and back in. Pressed: a ripple spreads from the touch.
 */
function GetStartedButton({ onClick }: { onClick: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])

  const track = (e: React.PointerEvent<HTMLButtonElement>) => {
    const wrap = wrapRef.current
    if (!wrap) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left, y = e.clientY - r.top
    wrap.style.setProperty('--mx', `${x}px`)
    wrap.style.setProperty('--my', `${y}px`)
    if (e.pointerType !== 'mouse' || reducedMotion()) return
    wrap.style.transform = `translate(${((x / r.width - 0.5) * 2 * LEAN_X).toFixed(1)}px, ${((y / r.height - 0.5) * 2 * LEAN_Y).toFixed(1)}px)`
  }

  return (
    <div ref={wrapRef} className="relative mx-auto mt-7 w-fit transition-transform duration-200 ease-out">
      <span aria-hidden className="auth-glow absolute inset-x-6 -bottom-1.5 h-8 rounded-full bg-teal-500/60 blur-xl" />
      <span aria-hidden className="auth-cta-ring pointer-events-none absolute inset-0 rounded-full ring-2 ring-teal-500/60" />
      <button type="button" onClick={onClick}
        onPointerMove={track}
        onPointerLeave={() => { if (wrapRef.current) wrapRef.current.style.transform = '' }}
        onPointerDown={e => {
          track(e)
          const r = e.currentTarget.getBoundingClientRect()
          setRipples(rs => [...rs, { id: e.timeStamp, x: e.clientX - r.left, y: e.clientY - r.top }])
        }}
        className="group relative w-full overflow-hidden rounded-full bg-teal-700 py-1.5 pl-6 pr-1.5 flex items-center gap-4 text-white text-[15px] font-bold ring-1 ring-inset ring-white/20 shadow-lg shadow-teal-700/30 transition-all duration-300 hover:bg-teal-800 hover:shadow-xl hover:shadow-teal-700/40 active:scale-[.96] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/40">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent" />
        <span aria-hidden className="auth-sheen absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        {/* A soft light under the pointer. */}
        <span aria-hidden className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: 'radial-gradient(90px circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,.3), transparent 70%)' }} />
        {ripples.map(rp => (
          <span key={rp.id} aria-hidden onAnimationEnd={() => setRipples(rs => rs.filter(x => x.id !== rp.id))}
            className="auth-ripple pointer-events-none absolute -ml-3 -mt-3 h-6 w-6 rounded-full bg-white/40" style={{ left: rp.x, top: rp.y }} />
        ))}
        {/* The pill hugs its label and arrow: no wider than what it says. */}
        <span className="relative whitespace-nowrap transition-[letter-spacing] duration-300 group-hover:tracking-wide">Get Started</span>
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/15 ring-1 ring-inset ring-white/25 backdrop-blur-sm transition-all duration-300 group-hover:bg-white group-hover:text-teal-700 group-active:scale-90">
          {/* One arrow leaves to the right as its twin arrives from the left. */}
          <span className="flex transition-transform duration-300 ease-out group-hover:translate-x-9">
            <span className="auth-nudge flex"><AuthIcon name="arrow" className="w-4 h-4" /></span>
          </span>
          <span aria-hidden className="absolute flex -translate-x-9 transition-transform duration-300 ease-out group-hover:translate-x-0">
            <AuthIcon name="arrow" className="w-4 h-4" />
          </span>
        </span>
      </button>
    </div>
  )
}

/* ─── Welcome ───────────────────────────────────────────────────────── */

/**
 * The welcome step: the ways in. Get Started is patient sign-up (only
 * patients self-register); staff accounts are created by an admin. The brand
 * and feature tour around it come from AuthShell.
 */
export function WelcomeScreen({ onGetStarted, onSignIn, onDemo }: {
  onGetStarted: () => void
  onSignIn: () => void
  onDemo: () => void
}) {
  const [helpOpen, setHelpOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    // Mobile: the tour keeps its own height and this takes the rest of the screen, so no band of white is left between them.
    <div className="flex flex-1 flex-col gap-3">
      {/* The one place to act, straight on the page: no card behind it. */}
      <section aria-labelledby="welcome-start" className="flex flex-1 flex-col justify-center text-center">
        {/* A touch larger than the tour above it, so the eye lands on the way in. */}
        <h2 id="welcome-start" className="text-xl font-black text-gray-900 font-display leading-tight">Let’s get you started</h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">New to mCare? Create your account in a minute.</p>

        <GetStartedButton onClick={onGetStarted} />

        <AuthSwitch className="mt-5" prompt="Already have an account?" action="Sign in" onClick={onSignIn} />
      </section>

      {socialSignInAvailable && <>
        <AuthDivider>Or continue with</AuthDivider>
        <SocialButtons />
      </>}

      <div className="flex items-center justify-center gap-3.5 text-xs @2xl:text-sm font-semibold text-teal-700 flex-wrap">
        {/* Demo accounts exist only in demo mode, where the sample data lives. */}
        {!backendConfigured && <>
          <button type="button" onClick={onDemo} className="underline-offset-4 hover:underline">Try a demo account</button>
          <span aria-hidden className="h-2.5 w-px bg-gray-300" />
        </>}
        <button type="button" onClick={() => setHelpOpen(true)} className="flex items-center gap-1 underline-offset-4 hover:underline">
          <AuthIcon name="help" className="w-3.5 h-3.5 @2xl:w-4 @2xl:h-4" />
          Help &amp; support
        </button>
        <span aria-hidden className="h-2.5 w-px bg-gray-300" />
        <button type="button" onClick={() => setAboutOpen(true)} className="underline-offset-4 hover:underline">About</button>
      </div>

      {/* One line; the version and who built it are under About. */}
      <AuthRights />

      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
      <AboutSheet open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  )
}

import { useState } from 'react'
import { BottomSheet } from '@/shared/ui/BottomSheet'
import MCareLogo from '@/shared/layout/MCareLogo'
import { AuthDivider, AuthIcon } from './authKit'
import { SocialButtons } from './SocialAuth'

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

const OWNER = 'mcare.com'
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
    <div className="flex flex-col gap-3">
      {/* The one place to act, straight on the page: no card behind it. */}
      <section aria-labelledby="welcome-start" className="text-center">
        <h2 id="welcome-start" className="text-lg font-black text-gray-900 font-display leading-tight">Let’s get you started</h2>
        <p className="mt-1 text-xs text-gray-600">New to mCare? Create your account in a minute.</p>

        {/* Get Started: a soft glow breathes under it, a sheen crosses it, and the arrow sits in a frosted tile. */}
        <div className="relative mx-auto mt-3.5 w-56 @5xl:w-64">
          <span aria-hidden className="auth-glow absolute inset-x-6 -bottom-1.5 h-8 rounded-full bg-teal-500/60 blur-xl" />
          <button type="button" onClick={onGetStarted}
            className="group relative w-full overflow-hidden rounded-full bg-teal-700 py-1.5 pl-5 pr-1.5 flex items-center text-white text-sm font-bold ring-1 ring-inset ring-white/20 shadow-lg shadow-teal-700/30 transition-all duration-300 hover:-translate-y-0.5 hover:bg-teal-800 hover:shadow-xl active:translate-y-0 active:scale-[.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/40">
            <span aria-hidden className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent" />
            <span aria-hidden className="auth-sheen absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            {/* pl-9 balances the arrow tile, so the label stays centred. */}
            <span className="relative flex-1 pl-9 text-center">Get Started</span>
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-inset ring-white/25 backdrop-blur-sm transition-colors group-hover:bg-white/25">
              <span className="auth-nudge flex"><AuthIcon name="arrow" className="w-4 h-4" /></span>
            </span>
          </button>
        </div>

        <p className="mt-3.5 text-xs text-gray-600">
          Already have an account?{' '}
          <button type="button" onClick={onSignIn} className="font-bold text-teal-700 underline underline-offset-4 hover:text-teal-800">Sign in</button>
        </p>
      </section>

      <AuthDivider>Or continue with</AuthDivider>
      <SocialButtons />

      <div className="flex items-center justify-center gap-3 text-[10px] @2xl:text-xs font-semibold text-teal-700 flex-wrap">
        <button type="button" onClick={onDemo} className="underline-offset-4 hover:underline">Try a demo account</button>
        <span aria-hidden className="h-2 w-px bg-gray-300" />
        <button type="button" onClick={() => setHelpOpen(true)} className="flex items-center gap-1 underline-offset-4 hover:underline">
          <AuthIcon name="help" className="w-3 h-3 @2xl:w-3.5 @2xl:h-3.5" />
          Help &amp; support
        </button>
        <span aria-hidden className="h-2 w-px bg-gray-300" />
        <button type="button" onClick={() => setAboutOpen(true)} className="underline-offset-4 hover:underline">About</button>
      </div>

      <p className="text-center text-[9px] @2xl:text-[10px] text-gray-400 leading-relaxed">
        © <span className="font-mono">{YEAR}</span> {OWNER} · All rights reserved
        <br />
        Developed by <span className="font-semibold text-gray-500">{DEVELOPER}</span>
        {VERSION && <> · Version <span className="font-mono font-semibold text-gray-500">{VERSION}</span></>}
      </p>

      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
      <AboutSheet open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  )
}

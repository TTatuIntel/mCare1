import { useState } from 'react'
import { BottomSheet } from '@/shared/ui/BottomSheet'
import MCareLogo from '@/shared/layout/MCareLogo'
import { AuthDivider, AuthIcon, TrustBadges, type AuthIconName } from './authKit'
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

  return (
    <div className="flex flex-col gap-2.5 -mt-2">
      <div className="relative rounded-2xl bg-white/60 backdrop-blur-md ring-1 ring-white/20 px-4 py-3.5 text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
        <h2 className="text-base @2xl:text-lg @5xl:text-xl font-black text-gray-900 font-display">Let’s get you started</h2>
        <p className="text-[11px] @2xl:text-xs text-gray-500 mt-1.5">Create your account or sign in.</p>

        {/* Mobile and tablet: as wide as its label. Web: fills the card. */}
        <button type="button" onClick={onGetStarted}
          className="group relative overflow-hidden mt-3 px-6 py-2 @2xl:px-8 @2xl:py-2.5 @5xl:w-full rounded-xl bg-teal-700 text-white text-xs @2xl:text-sm font-bold shadow-sm shadow-teal-700/30 flex items-center justify-center gap-1.5 transition-all duration-300 hover:bg-teal-800 hover:shadow-md active:scale-[.98]">
          <span aria-hidden className="auth-sheen absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          <span className="relative">Get Started</span>
          <AuthIcon name="arrow" className="relative w-3.5 h-3.5 @2xl:w-4 @2xl:h-4 transition-transform group-hover:translate-x-1" />
        </button>

        <p className="text-[11px] @2xl:text-xs text-gray-500 text-center mt-2.5">
          Already have an account?{‘ ‘}
          <button type="button" onClick={onSignIn} className="font-bold text-teal-700 underline-offset-4 hover:underline">Sign in</button>
        </p>
      </div>

      <AuthDivider>Or continue with</AuthDivider>
      <SocialButtons />

      <div className="flex items-center justify-center gap-3 text-[10px] @2xl:text-xs font-semibold text-teal-700 flex-wrap">
        <button type="button" onClick={onDemo} className="underline-offset-4 hover:underline">Try a demo account</button>
        <span aria-hidden className="h-2 w-px bg-gray-300" />
        <button type="button" onClick={() => setHelpOpen(true)} className="flex items-center gap-1 underline-offset-4 hover:underline">
          <AuthIcon name="help" className="w-3 h-3 @2xl:w-3.5 @2xl:h-3.5" />
          Help &amp; support
        </button>
      </div>

      <TrustBadges className="justify-center gap-x-3 gap-y-1 text-[9px] @2xl:text-[10px] text-gray-400 @5xl:hidden" />

      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}

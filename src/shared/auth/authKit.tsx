/** Form controls shared by the signed-out screens: sign in, create account and verification. */
import { useState } from 'react'
import { passwordStrength } from '@/shared/state/auth'

/* ─── Line icons (24px grid, stroke follows the text colour) ────────── */
const ICONS = {
  vitals: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  pill: ['m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z', 'm8.5 8.5 7 7'],
  chat: ['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4'],
  mail: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'm22 7-10 6L2 7'],
  back: ['M15 19l-7-7 7-7'],
  arrow: ['M5 12h14', 'm12 5 7 7-7 7'],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  history: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 6v6l4 2'],
  help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
} as const
export type AuthIconName = keyof typeof ICONS

export function AuthIcon({ name, className = 'w-5 h-5' }: { name: AuthIconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].map(d => <path key={d} d={d} />)}
    </svg>
  )
}

/* ─── Brand cluster ─────────────────────────────────────────────────── */

/**
 * Where each feature icon floats around the logo (an arc over its top), and
 * where it hides while the cluster is closed: tucked in behind the logo.
 */
const CLUSTER: { icon: AuthIconName; pos: string; tucked: string; delay: string }[] = [
  { icon: 'chat', pos: 'left-[5%] top-[42%]', tucked: 'translate-x-16 translate-y-3', delay: '0s' },
  { icon: 'vitals', pos: 'left-[22%] top-0', tucked: 'translate-x-10 translate-y-12', delay: '-1.2s' },
  { icon: 'pill', pos: 'top-[-8%] left-1/2 -translate-x-1/2', tucked: 'translate-y-16', delay: '-2.4s' },
  { icon: 'bell', pos: 'right-[22%] top-0', tucked: '-translate-x-10 translate-y-12', delay: '-3.6s' },
  { icon: 'users', pos: 'right-[5%] top-[42%]', tucked: '-translate-x-16 translate-y-3', delay: '-4.8s' },
]

/**
 * The logo (`children`) with the feature icons floating around it, straight on
 * the page: no card or bubble behind any of them. While `open` is false the
 * icons stay tucked away; they spring out one by one once it turns true,
 * `openDelayMs` later (time for the logo to arrive).
 */
export function BrandCluster({ children, className = '', open = true, openDelayMs = 0 }: {
  children?: React.ReactNode; className?: string; open?: boolean; openDelayMs?: number
}) {
  return (
    <div className={`relative mx-auto w-64 h-28 flex items-end justify-center ${className}`}>
      {CLUSTER.map((c, i) => (
        <span key={c.icon} aria-hidden style={{ transitionDelay: open ? `${openDelayMs + i * 70}ms` : '0ms' }}
          className={`absolute text-teal-700 transition-all motion-reduce:transition-none ${c.pos} ${open
            ? 'duration-500 ease-[cubic-bezier(.3,1.5,.5,1)]'
            : `duration-200 ease-in opacity-0 scale-50 ${c.tucked}`}`}>
          <span className="auth-float flex" style={{ animationDelay: c.delay }}>
            <AuthIcon name={c.icon} className="w-6 h-6" />
          </span>
        </span>
      ))}
      {children}
    </div>
  )
}

/* ─── Headings and navigation ───────────────────────────────────────── */

export function AuthBack({ onClick, children = 'Back' }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="self-start flex items-center gap-1 -ml-1 text-teal-700 text-sm font-semibold">
      <AuthIcon name="back" className="w-4 h-4" />
      {children}
    </button>
  )
}

export function AuthHeading({ title, subtitle, icon, center = false }: {
  title: React.ReactNode; subtitle?: React.ReactNode; icon?: AuthIconName; center?: boolean
}) {
  return (
    <div className={center ? 'text-center' : ''}>
      {icon && (
        <span className={`mb-3 flex w-10 h-10 @2xl:w-12 @2xl:h-12 rounded-xl @2xl:rounded-2xl bg-teal-700 text-white items-center justify-center shadow-md @2xl:shadow-lg shadow-teal-700/25 ${center ? 'mx-auto' : ''}`}>
          <AuthIcon name={icon} className="w-5 h-5 @2xl:w-6 @2xl:h-6" />
        </span>
      )}
      <h2 className="text-lg @2xl:text-xl font-black text-gray-900 font-display leading-tight">{title}</h2>
      {subtitle && <p className="text-xs @2xl:text-[13px] text-gray-500 mt-1 leading-relaxed">{subtitle}</p>}
    </div>
  )
}

/** Patient sign-up: two form steps in SelfRegisterScreen, then email verification. */
export const SIGNUP_STEPS = 3

/** Progress through a multi-step flow: filled segments plus "Step 2 of 4 · Label". */
export function StepBar({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div>
      <div className="flex gap-1 @2xl:gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step}
        aria-label={`Step ${step} of ${total}: ${label}`}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-1 @2xl:h-1.5 flex-1 rounded-full transition-colors duration-300 ${i < step ? 'bg-teal-700' : 'bg-gray-200'}`} />
        ))}
      </div>
      <p className="mt-1.5 @2xl:mt-2 text-[9px] @2xl:text-[11px] font-semibold text-gray-400">
        Step <span className="font-mono">{step}</span> of <span className="font-mono">{total}</span> · <span className="text-teal-700">{label}</span>
      </p>
    </div>
  )
}

/* ─── Inputs and buttons ────────────────────────────────────────────── */

export const authInputCls = 'w-full bg-gray-50 border-2 border-gray-200 rounded-xl @2xl:rounded-2xl px-3 @2xl:px-4 py-2 @2xl:py-3 text-xs @2xl:text-sm outline-none focus:border-teal-500 focus:bg-white transition-colors'

export function AuthField({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[9px] @2xl:text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs @2xl:text-[11px] text-teal-700 font-semibold mt-1">{hint}</span>}
    </label>
  )
}

export function PasswordInput({ value, onChange, placeholder, invalid = false, autoComplete }: {
  value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean; autoComplete?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative block">
      <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete}
        className={`${authInputCls} pr-14 ${invalid ? 'border-red-300 focus:border-red-400' : ''}`} />
      <button type="button" onClick={() => setShow(v => !v)}
        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-semibold">
        {show ? 'Hide' : 'Show'}
      </button>
    </span>
  )
}

export function AuthButton({ children, onClick, type = 'button', disabled = false, variant = 'primary' }: {
  children: React.ReactNode; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean; variant?: 'primary' | 'secondary'
}) {
  const look = variant === 'secondary'
    ? 'bg-white border-2 border-gray-200 text-gray-800 hover:border-teal-300 active:scale-[.98]'
    : disabled
      ? 'bg-gray-200 text-gray-400'
      : 'bg-teal-700 text-white shadow-md @2xl:shadow-lg shadow-teal-700/25 hover:bg-teal-800 active:scale-[.98]'
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`w-full py-2.5 @2xl:py-3 @2xl:py-3.5 rounded-xl @2xl:rounded-2xl text-xs @2xl:text-sm font-bold transition-all ${look}`}>
      {children}
    </button>
  )
}

/** Strength bar plus what the password still needs. The rules live in `@/shared/state/auth`. */
export function PasswordMeter({ value }: { value: string }) {
  if (!value) return null
  const { score, label, color, missing } = passwordStrength(value)
  const needed = missing.filter(m => !m.includes('optional'))
  return (
    <div className="-mt-0.5 @2xl:-mt-1" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {[1, 2, 3, 4].map(i => (
            <span key={i} className={`h-0.5 @2xl:h-1 flex-1 rounded-full transition-colors ${i <= Math.max(score, 1) ? color : 'bg-gray-200'}`} />
          ))}
        </div>
        <span className="text-xs @2xl:text-[11px] font-semibold text-gray-500">{label}</span>
      </div>
      {needed.length > 0 && (
        <p className="mt-0.5 @2xl:mt-1 text-[9px] @2xl:text-[11px] text-gray-400">Still needs: {needed.join(' · ')}</p>
      )}
    </div>
  )
}

/** "Or continue with" rule between the form and the other ways in. */
export function AuthDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 @2xl:gap-3 text-[9px] @2xl:text-[11px] font-medium text-gray-400">
      <span className="h-px flex-1 bg-gray-200" />
      {children}
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  )
}

/** "Encrypted in transit" is only claimed when this page really was served over HTTPS. */
const SECURE = typeof window !== 'undefined' && window.location.protocol === 'https:'

const TRUST: { icon: AuthIconName; label: string }[] = [
  ...(SECURE ? [{ icon: 'lock' as const, label: 'Encrypted in transit' }] : []),
  { icon: 'history', label: 'Full audit trail' },
  { icon: 'users', label: 'Role-scoped access' },
]

export function TrustBadges({ className = '' }: { className?: string }) {
  return (
    <ul className={`flex flex-wrap ${className}`}>
      {TRUST.map(t => (
        <li key={t.label} className="flex items-center gap-1">
          <AuthIcon name={t.icon} className="w-3.5 h-3.5 text-teal-700" />
          {t.label}
        </li>
      ))}
    </ul>
  )
}

/* ─── One-time code ─────────────────────────────────────────────────── */

const OTP_LEN = 6

/**
 * Six-box code entry. One real input sits invisibly over the boxes, so
 * typing, backspace, paste and the keyboard's "code from Messages" autofill
 * all behave natively; the boxes only draw the digits.
 */
export function OtpInput({ value, onChange, invalid = false }: { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const [focused, setFocused] = useState(false)
  const active = Math.min(value.length, OTP_LEN - 1)
  return (
    <div className={`relative ${invalid ? 'auth-shake' : ''}`}>
      <div className="grid grid-cols-6 gap-1.5 @2xl:gap-2" aria-hidden="true">
        {Array.from({ length: OTP_LEN }, (_, i) => {
          const here = focused && i === active
          const look = invalid ? 'border-red-300 bg-red-50 text-red-600'
            : here ? 'border-teal-600 bg-white ring-4 ring-teal-100 text-gray-900'
            : value[i] ? 'border-teal-300 bg-teal-50 text-gray-900'
            : 'border-gray-200 bg-gray-50'
          return (
            <div key={i} className={`h-12 @2xl:h-14 rounded-xl @2xl:rounded-2xl border-2 flex items-center justify-center text-xl @2xl:text-2xl font-bold font-mono transition-all ${look}`}>
              {value[i] ?? (here && <span className="w-0.5 h-5 @2xl:h-6 rounded-full bg-teal-600 motion-safe:animate-pulse" />)}
            </div>
          )
        })}
      </div>
      <input
        aria-label="6-digit verification code" aria-invalid={invalid}
        type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" autoFocus
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, OTP_LEN))}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-text"
      />
    </div>
  )
}

/** Animated tick shown when a step succeeds. */
export function SuccessCheck() {
  return (
    <span className="auth-pop mx-auto flex w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 items-center justify-center">
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path className="auth-check" d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  )
}

/** Form controls shared by the signed-out screens: sign in, create account and verification. */
import { useEffect, useRef, useState } from 'react'
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
  user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  history: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 6v6l4 2'],
  help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
  phone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z', 'M12 18h.01'],
  calendar: ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
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

/** How close (px) the pointer has to be before an icon leans in to it. */
const MAGNET_REACH = 130
/** How much of the gap to the pointer a nearby icon closes. */
const MAGNET_PULL = 0.3
/** How much a nearby icon grows. */
const MAGNET_GROW = 0.4
/** After a tap, how long the icons hold their lean before settling back. */
const TOUCH_SETTLE_MS = 600

/**
 * The logo (`children`) with the feature icons floating around it, straight on
 * the page: no card or bubble behind any of them. While `open` is false the
 * icons stay tucked away; they spring out one by one once it turns true,
 * `openDelayMs` later (time for the logo to arrive).
 *
 * The icons follow the pointer: all of them drift a little with it (each at
 * its own depth), and the ones it comes close to lean in and grow. `active`
 * is the icon of the feature on stage, which moves the way the real thing does.
 */
export function BrandCluster({ children, className = '', open = true, openDelayMs = 0, active, compact = false }: {
  children?: React.ReactNode; className?: string; open?: boolean; openDelayMs?: number; active?: AuthIconName
  /** Form steps: a smaller cluster, so the fields below get the room. */
  compact?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const magnets = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    const root = rootRef.current
    if (!root || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let point: { x: number; y: number } | null = null
    let frame = 0
    let settle: ReturnType<typeof setTimeout> | undefined

    const paint = () => {
      frame = 0
      const box = root.getBoundingClientRect()
      const at = point
      magnets.current.forEach((el, i) => {
        // Measure the slot, not the icon: the slot doesn't move with the lean.
        const slot = el?.parentElement
        if (!el || !slot) return
        // box.width is 0 while this size's layout is hidden.
        if (!at || !box.width) { el.style.transform = ''; return }
        const r = slot.getBoundingClientRect()
        const dx = at.x - (r.left + r.width / 2), dy = at.y - (r.top + r.height / 2)
        const near = Math.max(0, 1 - Math.hypot(dx, dy) / MAGNET_REACH)
        const depth = 3 + (i % 3) * 2
        const driftX = Math.max(-1, Math.min(1, (at.x - (box.left + box.width / 2)) / box.width)) * depth
        const driftY = Math.max(-1, Math.min(1, (at.y - (box.top + box.height / 2)) / box.height)) * depth
        const x = driftX + dx * near * MAGNET_PULL, y = driftY + dy * near * MAGNET_PULL
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1 + near * MAGNET_GROW).toFixed(3)})`
      })
    }
    const schedule = () => { frame ||= requestAnimationFrame(paint) }
    const follow = (e: PointerEvent) => { clearTimeout(settle); point = { x: e.clientX, y: e.clientY }; schedule() }
    const rest = () => { clearTimeout(settle); point = null; schedule() }
    // A finger has no hover: hold the lean briefly after it lifts, so a tap is seen.
    const lift = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      clearTimeout(settle)
      settle = setTimeout(rest, TOUCH_SETTLE_MS)
    }

    window.addEventListener('pointermove', follow, { passive: true })
    window.addEventListener('pointerdown', follow, { passive: true })
    window.addEventListener('pointerup', lift)
    window.addEventListener('pointercancel', lift)
    window.addEventListener('blur', rest)
    document.documentElement.addEventListener('pointerleave', rest)
    return () => {
      window.removeEventListener('pointermove', follow)
      window.removeEventListener('pointerdown', follow)
      window.removeEventListener('pointerup', lift)
      window.removeEventListener('pointercancel', lift)
      window.removeEventListener('blur', rest)
      document.documentElement.removeEventListener('pointerleave', rest)
      cancelAnimationFrame(frame)
      clearTimeout(settle)
    }
  }, [])

  return (
    <div ref={rootRef} className={`relative mx-auto flex items-end justify-center ${compact ? 'w-48 h-20' : 'w-64 h-28'} ${className}`}>
      {CLUSTER.map((c, i) => {
        const on = open && c.icon === active
        return (
          <span key={c.icon} aria-hidden style={{ transitionDelay: open ? `${openDelayMs + i * 70}ms` : '0ms' }}
            className={`absolute text-teal-700 transition-all motion-reduce:transition-none ${c.pos} ${open
              ? 'duration-500 ease-[cubic-bezier(.3,1.5,.5,1)]'
              : `duration-200 ease-in opacity-0 scale-50 ${c.tucked}`}`}>
            <span ref={el => { magnets.current[i] = el }} className="flex transition-transform duration-300 ease-out will-change-transform">
              <span className={`auth-float flex transition-[scale,color] duration-300 ${on ? 'scale-125 text-teal-600' : ''}`} style={{ animationDelay: c.delay }}>
                <span className={`flex ${on ? `auth-icon-${c.icon}` : ''}`}><AuthIcon name={c.icon} className={compact ? 'w-[18px] h-[18px]' : 'w-6 h-6'} /></span>
              </span>
            </span>
          </span>
        )
      })}
      {children}
    </div>
  )
}

/* ─── Headings and navigation ───────────────────────────────────────── */

export function AuthBack({ onClick, children = 'Back' }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="group self-start flex items-center gap-1 rounded-full bg-teal-50 py-1 pl-1.5 pr-3 text-xs font-semibold text-teal-700 transition-colors hover:bg-teal-100 active:scale-[.97]">
      <AuthIcon name="back" className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
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

/** Patient sign-up: the one-screen form in SelfRegisterScreen, then email verification. */
export const SIGNUP_STEPS = 2

/** Progress through a multi-step flow: filled segments plus "Step 2 of 4 · Label". */
export function StepBar({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div>
      <div className="flex gap-1 @2xl:gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step}
        aria-label={`Step ${step} of ${total}: ${label}`}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="h-1 @2xl:h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
            {/* The bar of the step just reached fills from the left. */}
            <span className={`block h-full origin-left rounded-full bg-teal-700 transition-transform duration-500 ease-out motion-reduce:transition-none ${i < step ? 'scale-x-100' : 'scale-x-0'}`} />
          </span>
        ))}
      </div>
      <p className="mt-1.5 @2xl:mt-2 text-[9px] @2xl:text-[11px] font-semibold text-gray-400">
        Step <span className="font-mono">{step}</span> of <span className="font-mono">{total}</span> · <span className="text-teal-700">{label}</span>
      </p>
    </div>
  )
}

/* ─── Inputs and buttons ────────────────────────────────────────────── */

export const authInputCls = 'w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 h-11 text-sm outline-none transition-all duration-200 placeholder:text-gray-400 hover:border-gray-300 focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-500/15'

/**
 * An input with a leading icon that turns teal while the field is in use.
 * Give the input inside `pl-10` so its text clears the icon.
 */
export function IconInput({ icon, children }: { icon: AuthIconName; children: React.ReactNode }) {
  return (
    <span className="group relative block">
      {children}
      <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-teal-700">
        <AuthIcon name={icon} className="w-4 h-4" />
      </span>
    </span>
  )
}

export function AuthField({ label, hint, error, children }: {
  label: string; hint?: React.ReactNode; error?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-[9px] @2xl:text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs @2xl:text-[11px] text-teal-700 font-semibold mt-1">{hint}</span>}
      {error && <span role="alert" className="block text-xs @2xl:text-[11px] text-red-500 font-semibold mt-1">{error}</span>}
    </label>
  )
}

export function PasswordInput({ value, onChange, placeholder, invalid = false, autoComplete }: {
  value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean; autoComplete?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <IconInput icon="lock">
      <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete}
        className={`${authInputCls} pl-10 pr-14 ${invalid ? 'border-red-300 focus:border-red-400' : ''}`} />
      <button type="button" onClick={() => setShow(v => !v)}
        className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400 transition-colors hover:text-teal-700">
        {show ? 'Hide' : 'Show'}
      </button>
    </IconInput>
  )
}

/**
 * The main action of a step. Once it can be pressed it looks like Get Started
 * on the welcome page: a pill with a glow breathing under it, a sheen crossing
 * it and the arrow in a frosted tile. Until then it is a quiet grey pill.
 */
export function AuthButton({ children, onClick, type = 'button', disabled = false, variant = 'primary' }: {
  children: React.ReactNode; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean; variant?: 'primary' | 'secondary'
}) {
  if (variant === 'secondary') {
    return (
      <button type={type} onClick={onClick} disabled={disabled}
        className="w-full rounded-full border border-gray-200 bg-white h-11 text-sm font-bold text-gray-800 transition-all hover:border-teal-300 active:scale-[.98]">
        {children}
      </button>
    )
  }
  return (
    <div className="relative w-full">
      {!disabled && <span aria-hidden className="auth-glow absolute inset-x-10 -bottom-1.5 h-8 rounded-full bg-teal-500/60 blur-xl" />}
      <button type={type} onClick={onClick} disabled={disabled}
        className={`group relative w-full overflow-hidden rounded-full py-1.5 pl-5 pr-1.5 flex items-center text-sm font-bold transition-all duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/40 ${disabled
          ? 'bg-gray-100 text-gray-400'
          : 'bg-teal-700 text-white ring-1 ring-inset ring-white/20 shadow-lg shadow-teal-700/30 hover:-translate-y-0.5 hover:bg-teal-800 hover:shadow-xl active:translate-y-0 active:scale-[.98]'}`}>
        {!disabled && <>
          <span aria-hidden className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent" />
          <span aria-hidden className="auth-sheen absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        </>}
        {/* pl-8 balances the arrow tile, so the label stays centred. The tile plus padding is as tall as an input. */}
        <span className="relative flex-1 pl-8 text-center">{children}</span>
        <span className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${disabled
          ? 'bg-gray-200/70' : 'bg-white/15 ring-1 ring-inset ring-white/25 backdrop-blur-sm group-hover:bg-white/25'}`}>
          <span className={`flex ${disabled ? '' : 'auth-nudge'}`}><AuthIcon name="arrow" className="w-4 h-4" /></span>
        </span>
      </button>
    </div>
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

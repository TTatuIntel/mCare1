/** Form controls shared by the signed-out screens: sign in, create account and verification. */
import { useEffect, useRef, useState } from 'react'
import { PHONE_COUNTRIES, passwordStrength, type PhoneCountry } from '@/shared/state/auth'
import { reducedMotion } from '@/shared/layout/motion'

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
    if (!root || reducedMotion()) return
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
    <div ref={rootRef} className={`relative mx-auto flex items-end justify-center ${compact ? 'w-56 h-[5.5rem]' : 'w-72 h-[7.5rem]'} ${className}`}>
      {CLUSTER.map((c, i) => {
        const on = open && c.icon === active
        return (
          <span key={c.icon} aria-hidden style={{ transitionDelay: open ? `${openDelayMs + i * 70}ms` : '0ms' }}
            className={`absolute text-teal-700 transition-all motion-reduce:transition-none ${c.pos} ${open
              ? 'duration-500 ease-[cubic-bezier(.3,1.5,.5,1)]'
              : `duration-200 ease-in opacity-0 scale-50 ${c.tucked}`}`}>
            <span ref={el => { magnets.current[i] = el }} className="flex transition-transform duration-300 ease-out will-change-transform">
              <span className={`auth-float flex transition-[scale,color] duration-300 ${on ? 'scale-125 text-teal-600' : ''}`} style={{ animationDelay: c.delay }}>
                <span className={`flex ${on ? `auth-icon-${c.icon}` : ''}`}><AuthIcon name={c.icon} className={compact ? 'w-4.5 h-4.5' : 'w-6 h-6'} /></span>
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
      {/* The same sizes as the welcome page's "Let's get you started". */}
      <h2 className="text-xl font-black text-gray-900 font-display leading-tight">{title}</h2>
      {subtitle && <p className="text-[13px] text-gray-600 mt-1.5 leading-relaxed">{subtitle}</p>}
    </div>
  )
}

/**
 * "Already have an account? Sign in": the line that swaps between the ways in,
 * the same on the welcome, sign-in and sign-up pages. The words carry the brand
 * shimmer; on hover the underline redraws and an arrow slides out.
 */
export function AuthSwitch({ prompt, action, onClick, className = '' }: {
  prompt: string; action: string; onClick: () => void; className?: string
}) {
  return (
    <p className={`text-center text-[13px] text-gray-600 ${className}`}>
      {prompt}{' '}
      <button type="button" onClick={onClick}
        className="group relative inline-flex items-center pb-0.5 font-bold transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 rounded">
        <span className="auth-shimmer">{action}</span>
        <span className="flex w-0 overflow-hidden text-teal-700 opacity-0 transition-all duration-300 group-hover:ml-1 group-hover:w-3.5 group-hover:opacity-100 group-focus-visible:ml-1 group-focus-visible:w-3.5 group-focus-visible:opacity-100">
          <AuthIcon name="arrow" className="w-3.5 h-3.5 shrink-0" />
        </span>
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[1.5px] origin-left rounded-full bg-teal-700 group-hover:animate-[auth-underline_.45s_ease-out] motion-reduce:animate-none" />
      </button>
    </p>
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

/**
 * A phone number in one field: the country code on the left (tap to change
 * it), the rest of the number beside it. The real `<select>` lies invisibly
 * over the code, so the device's own picker opens; the field shows only the
 * flag and code.
 */
export function PhoneInput({ country, onCountry, value, onChange, onBlur, invalid = false }: {
  country: PhoneCountry; onCountry: (c: PhoneCountry) => void
  value: string; onChange: (v: string) => void; onBlur?: () => void; invalid?: boolean
}) {
  return (
    <span className={`flex items-center w-full h-11 rounded-2xl border bg-gray-50 text-sm transition-all duration-200 hover:border-gray-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-teal-500/15 ${invalid ? 'border-red-300 focus-within:border-red-400' : 'border-gray-200 focus-within:border-teal-600'}`}>
      <span className="relative flex h-full shrink-0 items-center gap-1.5 pl-3.5 pr-2.5 border-r border-gray-200 text-gray-800">
        <span aria-hidden>{country.flag}</span>
        <span className="font-mono font-semibold">{country.dial}</span>
        <svg className="w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
        <select aria-label="Country code" value={country.iso} autoComplete="tel-country-code"
          onChange={e => onCountry(PHONE_COUNTRIES.find(c => c.iso === e.target.value) ?? country)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
          {PHONE_COUNTRIES.map(c => <option key={c.iso} value={c.iso}>{c.flag} {c.name} ({c.dial})</option>)}
        </select>
      </span>
      <input type="tel" inputMode="tel" autoComplete="tel-national" aria-label="Phone number" aria-invalid={invalid} required
        value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}
        placeholder="712 345 678"
        className="flex-1 min-w-0 h-full bg-transparent px-3 font-mono outline-none placeholder:font-sans placeholder:text-gray-400" />
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
 * on the welcome page: a compact, centred pill with a glow breathing under it, a sheen crossing
 * it and the arrow in a frosted tile. Until then it is a quiet grey pill.
 */
export function AuthButton({ children, onClick, type = 'button', disabled = false, variant = 'primary' }: {
  children: React.ReactNode; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean; variant?: 'primary' | 'secondary'
}) {
  if (variant === 'secondary') {
    return (
      <button type={type} onClick={onClick} disabled={disabled}
        className="mx-auto block w-fit min-w-40 max-w-full rounded-full border border-gray-200 bg-white h-11 px-6 text-sm font-bold text-gray-800 transition-all hover:border-teal-300 active:scale-[.98]">
        {children}
      </button>
    )
  }
  return (
    <div className="relative mx-auto w-fit min-w-40 max-w-full">
      {!disabled && <span aria-hidden className="auth-glow absolute inset-x-6 -bottom-1.5 h-8 rounded-full bg-teal-500/60 blur-xl" />}
      <button type={type} onClick={onClick} disabled={disabled}
        className={`group relative w-full overflow-hidden rounded-full py-1.5 pl-6 pr-1.5 flex items-center gap-4 text-[15px] font-bold transition-all duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/40 ${disabled
          ? 'bg-gray-100 text-gray-400'
          : 'bg-teal-700 text-white ring-1 ring-inset ring-white/20 shadow-lg shadow-teal-700/30 hover:-translate-y-0.5 hover:bg-teal-800 hover:shadow-xl active:translate-y-0 active:scale-[.98]'}`}>
        {!disabled && <>
          <span aria-hidden className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent" />
          <span aria-hidden className="auth-sheen absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        </>}
        {/* The pill hugs its label and arrow (short labels keep a minimum width). Label and tile are the size of Get Started's. */}
        <span className="relative flex-1 text-center whitespace-nowrap">{children}</span>
        <span className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${disabled
          ? 'bg-gray-200/70' : 'bg-white/15 ring-1 ring-inset ring-white/25 backdrop-blur-sm group-hover:bg-white/25'}`}>
          <span className={`flex ${disabled ? '' : 'auth-nudge'}`}><AuthIcon name="arrow" className="w-4 h-4" /></span>
        </span>
      </button>
    </div>
  )
}

/**
 * The quiet way past an optional step ("Skip for now"), under the main button.
 * Its arrow keeps nudging forward; under a pointer the link fills in and turns teal.
 */
export function AuthSkip({ onClick, children = 'Skip for now' }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="group mx-auto flex w-fit items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-semibold text-gray-500 transition-all duration-200 hover:bg-teal-50 hover:text-teal-700 active:scale-95 active:bg-teal-50 active:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60">
      {children}
      <span className="auth-nudge flex transition-transform duration-200 group-hover:translate-x-0.5">
        <AuthIcon name="arrow" className="w-3.5 h-3.5" />
      </span>
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

export const OWNER = 'mcare.com'

/** The copyright line at the foot of every signed-out page. */
export function AuthRights({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-[9px] @2xl:text-[10px] text-gray-400 whitespace-nowrap ${className}`}>
      © <span className="font-mono">{new Date().getFullYear()}</span> {OWNER} · All rights reserved
    </p>
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
              {value[i] ?? (here && <span className="w-0.5 h-5 @2xl:h-6 rounded-full bg-teal-600 animate-pulse" />)}
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

/**
 * Authentication helpers shared by the login, registration and
 * password-recovery surfaces. Pure functions only — no React, no context.
 */
import type { AuthProvider } from '@/shared/lib/types'

/* ─── Password policy ───────────────────────────────────────────────── */

export const MIN_PASSWORD_LEN = 5

/** Rejected outright — these are the passwords attackers try first. */
const COMMON_PASSWORDS = [
  'password', 'password1', '12345678', '123456789', 'qwerty123',
  'letmein', 'welcome1', 'admin123', 'mcare123', 'iloveyou',
]

export interface PasswordStrength {
  /** 0–4. 0–1 weak, 2 fair, 3 good, 4 strong. */
  score: number
  label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong'
  /** Tailwind colour token for the meter. */
  color: string
  /** Checks the password has not yet satisfied. */
  missing: string[]
}

/**
 * Returns the reason a password is unacceptable, or `null` when it passes.
 * This is the single source of truth — the UI and the context both call it.
 */
export function passwordIssue(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LEN) return `Password must be at least ${MIN_PASSWORD_LEN} characters.`
  if (COMMON_PASSWORDS.includes(pw.toLowerCase())) return 'That password is too common. Choose something less guessable.'
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) return 'Use both uppercase and lowercase letters.'
  if (!/\d/.test(pw)) return 'Include at least one number.'
  return null
}

/** Scores a password for the strength meter. Never throws on empty input. */
export function passwordStrength(pw: string): PasswordStrength {
  const missing: string[] = []
  if (pw.length < MIN_PASSWORD_LEN) missing.push(`${MIN_PASSWORD_LEN}+ characters`)
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) missing.push('Upper & lowercase')
  if (!/\d/.test(pw)) missing.push('A number')
  if (!/[^A-Za-z0-9]/.test(pw)) missing.push('A symbol (optional)')

  if (!pw) return { score: 0, label: 'Too short', color: 'bg-gray-200', missing }
  if (pw.length < MIN_PASSWORD_LEN) return { score: 0, label: 'Too short', color: 'bg-red-400', missing }
  if (COMMON_PASSWORDS.includes(pw.toLowerCase())) return { score: 1, label: 'Weak', color: 'bg-red-400', missing }

  // One point per satisfied class, plus a bonus for genuine length.
  let score = 0
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (pw.length >= 12) score++

  const meta = [
    { label: 'Weak',   color: 'bg-red-400'    },
    { label: 'Weak',   color: 'bg-red-400'    },
    { label: 'Fair',   color: 'bg-amber-400'  },
    { label: 'Good',   color: 'bg-lime-500'   },
    { label: 'Strong', color: 'bg-emerald-500' },
  ] as const
  const m = meta[Math.min(score, 4)]
  return { score, label: m.label, color: m.color, missing }
}

/* ─── Social providers ──────────────────────────────────────────────── */

export interface ProviderStyle {
  id: Exclude<AuthProvider, 'email'>
  label: string
  /** Inline SVG mark, sized by the caller. */
  mark: string
  /** Draw the mark as an outline instead of a filled shape. */
  outline?: boolean
  /** One colour per path of the mark, for a multi-colour logo. Without it the mark takes `text`. */
  colors?: string[]
  bg: string
  border: string
  text: string
  /** Brand-coloured glow under the button while it is hovered or focused. */
  glow: string
}

/**
 * Presentation for each social button, in each platform's own colours: the
 * button reads as that platform's logo at a glance.
 */
export const SOCIAL_PROVIDERS: ProviderStyle[] = [
  {
    id: 'google',
    label: 'Google',
    mark: 'M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.5 5.5 0 01-2.39 3.62v3h3.86c2.26-2.08 3.58-5.15 3.58-8.65z|M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.86-3c-1.08.72-2.45 1.16-4.08 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0012 24z|M5.27 14.29a7.2 7.2 0 010-4.58V6.62H1.29a12 12 0 000 10.76l3.98-3.09z|M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 001.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z',
    // Blue, green, yellow, red: the four parts of the Google "G".
    colors: ['#4285F4', '#34A853', '#FBBC05', '#EA4335'],
    bg: 'bg-white',
    border: 'border-gray-200',
    text: 'text-gray-700',
    glow: 'hover:shadow-[#4285F4]/35 focus-visible:shadow-[#4285F4]/35',
  },
  {
    id: 'apple',
    label: 'Apple',
    mark: 'M17.05 12.53c-.03-2.75 2.25-4.07 2.35-4.13-1.28-1.87-3.27-2.13-3.98-2.16-1.7-.17-3.31 1-4.17 1-.86 0-2.18-.98-3.58-.95-1.84.03-3.54 1.07-4.49 2.72-1.91 3.32-.49 8.23 1.38 10.92.91 1.32 2 2.8 3.42 2.75 1.37-.06 1.89-.89 3.55-.89 1.65 0 2.12.89 3.57.86 1.47-.03 2.4-1.34 3.3-2.67 1.04-1.53 1.47-3.01 1.5-3.09-.03-.01-2.88-1.11-2.91-4.4z|M14.7 4.2c.76-.92 1.27-2.2 1.13-3.47-1.09.04-2.41.72-3.19 1.64-.7.81-1.31 2.11-1.15 3.36 1.21.09 2.45-.62 3.21-1.53z',
    bg: 'bg-black',
    border: 'border-black',
    text: 'text-white',
    glow: 'hover:shadow-black/40 focus-visible:shadow-black/40',
  },
  {
    id: 'facebook',
    label: 'Facebook',
    mark: 'M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z',
    bg: 'bg-[#0866FF]',
    border: 'border-[#0866FF]',
    text: 'text-white',
    glow: 'hover:shadow-[#0866FF]/45 focus-visible:shadow-[#0866FF]/45',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    mark: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z|M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37Z|M17.5 6.5h.01',
    outline: true,
    // Instagram's gradient is radial, so it lives in index.css.
    bg: 'social-instagram',
    border: 'border-transparent',
    text: 'text-white',
    glow: 'hover:shadow-[#d6249f]/45 focus-visible:shadow-[#d6249f]/45',
  },
  {
    id: 'x',
    label: 'X',
    mark: 'M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z',
    bg: 'bg-black',
    border: 'border-black',
    text: 'text-white',
    glow: 'hover:shadow-black/40 focus-visible:shadow-black/40',
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    mark: 'M2 5h4.2l3.3 5.6L12.8 5H17l-5.6 9.2V19H7.6v-4.8z|M18.4 5h3.4l-.7 8h-2z|M20 14.8a1.7 1.7 0 100 3.4 1.7 1.7 0 000-3.4z',
    bg: 'bg-[#6001D2]',
    border: 'border-[#6001D2]',
    text: 'text-white',
    glow: 'hover:shadow-[#6001D2]/45 focus-visible:shadow-[#6001D2]/45',
  },
]

/* ─── Identifier helpers ────────────────────────────────────────────── */

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/** Accepts +254712345678, 0712 345 678, etc. */
export const isPhone = (v: string) => /^\+?\d[\d\s-]{6,}$/.test(v.trim())

/**
 * The countries a phone number can be registered from: the East African
 * Community, for now. `min`/`max` is how many digits the number has after the
 * country code. The first one is the default.
 */
export const PHONE_COUNTRIES = [
  { iso: 'KE', name: 'Kenya', dial: '+254', flag: '🇰🇪', min: 9, max: 9 },
  { iso: 'UG', name: 'Uganda', dial: '+256', flag: '🇺🇬', min: 9, max: 9 },
  { iso: 'TZ', name: 'Tanzania', dial: '+255', flag: '🇹🇿', min: 9, max: 9 },
  { iso: 'RW', name: 'Rwanda', dial: '+250', flag: '🇷🇼', min: 9, max: 9 },
  { iso: 'BI', name: 'Burundi', dial: '+257', flag: '🇧🇮', min: 8, max: 8 },
  { iso: 'SS', name: 'South Sudan', dial: '+211', flag: '🇸🇸', min: 9, max: 9 },
  { iso: 'CD', name: 'DR Congo', dial: '+243', flag: '🇨🇩', min: 9, max: 9 },
  { iso: 'SO', name: 'Somalia', dial: '+252', flag: '🇸🇴', min: 7, max: 9 },
] as const
export type PhoneCountry = typeof PHONE_COUNTRIES[number]

/**
 * The full number for what was typed beside a country code, e.g. "0712 345 678"
 * with Kenya → "+254 712 345 678". Null when it is not a number of that country.
 * A leading 0, or the country code typed again, is dropped.
 */
export function fullPhone(country: PhoneCountry, typed: string): string | null {
  let n = typed.replace(/\D/g, '')
  const code = country.dial.slice(1)
  if (n.startsWith(code) && n.length > country.max) n = n.slice(code.length)
  n = n.replace(/^0+/, '')
  if (n.length < country.min || n.length > country.max) return null
  return `${country.dial} ${n.replace(/(\d{3})(?=\d)/g, '$1 ')}`
}

/** Formats remaining milliseconds as m:ss for the OTP countdown. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

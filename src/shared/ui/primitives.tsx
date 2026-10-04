/** Small presentational building blocks shared by every portal. */
import type { AvatarSpec } from '@/shared/lib/types'

/* ─── Avatar ────────────────────────────────────────────────────────── */
export const AVATAR_GRADIENTS: Record<string, string> = {
  teal:   'linear-gradient(135deg,#064f4f 0%,#0a6e6e 60%,#00c9a7 100%)',
  blue:   'linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 60%,#3b82f6 100%)',
  purple: 'linear-gradient(135deg,#4c1d95 0%,#6d28d9 60%,#8b5cf6 100%)',
  rose:   'linear-gradient(135deg,#881337 0%,#be123c 60%,#fb7185 100%)',
  amber:  'linear-gradient(135deg,#78350f 0%,#b45309 60%,#f59e0b 100%)',
  slate:  'linear-gradient(135deg,#0f172a 0%,#334155 60%,#64748b 100%)',
}
export const AVATAR_EMOJIS = ['🙂', '😊', '😎', '🧑‍⚕️', '👩‍⚕️', '👨‍⚕️', '🦸', '🦸‍♀️', '🐱', '🐶', '🦁', '🐼', '🌟', '🍀', '🔥', '🌊']

const AVATAR_SIZES = {
  xs: 'w-8 h-8 text-[10px]',
  sm: 'w-11 h-11 text-sm',
  md: 'w-16 h-16 text-xl',
  lg: 'w-20 h-20 text-2xl',
}
/** "Dr. Amina Wanjiru" → "AW": titles are skipped so doctors read the same as everyone else. */
export const initialsOf = (name: string) =>
  name.split(' ').filter(n => n && !/^(dr|prof|mr|mrs|ms)\.?$/i.test(n)).map(n => n[0]).join('').slice(0, 2).toUpperCase()

/** The one avatar used everywhere: photo, emoji or initials on the user's chosen gradient (teal by default). */
export function Avatar({ name, avatar, size = 'md' }: { name: string; avatar?: AvatarSpec; size?: keyof typeof AVATAR_SIZES }) {
  const initials = initialsOf(name)
  const sz = AVATAR_SIZES[size]
  const gradient = AVATAR_GRADIENTS[avatar?.gradient ?? 'teal'] ?? AVATAR_GRADIENTS.teal
  if (avatar?.photo) {
    return (
      <img src={avatar.photo} alt={name}
        className={`${sz} rounded-full object-cover flex-shrink-0 shadow-md`} />
    )
  }
  return (
    <div className={`${sz} rounded-full flex items-center justify-center text-white font-black flex-shrink-0 shadow-md`}
      style={{ background: gradient }}>
      {avatar?.emoji ? <span>{avatar.emoji}</span> : initials}
    </div>
  )
}

/* ─── Pill ──────────────────────────────────────────────────────────── */
const PILL_COLORS: Record<string, string> = {
  teal:   'bg-teal-50 text-teal-700',
  green:  'bg-emerald-50 text-emerald-700',
  amber:  'bg-amber-50 text-amber-700',
  red:    'bg-red-50 text-red-600',
  blue:   'bg-blue-50 text-blue-700',
  purple: 'bg-purple-50 text-purple-700',
  gray:   'bg-gray-100 text-gray-500',
}

export function Pill({ children, color = 'teal' }: { children: React.ReactNode; color?: string }) {
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full tracking-wide ${PILL_COLORS[color] ?? PILL_COLORS.teal}`}>
      {children}
    </span>
  )
}

/* ─── Toggle ────────────────────────────────────────────────────────── */
export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${on ? 'bg-teal-600' : 'bg-gray-200'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${on ? 'left-5' : 'left-0.5'}`} />
    </button>
  )
}

/* ─── SectionHead ───────────────────────────────────────────────────── */
export function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-bold text-gray-700">{title}</h2>
      {action && <button onClick={onAction} className="text-xs text-teal-700 font-semibold">{action}</button>}
    </div>
  )
}

/* ─── Chevron ───────────────────────────────────────────────────────── */
export function Chevron() {
  return (
    <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
    </svg>
  )
}

/* ─── InfoRow ───────────────────────────────────────────────────────── */
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-gray-50 last:border-0 gap-4">
      <p className="text-xs text-gray-400 flex-shrink-0">{label}</p>
      <p className="text-xs font-semibold text-gray-800 text-right break-all">{value || '—'}</p>
    </div>
  )
}

/* ─── PageTitle ─────────────────────────────────────────────────────── */
export function PageTitle({ title, action, onAction, meta }: {
  title: string; action?: string; onAction?: () => void
  /** Small grey note on the right, e.g. "3 pending" (shown when there's no action). */
  meta?: string
}) {
  return (
    <div className="flex items-center justify-between pt-1 mb-1">
      <h1 className="text-xl font-bold text-gray-900 font-display">{title}</h1>
      {action ? (
        <button onClick={onAction} className="text-xs font-semibold text-teal-700 border border-teal-200 px-3 py-1.5 rounded-full">
          {action}
        </button>
      ) : meta && <span className="text-xs text-gray-400">{meta}</span>}
    </div>
  )
}

/* ─── AddButton ─────────────────────────────────────────────────────── */
export function AddButton({ onClick, color = 'bg-teal-700', label = 'Add' }: { onClick: () => void; color?: string; /** What a screen reader announces. */ label?: string }) {
  return (
    <button onClick={onClick} aria-label={label} className={`w-8 h-8 ${color} rounded-full flex items-center justify-center text-white text-xl leading-none shadow`}>
      +
    </button>
  )
}

/* ─── Back header ─── */
export function BackHeader({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <button onClick={onBack} aria-label="Back" className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
        <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-base font-bold text-gray-900 leading-none truncate">{title}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5 truncate">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

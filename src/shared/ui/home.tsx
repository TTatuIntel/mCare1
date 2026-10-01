/**
 * Home-screen kit — the patient home is the reference design, and every
 * portal's home is built from these same pieces so they look and behave alike.
 */
import { useApp } from '@/shared/state/AppContext'
import { greeting } from '@/shared/lib/vitals'
import { Avatar } from './primitives'
import { NotificationBell } from './NotificationBell'

export const HERO_GRADIENT = 'linear-gradient(135deg,#064f4f 0%,#0a6e6e 55%,#0d9e82 100%)'

/* ─── PortalHeader: greeting + name, notifications bell, avatar → profile ─── */
export function PortalHeader({ title, eyebrow, onNavigate, onProfile }: {
  /** Defaults to the signed-in user's first name. */
  title?: string
  /** Defaults to a time-of-day greeting. */
  eyebrow?: string
  onNavigate: (tab: string) => void
  onProfile: () => void
}) {
  const { currentUser } = useApp()
  if (!currentUser) return null
  return (
    <div className="flex items-center justify-between pt-1">
      <div className="min-w-0">
        <p className="text-xs text-gray-400">{eyebrow ?? greeting()}</p>
        <h1 className="text-xl font-black text-gray-900 truncate font-display">{title ?? currentUser.name.split(' ')[0]}</h1>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <NotificationBell onNavigate={onNavigate} />
        <button onClick={onProfile} aria-label="Profile">
          <Avatar name={currentUser.name} avatar={currentUser.avatar} size="sm" />
        </button>
      </div>
    </div>
  )
}

/* ─── HeroCard: the gradient headline card at the top of every home ─── */
export function HeroCard({ eyebrow, value, suffix, caption, sideTitle, side = [], aside, progress, children }: {
  eyebrow: string
  value: React.ReactNode
  suffix?: string
  caption?: React.ReactNode
  /** Small heading over the right-hand figures, e.g. "Today". */
  sideTitle?: string
  side?: { value: React.ReactNode; label: string }[]
  /** Custom right-hand content (e.g. the patient "Up next" ticker); replaces `side`. */
  aside?: React.ReactNode
  /** 0–100; draws the thin progress bar under the headline. */
  progress?: number
  /** Rendered below the headline, inside the card (e.g. a vitals strip). */
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-[24px] shadow-lg" style={{ background: HERO_GRADIENT }}>
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-teal-200 uppercase tracking-widest">{eyebrow}</p>
            <div className="flex items-end gap-1.5 mt-1">
              <span className="text-5xl font-black text-white leading-none">{value}</span>
              {suffix && <span className="text-teal-300 text-sm mb-1">{suffix}</span>}
            </div>
            {caption && <p className="text-[10px] text-emerald-300 font-semibold mt-1.5">{caption}</p>}
          </div>
          {aside ?? (side.length > 0 && (
            <div className="text-right flex-shrink-0">
              {sideTitle && <p className="text-[10px] text-teal-300 uppercase tracking-wider">{sideTitle}</p>}
              {side.map((s, i) => (
                <div key={s.label}>
                  <p className={`text-white font-bold text-lg leading-tight ${i === 0 ? 'mt-0.5' : 'mt-1'}`}>{s.value}</p>
                  <p className="text-teal-300 text-[10px]">{s.label}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
        {progress !== undefined && (
          <div className="mt-4 bg-white/15 rounded-full h-[5px]">
            <div className="bg-white rounded-full h-[5px] transition-all" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

/* ─── QuickGrid: 4-up shortcut tiles with optional red badge ─── */
export function QuickGrid({ items }: { items: { icon: string; label: string; onClick: () => void; badge?: number }[] }) {
  return (
    <div className="grid grid-cols-4 gap-2.5">
      {items.map(({ icon, label, onClick, badge }) => (
        <button key={label} onClick={onClick}
          className="relative flex flex-col items-center gap-1 bg-white rounded-2xl py-3 shadow-sm active:scale-95 transition-transform">
          <span className="text-xl">{icon}</span>
          <span className="text-[10px] text-gray-500 font-medium truncate max-w-full px-1">{label}</span>
          {!!badge && badge > 0 && (
            <span className="absolute top-1.5 right-2 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1">
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/* ─── NoticeCard: tinted call-to-action banner (alerts, pending reviews…) ─── */
const NOTICE_TONES = {
  red:   { box: 'bg-red-50 border-red-100',         title: 'text-red-700',     dot: 'bg-red-500',     action: 'text-red-600' },
  amber: { box: 'bg-amber-50 border-amber-100',     title: 'text-amber-800',   dot: 'bg-amber-500',   action: 'text-amber-700' },
  teal:  { box: 'bg-teal-50 border-teal-100',       title: 'text-teal-800',    dot: 'bg-teal-500',    action: 'text-teal-700' },
  green: { box: 'bg-emerald-50 border-emerald-100', title: 'text-emerald-700', dot: 'bg-emerald-500', action: 'text-emerald-700' },
} as const

export function NoticeCard({ tone, title, action, onAction, pulse = true, children }: {
  tone: keyof typeof NOTICE_TONES
  title: React.ReactNode
  action?: string
  onAction?: () => void
  pulse?: boolean
  children?: React.ReactNode
}) {
  const t = NOTICE_TONES[tone]
  return (
    <div className={`rounded-2xl p-3.5 border ${t.box}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.dot} ${pulse ? 'animate-pulse' : ''}`} />
          <p className={`text-xs font-semibold ${t.title}`}>{title}</p>
        </div>
        {action && <button onClick={onAction} className={`text-[11px] font-bold flex-shrink-0 ${t.action}`}>{action}</button>}
      </div>
      {children && <div className="mt-2 flex flex-col gap-1.5">{children}</div>}
    </div>
  )
}

/** White row used inside a NoticeCard. */
export function NoticeRow({ title, sub, right, onClick }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className="w-full bg-white rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-left">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-900 truncate">{title}</p>
        {sub && <div className="text-[10px] text-gray-400 truncate">{sub}</div>}
      </div>
      {right && <div className="flex-shrink-0">{right}</div>}
    </Tag>
  )
}

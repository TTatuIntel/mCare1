import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '@/shared/state/AppContext'
import type { AppNotification } from '@/shared/lib/types'
import { ago, dayKey } from '@/shared/lib/vitals'
import { CloseButton } from './BottomSheet'

/* ─── Notifications bell + sheet ─── */
const NOTIF_ICON: Record<AppNotification['kind'], string> = {
  alert: '⚠️', sos: '🚨', message: '💬', appointment: '📅', assignment: '🩺', prescription: '💊', account: '👤', escalation: '⏫',
  document: '📄', care_plan: '📋', support: '🛟',
}
/** `onNavigate` gets the screen to open and, when the notification says so, the record it is about. */
export function NotificationBell({ onNavigate }: { onNavigate: (tab: string, about?: AppNotification['resource']) => void }) {
  const { currentUser, notifications, markNotificationRead, markAllNotificationsRead, now } = useApp()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const [placement, setPlacement] = useState({ top: 8, left: 8, width: 360, height: 560, mobile: false })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => { setPortalRoot(document.getElementById('sheet-root')) }, [])

  useLayoutEffect(() => {
    if (!open || !portalRoot || !trigger.current) return
    const place = () => {
      if (!trigger.current) return
      const frame = portalRoot.getBoundingClientRect()
      const bell = trigger.current.getBoundingClientRect()
      const mobile = frame.width < 672
      const width = mobile ? Math.max(0, frame.width - 16) : Math.min(384, frame.width - 24)
      const left = mobile ? 8 : Math.min(Math.max(8, bell.right - frame.left - width), frame.width - width - 8)
      const top = Math.min(bell.bottom - frame.top + 8, frame.height - 160)
      setPlacement({ top, left, width, height: Math.max(160, Math.min(600, frame.height - top - 8)), mobile })
    }
    place()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [open, portalRoot])

  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); return }
      if (!placement.mobile || event.key !== 'Tab' || !panel.current) return
      const stops = [...panel.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.hasAttribute('disabled') && element.offsetParent !== null)
      if (stops.length === 0) { event.preventDefault(); return }
      const first = stops[0], last = stops[stops.length - 1], active = document.activeElement
      if (!panel.current.contains(active)) { event.preventDefault(); first.focus() }
      else if (event.shiftKey && (active === first || active === panel.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (before && document.contains(before)) trigger.current?.focus()
    }
  }, [open, placement.mobile])

  if (!currentUser) return null
  const mine = notifications.filter(n => n.userId === currentUser.id)
  const unread = mine.filter(n => !n.read).length
  const visible = filter === 'unread' ? mine.filter(n => !n.read) : mine
  const today = dayKey(new Date(now))
  const groups = [
    { title: 'Today', items: visible.filter(n => dayKey(new Date(n.at)) === today) },
    { title: 'Earlier', items: visible.filter(n => dayKey(new Date(n.at)) !== today) },
  ].filter(group => group.items.length > 0)

  return (
    <>
      <button ref={trigger} onClick={() => setOpen(v => !v)} aria-label={`Notifications, ${unread} unread`} aria-expanded={open} aria-controls="notification-center"
        className="relative w-11 h-11 rounded-full bg-white shadow-sm flex items-center justify-center text-lg flex-shrink-0">
        🔔
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && portalRoot && createPortal(
        <div className="absolute inset-0 pointer-events-auto" onPointerDown={event => { if (event.target === event.currentTarget) setOpen(false) }}>
          {placement.mobile && <div className="absolute inset-0 bg-black/20" aria-hidden="true" />}
          <section id="notification-center" ref={panel} role="dialog" aria-label="Notifications" aria-modal={placement.mobile} tabIndex={-1}
            className={`absolute flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white text-gray-900 shadow-2xl outline-none ${placement.mobile ? 'notification-center-mobile' : 'notification-center-desktop'}`}
            style={{ top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.height }}>
            <header className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold">Notifications</h2>
                <p className="mt-0.5 text-[11px] text-gray-500">{unread > 0 ? `${unread} unread · ${mine.length} total` : 'You are all caught up'}</p>
              </div>
              <button type="button" disabled={unread === 0} onClick={() => markAllNotificationsRead(currentUser.id)}
                className="whitespace-nowrap text-[11px] font-semibold text-teal-700 hover:text-teal-900 disabled:text-gray-300">Mark all read</button>
              <CloseButton onClick={() => setOpen(false)} />
            </header>
            <div className="grid grid-cols-2 gap-1 border-b border-gray-100 px-4 py-2" role="tablist" aria-label="Notification filter">
              {([
                { id: 'all', label: 'All', count: mine.length },
                { id: 'unread', label: 'Unread', count: unread },
              ] as const).map(option => (
                <button key={option.id} type="button" role="tab" aria-selected={filter === option.id} onClick={() => setFilter(option.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${filter === option.id ? 'bg-teal-50 text-teal-800' : 'text-gray-500 hover:bg-gray-50'}`}>
                  {option.label}
                  <span className="min-w-5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px]">{option.count}</span>
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin' }}>
              {visible.length === 0 ? (
                <div className="py-8 text-center" role="status">
                  <p className="text-2xl" aria-hidden="true">{mine.length ? '✓' : '🔔'}</p>
                  <p className="mt-2 text-sm font-semibold text-gray-700">{mine.length ? 'You are all caught up' : 'No notifications yet'}</p>
                  <p className="mt-1 text-xs text-gray-400">{mine.length ? 'New updates for your account will appear here.' : 'Updates from your care team will appear here.'}</p>
                </div>
              ) : groups.map(group => (
                <section key={group.title} className="mb-4 last:mb-0" aria-label={group.title}>
                  <h3 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{group.title}</h3>
                  <div className="flex flex-col gap-1.5">
                    {group.items.map(n => (
                      <button key={n.id} type="button" aria-label={`${n.title}, ${n.read ? 'read' : 'unread'}, ${ago(n.at, now)}`}
                        onClick={() => { markNotificationRead(n.id); if (n.link) { onNavigate(n.link, n.resource); setOpen(false) } }}
                        className={`w-full rounded-xl border p-3 text-left transition-colors ${n.read ? 'border-transparent bg-white hover:bg-gray-50' : 'border-teal-100 bg-teal-50 hover:bg-teal-100/70'}`}>
                        <span className="flex items-start gap-3">
                          <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-base ${n.kind === 'alert' || n.kind === 'sos' || n.kind === 'escalation' ? 'bg-red-100' : 'bg-gray-50'}`} aria-hidden="true">
                            {NOTIF_ICON[n.kind]}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span className={`text-xs leading-snug ${n.read ? 'font-semibold text-gray-700' : 'font-bold text-gray-900'}`}>{n.title}</span>
                              {!n.read && <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-teal-600" aria-hidden="true" />}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{n.body}</span>
                            <span className="mt-1 block text-[10px] font-medium text-gray-400">{ago(n.at, now)}</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </div>, portalRoot,
      )}
    </>
  )
}

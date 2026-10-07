import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { AppNotification } from '@/shared/lib/types'
import { ago } from '@/shared/lib/vitals'
import { BottomSheet, SheetButton } from './BottomSheet'
import { useAct } from './controls'

/* ─── Notifications bell + sheet ─── */
const NOTIF_ICON: Record<AppNotification['kind'], string> = {
  alert: '⚠️', sos: '🚨', message: '💬', appointment: '📅', assignment: '🩺', prescription: '💊', account: '👤', escalation: '⏫',
  document: '📄', care_plan: '📋', support: '🛟',
}
/** `onNavigate` gets the screen to open and, when the notification says so, the record it is about. */
export function NotificationBell({ onNavigate }: { onNavigate: (tab: string, about?: AppNotification['resource']) => void }) {
  const { currentUser, notifications, markNotificationRead, markAllNotificationsRead, deleteNotification, clearReadNotifications, now } = useApp()
  const act = useAct()
  const [open, setOpen] = useState(false)
  if (!currentUser) return null
  const mine = notifications.filter(n => n.userId === currentUser.id)
  const unread = mine.filter(n => !n.read).length
  const read = mine.length - unread
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label={`Notifications, ${unread} unread`}
        className="relative w-11 h-11 rounded-full bg-white shadow-sm flex items-center justify-center text-lg flex-shrink-0">
        🔔
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'You are all caught up'}
        footer={<><SheetButton tone="ghost" onClick={() => markAllNotificationsRead(currentUser.id)} disabled={unread === 0}>Mark all read</SheetButton><SheetButton onClick={() => setOpen(false)}>Close</SheetButton></>}>
        {act.node}
        {read > 0 && (
          <div className="flex justify-end mb-1.5">
            <button type="button" disabled={act.busy} onClick={() => act.run(() => clearReadNotifications(currentUser.id))}
              className="text-xs font-semibold text-teal-700 px-2 py-1 rounded-lg disabled:opacity-50">
              Clear read ({read})
            </button>
          </div>
        )}
        {mine.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No notifications yet.</p>
        ) : mine.map(n => (
          <div key={n.id} className={`flex items-start gap-1 rounded-xl mb-1.5 ${n.read ? 'bg-white' : 'bg-teal-50'}`}>
            <button
              onClick={() => { markNotificationRead(n.id); if (n.link) { onNavigate(n.link, n.resource); setOpen(false) } }}
              className="flex-1 min-w-0 text-left flex gap-3 p-3">
              <span className="text-lg flex-shrink-0">{NOTIF_ICON[n.kind]}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-xs ${n.read ? 'font-semibold text-gray-700' : 'font-bold text-gray-900'}`}>{n.title}</p>
                <p className="text-[11px] text-gray-500 leading-snug">{n.body}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{ago(n.at, now)}</p>
              </div>
              {!n.read && <span className="w-2 h-2 rounded-full bg-teal-500 mt-1.5 flex-shrink-0" />}
            </button>
            {/* Only once read: an unread notification stays until it has been seen. */}
            {n.read && (
              <button type="button" aria-label={`Delete notification: ${n.title}`} disabled={act.busy}
                onClick={() => act.run(() => deleteNotification(n.id))}
                className="w-9 h-9 m-1.5 flex-shrink-0 rounded-full flex items-center justify-center text-red-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                <svg aria-hidden viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </BottomSheet>
    </>
  )
}

import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { AppNotification } from '@/shared/lib/types'
import { ago } from '@/shared/lib/vitals'
import { BottomSheet, SheetButton } from './BottomSheet'

/* ─── Notifications bell + sheet ─── */
const NOTIF_ICON: Record<AppNotification['kind'], string> = {
  alert: '⚠️', sos: '🚨', message: '💬', appointment: '📅', assignment: '🩺', prescription: '💊', account: '👤', escalation: '⏫',
  document: '📄',
}
export function NotificationBell({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { currentUser, notifications, markNotificationRead, markAllNotificationsRead, now } = useApp()
  const [open, setOpen] = useState(false)
  if (!currentUser) return null
  const mine = notifications.filter(n => n.userId === currentUser.id)
  const unread = mine.filter(n => !n.read).length
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
        {mine.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No notifications yet.</p>
        ) : mine.map(n => (
          <button key={n.id}
            onClick={() => { markNotificationRead(n.id); if (n.link) { onNavigate(n.link); setOpen(false) } }}
            className={`w-full text-left flex gap-3 p-3 rounded-xl mb-1.5 ${n.read ? 'bg-white' : 'bg-teal-50'}`}>
            <span className="text-lg flex-shrink-0">{NOTIF_ICON[n.kind]}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-xs ${n.read ? 'font-semibold text-gray-700' : 'font-bold text-gray-900'}`}>{n.title}</p>
              <p className="text-[11px] text-gray-500 leading-snug">{n.body}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{ago(n.at, now)}</p>
            </div>
            {!n.read && <span className="w-2 h-2 rounded-full bg-teal-500 mt-1.5 flex-shrink-0" />}
          </button>
        ))}
      </BottomSheet>
    </>
  )
}

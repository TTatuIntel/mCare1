import { Avatar, Page, EmptyState, Chevron } from '@/shared'
import { useDoctor } from './useDoctor'

/* ─── Messages ────────────────────────────────────────────────────────
   One conversation per patient, the newest on top. These are the same
   messages the patient sees in their Chat tab: opening one goes to that
   patient's record, where the thread is. */
export function MessagesTab({ openChat }: { openChat: (patientId: string) => void }) {
  const { doctor, patients, messages, unreadFrom, status, error, reload } = useDoctor()
  // `messages` is in the order it was sent, so the last one found for a patient is the latest.
  const threads = patients
    .map(p => {
      const thread = messages.filter(m => m.fromId === p.id || m.toId === p.id)
      return { p, last: thread[thread.length - 1], order: messages.lastIndexOf(thread[thread.length - 1]), unread: unreadFrom(p.id) }
    })
    .sort((a, b) => (b.unread ? 1 : 0) - (a.unread ? 1 : 0) || b.order - a.order)

  return (
    <Page title="Messages" meta={threads.some(t => t.unread) ? `${threads.reduce((n, t) => n + t.unread, 0)} unread` : undefined}
      status={status} error={error} onRetry={reload}>
      {threads.length === 0 && (
        <div className="span-all"><EmptyState icon="💬" title="No conversations yet" text="You can message a patient once they are assigned to you." /></div>
      )}
      {threads.map(({ p, last, unread }) => (
        <button key={p.id} onClick={() => openChat(p.id)}
          className="bg-white rounded-2xl px-4 py-3.5 flex items-center gap-3 shadow-sm text-left active:bg-gray-50">
          <Avatar name={p.name} avatar={p.avatar} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-gray-900 truncate">{p.name}</p>
              {last && <p className="text-[10px] text-gray-400 flex-shrink-0">{last.sentAt}</p>}
            </div>
            <p className={`text-xs truncate ${unread ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
              {last ? `${last.fromId === doctor.id ? 'You: ' : ''}${last.content}` : 'No messages yet'}
            </p>
          </div>
          {unread > 0
            ? <span className="min-w-5 h-5 px-1 rounded-full bg-teal-700 text-white text-[10px] font-black flex items-center justify-center flex-shrink-0">{unread > 9 ? '9+' : unread}</span>
            : <Chevron />}
        </button>
      ))}
    </Page>
  )
}

import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { AvatarSpec } from '@/shared/lib/types'
import { conversationsOf } from '@/shared/lib/messaging'
import { Avatar } from './primitives'
import { inputCls } from './BottomSheet'
import { ChatThread } from './ChatThread'

/** Someone the signed-in person has a conversation with. */
export interface InboxPerson {
  id: string
  name: string
  avatar?: AvatarSpec
  /** Under the name in the thread header, e.g. the doctor's specialty. */
  subtitle?: string
  /** Why nothing more can be sent to them. The conversation stays readable. */
  closed?: string
}

/** Show the search box once the list is longer than this. */
const SEARCH_FROM = 6

/* ─── Messages, the same in every portal ──────────────────────────────
   A list of conversations and the open thread.
     phone and tablet   the list, then the thread in its place (with a back arrow)
     web                the list stays on the left beside the thread
   With one person to talk to (a patient and their doctor) there is no list:
   the thread is the screen. The portal says who the people are; what was
   said comes from the one list of messages, so both sides see the same. */
export function Inbox({ meId, people, openId, onOpen, quickReplies, notice, action, empty }: {
  meId: string
  people: InboxPerson[]
  /** The conversation that is open, if any. */
  openId?: string | null
  onOpen: (id: string | null) => void
  quickReplies?: boolean
  notice?: string
  /** A control for the open thread's header, e.g. a link to that patient's record. */
  action?: (person: InboxPerson) => React.ReactNode
  /** Shown when there is nobody to talk to. */
  empty: React.ReactNode
}) {
  const { messages } = useApp()
  const [q, setQ] = useState('')
  if (people.length === 0) return <>{empty}</>

  const byId = new Map(people.map(p => [p.id, p]))
  const thread = (p: InboxPerson, list: boolean) => (
    <ChatThread key={p.id} meId={meId} otherId={p.id} otherName={p.name} avatar={p.avatar} subtitle={p.subtitle} fill
      quickReplies={quickReplies} notice={notice} closed={p.closed} onBack={list ? () => onOpen(null) : undefined} action={action?.(p)} />
  )
  // One person: the conversation is the whole screen, at a readable width.
  if (people.length === 1) return <div className="flex-1 min-h-0 flex flex-col w-full max-w-2xl mx-auto">{thread(people[0], false)}</div>

  const open = openId ? byId.get(openId) : undefined
  const needle = q.trim().toLowerCase()
  const rows = conversationsOf(messages, meId, people.map(p => p.id))
    .map(c => ({ ...c, person: byId.get(c.otherId)! }))
    .filter(c => !needle || c.person.name.toLowerCase().includes(needle))

  return (
    <div className="flex-1 min-h-0 flex gap-4">
      <div className={`${open ? 'hidden @5xl:flex' : 'flex'} flex-col gap-2 w-full @5xl:w-80 flex-shrink-0 min-h-0`} role="group" aria-label="Conversations">
        {people.length > SEARCH_FROM && (
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search conversations…" aria-label="Search conversations" className={`${inputCls} bg-white flex-shrink-0`} />
        )}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pb-1" style={{ scrollbarWidth: 'none' }}>
          {rows.length === 0 && <p className="text-xs text-gray-400 text-center py-6">Nobody matches.</p>}
          {rows.map(({ person: p, last, unread }) => (
            <button key={p.id} onClick={() => onOpen(p.id)} aria-current={p.id === open?.id}
              className={`bg-white rounded-2xl px-3.5 py-3 flex items-center gap-3 shadow-sm text-left active:bg-gray-50 flex-shrink-0 ${p.id === open?.id ? 'ring-2 ring-teal-500' : ''}`}>
              <Avatar name={p.name} avatar={p.avatar} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={`text-sm truncate ${unread ? 'font-black text-gray-900' : 'font-bold text-gray-800'}`}>{p.name}</p>
                  {last && <p className="text-[10px] text-gray-400 flex-shrink-0">{last.sentAt.split('·')[0].trim()}</p>}
                </div>
                <p className={`text-xs truncate ${unread ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                  {last ? `${last.fromId === meId ? 'You: ' : ''}${last.content}` : p.closed ? 'No messages' : 'No messages yet'}
                </p>
              </div>
              {unread > 0 && (
                <span className="min-w-5 h-5 px-1 rounded-full bg-teal-700 text-white text-[10px] font-black flex items-center justify-center flex-shrink-0" aria-label={`${unread} unread`}>{unread > 9 ? '9+' : unread}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={`${open ? 'flex' : 'hidden @5xl:flex'} flex-1 min-w-0 min-h-0 flex-col`}>
        {open ? thread(open, true) : (
          <div className="flex-1 bg-white rounded-2xl shadow-sm flex flex-col items-center justify-center text-center px-6">
            <p className="text-2xl mb-2" aria-hidden="true">💬</p>
            <p className="text-sm font-semibold text-gray-700">Choose a conversation</p>
            <p className="text-xs text-gray-400 mt-1">Pick someone on the left to read and reply.</p>
          </div>
        )}
      </div>
    </div>
  )
}

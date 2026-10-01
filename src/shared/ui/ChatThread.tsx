import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/shared/state/AppContext'

/* ─── Chat thread (patient ↔ doctor) ─── */
// Shared by the Chat tab and the Home messages card so both offer the same replies
export const PATIENT_QUICK_REPLIES = ['Took my meds ✅', 'Feeling unwell', 'Need a refill', 'Feeling better today', 'I have a question']

export function ChatThread({ meId, otherId, otherName, subtitle, fill, quickReplies }: {
  meId: string; otherId: string; otherName: string; subtitle?: string; fill?: boolean; quickReplies?: boolean
}) {
  const { messages, sendMessage, markMessagesRead } = useApp()
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const thread = messages.filter(m => (m.fromId === meId && m.toId === otherId) || (m.fromId === otherId && m.toId === meId))
  const unreadFromOther = thread.some(m => m.fromId === otherId && !m.read)
  useEffect(() => { if (unreadFromOther) markMessagesRead(otherId, meId) }, [unreadFromOther, otherId, meId])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [thread.length])
  const send = (body: string) => { const v = body.trim(); if (!v) return; sendMessage(meId, otherId, v); setText('') }
  const initials = otherName.split(' ').filter(n => n !== 'Dr.').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  // "Sep 30 · 2:57 AM" → day label is everything before the separator
  const dayOf = (sentAt: string) => sentAt.split('·')[0].trim()

  return (
    <div className={`bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col ${fill ? 'flex-1 min-h-0' : ''}`}>
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2.5 bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-600 to-teal-800 flex items-center justify-center text-white text-xs font-bold">{initials}</div>
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 leading-tight truncate">{otherName}</p>
          <p className="text-[10px] text-gray-400 truncate">{subtitle ?? 'Secure care channel'}</p>
        </div>
        <span className="ml-auto flex items-center gap-1 text-[9px] font-semibold text-teal-700 bg-teal-50 px-2 py-1 rounded-full flex-shrink-0">
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Encrypted
        </span>
      </div>

      <div
        className={`px-3.5 py-3 flex flex-col gap-1.5 overflow-y-auto ${fill ? 'flex-1 min-h-0' : ''}`}
        style={{ scrollbarWidth: 'none', ...(fill ? {} : { minHeight: 240, maxHeight: 380 }) }}
      >
        {thread.length === 0
          ? (
            <div className="m-auto text-center px-6">
              <div className="w-11 h-11 rounded-full bg-teal-50 flex items-center justify-center mx-auto mb-2 text-lg">💬</div>
              <p className="text-xs font-semibold text-gray-600">No messages yet</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Say hello — {otherName.split(' ')[0]} replies during working hours.</p>
            </div>
          )
          : thread.map((m, i) => {
            const isMe = m.fromId === meId
            const prev = thread[i - 1]
            const newDay = !prev || dayOf(prev.sentAt) !== dayOf(m.sentAt)
            const grouped = !!prev && !newDay && prev.fromId === m.fromId
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="flex items-center gap-2 my-2.5">
                    <div className="flex-1 h-px bg-gray-100" />
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">{dayOf(m.sentAt)}</span>
                    <div className="flex-1 h-px bg-gray-100" />
                  </div>
                )}
                <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-0.5' : 'mt-1.5'}`}>
                  <div className={`max-w-[78%] px-3 py-2 text-xs leading-snug shadow-sm ${isMe
                    ? `bg-teal-700 text-white rounded-2xl ${grouped ? 'rounded-tr-md' : ''} rounded-br-md`
                    : `bg-gray-100 text-gray-800 rounded-2xl ${grouped ? 'rounded-tl-md' : ''} rounded-bl-md`}`}>
                    {m.content}
                    <p className={`text-[9px] mt-1 flex items-center gap-1 ${isMe ? 'text-teal-200 justify-end' : 'text-gray-400'}`}>
                      {m.sentAt.split('·').pop()?.trim()}
                      {isMe && (
                        <svg className={`w-3 h-3 ${m.read ? 'text-white' : 'text-teal-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        <div ref={endRef} />
      </div>

      {quickReplies && (
        <div className="px-3 pt-2 flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {PATIENT_QUICK_REPLIES.map(q => (
            <button key={q} onClick={() => send(q)}
              className="flex-shrink-0 text-[10px] font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-2.5 py-1.5 rounded-full active:bg-teal-100">
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="p-2.5 flex items-center gap-2">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send(text)}
          placeholder="Type a message…" aria-label="Message"
          className="flex-1 bg-gray-50 border border-gray-200 rounded-full px-4 py-2.5 text-sm outline-none focus:border-teal-400 focus:bg-white transition-colors" />
        <button onClick={() => send(text)} disabled={!text.trim()} aria-label="Send"
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${text.trim() ? 'bg-teal-700 text-white shadow-sm' : 'bg-gray-100 text-gray-300'}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  )
}

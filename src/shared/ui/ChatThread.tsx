import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { stamp } from '@/shared/lib/vitals'

/* ─── Chat thread (patient ↔ doctor) ─── */
// Shared by the Chat tab and the Home messages card so both offer the same replies
export const PATIENT_QUICK_REPLIES = ['Took my meds ✅', 'Feeling unwell', 'Need a refill', 'Feeling better today', 'I have a question']

/** Further than this (px) from the newest message counts as "reading back", so new messages don't yank the view. */
const AWAY_AFTER = 80
const DAY_MS = 86_400_000

export function ChatThread({ meId, otherId, otherName, subtitle, fill, quickReplies, notice }: {
  meId: string; otherId: string; otherName: string; subtitle?: string; fill?: boolean; quickReplies?: boolean
  /** Small print under the message box, e.g. the "not monitored 24/7" safety line. */
  notice?: string
}) {
  const { messages, sendMessage, markMessagesRead, now } = useApp()
  const [text, setText] = useState('')
  const [away, setAway] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const thread = messages.filter(m => (m.fromId === meId && m.toId === otherId) || (m.fromId === otherId && m.toId === meId))
  const last = thread[thread.length - 1]
  const unreadFromOther = thread.some(m => m.fromId === otherId && !m.read)
  useEffect(() => { if (unreadFromOther) markMessagesRead(otherId, meId) }, [unreadFromOther, otherId, meId])

  const toLatest = (smooth = false) => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }
  // Follow the conversation, unless the reader has scrolled back; their own message always brings them down.
  useEffect(() => { if (!away || last?.fromId === meId) toLatest() }, [thread.length])
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setAway(el.scrollHeight - el.scrollTop - el.clientHeight > AWAY_AFTER)
  }

  // The message box grows with what is typed, up to its max height.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const send = (body: string) => { const v = body.trim(); if (!v) return; sendMessage(meId, otherId, v); setText('') }
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends with a keyboard; on a touch keyboard it starts a new line and the button sends.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    if (window.matchMedia('(pointer: coarse)').matches) return
    e.preventDefault()
    send(text)
  }

  const initials = otherName.split(' ').filter(n => n !== 'Dr.').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  // "Sep 30 · 2:57 AM" → day label is everything before the separator
  const dayOf = (sentAt: string) => sentAt.split('·')[0].trim()
  const timeOf = (sentAt: string) => sentAt.split('·').pop()?.trim()
  const today = dayOf(stamp(new Date(now)))
  const yesterday = dayOf(stamp(new Date(now - DAY_MS)))
  const dayLabel = (sentAt: string) => { const d = dayOf(sentAt); return d === today ? 'Today' : d === yesterday ? 'Yesterday' : d }

  return (
    <div className={`bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col ${fill ? 'flex-1 min-h-0' : ''}`}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-600 to-teal-800 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">{initials}</div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 leading-tight truncate font-display">{otherName}</p>
          <p className="text-[11px] text-gray-500 truncate mt-0.5">{subtitle ?? 'Secure care channel'}</p>
        </div>
        <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-teal-700 bg-teal-50 px-2 py-1 rounded-full flex-shrink-0">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Encrypted
        </span>
      </div>

      <div className={`relative flex flex-col ${fill ? 'flex-1 min-h-0' : ''}`}>
        <div
          ref={listRef} onScroll={onScroll} role="log" aria-label={`Conversation with ${otherName}`}
          className={`bg-gray-50 px-3 py-3 flex flex-col overflow-y-auto overscroll-contain @2xl:px-5 ${fill ? 'flex-1 min-h-0' : 'min-h-60 max-h-96'}`}
          style={{ scrollbarWidth: 'none' }}
        >
          {thread.length === 0
            ? (
              <div className="m-auto text-center px-6 py-6">
                <div className="w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center mx-auto mb-3 text-xl">💬</div>
                <p className="text-sm font-semibold text-gray-700">No messages yet</p>
                <p className="text-xs text-gray-500 mt-1">Say hello — {otherName.split(' ')[0]} replies during working hours.</p>
              </div>
            )
            : (
              // mt-auto keeps a short conversation next to the message box instead of leaving a gap above it
              <div className="mt-auto flex flex-col">
                {thread.map((m, i) => {
                  const isMe = m.fromId === meId
                  const prev = thread[i - 1]
                  const next = thread[i + 1]
                  const newDay = !prev || dayOf(prev.sentAt) !== dayOf(m.sentAt)
                  const grouped = !!prev && !newDay && prev.fromId === m.fromId
                  const groupEnd = !next || next.fromId !== m.fromId || dayOf(next.sentAt) !== dayOf(m.sentAt)
                  return (
                    <div key={m.id}>
                      {newDay && (
                        <div className="flex justify-center my-3">
                          <span className="text-[10px] font-semibold text-gray-500 bg-white border border-gray-100 px-2.5 py-1 rounded-full shadow-sm">{dayLabel(m.sentAt)}</span>
                        </div>
                      )}
                      <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-1' : 'mt-3'}`}>
                        <div className={`max-w-[82%] @2xl:max-w-[70%] px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words rounded-2xl ${isMe
                          ? `bg-teal-700 text-white ${grouped ? 'rounded-tr-md' : ''} ${groupEnd ? '' : 'rounded-br-md'}`
                          : `bg-white text-gray-800 border border-gray-100 shadow-sm ${grouped ? 'rounded-tl-md' : ''} ${groupEnd ? '' : 'rounded-bl-md'}`}`}>
                          {m.content}
                          <span className={`flex items-center gap-1 text-[10px] mt-0.5 font-mono ${isMe ? 'text-teal-100 justify-end' : 'text-gray-400'}`}>
                            {timeOf(m.sentAt)}
                            {isMe && (
                              <>
                                <svg className={`w-3.5 h-3.5 ${m.read ? 'text-sky-300' : 'text-teal-200'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={m.read ? 'M2 13l4 4L16 7M11 16l1 1L22 7' : 'M5 13l4 4L19 7'} />
                                </svg>
                                <span className="sr-only">{m.read ? 'Read' : 'Sent'}</span>
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
        </div>
        {away && (
          <button onClick={() => toLatest(true)} aria-label="Jump to latest message"
            className="absolute right-3 bottom-3 w-9 h-9 rounded-full bg-white border border-gray-200 shadow-md text-teal-700 flex items-center justify-center active:bg-gray-50">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      <div className="border-t border-gray-100 flex-shrink-0">
        {quickReplies && !text && (
          <div className="px-3 pt-2.5 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {PATIENT_QUICK_REPLIES.map(q => (
              <button key={q} onClick={() => send(q)}
                className="flex-shrink-0 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-3 py-1.5 rounded-full active:bg-teal-100">
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="p-2.5 flex items-end gap-2">
          <div className="flex-1 min-w-0 flex bg-gray-50 border border-gray-200 rounded-3xl px-4 py-2.5 transition-colors focus-within:border-teal-400 focus-within:bg-white">
            <textarea ref={inputRef} rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKeyDown}
              placeholder="Type a message…" aria-label="Message" enterKeyHint="send"
              className="flex-1 min-w-0 max-h-28 resize-none bg-transparent text-sm leading-5 outline-none placeholder:text-gray-400"
              style={{ scrollbarWidth: 'none' }} />
          </div>
          <button onClick={() => { send(text); inputRef.current?.focus() }} disabled={!text.trim()} aria-label="Send"
            className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${text.trim() ? 'bg-teal-700 text-white shadow-sm active:scale-95' : 'bg-gray-100 text-gray-300'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>

        {notice && (
          <p className="px-4 pb-2.5 -mt-0.5 text-[10px] text-gray-400 text-center flex items-center justify-center gap-1">
            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {notice}
          </p>
        )}
      </div>
    </div>
  )
}

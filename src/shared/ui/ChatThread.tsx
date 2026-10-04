import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { AvatarSpec } from '@/shared/lib/types'
import { newRef } from '@/shared/lib/ids'
import { threadOf } from '@/shared/lib/messaging'
import { stamp } from '@/shared/lib/vitals'
import { Avatar } from './primitives'

/* ─── One conversation ────────────────────────────────────────────────
   The same thread in every portal: both people read the same messages.
   A message is sent once (its reference travels with it, so a retry after
   a lost answer does not send it twice), is never edited, and shows
   whether the other person has read it. */
// Shared by the Chat tab and the Home messages card so both offer the same replies
export const PATIENT_QUICK_REPLIES = ['Took my meds ✅', 'Feeling unwell', 'Need a refill', 'Feeling better today', 'I have a question']

/** Further than this (px) from the newest message counts as "reading back", so new messages don't yank the view. */
const AWAY_AFTER = 80
const DAY_MS = 86_400_000

export function ChatThread({ meId, otherId, otherName, avatar, subtitle, fill, quickReplies, notice, closed, onBack, action }: {
  meId: string; otherId: string; otherName: string
  avatar?: AvatarSpec
  subtitle?: string
  /** Fill the height it is given instead of a fixed-height box. */
  fill?: boolean
  /** Offer the patient's one-tap replies. */
  quickReplies?: boolean
  /** Small print under the message box, e.g. the "not monitored 24/7" safety line. */
  notice?: string
  /** Why nothing more can be sent here (the two are no longer patient and doctor). The thread stays readable. */
  closed?: string
  /** Shows a back arrow in the header (the conversation list is behind it on a phone). */
  onBack?: () => void
  /** A control at the right of the header, e.g. "Open record". */
  action?: React.ReactNode
}) {
  const { messages, sendMessage, markMessagesRead, now } = useApp()
  const [text, setText] = useState('')
  const [away, setAway] = useState(false)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState('')
  /** The message that did not go through, with its reference: sending the same words again reuses it. */
  const retry = useRef<{ body: string; ref: string } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const thread = threadOf(messages, meId, otherId)
  const last = thread[thread.length - 1]
  const unreadFromOther = thread.some(m => m.fromId === otherId && !m.read)
  // The newest of my messages the other person has read: it says when.
  const lastReadMine = [...thread].reverse().find(m => m.fromId === meId && m.read)
  useEffect(() => { if (unreadFromOther) void markMessagesRead(otherId, meId) }, [unreadFromOther, otherId, meId]) // eslint-disable-line react-hooks/exhaustive-deps

  const toLatest = (smooth = false) => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }
  // Follow the conversation, unless the reader has scrolled back; their own message always brings them down.
  useEffect(() => { if (!away || last?.fromId === meId) toLatest() }, [thread.length]) // eslint-disable-line react-hooks/exhaustive-deps
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

  const send = async (body: string) => {
    const v = body.trim()
    if (!v || sending || closed) return
    setSending(true); setFailed('')
    const typed = text
    setText('')
    const ref = retry.current?.body === v ? retry.current.ref : newRef()
    const res = await sendMessage(meId, otherId, v, ref)
    setSending(false)
    // Not sent: what was typed goes back in the box, and the reason is shown.
    if (res.ok) retry.current = null
    else { retry.current = { body: v, ref }; setText(typed || v); setFailed(res.error) }
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends with a keyboard; on a touch keyboard it starts a new line and the button sends.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    if (window.matchMedia('(pointer: coarse)').matches) return
    e.preventDefault()
    void send(text)
  }

  // "Sep 30 · 2:57 AM" → day label is everything before the separator
  const dayOf = (sentAt: string) => sentAt.split('·')[0].trim()
  const timeOf = (sentAt: string) => sentAt.split('·').pop()?.trim()
  const today = dayOf(stamp(new Date(now)))
  const yesterday = dayOf(stamp(new Date(now - DAY_MS)))
  const dayLabel = (sentAt: string) => { const d = dayOf(sentAt); return d === today ? 'Today' : d === yesterday ? 'Yesterday' : d }

  return (
    <div className={`bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col ${fill ? 'flex-1 min-h-0' : ''}`}>
      <div className="px-3 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
        {onBack && (
          <button onClick={onBack} aria-label="Back to conversations" className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 @5xl:hidden">
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <Avatar name={otherName} avatar={avatar} size="xs" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900 leading-tight truncate font-display">{otherName}</p>
          <p className="text-[11px] text-gray-500 truncate mt-0.5">{subtitle ?? 'Only the two of you can read this'}</p>
        </div>
        {action}
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
                <div className="w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center mx-auto mb-3 text-xl" aria-hidden="true">💬</div>
                <p className="text-sm font-semibold text-gray-700">No messages yet</p>
                <p className="text-xs text-gray-500 mt-1">{closed ? 'Nothing was said in this conversation.' : `Write the first message to ${otherName}.`}</p>
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
                                {m.id === lastReadMine?.id && m.readAt && (
                                  <span className="font-sans">Read {new Date(m.readAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                                )}
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

      {closed ? (
        <p role="status" className="border-t border-gray-100 px-4 py-3 text-[11px] text-gray-500 text-center flex-shrink-0">{closed}</p>
      ) : (
        <div className="border-t border-gray-100 flex-shrink-0">
          {quickReplies && !text && (
            <div className="px-3 pt-2.5 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {PATIENT_QUICK_REPLIES.map(q => (
                <button key={q} onClick={() => send(q)} disabled={sending}
                  className="flex-shrink-0 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-3 py-1.5 rounded-full active:bg-teal-100 disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
          )}

          {failed && <p role="alert" className="mx-3 mt-2 rounded-xl bg-red-50 border border-red-100 px-3 py-1.5 text-[11px] font-semibold text-red-700">Not sent. {failed}</p>}
          <div className="p-2.5 flex items-end gap-2">
            <div className="flex-1 min-w-0 flex bg-gray-50 border border-gray-200 rounded-3xl px-4 py-2.5 transition-colors focus-within:border-teal-400 focus-within:bg-white">
              <textarea ref={inputRef} rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKeyDown} maxLength={2000}
                placeholder="Type a message…" aria-label="Message" enterKeyHint="send"
                className="flex-1 min-w-0 max-h-28 resize-none bg-transparent text-sm leading-5 outline-none placeholder:text-gray-400"
                style={{ scrollbarWidth: 'none' }} />
            </div>
            <button onClick={() => { void send(text); inputRef.current?.focus() }} disabled={!text.trim() || sending} aria-label="Send"
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
      )}
    </div>
  )
}

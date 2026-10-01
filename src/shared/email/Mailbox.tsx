import { useMemo, useRef, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { EmailKind, SentEmail, SentSms } from '@/shared/lib/types'
import { BottomSheet, SheetButton } from '@/shared/ui/BottomSheet'
import { ago } from '@/shared/lib/vitals'
import { renderEmail, EMAIL_FROM, SMS_FROM } from './emailTemplate'

const KIND_ICON: Record<EmailKind, string> = {
  verification: '🔐', invitation: '✉️', password_reset: '🔑', password_changed: '🛡️', welcome: '👋', notification: '🔔',
}

/**
 * One email exactly as the recipient's mail app shows it. Sandboxed: no scripts
 * run inside and links can't leave the frame; a tap on a link is handed to
 * `onLink` instead. The frame grows to the email's height, so it never scrolls
 * on its own.
 */
export function EmailPreview({ email, onLink }: { email: SentEmail; onLink?: (url: string) => void }) {
  const { html, subject } = useMemo(() => renderEmail(email.content), [email])
  const frame = useRef<HTMLIFrameElement>(null)
  const linkRef = useRef(onLink)
  linkRef.current = onLink
  const [height, setHeight] = useState(520)

  const wire = () => {
    const doc = frame.current?.contentDocument
    if (!doc?.body) return
    const fit = () => setHeight(doc.body.scrollHeight)
    fit()
    new ResizeObserver(fit).observe(doc.body)
    doc.addEventListener('click', e => {
      const a = (e.target as Element | null)?.closest?.('a')
      if (!a) return
      e.preventDefault()
      linkRef.current?.(a.getAttribute('href') ?? '')
    })
  }

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white">
      <div className="px-3 py-2 border-b border-gray-100">
        <p className="text-xs font-bold text-gray-900 truncate">{subject}</p>
        <p className="text-[10px] text-gray-400 truncate">{EMAIL_FROM} · to {email.content.to}</p>
      </div>
      <iframe ref={frame} title={subject} sandbox="allow-same-origin" srcDoc={html} onLoad={wire} scrolling="no"
        className="w-full block" style={{ height, border: 0 }} />
    </div>
  )
}

/** A text message as it lands on the phone. */
function SmsPreview({ sms }: { sms: SentSms }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-4">
      <p className="text-[10px] text-gray-400 text-center mb-3">Text message · {SMS_FROM} → {sms.to}</p>
      <div className="max-w-[85%] bg-white border border-gray-200 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm text-gray-900 shadow-sm">{sms.text}</div>
      <p className="text-[10px] text-gray-400 mt-1.5 ml-1">{sms.createdAt}</p>
    </div>
  )
}

type Item = { id: string; at: number; email?: SentEmail; sms?: SentSms }

/**
 * Messages mCare has sent to one person — emails and, when a phone number is
 * given, texts — newest first. Until the mail and SMS services are connected
 * this is where a code or link can be read; afterwards it stays useful as the
 * "what did you send me?" record.
 */
export function MailboxSheet({ address, phone, open, onClose, openLatest, onLink }: {
  address: string
  phone?: string
  open: boolean
  onClose: () => void
  /** Jump straight to the newest email (e.g. the code just sent). */
  openLatest?: boolean
  /** Called when the reader taps the button or link inside the email. Return false if the link is no longer valid. */
  onLink?: (email: SentEmail) => boolean
}) {
  const { emailsFor, textsFor, now } = useApp()
  const items: Item[] = [
    ...emailsFor(address).map(email => ({ id: email.id, at: email.at, email })),
    ...(phone ? textsFor(phone).map(sms => ({ id: sms.id, at: sms.at, sms })) : []),
  ].sort((a, b) => b.at - a.at)
  const [picked, setPicked] = useState<string | null>(null)
  const [linkError, setLinkError] = useState('')
  const shown = items.find(e => e.id === picked) ?? (openLatest && picked === null ? items.find(i => i.email) : undefined)
  const close = () => { setPicked(null); setLinkError(''); onClose() }
  // The button (and the spelled-out link) inside the email works like it does in a real inbox.
  const follow = (url: string) => {
    const email = shown?.email
    if (!onLink || !email || url !== email.content.action?.url) return
    if (!['verification', 'invitation', 'password_reset'].includes(email.content.kind)) return
    if (onLink(email)) close(); else setLinkError('That link has expired. Use the newest email.')
  }

  return (
    <BottomSheet open={open} onClose={close}
      title={shown ? (shown.sms ? 'Text message' : 'Email') : 'Messages from mCare'}
      subtitle={shown ? undefined : [address, phone].filter(Boolean).join(' · ')}
      footer={shown
        ? <>{items.length > 1 && <SheetButton tone="ghost" onClick={() => { setPicked(''); setLinkError('') }}>All ({items.length})</SheetButton>}
            <SheetButton tone={items.length > 1 ? undefined : 'ghost'} onClick={close}>Done</SheetButton></>
        : <SheetButton tone="ghost" onClick={close}>Close</SheetButton>}>
      {shown?.email ? <EmailPreview key={shown.id} email={shown.email} onLink={follow} /> : shown?.sms ? <SmsPreview sms={shown.sms} /> : items.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">Nothing yet. Codes, links and notifications sent to you appear here.</p>
      ) : (
        <div className="rounded-2xl border border-gray-100 divide-y divide-gray-50">
          {items.map(i => (
            <button key={i.id} onClick={() => setPicked(i.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left active:bg-gray-50">
              <span className="text-base w-6 text-center flex-shrink-0">{i.email ? KIND_ICON[i.email.content.kind] : '💬'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-900 truncate">{i.email ? i.email.content.subject : 'Text message'}</p>
                <p className="text-[10px] text-gray-400 truncate">{i.email ? i.email.content.lines[0] : i.sms!.text}</p>
              </div>
              <span className="text-[10px] text-gray-400 flex-shrink-0">{ago(i.at, now)}</span>
            </button>
          ))}
        </div>
      )}
      {linkError && <p className="text-[11px] text-red-600 font-semibold mt-2">{linkError}</p>}
    </BottomSheet>
  )
}

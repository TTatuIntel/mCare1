import { useEffect, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, Field, Pill, Toggle, inputCls, useSave, SaveError } from '@/shared'
import type { ShareLink } from '@/shared/lib/types'
import { canShare, SHARE_TTL_HOURS, DOC_CATEGORIES } from './documents'
import { ago } from '@/shared/lib/vitals'
import { copyText } from '@/shared/lib/clipboard'

function linkState(s: ShareLink, now: number): { label: string; color: string; live: boolean } {
  if (s.revokedAt) return { label: 'Revoked', color: 'gray', live: false }
  if (s.oneTime && s.usedAt) return { label: 'Used', color: 'gray', live: false }
  if (now > s.expiresAt) return { label: 'Expired', color: 'gray', live: false }
  const h = Math.max(1, Math.round((s.expiresAt - now) / 3_600_000))
  return { label: `Active · ${h} h left`, color: 'green', live: true }
}

/**
 * Patient-issued, time-limited access for a clinician outside mCare.
 * The token is the only credential, so links expire, can be one-time,
 * can be revoked, and every open is logged and reported back to the patient.
 */
export function ShareSheet({ open, onClose, patientId, preselect }: {
  open: boolean; onClose: () => void; patientId: string; preselect?: string[]
}) {
  const { currentUser, documentsFor, docPolicyCtx, shareLinksFor, createShareLink, shareLinkUrl, revokeShareLink, openShareLink, now, live } = useApp()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const revoking = useSave()
  const [picked, setPicked] = useState<string[]>([])
  const [recipient, setRecipient] = useState('')
  const [ttl, setTtl] = useState<number>(24)
  const [oneTime, setOneTime] = useState(true)
  const [created, setCreated] = useState<ShareLink | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    setPicked(preselect ?? []); setRecipient(''); setTtl(24); setOneTime(true); setCreated(null); setPreview(''); setCopied(false); setCopyFailed(false)
  }, [open])

  const ctx = docPolicyCtx()
  const allowed = documentsFor(patientId).filter(e => canShare(currentUser, e.doc, ctx))
  // A link carries report content. An uploaded file stays in private storage, which a person without an account cannot reach.
  const shareable = live ? allowed.filter(e => !!e.doc.body) : allowed
  const filesLeftOut = allowed.length - shareable.length
  const links = shareLinksFor(patientId)
  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  const create = async () => {
    if (busy) return
    setBusy(true); setFailed(false)
    const link = await createShareLink(picked, recipient, ttl, oneTime)
    setBusy(false)
    if (link) setCreated(link)
    else setFailed(true)
  }
  const copy = async (s: ShareLink) => {
    const ok = await copyText(shareLinkUrl(s))
    setCopyFailed(!ok)
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500) }
  }
  const tryOpen = (s: ShareLink) => {
    const res = openShareLink(s.token)
    setPreview(res.ok ? `Recipient sees: ${res.docs.map(d => d.title).join(', ')}` : `Recipient sees: ${res.error}`)
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Share with an outside doctor"
      subtitle="Creates a secure link that expires. You can revoke it at any time, and you're notified when it's opened."
      footer={created
        ? <SheetButton onClick={onClose}>Done</SheetButton>
        : <><SheetButton tone="ghost" onClick={onClose}>Close</SheetButton><SheetButton disabled={!picked.length || !recipient.trim() || busy} onClick={create}>{busy ? 'Creating…' : 'Create link'}</SheetButton></>}>

      {created ? (
        <div className="bg-teal-50 border border-teal-100 rounded-2xl p-3 mb-4">
          <p className="text-xs font-bold text-teal-800">Link ready for {created.recipient}</p>
          <p className="text-[11px] text-teal-700 break-all mt-1 font-mono select-all">{shareLinkUrl(created)}</p>
          {live && <p className="text-[10px] text-teal-700 mt-1">Copy it now. For your safety mCare does not keep the link, so it cannot be shown again.</p>}
          <p className="text-[10px] text-teal-600 mt-1">{created.docIds.length} document{created.docIds.length > 1 ? 's' : ''} · expires in {ttl} h{created.oneTime ? ' · works once' : ''}</p>
          <div className="flex gap-2 mt-2">
            <button onClick={() => copy(created)} className="text-[11px] font-bold text-white bg-teal-700 px-3 py-1 rounded-full">{copied ? '✓ Copied' : 'Copy link'}</button>
            {!live && <button onClick={() => tryOpen(created)} className="text-[11px] font-bold text-teal-700 bg-white border border-teal-200 px-3 py-1 rounded-full">Open as recipient (demo)</button>}
          </div>
          {copyFailed && <p className="text-[10px] text-red-600 font-semibold mt-2">This browser would not copy it. Press and hold the link above, then choose Copy.</p>}
          {preview && <p className="text-[10px] text-gray-600 mt-2">{preview}</p>}
        </div>
      ) : (
        <>
          <Field label={`Documents to share (${picked.length})`}>
            <div className="flex flex-col gap-1 max-h-44 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {shareable.length === 0 && <p className="text-xs text-gray-400">No documents can be shared yet.</p>}
              {filesLeftOut > 0 && <p className="text-[10px] text-gray-400">{filesLeftOut} uploaded file{filesLeftOut > 1 ? 's are' : ' is'} not listed: links carry reports only. Download a file to send it yourself.</p>}
              {shareable.map(({ doc }) => (
                <label key={doc.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${picked.includes(doc.id) ? 'border-teal-300 bg-teal-50' : 'border-gray-100'}`}>
                  <input type="checkbox" checked={picked.includes(doc.id)} onChange={() => toggle(doc.id)} />
                  <span className="text-sm">{DOC_CATEGORIES[doc.category].icon}</span>
                  <span className="text-xs text-gray-800 flex-1 truncate">{doc.title}</span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Recipient *">
            <input value={recipient} onChange={e => setRecipient(e.target.value)} className={inputCls} placeholder="e.g. Dr. Otieno, Nairobi Hospital" maxLength={80} />
          </Field>
          <Field label="Expires after">
            <div className="grid grid-cols-3 gap-2">
              {SHARE_TTL_HOURS.map(h => (
                <button key={h} onClick={() => setTtl(h)}
                  className={`py-2 rounded-xl text-xs font-semibold border-2 ${ttl === h ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-100 bg-gray-50 text-gray-600'}`}>
                  {h === 1 ? '1 hour' : h === 24 ? '24 hours' : '3 days'}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5 mb-3">
            <div className="flex-1">
              <p className="text-xs font-semibold text-gray-800">One-time link</p>
              <p className="text-[10px] text-gray-400">Stops working after it's opened once.</p>
            </div>
            <Toggle on={oneTime} onChange={() => setOneTime(v => !v)} />
          </div>
          {failed && <p role="alert" className="text-xs font-semibold text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-3">The link could not be created. Check your connection and try again.</p>}
        </>
      )}

      {links.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Your share links</p>
          {links.map(s => {
            const st = linkState(s, now)
            return (
              <div key={s.id} className="border border-gray-100 rounded-xl p-3 mb-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-gray-900 truncate">{s.recipient}</p>
                  <Pill color={st.color}>{st.label}</Pill>
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">{s.docIds.length} document{s.docIds.length > 1 ? 's' : ''} · created {ago(s.at, now)}{s.usedAt ? ` · opened ${ago(s.usedAt, now)}` : ''}</p>
                {st.live && (
                  <div className="flex gap-3 mt-1.5">
                    {shareLinkUrl(s) && <button onClick={() => copy(s)} className="text-[11px] font-bold text-teal-700">Copy</button>}
                    {!live && <button onClick={() => tryOpen(s)} className="text-[11px] font-bold text-gray-500">Test open</button>}
                    <button disabled={revoking.busy} onClick={() => revoking.run(() => revokeShareLink(s.id))} className="text-[11px] font-bold text-red-600 disabled:opacity-50">Revoke</button>
                  </div>
                )}
              </div>
            )
          })}
          <SaveError message={revoking.error} />
          {preview && !created && <p className="text-[10px] text-gray-600">{preview}</p>}
        </div>
      )}
    </BottomSheet>
  )
}

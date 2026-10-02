import { useState } from 'react'
import { BackHeader, EmptyState, Pill, Avatar, Segmented, BottomSheet, SheetButton, Field, inputCls, useSave, SaveError, useToast } from '@/shared'
import type { SupportTicket } from '@/shared/lib/types'
import { ago } from '@/shared/lib/vitals'
import { useAdmin } from './useAdmin'

type View = 'open' | 'resolved'

/* ─── Support requests ────────────────────────────────────────────────
   What people asked the mCare team for from their Profile ("Ask for
   help"). Answering one tells the person who asked, with the note written
   here. A request is never deleted: resolved ones stay as history. */
export default function SupportTab({ onBack }: { onBack: () => void }) {
  const { supportTickets, person, nameOf, resolveTicket, now, status, error, reload } = useAdmin()
  const [view, setView] = useState<View>('open')
  const [answering, setAnswering] = useState<SupportTicket | null>(null)
  const [note, setNote] = useState('')
  const save = useSave()
  const toast = useToast()
  const open = supportTickets.filter(t => t.status === 'open')
  const resolved = supportTickets.filter(t => t.status === 'resolved')
  const list = view === 'open' ? open : resolved

  const submit = async () => {
    if (!answering || !note.trim()) return
    if (!(await save.run(() => resolveTicket(answering.id, note.trim()))).ok) return
    toast.show(`Answered · ${nameOf(answering.userId)} has been told`)
    setAnswering(null)
  }

  return (
    <div className="flex flex-col gap-3 card-flow">
      <BackHeader title="Support" subtitle={`${open.length} waiting · ${resolved.length} answered`} onBack={onBack} />
      {toast.node && <div className="span-all">{toast.node}</div>}
      <div className="span-all">
        <Segmented label="Which requests" value={view} onChange={setView}
          options={[{ id: 'open', label: `Waiting (${open.length})` }, { id: 'resolved', label: `Answered (${resolved.length})` }]} />
      </div>

      {status === 'error' && <div className="span-all"><EmptyState icon="⚠️" title="Couldn’t load support requests" text={error} action="Try again" onAction={reload} /></div>}
      {status === 'ready' && list.length === 0 && (
        <div className="span-all">
          <EmptyState icon="🛟" title={view === 'open' ? 'Nobody is waiting' : 'No answered requests yet'}
            text={view === 'open' ? 'A request someone sends from their Profile appears here.' : 'Requests you answer stay here as history.'} />
        </div>
      )}

      {list.map(t => {
        const who = person(t.userId)
        return (
          <div key={t.id} className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <Avatar name={who?.name ?? 'User'} avatar={who?.avatar} size="xs" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900">{t.subject}</p>
                <p className="text-[11px] text-gray-500">{who?.name ?? 'Someone'}{who ? ` · ${who.role}` : ''} · {ago(t.at, now)}</p>
              </div>
              <Pill color={t.status === 'open' ? 'amber' : 'green'}>{t.status === 'open' ? 'Waiting' : 'Answered'}</Pill>
            </div>
            {t.message && <p className="text-xs text-gray-700 leading-relaxed mt-2 whitespace-pre-wrap">{t.message}</p>}
            {who && <p className="text-[10px] text-gray-400 mt-2">{who.email}{who.phone ? ` · ${who.phone}` : ''}</p>}
            {t.status === 'resolved' ? (
              <div className="bg-emerald-50 rounded-xl px-3 py-2 mt-3">
                <p className="text-[11px] text-emerald-800">{t.resolutionNote || 'Resolved.'}</p>
                <p className="text-[10px] text-emerald-700 mt-0.5">{nameOf(t.resolvedBy, 'mCare support')} · {t.resolvedAt}</p>
              </div>
            ) : (
              <button onClick={() => { save.clear(); setNote(''); setAnswering(t) }}
                className="w-full mt-3 py-2.5 rounded-xl bg-teal-700 text-white text-xs font-bold">Answer and close</button>
            )}
          </div>
        )
      })}

      <BottomSheet open={!!answering} onClose={() => setAnswering(null)} title="Answer this request"
        subtitle={answering ? `${answering.subject} · ${nameOf(answering.userId)}` : ''}
        footer={<><SheetButton tone="ghost" onClick={() => setAnswering(null)}>Cancel</SheetButton>
          <SheetButton disabled={!note.trim() || save.busy} onClick={submit}>{save.busy ? 'Saving…' : 'Send and close'}</SheetButton></>}>
        <Field label="What was done *">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} maxLength={1000} className={`${inputCls} resize-none`}
            placeholder="e.g. Your phone number has been updated. Sign in again to see it." />
        </Field>
        <p className="text-[10px] text-gray-400 mb-2">This is sent to the person who asked, as a notification.</p>
        <SaveError message={save.error} />
      </BottomSheet>
    </div>
  )
}

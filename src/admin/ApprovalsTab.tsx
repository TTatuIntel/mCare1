import { useState } from 'react'
import { Avatar, Pill, Page, EmptyState, BottomSheet, SheetButton, Field, inputCls, useSave, SaveError, useToast } from '@/shared'
import type { DoctorUser } from '@/shared/lib/types'
import { useAdmin } from './useAdmin'

type Decision = 'approved' | 'sent_back' | 'rejected'
const DECISION: Record<Decision, { title: string; button: string; busy: string; done: string; tone: 'primary' | 'danger'; noteLabel: string; placeholder: string }> = {
  approved:  { title: 'Approve this doctor?', button: 'Approve', busy: 'Approving…', done: 'approved · they can sign in and be assigned patients', tone: 'primary',
    noteLabel: 'Note to the doctor (optional)', placeholder: 'e.g. Welcome to mCare.' },
  sent_back: { title: 'Send back for changes', button: 'Send back', busy: 'Sending…', done: 'sent back · they have been told what to fix', tone: 'primary',
    noteLabel: 'What needs fixing *', placeholder: 'e.g. The licence number does not match the register. Please check it.' },
  rejected:  { title: 'Reject this application', button: 'Reject', busy: 'Rejecting…', done: 'rejected · they have been told why', tone: 'danger',
    noteLabel: 'Reason *', placeholder: 'e.g. The licence could not be verified with the medical council.' },
}
const STATUS: Record<string, { color: string; label: string }> = {
  pending: { color: 'amber', label: 'Pending' }, sent_back: { color: 'blue', label: 'Sent Back' },
  rejected: { color: 'red', label: 'Rejected' }, approved: { color: 'green', label: 'Approved' },
}

/* ─── Doctor Approvals ────────────────────────────────────────────────
   A doctor cannot be assigned patients, or open any record, until someone
   who approves doctors has checked their details. Nothing is announced
   here until the decision has been saved. */
export default function ApprovalsTab() {
  const { doctors, decideDoctor, status, error, reload } = useAdmin()
  const [deciding, setDeciding] = useState<{ doctor: DoctorUser; decision: Decision } | null>(null)
  const [note, setNote] = useState('')
  const save = useSave()
  const toast = useToast()

  const waiting = doctors.filter(d => d.approvalStatus === 'pending' || d.approvalStatus === 'sent_back')
  const closed = doctors.filter(d => d.approvalStatus === 'rejected')
  const open = (doctor: DoctorUser, decision: Decision) => { save.clear(); setNote(''); setDeciding({ doctor, decision }) }
  const cfg = deciding ? DECISION[deciding.decision] : null
  const needsNote = deciding?.decision !== 'approved'
  const submit = async () => {
    if (!deciding || !cfg || (needsNote && !note.trim())) return
    if (!(await save.run(() => decideDoctor(deciding.doctor.id, deciding.decision, note.trim() || undefined))).ok) return
    toast.show(`${deciding.doctor.name} ${cfg.done}`)
    setDeciding(null)
  }

  return (
    <Page title="Doctor Approvals" meta={`${waiting.length} waiting`} status={status} error={error} onRetry={reload}>
      {toast.node && <div className="span-all">{toast.node}</div>}

      {waiting.length === 0 && (
        <div className="span-all"><EmptyState icon="✅" title="All caught up" text="No doctor applications are waiting." /></div>
      )}
      {waiting.map(d => (
        <div key={d.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-start gap-3 mb-3">
            <Avatar name={d.name} avatar={d.avatar} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900">{d.name}</p>
              <p className="text-xs text-gray-500 truncate">{d.email}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Applied {d.createdAt}</p>
            </div>
            <Pill color={STATUS[d.approvalStatus]?.color ?? 'gray'}>{STATUS[d.approvalStatus]?.label ?? d.approvalStatus}</Pill>
          </div>

          <div className="bg-gray-50 rounded-xl p-2.5 mb-3 grid grid-cols-2 gap-y-1 text-[11px]">
            <span className="text-gray-400">Licence no.</span><span className="font-semibold text-gray-800 text-right font-mono">{d.licenseNo || '—'}</span>
            <span className="text-gray-400">Specialty</span><span className="font-semibold text-gray-800 text-right">{d.specialty || '—'}</span>
            <span className="text-gray-400">Facility</span><span className="font-semibold text-gray-800 text-right truncate">{d.hospital || '—'}</span>
            <span className="text-gray-400 col-span-2 mt-1">Check the licence number with the medical council before approving. mCare does not verify it for you.</span>
          </div>

          {d.approvalNote && (
            <div className="bg-blue-50 rounded-xl p-2.5 mb-3">
              <p className="text-[9px] text-blue-500 font-semibold uppercase tracking-wide mb-0.5">What they were asked to fix</p>
              <p className="text-xs text-blue-700 leading-relaxed">{d.approvalNote}</p>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => open(d, 'approved')} className="flex-1 py-2.5 bg-teal-700 text-white text-xs font-bold rounded-xl">Approve</button>
            <button onClick={() => open(d, 'sent_back')} className="flex-1 py-2.5 bg-gray-100 text-gray-700 text-xs font-bold rounded-xl">Send Back</button>
            <button onClick={() => open(d, 'rejected')} className="flex-1 py-2.5 bg-red-50 text-red-600 text-xs font-bold rounded-xl">Reject</button>
          </div>
        </div>
      ))}

      {closed.length > 0 && (
        <details className="bg-white rounded-2xl p-4 shadow-sm">
          <summary className="text-xs font-semibold text-gray-500 cursor-pointer">Rejected applications ({closed.length})</summary>
          {closed.map(d => (
            <div key={d.id} className="mt-2 border-t border-gray-50 pt-2">
              <p className="text-xs font-semibold text-gray-800">{d.name} · {d.specialty || 'No specialty given'}</p>
              {d.approvalNote && <p className="text-[11px] text-red-600">{d.approvalNote}</p>}
            </div>
          ))}
        </details>
      )}

      <BottomSheet open={!!deciding} onClose={() => setDeciding(null)} title={cfg?.title}
        subtitle={deciding ? `${deciding.doctor.name} · licence ${deciding.doctor.licenseNo || 'not given'}` : ''}
        footer={<><SheetButton tone="ghost" onClick={() => setDeciding(null)}>Cancel</SheetButton>
          <SheetButton tone={cfg?.tone} disabled={save.busy || (needsNote && !note.trim())} onClick={submit}>{save.busy ? cfg?.busy : cfg?.button}</SheetButton></>}>
        <Field label={cfg?.noteLabel ?? ''}>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} maxLength={500} placeholder={cfg?.placeholder} className={`${inputCls} resize-none`} />
        </Field>
        <SaveError message={save.error} />
      </BottomSheet>
    </Page>
  )
}

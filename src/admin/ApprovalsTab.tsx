import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Avatar, Pill, PageTitle, BottomSheet, SheetButton, inputCls } from '@/shared'
import type { DoctorUser, ApprovalStatus } from '@/shared/lib/types'

/* ─── Doctor Approvals ──────────────────────────────────────────────── */
export default function ApprovalsTab() {
  const { getDoctors, decideDoctor } = useApp()
  const [selected, setSelected] = useState<DoctorUser | null>(null)
  const [modal, setModal] = useState<'sendback' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const [toast, setToast] = useState('')

  const doctors = getDoctors().filter(d => d.approvalStatus === 'pending' || d.approvalStatus === 'sent_back')
  const closed = getDoctors().filter(d => d.approvalStatus === 'rejected')

  const act = (id: string, status: ApprovalStatus, note?: string) => {
    if (status === 'pending') return
    decideDoctor(id, status, note)
    const msg = status === 'approved' ? 'Doctor approved!' : status === 'sent_back' ? 'Sent back for review.' : 'Application rejected.'
    setToast(msg)
    setModal(null); setReason(''); setSelected(null)
    setTimeout(() => setToast(''), 3000)
  }

  const statusCfg: Record<string, { color: string; label: string }> = {
    pending:   { color: 'amber', label: 'Pending'   },
    sent_back: { color: 'blue',  label: 'Sent Back'  },
    rejected:  { color: 'red',   label: 'Rejected'   },
    approved:  { color: 'green', label: 'Approved'   },
  }

  return (
    <div className="flex flex-col gap-4 card-flow">
      <PageTitle title="Doctor Approvals" meta={`${doctors.length} pending`} />

      {toast && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-center">
          <p className="text-xs font-semibold text-emerald-700">✓ {toast}</p>
        </div>
      )}

      {doctors.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
          <p className="text-2xl mb-2">✅</p>
          <p className="text-sm font-semibold text-gray-700">All caught up!</p>
          <p className="text-xs text-gray-400 mt-0.5">No pending doctor applications.</p>
        </div>
      ) : doctors.map(d => (
        <div key={d.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-start gap-3 mb-3">
            <Avatar name={d.name} avatar={d.avatar} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900">{d.name}</p>
              <p className="text-xs text-gray-500">{d.specialty} · {d.licenseNo}</p>
              <p className="text-xs text-gray-400 truncate">{d.hospital}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Applied: {d.createdAt}</p>
            </div>
            <Pill color={statusCfg[d.approvalStatus]?.color ?? 'gray'}>
              {statusCfg[d.approvalStatus]?.label ?? d.approvalStatus}
            </Pill>
          </div>

          <div className="bg-gray-50 rounded-xl p-2.5 mb-3 grid grid-cols-2 gap-y-1 text-[11px]">
            <span className="text-gray-400">Licence no.</span><span className="font-semibold text-gray-800 text-right">{d.licenseNo || '—'}</span>
            <span className="text-gray-400">Specialty</span><span className="font-semibold text-gray-800 text-right">{d.specialty || '—'}</span>
            <span className="text-gray-400">Facility</span><span className="font-semibold text-gray-800 text-right truncate">{d.hospital || '—'}</span>
            <span className="text-gray-400">Registered</span><span className="font-semibold text-gray-800 text-right">{d.createdAt}</span>
            <span className="text-gray-400 col-span-2 mt-1">☑ Verify the licence number with the medical council before approving.</span>
          </div>

          {d.approvalNote && (
            <div className="bg-blue-50 rounded-xl p-2.5 mb-3">
              <p className="text-[9px] text-blue-500 font-semibold uppercase tracking-wide mb-0.5">Previous Note</p>
              <p className="text-xs text-blue-700 leading-relaxed">{d.approvalNote}</p>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => act(d.id, 'approved')}
              className="flex-1 py-2.5 bg-emerald-500 text-white text-xs font-bold rounded-xl">
              Approve
            </button>
            <button onClick={() => { setSelected(d); setModal('sendback') }}
              className="flex-1 py-2.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-xl">
              Send Back
            </button>
            <button onClick={() => { setSelected(d); setModal('reject') }}
              className="flex-1 py-2.5 bg-red-50 text-red-600 text-xs font-bold rounded-xl">
              Reject
            </button>
          </div>
        </div>
      ))}

      {closed.length > 0 && (
        <details className="bg-white rounded-2xl p-4 shadow-sm">
          <summary className="text-xs font-semibold text-gray-500 cursor-pointer">Rejected applications ({closed.length})</summary>
          {closed.map(d => (
            <div key={d.id} className="mt-2 border-t border-gray-50 pt-2">
              <p className="text-xs font-semibold text-gray-800">{d.name} · {d.specialty}</p>
              {d.approvalNote && <p className="text-[11px] text-red-600">{d.approvalNote}</p>}
            </div>
          ))}
        </details>
      )}

      <BottomSheet open={!!(modal && selected)} onClose={() => { setModal(null); setSelected(null) }}
        title={modal === 'sendback' ? '📋 Send Back for Review' : '❌ Reject Application'}
        subtitle={selected ? (modal === 'sendback' ? `Tell ${selected.name} what to fix.` : `State the rejection reason for ${selected.name}.`) : ''}
        footer={<>
          <SheetButton tone="ghost" onClick={() => { setModal(null); setSelected(null) }}>Cancel</SheetButton>
          <SheetButton tone={modal === 'sendback' ? 'primary' : 'danger'} disabled={!reason.trim()}
            onClick={() => selected && reason.trim() && act(selected.id, modal === 'sendback' ? 'sent_back' : 'rejected', reason.trim())}>
            {modal === 'sendback' ? 'Send Back' : 'Reject'}
          </SheetButton>
        </>}>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={4}
          placeholder={modal === 'sendback' ? 'e.g. Medical licence document appears expired. Please upload a valid, current copy.' : 'e.g. Credentials could not be verified with Kenya Medical Council.'}
          className={`${inputCls} resize-none`} />
      </BottomSheet>
    </div>
  )
}

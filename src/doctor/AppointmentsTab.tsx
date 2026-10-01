import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Pill, PageTitle, BottomSheet, SheetButton, Field, inputCls } from '@/shared'
import type { DoctorUser, Appointment } from '@/shared/lib/types'
import { dayKey } from '@/shared/lib/vitals'
import { statusColor, fmtDate, fmtTime } from './helpers'

/* ─── Appointments ──────────────────────────────────────────────────── */
export function AppointmentsTab({ doctor }: { doctor: DoctorUser }) {
  const { appointments, updateAppointment, users } = useApp()
  const myAppts = appointments.filter(a => a.doctorId === doctor.id)
  const pending = myAppts.filter(a => a.status === 'requested')
  const others = myAppts.filter(a => a.status !== 'requested')
  type Sheet = { appt: Appointment; mode: 'approve' | 'reject' | 'reschedule' | 'complete' }
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  const valid = !sheet ? false : sheet.mode === 'reject' ? !!note.trim() : sheet.mode === 'reschedule' ? !!date && !!time : true
  const submit = () => {
    if (!sheet || !valid) return
    if (sheet.mode === 'approve') updateAppointment(sheet.appt.id, { status: 'approved', approvalNote: note.trim() || undefined })
    else if (sheet.mode === 'reject') updateAppointment(sheet.appt.id, { status: 'rejected', rejectionReason: note.trim() })
    else if (sheet.mode === 'complete') updateAppointment(sheet.appt.id, { status: 'completed', approvalNote: note.trim() || sheet.appt.approvalNote })
    else updateAppointment(sheet.appt.id, { status: 'rescheduled', rescheduledTo: fmtDate(date), rescheduledTime: fmtTime(time), rescheduledReason: note.trim() || undefined })
    setSheet(null)
  }
  const openSheet = (appt: Appointment, mode: Sheet['mode']) => { setSheet({ appt, mode }); setNote(''); setDate(''); setTime('') }

  return (
    <div className="flex flex-col gap-4 card-flow">
      <PageTitle title="Appointments" />
      {pending.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-2">📋 Pending Requests ({pending.length})</p>
          {pending.map(a => (
            <div key={a.id} className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-2">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{a.title}</p>
                  <p className="text-xs text-gray-600">{users.find(u => u.id === a.patientId)?.name}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Requested: {a.preferredDate} · {a.preferredTime}</p>
                  {a.reason && <p className="text-[11px] text-gray-500 mt-1 italic">"{a.reason}"</p>}
                </div>
                <Pill color="amber">Pending</Pill>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openSheet(a, 'approve')} className="flex-1 py-2 bg-emerald-600 text-white text-[11px] font-bold rounded-xl">✓ Approve</button>
                <button onClick={() => openSheet(a, 'reschedule')} className="flex-1 py-2 bg-teal-700 text-white text-[11px] font-bold rounded-xl">↻ Reschedule</button>
                <button onClick={() => openSheet(a, 'reject')} className="flex-1 py-2 bg-red-500 text-white text-[11px] font-bold rounded-xl">✕ Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">All Appointments</p>
          {others.map(a => (
            <div key={a.id} className="bg-white rounded-2xl p-4 shadow-sm mb-2">
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{a.title}</p>
                  <p className="text-xs text-gray-500">{users.find(u => u.id === a.patientId)?.name}</p>
                </div>
                <Pill color={statusColor(a.status)}>{a.status}</Pill>
              </div>
              <p className="text-[11px] text-gray-400">📅 {a.status === 'rescheduled' ? `${a.rescheduledTo} · ${a.rescheduledTime}` : `${a.preferredDate} · ${a.preferredTime}`}</p>
              {a.rescheduledReason && a.status === 'rescheduled' && <p className="text-[11px] text-blue-500 italic">{a.rescheduledReason}</p>}
              {a.approvalNote && <p className="text-[11px] text-emerald-600 mt-1">✓ {a.approvalNote}</p>}
              {a.rejectionReason && <p className="text-[11px] text-red-500 mt-1">✕ {a.rejectionReason}</p>}
              {(a.status === 'approved' || a.status === 'rescheduled') && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => openSheet(a, 'reschedule')} className="text-[10px] text-blue-600 font-bold border border-blue-100 rounded-full px-2.5 py-0.5">Reschedule</button>
                  <button onClick={() => openSheet(a, 'complete')} className="text-[10px] text-gray-600 font-bold border border-gray-200 rounded-full px-2.5 py-0.5">Mark completed</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {myAppts.length === 0 && (
        <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
          <p className="text-2xl mb-2">📅</p>
          <p className="text-sm font-semibold text-gray-700">No appointments yet</p>
          <p className="text-xs text-gray-400 mt-1">Appointment requests from patients will appear here.</p>
        </div>
      )}

      <BottomSheet open={!!sheet} onClose={() => setSheet(null)}
        title={sheet?.mode === 'approve' ? '✓ Approve Appointment' : sheet?.mode === 'reject' ? '✕ Reject Appointment' : sheet?.mode === 'complete' ? 'Mark Completed' : '↻ Reschedule Appointment'}
        subtitle={sheet ? `${sheet.appt.title} · ${users.find(u => u.id === sheet.appt.patientId)?.name}` : ''}
        footer={<><SheetButton tone="ghost" onClick={() => setSheet(null)}>Cancel</SheetButton>
          <SheetButton tone={sheet?.mode === 'reject' ? 'danger' : sheet?.mode === 'reschedule' ? 'primary' : 'success'} disabled={!valid} onClick={submit}>
            {sheet?.mode === 'approve' ? 'Approve' : sheet?.mode === 'reject' ? 'Reject' : sheet?.mode === 'complete' ? 'Complete' : 'Confirm'}
          </SheetButton></>}>
        {sheet?.mode === 'reschedule' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="New date *"><input type="date" min={dayKey()} value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
            <Field label="New time *"><input type="time" value={time} onChange={e => setTime(e.target.value)} className={inputCls} /></Field>
          </div>
        )}
        <Field label={sheet?.mode === 'reject' ? 'Rejection reason *' : sheet?.mode === 'complete' ? 'Visit summary (optional)' : 'Note to patient (optional)'}>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className={`${inputCls} resize-none`}
            placeholder={sheet?.mode === 'reject' ? 'e.g. Please book with the endocrinology clinic instead.' : 'e.g. Please arrive 10 minutes early.'} />
        </Field>
      </BottomSheet>
    </div>
  )
}

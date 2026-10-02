import { useState } from 'react'
import { Page, EmptyState, AddButton, Pill, BottomSheet, SheetButton, Field, SaveError, useSave, useToast, inputCls, HERO_GRADIENT } from '@/shared'
import type { Appointment } from '@/shared/lib/types'
import { dayKey } from '@/shared/lib/vitals'
import { apptWhen } from '@/shared/lib/schedule'
import { usePatient } from './usePatient'

const STATUS: Record<Appointment['status'], { label: string; color: string }> = {
  requested:   { label: 'Waiting for doctor', color: 'amber' },
  approved:    { label: 'Confirmed',          color: 'green' },
  rescheduled: { label: 'New time proposed',  color: 'blue' },
  rejected:    { label: 'Declined',           color: 'red' },
  completed:   { label: 'Completed',          color: 'gray' },
  cancelled:   { label: 'Cancelled',          color: 'gray' },
}
/** Still ahead: waiting, confirmed or being rearranged. Everything else is history. */
const isOpen = (a: Appointment) => a.status === 'requested' || a.status === 'approved' || a.status === 'rescheduled'

const EMPTY_FORM = { title: '', reason: '', date: '', time: '', location: '' }

/* ─── Appointments ────────────────────────────────────────────────────
   Upcoming visits first (the next confirmed one on top), then history.
   A patient can ask for a visit, cancel one, or accept a new time the
   doctor proposed. Confirming and declining are the doctor's. */
export function AppointmentsTab() {
  const { patient, doctors, doctorById, appointments, requestAppointment, cancelAppointment, acceptNewTime, status, error, reload } = usePatient()
  const toast = useToast()
  const save = useSave()
  const act = useSave()

  const whenOf = (a: Appointment) => apptWhen(a).at ?? 0
  const upcoming = appointments.filter(isOpen).sort((a, b) => whenOf(a) - whenOf(b))
  const history = appointments.filter(a => !isOpen(a)).sort((a, b) => whenOf(b) - whenOf(a))
  const nextConfirmed = upcoming.find(a => a.status === 'approved')

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [doctorId, setDoctorId] = useState(patient.assignedDoctorId ?? '')
  /** The appointment whose cancellation is being confirmed. */
  const [cancelling, setCancelling] = useState<Appointment | null>(null)

  const openForm = () => { setForm(EMPTY_FORM); setDoctorId(patient.assignedDoctorId ?? doctors[0]?.id ?? ''); save.clear(); setShowForm(true) }
  const ready = !!form.title.trim() && !!form.date && !!doctorId

  const submit = async () => {
    if (!ready) return
    const res = await save.run(() => requestAppointment({ doctorId, title: form.title, reason: form.reason, date: form.date, time: form.time, location: form.location }))
    if (!res.ok) return
    setShowForm(false)
    toast.show('Request sent to your doctor')
  }
  const accept = async (a: Appointment) => { if ((await act.run(() => acceptNewTime(a))).ok) toast.show('New time accepted') }
  const cancel = async () => {
    if (!cancelling) return
    if ((await act.run(() => cancelAppointment(cancelling.id))).ok) { setCancelling(null); toast.show('Appointment cancelled') }
  }

  const card = (a: Appointment) => {
    const dr = doctorById(a.doctorId)
    const w = apptWhen(a)
    const [month = '', dayNum = ''] = w.date.replace(',', '').split(' ')
    const st = STATUS[a.status]
    return (
      <div key={a.id} className="bg-white rounded-2xl px-4 py-3.5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-teal-50 flex flex-col items-center justify-center flex-shrink-0">
            <p className="text-[9px] font-bold text-teal-500 uppercase">{month}</p>
            <p className="text-lg font-black text-teal-700 leading-none font-mono">{dayNum}</p>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">{a.title}</p>
            <p className="text-xs text-gray-500 truncate">{dr?.name ?? 'Doctor'}</p>
            <p className="text-[11px] text-gray-400 truncate"><span className="font-mono">{w.time}</span>{a.location ? ` · ${a.location}` : ''}</p>
          </div>
          <div className="flex-shrink-0 self-start"><Pill color={st.color}>{st.label}</Pill></div>
        </div>
        {a.reason && <p className="text-[11px] text-gray-500 mt-2">{a.reason}</p>}
        {a.status === 'rescheduled' && (
          <div className="bg-blue-50 rounded-xl px-3 py-2 mt-2 text-[11px] text-blue-800">
            <p>You asked for <span className="line-through opacity-70">{a.preferredDate} · {a.preferredTime}</span>. Your doctor proposes <b>{w.date} · {w.time}</b>.</p>
            {a.rescheduledReason && <p className="italic mt-0.5">{a.rescheduledReason}</p>}
          </div>
        )}
        {a.status === 'approved' && a.approvalNote && <p className="text-[11px] text-gray-500 mt-2 italic">“{a.approvalNote}”</p>}
        {a.status === 'rejected' && a.rejectionReason && <p className="text-[11px] text-red-600 mt-2">{a.rejectionReason}</p>}
        {isOpen(a) && (
          <div className="flex gap-2 mt-3">
            {a.status === 'rescheduled' && (
              <button onClick={() => accept(a)} disabled={act.busy} className="flex-1 rounded-xl bg-teal-700 py-2 text-xs font-bold text-white disabled:opacity-50">Accept new time</button>
            )}
            <button onClick={() => { act.clear(); setCancelling(a) }} className="flex-1 rounded-xl border border-gray-200 bg-white py-2 text-xs font-bold text-gray-600">
              {a.status === 'rescheduled' ? 'Decline' : a.status === 'requested' ? 'Withdraw request' : 'Cancel visit'}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <Page title="Appointments" status={status} error={error} onRetry={reload}
      actions={<AddButton onClick={openForm} />}>

      {toast.node && <div className="span-all">{toast.node}</div>}
      {!cancelling && <SaveError message={act.error} className="span-all" />}

      {/* Next confirmed appointment */}
      {nextConfirmed && (() => {
        const dr = doctorById(nextConfirmed.doctorId)
        return (
          <div className="rounded-2xl overflow-hidden shadow-md span-all" style={{ background: HERO_GRADIENT }}>
            <div className="p-5">
              <Pill color="green">Confirmed · Next</Pill>
              <h3 className="text-white font-bold text-base mt-2">{nextConfirmed.title}</h3>
              <p className="text-teal-200 text-sm">{dr?.name ?? 'Doctor'} · {nextConfirmed.preferredDate} · {nextConfirmed.preferredTime}</p>
              {nextConfirmed.location && <p className="text-teal-300 text-xs mt-0.5">{nextConfirmed.location}</p>}
              {nextConfirmed.approvalNote && <p className="text-teal-200 text-xs mt-1 italic">“{nextConfirmed.approvalNote}”</p>}
            </div>
          </div>
        )
      })()}

      {appointments.length === 0 && (
        <div className="span-all">
          <EmptyState icon="📅" title="No appointments yet"
            text={doctors.length ? 'Ask your doctor for a visit: it is confirmed once they approve it.' : 'No doctors are available to book with yet.'}
            action={doctors.length ? 'Request an appointment' : undefined} onAction={openForm} />
        </div>
      )}

      {upcoming.length > 0 && <p className="span-all text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-1 -mb-2">Upcoming · {upcoming.length}</p>}
      {upcoming.map(card)}

      {history.length > 0 && <p className="span-all text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-1 -mb-2">History · {history.length}</p>}
      {history.map(card)}

      {/* Request an appointment */}
      <BottomSheet open={showForm} onClose={() => setShowForm(false)} title="Request an appointment"
        subtitle="Your doctor confirms the time, or proposes another."
        footer={<><SheetButton tone="ghost" onClick={() => setShowForm(false)}>Cancel</SheetButton>
          <SheetButton disabled={!ready || save.busy} onClick={submit}>{save.busy ? 'Sending…' : 'Send request'}</SheetButton></>}>
        <Field label="Doctor *">
          <select value={doctorId} onChange={e => setDoctorId(e.target.value)} className={inputCls} aria-label="Doctor">
            <option value="">Select doctor…</option>
            {doctors.map(d => <option key={d.id} value={d.id}>{d.name}{d.specialty ? ` · ${d.specialty}` : ''}{d.id === patient.assignedDoctorId ? ' (your doctor)' : ''}</option>)}
          </select>
        </Field>
        <Field label="What is it for? *">
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} maxLength={80}
            placeholder="e.g. Blood pressure follow-up" className={inputCls} />
        </Field>
        <Field label="Details (optional)">
          <textarea rows={2} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} maxLength={300}
            placeholder="Anything your doctor should know beforehand" className={`${inputCls} resize-none`} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Preferred date *">
            <input type="date" min={dayKey()} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Preferred time">
            <input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        <Field label="Where (optional)">
          <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} maxLength={120}
            placeholder="Hospital or clinic" className={inputCls} />
        </Field>
        <SaveError message={save.error} />
      </BottomSheet>

      {/* Confirm before cancelling */}
      <BottomSheet open={!!cancelling} onClose={() => setCancelling(null)} title="Cancel this appointment?"
        subtitle={cancelling ? `${cancelling.title} · ${apptWhen(cancelling).date}` : undefined}
        footer={<><SheetButton tone="ghost" onClick={() => setCancelling(null)}>Keep it</SheetButton>
          <SheetButton tone="danger" disabled={act.busy} onClick={cancel}>{act.busy ? 'Cancelling…' : 'Yes, cancel'}</SheetButton></>}>
        <p className="text-sm text-gray-600">Your doctor will be told. You can request a new appointment at any time.</p>
        <SaveError message={act.error} className="mt-3" />
      </BottomSheet>
    </Page>
  )
}

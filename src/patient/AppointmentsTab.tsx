import { useEffect, useState } from 'react'
import { Page, EmptyState, AddButton, Pill, BottomSheet, SheetButton, Field, SaveError, useSave, useToast, inputCls, HERO_GRADIENT, AppointmentCard, SlotPicker } from '@/shared'
import type { Appointment } from '@/shared/lib/types'
import { dayKey } from '@/shared/lib/vitals'
import { apptWhen, isOpenAppt, splitAppts } from '@/shared/lib/schedule'
import { usePatient } from './usePatient'

const EMPTY_FORM = { title: '', reason: '', date: '', time: '', location: '' }
/** `target` value that opens the request form; `new:<doctorId>` also picks the doctor. */
const NEW = 'new'

/* ─── Appointments ────────────────────────────────────────────────────
   Upcoming visits first (the next confirmed one on top), then history.
   A patient can ask for a visit, cancel one, or accept a new time the
   doctor proposed. Confirming and declining are the doctor's.
   Each visit links to what it belongs to: the alert it follows up, the
   documents filed against it, and the chat with the doctor. */
export function AppointmentsTab({ target, go }: {
  /** Where a link landed: an appointment's id (shown outlined), or "new" / "new:<doctorId>" to open the request form. */
  target?: string
  go: (tab: string, target?: string) => void
}) {
  const { patient, doctors, doctorById, appointments, requestAppointment, cancelAppointment, acceptNewTime, availabilityFor, status, error, reload } = usePatient()
  /** The chosen day has no open time with this doctor (away, or fully booked). */
  const [dayBlocked, setDayBlocked] = useState(false)
  const toast = useToast()
  const save = useSave()
  const act = useSave()

  const { upcoming, history } = splitAppts(appointments)
  const nextConfirmed = upcoming.find(a => a.status === 'approved')

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [doctorId, setDoctorId] = useState(patient.assignedDoctorId ?? '')
  /** The appointment whose cancellation is being confirmed. */
  const [cancelling, setCancelling] = useState<Appointment | null>(null)

  const openForm = (withDoctor?: string) => {
    setForm(EMPTY_FORM); setDoctorId(withDoctor || patient.assignedDoctorId || doctors[0]?.id || ''); save.clear(); setShowForm(true)
  }
  useEffect(() => { if (target?.startsWith(NEW)) openForm(target.split(':')[1]) }, [target]) // eslint-disable-line react-hooks/exhaustive-deps
  const ready = !!form.title.trim() && !!form.date && !!doctorId && !dayBlocked

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

  const quiet = 'flex-1 rounded-xl border border-gray-200 bg-white py-2 text-xs font-bold text-gray-600'
  const card = (a: Appointment) => (
    <AppointmentCard key={a.id} appt={a} viewer="patient" who={doctorById(a.doctorId)?.name ?? 'Doctor'} focused={a.id === target}
      onAlert={() => go('alerts')} onDoc={id => go('docs', id)}>
      {isOpenAppt(a) && (
        <div className="flex gap-2 mt-3">
          {a.status === 'rescheduled' && (
            <button onClick={() => accept(a)} disabled={act.busy} className="flex-1 rounded-xl bg-teal-700 py-2 text-xs font-bold text-white disabled:opacity-50">Accept new time</button>
          )}
          <button onClick={() => go('messages')} className={quiet}>Message doctor</button>
          <button onClick={() => { act.clear(); setCancelling(a) }} className={quiet}>
            {a.status === 'rescheduled' ? 'Decline' : a.status === 'requested' ? 'Withdraw' : 'Cancel visit'}
          </button>
        </div>
      )}
      {(a.status === 'rejected' || a.status === 'cancelled') && (
        <div className="flex mt-3">
          <button onClick={() => { openForm(a.doctorId); setForm(f => ({ ...f, title: a.title, reason: a.reason, location: a.location ?? '' })) }} className={quiet}>Request again</button>
        </div>
      )}
    </AppointmentCard>
  )

  return (
    <Page title="Appointments" status={status} error={error} onRetry={reload}
      actions={<AddButton onClick={() => openForm()} label="Request an appointment" />}>

      {toast.node && <div className="span-all">{toast.node}</div>}
      {!cancelling && <SaveError message={act.error} className="span-all" />}

      {/* Next confirmed appointment */}
      {nextConfirmed && (() => {
        const dr = doctorById(nextConfirmed.doctorId)
        const w = apptWhen(nextConfirmed)
        return (
          <div className="rounded-2xl overflow-hidden shadow-md span-all" style={{ background: HERO_GRADIENT }}>
            <div className="p-5">
              <Pill color="green">Confirmed · Next</Pill>
              <h3 className="text-white font-bold text-base mt-2">{nextConfirmed.title}</h3>
              <p className="text-teal-200 text-sm">{dr?.name ?? 'Doctor'} · {w.date} · {w.time}</p>
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
            action={doctors.length ? 'Request an appointment' : undefined} onAction={() => openForm()} />
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
        <div>
          <Field label="Preferred date *">
            <input type="date" min={dayKey()} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        {/* a doctor who keeps a timetable offers that day's open times; otherwise any time can be asked for */}
        <Field label="Preferred time">
          <SlotPicker doctorId={doctorId} day={form.date} value={form.time} onChange={time => setForm(f => ({ ...f, time }))} load={availabilityFor} optional onBlocked={setDayBlocked} />
        </Field>
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

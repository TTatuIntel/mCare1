import { useState } from 'react'
import { AppointmentCard, BottomSheet, SheetButton, Field, inputCls, SaveError, useSave, useToast } from '@/shared'
import type { Appointment, AppAlert } from '@/shared/lib/types'
import { dayKey } from '@/shared/lib/vitals'
import { apptWhen, apptDateLabel, apptTimeLabel, isOpenAppt } from '@/shared/lib/schedule'
import { useDoctor } from './useDoctor'

type Mode = 'approve' | 'reject' | 'reschedule' | 'complete' | 'cancel' | 'noshow'
const MODE: Record<Mode, { title: string; button: string; busy: string; done: string; noteLabel: string; placeholder: string; tone: 'primary' | 'danger' }> = {
  approve:    { title: 'Confirm appointment', button: 'Confirm visit',    busy: 'Confirming…', done: 'Visit confirmed · patient told',     noteLabel: 'Note to patient (optional)', placeholder: 'e.g. Please arrive 10 minutes early.', tone: 'primary' },
  reject:     { title: 'Decline request',     button: 'Decline',          busy: 'Declining…',  done: 'Request declined · patient told',    noteLabel: 'Reason for the patient *',   placeholder: 'e.g. Please book with the endocrinology clinic instead.', tone: 'danger' },
  reschedule: { title: 'Propose a new time',  button: 'Send new time',    busy: 'Sending…',    done: 'New time sent · waiting for patient', noteLabel: 'Why the change (optional)',  placeholder: 'e.g. I am in theatre that morning.', tone: 'primary' },
  complete:   { title: 'Mark visit completed', button: 'Mark completed',  busy: 'Saving…',     done: 'Visit completed',                    noteLabel: 'Visit summary (optional)',   placeholder: 'e.g. BP stable; continue current dose, review in 4 weeks.', tone: 'primary' },
  noshow:     { title: 'Record a missed visit', button: 'Record no-show', busy: 'Saving…',    done: 'Recorded as missed · patient told',  noteLabel: 'Note (optional)',            placeholder: 'e.g. Did not attend; phoned twice, no answer.', tone: 'danger' },
  cancel:     { title: 'Cancel visit',        button: 'Cancel visit',     busy: 'Cancelling…', done: 'Visit cancelled · patient told',     noteLabel: 'Reason for the patient *',   placeholder: 'e.g. Clinic closed that day; please request a new time.', tone: 'danger' },
}
const EMPTY_BOOKING = { patientId: '', title: '', reason: '', date: '', time: '', location: '' }

/* ─── A doctor's visits ───────────────────────────────────────────────
   One place for everything a doctor does with an appointment, so the
   Appointments tab and a patient's own Visits section behave the same:
   the card with its buttons, the answer sheet, and booking a visit.
   Every change waits for the save before it says so. */
export function useVisits(nav: {
  /** The appointment a link landed on. */
  focusId?: string
  onPatient?: (patientId: string) => void
  onAlert?: (alert: AppAlert) => void
  onDoc?: (docId: string, patientId: string) => void
} = {}) {
  const { doctor, patients, appointments: mine, nameOf, bookVisit, answerVisit } = useDoctor()
  const toast = useToast()
  const save = useSave()

  /* answering or changing one */
  const [sheet, setSheet] = useState<{ appt: Appointment; mode: Mode } | null>(null)
  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const open = (appt: Appointment, mode: Mode) => { setSheet({ appt, mode }); setNote(''); setDate(''); setTime(''); save.clear() }
  const today = dayKey()
  const needsNote = sheet?.mode === 'reject' || sheet?.mode === 'cancel'
  const valid = !!sheet && (!needsNote || !!note.trim()) && (sheet.mode !== 'reschedule' || (date >= today && !!time))
  const submit = async () => {
    if (!sheet || !valid) return
    const text = note.trim() || undefined
    const patch: Partial<Appointment> =
      sheet.mode === 'approve' ? { status: 'approved', approvalNote: text }
      : sheet.mode === 'reject' ? { status: 'rejected', rejectionReason: text }
      : sheet.mode === 'cancel' ? { status: 'cancelled', rejectionReason: text }
      : sheet.mode === 'noshow' ? { status: 'no_show', rejectionReason: text ?? 'Did not attend' }
      : sheet.mode === 'complete' ? { status: 'completed', approvalNote: text ?? sheet.appt.approvalNote }
      : { status: 'rescheduled', rescheduledTo: apptDateLabel(date), rescheduledTime: apptTimeLabel(time), rescheduledReason: text }
    if (!(await save.run(() => answerVisit(sheet.appt.id, patch))).ok) return
    toast.show(MODE[sheet.mode].done)
    setSheet(null)
  }

  /* booking one */
  const [booking, setBooking] = useState<typeof EMPTY_BOOKING | null>(null)
  /** With a patient given, the visit is for them; otherwise the doctor picks one. */
  const [lockedPatient, setLockedPatient] = useState(false)
  const book = (patientId?: string) => { setBooking({ ...EMPTY_BOOKING, patientId: patientId ?? '' }); setLockedPatient(!!patientId); save.clear() }
  const canBook = !!booking && !!booking.patientId && !!booking.title.trim() && booking.date >= today && !!booking.time
  // Two visits at the same moment is usually a slip: say so, but leave it to the doctor.
  const clash = booking?.date && booking.time
    ? mine.find(a => isOpenAppt(a) && apptWhen(a).date === apptDateLabel(booking.date) && apptWhen(a).time === apptTimeLabel(booking.time))
    : undefined
  const confirmBooking = async () => {
    if (!booking || !canBook) return
    const saved = await save.run(() => bookVisit({
      patientId: booking.patientId, title: booking.title, reason: booking.reason,
      date: apptDateLabel(booking.date), time: apptTimeLabel(booking.time), location: booking.location, ref: save.ref,
    }))
    if (!saved.ok) return
    toast.show(`Visit booked · ${nameOf(booking.patientId)} told`)
    setBooking(null)
  }

  const quiet = 'flex-1 rounded-xl border border-gray-200 bg-white py-2 text-xs font-bold text-gray-600'
  const card = (a: Appointment) => (
    <AppointmentCard key={a.id} appt={a} viewer="doctor" who={nameOf(a.patientId)} focused={a.id === nav.focusId}
      onWho={nav.onPatient && (() => nav.onPatient!(a.patientId))} onAlert={nav.onAlert}
      onDoc={nav.onDoc && (id => nav.onDoc!(id, a.patientId))}>
      {isOpenAppt(a) && (
        <div className="flex gap-2 mt-3">
          {a.status === 'requested' && <button onClick={() => open(a, 'approve')} className="flex-1 rounded-xl bg-teal-700 py-2 text-xs font-bold text-white">Confirm</button>}
          {a.status === 'approved' && <button onClick={() => open(a, 'complete')} className="flex-1 rounded-xl bg-teal-700 py-2 text-xs font-bold text-white">Completed</button>}
          <button onClick={() => open(a, 'reschedule')} className={quiet}>{a.status === 'rescheduled' ? 'Change time' : 'New time'}</button>
          {/* once the time has come, the visit either happened or was missed */}
          {a.status === 'approved' && (apptWhen(a).at ?? Infinity) <= Date.now()
            ? <button onClick={() => open(a, 'noshow')} className={`${quiet} text-red-600`}>No-show</button>
            : <button onClick={() => open(a, a.status === 'requested' ? 'reject' : 'cancel')} className={`${quiet} text-red-600`}>{a.status === 'requested' ? 'Decline' : 'Cancel'}</button>}
        </div>
      )}
    </AppointmentCard>
  )

  const m = sheet ? MODE[sheet.mode] : null
  const sheets = (
    <>
      <BottomSheet open={!!sheet} onClose={() => setSheet(null)} title={m?.title}
        subtitle={sheet ? `${sheet.appt.title} · ${nameOf(sheet.appt.patientId)} · ${apptWhen(sheet.appt).date} · ${apptWhen(sheet.appt).time}` : ''}
        footer={<><SheetButton tone="ghost" onClick={() => setSheet(null)}>Back</SheetButton>
          <SheetButton tone={m?.tone} disabled={!valid || save.busy} onClick={submit}>{save.busy ? m?.busy : m?.button}</SheetButton></>}>
        {sheet?.mode === 'reschedule' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="New date *"><input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
            <Field label="New time *"><input type="time" value={time} onChange={e => setTime(e.target.value)} className={inputCls} /></Field>
          </div>
        )}
        <Field label={m?.noteLabel ?? ''}>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={300} placeholder={m?.placeholder} className={`${inputCls} resize-none`} />
        </Field>
        {sheet?.mode === 'reschedule' && <p className="text-[11px] text-gray-500 mb-2">The visit moves only once the patient accepts the new time.</p>}
        <SaveError message={save.error} />
      </BottomSheet>

      <BottomSheet open={!!booking} onClose={() => setBooking(null)} title="Book a visit"
        subtitle="Booked as confirmed. The patient is told and sees it in their appointments."
        footer={<><SheetButton tone="ghost" onClick={() => setBooking(null)}>Cancel</SheetButton>
          <SheetButton disabled={!canBook || save.busy} onClick={confirmBooking}>{save.busy ? 'Booking…' : 'Book visit'}</SheetButton></>}>
        {booking && (
          <>
            <Field label="Patient *">
              <select value={booking.patientId} disabled={lockedPatient} onChange={e => setBooking({ ...booking, patientId: e.target.value })} className={inputCls} aria-label="Patient">
                <option value="" disabled>Choose a patient…</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="What is it for? *">
              <input value={booking.title} onChange={e => setBooking({ ...booking, title: e.target.value })} maxLength={80} placeholder="e.g. Blood pressure review" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date *"><input type="date" min={today} value={booking.date} onChange={e => setBooking({ ...booking, date: e.target.value })} className={inputCls} /></Field>
              <Field label="Time *"><input type="time" value={booking.time} onChange={e => setBooking({ ...booking, time: e.target.value })} className={inputCls} /></Field>
            </div>
            {clash && <p className="text-[11px] text-amber-800 bg-amber-50 rounded-xl px-3 py-2 mb-3">You already have “{clash.title}” with {nameOf(clash.patientId)} at that time.</p>}
            <Field label="Where (optional)">
              <input value={booking.location} onChange={e => setBooking({ ...booking, location: e.target.value })} maxLength={120} placeholder={doctor.hospital || 'Hospital or clinic'} className={inputCls} />
            </Field>
            <Field label="Details for the patient (optional)">
              <textarea value={booking.reason} onChange={e => setBooking({ ...booking, reason: e.target.value })} rows={2} maxLength={300}
                placeholder="e.g. Bring your home readings; come fasting." className={`${inputCls} resize-none`} />
            </Field>
            <SaveError message={save.error} />
          </>
        )}
      </BottomSheet>
    </>
  )

  return { mine, card, sheets, book, toast: toast.node }
}

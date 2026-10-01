import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, Field, inputCls, Pill } from '@/shared'
import type { PatientUser } from '@/shared/lib/types'
import { DAILY_MEALS, clock, countdown, apptWhen, TONE_PILL, type ScheduleItem } from '@/shared/lib/schedule'
import { useDaySchedule } from './useDaySchedule'
import { usePatient } from './usePatient'
import { LogAllSheet } from './VitalLogSheets'

/* ─── Reminder detail sheet ───────────────────────────────────────────
   Opened from a Home reminder. Shows the real record behind it (the
   prescription, meal plan, vitals or appointment) with the form to act
   on it in place: mark a dose taken, log a meal, record vitals, answer
   an appointment. */type Props = { item: ScheduleItem | null; onClose: () => void; go: (t: string) => void; onDone: (msg: string) => void }

export function ReminderSheet({ item, onClose, go, onDone }: Props) {
  const day = useDaySchedule()
  if (!item) return null
  // Prefer the live item so ticks made elsewhere show up; fall back to the
  // snapshot once it drops off the schedule (e.g. vitals just logged).
  const live = day.find(item.key) ?? item
  const props = { item: live, onClose, go, onDone }
  // keyed so each opened reminder starts with a fresh form
  return live.kind === 'med' ? <MedSheet key={live.key} {...props} />
    : live.kind === 'meal' ? <MealSheet key={live.key} {...props} />
    // vitals are logged through the same sheet as the Vitals tab
    : live.kind === 'vitals' ? <LogAllSheet key={live.key} onClose={onClose} onSaved={n => onDone(`${n} reading${n > 1 ? 's' : ''} saved`)} />
    : <ApptSheet key={live.key} {...props} />
}

type SheetProps = { item: ScheduleItem; onClose: () => void; go: (t: string) => void; onDone: (msg: string) => void }

/* ─── Small building blocks ─── */
function StatusBanner({ item }: { item: ScheduleItem }) {
  const tone = item.done ? 'bg-emerald-50 text-emerald-700' : item.tone === 'late' ? 'bg-red-50 text-red-700' : item.tone === 'soon' ? 'bg-amber-50 text-amber-800' : 'bg-teal-50 text-teal-800'
  return (
    <div className={`rounded-xl px-3 py-2.5 flex items-center gap-2 text-xs mb-3 ${tone}`}>
      <span>{item.done ? '✅' : '⏰'}</span>
      <span className="flex-1 font-medium">{item.done ? 'Done for this slot' : item.sub.split(' · ')[0]}</span>
      {!item.done && <span className="font-black">{countdown(item.inMin)}</span>}
    </div>
  )
}

function Details({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-1 mb-3">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-3 py-2 border-b border-gray-100 last:border-0 text-xs">
          <span className="text-gray-400 flex-shrink-0">{k}</span>
          <span className="text-gray-800 font-medium text-right">{v}</span>
        </div>
      ))}
    </div>
  )
}

const textareaCls = `${inputCls} resize-none`

/** Sends a note to the assigned doctor; returns false when there is no care team. */
function useCareNote() {
  const { currentUser, sendMessage } = useApp()
  const patient = currentUser as PatientUser
  return (text: string) => {
    if (!patient.assignedDoctorId || !text.trim()) return false
    sendMessage(patient.id, patient.assignedDoctorId, text.trim())
    return true
  }
}

/* ─── Medication ─── */
function MedSheet({ item, onClose, go, onDone }: SheetProps) {
  const { patient, nameOf } = usePatient()
  const day = useDaySchedule()
  const sendNote = useCareNote()
  const [note, setNote] = useState('')
  const rx = patient.prescriptions.find(r => r.id === item.refId)
  if (!rx) return null
  const slots = day.items.filter(x => x.kind === 'med' && x.refId === rx.id)
  const prescriber = nameOf(rx.doctorId, 'Your doctor')

  const submit = () => {
    day.toggle(item)
    const shared = !item.done && note.trim() && sendNote(`💊 ${rx.medication} (${clock(item.slot)} dose): ${note.trim()}`)
    onDone(item.done ? `${rx.medication} marked not taken` : `${rx.medication} taken${shared ? ' · note sent to care team' : ''}`)
    onClose()
  }

  return (
    <BottomSheet open onClose={onClose} title={`💊 ${rx.medication}`} subtitle={`${rx.dosage} · ${rx.frequency}`}
      footer={<div className="flex gap-2"><SheetButton tone="ghost" onClick={() => { onClose(); go('medicine') }}>All meds</SheetButton>
        <SheetButton tone={item.done ? 'danger' : 'success'} onClick={submit}>{item.done ? 'Undo' : 'Mark as taken'}</SheetButton></div>}>
      <StatusBanner item={item} />
      <Details rows={[
        ['Purpose', rx.purpose || '—'],
        ['Dose', rx.dosage],
        ['This dose', clock(item.slot)],
        ['Prescribed', `${prescriber} · ${rx.prescribedAt}`],
      ]} />
      {slots.length > 1 && (
        <Field label="Today's doses">
          <div className="flex flex-wrap gap-1.5">
            {slots.map(s => (
              <button key={s.key} onClick={() => day.toggle(s)} aria-pressed={s.done}
                className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full border ${s.done ? 'bg-emerald-500 text-white border-emerald-500' : s.key === item.key ? 'border-teal-400 text-teal-700 bg-teal-50' : 'border-gray-200 text-gray-600'}`}>
                {s.done ? '✓ ' : ''}{clock(s.slot)}
              </button>
            ))}
          </div>
        </Field>
      )}
      {!item.done && (
        <Field label="Side effects or problems? (optional — sent to your care team)">
          <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. felt dizzy after taking it" className={textareaCls} />
        </Field>
      )}
    </BottomSheet>
  )
}

/* ─── Meal ─── */
function MealSheet({ item, onClose, go, onDone }: SheetProps) {
  const { currentUser, mealsDone, toggleMeal } = useApp()
  const patient = currentUser as PatientUser
  const meal = DAILY_MEALS.find(m => m.id === item.refId)!
  const [asPlanned, setAsPlanned] = useState(true)
  const [ate, setAte] = useState('')
  const logged = mealsDone.find(m => m.patientId === patient.id && m.mealId === meal.id && item.done)

  const submit = () => {
    toggleMeal(patient.id, meal.id, !item.done && !asPlanned ? ate.trim() : undefined)
    onDone(item.done ? `${meal.name} un-logged` : `${meal.name} logged`)
    onClose()
  }

  return (
    <BottomSheet open onClose={onClose} title={`${meal.icon} ${meal.name}`} subtitle={`${clock(meal.at)} · ${meal.kcal} kcal planned`}
      footer={<div className="flex gap-2"><SheetButton tone="ghost" onClick={() => { onClose(); go('meals') }}>Meal plan</SheetButton>
        <SheetButton tone={item.done ? 'danger' : 'success'} disabled={!item.done && !asPlanned && !ate.trim()} onClick={submit}>
          {item.done ? 'Undo' : 'Log meal'}</SheetButton></div>}>
      <StatusBanner item={item} />
      <Details rows={[['Planned', meal.foods], ['Energy', `${meal.kcal} kcal`], ...(logged?.note ? [['You ate', logged.note] as [string, string]] : [])]} />
      {!item.done && (
        <Field label="What did you eat?">
          <div className="flex gap-2 mb-2">
            {[true, false].map(v => (
              <button key={String(v)} onClick={() => setAsPlanned(v)}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold border-2 ${asPlanned === v ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-100 bg-gray-50 text-gray-600'}`}>
                {v ? 'As planned' : 'Something else'}
              </button>
            ))}
          </div>
          {!asPlanned && <textarea rows={2} value={ate} onChange={e => setAte(e.target.value)} placeholder="e.g. ugali, sukuma wiki, tea" className={textareaCls} />}
        </Field>
      )}
    </BottomSheet>
  )
}

/* ─── Appointment ─── */
function ApptSheet({ item, onClose, go, onDone }: SheetProps) {
  const { appointments, updateAppointment } = useApp()
  const { nameOf } = usePatient()
  const sendNote = useCareNote()
  const [note, setNote] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const a = appointments.find(x => x.id === item.refId)
  if (!a) return null
  const w = apptWhen(a)
  const doctor = nameOf(a.doctorId, 'Your doctor')
  const proposed = a.status === 'rescheduled'

  const act = (fn: () => void, msg: string) => { fn(); onDone(msg); onClose() }
  const accept = () => act(() => updateAppointment(a.id, {
    status: 'approved', preferredDate: a.rescheduledTo ?? a.preferredDate, preferredTime: a.rescheduledTime ?? a.preferredTime,
  }), 'New time accepted')
  const cancel = () => act(() => updateAppointment(a.id, { status: 'cancelled' }), 'Appointment cancelled')
  const send = () => act(() => sendNote(`📅 Re: ${a.title} (${w.date} ${w.time}): ${note.trim()}`), 'Note sent to your care team')

  const footer = confirmCancel
    ? <div className="flex gap-2"><SheetButton tone="ghost" onClick={() => setConfirmCancel(false)}>Keep it</SheetButton><SheetButton tone="danger" onClick={cancel}>Yes, cancel</SheetButton></div>
    : proposed
      ? <div className="flex gap-2"><SheetButton tone="ghost" onClick={() => setConfirmCancel(true)}>Decline</SheetButton><SheetButton tone="success" onClick={accept}>Accept new time</SheetButton></div>
      : <div className="flex gap-2"><SheetButton tone="ghost" onClick={() => { onClose(); go('appts') }}>All visits</SheetButton><SheetButton disabled={!note.trim()} onClick={send}>Send note</SheetButton></div>

  return (
    <BottomSheet open onClose={onClose} title={`📅 ${a.title}`} subtitle={`${w.date} · ${w.time} · ${countdown(item.inMin)}`} footer={footer}>
      <div className="mb-3"><Pill color={TONE_PILL[item.tone]}>{proposed ? 'New time proposed' : 'Confirmed'}</Pill></div>
      {proposed && (
        <div className="bg-blue-50 rounded-xl px-3 py-2.5 mb-3 text-xs text-blue-800">
          <p><span className="line-through opacity-60">{a.preferredDate} · {a.preferredTime}</span> → <b>{w.date} · {w.time}</b></p>
          {a.rescheduledReason && <p className="mt-1 italic">{a.rescheduledReason}</p>}
        </div>
      )}
      <Details rows={[
        ['With', doctor],
        ['When', `${w.date} · ${w.time}`],
        ['Where', a.location || 'To be confirmed'],
        ['Reason', a.reason || '—'],
        ...(a.approvalNote ? [['Note', a.approvalNote] as [string, string]] : []),
      ]} />
      {confirmCancel ? (
        <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2.5">Cancel this appointment? Your doctor will be notified.</p>
      ) : !proposed && (
        <>
          <Field label="Note for your doctor (optional)">
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. I'll bring my BP log" className={textareaCls} />
          </Field>
          <button onClick={() => setConfirmCancel(true)} className="text-[11px] font-bold text-red-500">Cancel appointment</button>
        </>
      )}
    </BottomSheet>
  )
}

import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, Field, inputCls, Pill, SaveError, useSave } from '@/shared'
import type { PatientUser } from '@/shared/lib/types'
import { clock, countdown, apptWhen, TONE_PILL, type ScheduleItem } from '@/shared/lib/schedule'
import { useDaySchedule } from './useDaySchedule'
import { usePatient } from './usePatient'
import { LogAllSheet } from './VitalLogSheets'

/* ─── Reminder detail sheet ───────────────────────────────────────────
   Opened from a Home reminder. Shows the real record behind it (the
   prescription, meal plan, vitals or appointment) with the form to act
   on it in place: mark a dose taken, log a meal, record vitals, answer
   an appointment. */type Props = { item: ScheduleItem | null; onClose: () => void; go: (t: string, target?: string) => void; onDone: (msg: string) => void }

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

type SheetProps = { item: ScheduleItem; onClose: () => void; go: (t: string, target?: string) => void; onDone: (msg: string) => void }

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

/** Sends a note to the assigned doctor. Resolves false when there is no care team or it could not be sent. */
function useCareNote() {
  const { currentUser, sendMessage } = useApp()
  const patient = currentUser as PatientUser
  return async (text: string) => {
    if (!patient.assignedDoctorId || !text.trim()) return false
    return (await sendMessage(patient.id, patient.assignedDoctorId, text.trim())).ok
  }
}

/* ─── Medication ─── */
function MedSheet({ item, onClose, go, onDone }: SheetProps) {
  const { patient, nameOf } = usePatient()
  const day = useDaySchedule()
  const sendNote = useCareNote()
  const [note, setNote] = useState('')
  const save = useSave()
  const rx = patient.prescriptions.find(r => r.id === item.refId)
  if (!rx) return null
  const slots = day.items.filter(x => x.kind === 'med' && x.refId === rx.id)
  const prescriber = nameOf(rx.doctorId, 'Your doctor')

  const submit = async () => {
    const wasDone = item.done
    if (!(await save.run(() => day.toggle(item))).ok) return
    const shared = !wasDone && !!note.trim() && await sendNote(`💊 ${rx.medication} (${clock(item.slot)} dose): ${note.trim()}`)
    onDone(wasDone ? `${rx.medication} marked not taken` : `${rx.medication} taken${shared ? ' · note sent to care team' : ''}`)
    onClose()
  }

  return (
    <BottomSheet open onClose={onClose} title={`💊 ${rx.medication}`} subtitle={`${rx.dosage} · ${rx.frequency}`}
      footer={<div className="flex gap-2"><SheetButton tone="ghost" onClick={() => { onClose(); go('medicine') }}>All meds</SheetButton>
        <SheetButton tone={item.done ? 'danger' : 'success'} disabled={save.busy} onClick={submit}>{save.busy ? 'Saving…' : item.done ? 'Undo' : 'Mark as taken'}</SheetButton></div>}>
      <StatusBanner item={item} />
      <SaveError message={save.error} className="mb-3" />
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
  const { mealsDone, toggleMeal } = useApp()
  const { patient, todaysMeals } = usePatient()
  const meal = todaysMeals.meals.find(m => m.id === item.refId)
  const [asPlanned, setAsPlanned] = useState(true)
  const [ate, setAte] = useState('')
  const save = useSave()
  if (!meal) return null
  const logged = mealsDone.find(m => m.patientId === patient.id && m.mealId === meal.id && item.done)

  const submit = async () => {
    const wasDone = item.done
    if (!(await save.run(() => toggleMeal(patient.id, meal.id, !wasDone && !asPlanned ? ate.trim() : undefined))).ok) return
    onDone(wasDone ? `${meal.name} un-logged` : `${meal.name} logged`)
    onClose()
  }

  return (
    <BottomSheet open onClose={onClose} title={`${meal.icon} ${meal.name}`} subtitle={`${clock(meal.at)} · ${meal.kcal} kcal planned`}
      footer={<div className="flex gap-2"><SheetButton tone="ghost" onClick={() => { onClose(); go('meals') }}>Meal plan</SheetButton>
        <SheetButton tone={item.done ? 'danger' : 'success'} disabled={save.busy || (!item.done && !asPlanned && !ate.trim())} onClick={submit}>
          {save.busy ? 'Saving…' : item.done ? 'Undo' : 'Log meal'}</SheetButton></div>}>
      <StatusBanner item={item} />
      <SaveError message={save.error} className="mb-3" />
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
  const { nameOf, appointments, cancelAppointment, acceptNewTime } = usePatient()
  const sendNote = useCareNote()
  const [note, setNote] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const save = useSave()
  const a = appointments.find(x => x.id === item.refId)
  if (!a) return null
  const w = apptWhen(a)
  const doctor = nameOf(a.doctorId, 'Your doctor')
  const proposed = a.status === 'rescheduled'

  /** Runs the save; the sheet closes and reports only once it has gone through. */
  const finish = async (ok: boolean, msg: string) => { if (ok) { onDone(msg); onClose() } }
  const accept = async () => finish((await save.run(() => acceptNewTime(a))).ok, 'New time accepted')
  const cancel = async () => finish((await save.run(() => cancelAppointment(a.id))).ok, 'Appointment cancelled')
  const send = async () => {
    const sent = await save.run(async () => (await sendNote(`📅 Re: ${a.title} (${w.date} ${w.time}): ${note.trim()}`))
      ? { ok: true as const, value: undefined } : { ok: false as const, error: 'The note could not be sent. Check your connection and try again.' })
    await finish(sent.ok, 'Note sent to your care team')
  }

  const footer = confirmCancel
    ? <div className="flex gap-2"><SheetButton tone="ghost" onClick={() => setConfirmCancel(false)}>Keep it</SheetButton><SheetButton tone="danger" disabled={save.busy} onClick={cancel}>{save.busy ? 'Cancelling…' : 'Yes, cancel'}</SheetButton></div>
    : proposed
      ? <div className="flex gap-2"><SheetButton tone="ghost" onClick={() => setConfirmCancel(true)}>Decline</SheetButton><SheetButton tone="success" disabled={save.busy} onClick={accept}>{save.busy ? 'Saving…' : 'Accept new time'}</SheetButton></div>
      : <div className="flex gap-2"><SheetButton tone="ghost" onClick={() => { onClose(); go('appts', a.id) }}>All visits</SheetButton><SheetButton disabled={!note.trim() || save.busy} onClick={send}>{save.busy ? 'Sending…' : 'Send note'}</SheetButton></div>

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
      <SaveError message={save.error} className="mb-3" />
      {confirmCancel ? (
        <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2.5">Cancel this appointment? Your doctor will be notified.</p>
      ) : !proposed && (
        <>
          <Field label="Note for your doctor (optional)">
            <textarea rows={2} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="e.g. I'll bring my BP log" className={textareaCls} />
          </Field>
          <button onClick={() => setConfirmCancel(true)} className="text-[11px] font-bold text-red-500">Cancel appointment</button>
        </>
      )}
    </BottomSheet>
  )
}

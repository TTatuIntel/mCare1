import { useState } from 'react'
import { BackHeader, EmptyState, AppointmentCard, ChipFilter, SlotPicker, BottomSheet, SheetButton, Field, inputCls, useSave, SaveError, useToast } from '@/shared'
import type { Appointment } from '@/shared/lib/types'
import { dayKey } from '@/shared/lib/vitals'
import { apptWhen, isOpenAppt, splitAppts } from '@/shared/lib/schedule'
import { useAdmin } from './useAdmin'

type Filter = 'open' | 'requested' | 'closed' | 'all'
const FILTERS: { id: Filter; label: string; match: (a: Appointment) => boolean }[] = [
  { id: 'open',      label: 'Upcoming',     match: isOpenAppt },
  { id: 'requested', label: 'Unanswered',   match: a => a.status === 'requested' || a.status === 'rescheduled' },
  { id: 'closed',    label: 'Not attended', match: a => a.status === 'cancelled' || a.status === 'rejected' || a.status === 'no_show' },
  { id: 'all',       label: 'All',          match: () => true },
]

/* ─── Appointments (staff) ────────────────────────────────────────────
   For helping a patient or doctor who asks about a visit: find it by its
   reference, the patient or the doctor, and read what has happened to it.
   Someone who handles support can also move or cancel it for them. It is
   the same record the patient and the doctor see: both are told, with the
   reason, and the change is in its history. Confirming, declining and
   completing a visit stay with the doctor. */
export default function AppointmentsTab({ onBack }: { onBack: () => void }) {
  const { can, appointments, nameOf, updateAppointment, availabilityFor, status, error, reload } = useAdmin()
  const canChange = can('handle_support')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const toast = useToast()

  const needle = q.trim().toLowerCase()
  const active = FILTERS.find(f => f.id === filter) ?? FILTERS[0]
  const found = appointments.filter(a => active.match(a)
    && `${a.number ?? ''} ${a.title} ${nameOf(a.patientId, '')} ${nameOf(a.doctorId, '')}`.toLowerCase().includes(needle))
  const { upcoming, history } = splitAppts(found)

  /* moving or cancelling one, for the person who asked */
  const [change, setChange] = useState<{ appt: Appointment; action: 'move' | 'cancel' } | null>(null)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [blocked, setBlocked] = useState(false)
  const save = useSave()
  const open = (appt: Appointment, action: 'move' | 'cancel') => { save.clear(); setDate(''); setTime(''); setReason(''); setBlocked(false); setChange({ appt, action }) }
  const today = dayKey()
  const valid = !!change && reason.trim().length >= 5 && (change.action === 'cancel' || (date >= today && !blocked))
  const submit = async () => {
    if (!change || !valid) return
    const saved = await save.run(() => updateAppointment(change.appt.id,
      change.action === 'move' ? { action: 'move', date, time: time || undefined, reason: reason.trim() } : { action: 'cancel', reason: reason.trim() }))
    if (!saved.ok) return
    toast.show(change.action === 'move' ? 'Appointment moved · patient and doctor told' : 'Appointment cancelled · patient and doctor told')
    setChange(null)
  }
  const quiet = 'flex-1 rounded-xl border border-gray-200 bg-white py-2 text-xs font-bold text-gray-600'

  return (
    <div className="flex flex-col gap-3 card-flow">
      <BackHeader title="Appointments" subtitle={`${appointments.length} on record`} onBack={onBack} />
      {toast.node && <div className="span-all">{toast.node}</div>}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by reference, patient or doctor…" aria-label="Search appointments" className={`${inputCls} span-all`} />
      <ChipFilter label="Which appointments" tone="gray" value={filter} onChange={setFilter}
        options={FILTERS.map(f => ({ id: f.id, label: `${f.label} · ${appointments.filter(f.match).length}` }))} />

      {status === 'error' && <div className="span-all"><EmptyState icon="⚠️" title="Couldn’t load appointments" text={error} action="Try again" onAction={reload} /></div>}
      {status === 'ready' && found.length === 0 && (
        <div className="span-all">
          <EmptyState icon="📅" title={appointments.length ? 'No appointment matches' : 'No appointments yet'}
            text={appointments.length ? 'Try the reference (APT-…), or another name.' : 'Visits appear here once patients and doctors arrange them.'} />
        </div>
      )}
      {[...upcoming, ...history].map(a => (
        <AppointmentCard key={a.id} appt={a} viewer="staff" who={`${nameOf(a.patientId, 'Patient')} · with ${nameOf(a.doctorId, 'Doctor')}`}>
          {canChange && isOpenAppt(a) && (
            <div className="flex gap-2 mt-3">
              {a.status !== 'rescheduled' && <button onClick={() => open(a, 'move')} className={quiet}>Move</button>}
              <button onClick={() => open(a, 'cancel')} className={`${quiet} text-red-600`}>Cancel</button>
            </div>
          )}
        </AppointmentCard>
      ))}

      <BottomSheet open={!!change} onClose={() => setChange(null)} title={change?.action === 'move' ? 'Move this appointment' : 'Cancel this appointment'}
        subtitle={change ? `${change.appt.number ?? ''} · ${change.appt.title} · ${nameOf(change.appt.patientId, 'Patient')} with ${nameOf(change.appt.doctorId, 'Doctor')} · ${apptWhen(change.appt).date} · ${apptWhen(change.appt).time}` : ''}
        footer={<><SheetButton tone="ghost" onClick={() => setChange(null)}>Back</SheetButton>
          <SheetButton tone={change?.action === 'cancel' ? 'danger' : 'primary'} disabled={!valid || save.busy} onClick={submit}>
            {save.busy ? 'Saving…' : change?.action === 'move' ? 'Move appointment' : 'Cancel appointment'}</SheetButton></>}>
        {change?.action === 'move' && (
          <>
            <Field label="New date *"><input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
            <Field label="New time">
              <SlotPicker doctorId={change.appt.doctorId} day={date} value={time} onChange={setTime} load={availabilityFor} optional onBlocked={setBlocked} />
            </Field>
          </>
        )}
        <Field label="Reason *">
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={300} className={`${inputCls} resize-none`}
            placeholder={change?.action === 'move' ? 'e.g. The patient phoned: they cannot travel that day.' : 'e.g. The doctor has been called away.'} />
        </Field>
        <p className="text-[10px] text-gray-400 mb-2">The patient and the doctor both read this reason. Your name is kept in the appointment's history.</p>
        <SaveError message={save.error} />
      </BottomSheet>
    </div>
  )
}

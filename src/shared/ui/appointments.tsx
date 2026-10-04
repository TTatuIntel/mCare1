import { useEffect, useRef } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { Appointment, AppAlert } from '@/shared/lib/types'
import { apptWhen } from '@/shared/lib/schedule'
import { Pill } from './primitives'

/** Who is looking at the appointment: the same status reads differently to each side. */
export type ApptViewer = 'patient' | 'doctor' | 'staff'

export const APPT_STATUS: Record<ApptViewer, Record<Appointment['status'], { label: string; color: string }>> = {
  patient: {
    requested:   { label: 'Waiting for doctor', color: 'amber' },
    approved:    { label: 'Confirmed',          color: 'green' },
    rescheduled: { label: 'New time proposed',  color: 'blue' },
    rejected:    { label: 'Declined',           color: 'red' },
    completed:   { label: 'Completed',          color: 'gray' },
    cancelled:   { label: 'Cancelled',          color: 'gray' },
    no_show:     { label: 'Missed',             color: 'red' },
  },
  doctor: {
    requested:   { label: 'Needs your answer',   color: 'amber' },
    approved:    { label: 'Confirmed',           color: 'green' },
    rescheduled: { label: 'Waiting for patient', color: 'blue' },
    rejected:    { label: 'Declined',            color: 'red' },
    completed:   { label: 'Completed',           color: 'gray' },
    cancelled:   { label: 'Cancelled',           color: 'gray' },
    no_show:     { label: 'No-show',             color: 'red' },
  },
  staff: {
    requested:   { label: 'Waiting for doctor',  color: 'amber' },
    approved:    { label: 'Confirmed',           color: 'green' },
    rescheduled: { label: 'Waiting for patient', color: 'blue' },
    rejected:    { label: 'Declined',            color: 'red' },
    completed:   { label: 'Completed',           color: 'gray' },
    cancelled:   { label: 'Cancelled',           color: 'gray' },
    no_show:     { label: 'No-show',             color: 'red' },
  },
}

/** How each step of the history reads. */
const EVENT_LABEL: Record<string, string> = {
  requested: 'Requested', booked: 'Booked', approved: 'Confirmed', rescheduled: 'New time proposed',
  rejected: 'Declined', cancelled: 'Cancelled', completed: 'Completed', no_show: 'Recorded as missed', moved: 'Moved by mCare support',
}

/** What an appointment is connected to: the alert it follows up, and the documents filed against it. */
export function useApptLinks() {
  const { alerts, documentsFor } = useApp()
  return (a: Appointment) => ({
    alert: a.alertId ? alerts.find(x => x.id === a.alertId) : undefined,
    docs: documentsFor(a.patientId).map(e => e.doc).filter(d => d.links.some(l => l.kind === 'appointment' && l.id === a.id)),
  })
}

const alertLabel = (a: AppAlert) => (a.type === 'sos' ? 'SOS' : `${a.vitalName} ${a.value} ${a.unit}`.trim())
const chip = 'inline-flex items-center gap-1 max-w-full rounded-full border px-2.5 py-1 text-[11px] font-semibold'

/* ─── One appointment ─────────────────────────────────────────────────
   The same card in every portal: when, with whom, where it stands, why it
   exists (the alert it follows up) and what came out of it (documents).
   The portal passes the buttons as children. */
export function AppointmentCard({ appt: a, viewer, who, onWho, onAlert, onDoc, focused, children }: {
  appt: Appointment
  viewer: ApptViewer
  /** The other person: the doctor's name for a patient, the patient's for a doctor. */
  who: string
  /** Opens that person. */
  onWho?: () => void
  onAlert?: (alert: AppAlert) => void
  onDoc?: (docId: string) => void
  /** Arrived here through a link: scrolled into view and outlined. */
  focused?: boolean
  children?: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [focused])
  const { users } = useApp()
  const { alert, docs } = useApptLinks()(a)
  const w = apptWhen(a)
  const [month = '', dayNum = ''] = w.date.replace(',', '').split(' ')
  const st = APPT_STATUS[viewer][a.status]
  const byDoctor = a.createdBy === a.doctorId
  const origin = !a.createdBy ? 'Made'
    : viewer === 'patient' ? (byDoctor ? 'Booked by your doctor' : 'You requested this')
    : viewer === 'staff' ? (byDoctor ? 'Booked by the doctor' : 'Requested by the patient')
    : (byDoctor ? 'You booked this' : 'Requested by the patient')
  const closed = a.status === 'cancelled' || a.status === 'rejected' || a.status === 'no_show'

  return (
    <div ref={ref} className={`bg-white rounded-2xl px-4 py-3.5 shadow-sm ${focused ? 'ring-2 ring-teal-500' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center flex-shrink-0 ${closed ? 'bg-gray-100' : 'bg-teal-50'}`}>
          <p className={`text-[9px] font-bold uppercase ${closed ? 'text-gray-400' : 'text-teal-500'}`}>{month}</p>
          <p className={`text-lg font-black leading-none font-mono ${closed ? 'text-gray-400' : 'text-teal-700'}`}>{dayNum}</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{a.title}</p>
          {onWho
            ? <button onClick={onWho} className="block max-w-full text-xs font-semibold text-teal-700 truncate text-left">{who} →</button>
            : <p className="text-xs text-gray-500 truncate">{who}</p>}
          <p className="text-[11px] text-gray-400 truncate"><span className="font-mono">{w.time}</span>{a.location ? ` · ${a.location}` : ''}</p>
        </div>
        <div className="flex-shrink-0 self-start"><Pill color={st.color}>{st.label}</Pill></div>
      </div>

      {a.reason && <p className="text-[11px] text-gray-500 mt-2">{a.reason}</p>}

      {a.status === 'rescheduled' && (
        <div className="bg-blue-50 rounded-xl px-3 py-2 mt-2 text-[11px] text-blue-800">
          <p>
            {viewer === 'patient' && !byDoctor ? 'You asked for ' : 'Was '}
            <span className="line-through opacity-70">{a.preferredDate} · {a.preferredTime}</span>.{' '}
            {viewer === 'patient' ? 'Your doctor proposes ' : viewer === 'staff' ? 'The doctor proposed ' : 'You proposed '}<b>{w.date} · {w.time}</b>.
          </p>
          {a.rescheduledReason && <p className="italic mt-0.5">{a.rescheduledReason}</p>}
        </div>
      )}
      {a.approvalNote && (a.status === 'approved' || a.status === 'completed') && (
        <p className="text-[11px] text-gray-500 mt-2"><span className="font-semibold text-gray-600">{a.status === 'completed' ? 'Visit summary: ' : 'Note: '}</span>{a.approvalNote}</p>
      )}
      {closed && a.rejectionReason && <p className="text-[11px] text-red-600 mt-2">{a.rejectionReason}</p>}

      {/* what this visit is connected to */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        {alert && (
          <button onClick={onAlert && (() => onAlert(alert))} disabled={!onAlert}
            className={`${chip} ${alert.severity === 'danger' ? 'border-red-100 bg-red-50 text-red-700' : 'border-amber-100 bg-amber-50 text-amber-800'}`}>
            <span aria-hidden="true">⚠</span><span className="truncate">Follow-up to {alertLabel(alert)}</span>
          </button>
        )}
        {docs.slice(0, 2).map(d => (
          <button key={d.id} onClick={onDoc && (() => onDoc(d.id))} disabled={!onDoc} className={`${chip} border-gray-200 bg-gray-50 text-gray-700`}>
            <span aria-hidden="true">📄</span><span className="truncate">{d.title}</span>
          </button>
        ))}
        {docs.length > 2 && <span className="text-[10px] text-gray-400">+{docs.length - 2} more</span>}
        <span className="text-[10px] text-gray-400">{origin} · {a.createdAt}</span>
      </div>

      {/* the reference to quote to support, and everything that has happened to it */}
      {a.number && (
        <details className="mt-2 text-[11px]">
          <summary className="cursor-pointer select-none text-gray-400">
            <span className="font-mono font-semibold text-gray-500">{a.number}</span>{a.history?.length ? ` · History (${a.history.length})` : ''}
          </summary>
          <ol className="mt-1.5 flex flex-col gap-1.5 border-l-2 border-gray-100 pl-3">
            {(a.history ?? []).map(e => (
              <li key={e.id}>
                <p className="font-semibold text-gray-700">{EVENT_LABEL[e.action] ?? e.action}
                  <span className="font-normal text-gray-400"> · {users.find(u => u.id === e.actorId)?.name ?? 'mCare'} · {e.createdAt}</span></p>
                {e.detail && <p className="text-gray-500">{e.detail}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}

      {children}
    </div>
  )
}

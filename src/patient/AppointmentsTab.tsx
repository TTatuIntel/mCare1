import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Page, EmptyState, AddButton, Pill, HERO_GRADIENT } from '@/shared'
import { dayKey } from '@/shared/lib/vitals'
import { usePatient } from './usePatient'

/* ─── Appointments ──────────────────────────────────────────────────── */
export function AppointmentsTab() {
  const { appointments } = useApp()
  const { patient, doctors, doctorById, requestAppointment, status, error, reload } = usePatient()
  const myAppts = appointments.filter(a => a.patientId === patient.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  const nextConfirmed = myAppts.find(a => a.status === 'approved')

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', reason: '', preferredDate: '', preferredTime: '', location: '' })
  const [doctorId, setDoctorId] = useState(patient.assignedDoctorId ?? '')
  const [submitted, setSubmitted] = useState(false)

  const submitRequest = () => {
    if (!requestAppointment({ doctorId, title: form.title, reason: form.reason, date: form.preferredDate.trim(), time: form.preferredTime, location: form.location })) return
    setForm({ title: '', reason: '', preferredDate: '', preferredTime: '', location: '' })
    setShowForm(false); setSubmitted(true); setTimeout(() => setSubmitted(false), 3000)
  }

  const statusColor = (s: string) =>
    s === 'approved' ? 'green' : s === 'rejected' ? 'red' : s === 'rescheduled' ? 'blue' : s === 'completed' ? 'gray' : 'amber'

  return (
    <Page title="Appointments" status={status} error={error} onRetry={reload}
      actions={<>
        {submitted && <span className="text-[10px] text-emerald-600 font-semibold">✓ Requested</span>}
        <AddButton onClick={() => setShowForm(true)} />
      </>}>

      {/* Next confirmed appointment hero card */}
      {nextConfirmed && (() => {
        const dr = doctorById(nextConfirmed.doctorId)
        return (
          <div className="rounded-2xl overflow-hidden shadow-md"
            style={{ background: HERO_GRADIENT }}>
            <div className="p-5">
              <Pill color="green">Confirmed · Next</Pill>
              <h3 className="text-white font-bold text-base mt-2">{nextConfirmed.title}</h3>
              <p className="text-teal-200 text-sm">{dr?.name ?? 'Doctor'} · {nextConfirmed.preferredDate} · {nextConfirmed.preferredTime}</p>
              {nextConfirmed.location && <p className="text-teal-300 text-xs mt-0.5">{nextConfirmed.location}</p>}
              {nextConfirmed.approvalNote && <p className="text-teal-200 text-xs mt-1 italic">"{nextConfirmed.approvalNote}"</p>}
            </div>
          </div>
        )
      })()}

      {/* All appointments list */}
      {myAppts.length === 0 ? (
        <EmptyState icon="📅" title="No appointments yet" text="Tap + to request an appointment with your doctor." />
      ) : myAppts.map(a => {
        const dr = doctorById(a.doctorId)
        const color = statusColor(a.status)
        const dateParts = (a.status === 'rescheduled' ? a.rescheduledTo : a.preferredDate)?.split(' ') ?? ['', '']
        return (
          <div key={a.id} className="bg-white rounded-2xl px-4 py-3.5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-teal-50 flex flex-col items-center justify-center flex-shrink-0">
                <p className="text-[8px] font-bold text-teal-500 uppercase">{dateParts[0]}</p>
                <p className="text-lg font-black text-teal-700 leading-none">{dateParts[1]}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900">{a.title}</p>
                <p className="text-xs text-gray-500">{dr?.name ?? 'Doctor'} · {a.status === 'rescheduled' ? (a.rescheduledTime ?? a.preferredTime) : a.preferredTime}</p>
              </div>
              <Pill color={color}>{a.status}</Pill>
            </div>
            {a.status === 'rescheduled' && a.rescheduledReason && (
              <p className="text-[9px] text-blue-600 mt-2 ml-15 italic">{a.rescheduledReason}</p>
            )}
            {a.status === 'rejected' && a.rejectionReason && (
              <p className="text-[9px] text-red-500 mt-2 italic">✕ {a.rejectionReason}</p>
            )}
          </div>
        )
      })}

      {/* Request appointment sheet */}
      {showForm && (
        <>
          <div className="absolute inset-0 bg-black/40 z-40 sheet-fade" onClick={() => setShowForm(false)} />
          <div className="absolute bottom-0 left-0 right-0 z-50 bg-white sheet-up p-5 overflow-y-auto max-h-[85%]"
            style={{ borderRadius: '24px 24px 0 0' }}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
            <p className="text-base font-bold text-gray-900 mb-4">Request Appointment</p>
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-[9px] text-gray-400 uppercase tracking-wide mb-1">Doctor *</p>
                <select value={doctorId} onChange={e => setDoctorId(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-teal-400">
                  <option value="">Select doctor…</option>
                  {doctors.map(d => <option key={d.id} value={d.id}>{d.name} · {d.specialty}</option>)}
                </select>
              </div>
              {[
                { label: 'Title *',         key: 'title',         placeholder: 'e.g. Cardiology Follow-up' },
                { label: 'Reason',          key: 'reason',        placeholder: 'Brief reason for the visit' },
                { label: 'Preferred Date *',key: 'preferredDate', placeholder: 'e.g. Oct 15, 2026'         },
                { label: 'Preferred Time',  key: 'preferredTime', placeholder: 'e.g. 10:00 AM'             },
                { label: 'Location',        key: 'location',      placeholder: 'Hospital / clinic name'    },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <p className="text-[9px] text-gray-400 uppercase tracking-wide mb-1">{label}</p>
                  <input value={(form as Record<string, string>)[key]}
                    type={key === 'preferredDate' ? 'date' : key === 'preferredTime' ? 'time' : 'text'}
                    min={key === 'preferredDate' ? dayKey() : undefined}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-teal-400" />
                </div>
              ))}
              <div className="flex gap-2 mt-1">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 bg-gray-100 text-gray-600 text-sm font-semibold rounded-xl">Cancel</button>
                <button onClick={submitRequest}
                  disabled={!form.title.trim() || !form.preferredDate.trim() || !doctorId}
                  className={`flex-1 py-3 text-white text-sm font-bold rounded-xl ${
                    form.title.trim() && form.preferredDate.trim() && doctorId ? 'bg-teal-700' : 'bg-gray-300'
                  }`}>
                  Send Request
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </Page>
  )
}

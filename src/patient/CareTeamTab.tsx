import { useState } from 'react'
import { Avatar, Page, Pill, BottomSheet, SheetButton, SaveError, useSave, useToast, EmptyState } from '@/shared'
import { usePatient, type PublicDoctor } from './usePatient'
import { DoctorProfileSheet } from './DoctorProfileSheet'

/* ─── Care Team ─────────────────────────────────────────────────────── */
export function CareTeamTab({ go }: { go: (t: string) => void }) {
  const { patient, doctor: assignedDoctor, doctors: approvedDoctors, doctorById, requestDoctor, status, error, reload } = usePatient()

  const [showPicker, setShowPicker] = useState(false)
  const [requestedId, setRequestedId] = useState<string | null>(null)
  const [profileDoctor, setProfileDoctor] = useState<PublicDoctor | null>(null)
  const toast = useToast()
  const save = useSave()

  const submitRequest = async () => {
    if (!requestedId) return
    if (!(await save.run(() => requestDoctor(requestedId))).ok) return
    setRequestedId(null)
    setShowPicker(false)
    toast.show('Request sent. You will be told when it is reviewed.')
  }
  const openPicker = () => { setRequestedId(null); save.clear(); setShowPicker(true) }

  const req = patient.doctorRequest
  const requestedDoctor = req ? doctorById(req.doctorId) : undefined
  // The doctors a patient can ask for: everyone on the roster except the one they already have.
  const choices = approvedDoctors.filter(d => d.id !== patient.assignedDoctorId)

  return (
    <Page title="Care Team" status={status} error={error} onRetry={reload}>

      {toast.node && <div className="span-all">{toast.node}</div>}

      {/* Assigned doctor card — tappable */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Your Assigned Doctor</p>
        {assignedDoctor ? (
          <>
            <button onClick={() => setProfileDoctor(assignedDoctor)} className="w-full flex items-center gap-3 text-left">
              <Avatar name={assignedDoctor.name} avatar={assignedDoctor.avatar} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-gray-900 truncate">{assignedDoctor.name}</p>
                <p className="text-xs text-blue-600 font-semibold truncate">{assignedDoctor.specialty}</p>
                <p className="text-xs text-gray-500 truncate">{assignedDoctor.hospital}</p>
              </div>
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <Pill color="green">Active</Pill>
                <span className="text-[10px] text-teal-700 font-semibold">View profile →</span>
              </div>
            </button>
            <div className="flex gap-2 mt-3">
              <button onClick={() => go('messages')} className="flex-1 py-2.5 rounded-xl bg-teal-700 text-white text-xs font-bold">💬 Message</button>
              <button onClick={() => go('appts')} className="flex-1 py-2.5 rounded-xl bg-teal-50 text-teal-700 text-xs font-bold">📅 Book visit</button>
            </div>
          </>
        ) : (
          <div className="text-center py-5">
            <div className="w-12 h-12 bg-gray-100 rounded-full mx-auto flex items-center justify-center text-2xl mb-3">👨‍⚕️</div>
            <p className="text-sm font-semibold text-gray-700">No doctor assigned yet</p>
            <p className="text-xs text-gray-400 mt-1">Request a doctor below, or wait to be assigned one.</p>
          </div>
        )}
      </div>

      {/* Doctor request status or action */}
      {req?.status === 'pending' ? (
        <div className="rounded-2xl p-4 border bg-teal-50 border-teal-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-gray-900">Your Doctor Request</p>
            <Pill color="amber">Under Review</Pill>
          </div>
          {requestedDoctor && (
            <div className="flex items-center gap-2 bg-white rounded-xl p-2.5">
              <Avatar name={requestedDoctor.name} avatar={requestedDoctor.avatar} size="xs" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900 truncate">{requestedDoctor.name}</p>
                <p className="text-[10px] text-gray-400 truncate">{requestedDoctor.specialty} · {requestedDoctor.hospital}</p>
              </div>
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Sent: {req.requestedAt}</p>
          <p className="text-xs text-teal-700 font-medium mt-1">The care coordination team is reviewing your request. You'll be notified once a decision is made.</p>
        </div>
      ) : (
        <>
          {req?.status === 'rejected' && (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
              <p className="text-sm font-bold text-red-700 mb-1">Request not approved</p>
              {requestedDoctor && <p className="text-xs text-gray-500 mb-1">{requestedDoctor.name} · {requestedDoctor.specialty}</p>}
              {req.responseNote && (
                <p className="text-xs text-red-600 leading-relaxed bg-white rounded-xl p-2.5 border border-red-100">{req.responseNote}</p>
              )}
              <p className="text-[10px] text-red-500 mt-2">You can send a new request below.</p>
            </div>
          )}

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-1">{assignedDoctor ? 'Ask for a different doctor' : 'Request a doctor'}</p>
            <p className="text-xs text-gray-400 mb-4 leading-relaxed">
              Choose from the approved doctors. The care coordination team reviews each request and either approves it or assigns an alternative.
            </p>
            <button onClick={openPicker} disabled={choices.length === 0}
              className="w-full py-3 bg-teal-700 text-white text-sm font-bold rounded-xl disabled:bg-gray-200 disabled:text-gray-400">
              {choices.length ? 'Choose a doctor' : 'No other doctors available'}
            </button>
          </div>
        </>
      )}

      {/* Available doctors list — tappable */}
      {approvedDoctors.length === 0 ? (
        <EmptyState icon="🩺" title="No doctors yet" text="Approved doctors will be listed here." />
      ) : (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Available Doctors ({approvedDoctors.length})
          </p>
          {approvedDoctors.map(d => (
            <button key={d.id} onClick={() => setProfileDoctor(d)}
              className="w-full flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 text-left">
              <Avatar name={d.name} avatar={d.avatar} size="xs" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{d.name}</p>
                <p className="text-[10px] text-gray-400 truncate">{d.specialty} · {d.hospital}</p>
              </div>
              {d.id === patient.assignedDoctorId
                ? <Pill color="green">Your Doctor</Pill>
                : <span className="text-gray-300 text-sm" aria-hidden="true">›</span>}
            </button>
          ))}
        </div>
      )}

      {profileDoctor && (
        <DoctorProfileSheet doctor={profileDoctor} isAssigned={profileDoctor.id === patient.assignedDoctorId} onClose={() => setProfileDoctor(null)} />
      )}

      {/* Doctor picker */}
      <BottomSheet open={showPicker} onClose={() => setShowPicker(false)} title="Request a doctor"
        subtitle="Pick one. Your request goes to the care coordination team."
        footer={<><SheetButton tone="ghost" onClick={() => setShowPicker(false)}>Cancel</SheetButton>
          <SheetButton disabled={!requestedId || save.busy} onClick={submitRequest}>{save.busy ? 'Sending…' : 'Send request'}</SheetButton></>}>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Doctors">
          {choices.map(d => (
            <button key={d.id} role="radio" aria-checked={requestedId === d.id}
              onClick={() => setRequestedId(d.id === requestedId ? null : d.id)}
              className={`flex items-center gap-3 p-3 rounded-xl text-left border-2 transition-colors ${
                requestedId === d.id ? 'border-teal-400 bg-teal-50' : 'border-gray-100 bg-gray-50'}`}>
              <Avatar name={d.name} avatar={d.avatar} size="xs" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{d.name}</p>
                <p className="text-xs text-gray-500 truncate">{d.specialty} · {d.hospital}</p>
              </div>
            </button>
          ))}
        </div>
        <SaveError message={save.error} className="mt-3" />
      </BottomSheet>
    </Page>
  )
}

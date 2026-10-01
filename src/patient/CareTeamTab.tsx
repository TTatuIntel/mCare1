import { useState } from 'react'
import { Avatar, Page, Pill } from '@/shared'
import { usePatient, type PublicDoctor } from './usePatient'
import { DoctorProfileSheet } from './DoctorProfileSheet'

/* ─── Care Team ─────────────────────────────────────────────────────── */
export function CareTeamTab({ go }: { go: (t: string) => void }) {
  const { patient, doctor: assignedDoctor, doctors: approvedDoctors, doctorById, requestDoctor, status, error, reload } = usePatient()

  const [showPicker, setShowPicker] = useState(false)
  const [requestedId, setRequestedId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [profileDoctor, setProfileDoctor] = useState<PublicDoctor | null>(null)

  const submitRequest = (doctorId: string) => {
    if (!requestDoctor(doctorId)) return
    setRequestedId(null)
    setShowPicker(false)
    setToast('Request submitted! Admin will review it shortly.')
    setTimeout(() => setToast(''), 4000)
  }

  const req = patient.doctorRequest
  const requestedDoctor = req ? doctorById(req.doctorId) : undefined

  return (
    <Page title="Care Team" status={status} error={error} onRetry={reload}>

      {toast && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-center">
          <p className="text-xs font-semibold text-emerald-700">✓ {toast}</p>
        </div>
      )}

      {/* Assigned doctor card — tappable */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Your Assigned Doctor</p>
        {assignedDoctor ? (
          <button onClick={() => setProfileDoctor(assignedDoctor)} className="w-full flex items-center gap-3 text-left">
            <Avatar name={assignedDoctor.name} avatar={assignedDoctor.avatar} size="md" />
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-gray-900">{assignedDoctor.name}</p>
              <p className="text-xs text-blue-600 font-semibold">{assignedDoctor.specialty}</p>
              <p className="text-xs text-gray-500 truncate">{assignedDoctor.hospital}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{assignedDoctor.email}</p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Pill color="green">Active</Pill>
              <span className="text-[9px] text-teal-600 font-semibold">View profile →</span>
            </div>
          </button>
        ) : null}
        {assignedDoctor && (
          <div className="flex gap-2 mt-3">
            <button onClick={() => go('messages')} className="flex-1 py-2.5 rounded-xl bg-teal-700 text-white text-xs font-bold">💬 Message</button>
            <button onClick={() => go('appts')} className="flex-1 py-2.5 rounded-xl bg-teal-50 text-teal-700 text-xs font-bold">📅 Book visit</button>
          </div>
        )}
        {assignedDoctor ? null : (
          <div className="text-center py-5">
            <div className="w-12 h-12 bg-gray-100 rounded-full mx-auto flex items-center justify-center text-2xl mb-3">👨‍⚕️</div>
            <p className="text-sm font-semibold text-gray-700">No doctor assigned yet</p>
            <p className="text-xs text-gray-400 mt-1">Request a preferred doctor below or wait for admin assignment.</p>
          </div>
        )}
      </div>

      {/* Doctor request status or action */}
      {req && req.status !== 'rejected' ? (
        <div className={`rounded-2xl p-4 border ${
          req.status === 'pending' ? 'bg-teal-50 border-teal-100' : 'bg-emerald-50 border-emerald-100'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-gray-900">Your Doctor Request</p>
            <Pill color={req.status === 'pending' ? 'amber' : 'green'}>
              {req.status === 'pending' ? 'Under Review' : 'Approved'}
            </Pill>
          </div>
          {requestedDoctor && (
            <div className="flex items-center gap-2 bg-white rounded-xl p-2.5">
              <Avatar name={requestedDoctor.name} avatar={requestedDoctor.avatar} size="xs" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900">{requestedDoctor.name}</p>
                <p className="text-[10px] text-gray-400">{requestedDoctor.specialty} · {requestedDoctor.hospital}</p>
              </div>
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Submitted: {req.requestedAt}</p>
          {req.status === 'pending' && (
            <p className="text-xs text-teal-700 font-medium mt-1">
              Admin is reviewing your request. You'll be notified once a decision is made.
            </p>
          )}
        </div>
      ) : (
        <>
          {req?.status === 'rejected' && (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
              <p className="text-sm font-bold text-red-700 mb-1">Request Rejected</p>
              {requestedDoctor && <p className="text-xs text-gray-500 mb-1">{requestedDoctor.name} · {requestedDoctor.specialty}</p>}
              {req.responseNote && (
                <p className="text-xs text-red-600 leading-relaxed bg-white rounded-xl p-2.5 border border-red-100">
                  {req.responseNote}
                </p>
              )}
              <p className="text-[10px] text-red-500 mt-2">You can submit a new request below.</p>
            </div>
          )}

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-1">Request a Specific Doctor</p>
            <p className="text-xs text-gray-400 mb-4 leading-relaxed">
              You can request a preferred doctor from our approved roster. Admin will review and either approve or assign you an alternative.
            </p>
            <button onClick={() => setShowPicker(true)}
              className="w-full py-3 bg-teal-700 text-white text-sm font-bold rounded-xl">
              Choose a Doctor to Request
            </button>
          </div>
        </>
      )}

      {/* Available doctors list — tappable */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Available Doctors ({approvedDoctors.length})
        </p>
        {approvedDoctors.map(d => (
          <button key={d.id} onClick={() => setProfileDoctor(d)}
            className="w-full flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 text-left">
            <Avatar name={d.name} avatar={d.avatar} size="xs" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">{d.name}</p>
              <p className="text-[10px] text-gray-400">{d.specialty} · {d.hospital}</p>
            </div>
            {d.id === patient.assignedDoctorId
              ? <Pill color="green">Your Doctor</Pill>
              : <span className="text-gray-300 text-sm">›</span>
            }
          </button>
        ))}
      </div>

      {/* Doctor profile sheet */}
      {profileDoctor && (
        <DoctorProfileSheet
          doctor={profileDoctor}
          isAssigned={profileDoctor.id === patient.assignedDoctorId}
          onClose={() => setProfileDoctor(null)}
        />
      )}

      {/* Doctor picker sheet */}
      {showPicker && (
        <>
          <div className="absolute inset-0 bg-black/40 z-40 sheet-fade" onClick={() => setShowPicker(false)} />
          <div className="absolute bottom-0 left-0 right-0 z-50 bg-white sheet-up p-5" style={{ borderRadius: '24px 24px 0 0' }}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
            <p className="text-base font-bold text-gray-900 mb-4">Request a Doctor</p>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {approvedDoctors.map(d => (
                <button key={d.id}
                  onClick={() => setRequestedId(d.id === requestedId ? null : d.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl text-left border-2 transition-colors ${
                    requestedId === d.id ? 'border-teal-400 bg-teal-50' : 'border-gray-100 bg-gray-50'
                  }`}>
                  <Avatar name={d.name} avatar={d.avatar} size="xs" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{d.name}</p>
                    <p className="text-xs text-gray-500">{d.specialty} · {d.hospital}</p>
                  </div>
                  {d.id === patient.assignedDoctorId && (
                    <span className="text-[9px] text-teal-600 font-bold flex-shrink-0">Current</span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => { setShowPicker(false); setRequestedId(null) }}
                className="flex-1 py-3 bg-gray-100 text-gray-600 text-sm font-semibold rounded-xl">
                Cancel
              </button>
              <button onClick={() => requestedId && submitRequest(requestedId)}
                disabled={!requestedId}
                className={`flex-1 py-3 text-white text-sm font-bold rounded-xl transition-colors ${requestedId ? 'bg-teal-700' : 'bg-gray-300'}`}>
                Submit Request
              </button>
            </div>
          </div>
        </>
      )}
    </Page>
  )
}

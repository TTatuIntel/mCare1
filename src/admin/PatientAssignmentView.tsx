import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Avatar, Pill, BackHeader, useToast } from '@/shared'
import type { DoctorUser, PatientUser } from '@/shared/lib/types'
import DoctorPicker from './DoctorPicker'

export default function PatientAssignmentView({ patient, onBack }: { patient: PatientUser; onBack: () => void }) {
  const { users, assignPatientToDoctor, resolvePatientRequest } = useApp()
  const assignedDoctor = patient.assignedDoctorId ? users.find(u => u.id === patient.assignedDoctorId) as DoctorUser | undefined : undefined
  const requestedDoctor = patient.doctorRequest ? users.find(u => u.id === patient.doctorRequest!.doctorId) as DoctorUser | undefined : undefined

  const [picker, setPicker] = useState<'assign' | 'alternative' | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [showReject, setShowReject] = useState(false)
  const toast = useToast()

  const doAssign = async (doctorId: string) => {
    const alternative = picker === 'alternative'
    setPicker(null)
    if (alternative) {
      if (!(await resolvePatientRequest(patient.id, false, rejectNote.trim(), doctorId)).ok) return
      setShowReject(false); setRejectNote('')
      toast.show('Request declined and an alternative doctor assigned.')
    } else if ((await assignPatientToDoctor(patient.id, doctorId)).ok) {
      toast.show('Doctor assigned successfully.')
    }
  }

  const docCard = (d: DoctorUser, extra?: React.ReactNode) => (
    <div className="flex items-center gap-3">
      <Avatar name={d.name} avatar={d.avatar} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900">{d.name}</p>
        <p className="text-xs text-gray-500">{d.specialty}</p>
        <p className="text-[10px] text-gray-400 truncate">{d.hospital} · {d.assignedPatientIds.length} patients</p>
      </div>
      {extra}
    </div>
  )

  return (
    <div className="flex flex-col gap-4 card-flow">
      <BackHeader title={patient.name} subtitle="Care Assignment" onBack={onBack} />
      {toast.node}

      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-sm font-bold text-gray-900 mb-3">Assigned Doctor</p>
        {assignedDoctor ? docCard(assignedDoctor,
          <button onClick={() => setPicker('assign')} className="text-xs bg-blue-50 text-blue-700 font-semibold px-2.5 py-1 rounded-full flex-shrink-0">Reassign</button>)
          : (
            <div className="text-center py-4">
              <p className="text-sm text-orange-500 font-semibold mb-1">No doctor assigned</p>
              <p className="text-xs text-gray-400 mb-3">This patient's alerts go to admins until a doctor is assigned.</p>
              <button onClick={() => setPicker('assign')} className="bg-teal-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl">Assign a Doctor</button>
            </div>
          )}
        {assignedDoctor && (
          <p className="text-[11px] text-gray-400 mt-3">To remove this doctor, reassign the patient — every patient must keep a doctor.</p>
        )}
      </div>

      {patient.doctorRequest && (
        <div className={`rounded-2xl p-4 border ${patient.doctorRequest.status === 'pending' ? 'bg-teal-50 border-teal-100' : patient.doctorRequest.status === 'approved' ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-gray-900">Patient's Doctor Request</p>
            <Pill color={patient.doctorRequest.status === 'pending' ? 'teal' : patient.doctorRequest.status === 'approved' ? 'green' : 'red'}>
              {patient.doctorRequest.status.charAt(0).toUpperCase() + patient.doctorRequest.status.slice(1)}
            </Pill>
          </div>
          {requestedDoctor && <div className="mb-3">{docCard(requestedDoctor)}</div>}
          <p className="text-[10px] text-gray-400 mb-3">Requested: {patient.doctorRequest.requestedAt}</p>

          {patient.doctorRequest.status === 'pending' && (!showReject ? (
            <div className="flex gap-2">
              <button onClick={async () => { if ((await resolvePatientRequest(patient.id, true)).ok) toast.show('Request approved. Doctor assigned.') }}
                className="flex-1 py-2.5 bg-emerald-500 text-white text-xs font-bold rounded-xl">Approve Request</button>
              <button onClick={() => setShowReject(true)} className="flex-1 py-2.5 bg-red-50 text-red-600 text-xs font-bold rounded-xl">Decline</button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3}
                placeholder="Reason (e.g. Dr. Osei is at full capacity this month)"
                className="w-full bg-white border border-red-200 rounded-xl p-3 text-xs text-gray-800 outline-none resize-none" />
              <p className="text-[11px] text-red-700">Next you must choose an alternative doctor, so the patient is never left without care.</p>
              <div className="flex gap-2">
                <button onClick={() => setShowReject(false)} className="flex-1 py-2 bg-gray-100 text-gray-600 text-xs font-semibold rounded-xl">Cancel</button>
                <button onClick={() => setPicker('alternative')} disabled={!rejectNote.trim()}
                  className={`flex-1 py-2 text-white text-xs font-bold rounded-xl ${rejectNote.trim() ? 'bg-red-500' : 'bg-gray-300'}`}>Choose Alternative →</button>
              </div>
            </div>
          ))}

          {patient.doctorRequest.status === 'rejected' && patient.doctorRequest.responseNote && (
            <div className="bg-white rounded-xl p-2.5">
              <p className="text-[10px] text-red-500 font-semibold uppercase tracking-wide mb-0.5">Decline Reason</p>
              <p className="text-xs text-red-700">{patient.doctorRequest.responseNote}</p>
            </div>
          )}
        </div>
      )}

      <DoctorPicker open={!!picker} onClose={() => setPicker(null)}
        title={picker === 'alternative' ? 'Choose an Alternative Doctor' : 'Select a Doctor'}
        excludeId={picker === 'alternative' ? patient.doctorRequest?.doctorId : undefined}
        currentId={patient.assignedDoctorId} onPick={doAssign} />
    </div>
  )
}

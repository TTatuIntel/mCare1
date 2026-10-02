import { useState } from 'react'
import { Avatar, Page, EmptyState, Chevron } from '@/shared'
import type { PatientUser } from '@/shared/lib/types'
import PatientAssignmentView from './PatientAssignmentView'
import { useAdmin } from './useAdmin'

/* ─── Care assignments ────────────────────────────────────────────────
   Which doctor treats which patient. The assignment is the one link every
   access rule follows: the assigned doctor opens the patient's record, and
   nobody else's. */
export default function AssignTab() {
  const { patients: all, patient, nameOf, status, error, reload } = useAdmin()
  const [selected, setSelected] = useState<string | null>(null)
  const opened = patient(selected)
  if (opened) return <PatientAssignmentView patient={opened} onBack={() => setSelected(null)} />

  const patients = all.filter(p => p.status === 'active')
  const requests = patients.filter(p => p.doctorRequest?.status === 'pending')
  const unassigned = patients.filter(p => !p.assignedDoctorId && p.doctorRequest?.status !== 'pending')
  const assigned = patients.filter(p => p.assignedDoctorId && p.doctorRequest?.status !== 'pending')
  const row = (p: PatientUser, note: React.ReactNode) => (
    <button key={p.id} onClick={() => setSelected(p.id)}
      className="bg-white rounded-2xl px-4 py-3.5 flex items-center gap-3 shadow-sm text-left active:bg-gray-50 w-full mb-2">
      <Avatar name={p.name} avatar={p.avatar} size="xs" />
      <div className="flex-1 min-w-0"><p className="text-sm font-bold text-gray-900 truncate">{p.name}</p><p className="text-[11px] truncate">{note}</p></div>
      <Chevron />
    </button>
  )
  return (
    <Page title="Care Assignments" status={status} error={error} onRetry={reload}>
      {patients.length === 0 && <div className="span-all"><EmptyState icon="🩺" title="No active patients yet" text="A patient appears here once they have signed up." /></div>}
      {patients.length > 0 && (
        <>
          <section>
            <p className="text-[10px] font-bold text-teal-700 uppercase tracking-wider mb-2">Doctor requests ({requests.length})</p>
            {requests.length === 0 ? <p className="text-xs text-gray-400 mb-2">No requests are waiting.</p>
              : requests.map(p => row(p, <span className="text-teal-600">Asked for {nameOf(p.doctorRequest?.doctorId, 'a doctor')}</span>))}
          </section>
          <section>
            <p className="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-2">Without a doctor ({unassigned.length})</p>
            {unassigned.length === 0 ? <p className="text-xs text-gray-400 mb-2">Every active patient has a doctor.</p>
              : unassigned.map(p => row(p, <span className="text-orange-500">Needs a doctor</span>))}
          </section>
          <section>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Assigned ({assigned.length})</p>
            {assigned.length === 0 ? <p className="text-xs text-gray-400 mb-2">Nobody is assigned yet.</p>
              : assigned.map(p => row(p, <span className="text-gray-400">{nameOf(p.assignedDoctorId, 'Assigned doctor')}</span>))}
          </section>
        </>
      )}
    </Page>
  )
}

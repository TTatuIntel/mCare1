import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Avatar, PageTitle } from '@/shared'
import type { PatientUser } from '@/shared/lib/types'
import PatientAssignmentView from './PatientAssignmentView'

/* ─── Assignments tab ─────────────────────────────────────────────── */
export default function AssignTab() {
  const { getPatients, users } = useApp()
  const [selected, setSelected] = useState<string | null>(null)
  const patients = getPatients().filter(p => p.status === 'active')
  if (selected) {
    const live = patients.find(p => p.id === selected)
    if (live) return <PatientAssignmentView patient={live} onBack={() => setSelected(null)} />
  }
  const requests = patients.filter(p => p.doctorRequest?.status === 'pending')
  const unassigned = patients.filter(p => !p.assignedDoctorId && p.doctorRequest?.status !== 'pending')
  const assigned = patients.filter(p => p.assignedDoctorId && p.doctorRequest?.status !== 'pending')
  const row = (p: PatientUser, note: React.ReactNode) => (
    <button key={p.id} onClick={() => setSelected(p.id)}
      className="bg-white rounded-2xl px-4 py-3.5 flex items-center gap-3 shadow-sm text-left active:bg-gray-50 w-full mb-2">
      <Avatar name={p.name} avatar={p.avatar} size="xs" />
      <div className="flex-1 min-w-0"><p className="text-sm font-bold text-gray-900">{p.name}</p><p className="text-[11px] truncate">{note}</p></div>
      <span className="text-gray-300">›</span>
    </button>
  )
  return (
    <div className="flex flex-col gap-3 card-flow">
      <PageTitle title="Care Assignments" />
      <section>
        <p className="text-[10px] font-bold text-teal-700 uppercase tracking-wider mb-2">Doctor requests ({requests.length})</p>
        {requests.length === 0 ? <p className="text-xs text-gray-400 mb-2">No pending requests.</p>
          : requests.map(p => row(p, <span className="text-teal-600">Requested {users.find(u => u.id === p.doctorRequest?.doctorId)?.name}</span>))}
      </section>
      <section>
        <p className="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-2">Without a doctor ({unassigned.length})</p>
        {unassigned.length === 0 ? <p className="text-xs text-gray-400 mb-2">Every active patient has a doctor.</p>
          : unassigned.map(p => row(p, <span className="text-orange-500">Needs assignment</span>))}
      </section>
      <section>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Assigned ({assigned.length})</p>
        {assigned.map(p => row(p, <span className="text-gray-400">{users.find(u => u.id === p.assignedDoctorId)?.name}</span>))}
      </section>
    </div>
  )
}

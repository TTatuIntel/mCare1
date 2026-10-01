import { useState } from 'react'
import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import { PageTitle, useToast, AlertStatusPill } from '@/shared'
import { ago } from '@/shared/lib/vitals'
import type { AdminUser, PatientUser } from '@/shared/lib/types'
import DoctorPicker from './DoctorPicker'

/* ─── Alert monitor ───────────────────────────────────────────────── */
export default function AlertsMonitorTab({ admin }: { admin: AdminUser }) {
  const { alerts, users, now, notify, acknowledgeAlert, resolveAlert } = useApp()
  const [filter, setFilter] = useState<'escalated' | 'all' | 'resolved'>('escalated')
  const [reassign, setReassign] = useState<string | null>(null)
  const { assignPatientToDoctor } = useApp()
  const toast = useToast()
  const active = alerts.filter(isActiveAlert)
  const list = filter === 'escalated' ? active.filter(a => a.status === 'escalated' || a.type === 'sos')
    : filter === 'all' ? active : alerts.filter(a => a.status === 'resolved')
  const ptOf = (id: string) => users.find(u => u.id === id) as PatientUser | undefined
  return (
    <div className="flex flex-col gap-3 card-flow">
      <PageTitle title="Alert Monitor" />
      <p className="text-xs text-gray-500 -mt-2">Admins do not make clinical decisions. Chase the doctor, reassign, or close an SOS once the patient is safe.</p>
      {toast.node}
      <div className="flex bg-gray-100 rounded-xl p-[3px] gap-[2px]">
        {([['escalated', `Needs action (${active.filter(a => a.status === 'escalated' || a.type === 'sos').length})`], ['all', `All open (${active.length})`], ['resolved', 'Resolved']] as const).map(([id, l]) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`flex-1 text-[11px] px-2 py-1.5 rounded-lg font-semibold ${filter === id ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-400'}`}>{l}</button>
        ))}
      </div>
      {list.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 text-center">
          <p className="text-sm font-bold text-emerald-700">Nothing here</p>
          <p className="text-xs text-emerald-600 mt-1">No alerts in this view.</p>
        </div>
      )}
      {list.map(a => {
        const pt = ptOf(a.patientId)
        const doc = users.find(u => u.id === pt?.assignedDoctorId)
        return (
          <div key={a.id} className={`rounded-2xl p-4 border ${a.status === 'resolved' ? 'bg-gray-50 border-gray-100' : a.severity === 'danger' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">{pt?.name}</p>
                <p className={`text-sm font-black ${a.severity === 'danger' ? 'text-red-600' : 'text-amber-600'} font-mono`}>
                  {a.type === 'sos' ? `🚨 ${a.value}` : `${a.vitalName}: ${a.value} ${a.unit}`}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">Doctor: {doc?.name ?? <span className="text-orange-600 font-semibold">none assigned</span>} · {ago(a.at, now)}</p>
                {a.status === 'resolved' && <p className="text-[11px] text-emerald-700 mt-1">✓ {a.resolutionReason}{a.resolutionNote ? ` — ${a.resolutionNote}` : ''} · {users.find(u => u.id === a.resolvedBy)?.name}</p>}
              </div>
              <AlertStatusPill alert={a} />
            </div>
            {a.status !== 'resolved' && (
              <div className="flex gap-2 mt-3 flex-wrap">
                {doc && (
                  <button onClick={() => { notify(doc.id, 'escalation', `Urgent: ${pt?.name}`, `Admin ${admin.name} asks you to respond to ${a.type === 'sos' ? 'an SOS' : `${a.vitalName} ${a.value}`}`, 'alerts'); toast.show(`${doc.name} has been chased`) }}
                    className="flex-1 py-2 bg-white text-gray-700 text-[11px] font-bold rounded-xl border border-gray-200">📣 Chase doctor</button>
                )}
                <button onClick={() => setReassign(a.patientId)} className="flex-1 py-2 bg-white text-blue-700 text-[11px] font-bold rounded-xl border border-blue-100">↻ Reassign</button>
                {a.type === 'sos' && (
                  <button onClick={() => { acknowledgeAlert(a.id); resolveAlert(a.id, 'Contacted patient, condition stable', `Closed by admin ${admin.name}`) }}
                    className="flex-1 py-2 bg-emerald-600 text-white text-[11px] font-bold rounded-xl">Patient safe</button>
                )}
              </div>
            )}
          </div>
        )
      })}
      <DoctorPicker open={!!reassign} onClose={() => setReassign(null)} title="Reassign patient"
        currentId={reassign ? ptOf(reassign)?.assignedDoctorId : undefined}
        onPick={id => { if (reassign) assignPatientToDoctor(reassign, id); setReassign(null); toast.show('Patient reassigned; new doctor notified') }} />
    </div>
  )
}

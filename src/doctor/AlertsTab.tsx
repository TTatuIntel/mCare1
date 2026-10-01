import { useState } from 'react'
import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import { PageTitle, AlertStatusPill, ResolveAlertSheet } from '@/shared'
import type { DoctorUser, AppAlert } from '@/shared/lib/types'
import { AlertCard } from './AlertCard'

/* ─── Alerts ────────────────────────────────────────────────────────── */
export function AlertsTab({ doctor, openPatient }: { doctor: DoctorUser; openPatient: (id: string) => void }) {
  const { alerts, users } = useApp()
  const mine = alerts.filter(a => doctor.assignedPatientIds.includes(a.patientId))
  const active = mine.filter(isActiveAlert).sort((a, b) => (a.severity === 'danger' ? 0 : 1) - (b.severity === 'danger' ? 0 : 1) || b.at - a.at)
  const resolved = mine.filter(a => a.status === 'resolved')
  const [resolve, setResolve] = useState<AppAlert | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  return (
    <div className="flex flex-col gap-3 card-flow">
      <PageTitle title="Alerts" />
      {active.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 text-center">
          <p className="text-2xl mb-2">✅</p>
          <p className="text-sm font-bold text-emerald-700">All clear!</p>
          <p className="text-xs text-emerald-600 mt-1">No active alerts for your patients.</p>
        </div>
      )}
      {active.map(a => (
        <div key={a.id}>
          <AlertCard a={a} patientName={users.find(u => u.id === a.patientId)?.name} onResolve={setResolve} />
          <button onClick={() => openPatient(a.patientId)} className="text-[11px] text-teal-700 font-semibold mt-1 ml-1">Open patient →</button>
        </div>
      ))}

      {resolved.length > 0 && (
        <div>
          <button onClick={() => setShowResolved(v => !v)} className="text-xs text-gray-500 font-semibold mb-2">
            {showResolved ? '▾' : '▸'} Resolved history ({resolved.length})
          </button>
          {showResolved && resolved.map(a => (
            <div key={a.id} className="bg-gray-50 rounded-2xl p-3.5 mb-2 border border-gray-100">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-gray-700">{users.find(u => u.id === a.patientId)?.name} · {a.type === 'sos' ? 'SOS' : `${a.vitalName}: ${a.value} ${a.unit}`}</p>
                  <p className="text-[10px] text-gray-400">{a.loggedAt} · resolved {a.resolvedAt}</p>
                  <p className="text-[11px] text-emerald-700 mt-1">✓ {a.resolutionReason}{a.resolutionNote ? ` — ${a.resolutionNote}` : ''}</p>
                </div>
                <AlertStatusPill alert={a} />
              </div>
            </div>
          ))}
        </div>
      )}
      <ResolveAlertSheet alert={resolve} patientName={users.find(u => u.id === resolve?.patientId)?.name} onClose={() => setResolve(null)} />
    </div>
  )
}

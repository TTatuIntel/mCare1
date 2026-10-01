import { useEffect } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BackHeader } from '@/shared'
import { evaluate, latestValid } from '@/shared/lib/vitals'
import type { PatientUser } from '@/shared/lib/types'

/* ─── Patient clinical view (read-only for admin — ranges are set by the doctor) ─── */
export default function PatientThresholdView({ patient, onBack }: { patient: PatientUser; onBack: () => void }) {
  const { vitalDefs, users, logAudit } = useApp()
  const trackedVitals = vitalDefs.filter(v => patient.trackedVitalIds.includes(v.id))
  const doctor = users.find(u => u.id === patient.assignedDoctorId)
  useEffect(() => { logAudit('Viewed patient vitals', patient.name) }, [patient.id])

  return (
    <div className="flex flex-col gap-4 card-flow">
      <BackHeader title={patient.name} subtitle={patient.email} onBack={onBack}
        right={<span className="text-xs font-bold text-teal-700 flex-shrink-0">{trackedVitals.length} vitals</span>} />

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
        <p className="text-xs text-blue-800 leading-relaxed">
          Target ranges are clinical decisions set by {doctor?.name ?? 'the assigned doctor'}. Admins can view them for oversight; this view is recorded in the audit log.
        </p>
      </div>

      {trackedVitals.length === 0 ? (
        <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
          <p className="text-sm text-gray-400">No vitals assigned to this patient yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          {trackedVitals.map(v => {
            const thr = patient.thresholds[v.id]
            const last = latestValid(patient, v.id)
            const lvl = last ? evaluate(patient, v, last.value) : null
            return (
              <div key={v.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                <span className="text-lg w-7 text-center">{v.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{v.name}</p>
                  <p className="text-[11px] text-gray-400">
                    {thr ? `Doctor target ${thr.min}–${thr.max}` : `Default ${v.normalMin}–${v.normalMax}`} {v.unit}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-black ${lvl === 'critical' ? 'text-red-600' : lvl === 'warning' ? 'text-amber-600' : 'text-gray-900'} font-mono`}>{last?.value ?? '—'}</p>
                  <p className="text-[10px] text-gray-400">{last?.loggedAt ?? 'No reading'}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

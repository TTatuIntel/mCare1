import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { ProfileCard, Page, Toggle, HealthSummary } from '@/shared'
import { usePatient } from './usePatient'
import { healthGaps, type HealthSection } from '@/shared/lib/health'
import { SosSheet } from './SosSheet'
import { EmergencyContacts } from './EmergencyContacts'
import { HealthEditSheet } from './HealthEditSheet'

/* ─── Profile ───────────────────────────────────────────────────────── */
export function ProfileTab() {
  const { vitalDefs } = useApp()
  const { patient, setTrackedVitals, status, error, reload } = usePatient()
  const activeVitals = vitalDefs.filter(v => v.active)
  const [showVitalsSheet, setShowVitalsSheet] = useState(false)
  const [sos, setSos] = useState(false)
  const [editHealth, setEditHealth] = useState<HealthSection | null>(null)
  const gaps = healthGaps(patient)

  // Vitals with doctor-set thresholds are locked — patient cannot remove them
  const doctorAssignedIds = Object.keys(patient.thresholds)
  const lockedVitals = activeVitals.filter(v => doctorAssignedIds.includes(v.id))
  const optionalVitals = activeVitals.filter(v => !doctorAssignedIds.includes(v.id))

  const toggleVital = (id: string) => {
    if (doctorAssignedIds.includes(id)) return
    const next = patient.trackedVitalIds.includes(id)
      ? patient.trackedVitalIds.filter(v => v !== id)
      : [...patient.trackedVitalIds, id]
    setTrackedVitals(next)
  }

  const optionalTracked = optionalVitals.filter(v => patient.trackedVitalIds.includes(v.id)).length

  return (
    <Page title="Profile" status={status} error={error} onRetry={reload}>
      <div>
        <ProfileCard>
          {/* SOS */}
          <button onClick={() => setSos(true)}
            className="w-full rounded-2xl py-3 flex items-center justify-center gap-2 text-white font-black text-sm shadow-lg active:scale-[.98] transition-transform"
            style={{ background: 'linear-gradient(135deg,#dc2626,#ef4444)', boxShadow: '0 8px 20px rgba(220,38,38,.3)' }}>
            🚨 SOS · Get Help Now
          </button>

          {gaps.length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
              <p className="text-xs font-bold text-amber-800">Complete your health profile</p>
              <p className="text-[11px] text-amber-700 mt-0.5">Still missing: {gaps.join(', ')}.</p>
            </div>
          )}
          <HealthSummary patient={patient} onEdit={setEditHealth} />

          {/* vitals selection trigger */}
          <button
            onClick={() => setShowVitalsSheet(true)}
            className="w-full bg-white rounded-2xl p-4 shadow-sm text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">Vitals I Track</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {patient.trackedVitalIds.length} active · {lockedVitals.length} doctor-assigned
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex -space-x-1">
                  {activeVitals.filter(v => patient.trackedVitalIds.includes(v.id)).slice(0, 4).map(v => (
                    <span key={v.id} className="text-sm">{v.icon}</span>
                  ))}
                </div>
                <span className="text-gray-300 text-base">›</span>
              </div>
            </div>
          </button>
          <EmergencyContacts />
        </ProfileCard>
      </div>

      <SosSheet open={sos} onClose={() => setSos(false)} />
      {editHealth && <HealthEditSheet key={editHealth} section={editHealth} onClose={() => setEditHealth(null)} />}

      {/* Vitals bottom sheet */}
      {showVitalsSheet && (
        <>
          <div className="absolute inset-0 bg-black/40 z-40 sheet-fade" onClick={() => setShowVitalsSheet(false)} />
          <div className="absolute bottom-0 left-0 right-0 z-50 bg-white sheet-up" style={{ borderRadius: '24px 24px 0 0' }}>

            {/* Sheet header */}
            <div className="px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-base font-bold text-gray-900">Vitals I Track</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {patient.trackedVitalIds.length} of {activeVitals.length} active
                  </p>
                </div>
                <div className="flex items-center gap-1.5 bg-blue-50 px-2.5 py-1 rounded-full">
                  <span className="text-xs">🔒</span>
                  <span className="text-[10px] font-bold text-blue-600">{lockedVitals.length} Doctor Assigned</span>
                </div>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto px-5" style={{ scrollbarWidth: 'none' }}>

              {/* Doctor-assigned section */}
              {lockedVitals.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">Doctor Assigned</span>
                    <div className="flex-1 h-px bg-blue-100" />
                    <span className="text-[9px] text-blue-400">Cannot be removed</span>
                  </div>
                  <div className="bg-blue-50/60 rounded-2xl overflow-hidden">
                    {lockedVitals.map((v, i) => (
                      <div key={v.id}
                        className={`flex items-center gap-3 px-3 py-2.5 ${i < lockedVitals.length - 1 ? 'border-b border-blue-100/60' : ''}`}>
                        <span className="text-base w-6 text-center">{v.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800">{v.name}</p>
                          <p className="text-[10px] text-blue-400 font-medium">
                            {patient.thresholds[v.id]
                              ? `${patient.thresholds[v.id].min}–${patient.thresholds[v.id].max} ${v.unit}`
                              : v.unit}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 bg-blue-100 px-2 py-1 rounded-full flex-shrink-0">
                          <span className="text-[10px]">🔒</span>
                          <span className="text-[9px] font-bold text-blue-600">Locked</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Optional vitals section */}
              {optionalVitals.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Your Choices</span>
                    <div className="flex-1 h-px bg-gray-100" />
                    <span className="text-[9px] text-gray-400">{optionalTracked}/{optionalVitals.length} on</span>
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                    {optionalVitals.map((v, i) => (
                      <div key={v.id}
                        className={`flex items-center gap-3 px-3 py-2.5 ${i < optionalVitals.length - 1 ? 'border-b border-gray-50' : ''}`}>
                        <span className="text-base w-6 text-center">{v.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800">{v.name}</p>
                          <p className="text-[10px] text-gray-400">{v.unit}</p>
                        </div>
                        <Toggle on={patient.trackedVitalIds.includes(v.id)} onChange={() => toggleVital(v.id)} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No optional vitals fallback */}
              {optionalVitals.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-3">All available vitals are doctor-assigned.</p>
              )}
            </div>

            <div className="px-5 pt-3 pb-5">
              <button
                onClick={() => setShowVitalsSheet(false)}
                className="w-full py-3 bg-teal-700 text-white text-sm font-bold rounded-xl"
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </Page>
  )
}

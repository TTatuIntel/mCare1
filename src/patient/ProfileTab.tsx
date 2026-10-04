import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { ProfileCard, Page, Toggle, HealthSummary, BottomSheet, SheetButton, SaveError, useSave, useToast } from '@/shared'
import { usePatient } from './usePatient'
import { healthGaps, type HealthSection } from '@/shared/lib/health'
import { dateLabel } from '@/shared/lib/vitals'
import { RECORD_VIEW_LABELS } from '@/shared/lib/types'
import { downloadBlob } from '@/shared/documents/exporters'
import { SosSheet } from './SosSheet'
import { EmergencyContacts } from './EmergencyContacts'
import { HealthEditSheet } from './HealthEditSheet'

/* ─── Profile ───────────────────────────────────────────────────────── */
export function ProfileTab({ go }: { go?: (tab: string) => void }) {
  const { vitalDefs } = useApp()
  const { patient, doctor, consultingDoctors, live, setTrackedVitals, canStopTracking, signOutOtherDevices, recordViews, exportMyRecord, nameOf, status, error, reload } = usePatient()
  const [showViews, setShowViews] = useState(false)
  const download = useSave()
  const downloadRecord = async () => {
    const r = await download.run(exportMyRecord)
    if (!r.ok) return
    downloadBlob(new Blob([JSON.stringify(r.value, null, 2)], { type: 'application/json' }), `mcare-my-record-${new Date().toISOString().slice(0, 10)}.json`)
    toast.show('Your record was downloaded')
  }
  const activeVitals = vitalDefs.filter(v => v.active)
  const [showVitalsSheet, setShowVitalsSheet] = useState(false)
  const [sos, setSos] = useState(false)
  const [editHealth, setEditHealth] = useState<HealthSection | null>(null)
  const gaps = healthGaps(patient)
  const save = useSave()
  const session = useSave()
  const toast = useToast()

  // A vital the doctor set a target for, or any vital once a doctor is assigned, can only be removed by the doctor.
  const tracked = (id: string) => patient.trackedVitalIds.includes(id)
  const locked = (id: string) => tracked(id) && !canStopTracking(id)
  const lockedVitals = activeVitals.filter(v => locked(v.id))
  const optionalVitals = activeVitals.filter(v => !locked(v.id))

  const toggleVital = (id: string) => {
    if (locked(id)) return
    const next = tracked(id) ? patient.trackedVitalIds.filter(v => v !== id) : [...patient.trackedVitalIds, id]
    void save.run(() => setTrackedVitals(next))
  }
  const endOtherSessions = async () => {
    if ((await session.run(signOutOtherDevices)).ok) toast.show('Signed out everywhere else')
  }

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
          <button onClick={() => { save.clear(); setShowVitalsSheet(true) }} className="w-full bg-white rounded-2xl p-4 shadow-sm text-left">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">Vitals I Track</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {patient.trackedVitalIds.length} active{lockedVitals.length ? ` · ${lockedVitals.length} set by your doctor` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex -space-x-1" aria-hidden="true">
                  {activeVitals.filter(v => tracked(v.id)).slice(0, 4).map(v => (
                    <span key={v.id} className="text-sm">{v.icon}</span>
                  ))}
                </div>
                <span className="text-gray-300 text-base" aria-hidden="true">›</span>
              </div>
            </div>
          </button>
          <EmergencyContacts />

          {/* Privacy and security: who can see the record, and where the account is signed in */}
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-2">Privacy &amp; Security</p>
            <ul className="flex flex-col gap-2.5 text-xs text-gray-600">
              <li className="flex gap-2.5">
                <span aria-hidden="true">🩺</span>
                <span><b className="text-gray-900">{doctor ? doctor.name : 'No doctor yet'}</b>{doctor ? ' can see your health record and the documents you share with your care team.' : ': no doctor sees your record until one is assigned.'}
                  {consultingDoctors.length > 0 && <> {consultingDoctors.map(d => d.name).join(', ')} can read it as {consultingDoctors.length === 1 ? 'a consulting doctor' : 'consulting doctors'} (not your documents or private notes).</>}
                  {' '}mCare staff who monitor alerts can see your readings and alerts. Every opening is logged below.</span>
              </li>
              <li className="flex gap-2.5">
                <span aria-hidden="true">📄</span>
                <span>New uploads are {patient.docPrefs?.privateByDefault ? <b className="text-gray-900">kept private</b> : <b className="text-gray-900">shared with your care team</b>}.{' '}
                  {go && <button onClick={() => go('docs')} className="font-bold text-teal-700">Change in Documents</button>}</span>
              </li>
              <li className="flex gap-2.5">
                <span aria-hidden="true">🛡️</span>
                <span>mCare support staff can see that a document exists, never what it says, unless an administrator opens one for 15 minutes with a stated reason. You are told each time.</span>
              </li>
              <li className="flex gap-2.5">
                <span aria-hidden="true">👁️</span>
                <span>
                  {recordViews.length ? <>{nameOf(recordViews[0].viewerId, 'Someone at mCare')} opened your record {dateLabel(new Date(recordViews[0].at))}.</> : 'Nobody else has opened your record yet.'}{' '}
                  <button onClick={() => setShowViews(true)} className="font-bold text-teal-700">Who opened my record</button>
                </span>
              </li>
              {patient.termsAcceptedAt && (
                <li className="flex gap-2.5">
                  <span aria-hidden="true">✅</span>
                  <span>You accepted the Terms and the Privacy Policy on {dateLabel(new Date(patient.termsAcceptedAt))}.</span>
                </li>
              )}
            </ul>
            <div className="mt-3 pt-3 border-t border-gray-100">
              <button onClick={downloadRecord} disabled={download.busy}
                className="w-full rounded-xl border border-gray-200 py-2.5 text-xs font-bold text-gray-700 disabled:opacity-50">
                {download.busy ? 'Preparing…' : 'Download my record'}
              </button>
              <p className="text-[10px] text-gray-400 mt-1.5">Everything mCare holds about you, as one file you can keep or take to another clinic.</p>
              <SaveError message={download.error} className="mt-2" />
            </div>
            {live && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <button onClick={endOtherSessions} disabled={session.busy}
                  className="w-full rounded-xl border border-gray-200 py-2.5 text-xs font-bold text-gray-700 disabled:opacity-50">
                  {session.busy ? 'Signing out…' : 'Sign out of all other devices'}
                </button>
                <p className="text-[10px] text-gray-400 mt-1.5">Use this if you lost a phone or signed in on a shared computer. This device stays signed in.</p>
                <SaveError message={session.error} className="mt-2" />
                {toast.node && <div className="mt-2">{toast.node}</div>}
              </div>
            )}
          </div>
        </ProfileCard>
      </div>

      <SosSheet open={sos} onClose={() => setSos(false)} />
      <BottomSheet open={showViews} onClose={() => setShowViews(false)} title="Who opened my record"
        subtitle="Each time someone other than you opened your record on mCare, at most once every 30 minutes per person.">
        {recordViews.length === 0 ? <p className="text-xs text-gray-500">Nobody else has opened your record yet.</p> : (
          <ul className="divide-y divide-gray-100">
            {recordViews.slice(0, 100).map(v => (
              <li key={v.id} className="py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{nameOf(v.viewerId, 'Someone at mCare')}</p>
                  <p className="text-[11px] text-gray-400">{v.viewerRole === 'doctor' ? 'Doctor' : v.viewerRole === 'admin' ? 'mCare administrator' : v.viewerRole === 'assistant' ? 'mCare assistant' : 'mCare'} · {RECORD_VIEW_LABELS[v.context]}</p>
                </div>
                <span className="text-[11px] text-gray-500 flex-shrink-0">{v.createdAt}</span>
              </li>
            ))}
          </ul>
        )}
      </BottomSheet>
      {editHealth && <HealthEditSheet key={editHealth} section={editHealth} onClose={() => setEditHealth(null)} />}

      {/* Vitals I track */}
      <BottomSheet open={showVitalsSheet} onClose={() => setShowVitalsSheet(false)} title="Vitals I Track"
        subtitle={`${patient.trackedVitalIds.length} of ${activeVitals.length} active`}
        footer={<SheetButton onClick={() => setShowVitalsSheet(false)}>Done</SheetButton>}>
        <SaveError message={save.error} className="mb-3" />

        {lockedVitals.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Set by your doctor</span>
              <div className="flex-1 h-px bg-blue-100" />
              <span className="text-[10px] text-blue-400">Only your doctor removes these</span>
            </div>
            <div className="bg-blue-50/60 rounded-2xl overflow-hidden">
              {lockedVitals.map((v, i) => (
                <div key={v.id} className={`flex items-center gap-3 px-3 py-2.5 ${i < lockedVitals.length - 1 ? 'border-b border-blue-100/60' : ''}`}>
                  <span className="text-base w-6 text-center" aria-hidden="true">{v.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{v.name}</p>
                    <p className="text-[10px] text-blue-500 font-medium font-mono">
                      {patient.thresholds[v.id] ? `${patient.thresholds[v.id].min}–${patient.thresholds[v.id].max} ${v.unit}` : v.unit}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 bg-blue-100 px-2 py-1 rounded-full flex-shrink-0">
                    <span className="text-[10px]" aria-hidden="true">🔒</span>
                    <span className="text-[10px] font-bold text-blue-600">Locked</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {optionalVitals.length > 0 ? (
          <div className="mb-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Your choices</span>
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-[10px] text-gray-400">{optionalVitals.filter(v => tracked(v.id)).length}/{optionalVitals.length} on</span>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {optionalVitals.map((v, i) => (
                <div key={v.id} className={`flex items-center gap-3 px-3 py-2.5 ${i < optionalVitals.length - 1 ? 'border-b border-gray-50' : ''}`}>
                  <span className="text-base w-6 text-center" aria-hidden="true">{v.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">{v.name}</p>
                    <p className="text-[10px] text-gray-400">{v.unit}</p>
                  </div>
                  <Toggle on={tracked(v.id)} onChange={() => toggleVital(v.id)} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400 text-center py-3">Every vital you track was set by your doctor.</p>
        )}
      </BottomSheet>
    </Page>
  )
}

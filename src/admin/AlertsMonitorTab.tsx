import { useState } from 'react'
import { Page, EmptyState, Segmented, AlertStatusPill, ResolveAlertSheet, SaveError, useAct } from '@/shared'
import { ago } from '@/shared/lib/vitals'
import type { AppAlert } from '@/shared/lib/types'
import DoctorPicker from './DoctorPicker'
import { useAdmin } from './useAdmin'

type View = 'escalated' | 'all' | 'resolved'

/* ─── Alert monitor ───────────────────────────────────────────────────
   Staff who monitor patients make sure every alert gets a clinician: they
   chase the treating doctor, move the patient to a doctor who can respond,
   or close an alert once the patient is confirmed safe, giving the reason. */
export default function AlertsMonitorTab() {
  const { can, alerts, activeAlerts, patient, nameOf, chaseDoctor, assignDoctor, now, status, error, reload } = useAdmin()
  const [view, setView] = useState<View>('escalated')
  const [reassign, setReassign] = useState<string | null>(null)
  const [resolve, setResolve] = useState<AppAlert | null>(null)
  const act = useAct()
  const canAssign = can('assign_healthworkers')
  const urgent = activeAlerts.filter(a => a.status === 'escalated' || a.type === 'sos')
  const list = view === 'escalated' ? urgent : view === 'all' ? activeAlerts : alerts.filter(a => a.status === 'resolved')

  return (
    <Page title="Alert Monitor" status={status} error={error} onRetry={reload}>
      <p className="text-xs text-gray-500 -mt-2 span-all">Clinical decisions stay with the treating doctor. Chase them, reassign the patient, or close an alert once the patient is confirmed safe.</p>
      {act.node && <div className="span-all">{act.node}</div>}
      <div className="span-all">
        <Segmented label="Which alerts" value={view} onChange={setView} options={[
          { id: 'escalated', label: `Needs action (${urgent.length})` }, { id: 'all', label: `All open (${activeAlerts.length})` }, { id: 'resolved', label: 'Resolved' },
        ]} />
      </div>
      {list.length === 0 && (
        <div className="span-all">
          <EmptyState icon="✅" title={view === 'resolved' ? 'No resolved alerts yet' : 'Nothing needs action'}
            text={view === 'escalated' ? 'No escalated alerts and no open SOS.' : view === 'all' ? 'No alerts are open.' : 'Alerts that are closed stay here as history.'} />
        </div>
      )}
      {list.map(a => {
        const pt = patient(a.patientId)
        const doctorName = pt?.assignedDoctorId ? nameOf(pt.assignedDoctorId, 'Assigned doctor') : null
        return (
          <div key={a.id} className={`rounded-2xl p-4 border ${a.status === 'resolved' ? 'bg-gray-50 border-gray-100' : a.severity === 'danger' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">{pt?.name ?? 'Patient'}</p>
                <p className={`text-sm font-black ${a.severity === 'danger' ? 'text-red-600' : 'text-amber-600'} font-mono`}>
                  {a.type === 'sos' ? `🚨 ${a.value}` : `${a.vitalName}: ${a.value} ${a.unit}`}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">Doctor: {doctorName ?? <span className="text-orange-600 font-semibold">none assigned</span>} · {ago(a.at, now)}</p>
                {a.acknowledgedAt && a.status !== 'resolved' && <p className="text-[11px] text-gray-500">Acknowledged by {nameOf(a.acknowledgedBy, 'the care team')}</p>}
                {a.status === 'resolved' && <p className="text-[11px] text-emerald-700 mt-1">✓ {a.resolutionReason}{a.resolutionNote ? ` · ${a.resolutionNote}` : ''} · {nameOf(a.resolvedBy, 'care team')}</p>}
              </div>
              <AlertStatusPill alert={a} />
            </div>
            {a.status !== 'resolved' && (
              <div className="flex gap-2 mt-3 flex-wrap">
                {doctorName && (
                  <button disabled={act.busy} onClick={() => act.run(() => chaseDoctor(a.id), `${doctorName} has been chased`)}
                    className="flex-1 py-2 bg-white text-gray-700 text-[11px] font-bold rounded-xl border border-gray-200 disabled:opacity-50">📣 Chase doctor</button>
                )}
                {canAssign && (
                  <button onClick={() => { act.clear(); setReassign(a.patientId) }} className="flex-1 py-2 bg-white text-gray-700 text-[11px] font-bold rounded-xl border border-gray-200">↻ {doctorName ? 'Reassign' : 'Assign a doctor'}</button>
                )}
                {a.type === 'sos' && (
                  <button onClick={() => setResolve(a)} className="flex-1 py-2 bg-teal-700 text-white text-[11px] font-bold rounded-xl">Patient safe…</button>
                )}
              </div>
            )}
          </div>
        )
      })}
      <DoctorPicker open={!!reassign} onClose={() => setReassign(null)} title={patient(reassign)?.assignedDoctorId ? 'Reassign patient' : 'Assign a doctor'}
        currentId={patient(reassign)?.assignedDoctorId} busy={act.busy} error={<SaveError message={act.error} />}
        onPick={async id => { if (reassign && (await act.run(() => assignDoctor(reassign, id), 'Patient assigned · the doctor has been told')).ok) setReassign(null) }} />
      <ResolveAlertSheet alert={resolve} patientName={nameOf(resolve?.patientId, 'Patient')} onClose={() => setResolve(null)} />
    </Page>
  )
}

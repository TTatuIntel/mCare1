import { useState } from 'react'
import { Page, EmptyState, AlertStatusPill, ResolveAlertSheet, ChipFilter, inputCls } from '@/shared'
import type { AppAlert } from '@/shared/lib/types'
import { apptWhen } from '@/shared/lib/schedule'
import { AlertCard } from './AlertCard'
import { useDoctor } from './useDoctor'

type View = 'active' | 'resolved'

/* ─── Alerts ──────────────────────────────────────────────────────────
   What needs the doctor now, then everything already closed: an alert is
   never removed, so the history shows who acknowledged and resolved it,
   why, and the visit that was booked from it. */
export function AlertsTab({ openPatient, openAppt }: { openPatient: (id: string) => void; openAppt: (id: string) => void }) {
  const { alerts, activeAlerts, appointments, nameOf, status, error, reload } = useDoctor()
  const resolved = alerts.filter(a => a.status === 'resolved')
  const [view, setView] = useState<View>('active')
  const [q, setQ] = useState('')
  const [resolve, setResolve] = useState<AppAlert | null>(null)
  const needle = q.trim().toLowerCase()
  const history = resolved.filter(a => !needle
    || `${nameOf(a.patientId)} ${a.vitalName} ${a.resolutionReason ?? ''} ${a.resolutionNote ?? ''}`.toLowerCase().includes(needle))

  return (
    <Page title="Alerts" status={status} error={error} onRetry={reload}>
      <ChipFilter label="Which alerts" value={view} onChange={setView}
        options={[{ id: 'active', label: `Active (${activeAlerts.length})` }, { id: 'resolved', label: `Resolved (${resolved.length})` }]} />

      {view === 'active' && activeAlerts.length === 0 && (
        <div className="span-all"><EmptyState icon="✅" title="All clear" text="No active alerts for your patients." /></div>
      )}
      {view === 'active' && activeAlerts.map(a => (
        <div key={a.id}>
          <AlertCard a={a} patientName={nameOf(a.patientId)} onResolve={setResolve} />
          <button onClick={() => openPatient(a.patientId)} className="text-[11px] text-teal-700 font-semibold mt-1 ml-1">Open patient →</button>
        </div>
      ))}

      {view === 'resolved' && resolved.length > 0 && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by patient, vital or reason…" aria-label="Search resolved alerts" className={`${inputCls} span-all`} />
      )}
      {view === 'resolved' && history.length === 0 && (
        <div className="span-all"><EmptyState icon="🗂️" title={resolved.length ? 'No match' : 'No resolved alerts yet'} text={resolved.length ? 'Try another search.' : 'Alerts you resolve stay here as history.'} /></div>
      )}
      {view === 'resolved' && history.map(a => {
        // The visit booked when this alert was resolved.
        const visit = appointments.find(x => x.alertId === a.id)
        const w = visit && apptWhen(visit)
        return (
          <div key={a.id} className="bg-white rounded-2xl p-3.5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <button onClick={() => openPatient(a.patientId)} className="text-xs font-bold text-gray-900 text-left">{nameOf(a.patientId)}</button>
                <p className="text-xs text-gray-700 font-mono">{a.type === 'sos' ? `SOS · ${a.value}` : `${a.vitalName}: ${a.value} ${a.unit}`}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Raised {a.loggedAt}</p>
                {a.acknowledgedAt && <p className="text-[10px] text-gray-400">Acknowledged {a.acknowledgedAt} · {nameOf(a.acknowledgedBy, 'care team')}</p>}
                {a.escalatedAt && <p className="text-[10px] text-purple-700">Escalated {a.escalatedAt}</p>}
                <p className="text-[10px] text-gray-400">Resolved {a.resolvedAt} · {nameOf(a.resolvedBy, 'care team')}</p>
                <p className="text-[11px] text-emerald-700 mt-1">✓ {a.resolutionReason}{a.resolutionNote ? ` · ${a.resolutionNote}` : ''}</p>
                {visit && w && <button onClick={() => openAppt(visit.id)} className="mt-1 text-[11px] font-bold text-teal-700">📅 Follow-up visit · {w.date} · {w.time} →</button>}
              </div>
              <AlertStatusPill alert={a} />
            </div>
          </div>
        )
      })}
      <ResolveAlertSheet alert={resolve} patientName={nameOf(resolve?.patientId)} onClose={() => setResolve(null)} />
    </Page>
  )
}

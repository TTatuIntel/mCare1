import { useState } from 'react'
import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import { Avatar, Pill, ResolveAlertSheet, PortalHeader, HeroCard, QuickGrid, NoticeCard, NoticeRow, SectionHead } from '@/shared'
import type { DoctorUser, AppAlert } from '@/shared/lib/types'
import { ago } from '@/shared/lib/vitals'
import { isOfficial } from '@/shared/documents/documents'
import { AlertCard } from './AlertCard'
import { PatientChips } from './PatientChips'
import { useBoard } from './useBoard'

const BAND_EDGE: Record<string, string> = { red: '#ef4444', amber: '#f59e0b' }

/* ─── Dashboard ─────────────────────────────────────────────────────── */
export function DashboardTab({ doctor, goTo, openPatient }: { doctor: DoctorUser; goTo: (t: string) => void; openPatient: (id: string, section?: 'docs') => void }) {
  const { appointments, users, alerts, now, documentsFor } = useApp()
  const unsigned = documentsFor().filter(e => isOfficial(e.doc) && e.doc.status !== 'released' && (!e.doc.upload || e.doc.upload.state === 'ready'))
  const board = useBoard(doctor)
  const myIds = new Set(doctor.assignedPatientIds)
  const activeAlerts = alerts.filter(a => isActiveAlert(a) && myIds.has(a.patientId)).sort((a, b) => (a.severity === 'danger' ? 0 : 1) - (b.severity === 'danger' ? 0 : 1))
  const confirmed = appointments.filter(a => a.doctorId === doctor.id && a.status === 'approved').length
  const pendingAppts = appointments.filter(a => a.doctorId === doctor.id && a.status === 'requested')
  const unreadMsgs = board.reduce((n, b) => n + b.unread, 0)
  const atRisk = board.filter(b => b.band.color === 'red').length
  const stable = board.filter(b => b.band.color === 'green').length
  const [resolve, setResolve] = useState<AppAlert | null>(null)

  return (
    <div className="flex flex-col gap-4 card-flow">
      <PortalHeader title={doctor.name} onNavigate={goTo} onProfile={() => goTo('profile')} />

      <HeroCard
        eyebrow="Patients under care"
        value={board.length}
        caption={board.length === 0 ? 'No patients assigned yet'
          : atRisk || activeAlerts.length ? `${atRisk} high risk · ${activeAlerts.length} active alert${activeAlerts.length === 1 ? '' : 's'}`
          : 'All patients stable'}
        sideTitle="Appointments"
        side={[{ value: confirmed, label: 'confirmed' }, { value: pendingAppts.length, label: 'requests' }]}
        progress={board.length ? (stable / board.length) * 100 : 0}
      />

      <QuickGrid items={[
        { icon: '👥', label: 'Patients', onClick: () => goTo('patients'), badge: unreadMsgs },
        { icon: '🔔', label: 'Alerts', onClick: () => goTo('alerts'), badge: activeAlerts.length },
        { icon: '📅', label: 'Appts', onClick: () => goTo('appts'), badge: pendingAppts.length },
        { icon: '👤', label: 'Profile', onClick: () => goTo('profile') },
      ]} />

      {activeAlerts.length > 0 && (
        <div className="flex flex-col gap-2">
          <NoticeCard tone="red" title={`${activeAlerts.length} Active Alert${activeAlerts.length > 1 ? 's' : ''}`} action="View all →" onAction={() => goTo('alerts')} />
          {activeAlerts.slice(0, 2).map(a => (
            <AlertCard key={a.id} a={a} patientName={users.find(u => u.id === a.patientId)?.name} onResolve={setResolve} compact />
          ))}
        </div>
      )}

      {unsigned.length > 0 && (
        <NoticeCard tone="amber" pulse={false} title={`✍️ ${unsigned.length} report${unsigned.length > 1 ? 's' : ''} awaiting your signature`}>
          {unsigned.slice(0, 3).map(({ doc }) => (
            <NoticeRow key={doc.id} onClick={() => openPatient(doc.patientId, 'docs')}
              title={`${doc.title}${doc.version > 1 ? ` · v${doc.version}` : ''}`}
              sub={`${users.find(u => u.id === doc.patientId)?.name} · ${doc.status === 'signed' ? 'signed, not released' : 'draft'} · ${ago(doc.at, now)}`}
              right={<span className="text-[10px] font-bold text-amber-700">Review →</span>} />
          ))}
        </NoticeCard>
      )}

      {pendingAppts.length > 0 && (
        <NoticeCard tone="amber" pulse={false} title={`📅 ${pendingAppts.length} appointment request${pendingAppts.length > 1 ? 's' : ''} to review`}
          action="Review →" onAction={() => goTo('appts')} />
      )}

      {/* Live patient board — sorted by risk */}
      <div>
        <SectionHead title="Live Patient Board" />
        <p className="text-[10px] text-gray-400 mb-2">Sorted by risk · updates live</p>
        {board.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No patients assigned yet.</p>}
        {board.map(({ p, band, open, lastAt, unread, score }) => (
          <button key={p.id} onClick={() => openPatient(p.id)}
            className="w-full bg-white rounded-2xl px-4 py-3 shadow-sm mb-2 text-left active:bg-gray-50"
            style={{ borderLeft: `4px solid ${BAND_EDGE[band.color] ?? '#10b981'}` }}>
            <div className="flex items-center gap-3">
              <Avatar name={p.name} avatar={p.avatar} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900">{p.name}</p>
                <p className="text-[11px] text-gray-500">Last reading {lastAt ? ago(lastAt, now) : 'never'}{unread ? ` · 💬 ${unread}` : ''}</p>
              </div>
              <div className="text-right">
                <Pill color={band.color}>{band.label}</Pill>
                <p className="text-[10px] text-gray-400 mt-0.5">{open.length ? `${open.length} alert${open.length > 1 ? 's' : ''}` : `risk ${score}`}</p>
              </div>
            </div>
            <PatientChips p={p} />
          </button>
        ))}
      </div>

      <ResolveAlertSheet alert={resolve} patientName={users.find(u => u.id === resolve?.patientId)?.name} onClose={() => setResolve(null)} />
    </div>
  )
}

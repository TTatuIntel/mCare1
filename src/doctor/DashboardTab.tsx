import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Avatar, Pill, ResolveAlertSheet, PortalHeader, HeroCard, QuickGrid, NoticeCard, NoticeRow, SectionHead, EmptyState } from '@/shared'
import type { AppAlert, AppNotification } from '@/shared/lib/types'
import { ago, dateLabel } from '@/shared/lib/vitals'
import { apptWhen } from '@/shared/lib/schedule'
import { isOfficial } from '@/shared/documents/documents'
import { AlertCard } from './AlertCard'
import { PatientChips } from './PatientChips'
import { useBoard } from './useBoard'
import { useDoctor } from './useDoctor'

const BAND_EDGE: Record<string, string> = { red: 'border-red-500', amber: 'border-amber-500' }

/* ─── Dashboard ───────────────────────────────────────────────────────
   Every figure here is counted from the doctor's own records: nothing is
   a fixed number. */
export function DashboardTab({ goTo, openPatient, openAppt }: {
  goTo: (t: string, about?: AppNotification['resource']) => void
  openPatient: (id: string, section?: 'docs' | 'vitals') => void
  openAppt: (id: string) => void
}) {
  const { documentsFor } = useApp()
  const { doctor, appointments, activeAlerts, nameOf, now, patients, unreviewedOf } = useDoctor()
  // Readings nobody has reviewed yet, by patient (abnormal ones also raised alerts above).
  const toReview = patients.map(p => ({ p, n: unreviewedOf(p.id).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n)
  const unsigned = documentsFor().filter(e => isOfficial(e.doc) && e.doc.status !== 'released' && (!e.doc.upload || e.doc.upload.state === 'ready'))
  const board = useBoard()
  const confirmed = appointments.filter(a => a.status === 'approved').length
  const pendingAppts = appointments.filter(a => a.status === 'requested')
  // Confirmed visits still ahead, soonest first.
  const today = dateLabel()
  const nextVisits = appointments.filter(a => a.status === 'approved')
    .map(a => ({ a, w: apptWhen(a) }))
    .filter(x => x.w.date === today || (x.w.at ?? 0) >= now)
    .sort((x, y) => (x.w.at ?? 0) - (y.w.at ?? 0))
  const visitsToday = nextVisits.filter(x => x.w.date === today).length
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
        { icon: '👥', label: 'Patients', onClick: () => goTo('patients') },
        { icon: '💬', label: 'Messages', onClick: () => goTo('messages'), badge: unreadMsgs },
        { icon: '🔔', label: 'Alerts', onClick: () => goTo('alerts'), badge: activeAlerts.length },
        { icon: '📅', label: 'Appts', onClick: () => goTo('appts'), badge: pendingAppts.length },
      ]} />

      {activeAlerts.length > 0 && (
        <div className="flex flex-col gap-2">
          <NoticeCard tone="red" title={`${activeAlerts.length} Active Alert${activeAlerts.length > 1 ? 's' : ''}`} action="View all →" onAction={() => goTo('alerts')} />
          {activeAlerts.slice(0, 2).map(a => (
            <AlertCard key={a.id} a={a} patientName={nameOf(a.patientId)} onResolve={setResolve} compact />
          ))}
        </div>
      )}

      {toReview.length > 0 && (
        <NoticeCard tone="teal" pulse={false} title={`🔎 Readings to review · ${toReview.length} patient${toReview.length > 1 ? 's' : ''}`}>
          {toReview.slice(0, 3).map(({ p, n }) => (
            <NoticeRow key={p.id} onClick={() => openPatient(p.id, 'vitals')} title={p.name}
              sub={`${n} new reading${n > 1 ? 's' : ''} since your last review`}
              right={<span className="text-[10px] font-bold text-teal-700">Review →</span>} />
          ))}
        </NoticeCard>
      )}

      {unsigned.length > 0 && (
        <NoticeCard tone="amber" pulse={false} title={`✍️ ${unsigned.length} report${unsigned.length > 1 ? 's' : ''} awaiting your signature`}>
          {unsigned.slice(0, 3).map(({ doc }) => (
            <NoticeRow key={doc.id} onClick={() => openPatient(doc.patientId, 'docs')}
              title={`${doc.title}${doc.version > 1 ? ` · v${doc.version}` : ''}`}
              sub={`${nameOf(doc.patientId)} · ${doc.status === 'signed' ? 'signed, not released' : 'draft'} · ${ago(doc.at, now)}`}
              right={<span className="text-[10px] font-bold text-amber-700">Review →</span>} />
          ))}
        </NoticeCard>
      )}

      {pendingAppts.length > 0 && (
        <NoticeCard tone="amber" pulse={false} title={`📅 ${pendingAppts.length} appointment request${pendingAppts.length > 1 ? 's' : ''} to review`}
          action="Review all →" onAction={() => goTo('appts')}>
          {pendingAppts.slice(0, 3).map(a => (
            <NoticeRow key={a.id} onClick={() => openAppt(a.id)} title={a.title}
              sub={`${nameOf(a.patientId)} · asks for ${a.preferredDate} · ${a.preferredTime}`}
              right={<span className="text-[10px] font-bold text-amber-700">Answer →</span>} />
          ))}
        </NoticeCard>
      )}

      {nextVisits.length > 0 && (
        <NoticeCard tone="teal" pulse={false} title={visitsToday ? `📅 ${visitsToday} visit${visitsToday > 1 ? 's' : ''} today` : '📅 Next visits'}
          action="All visits →" onAction={() => goTo('appts')}>
          {nextVisits.slice(0, 3).map(({ a, w }) => (
            <NoticeRow key={a.id} onClick={() => openAppt(a.id)} title={`${nameOf(a.patientId)} · ${a.title}`}
              sub={`${w.date === today ? 'Today' : w.date} · ${w.time}${a.location ? ` · ${a.location}` : ''}`}
              right={<span className="text-[10px] font-bold text-teal-700">Open →</span>} />
          ))}
        </NoticeCard>
      )}

      {/* Patient board, sorted by risk */}
      <div>
        <SectionHead title="Patient Board" />
        <p className="text-[10px] text-gray-400 mb-2">Most urgent first</p>
        {board.length === 0 && <EmptyState icon="👥" title="No patients assigned yet" text="A patient appears here once the care coordination team assigns them to you." />}
        {board.map(({ p, band, open, lastAt, unread, score }) => (
          <button key={p.id} onClick={() => openPatient(p.id)}
            className={`w-full bg-white rounded-2xl px-4 py-3 shadow-sm mb-2 text-left active:bg-gray-50 border-l-4 ${BAND_EDGE[band.color] ?? 'border-emerald-500'}`}>
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

      <ResolveAlertSheet alert={resolve} patientName={nameOf(resolve?.patientId)} onClose={() => setResolve(null)} />
    </div>
  )
}

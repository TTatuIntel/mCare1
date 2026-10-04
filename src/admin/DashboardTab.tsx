import { useApp } from '@/shared/state/AppContext'
import { Pill, PortalHeader, HeroCard, QuickGrid, NoticeCard, NoticeRow } from '@/shared'
import { ago } from '@/shared/lib/vitals'
import { PermissionsCard } from '@/assistant/PermissionsCard'
import { useAdmin } from './useAdmin'

const DAY = 86_400_000

/* ─── Dashboard ───────────────────────────────────────────────────────
   What is true now, and what is waiting for someone. Every figure is
   counted from the records this person may see; an assistant without a
   permission does not get the tile or the notice that needs it. */
export default function DashboardTab({ go }: { go: (t: string) => void }) {
  const { documentsFor } = useApp()
  const { admin, can, patients, doctors, staff, invitations, alerts, activeAlerts, supportTickets, nameOf, now } = useAdmin()
  const escalated = activeAlerts.filter(a => a.status === 'escalated')
  const sos = activeAlerts.filter(a => a.type === 'sos')
  const urgent = [...sos, ...escalated.filter(a => a.type !== 'sos')]
  const canMonitor = can('monitor_patients')
  const canAssign = can('assign_healthworkers', 'approve_patient_requests')
  const canApprove = can('approve_doctors')
  const canLogs = can('view_logs')
  const canDocs = can('document_support')
  const canAppts = can('monitor_patients', 'handle_support')
  const canSupport = can('handle_support')
  const canCreate = can('create_users')
  const docEntries = documentsFor(undefined, { allVersions: true })
  const docIssues = docEntries.filter(e => e.doc.upload?.state === 'failed' || (e.doc.origin !== 'patient_upload' && e.doc.status !== 'released' && now - e.doc.at > DAY)).length
  const pendingDrs = doctors.filter(d => d.approvalStatus === 'pending' || d.approvalStatus === 'sent_back')
  const pendingPatientReqs = patients.filter(p => p.doctorRequest?.status === 'pending')
  const unassignedPatients = patients.filter(p => p.status === 'active' && !p.assignedDoctorId)
  const activeToday = patients.filter(p => p.readings.some(r => r.at && now - r.at < DAY)).length
  const openTickets = supportTickets.filter(t => t.status === 'open')
  const s = (n: number) => (n === 1 ? '' : 's')

  return (
    <div className="flex flex-col gap-4 card-flow">
      <PortalHeader eyebrow={admin.isAssistant ? 'mCare Assistant' : 'System Admin'} onNavigate={go} onProfile={() => go('profile')} />

      <HeroCard
        eyebrow="Patients on mCare"
        value={patients.length}
        caption={canMonitor
          ? `${activeToday} active today · ${activeAlerts.length} open alert${s(activeAlerts.length)} · ${alerts.length - activeAlerts.length} resolved`
          : `${patients.filter(p => p.status === 'active').length} active account${s(patients.filter(p => p.status === 'active').length)}`}
        sideTitle="Care team"
        side={[
          { value: doctors.filter(d => d.approvalStatus === 'approved' && d.status === 'active').length, label: 'doctors' },
          { value: staff.filter(a => a.isAssistant && a.status === 'active').length, label: 'assistants' },
        ]}
        progress={canMonitor && patients.length ? (activeToday / patients.length) * 100 : undefined}
      />

      <QuickGrid items={[
        ...(canApprove ? [{ icon: '✅', label: 'Approvals', onClick: () => go('approvals'), badge: pendingDrs.length }] : []),
        ...(canAppts ? [{ icon: '📅', label: 'Appointments', onClick: () => go('appointments') }] : []),
        ...(canSupport ? [{ icon: '🛟', label: 'Support', onClick: () => go('support'), badge: openTickets.length }] : []),
        ...(canDocs ? [{ icon: '🗂️', label: 'Documents', onClick: () => go('documents'), badge: docIssues }] : []),
        ...(canLogs ? [{ icon: '🧾', label: 'Audit Log', onClick: () => go('audit') }] : []),
        ...(canLogs ? [{ icon: '📈', label: 'Reports', onClick: () => go('reports') }] : []),
        ...(!admin.isAssistant ? [{ icon: '⚙️', label: 'Settings', onClick: () => go('settings') }] : []),
        { icon: '👤', label: 'Profile', onClick: () => go('profile') },
      ]} />

      {admin.isAssistant && <PermissionsCard user={admin} />}

      {/* Alert monitor */}
      {canMonitor && (urgent.length > 0 ? (
        <NoticeCard tone="red" title={`${escalated.length} escalated · ${sos.length} SOS need attention`} action="Monitor →" onAction={() => go('alerts')}>
          {urgent.slice(0, 3).map(a => (
            <NoticeRow key={a.id} onClick={() => go('alerts')}
              title={nameOf(a.patientId, 'Patient')}
              sub={<span className="text-red-600">{a.type === 'sos' ? `SOS · ${a.value}` : `${a.vitalName}: ${a.value} ${a.unit}`}</span>}
              right={<span className="text-[10px] text-gray-400">{ago(a.at, now)}</span>} />
          ))}
        </NoticeCard>
      ) : (
        <NoticeCard tone="green" pulse={false} title="No escalated alerts" action="Monitor →" onAction={() => go('alerts')} />
      ))}

      {canSupport && openTickets.length > 0 && (
        <NoticeCard tone="amber" pulse={false} title={`${openTickets.length} support request${s(openTickets.length)} waiting`} action="Answer →" onAction={() => go('support')}>
          {openTickets.slice(0, 2).map(t => (
            <NoticeRow key={t.id} onClick={() => go('support')} title={t.subject} sub={`${nameOf(t.userId)} · ${ago(t.at, now)}`} />
          ))}
        </NoticeCard>
      )}

      {pendingPatientReqs.length > 0 && (
        <NoticeCard tone="teal" title={`${pendingPatientReqs.length} Patient Doctor Request${s(pendingPatientReqs.length)}`}
          action={canAssign ? 'Review →' : undefined} onAction={() => go('assign')}>
          {pendingPatientReqs.slice(0, 2).map(p => (
            <NoticeRow key={p.id} title={p.name} sub="Requesting care assignment" right={<Pill color="teal">Pending</Pill>} />
          ))}
        </NoticeCard>
      )}

      {unassignedPatients.length > 0 && (
        <NoticeCard tone="amber" title={`${unassignedPatients.length} Active Patient${s(unassignedPatients.length)} Without a Doctor`}
          action={canAssign ? 'Assign →' : undefined} onAction={() => go('assign')}>
          <p className="text-[10px] text-amber-700">Their alerts reach only the admin team until a doctor is assigned.</p>
        </NoticeCard>
      )}

      {pendingDrs.length > 0 && (
        <NoticeCard tone="amber" title={`${pendingDrs.length} Doctor Registration${s(pendingDrs.length)} Pending`}
          action={canApprove ? 'Review →' : undefined} onAction={() => go('approvals')}>
          {pendingDrs.slice(0, 2).map(d => (
            <NoticeRow key={d.id} title={d.name} sub={`${d.specialty} · ${d.hospital}`}
              right={<Pill color={d.approvalStatus === 'sent_back' ? 'blue' : 'amber'}>{d.approvalStatus === 'sent_back' ? 'Sent Back' : 'Pending'}</Pill>} />
          ))}
        </NoticeCard>
      )}

      {canCreate && invitations.length > 0 && (
        <NoticeCard tone="teal" pulse={false} title={`${invitations.length} registered, waiting to sign up`} action="Users →" onAction={() => go('users')} />
      )}
    </div>
  )
}

import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import { Pill, PortalHeader, HeroCard, QuickGrid, NoticeCard, NoticeRow } from '@/shared'
import { ago } from '@/shared/lib/vitals'
import type { AdminUser } from '@/shared/lib/types'
import { can } from '@/assistant/permissions'
import { PermissionsCard } from '@/assistant/PermissionsCard'
import type { ATab } from './AdminApp'

const DAY = 86_400_000

/* ─── Dashboard ─────────────────────────────────────────────────────── */
export default function DashboardTab({ admin, go }: { admin: AdminUser; go: (t: ATab) => void }) {
  const { getPatients, getDoctors, getAdmins, alerts, users, now, documentsFor } = useApp()
  const liveAlerts = alerts.filter(isActiveAlert)
  const escalated = liveAlerts.filter(a => a.status === 'escalated')
  const sos = liveAlerts.filter(a => a.type === 'sos')
  const urgent = [...sos, ...escalated.filter(a => a.type !== 'sos')]
  const canMonitor = can(admin, 'monitor_patients')
  const canAssign = can(admin, 'assign_healthworkers', 'approve_patient_requests')
  const canApprove = can(admin, 'approve_doctors')
  const canLogs = can(admin, 'view_logs')
  const canDocs = can(admin, 'document_support')
  const docEntries = documentsFor(undefined, { allVersions: true })
  const docIssues = docEntries.filter(e => e.doc.upload?.state === 'failed' || (e.doc.origin !== 'patient_upload' && e.doc.status !== 'released' && now - e.doc.at > DAY)).length
  const patients = getPatients()
  const pendingDrs = getDoctors().filter(d => d.approvalStatus === 'pending' || d.approvalStatus === 'sent_back')
  const pendingPatientReqs = patients.filter(p => p.doctorRequest?.status === 'pending')
  const unassignedPatients = patients.filter(p => p.status === 'active' && !p.assignedDoctorId)
  const activeToday = patients.filter(p => p.readings.some(r => r.at && now - r.at < DAY)).length
  const s = (n: number) => (n === 1 ? '' : 's')

  return (
    <div className="flex flex-col gap-4 card-flow">
      <PortalHeader eyebrow={admin.isAssistant ? 'mCare Assistant' : 'System Admin'} onNavigate={t => go(t as ATab)} onProfile={() => go('profile')} />

      <HeroCard
        eyebrow="Patients on mCare"
        value={patients.length}
        caption={`${activeToday} active today · ${liveAlerts.length} open alert${s(liveAlerts.length)} · ${alerts.filter(a => a.status === 'resolved').length} resolved`}
        sideTitle="Care team"
        side={[
          { value: getDoctors().filter(d => d.approvalStatus === 'approved').length, label: 'doctors' },
          { value: getAdmins().filter(a => a.isAssistant).length, label: 'assistants' },
        ]}
        progress={patients.length ? (activeToday / patients.length) * 100 : 0}
      />

      <QuickGrid items={[
        ...(canApprove ? [{ icon: '✅', label: 'Approvals', onClick: () => go('approvals'), badge: pendingDrs.length }] : []),
        ...(canDocs ? [{ icon: '🗂️', label: 'Documents', onClick: () => go('documents'), badge: docIssues }] : []),
        ...(canLogs ? [{ icon: '🧾', label: 'Audit Log', onClick: () => go('audit') }] : []),
        { icon: '👤', label: 'Profile', onClick: () => go('profile') },
      ]} />

      {admin.isAssistant && <PermissionsCard user={admin} />}

      {/* Live alert monitor */}
      {canMonitor && (urgent.length > 0 ? (
        <NoticeCard tone="red" title={`${escalated.length} escalated · ${sos.length} SOS need attention`} action="Monitor →" onAction={() => go('alerts')}>
          {urgent.slice(0, 3).map(a => (
            <NoticeRow key={a.id} onClick={() => go('alerts')}
              title={users.find(u => u.id === a.patientId)?.name}
              sub={<span className="text-red-600">{a.type === 'sos' ? `SOS · ${a.value}` : `${a.vitalName}: ${a.value} ${a.unit}`}</span>}
              right={<span className="text-[10px] text-gray-400">{ago(a.at, now)}</span>} />
          ))}
        </NoticeCard>
      ) : (
        <NoticeCard tone="green" pulse={false} title="No escalated alerts" action="Monitor →" onAction={() => go('alerts')} />
      ))}

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
          <p className="text-[10px] text-amber-700">Every patient must have a doctor.</p>
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
    </div>
  )
}

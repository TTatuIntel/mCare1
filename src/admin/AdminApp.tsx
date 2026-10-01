import { useState } from 'react'
import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import { PortalShell } from '@/shared'
import type { AdminUser } from '@/shared/lib/types'
import DashboardTab from './DashboardTab'
import ApprovalsTab from './ApprovalsTab'
import AlertsMonitorTab from './AlertsMonitorTab'
import AssignTab from './AssignTab'
import VitalsTab from './VitalsTab'
import UsersTab from './UsersTab'
import AuditTab from './AuditTab'
import ProfileTab from './ProfileTab'
import DocumentsTab from './DocumentsTab'

/* ─── Types ─────────────────────────────────────────────────────────── */
export type ATab = 'dashboard' | 'approvals' | 'alerts' | 'assign' | 'vitals' | 'users' | 'profile' | 'audit' | 'documents'

/* ─── Nav ───────────────────────────────────────────────────────────── */
// Grouped for the web sidebar. Documents and the audit log are opened from Home on mobile and tablet,
// where the bar has no room for them; the sidebar lists them directly.
const NAV_ITEMS: { id: ATab; label: string; icon: string; group?: string; webOnly?: boolean }[] = [
  { id: 'dashboard', label: 'Home',      icon: '🏠' },
  { id: 'approvals', label: 'Approvals', icon: '✅', group: 'People' },
  { id: 'assign',    label: 'Assign',    icon: '🩺', group: 'People' },
  { id: 'users',     label: 'Users',     icon: '👥', group: 'People' },
  { id: 'alerts',    label: 'Alerts',    icon: '🚨', group: 'Clinical' },
  { id: 'vitals',    label: 'Vitals',    icon: '📊', group: 'Clinical' },
  { id: 'documents', label: 'Documents', icon: '🗂️', group: 'System', webOnly: true },
  { id: 'audit',     label: 'Audit Log', icon: '🧾', group: 'System', webOnly: true },
]
/** Off-nav screens that draw their own BackHeader. */
const OWN_BACK: ATab[] = ['audit', 'documents']

/* ─── Staff portal (shared by admins and assistants) ─────────────────── */
export function AdminPortal({ allowed }: { allowed: (tab: ATab) => boolean }) {
  const { currentUser, alerts, getDoctors, getPatients } = useApp()
  const admin = currentUser as AdminUser
  const [tab, setTab] = useState<ATab>('dashboard')

  const badges: Partial<Record<ATab, number>> = {
    approvals: getDoctors().filter(d => d.approvalStatus === 'pending').length,
    alerts: alerts.filter(a => isActiveAlert(a) && (a.status === 'escalated' || a.type === 'sos')).length,
    assign: getPatients().filter(p => p.status === 'active' && (p.doctorRequest?.status === 'pending' || !p.assignedDoctorId)).length,
  }
  const visibleNav = NAV_ITEMS.filter(n => allowed(n.id)).map(n => ({ ...n, badge: badges[n.id] }))
  const go = (t: ATab) => setTab(allowed(t) ? t : 'dashboard')
  const current = allowed(tab) ? tab : 'dashboard'
  const home = () => setTab('dashboard')

  return (
    <PortalShell screen={current} nav={visibleNav} onSelect={id => go(id as ATab)} homeId="dashboard" hideBack={OWN_BACK.includes(current)} narrow={current === 'profile'}>
      {current === 'dashboard' && <DashboardTab admin={admin} go={go} />}
      {current === 'approvals' && <ApprovalsTab />}
      {current === 'alerts'    && <AlertsMonitorTab admin={admin} />}
      {current === 'assign'    && <AssignTab />}
      {current === 'vitals'    && <VitalsTab admin={admin} />}
      {current === 'users'     && <UsersTab admin={admin} />}
      {current === 'audit'     && <AuditTab onBack={home} />}
      {current === 'profile'   && <ProfileTab />}
      {current === 'documents' && <DocumentsTab admin={admin} onBack={home} />}
    </PortalShell>
  )
}

/** System administrator: every screen. Assistants use assistant/AssistantApp. */
export default function AdminApp() {
  return <AdminPortal allowed={() => true} />
}

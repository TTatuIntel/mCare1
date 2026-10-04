import { useState } from 'react'
import { PortalShell } from '@/shared'
import DashboardTab from './DashboardTab'
import ApprovalsTab from './ApprovalsTab'
import AlertsMonitorTab from './AlertsMonitorTab'
import AssignTab from './AssignTab'
import VitalsTab from './VitalsTab'
import UsersTab from './UsersTab'
import AuditTab from './AuditTab'
import ProfileTab from './ProfileTab'
import DocumentsTab from './DocumentsTab'
import AppointmentsTab from './AppointmentsTab'
import SupportTab from './SupportTab'
import ReportsTab from './ReportsTab'
import SettingsTab from './SettingsTab'
import { useAdmin } from './useAdmin'

/* ─── Types ─────────────────────────────────────────────────────────── */
export const ADMIN_TABS = ['dashboard', 'approvals', 'alerts', 'assign', 'vitals', 'users', 'profile', 'audit', 'documents', 'appointments', 'support', 'reports', 'settings'] as const
export type ATab = typeof ADMIN_TABS[number]

/* ─── Nav ───────────────────────────────────────────────────────────── */
// Grouped for the web sidebar. Appointments, support, documents and the audit log are opened from Home on mobile
// and tablet, where the bar has no room for them; the sidebar lists them directly.
const NAV_ITEMS: { id: ATab; label: string; icon: string; group?: string; webOnly?: boolean }[] = [
  { id: 'dashboard', label: 'Home',      icon: '🏠' },
  { id: 'approvals', label: 'Approvals', icon: '✅', group: 'People' },
  { id: 'assign',    label: 'Assign',    icon: '🩺', group: 'People' },
  { id: 'users',     label: 'Users',     icon: '👥', group: 'People' },
  { id: 'alerts',    label: 'Alerts',    icon: '🚨', group: 'Clinical' },
  { id: 'vitals',    label: 'Vitals',    icon: '📊', group: 'Clinical' },
  { id: 'appointments', label: 'Appointments', icon: '📅', group: 'Clinical', webOnly: true },
  { id: 'support',   label: 'Support',   icon: '🛟', group: 'System', webOnly: true },
  { id: 'documents', label: 'Documents', icon: '🗂️', group: 'System', webOnly: true },
  { id: 'audit',     label: 'Audit Log', icon: '🧾', group: 'System', webOnly: true },
  { id: 'reports',   label: 'Reports',   icon: '📈', group: 'System', webOnly: true },
  { id: 'settings',  label: 'Settings',  icon: '⚙️', group: 'System', webOnly: true },
]
/** Off-nav screens that draw their own BackHeader. */
const OWN_BACK: ATab[] = ['audit', 'documents', 'appointments', 'support', 'reports', 'settings']

/* ─── Staff portal (shared by admins and assistants) ─────────────────── */
export function AdminPortal({ allowed }: { allowed: (tab: ATab) => boolean }) {
  const { doctors, patients, activeAlerts, supportTickets } = useAdmin()
  const [tab, setTab] = useState<ATab>('dashboard')

  const badges: Partial<Record<ATab, number>> = {
    approvals: doctors.filter(d => d.approvalStatus === 'pending').length,
    alerts: activeAlerts.filter(a => a.status === 'escalated' || a.type === 'sos').length,
    assign: patients.filter(p => p.status === 'active' && (p.doctorRequest?.status === 'pending' || !p.assignedDoctorId)).length,
    support: supportTickets.filter(t => t.status === 'open').length,
  }
  const visibleNav = NAV_ITEMS.filter(n => allowed(n.id)).map(n => ({ ...n, badge: badges[n.id] }))
  // A link (from a notification, say) to a screen that does not exist, or that this person may not open, lands on Home.
  const go = (t: string) => setTab((ADMIN_TABS as readonly string[]).includes(t) && allowed(t as ATab) ? t as ATab : 'dashboard')
  const current = allowed(tab) ? tab : 'dashboard'
  const home = () => setTab('dashboard')

  return (
    <PortalShell screen={current} nav={visibleNav} onSelect={go} homeId="dashboard" hideBack={OWN_BACK.includes(current)} narrow={current === 'profile'}>
      {current === 'dashboard' && <DashboardTab go={go} />}
      {current === 'approvals' && <ApprovalsTab />}
      {current === 'alerts'    && <AlertsMonitorTab />}
      {current === 'assign'    && <AssignTab />}
      {current === 'vitals'    && <VitalsTab />}
      {current === 'users'     && <UsersTab />}
      {current === 'audit'     && <AuditTab onBack={home} />}
      {current === 'profile'   && <ProfileTab />}
      {current === 'documents' && <DocumentsTab onBack={home} />}
      {current === 'appointments' && <AppointmentsTab onBack={home} />}
      {current === 'support'   && <SupportTab onBack={home} />}
      {current === 'reports'   && <ReportsTab onBack={home} />}
      {current === 'settings'  && <SettingsTab onBack={home} />}
    </PortalShell>
  )
}

/** System administrator: every screen. Assistants use assistant/AssistantApp. */
export default function AdminApp() {
  return <AdminPortal allowed={() => true} />
}

import { useState } from 'react'
import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import { PortalShell } from '@/shared'
import type { DoctorUser } from '@/shared/lib/types'
import { DashboardTab } from './DashboardTab'
import { PatientsTab } from './PatientsTab'
import { AppointmentsTab } from './AppointmentsTab'
import { AlertsTab } from './AlertsTab'
import { ProfileTab } from './ProfileTab'

/* ─── Root ──────────────────────────────────────────────────────────── */
const NAV = [
  { id: 'dashboard', label: 'Home',     icon: '🏠' },
  { id: 'patients',  label: 'Patients', icon: '👥' },
  { id: 'appts',     label: 'Appts',    icon: '📅' },
  { id: 'alerts',    label: 'Alerts',   icon: '🔔' },
]
// Profile opens from the header avatar, like every other portal.
const SCREENS = ['dashboard', 'patients', 'appts', 'alerts', 'profile']

export default function DoctorApp() {
  const { currentUser, alerts, appointments, messages } = useApp()
  const doctor = currentUser as DoctorUser
  const [tab, setTab] = useState('dashboard')
  const [openId, setOpenId] = useState<string | null>(null)
  const [openSection, setOpenSection] = useState<'docs' | undefined>()

  const mine = new Set(doctor.assignedPatientIds)
  const badge: Record<string, number> = {
    alerts: alerts.filter(a => isActiveAlert(a) && mine.has(a.patientId)).length,
    appts: appointments.filter(a => a.doctorId === doctor.id && a.status === 'requested').length,
    patients: messages.filter(m => m.toId === doctor.id && !m.read && mine.has(m.fromId)).length,
  }
  const go = (t: string) => { if (t !== 'patients') setOpenId(null); setTab(SCREENS.includes(t) ? t : 'dashboard') }
  const openPatient = (id: string, section?: 'docs') => { setOpenId(id); setOpenSection(section); setTab('patients') }

  return (
    <PortalShell screen={tab} animKey={tab + (openId ?? '')} nav={NAV.map(n => ({ ...n, badge: badge[n.id] }))} onSelect={go} homeId="dashboard" narrow={tab === 'profile'}>
      {tab === 'dashboard' && <DashboardTab doctor={doctor} goTo={go} openPatient={openPatient} />}
      {tab === 'patients'  && <PatientsTab doctor={doctor} openId={openId} setOpenId={id => { setOpenId(id); setOpenSection(undefined) }} initialSection={openSection} />}
      {tab === 'appts'     && <AppointmentsTab doctor={doctor} />}
      {tab === 'alerts'    && <AlertsTab doctor={doctor} openPatient={openPatient} />}
      {tab === 'profile'   && <ProfileTab />}
    </PortalShell>
  )
}

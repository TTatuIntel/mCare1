import { useState } from 'react'
import { PortalShell } from '@/shared'
import type { AppNotification } from '@/shared/lib/types'
import { DashboardTab } from './DashboardTab'
import { PatientsTab } from './PatientsTab'
import { AppointmentsTab } from './AppointmentsTab'
import { AlertsTab } from './AlertsTab'
import { MessagesTab } from './MessagesTab'
import { ProfileTab } from './ProfileTab'
import type { Section } from './PatientDetail'
import { useDoctor } from './useDoctor'

/* ─── Root ──────────────────────────────────────────────────────────── */
const NAV = [
  { id: 'dashboard', label: 'Home',     icon: '🏠' },
  { id: 'patients',  label: 'Patients', icon: '👥' },
  { id: 'appts',     label: 'Appts',    icon: '📅' },
  { id: 'alerts',    label: 'Alerts',   icon: '🔔' },
]
// Profile opens from the header avatar, like every other portal; Messages from Home.
const SCREENS = ['dashboard', 'patients', 'appts', 'alerts', 'messages', 'profile']

/** The part of a patient's record a link opens. */
export type PatientSection = Section

export default function DoctorApp() {
  const { activeAlerts, appointments, patients, patient, unreadFrom } = useDoctor()
  const [tab, setTab] = useState('dashboard')
  const [openId, setOpenId] = useState<string | null>(null)
  const [openSection, setOpenSection] = useState<PatientSection | undefined>()
  const [openDoc, setOpenDoc] = useState<string | undefined>()
  /** The appointment a link landed on. */
  const [focusAppt, setFocusAppt] = useState<string | undefined>()

  const badge: Record<string, number> = {
    alerts: activeAlerts.length,
    appts: appointments.filter(a => a.status === 'requested').length,
    patients: patients.reduce((n, p) => n + unreadFrom(p.id), 0),
  }
  const openPatient = (id: string, section?: PatientSection, docId?: string) => { setOpenId(id); setOpenSection(section); setOpenDoc(docId); setTab('patients') }
  const openAppt = (id: string) => { setOpenId(null); setFocusAppt(id); setTab('appts') }
  /** Opens a screen. A notification also says which record it is about, so its tap lands on that patient or visit. */
  const go = (t: string, about?: AppNotification['resource']) => {
    if (about?.type === 'appointment') return openAppt(about.id)
    if (about?.type === 'patient' && patient(about.id)) return openPatient(about.id, t === 'alerts' ? undefined : t === 'messages' ? 'messages' : undefined)
    if (t !== 'patients') setOpenId(null)
    setFocusAppt(undefined)
    setTab(SCREENS.includes(t) ? t : 'dashboard')
  }

  return (
    <PortalShell screen={tab} animKey={tab + (openId ?? '')} nav={NAV.map(n => ({ ...n, badge: badge[n.id] }))} onSelect={go} homeId="dashboard" narrow={tab === 'profile'}>
      {tab === 'dashboard' && <DashboardTab goTo={go} openPatient={openPatient} openAppt={openAppt} />}
      {tab === 'patients'  && <PatientsTab openId={openId} setOpenId={id => { setOpenId(id); setOpenSection(undefined); setOpenDoc(undefined) }} initialSection={openSection} initialDoc={openDoc} />}
      {tab === 'appts'     && <AppointmentsTab focusId={focusAppt} openPatient={openPatient} />}
      {tab === 'alerts'    && <AlertsTab openPatient={openPatient} openAppt={openAppt} />}
      {tab === 'messages'  && <MessagesTab openChat={id => openPatient(id, 'messages')} />}
      {tab === 'profile'   && <ProfileTab />}
    </PortalShell>
  )
}

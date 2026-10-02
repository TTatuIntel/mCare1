import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { PortalShell } from '@/shared'
import type { PatientUser } from '@/shared/lib/types'
import { useDaySchedule } from './useDaySchedule'
import { HomeTab } from './HomeTab'
import { VitalsTab } from './VitalsTab'
import { MedicineTab } from './MedicineTab'
import { MessagesTab } from './MessagesTab'
import { AppointmentsTab } from './AppointmentsTab'
import { DocsTab } from './DocsTab'
import { ProfileTab } from './ProfileTab'
import { MealsTab } from './MealsTab'
import { CareTeamTab } from './CareTeamTab'
import { MyAlertsTab } from './MyAlertsTab'
import { QuickLogFab } from './QuickLogFab'
import { useVitalLog } from './VitalLogSheets'

/* ─── Root ──────────────────────────────────────────────────────────── */
const NAV = [
  { id: 'home',     label: 'Home',   icon: '🏠' },
  { id: 'vitals',   label: 'Vitals', icon: '📊' },
  { id: 'medicine', label: 'Meds',   icon: '💊' },
  { id: 'messages', label: 'Chat',   icon: '💬' },
  { id: 'appts',    label: 'Appts',  icon: '📅' },
]
const SCREENS = ['home', 'vitals', 'medicine', 'messages', 'appts', 'docs', 'profile', 'meals', 'care', 'alerts']
/** Screens that show the floating "Log vitals" button. A vital's own page has its "Log reading" button instead. */
const FAB_SCREENS = ['home', 'alerts', 'vitals']

export default function PatientApp() {
  const { currentUser, messages, appointments } = useApp()
  const patient = currentUser as PatientUser
  const [tab, setTab] = useState('home')
  /** The vital whose page is open, and the screen "back" returns to. */
  const [vital, setVital] = useState<{ id: string; from: string } | null>(null)
  const go = (t: string) => { setVital(null); setTab(SCREENS.includes(t) ? t : 'home') }
  // Any tapped vital, on any screen, opens that vital's own page.
  const openVital = (id: string) => { setVital(v => ({ id, from: v?.from ?? tab })); setTab('vitals') }
  const closeVital = () => { setTab(vital?.from ?? 'vitals'); setVital(null) }
  const day = useDaySchedule()
  const badge: Record<string, number> = {
    messages: messages.filter(m => m.toId === patient.id && !m.read).length,
    // doses that are late or due within 30 min — matches the Home reminders
    medicine: day.dueNowCount('med'),
    vitals: day.vitals.item && day.vitals.item.inMin <= 0 ? 1 : 0,
    appts: appointments.filter(a => a.patientId === patient.id && (a.status === 'rescheduled')).length,
  }

  // The floating "Log vitals" button, on the screens where a reading is the next thing to do.
  const log = useVitalLog()
  const vitalsDue = !!day.vitals.item && day.vitals.item.inMin <= 0
  const fab = FAB_SCREENS.includes(tab) && !vital && patient.trackedVitalIds.length > 0
    ? <QuickLogFab onLogOne={log.logOne} onLogGroup={log.logGroup} onLogAll={log.logAll} due={vitalsDue} /> : undefined

  return (
    <PortalShell screen={tab} nav={NAV.map(n => ({ ...n, badge: badge[n.id] }))} onSelect={go} homeId="home" fill={tab === 'messages'} narrow={tab === 'profile'} floating={fab}>
      {log.sheets}
      {tab ==='home'     && <HomeTab go={go} openVital={openVital} onLog={log.logOne} />}
      {tab ==='vitals'   && <VitalsTab vitalId={vital?.id ?? null} onOpenVital={openVital} onCloseVital={closeVital} go={go} />}
      {tab ==='medicine' && <MedicineTab />}
      {tab ==='messages' && <MessagesTab go={go} />}
      {tab ==='appts'    && <AppointmentsTab />}
      {tab ==='docs'     && <DocsTab go={go} />}
      {tab ==='profile'  && <ProfileTab go={go} />}
      {tab ==='meals'    && <MealsTab />}
      {tab ==='care'     && <CareTeamTab go={go} />}
      {tab ==='alerts'   && <MyAlertsTab openVital={openVital} onLog={log.logOne} go={go} />}
    </PortalShell>
  )
}

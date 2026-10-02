import { lazy, Suspense, useDeferredValue, useEffect, type ComponentType } from 'react'
import { AppProvider, useApp } from '@/shared/state/AppContext'
import type { AdminUser, AppUser, DoctorUser, PatientUser } from '@/shared/lib/types'
import { PhoneShell } from '@/shared/layout/PhoneShell'
import { Loading } from '@/shared/ui/Loader'
import { LoginScreen } from '@/shared/auth/LoginScreen'
import { VerificationScreen } from '@/shared/auth/VerificationScreen'
import { DoctorStatusScreen } from '@/shared/auth/DoctorStatusScreen'
import { SuspendedScreen } from '@/shared/auth/SuspendedScreen'

/** Set when the page was opened from a patient's share link: the visitor sees those documents, not the sign-in page. */
const SHARE_TOKEN = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('share')
const SharedDocuments = lazy(() => import('@/shared/documents/SharedDocuments').then(m => ({ default: m.SharedDocuments })))

// Each portal is its own chunk. They are fetched quietly while the user is
// on the sign-in screen, so signing in is normally instant; only on a slow
// network does the sign-in screen stay up under the loading popup.
const PORTALS = {
  patient: () => import('./patient/PatientApp'),
  doctor: () => import('./doctor/DoctorApp'),
  admin: () => import('./admin/AdminApp'),
  assistant: () => import('./assistant/AssistantApp'),
  healthSetup: () => import('./patient/HealthSetup'),
}
const PatientApp = lazy(PORTALS.patient)
const HealthSetup = lazy(PORTALS.healthSetup)
const DoctorApp = lazy(PORTALS.doctor)
const AdminApp = lazy(PORTALS.admin)
const AssistantApp = lazy(PORTALS.assistant)

/** Fetch every portal's code once the browser is idle (errors retry on sign-in). */
function usePrefetchPortals() {
  useEffect(() => {
    const run = () => Object.values(PORTALS).forEach(load => load().catch(() => {}))
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(run, { timeout: 3000 })
      return () => cancelIdleCallback(id)
    }
    const t = setTimeout(run, 1500)
    return () => clearTimeout(t)
  }, [])
}

const SCREENS = {
  login: LoginScreen,
  verify: VerificationScreen,
  suspended: SuspendedScreen,
  doctorStatus: DoctorStatusScreen,
  doctor: DoctorApp,
  admin: AdminApp,
  assistant: AssistantApp,
  healthSetup: HealthSetup,
  patient: PatientApp,
} satisfies Record<string, ComponentType>

/** Screens that lay themselves out across the whole frame: the portals, and the sign-in pages (AuthShell). */
const FULL_FRAME = new Set<string>(['patient', 'doctor', 'admin', 'assistant', 'login', 'verify'])

/* ─── Router: one portal per role ───────────────────────────────────── */
function screenFor(user: AppUser | null): keyof typeof SCREENS {
  if (!user) return 'login'
  if (user.status === 'unverified') return 'verify'
  if (user.status === 'suspended' && user.role !== 'doctor') return 'suspended'
  if (user.role === 'doctor') {
    if ((user as DoctorUser).approvalStatus !== 'approved') return 'doctorStatus'
    if (user.status === 'suspended') return 'suspended'
    return 'doctor'
  }
  if (user.role === 'admin' || user.role === 'assistant') return (user as AdminUser).isAssistant ? 'assistant' : 'admin'
  // New patients fill in their health profile before reaching the portal.
  if ((user as PatientUser).profileSetup === 'pending') return 'healthSetup'
  return 'patient'
}

function Router() {
  const { currentUser } = useApp()
  usePrefetchPortals()
  const target = screenFor(currentUser)
  // React renders the next screen in the background; if its code is still
  // loading, `shown` keeps the current screen until it is ready.
  const deferred = useDeferredValue(target)
  // Signed out: go to the sign-in page at once. A portal must never be drawn without its user, even for one frame.
  const shown = currentUser ? deferred : target
  const Screen = SCREENS[shown]
  return (
    <>
      {/* Setup and account-status screens stay a phone-width column, centred. */}
      {FULL_FRAME.has(shown) ? <Screen /> : <div className="mx-auto w-full max-w-md h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}><Screen /></div>}
      <Loading when={shown !== target} label="Opening your portal…" />
    </>
  )
}

export default function App() {
  return (
    <AppProvider>
      <PhoneShell>
        <Suspense fallback={<Loading label="Loading…" />}>
          {SHARE_TOKEN ? <SharedDocuments token={SHARE_TOKEN} /> : <Router />}
        </Suspense>
      </PhoneShell>
    </AppProvider>
  )
}

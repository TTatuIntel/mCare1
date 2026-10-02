import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  AppUser, VitalDef, PatientUser, DoctorUser, AdminUser, AssistantPerm, Prescription, VitalReading,
  AppAlert, Appointment, PatientMessage, AppNotification, NotifKind, AuditEntry, ClinicalNote, MedDose, MealDone, ReportRequest,
  AccountStatus, SupportTicket, ResetToken, ResetChannel, AuthProvider, VitalsReportInclude, EmailContent, SentEmail, SentSms,
  MealPlan, HydrationLog, DoctorRating, Outcome,
} from '@/shared/lib/types'
import { emails as mail, sms as smsText, appBaseUrl, activationLink, activationToken } from '@/shared/email/emailTemplate'
import { RESET_TTL_MIN, MAX_RESET_ATTEMPTS, AUTH_PROVIDER_LABELS } from '@/shared/lib/types'
import { passwordIssue } from './auth'
import { DEMO } from './demoData'
import { backendConfigured } from '@/shared/api/supabase'
import { signOutBackend } from '@/shared/api/authBackend'
import * as api from '@/shared/api/actions'
import { isoClock, isoDay, latestNotificationId, loadRecords, type Records } from '@/shared/api/records'
import { evaluate, alertIsFor, stamp, dateLabel, dayKey, targetRange, ESCALATE_AFTER_MIN, CORRECTION_WINDOW_MIN, SELF_CLEAR_WINDOW_MIN, type VitalLevel } from '@/shared/lib/vitals'
import { useDocumentStore, type DocumentApi } from '@/shared/documents/useDocumentStore'
import { seedDocuments } from '@/shared/documents/docSeed'

/* ─── Where the record lives ──────────────────────────────────────────
   live  a backend is configured: the record is read from and saved to the
         database, as the signed-in person (shared/api/records + actions).
         Nothing below invents data; the lists start empty and are filled
         by what the database allows this person to see.
   demo  no backend: the sample data in ./demoData is kept in memory, and
         the same actions change it here in the browser.
   Screens do not know which one is running. */
const LIVE = backendConfigured

const NOW = DEMO.now
const MIN = 60_000

const START = LIVE
  ? { users: [] as AppUser[], vitalDefs: [] as VitalDef[], alerts: [] as AppAlert[], appointments: [] as Appointment[],
      messages: [] as PatientMessage[], clinicalNotes: [] as ClinicalNote[], notifications: [] as AppNotification[], audit: [] as AuditEntry[] }
  : DEMO

/** How often live mode asks "has anything changed for me?" and how often it reloads regardless. */
const CHECK_EVERY_MS = 15_000
const RELOAD_EVERY_MS = 120_000

/* ─── Context ───────────────────────────────────────────────────────── */

export interface LogResult {
  level: VitalLevel
  /** An alert was raised and the care team has been told. */
  alerted: boolean
  readingId: string
  /** This reading closed an open warning (re-measured in range). */
  cleared?: boolean
}

/** Every action that saves resolves with how it went, in both modes. */
type Saved<T = void> = Promise<Outcome<T>>
const done = <T = void,>(value?: T): Saved<T> => Promise.resolve({ ok: true, value: value as T })
const refused = <T = void,>(error: string): Saved<T> => Promise.resolve({ ok: false, error })

export interface SyncState {
  /** When the data on screen was last loaded from the backend. */
  at: number | null
  refreshing: boolean
  /** Set while the backend cannot be reached; what is on screen is the last successful load. */
  error?: string
}

/** Documents come from the document store (useDocumentStore.ts); every read there is access-checked. */
interface Ctx extends DocumentApi {
  now: number
  /** True when the record lives on the backend; false in demo mode. */
  live: boolean
  currentUser: AppUser | null
  /** Signs out with `null`. To sign someone in, use `signIn`. */
  setCurrentUser: (u: AppUser | null) => void
  /** Opens the app for an account. In live mode its record is loaded first; `entering` is true meanwhile. */
  signIn: (account: AppUser, opts?: { acceptedTermsAt?: number }) => void
  entering: boolean
  /** Why the record could not be loaded at sign-in, or why the session ended. */
  enterError?: string
  retryEnter: () => void
  sync: SyncState
  online: boolean
  /** Live mode: reload the record now. */
  refresh: () => Promise<void>
  /** Live mode: run one change against the backend, then reload. Resolves with the outcome; never throws. */
  run: <T>(job: () => Promise<T>) => Saved<T>
  /** The last save that failed, for the banner every portal shows. */
  saveError?: string
  clearSaveError: () => void
  users: AppUser[]
  vitalDefs: VitalDef[]
  setVitalDefs: React.Dispatch<React.SetStateAction<VitalDef[]>>
  updateUser: (id: string, patch: Partial<AppUser>) => Saved
  addUser: (u: AppUser, opts?: { invited?: boolean }) => void
  getDoctors: () => DoctorUser[]
  getPatients: () => PatientUser[]
  getAdmins: () => AdminUser[]
  updateAssistantPerms: (id: string, perms: AssistantPerm[]) => Saved
  assignPatientToDoctor: (patientId: string, doctorId: string | null) => Saved
  resolvePatientRequest: (patientId: string, approve: boolean, note?: string, alternativeDoctorId?: string) => Saved
  setUserStatus: (id: string, status: AccountStatus) => Saved
  decideDoctor: (id: string, status: 'approved' | 'sent_back' | 'rejected', note?: string) => Saved
  // Clinical
  addPrescription: (patientId: string, rx: Prescription) => Saved
  setPrescriptionActive: (patientId: string, rxId: string, active: boolean) => Saved
  logReading: (patientId: string, reading: VitalReading) => Saved<LogResult>
  correctReading: (patientId: string, readingId: string, value: string) => Saved
  invalidateReading: (patientId: string, readingId: string, reason: string) => Saved
  sendAlertNow: (patientId: string, readingId: string) => Saved
  setDoctorNote: (patientId: string, note: string) => Saved
  setUnitPref: (patientId: string, vitalId: string, unit: string) => Saved
  /** Set a patient's personal target range for a vital, and record the change. */
  setThreshold: (patientId: string, vitalId: string, range: { min: number; max: number }) => Saved
  setCriticalThreshold: (patientId: string, vitalId: string, range: { min: number; max: number } | null) => Saved
  clinicalNotes: ClinicalNote[]
  doses: MedDose[]
  toggleDose: (patientId: string, rxId: string, slot: number) => Saved
  mealsDone: MealDone[]
  toggleMeal: (patientId: string, mealId: string, note?: string) => Saved
  /** Meal plans set by doctors. A patient without one follows the standard plan. */
  mealPlans: MealPlan[]
  hydration: HydrationLog[]
  setHydration: (patientId: string, glasses: number) => Saved
  ratings: DoctorRating[]
  rateDoctor: (patientId: string, doctorId: string, rating: number, comment?: string) => Saved
  // Alerts
  alerts: AppAlert[]
  raiseSOS: (patientId: string, message: string) => Saved
  acknowledgeAlert: (alertId: string) => Saved
  resolveAlert: (alertId: string, reason: string, note?: string) => Saved
  escalateAlert: (alertId: string) => Saved
  requestRecheck: (alertId: string) => Saved
  /** A monitor asks the treating doctor to respond to an open alert. */
  chaseDoctor: (alertId: string) => Saved
  scheduleFollowUp: (patientId: string, doctorId: string, date: string, time: string, note: string | undefined, alertId?: string) => Saved
  // Appointments
  appointments: Appointment[]
  addAppointment: (appt: Appointment) => Saved
  updateAppointment: (apptId: string, patch: Partial<Appointment>) => Saved
  reportRequests: ReportRequest[]
  requestReport: (patientId: string, periodDays: number, reason: string) => Saved
  /** Draft the requested report; the doctor may adjust the period and what it includes. Resolves with the new document id. */
  fulfillReportRequest: (id: string, opts?: { days?: number; interpretation?: string; include?: VitalsReportInclude }) => Promise<string | null>
  declineReportRequest: (id: string, reason: string) => Saved
  // Messages
  messages: PatientMessage[]
  sendMessage: (fromId: string, toId: string, content: string) => Saved
  markMessagesRead: (fromId: string, toId: string) => Saved
  // Notifications & audit
  notifications: AppNotification[]
  /** Demo mode only. In live mode the database writes notifications in the same transaction as the change. */
  notify: (userId: string, kind: NotifKind, title: string, body: string, link?: string, opts?: { email?: boolean }) => void
  /** Every email mCare has sent, newest first. All use the one branded template (shared/email). */
  emails: SentEmail[]
  emailsFor: (address: string) => SentEmail[]
  /** Text messages sent to phones — one-time codes only. */
  texts: SentSms[]
  textsFor: (phone: string) => SentSms[]
  /** True when the token from the emailed activation link matches this unverified account. */
  verifyByLink: (userId: string, token: string) => boolean
  resendVerification: (userId: string) => void
  sendWelcomeEmail: (userId: string) => void
  markNotificationRead: (id: string) => Saved
  markAllNotificationsRead: (userId: string) => Saved
  audit: AuditEntry[]
  logAudit: (action: string, detail: string) => void
  canCorrect: (reading: VitalReading) => boolean
  // Account self-service — password recovery is always gated by a one-time
  // code or magic link; see the implementations for the full flow.
  changePassword: (id: string, currentPw: string, newPw: string) => { ok: boolean; error?: string }
  requestPasswordReset: (identifier: string, channel?: ResetChannel) => { ok: boolean; error?: string; token?: ResetToken; userId?: string }
  verifyResetCode: (userId: string, code: string) => { ok: boolean; error?: string }
  verifyResetLink: (userId: string, linkToken: string) => { ok: boolean; error?: string }
  setPasswordAfterVerification: (userId: string, newPw: string) => { ok: boolean; error?: string }
  recoveryChannels: (userId: string) => ResetChannel[]
  requestAdminPasswordHelp: (identifier: string, note: string) => { ok: boolean }
  socialAuth: (provider: Exclude<AuthProvider, 'email'>, email: string, name: string) =>
    { ok: boolean; error?: string; user?: AppUser; isNew?: boolean }
  // Support tickets ("ask admin for help")
  supportTickets: SupportTicket[]
  createSupportTicket: (userId: string, subject: string, message: string) => Saved
  resolveSupportTicket: (ticketId: string, note?: string) => Saved
}

export const AppContext = createContext<Ctx | null>(null)

let seq = 0
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [users, setUsers] = useState<AppUser[]>(START.users)
  const [vitalDefs, setVitalDefsState] = useState<VitalDef[]>(START.vitalDefs)
  const [alerts, setAlerts] = useState<AppAlert[]>(START.alerts)
  const [appointments, setAppointments] = useState<Appointment[]>(START.appointments)
  const [reportRequests, setReportRequests] = useState<ReportRequest[]>([])
  const [messages, setMessages] = useState<PatientMessage[]>(START.messages)
  const [notifications, setNotifications] = useState<AppNotification[]>(START.notifications)
  const [audit, setAudit] = useState<AuditEntry[]>(START.audit)
  const [clinicalNotes, setClinicalNotes] = useState<ClinicalNote[]>(START.clinicalNotes)
  const [doses, setDoses] = useState<MedDose[]>([])
  const [mealsDone, setMealsDone] = useState<MealDone[]>([])
  const [mealPlans, setMealPlans] = useState<MealPlan[]>([])
  const [hydration, setHydrationLogs] = useState<HydrationLog[]>([])
  const [ratings, setRatings] = useState<DoctorRating[]>([])
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([])
  const [now, setNow] = useState(Date.now())
  const [patientLoadStatus, setPatientLoadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [patientLoadError, setPatientLoadError] = useState<string>()

  // Always-fresh refs so callbacks never read stale state
  const usersRef = useRef(users); usersRef.current = users
  const alertsRef = useRef(alerts); alertsRef.current = alerts
  const dosesRef = useRef(doses); dosesRef.current = doses
  const mealsRef = useRef(mealsDone); mealsRef.current = mealsDone

  // currentUser is derived from the live users list — no manual syncing needed
  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const actorId = () => currentUserId ?? 'system'

  const findUser = (id?: string) => usersRef.current.find(u => u.id === id)

  const reloadPatient = async () => {
    const account = usersRef.current.find(u => u.id === currentUserId)
    if (!backendConfigured || !account || account.role !== 'patient') return
    setPatientLoadStatus('loading'); setPatientLoadError(undefined)
    try {
      const live = await loadPatientSnapshot(account.id)
      setUsers(prev => {
        const withoutDirectory = prev.filter(u => u.role !== 'doctor' || !live.doctors.some(d => d.id === u.id))
        return withoutDirectory.map(u => u.id === account.id ? { ...u, ...live.patient } as PatientUser : u).concat(live.doctors)
      })
      setVitalDefs(live.vitalDefs)
      setAlerts(live.alerts)
      setAppointments(live.appointments)
      setMessages(live.messages)
      setDoses(live.doses)
      setMealsDone(live.meals)
      setReportRequests(live.reports)
      setPatientLoadStatus('ready')
    } catch (e) {
      setPatientLoadError(e instanceof Error ? e.message : 'Could not load your health record.')
      setPatientLoadStatus('error')
    }
  }

  useEffect(() => { void reloadPatient() }, [currentUserId])
  const adminsAndMonitors = () => usersRef.current.filter(u =>
    (u.role === 'admin' && u.status === 'active') ||
    (u.role === 'assistant' && u.status === 'active' && (u as AdminUser).permissions.includes('monitor_patients')))

  /* ─ live mode: loading and saving ───────────────────────────────────── */
  const [entering, setEntering] = useState(false)
  const [enterError, setEnterError] = useState<string>()
  const [sync, setSync] = useState<SyncState>({ at: null, refreshing: false })
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [saveError, setSaveError] = useState<string>()
  /** The signed-in account as the sign-in service returned it. */
  const meRef = useRef<AppUser | null>(null)
  const pendingRef = useRef<AppUser | null>(null)
  const loadSeq = useRef(0)
  const newestNotif = useRef('')

  /* ─ notifications & audit ─ */
  /* ─ outgoing email: every message goes through the one mCare template ─ */
  // Seeded accounts still waiting to verify have their code email "already sent".
  const [emails, setEmails] = useState<SentEmail[]>(() => START.users
    .filter(u => u.status === 'unverified' && u.verificationCode)
    .map((u, i) => ({ id: `em_seed${i}`, userId: u.id, content: mail.verification(u, u.verificationCode, activationLink(u.id, u.verificationCode)), at: NOW - 3_600_000, createdAt: stamp(new Date(NOW - 3_600_000)) })))
  const sendEmail = (content: EmailContent, userId?: string) => {
    if (LIVE || !content.to.trim()) return   // live mode: the backend sends email
    const t = Date.now()
    // Stand-in for the mail service: keep the most recent messages so they can be read back.
    setEmails(prev => [{ id: uid('em'), userId, content, at: t, createdAt: stamp(new Date(t)) }, ...prev].slice(0, 200))
  }
  // Text messages carry the one-time code only — never a link.
  const [texts, setTexts] = useState<SentSms[]>(() => START.users
    .filter(u => u.status === 'unverified' && u.verificationCode && u.phone.trim())
    .map((u, i) => ({ id: `sms_seed${i}`, userId: u.id, to: u.phone, text: smsText.verification(u.verificationCode), at: NOW - 3_600_000, createdAt: stamp(new Date(NOW - 3_600_000)) })))
  const sendSms = (to: string, text: string, userId?: string) => {
    if (LIVE || !to.trim()) return
    const t = Date.now()
    setTexts(prev => [{ id: uid('sms'), userId, to, text, at: t, createdAt: stamp(new Date(t)) }, ...prev].slice(0, 200))
  }
  const textsFor = (phone: string) => {
    const q = phone.replace(/\s/g, '')
    return q ? texts.filter(x => x.to.replace(/\s/g, '') === q) : []
  }
  /** Email gets the activation link and the code together; the phone gets the code only. */
  const sendVerification = (u: AppUser, code: string, invited = false) => {
    const link = activationLink(u.id, code)
    sendEmail(invited ? mail.invitation(u, code, link) : mail.verification(u, code, link), u.id)
    sendSms(u.phone, smsText.verification(code), u.id)
  }
  const emailsFor = (address: string) => {
    const q = address.trim().toLowerCase()
    return q ? emails.filter(e => e.content.to.toLowerCase() === q) : []
  }

  /** In-app notification plus its email twin. Pass `email: false` when a dedicated email is sent instead. */
  const notify = (userId: string, kind: NotifKind, title: string, body: string, link?: string, opts: { email?: boolean } = {}) => {
    if (LIVE) return   // written by the database, with the change that caused it
    const t = Date.now()
    setNotifications(prev => [{ id: uid('n'), userId, kind, title, body, link, read: false, at: t, createdAt: stamp(new Date(t)) }, ...prev])
    const u = findUser(userId)
    if (opts.email !== false && u?.email && u.status !== 'suspended') sendEmail(mail.notification(u, kind, title, body), u.id)
  }
  const logAudit = (action: string, detail: string) => {
    if (LIVE) { if (currentUserId) api.logAudit(currentUserId, action, detail).catch(() => {}); return }
    const t = Date.now()
    setAudit(prev => [{ id: uid('au'), actorId: actorId(), action, detail, at: t, createdAt: stamp(new Date(t)) }, ...prev])
  }

  /* ─ the clock; in demo mode it also runs the escalation rule the backend's scheduled job runs in live mode ─ */
  useEffect(() => {
    const tick = () => {
      const t = Date.now()
      setNow(t)
      if (LIVE) return
      const due = alertsRef.current.filter(a =>
        a.status === 'open' && a.severity === 'danger' && t - a.at > ESCALATE_AFTER_MIN * MIN)
      if (due.length === 0) return
      setAlerts(prev => prev.map(a => due.some(d => d.id === a.id) ? { ...a, status: 'escalated', escalatedAt: stamp(new Date(t)) } : a))
      due.forEach(a => {
        const pt = findUser(a.patientId)
        adminsAndMonitors().forEach(ad => notify(ad.id, 'escalation', `Escalated: ${pt?.name ?? 'Patient'}`,
          `${a.type === 'sos' ? 'SOS' : `${a.vitalName} ${a.value} ${a.unit}`} not acknowledged within ${ESCALATE_AFTER_MIN} min`, 'alerts'))
      })
    }
    tick()
    const h = setInterval(tick, 15_000)
    return () => clearInterval(h)
  }, [])

  const patchUser = (id: string, patch: Partial<AppUser>) =>
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...patch } as AppUser : u))

  const [docSeed] = useState(() => LIVE ? { docs: [], events: [] } : seedDocuments(DEMO.users, DEMO.vitalDefs, DEMO.alerts, NOW))

  /** Live mode: one change against the backend, then a reload. Failures land in the banner and in the outcome. */
  const run = async <T,>(job: () => Promise<T>): Saved<T> => {
    try {
      const value = await job()
      await refresh()
      return { ok: true, value }
    } catch (e) {
      const error = api.explain(e)
      setSaveError(error)
      // No answer at all: what is on screen may be out of date too, and the banner should say so now, not at the next check.
      if (error === api.OFFLINE) setSync(s => ({ ...s, error }))
      return { ok: false, error }
    }
  }

  /**
   * Live mode: save a small change that is already shown on screen (a tick, "read"), without reloading everything.
   * If the save fails, the reload puts back what the database really holds.
   */
  const save = async (job: () => Promise<unknown>): Saved => {
    try {
      await job()
      return { ok: true, value: undefined }
    } catch (e) {
      const error = api.explain(e)
      setSaveError(error)
      void refresh()
      return { ok: false, error }
    }
  }

  const docStore = useDocumentStore({
    currentUserId, usersRef, alertsRef, vitalDefs, notify, logAudit, live: LIVE, run,
    updateUser: (id, patch) => { void updateUser(id, patch) },
  }, docSeed)

  /** Puts a fresh load on screen. */
  const apply = (r: Records) => {
    setUsers(r.users); setVitalDefsState(r.vitalDefs); setAlerts(r.alerts); setAppointments(r.appointments)
    setMessages(r.messages); setNotifications(r.notifications); setDoses(r.doses); setMealsDone(r.mealsDone)
    setReportRequests(r.reportRequests); setClinicalNotes(r.clinicalNotes); setSupportTickets(r.supportTickets); setAudit(r.audit)
    setMealPlans(r.mealPlans); setHydrationLogs(r.hydration); setRatings(r.ratings)
    docStore.hydrateDocuments(r.documents, r.docEvents, r.shareLinks)
    newestNotif.current = r.notifications[0]?.id ?? ''
  }
  const EMPTY: Records = {
    users: [], vitalDefs: [], alerts: [], appointments: [], messages: [], notifications: [], doses: [], mealsDone: [], reportRequests: [],
    clinicalNotes: [], supportTickets: [], audit: [], mealPlans: [], hydration: [], ratings: [], documents: [], docEvents: [], shareLinks: [],
  }

  /** Signs out locally. `notice` says why, when the person did not choose to. */
  const leave = (notice?: string) => {
    signOutBackend()
    loadSeq.current++
    meRef.current = null; pendingRef.current = null
    setCurrentUserId(null)
    if (LIVE) { apply(EMPTY); setSync({ at: null, refreshing: false }) }
    setEnterError(notice)
  }

  const refresh = async () => {
    const me = meRef.current
    if (!LIVE || !me) return
    const mine = ++loadSeq.current
    setSync(s => ({ ...s, refreshing: true }))
    try {
      const records = await loadRecords(me)
      if (mine !== loadSeq.current || meRef.current?.id !== me.id) return   // a newer load is on its way, or they signed out
      apply(records)
      setSync({ at: Date.now(), refreshing: false })
    } catch (e) {
      if (mine !== loadSeq.current) return
      const error = api.explain(e)
      if (/session has ended/i.test(error)) { leave(error); return }
      setSync(s => ({ ...s, refreshing: false, error }))
    }
  }

  const enter = async (account: AppUser, acceptedTerms: boolean) => {
    pendingRef.current = account
    setEntering(true); setEnterError(undefined)
    const mine = ++loadSeq.current
    try {
      // Consent given on the sign-up form is recorded once the account can speak for itself.
      if (acceptedTerms) await api.acceptTerms().catch(() => {})
      const records = await loadRecords(account)
      if (mine !== loadSeq.current) return
      meRef.current = account
      apply(records)
      setSync({ at: Date.now(), refreshing: false })
      setCurrentUserId(account.id)
      pendingRef.current = null
    } catch (e) {
      if (mine === loadSeq.current) setEnterError(api.explain(e))
    } finally {
      setEntering(false)
    }
  }

  const signIn = (account: AppUser, opts: { acceptedTermsAt?: number } = {}) => {
    if (LIVE) { void enter(account, !!opts.acceptedTermsAt); return }
    if (!usersRef.current.some(u => u.id === account.id)) addUser(account)
    if (opts.acceptedTermsAt) patchUser(account.id, { termsAcceptedAt: opts.acceptedTermsAt })
    setCurrentUserId(account.id)
  }
  const retryEnter = () => { if (pendingRef.current) void enter(pendingRef.current, false) }

  const setCurrentUser = (u: AppUser | null) => {
    // Signing out also ends the backend session, or the next load would sign straight back in.
    if (!u) leave()
    else signIn(u)
  }

  // Live mode: keep what is on screen current. A new notification means something changed for this person
  // (the database writes one for every care-team action), so that is checked often and cheaply.
  useEffect(() => {
    if (!LIVE || !currentUserId) return
    let stopped = false
    const visible = () => document.visibilityState === 'visible'
    const check = async () => {
      if (!visible()) return
      try {
        const newest = await latestNotificationId()
        if (stopped) return
        if (newest !== newestNotif.current) await refresh()
        else setSync(s => (s.error ? { ...s, error: undefined } : s))
      } catch (e) {
        if (stopped) return
        const error = api.explain(e)
        if (/session has ended/i.test(error)) leave(error)
        else setSync(s => ({ ...s, error }))
      }
    }
    const quick = setInterval(check, CHECK_EVERY_MS)
    const full = setInterval(() => { if (visible()) void refresh() }, RELOAD_EVERY_MS)
    const onVisible = () => { if (visible()) void refresh() }
    const onOnline = () => { setOnline(true); void refresh() }
    const onOffline = () => setOnline(false)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      stopped = true
      clearInterval(quick); clearInterval(full)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
    // refresh and leave only use refs and state setters, which never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId])

  /* ─ accounts ─ */
  /** Live mode: sends each part of an account change to the table that holds it. */
  const saveAccount = async (id: string, patch: Partial<AppUser>) => {
    const p = patch as Partial<PatientUser> & Partial<DoctorUser> & Partial<AdminUser>
    const profile: api.ProfileChanges = {}
    if ('name' in p && p.name !== undefined) profile.name = p.name
    if ('phone' in p && p.phone !== undefined) profile.phone = p.phone
    if ('dob' in p) profile.dob = p.dob
    if ('avatar' in p) profile.avatar = p.avatar
    if (p.theme) profile.theme = p.theme
    if (p.fontSize) profile.fontSize = p.fontSize
    await api.updateProfile(id, profile)
    if (p.termsAcceptedAt) await api.acceptTerms()
    if (p.health) await api.saveHealth(p.health)
    if (p.trackedVitalIds) await api.setTrackedVitals(p.trackedVitalIds, id === currentUserId ? undefined : id)
    if (p.profileSetup) await api.setProfileSetup(id, p.profileSetup)
    if (p.unitPrefs) await api.setUnitPrefs(id, p.unitPrefs)
    if (p.docPrefs) await api.setDocPrivacyDefault(id, p.docPrefs.privateByDefault)
    if (p.permissions) await api.setAssistantPerms(id, p.permissions)
    // A doctor resubmitting after "sent back" goes through the approval queue; other detail edits are plain saves.
    if (p.approvalStatus === 'pending') await api.resubmitDoctorApplication(p.specialty ?? '', p.licenseNo ?? '', p.hospital ?? '')
    else if ('specialty' in p || 'licenseNo' in p || 'hospital' in p || 'signature' in p)
      await api.setDoctorDetails(id, { specialty: p.specialty, licenseNo: p.licenseNo, hospital: p.hospital, ...('signature' in p ? { signature: p.signature ?? null } : {}) })
  }

  const updateUser = (id: string, patch: Partial<AppUser>): Saved => {
    if (LIVE) return run(() => saveAccount(id, patch))
    patchUser(id, patch)
    return done()
  }

  /** New accounts that still need verifying are emailed their code — as an invitation when an admin created them. */
  const addUser = (u: AppUser, opts: { invited?: boolean } = {}) => {
    if (LIVE) {
      // Accounts are created by the sign-in service. Inviting staff or doctors from here needs a server-side function.
      setSaveError('Creating accounts for other people is not available yet. Ask them to sign up, then set their role.')
      return
    }
    setUsers(prev => [...prev, u])
    if (u.status === 'unverified' && u.verificationCode)
      sendVerification(u, u.verificationCode, opts.invited)
  }
  /** "Didn't receive it?" — a fresh code replaces the old one and is emailed. */
  const resendVerification = (userId: string) => {
    const u = findUser(userId)
    if (!u || u.status !== 'unverified') return
    const code = String(Math.floor(100000 + Math.random() * 900000))
    patchUser(userId, { verificationCode: code })
    sendVerification(u, code)
  }
  /** The user tapped "Activate account" in the email. Proves the address just like typing the code. */
  const verifyByLink = (userId: string, token: string) => {
    const u = findUser(userId)
    return !!u && u.status === 'unverified' && !!u.verificationCode && token === activationToken(u.id, u.verificationCode)
  }
  const sendWelcomeEmail = (userId: string) => {
    const u = findUser(userId)
    if (u) sendEmail(mail.welcome(u), u.id)
  }

  const getDoctors  = () => users.filter(u => u.role === 'doctor')  as DoctorUser[]
  const getPatients = () => users.filter(u => u.role === 'patient') as PatientUser[]
  const getAdmins   = () => users.filter(u => u.role === 'admin' || u.role === 'assistant') as AdminUser[]

  const updateAssistantPerms = (id: string, perms: AssistantPerm[]): Saved => {
    if (LIVE) return run(async () => { await api.setAssistantPerms(id, perms); await api.logAudit(actorId(), 'Changed assistant permissions', `${findUser(id)?.name}: ${perms.length} granted`) })
    patchUser(id, { permissions: perms } as Partial<AdminUser>)
    logAudit('Changed assistant permissions', `${findUser(id)?.name}: ${perms.length} granted`)
    return done()
  }

  /** Demo mode: apply a change to one patient's record held in memory. */
  const patchPatient = (patientId: string, fn: (p: PatientUser) => PatientUser) =>
    setUsers(prev => prev.map(u => u.role === 'patient' && u.id === patientId ? fn(u as PatientUser) : u))

  /** Move a patient to a doctor (or none), keeping both sides of the link consistent. */
  const linkPatient = (list: AppUser[], patientId: string, doctorId: string | null): AppUser[] =>
    list.map(u => {
      if (u.role === 'patient' && u.id === patientId) return { ...u, assignedDoctorId: doctorId ?? undefined } as PatientUser
      if (u.role === 'doctor') {
        const d = u as DoctorUser
        const has = d.assignedPatientIds.includes(patientId)
        if (d.id === doctorId && !has) return { ...d, assignedPatientIds: [...d.assignedPatientIds, patientId] }
        if (d.id !== doctorId && has) return { ...d, assignedPatientIds: d.assignedPatientIds.filter(x => x !== patientId) }
      }
      return u
    })

  const assignPatientToDoctor = (patientId: string, doctorId: string | null): Saved => {
    if (LIVE) return run(() => api.assignDoctor(patientId, doctorId))
    const pt = findUser(patientId)
    const prevDoc = (pt as PatientUser | undefined)?.assignedDoctorId
    setUsers(prev => linkPatient(prev, patientId, doctorId).map(u =>
      u.id === patientId ? { ...u, doctorRequest: undefined } as PatientUser : u))
    if (doctorId) {
      const doc = findUser(doctorId)
      notify(doctorId, 'assignment', 'New patient assigned', `${pt?.name} is now under your care`, 'patients')
      notify(patientId, 'assignment', 'Care team updated', `${doc?.name} is now your doctor`, 'care')
      logAudit('Assigned doctor', `${pt?.name} → ${doc?.name}`)
    } else {
      logAudit('Removed doctor assignment', `${pt?.name}`)
    }
    if (prevDoc && prevDoc !== doctorId) notify(prevDoc, 'assignment', 'Patient reassigned', `${pt?.name} has moved to another doctor`, 'patients')
    return done()
  }

  const resolvePatientRequest = (patientId: string, approve: boolean, note?: string, alternativeDoctorId?: string): Saved => {
    if (LIVE) return run(() => api.decideDoctorRequest(patientId, approve, note, alternativeDoctorId))
    const pt = findUser(patientId) as PatientUser | undefined
    const reqDoc = pt?.doctorRequest?.doctorId
    if (!pt?.doctorRequest || !reqDoc) return refused('That request has already been answered.')
    const target = approve ? reqDoc : alternativeDoctorId ?? null
    setUsers(prev => {
      const linked = target ? linkPatient(prev, patientId, target) : prev
      return linked.map(u => u.id === patientId
        ? { ...u, doctorRequest: { ...pt.doctorRequest!, status: approve ? 'approved' : 'rejected', responseNote: note } } as PatientUser
        : u)
    })
    const docName = (id?: string | null) => findUser(id ?? undefined)?.name
    if (approve) {
      notify(patientId, 'assignment', 'Doctor request approved', `${docName(reqDoc)} is now your doctor`, 'care')
      notify(reqDoc, 'assignment', 'New patient assigned', `${pt.name} is now under your care`, 'patients')
      logAudit('Approved doctor request', `${pt.name} → ${docName(reqDoc)}`)
    } else {
      notify(patientId, 'assignment', 'Doctor request not approved',
        `${note ?? ''}${target ? ` You have been assigned to ${docName(target)}.` : ''}`, 'care')
      if (target) notify(target, 'assignment', 'New patient assigned', `${pt.name} is now under your care`, 'patients')
      logAudit('Rejected doctor request', `${pt.name}${target ? ` — alternative ${docName(target)}` : ''}`)
    }
    return done()
  }

  const setUserStatus = (id: string, status: AccountStatus): Saved => {
    if (LIVE) {
      // Suspending your own account goes through its own rule; the session then ends.
      if (id === currentUserId && status === 'suspended') return run(() => api.deactivateMyAccount())
      return run(() => api.setUserStatus(id, status))
    }
    patchUser(id, { status })
    logAudit(status === 'suspended' ? 'Suspended user' : 'Reactivated user', findUser(id)?.name ?? id)
    return done()
  }

  const decideDoctor = (id: string, status: 'approved' | 'sent_back' | 'rejected', note?: string): Saved => {
    if (LIVE) return run(() => api.decideDoctor(id, status, note))
    patchUser(id, {
      approvalStatus: status,
      approvalNote: note,
      status: status === 'approved' ? 'active' : 'pending_approval',
      ...(status === 'approved' ? { approvedBy: actorId(), approvedAt: dateLabel() } : {}),
    } as Partial<DoctorUser>)
    const name = findUser(id)?.name ?? id
    logAudit(status === 'approved' ? 'Approved doctor' : status === 'sent_back' ? 'Sent back doctor application' : 'Rejected doctor', `${name}${note ? ` — ${note}` : ''}`)
    return done()
  }

  /** Admins edit the vital definitions as one list; in live mode the changed list is saved as it is set. */
  const setVitalDefs: React.Dispatch<React.SetStateAction<VitalDef[]>> = next => {
    setVitalDefsState(prev => {
      const value = typeof next === 'function' ? next(prev) : next
      if (LIVE) void run(() => api.saveVitalDefs(value))
      return value
    })
  }

  /* ─ prescriptions, notes, doses ─ */
  const addPrescription = (patientId: string, rx: Prescription): Saved => {
    if (LIVE) return run(() => api.addPrescription(patientId, rx.doctorId, rx))   // the database notifies, audits and files the document
    patchPatient(patientId, p => ({ ...p, prescriptions: [rx, ...p.prescriptions] }))
    docStore.filePrescription(patientId, rx)
    notify(patientId, 'prescription', 'New prescription', `${rx.medication} — ${rx.frequency}`, 'medicine')
    logAudit('Prescribed', `${rx.medication} for ${findUser(patientId)?.name}`)
    return done()
  }
  const setPrescriptionActive = (patientId: string, rxId: string, active: boolean): Saved => {
    if (LIVE) return run(() => api.setPrescriptionActive(rxId, active))
    patchPatient(patientId, p => ({ ...p, prescriptions: p.prescriptions.map(x => x.id === rxId ? { ...x, active } : x) }))
    const rx = (findUser(patientId) as PatientUser | undefined)?.prescriptions.find(x => x.id === rxId)
    if (rx && !active) notify(patientId, 'prescription', 'Medication stopped', `${rx.medication} has been discontinued by your doctor`, 'medicine')
    return done()
  }
  const toggleDose = (patientId: string, rxId: string, slot: number): Saved => {
    const day = dayKey()
    const same = (d: MedDose) => d.patientId === patientId && d.rxId === rxId && d.day === day && d.slot === slot
    const taken = !dosesRef.current.some(same)
    setDoses(prev => prev.some(same) ? prev.filter(d => !same(d)) : [...prev, { patientId, rxId, slot, day, takenAt: stamp() }])
    return LIVE ? save(() => api.setDose(patientId, rxId, slot, day, taken)) : done()
  }
  const toggleMeal = (patientId: string, mealId: string, note?: string): Saved => {
    const day = dayKey()
    const same = (m: MealDone) => m.patientId === patientId && m.mealId === mealId && m.day === day
    const eaten = !mealsRef.current.some(same)
    setMealsDone(prev => prev.some(same) ? prev.filter(m => !same(m)) : [...prev, { patientId, mealId, day, takenAt: stamp(), ...(note ? { note } : {}) }])
    return LIVE ? save(() => api.setMeal(patientId, mealId, day, eaten, note)) : done()
  }
  const setHydration = (patientId: string, glasses: number): Saved => {
    const day = dayKey()
    const count = Math.max(0, Math.min(30, Math.round(glasses)))
    setHydrationLogs(prev => [...prev.filter(h => !(h.patientId === patientId && h.day === day)), { patientId, day, glasses: count }])
    return LIVE ? save(() => api.setHydration(patientId, day, count)) : done()
  }
  const rateDoctor = (patientId: string, doctorId: string, rating: number, comment?: string): Saved => {
    if (LIVE) return run(() => api.rateDoctor(patientId, doctorId, rating, comment))
    setRatings(prev => [...prev.filter(r => !(r.patientId === patientId && r.doctorId === doctorId)), { patientId, doctorId, rating, comment: comment?.trim() || undefined }])
    return done()
  }
  const setDoctorNote = (patientId: string, note: string): Saved => {
    if (!note.trim()) return refused('Write the note first.')
    if (LIVE) return run(() => api.addClinicalNote(patientId, actorId(), note))
    const t = Date.now()
    setClinicalNotes(prev => [{ id: uid('cn'), patientId, authorId: actorId(), content: note.trim(), at: t, createdAt: stamp(new Date(t)) }, ...prev])
    patchPatient(patientId, p => ({ ...p, doctorNote: note.trim() }))
    notify(patientId, 'message', 'New note from your doctor', note.trim().slice(0, 80), 'vitals')
    return done()
  }

  const setUnitPref = (patientId: string, vitalId: string, unit: string): Saved => {
    if (LIVE) {
      const prefs = (findUser(patientId) as PatientUser | undefined)?.unitPrefs ?? {}
      return run(() => api.setUnitPrefs(patientId, { ...prefs, [vitalId]: unit }))
    }
    patchPatient(patientId, p => ({ ...p, unitPrefs: { ...p.unitPrefs, [vitalId]: unit } }))
    return done()
  }

  const setThreshold = (patientId: string, vitalId: string, range: { min: number; max: number }): Saved => {
    if (LIVE) return run(() => api.setThreshold(patientId, vitalId, range))
    patchPatient(patientId, p => ({
      ...p,
      thresholds: { ...p.thresholds, [vitalId]: range },
      targetLog: [...(p.targetLog ?? []), { vitalId, at: Date.now(), from: p.thresholds[vitalId], to: range, by: actorId() }],
    }))
    return done()
  }

  const setCriticalThreshold = (patientId: string, vitalId: string, range: { min: number; max: number } | null): Saved => {
    if (LIVE) {
      const pt = findUser(patientId) as PatientUser | undefined
      const def = vitalDefs.find(v => v.id === vitalId)
      if (!pt || !def) return refused('That vital is no longer available.')
      return run(() => api.setCriticalThreshold(patientId, vitalId, range, targetRange(pt, def)))
    }
    patchPatient(patientId, p => {
      const next = { ...p.criticalThresholds }
      if (range) next[vitalId] = range
      else delete next[vitalId]
      return { ...p, criticalThresholds: next }
    })
    return done()
  }

  /* ─ alert engine (demo mode; in live mode the database runs these same rules when a reading is saved) ─ */
  const createAlert = (pt: PatientUser, def: VitalDef, reading: VitalReading, severity: 'danger' | 'warning') => {
    const t = Date.now()
    const alert: AppAlert = {
      id: uid('al'), patientId: pt.id, vitalId: def.id, vitalName: def.name, value: reading.value, unit: def.unit,
      severity, type: 'vital', status: 'open', resolved: false, at: t, loggedAt: stamp(new Date(t)), readingId: reading.id,
    }
    setAlerts(prev => [alert, ...prev])
    const title = `${severity === 'danger' ? 'Critical' : 'Warning'}: ${pt.name}`
    const body = `${def.name} ${reading.value} ${def.unit}`
    if (pt.assignedDoctorId) notify(pt.assignedDoctorId, 'alert', title, body, 'alerts')
    if (severity === 'danger' || !pt.assignedDoctorId)
      adminsAndMonitors().forEach(a => notify(a.id, 'alert', title, `${body}${pt.assignedDoctorId ? '' : ' — patient has no doctor'}`, 'alerts'))
    notify(pt.id, 'alert', severity === 'danger' ? 'Critical reading — your doctor has been alerted' : 'Reading sent to your doctor', body, 'alerts')
  }

  const logReading = (patientId: string, reading: VitalReading): Saved<LogResult> => {
    if (LIVE) return run(async () => {
      const saved = await api.logReading(patientId, reading.vitalId, reading.value, reading.note)
      return { level: saved.level, alerted: saved.alerted, readingId: saved.readingId, cleared: saved.cleared }
    })
    const pt = findUser(patientId) as PatientUser | undefined
    const def = vitalDefs.find(v => v.id === reading.vitalId)
    const t = Date.now()
    const full: VitalReading = { ...reading, at: t, loggedAt: stamp(new Date(t)), recordedBy: actorId() }
    patchPatient(patientId, p => ({ ...p, readings: [full, ...p.readings] }))
    if (!pt || !def) return done({ level: 'normal', alerted: false, readingId: full.id })
    const level = evaluate(pt, def, full.value)
    const label = `${def.name} ${full.value} ${def.unit}`

    // A doctor asked for a re-check on this vital. An in-range reading closes a warning;
    // a critical alert is never closed by a number alone, so it goes back to the doctor.
    const pendingRecheck = alertsRef.current.find(a =>
      a.patientId === patientId && alertIsFor(a, def) && a.recheckRequestedAt && a.status !== 'resolved')
    if (pendingRecheck && level === 'normal') {
      if (pendingRecheck.severity === 'warning') {
        setAlerts(prev => prev.map(a => a.id === pendingRecheck.id
          ? { ...a, status: 'resolved', resolved: true, resolvedAt: stamp(), resolvedBy: patientId, recheckReadingId: full.id,
              resolutionReason: 'Re-check back in range', resolutionNote: `New reading ${label}` }
          : a))
        notify(pendingRecheck.patientId, 'alert', 'Alert resolved', `${def.name}: your new reading is back in range`, 'alerts')
        return done({ level, alerted: false, readingId: full.id, cleared: true })
      }
      setAlerts(prev => prev.map(a => a.id === pendingRecheck.id ? { ...a, recheckReadingId: full.id } : a))
      notify(pendingRecheck.patientId, 'alert', 'Re-check received', `${def.name}: your new reading is in range. Your doctor will review it and close the alert.`, 'alerts')
      if (pt.assignedDoctorId) notify(pt.assignedDoctorId, 'alert', `Re-check in range: ${pt.name}`, `${label} · review and resolve the alert`, 'alerts')
      return done({ level, alerted: false, readingId: full.id })
    }

    // Self-clear: a warning the patient raised themselves can be cleared by an
    // in-range re-measurement within SELF_CLEAR_WINDOW_MIN. Critical alerts are
    // excluded — a clinician always reviews those — and so is anything the care
    // team has already picked up.
    const selfClearable = alertsRef.current.find(a =>
      a.patientId === patientId && alertIsFor(a, def) && a.type === 'vital' &&
      a.severity === 'warning' && a.status === 'open' &&
      t - a.at <= SELF_CLEAR_WINDOW_MIN * MIN)
    if (selfClearable && level === 'normal') {
      setAlerts(prev => prev.map(a => a.id === selfClearable.id
        ? { ...a, status: 'resolved', resolved: true, resolvedAt: stamp(), resolvedBy: patientId, recheckReadingId: full.id,
            resolutionReason: 'Re-measured in range by patient', resolutionNote: `New reading ${label}` }
        : a))
      notify(patientId, 'alert', 'Alert cleared', `${def.name}: your new reading is back in range`, 'alerts')
      if (pt.assignedDoctorId)
        notify(pt.assignedDoctorId, 'alert', `Alert cleared: ${pt.name}`,
          `${def.name} re-measured at ${full.value} ${def.unit} — back in range`, 'alerts')
      logAudit('Alert self-cleared', `${pt.name} · ${label}`)
      return done({ level, alerted: false, readingId: full.id, cleared: true })
    }

    if (level === 'normal') return done({ level, alerted: false, readingId: full.id })
    if (level === 'critical') { createAlert(pt, def, full, 'danger'); return done({ level, alerted: true, readingId: full.id }) }
    // Warning: ask the patient to re-measure first — alert only if the previous reading (last 60 min) was also abnormal
    const prev = pt.readings.find(x => x.vitalId === def.id && !x.invalid && x.at && t - x.at < 60 * MIN)
    const repeat = prev && evaluate(pt, def, prev.value) !== 'normal'
    if (repeat) { createAlert(pt, def, full, 'warning'); return done({ level, alerted: true, readingId: full.id }) }
    return done({ level, alerted: false, readingId: full.id })
  }

  const sendAlertNow = (patientId: string, readingId: string): Saved => {
    if (LIVE) return run(() => api.sendAlertNow(readingId))
    const pt = findUser(patientId) as PatientUser | undefined
    const rd = pt?.readings.find(x => x.id === readingId)
    const def = vitalDefs.find(v => v.id === rd?.vitalId)
    if (!pt || !rd || !def) return refused('That reading could not be found.')
    if (alertsRef.current.some(a => a.readingId === readingId)) return done()
    createAlert(pt, def, rd, evaluate(pt, def, rd.value) === 'critical' ? 'danger' : 'warning')
    return done()
  }

  const canCorrect = (reading: VitalReading) =>
    !!reading.at && Date.now() - reading.at < CORRECTION_WINDOW_MIN * MIN && (!reading.recordedBy || reading.recordedBy === currentUserId)

  const correctReading = (patientId: string, readingId: string, value: string): Saved => {
    if (LIVE) return run(() => api.correctReading(readingId, value))
    const pt = findUser(patientId) as PatientUser | undefined
    const rd = pt?.readings.find(x => x.id === readingId)
    const def = vitalDefs.find(v => v.id === rd?.vitalId)
    patchPatient(patientId, p => ({ ...p, readings: p.readings.map(x => x.id === readingId ? { ...x, value, correctedFrom: x.correctedFrom ?? x.value } : x) }))
    if (!pt || !def) return done()
    const level = evaluate(pt, def, value)
    setAlerts(prev => prev.map(a => a.readingId !== readingId || a.status === 'resolved' ? a
      : level === 'normal'
        ? { ...a, status: 'resolved', resolved: true, resolvedAt: stamp(), resolvedBy: patientId, resolutionReason: 'Corrected by patient',
            resolutionNote: `Entered as ${rd?.value}, corrected to ${value} ${def.unit}` }
        : { ...a, value, severity: level === 'critical' ? 'danger' : 'warning' }))
    return done()
  }

  const invalidateReading = (patientId: string, readingId: string, reason: string): Saved => {
    if (LIVE) return run(() => api.invalidateReading(readingId, reason))
    patchPatient(patientId, p => ({ ...p, readings: p.readings.map(x => x.id === readingId ? { ...x, invalid: true, invalidReason: reason } : x) }))
    logAudit('Marked reading invalid', `${findUser(patientId)?.name} — ${reason}`)
    return done()
  }

  const raiseSOS = (patientId: string, message: string): Saved => {
    if (LIVE) return run(async () => { await api.raiseSos(message) })
    const pt = findUser(patientId) as PatientUser | undefined
    if (!pt) return refused('Account not found.')
    // Pressing again while one is open keeps the one alert.
    if (alertsRef.current.some(a => a.patientId === patientId && a.type === 'sos' && a.status !== 'resolved')) return done()
    const t = Date.now()
    setAlerts(prev => [{
      id: uid('sos'), patientId, type: 'sos', vitalName: 'SOS', value: message || 'Emergency help requested', unit: '',
      severity: 'danger', status: 'open', resolved: false, at: t, loggedAt: stamp(new Date(t)),
    }, ...prev])
    const body = message || 'Patient pressed the emergency button'
    if (pt.assignedDoctorId) notify(pt.assignedDoctorId, 'sos', `SOS: ${pt.name}`, body, 'alerts')
    adminsAndMonitors().forEach(a => notify(a.id, 'sos', `SOS: ${pt.name}`, body, 'alerts'))
    logAudit('SOS raised', pt.name)
    return LIVE ? save(() => api.raiseSos(message)) : done()
  }

  const acknowledgeAlert = (alertId: string): Saved => {
    if (LIVE) return run(() => api.acknowledgeAlert(alertId))
    setAlerts(prev => prev.map(a => a.id === alertId && a.status !== 'resolved'
      ? { ...a, status: 'acknowledged', acknowledgedAt: stamp(), acknowledgedBy: actorId() } : a))
    const a = alertsRef.current.find(x => x.id === alertId)
    const by = findUser(actorId())
    if (a) notify(a.patientId, 'alert', 'Your alert is being reviewed', `${by?.name ?? 'Your care team'} is looking at your ${a.type === 'sos' ? 'SOS' : a.vitalName} alert`, 'alerts')
    return done()
  }

  const resolveAlert = (alertId: string, reason: string, note?: string): Saved => {
    const a = alertsRef.current.find(x => x.id === alertId)
    if (!reason.trim()) return refused('Give a reason for resolving the alert.')
    if (LIVE) {
      // A patient closes only their own SOS ("I'm safe now"); everything else is the care team's decision.
      const own = a?.type === 'sos' && a.patientId === currentUserId
      return run(() => (own ? api.cancelSos(alertId) : api.resolveAlert(alertId, reason, note)))
    }
    if (a?.status === 'resolved') return refused('That alert is already resolved.')
    setAlerts(prev => prev.map(x => x.id === alertId
      ? { ...x, status: 'resolved', resolved: true, resolvedAt: stamp(), resolvedBy: actorId(), resolutionReason: reason, resolutionNote: note?.trim() || undefined }
      : x))
    if (a) {
      notify(a.patientId, 'alert', 'Alert resolved', `${a.type === 'sos' ? 'SOS' : a.vitalName}: ${reason}`, 'alerts')
      logAudit('Resolved alert', `${findUser(a.patientId)?.name} · ${a.type === 'sos' ? 'SOS' : a.vitalName} — ${reason}`)
    }
    return done()
  }

  const escalateAlert = (alertId: string): Saved => {
    if (LIVE) return run(() => api.escalateAlert(alertId))
    const a = alertsRef.current.find(x => x.id === alertId)
    setAlerts(prev => prev.map(x => x.id === alertId ? { ...x, status: 'escalated', escalatedAt: stamp() } : x))
    if (a) {
      const pt = findUser(a.patientId)
      adminsAndMonitors().forEach(ad => notify(ad.id, 'escalation', `Escalated by ${findUser(actorId())?.name}`, `${pt?.name} · ${a.vitalName} ${a.value} ${a.unit}`, 'alerts'))
      logAudit('Escalated alert', `${pt?.name} · ${a.vitalName}`)
    }
    return done()
  }

  const requestRecheck = (alertId: string): Saved => {
    if (LIVE) return run(() => api.requestRecheck(alertId))
    const t = Date.now()
    setAlerts(prev => prev.map(x => x.id === alertId && x.status !== 'resolved' ? { ...x, recheckRequestedAt: t } : x))
    const a = alertsRef.current.find(x => x.id === alertId)
    if (a) {
      notify(a.patientId, 'alert', 'Please log a new reading',
        `${findUser(actorId())?.name ?? 'Your doctor'} asked you to re-check your ${a.type === 'sos' ? 'condition' : a.vitalName}`, 'vitals')
      logAudit('Requested re-check', `${findUser(a.patientId)?.name} · ${a.vitalName}`)
    }
    return done()
  }

  const chaseDoctor = (alertId: string): Saved => {
    if (LIVE) return run(() => api.chaseAlert(alertId))
    const a = alertsRef.current.find(x => x.id === alertId)
    const pt = a && (findUser(a.patientId) as PatientUser | undefined)
    if (!a || !pt?.assignedDoctorId) return refused('This patient has no doctor to chase.')
    notify(pt.assignedDoctorId, 'escalation', `Urgent: ${pt.name}`,
      `${findUser(actorId())?.name ?? 'An administrator'} asks you to respond to ${a.type === 'sos' ? 'an SOS' : `${a.vitalName} ${a.value}`}`, 'alerts')
    return done()
  }

  const scheduleFollowUp = (patientId: string, doctorId: string, date: string, time: string, note: string | undefined, alertId?: string): Saved => {
    if (LIVE) return run(async () => {
      await api.addAppointment({
        patientId, doctorId, title: 'Follow-up appointment', reason: note?.trim() || 'Scheduled from alert review',
        date: isoDay(date) ?? date, time: isoClock(time) ?? '', status: 'approved', approvalNote: note,
      })
      if (alertId) await api.resolveAlert(alertId, 'Appointment scheduled', note)
    })
    const t = Date.now()
    void addAppointment({
      id: uid('ap'), patientId, doctorId, title: 'Follow-up appointment', reason: note?.trim() || 'Scheduled from alert review',
      preferredDate: date, preferredTime: time, status: 'approved', approvalNote: note?.trim() || undefined, createdAt: stamp(new Date(t)), at: t,
    })
    if (alertId) void resolveAlert(alertId, 'Appointment scheduled', note)
    return done()
  }

  /* ─ appointments & messages ─ */
  const addAppointment = (appt: Appointment): Saved => {
    if (LIVE) {
      const date = isoDay(appt.preferredDate)
      if (!date) return refused('Choose a valid date.')
      return run(() => api.addAppointment({
        patientId: appt.patientId, doctorId: appt.doctorId, title: appt.title, reason: appt.reason, date,
        time: isoClock(appt.preferredTime) ?? '', location: appt.location,
        ...(appt.status !== 'requested' ? { status: appt.status, approvalNote: appt.approvalNote } : {}),
      }))
    }
    setAppointments(prev => [...prev, appt])
    notify(appt.doctorId, 'appointment', 'New appointment request', `${findUser(appt.patientId)?.name} · ${appt.title} · ${appt.preferredDate}`, 'appts')
    return done()
  }
  const updateAppointment = (apptId: string, patch: Partial<Appointment>): Saved => {
    if (LIVE) return run(() => api.updateAppointment(apptId, patch))
    const ap = appointments.find(a => a.id === apptId)
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, ...patch } : a))
    if (ap && patch.status) {
      const target = currentUserId === ap.patientId ? ap.doctorId : ap.patientId
      notify(target, 'appointment', `Appointment ${patch.status}`, `${ap.title}${patch.rescheduledTo ? ` → ${patch.rescheduledTo} ${patch.rescheduledTime ?? ''}` : ''}`, 'appts')
    }
    return done()
  }

  /* ─ vitals report requests: patient asks → doctor drafts, signs and releases ─ */
  const requestReport = (patientId: string, periodDays: number, reason: string): Saved => {
    const pt = findUser(patientId) as PatientUser | undefined
    if (!pt?.assignedDoctorId) return refused('Choose a care team first.')
    if (LIVE) return run(() => api.requestReport(patientId, pt.assignedDoctorId!, periodDays, reason))
    const t = Date.now()
    setReportRequests(prev => [{ id: uid('rr'), patientId, doctorId: pt.assignedDoctorId!, periodDays, reason: reason.trim(), status: 'pending', at: t, createdAt: stamp(new Date(t)) }, ...prev])
    notify(pt.assignedDoctorId, 'document', `Report request: ${pt.name}`, `Vitals report for the last ${periodDays} days${reason.trim() ? ` — ${reason.trim()}` : ''}`, 'patients')
    logAudit('Requested report', `${periodDays}-day vitals report`)
    return done()
  }
  const fulfillReportRequest = async (id: string, opts: { days?: number; interpretation?: string; include?: VitalsReportInclude } = {}) => {
    const rq = reportRequests.find(r => r.id === id)
    if (!rq || rq.status !== 'pending') return null
    const docId = await docStore.generateVitalsReport(rq.patientId, opts.days ?? rq.periodDays, opts.interpretation, opts.include)
    if (!docId) return null
    if (LIVE) {
      const linked = await run(() => api.fulfilReportRequest(id, docId))
      return linked.ok ? docId : null
    }
    setReportRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'fulfilled', docId, handledAt: stamp() } : r))
    notify(rq.patientId, 'document', 'Your report is being prepared', `Your doctor drafted your ${rq.periodDays}-day vitals report. You'll get it once it's signed.`, 'docs')
    return docId
  }
  const declineReportRequest = (id: string, reason: string): Saved => {
    if (LIVE) return run(() => api.declineReportRequest(id, reason))
    const rq = reportRequests.find(r => r.id === id)
    if (!rq) return refused('That request could not be found.')
    setReportRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'declined', declineReason: reason.trim(), handledAt: stamp() } : r))
    notify(rq.patientId, 'document', 'Report request declined', reason.trim() || 'Your doctor could not prepare this report.', 'docs')
    return done()
  }

  const sendMessage = (fromId: string, toId: string, content: string): Saved => {
    if (!content.trim()) return refused('Write a message first.')
    if (LIVE) return run(() => api.sendMessage(fromId, toId, content))
    setMessages(prev => [...prev, { id: uid('msg'), fromId, toId, content, sentAt: stamp(), read: false }])
    notify(toId, 'message', `New message from ${findUser(fromId)?.name ?? 'mCare'}`, content.slice(0, 80),
      findUser(toId)?.role === 'patient' ? 'messages' : 'patients')
    return done()
  }
  const markMessagesRead = (fromId: string, toId: string): Saved => {
    setMessages(prev => prev.map(m => m.fromId === fromId && m.toId === toId && !m.read ? { ...m, read: true } : m))
    return LIVE ? save(() => api.markMessagesRead(fromId, toId)) : done()
  }
  const markNotificationRead = (id: string): Saved => {
    // Shown as read at once; the save follows.
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    return LIVE ? save(() => api.markNotificationRead(id)) : done()
  }
  const markAllNotificationsRead = (userId: string): Saved => {
    setNotifications(prev => prev.map(n => n.userId === userId ? { ...n, read: true } : n))
    return LIVE ? save(() => api.markAllNotificationsRead(userId)) : done()
  }

  /* ─ account self-service: password recovery (demo mode; live mode uses the sign-in service, see shared/auth/LiveAuth) ───
     Every password change — self-service or forgotten — is gated behind a
     one-time challenge the user must clear first: a 6-digit code they type,
     or the magic link they tap. `resetToken` holds the single outstanding
     challenge; it expires, counts wrong attempts, and is consumed on use. */

  /** Masks an email or phone for display: "ja•••@example.com", "+254 7•• ••• 678". */
  const maskChannel = (value: string, channel: ResetChannel) => {
    if (channel === 'sms') {
      const digits = value.replace(/\s/g, '')
      return digits.length <= 4 ? digits : `${digits.slice(0, 4)}•••••${digits.slice(-3)}`
    }
    const [local = '', domain = ''] = value.split('@')
    const head = local.slice(0, 2)
    return `${head}${'•'.repeat(Math.max(3, local.length - 2))}@${domain}`
  }

  /** Which recovery channels this account can actually use right now. */
  const recoveryChannels = (userId: string): ResetChannel[] => {
    const u = findUser(userId)
    if (!u) return []
    const out: ResetChannel[] = []
    if (u.email.trim()) out.push('email')
    if (u.phone.trim()) out.push('sms')
    return out
  }

  /**
   * Issues a fresh code + magic link on the chosen channel, replacing any
   * outstanding one. Returns the same shape whether or not the account
   * exists, so the UI can't be used to enumerate registered emails.
   */
  const requestPasswordReset = (identifier: string, channel: ResetChannel = 'email') => {
    const q = identifier.trim().toLowerCase()
    const u = usersRef.current.find(x =>
      x.email.toLowerCase() === q || x.phone.replace(/\s/g, '') === q.replace(/\s/g, ''))
    if (!u) return { ok: false as const, error: 'no_account' }

    const destination = channel === 'sms' ? u.phone : u.email
    if (!destination.trim()) {
      return { ok: false as const, error: channel === 'sms' ? 'no_phone' : 'no_email' }
    }

    const t = Date.now()
    const token: ResetToken = {
      code: Math.floor(100000 + Math.random() * 900000).toString(),
      linkToken: `${uid('lnk')}${Math.random().toString(36).slice(2, 10)}`,
      channel,
      sentTo: maskChannel(destination, channel),
      issuedAt: t,
      expiresAt: t + RESET_TTL_MIN * MIN,
      attempts: 0,
    }
    patchUser(u.id, { resetToken: token })
    if (channel === 'sms') sendSms(u.phone, smsText.passwordReset(token.code), u.id)
    else
      sendEmail(mail.passwordReset(u, token.code, `${appBaseUrl()}?reset=${encodeURIComponent(u.id)}.${token.linkToken}`), u.id)
    notify(u.id, 'account', 'Password reset requested',
      `A reset code was sent to ${token.sentTo}. It expires in ${RESET_TTL_MIN} minutes.`, undefined, { email: false })
    logAudit('Requested password reset', `${u.name} · via ${channel}`)
    return { ok: true as const, token, userId: u.id }
  }

  /** Shared guard: returns the live token or the reason it can't be used. */
  const liveToken = (u: AppUser | undefined) => {
    if (!u) return { error: 'Account not found.' }
    const tk = u.resetToken
    if (!tk) return { error: 'No reset in progress. Request a new code.' }
    if (Date.now() > tk.expiresAt) return { error: 'That code has expired. Request a new one.' }
    if (tk.attempts >= MAX_RESET_ATTEMPTS) return { error: 'Too many incorrect attempts. Request a new code.' }
    return { token: tk }
  }

  /** Step 1 of a reset: prove the code. Does not change the password. */
  const verifyResetCode = (userId: string, code: string) => {
    const u = findUser(userId)
    const { token, error } = liveToken(u)
    if (!token) return { ok: false as const, error }
    if (token.code !== code.trim()) {
      const attempts = token.attempts + 1
      patchUser(userId, { resetToken: { ...token, attempts } })
      const left = MAX_RESET_ATTEMPTS - attempts
      return {
        ok: false as const,
        error: left > 0
          ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} remaining.`
          : 'Too many incorrect attempts. Request a new code.',
      }
    }
    patchUser(userId, { resetToken: { ...token, verifiedAt: Date.now() } })
    return { ok: true as const }
  }

  /** Step 1 alternative: the user tapped the magic link in their email/SMS. */
  const verifyResetLink = (userId: string, linkToken: string) => {
    const u = findUser(userId)
    const { token, error } = liveToken(u)
    if (!token) return { ok: false as const, error }
    if (token.linkToken !== linkToken) return { ok: false as const, error: 'That link is not valid.' }
    patchUser(userId, { resetToken: { ...token, verifiedAt: Date.now() } })
    return { ok: true as const }
  }

  /** Step 2: set the new password. Only works once the token is verified. */
  const setPasswordAfterVerification = (userId: string, newPw: string) => {
    const u = findUser(userId)
    const { token, error } = liveToken(u)
    if (!token) return { ok: false as const, error }
    if (!token.verifiedAt) return { ok: false as const, error: 'Verify the code or link first.' }
    const strength = passwordIssue(newPw)
    if (strength) return { ok: false as const, error: strength }
    if (u && u.password === newPw) return { ok: false as const, error: 'New password must differ from your current one.' }

    patchUser(userId, {
      password: newPw,
      resetToken: undefined,          // single use — burned on success
      lastPasswordChangeAt: Date.now(),
      authProvider: u?.authProvider === 'email' || !u?.authProvider ? 'email' : u.authProvider,
    })
    notify(userId, 'account', 'Password changed',
      'Your password was reset. If this wasn\'t you, contact support immediately.', undefined, { email: false })
    if (u) sendEmail(mail.passwordChanged(u), u.id)
    logAudit('Reset password', `${u?.name} · verified by ${token.channel === 'sms' ? 'SMS OTP' : 'email'}`)
    return { ok: true as const }
  }

  /**
   * In-app change. The current password alone is not enough — the caller must
   * have cleared a code/link challenge first, same as a forgotten reset.
   */
  const changePassword = (id: string, currentPw: string, newPw: string) => {
    const u = findUser(id)
    if (!u) return { ok: false as const, error: 'Account not found.' }
    if (u.password && u.password !== currentPw) return { ok: false as const, error: 'Current password is incorrect.' }
    const { token } = liveToken(u)
    if (!token?.verifiedAt) return { ok: false as const, error: 'Verify the code sent to you first.' }
    const strength = passwordIssue(newPw)
    if (strength) return { ok: false as const, error: strength }
    if (newPw === currentPw) return { ok: false as const, error: 'New password must differ from your current one.' }

    patchUser(id, { password: newPw, resetToken: undefined, lastPasswordChangeAt: Date.now() })
    notify(id, 'account', 'Password changed', 'Your password was updated successfully.', undefined, { email: false })
    sendEmail(mail.passwordChanged(u), u.id)
    logAudit('Changed password', u.name)
    return { ok: true as const }
  }

  /** Last resort: no email and no phone on file → raise a ticket for an admin. */
  const requestAdminPasswordHelp = (identifier: string, note: string) => {
    const q = identifier.trim().toLowerCase()
    const u = usersRef.current.find(x => x.email.toLowerCase() === q)
    const t = Date.now()
    const subject = 'Password reset assistance'
    const message = u
      ? `${u.name} (${u.email}) cannot access their recovery channels. ${note}`.trim()
      : `Unrecognised identifier "${identifier}". ${note}`.trim()
    setSupportTickets(prev => [{
      id: uid('tix'), userId: u?.id ?? 'unknown', subject, message,
      status: 'open', at: t, createdAt: stamp(new Date(t)),
    }, ...prev])
    usersRef.current
      .filter(x => (x.role === 'admin' || (x.role === 'assistant' && (x as AdminUser).permissions.includes('handle_support'))) && x.status === 'active')
      .forEach(a => notify(a.id, 'account', 'Password reset assistance', message, 'support'))
    logAudit('Requested admin password help', identifier)
    return { ok: true as const }
  }

  /** Sign in / sign up through a social provider. Creates the patient on first use. */
  const socialAuth = (provider: Exclude<AuthProvider, 'email'>, email: string, name: string) => {
    const existing = usersRef.current.find(u => u.email.toLowerCase() === email.trim().toLowerCase())
    if (existing) {
      // An account without a provider signs in with its password; a social button must not open it.
      const registered = existing.authProvider ?? 'email'
      if (registered !== provider) {
        return { ok: false as const, error: `This email is registered with ${AUTH_PROVIDER_LABELS[registered]}. Sign in that way instead.` }
      }
      logAudit('Signed in', `${existing.name} · ${AUTH_PROVIDER_LABELS[provider]}`)
      return { ok: true as const, user: existing, isNew: false }
    }
    const newPatient: PatientUser = {
      id: uid('p'),
      name: name.trim() || email.split('@')[0],
      email: email.trim(),
      phone: '',
      role: 'patient',
      // Provider already vouched for the email — no separate code to type.
      status: 'active',
      createdAt: dateLabel(new Date()),
      verificationCode: '',
      password: '',
      authProvider: provider,
      trackedVitalIds: ['bp', 'hr'],
      thresholds: {},
      prescriptions: [],
      readings: [],
      emergencyContacts: [],
      profileSetup: 'pending',
    }
    addUser(newPatient)
    logAudit('Registered', `${newPatient.name} · ${AUTH_PROVIDER_LABELS[provider]}`)
    return { ok: true as const, user: newPatient, isNew: true }
  }

  /* ─ support tickets ─ */
  const createSupportTicket = (userId: string, subject: string, message: string): Saved => {
    if (LIVE) return run(() => api.createSupportTicket(userId, subject, message))
    const t = Date.now()
    const u = findUser(userId)
    setSupportTickets(prev => [{ id: uid('tix'), userId, subject, message, status: 'open', at: t, createdAt: stamp(new Date(t)) }, ...prev])
    usersRef.current
      .filter(x => (x.role === 'admin' || (x.role === 'assistant' && (x as AdminUser).permissions.includes('handle_support'))) && x.status === 'active')
      .forEach(a => notify(a.id, 'account', `Support request: ${u?.name ?? 'User'}`, subject, 'support'))
    return done()
  }
  const resolveSupportTicket = (ticketId: string, note?: string): Saved => {
    if (LIVE) return run(() => api.resolveSupportTicket(ticketId, note))
    const t = Date.now()
    setSupportTickets(prev => prev.map(x => x.id === ticketId
      ? { ...x, status: 'resolved', resolvedBy: actorId(), resolutionNote: note, resolvedAt: stamp(new Date(t)) }
      : x))
    const ticket = supportTickets.find(x => x.id === ticketId)
    if (ticket) notify(ticket.userId, 'account', 'Support request resolved', note || `"${ticket.subject}" has been resolved.`)
    return done()
  }

  return (
    <AppContext.Provider value={{
      ...docStore,
      now, live: LIVE, currentUser, setCurrentUser, signIn, entering, enterError, retryEnter,
      sync, online, refresh, run, saveError, clearSaveError: () => setSaveError(undefined),
      users, vitalDefs, setVitalDefs,
      updateUser, addUser,
      getDoctors, getPatients, getAdmins,
      updateAssistantPerms, assignPatientToDoctor, resolvePatientRequest, setUserStatus, decideDoctor,
      addPrescription, setPrescriptionActive, logReading, correctReading, invalidateReading, sendAlertNow,
      setDoctorNote, setUnitPref, setThreshold, setCriticalThreshold, clinicalNotes, doses, toggleDose, mealsDone, toggleMeal,
      mealPlans, hydration, setHydration, ratings, rateDoctor,
      alerts, raiseSOS, acknowledgeAlert, resolveAlert, escalateAlert, requestRecheck, chaseDoctor, scheduleFollowUp,
      appointments, addAppointment, updateAppointment,
      reportRequests, requestReport, fulfillReportRequest, declineReportRequest,
      messages, sendMessage, markMessagesRead,
      notifications, notify, markNotificationRead, markAllNotificationsRead,
      emails, emailsFor, texts, textsFor, resendVerification, verifyByLink, sendWelcomeEmail,
      audit, logAudit, canCorrect,
      changePassword, requestPasswordReset, verifyResetCode, verifyResetLink,
      setPasswordAfterVerification, recoveryChannels, requestAdminPasswordHelp, socialAuth,
      supportTickets, createSupportTicket, resolveSupportTicket,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const c = useContext(AppContext)
  if (!c) throw new Error('useApp outside AppProvider')
  return c
}

/** Active = anything not resolved. Resolved alerts disappear from every active view. */
export const isActiveAlert = (a: AppAlert) => a.status !== 'resolved'

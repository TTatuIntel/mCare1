import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  AppUser, VitalDef, PatientUser, DoctorUser, AdminUser, AssistantPerm, Prescription, VitalReading,
  AppAlert, AlertCommentKind, Appointment, ApptEvent, PatientMessage, AppNotification, NotifKind, AuditEntry, ClinicalNote, MedDose, MealDone, ReportRequest,
  AccountStatus, SupportTicket, ResetToken, ResetChannel, AuthProvider, VitalsReportInclude, EmailContent, SentEmail, SentSms,
  MealPlan, HydrationLog, DoctorRating, Outcome, Invitation, UserRole, ReportNote,
  CarePlan, CarePlanDraft, CarePlanItemStatus, CarePlanStatus, CareAssignment, CareTeamMember, PastPatient, DeliveryReport, TimeOff, WorkBlock, DayAvailability, AdminReport,
  AppSettings, ConditionDef, RecordView, RecordViewContext, RetentionSettings, SecuritySettings, VitalFrequency, VitalReview,
} from '@/shared/lib/types'
import { DEFAULT_SETTINGS, FREQUENCY_LABELS } from '@/shared/lib/types'
import { COMMON_CONDITIONS } from '@/shared/lib/health'
import { emails as mail, sms as smsText, appBaseUrl, activationLink, activationToken } from '@/shared/email/emailTemplate'
import { RESET_TTL_MIN, MAX_RESET_ATTEMPTS, AUTH_PROVIDER_LABELS, FOLLOW_UP_REASON } from '@/shared/lib/types'
import { passwordIssue } from './auth'
import { DEMO } from './demoData'
import { backendAnonKey, backendConfigured, backendUrl, getSupabase, localBackend } from '@/shared/api/supabase'
import { subscribePush, unsubscribePush } from '@/shared/lib/push'
import { mfaGate, signOutBackend, type MfaGate } from '@/shared/api/authBackend'
import * as api from '@/shared/api/actions'
import { changeToken, isoClock, isoDay, loadRecords, searchAudit as searchAuditApi, type AuditWho, type Records } from '@/shared/api/records'
import { evaluate, alertIsFor, stamp, dateLabel, dayKey, targetRange, ESCALATE_AFTER_MIN, CORRECTION_WINDOW_MIN, type VitalLevel } from '@/shared/lib/vitals'
import { apptDateLabel, apptTimeLabel, apptWhen, isOpenAppt } from '@/shared/lib/schedule'
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
  /** A re-measurement for an alert that stays open: out of range again, or in range on a critical alert the doctor must close. */
  followsAlert?: boolean
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
  /** Admins: add a vital type, or change one (its ranges, or whether it is collected). */
  saveVitalDef: (def: VitalDef) => Saved
  updateUser: (id: string, patch: Partial<AppUser>) => Saved
  addUser: (u: AppUser, opts?: { invited?: boolean }) => void
  /** People registered in advance who have not signed up yet. */
  invitations: Invitation[]
  /**
   * Registers someone in advance. They create their own account (and password) by signing up with that email,
   * and get the role chosen here. `code` is set only where mCare itself holds the account and issues its code.
   */
  inviteUser: (input: { name: string; email: string; phone: string; role: UserRole }) => Saved<{ code?: string }>
  revokeInvitation: (id: string) => Saved
  getDoctors: () => DoctorUser[]
  getPatients: () => PatientUser[]
  getAdmins: () => AdminUser[]
  updateAssistantPerms: (id: string, perms: AssistantPerm[]) => Saved
  /** Assigns, moves or (with `null`) removes a patient's doctor. Removing one needs the reason. */
  assignPatientToDoctor: (patientId: string, doctorId: string | null, reason?: string) => Saved
  resolvePatientRequest: (patientId: string, approve: boolean, note?: string, alternativeDoctorId?: string) => Saved
  /** Makes an account active, suspends it or deactivates it. Stopping someone else's account needs a reason. */
  setUserStatus: (id: string, status: AccountStatus, reason?: string) => Saved
  /** Who treated whom, and when: the open row is the patient's doctor now. */
  careAssignments: CareAssignment[]
  /** A doctor's former patients, by name only. */
  pastPatients: PastPatient[]
  decideDoctor: (id: string, status: 'approved' | 'sent_back' | 'rejected', note?: string) => Saved
  // Clinical
  addPrescription: (patientId: string, rx: Prescription) => Saved
  /** Stops a medicine (with the reason) or restarts it. */
  setPrescriptionActive: (patientId: string, rxId: string, active: boolean, reason?: string) => Saved
  logReading: (patientId: string, reading: VitalReading) => Saved<LogResult>
  correctReading: (patientId: string, readingId: string, value: string) => Saved
  invalidateReading: (patientId: string, readingId: string, reason: string) => Saved
  sendAlertNow: (patientId: string, readingId: string) => Saved
  /** `ref` is the form's reference (useSave().ref), so a note sent twice is saved once. */
  setDoctorNote: (patientId: string, note: string, ref?: string) => Saved
  /** A clinical note with its visibility and kind; `amends` makes it the correction of an earlier note. */
  addClinicalNote: (patientId: string, note: api.NewNote) => Saved
  /* Care plans */
  carePlans: CarePlan[]
  /** Saves a plan and its goals together. Resolves with the plan's id. */
  saveCarePlan: (draft: CarePlanDraft) => Saved<string>
  setCarePlanStatus: (planId: string, status: CarePlanStatus, note?: string) => Saved
  setCarePlanItem: (planId: string, itemId: string, status: CarePlanItemStatus, progressNote?: string) => Saved
  deleteCarePlanDraft: (planId: string) => Saved
  /* Availability */
  timeOff: TimeOff[]
  setDoctorHours: (hours: WorkBlock[], slotMinutes: number) => Saved
  addTimeOff: (from: string, to: string, reason?: string) => Saved
  removeTimeOff: (id: string) => Saved
  /** The open times of one doctor on one day (YYYY-MM-DD). A read: nothing is saved. */
  availabilityFor: (doctorId: string, day: string) => Saved<DayAvailability>
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
  /** The treating doctor sets what a patient eats, the energy target, the water goal and a dietary note. */
  setMealPlan: (plan: Omit<MealPlan, 'setBy'>) => Saved
  /** Back to the standard plan. */
  clearMealPlan: (patientId: string) => Saved
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
  /** A comment, an action taken or an instruction on an alert, without resolving it. `ref` is the form's reference. */
  addAlertComment: (alertId: string, kind: AlertCommentKind, body: string, ref?: string) => Saved
  /** A monitor asks the treating doctor to respond to an open alert. */
  chaseDoctor: (alertId: string) => Saved
  scheduleFollowUp: (patientId: string, doctorId: string, date: string, time: string, note: string | undefined, alertId?: string) => Saved
  // Appointments
  appointments: Appointment[]
  addAppointment: (appt: Appointment) => Saved
  updateAppointment: (apptId: string, patch: Partial<Appointment>) => Saved
  /** Support moves an appointment (date as YYYY-MM-DD, time as HH:MM) or cancels it, always with the reason. */
  adminUpdateAppointment: (apptId: string, change: { action: 'move'; date: string; time?: string; reason: string } | { action: 'cancel'; reason: string }) => Saved
  /** Counts for a period, made from the records. A read: nothing is saved. */
  adminReport: (from: string, to: string) => Saved<AdminReport>
  /** How notifications went out by email, text message and push over a period. A read. */
  deliveryReport: (from: string, to: string) => Saved<DeliveryReport>
  /** Turns push notifications on or off for this device. Live mode only: demo mode has no server to send them. */
  setDevicePush: (on: boolean) => Saved
  /** One page of the audit trail, searched across the whole trail. `beforeId` continues after the last entry shown. A read. */
  searchAudit: (q: string, who: AuditWho, beforeId?: string) => Saved<AuditEntry[]>
  /** Consulting doctors on care teams, past and present. An open row (no `endedAt`) gives that doctor read access. */
  careTeam: CareTeamMember[]
  addConsultingDoctor: (patientId: string, doctorId: string, reason?: string) => Saved
  removeConsultingDoctor: (memberId: string) => Saved
  reportRequests: ReportRequest[]
  requestReport: (patientId: string, periodDays: number, reason: string) => Saved
  /** Draft the requested report; the doctor may adjust the period and what it includes. Resolves with the new document id. */
  fulfillReportRequest: (id: string, opts?: { days?: number; interpretation?: string; include?: VitalsReportInclude; notes?: ReportNote[] }) => Saved<string>
  declineReportRequest: (id: string, reason: string) => Saved
  // Messages
  messages: PatientMessage[]
  sendMessage: (fromId: string, toId: string, content: string, ref?: string) => Saved
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
  /** Demo mode only. In live mode the database writes the audit trail, with the change it describes. */
  logAudit: (action: string, detail: string) => void
  /** Staff opened one patient's vitals: recorded in the audit trail. */
  logPatientView: (patientId: string) => void
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
  // Security and settings
  /** Signs out, optionally saying why (shown on the sign-in page). */
  signOut: (notice?: string) => void
  /**
   * Live mode: the account signed in but still owes the second step (the code from its authenticator app), or must
   * set one up because an admin requires it for its role. The portal opens once `completeMfa` is called.
   */
  mfa: { step: Exclude<MfaGate, 'ok'>; account: AppUser } | null
  completeMfa: () => void
  cancelMfa: () => void
  /** What an administrator decided for the whole service. Demo mode: the defaults. */
  settings: AppSettings
  saveSecuritySettings: (v: SecuritySettings) => Saved
  saveRetentionSettings: (v: RetentionSettings) => Saved
  /** Applies the retention settings now. Resolves with how many of each it removed. */
  runRetentionNow: () => Saved<api.RetentionRun>
  /** The conditions catalogue and the vitals each calls for. */
  conditionDefs: ConditionDef[]
  saveConditionDef: (def: ConditionDef) => Saved
  // Monitoring plans, reviews, access log
  /** The treating doctor sets how often a patient measures a vital (null: the usual schedule). */
  setVitalPlan: (patientId: string, vitalId: string, frequency: VitalFrequency | null, reason?: string) => Saved
  vitalReviews: VitalReview[]
  /** The treating doctor marks a patient's readings reviewed up to now. `ref` is the form's reference. */
  reviewVitals: (patientId: string, note?: string, ref?: string) => Saved
  /** Who opened which patient's record (the patient's own list; everyone's for staff who view logs). */
  recordViews: RecordView[]
  /** The signed-in person opened part of a patient's record. Never fails the screen. */
  logRecordView: (patientId: string, context: RecordViewContext) => void
  /** The signed-in patient's whole record, as one document to download. */
  exportMyRecord: () => Saved<Record<string, unknown>>
  /** Support corrects someone's name, phone or date of birth, with the reason. */
  adminUpdateProfile: (id: string, changes: { name?: string; phone?: string; dob?: string }, reason: string) => Saved
  /** An admin resets the two-step sign-in of someone who lost their phone, with the reason. Live mode only. */
  resetTwoStep: (id: string, reason: string) => Saved
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
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [carePlans, setCarePlans] = useState<CarePlan[]>([])
  const [careAssignments, setCareAssignments] = useState<CareAssignment[]>(() => LIVE ? [] : START.users
    .filter((u): u is PatientUser => u.role === 'patient' && !!(u as PatientUser).assignedDoctorId)
    .map(p => ({ id: `ca_${p.id}`, patientId: p.id, doctorId: p.assignedDoctorId!, startedAt: NOW - 30 * 86_400_000 })))
  const [pastPatients, setPastPatients] = useState<PastPatient[]>([])
  const [timeOff, setTimeOff] = useState<TimeOff[]>([])
  const [careTeam, setCareTeam] = useState<CareTeamMember[]>([])
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [conditionDefs, setConditionDefs] = useState<ConditionDef[]>(() => LIVE ? [] : COMMON_CONDITIONS.map((c, i) => ({
    code: c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `c${i}`, name: c.name, icon: c.icon, active: true, vitals: c.vitals })))
  const [vitalReviews, setVitalReviews] = useState<VitalReview[]>([])
  const [recordViews, setRecordViews] = useState<RecordView[]>([])
  const [mfa, setMfa] = useState<{ step: Exclude<MfaGate, 'ok'>; account: AppUser; acceptedTerms: boolean } | null>(null)
  const [now, setNow] = useState(Date.now())

  // Always-fresh refs so callbacks never read stale state
  const usersRef = useRef(users); usersRef.current = users
  const alertsRef = useRef(alerts); alertsRef.current = alerts
  const dosesRef = useRef(doses); dosesRef.current = doses
  const mealsRef = useRef(mealsDone); mealsRef.current = mealsDone

  // currentUser is derived from the live users list — no manual syncing needed
  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const actorId = () => currentUserId ?? 'system'

  const findUser = (id?: string) => usersRef.current.find(u => u.id === id)
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
  /** The change token that goes with what is on screen (see my_change_token in the database). */
  const lastToken = useRef('')
  /** Stops the change checks of the signed-in session. Signing out calls it first, so no check goes out with a session that has just ended. */
  const stopSync = useRef<() => void>(undefined)

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
    if (LIVE) return   // written by the database, with the change it describes
    const t = Date.now()
    setAudit(prev => [{ id: uid('au'), actorId: actorId(), actorRole: findUser(actorId())?.role, action, detail, at: t, createdAt: stamp(new Date(t)) }, ...prev])
  }
  const logPatientView = (patientId: string) => {
    if (LIVE) { api.logPatientView(patientId).catch(() => {}); return }
    logAudit('Viewed patient vitals', findUser(patientId)?.name ?? patientId)
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
    updateUser: (id, patch) => updateUser(id, patch),
  }, docSeed)

  /** Puts a fresh load on screen. */
  const apply = (r: Records) => {
    setUsers(r.users); setVitalDefsState(r.vitalDefs); setAlerts(r.alerts); setAppointments(r.appointments)
    setMessages(r.messages); setNotifications(r.notifications); setDoses(r.doses); setMealsDone(r.mealsDone)
    setReportRequests(r.reportRequests); setClinicalNotes(r.clinicalNotes); setSupportTickets(r.supportTickets); setAudit(r.audit)
    setMealPlans(r.mealPlans); setHydrationLogs(r.hydration); setRatings(r.ratings); setInvitations(r.invitations)
    setCarePlans(r.carePlans); setCareAssignments(r.careAssignments); setPastPatients(r.pastPatients); setTimeOff(r.timeOff); setCareTeam(r.careTeam)
    setSettings(r.settings); setConditionDefs(r.conditionDefs); setVitalReviews(r.vitalReviews); setRecordViews(r.recordViews)
    docStore.hydrateDocuments(r.documents, r.docEvents, r.shareLinks, r.supportGrants)
  }
  /**
   * The token is read before the tables: if something changes in between, the next check sees a newer token
   * and reloads once more, which is harmless. Read the other way round, a change could be missed.
   */
  const load = async (me: AppUser) => {
    const token = await changeToken().catch(() => '')
    const records = await loadRecords(me)
    return { records, token }
  }
  const EMPTY: Records = {
    users: [], vitalDefs: [], alerts: [], appointments: [], messages: [], notifications: [], doses: [], mealsDone: [], reportRequests: [],
    clinicalNotes: [], supportTickets: [], audit: [], mealPlans: [], hydration: [], ratings: [], documents: [], docEvents: [], shareLinks: [], supportGrants: [], invitations: [],
    carePlans: [], careAssignments: [], pastPatients: [], timeOff: [], careTeam: [],
    settings: DEFAULT_SETTINGS, conditionDefs: [], vitalReviews: [], recordViews: [],
  }

  /** Signs out locally. `notice` says why, when the person did not choose to. */
  const leave = (notice?: string) => {
    stopSync.current?.(); stopSync.current = undefined
    signOutBackend()
    loadSeq.current++
    meRef.current = null; pendingRef.current = null
    setCurrentUserId(null); setMfa(null)
    if (LIVE) { apply(EMPTY); lastToken.current = ''; setSync({ at: null, refreshing: false }) }
    setEnterError(notice)
  }

  const refresh = async () => {
    const me = meRef.current
    if (!LIVE || !me) return
    const mine = ++loadSeq.current
    setSync(s => ({ ...s, refreshing: true }))
    try {
      const { records, token } = await load(me)
      if (mine !== loadSeq.current || meRef.current?.id !== me.id) return   // a newer load is on its way, or they signed out
      apply(records)
      if (token) lastToken.current = token
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
      // The database refuses a session that still owes the second step; ask for it before loading anything.
      const gate = await mfaGate().catch(() => 'ok' as const)
      if (mine !== loadSeq.current) return
      if (gate !== 'ok') { setMfa({ step: gate, account, acceptedTerms }); return }
      // Consent given on the sign-up form is recorded once the account can speak for itself.
      if (acceptedTerms) await api.acceptTerms().catch(() => {})
      const { records, token } = await load(account)
      if (mine !== loadSeq.current) return
      meRef.current = account
      apply(records)
      lastToken.current = token
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
  /** The second step is done (or set up): open the portal. */
  const completeMfa = () => { const m = mfa; setMfa(null); if (m) void enter(m.account, m.acceptedTerms) }
  const cancelMfa = () => leave()
  const signOut = (notice?: string) => leave(notice)

  const setCurrentUser = (u: AppUser | null) => {
    // Signing out also ends the backend session, or the next load would sign straight back in.
    if (!u) leave()
    else signIn(u)
  }

  // Live mode: keep what is on screen current. The database keeps a counter of every change this person may see;
  // one short token made from those counters is checked often and cheaply, and a different token means "reload".
  // On hosted Supabase the same counters are also pushed (below), so the check is then only a safety net.
  useEffect(() => {
    if (!LIVE || !currentUserId) return
    let stopped = false
    const visible = () => document.visibilityState === 'visible'
    const check = async () => {
      if (!visible()) return
      try {
        const token = await changeToken()
        if (stopped) return
        if (token !== lastToken.current) await refresh()
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
    // The local backend has no Realtime: it answers /__dev/changes the moment anything is saved, so open screens update
    // at once there too. The token check above still decides whether anything this person may see changed.
    const listening = new AbortController()
    stopSync.current = () => { stopped = true; listening.abort(); clearInterval(quick); clearInterval(full) }
    if (localBackend) void (async () => {
      let pulse = -1
      const pause = (ms: number) => new Promise(r => setTimeout(r, ms))
      while (!stopped) {
        try {
          const token = (await (await getSupabase()).auth.getSession()).data.session?.access_token
          if (!token) { await pause(5000); continue }
          const res = await fetch(`${backendUrl}/__dev/changes?since=${pulse}`, {
            headers: { apikey: backendAnonKey, Authorization: `Bearer ${token}` }, cache: 'no-store', signal: listening.signal })
          if (!res.ok) { await pause(5000); continue }
          const next = (await res.json() as { pulse: number }).pulse
          if (pulse !== -1 && next !== pulse) void check()
          pulse = next
        } catch {
          if (stopped) return
          await pause(5000)
        }
      }
    })()
    const onVisible = () => { if (visible()) void refresh() }
    const onOnline = () => { setOnline(true); void refresh() }
    const onOffline = () => setOnline(false)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      stopped = true
      listening.abort()
      clearInterval(quick); clearInterval(full)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
    // refresh and leave only use refs and state setters, which never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId])

  // Hosted Supabase: be told of a change the moment it is saved, instead of asking every few seconds.
  // The local backend has no Realtime service, so there the check above is what keeps the screen current.
  useEffect(() => {
    if (!LIVE || !currentUserId || localBackend) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let close: (() => void) | undefined
    // Several rows change in one save; reload once, shortly after the last of them.
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => { if (!stopped && document.visibilityState === 'visible') void refresh() }, 400) }
    getSupabase().then(supabase => {
      if (stopped) return
      const channel = supabase.channel(`mcare-sync-${currentUserId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_changes' }, soon)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'system_changes' }, soon)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUserId}` }, soon)
        .subscribe()
      // The sign-in service ended the session (signed out elsewhere, or it could not be renewed).
      const { data: auth } = supabase.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT' && meRef.current) leave('Your session has ended. Please sign in again.')
      })
      close = () => { auth.subscription.unsubscribe(); void supabase.removeChannel(channel) }
    }).catch(() => {})
    return () => { stopped = true; clearTimeout(timer); close?.() }
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
    if (p.notify) profile.notify = p.notify
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
    else if ('specialty' in p || 'licenseNo' in p || 'hospital' in p)
      await api.setDoctorDetails(id, { specialty: p.specialty, licenseNo: p.licenseNo, hospital: p.hospital })
    if ('signature' in p) await api.saveSignature(id, p.signature ?? null)
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
  const inviteUser = (input: { name: string; email: string; phone: string; role: UserRole }): Saved<{ code?: string }> => {
    const name = input.name.trim(), email = input.email.trim().toLowerCase()
    if (!name) return refused('Enter their name.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return refused('Enter a valid email address.')
    if (usersRef.current.some(u => u.email.toLowerCase() === email)) return refused('That email is already registered.')
    if (LIVE) return run(async () => { await api.inviteAccount({ name, email, role: input.role, phone: input.phone }); return {} })
    // Demo: the account is held here, so it is created now and its code is "emailed".
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const base = { id: uid('u'), name, email, phone: input.phone, status: 'unverified' as const, createdAt: dateLabel(), verificationCode: code, password: code }
    const user: AppUser = input.role === 'patient'
      ? { ...base, role: 'patient', trackedVitalIds: [], thresholds: {}, prescriptions: [], readings: [], profileSetup: 'pending' }
      : input.role === 'doctor'
        ? { ...base, role: 'doctor', specialty: '', licenseNo: '', hospital: '', approvalStatus: 'pending', assignedPatientIds: [] }
        : { ...base, role: input.role, isAssistant: input.role === 'assistant', permissions: [] }
    addUser(user, { invited: true })
    logAudit('Created user', `${name} (${input.role})`)
    return done({ code })
  }
  const revokeInvitation = (id: string): Saved => {
    if (LIVE) return run(() => api.revokeInvitation(id))
    return refused('That invitation is no longer open.')
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
    if (LIVE) return run(() => api.setAssistantPerms(id, perms))   // the database audits it and tells the assistant
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

  const assignPatientToDoctor = (patientId: string, doctorId: string | null, reason?: string): Saved => {
    if (!doctorId && (reason?.trim().length ?? 0) < 5) return refused('Say why the doctor is being removed.')
    if (LIVE) return run(() => api.assignDoctor(patientId, doctorId, reason))
    const pt = findUser(patientId)
    const prevDoc = (pt as PatientUser | undefined)?.assignedDoctorId
    if (prevDoc === (doctorId ?? undefined)) return done()
    const t = Date.now()
    setCareAssignments(prev => [
      ...(doctorId ? [{ id: uid('ca'), patientId, doctorId, startedAt: t, assignedBy: actorId(), reason: reason?.trim() || undefined }] : []),
      ...prev.map(a => a.patientId === patientId && !a.endedAt
        ? { ...a, endedAt: t, endedBy: actorId(), endReason: reason?.trim() || (doctorId ? `Moved to ${findUser(doctorId)?.name}` : undefined) } : a),
    ])
    setUsers(prev => linkPatient(prev, patientId, doctorId).map(u =>
      u.id === patientId ? { ...u, doctorRequest: undefined } as PatientUser : u))
    if (doctorId) {
      const doc = findUser(doctorId)
      notify(doctorId, 'assignment', 'New patient assigned', `${pt?.name} is now under your care`, 'patients')
      notify(patientId, 'assignment', 'Care team updated', `${doc?.name} is now your doctor`, 'care')
      logAudit('Assigned doctor', `${pt?.name} → ${doc?.name}`)
    } else {
      notify(patientId, 'assignment', 'Care team updated', 'You no longer have an assigned doctor. The care team will assign one.', 'care')
      logAudit('Removed doctor assignment', `${pt?.name} · ${reason?.trim()}`)
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

  const setUserStatus = (id: string, status: AccountStatus, reason?: string): Saved => {
    const self = id === currentUserId
    const stopping = status === 'suspended' || status === 'deactivated'
    if (stopping && !self && (reason?.trim().length ?? 0) < 5) return refused('Give a reason for stopping this account.')
    if (LIVE) {
      // Closing your own account goes through its own rule; the session then ends.
      if (self && stopping) return run(() => api.deactivateMyAccount())
      return run(() => api.setUserStatus(id, status, reason?.trim()))
    }
    if (self && stopping) status = 'deactivated'
    // The same rules the database applies.
    const target = findUser(id)
    if (target?.status === 'active' && status !== 'active') {
      if (target.role === 'admin' && !usersRef.current.some(u => u.role === 'admin' && u.status === 'active' && u.id !== id))
        return refused('mCare needs at least one active administrator')
      if (target.role === 'doctor' && (target as DoctorUser).assignedPatientIds.length > 0)
        return refused('This doctor still has patients. Move them to another doctor first.')
    }
    patchUser(id, { status, statusReason: stopping ? (self ? 'Closed by the account holder' : reason?.trim()) : undefined, statusChangedAt: dateLabel() })
    logAudit(status === 'suspended' ? 'Suspended user' : status === 'deactivated' ? 'Deactivated user' : 'Reactivated user',
      `${findUser(id)?.name ?? id}${stopping && reason?.trim() ? ` · ${reason.trim()}` : ''}`)
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

  const saveVitalDef = (def: VitalDef): Saved => {
    if (!def.name.trim() || !def.unit.trim()) return refused('Name and unit are required.')
    if (!(def.normalMin < def.normalMax)) return refused('Normal min must be lower than normal max.')
    if (LIVE) return run(() => api.saveVitalDef(def))   // the database audits the change
    const before = vitalDefs.find(v => v.id === def.id)
    setVitalDefsState(prev => before ? prev.map(v => v.id === def.id ? def : v) : [...prev, def])
    if (!before) logAudit('Added vital type', def.name)
    else if (before.active !== def.active) logAudit(def.active ? 'Activated vital type' : 'Deactivated vital type', def.name)
    else logAudit('Updated vital definition', `${def.name}: normal ${def.normalMin}–${def.normalMax}`)
    return done()
  }

  /* ─ prescriptions, notes, doses ─ */
  const addPrescription = (patientId: string, rx: Prescription): Saved => {
    if (rx.endDate && rx.endDate < (rx.startDate ?? dayKey())) return refused('The end date cannot be before the start date.')
    if (LIVE) return run(() => api.addPrescription(patientId, rx.doctorId, rx))   // the database notifies, audits and files the document
    const made: Prescription = { ...rx, status: 'active', active: true, startDate: rx.startDate ?? dayKey(),
      history: [{ id: uid('rxe'), action: 'prescribed', actorId: rx.doctorId, detail: `${rx.dosage} · ${rx.frequency}`, at: Date.now(), createdAt: stamp() }] }
    patchPatient(patientId, p => ({ ...p, prescriptions: [made, ...p.prescriptions] }))
    docStore.filePrescription(patientId, rx)
    notify(patientId, 'prescription', 'New prescription', `${rx.medication} — ${rx.frequency}`, 'medicine')
    logAudit('Prescribed', `${rx.medication} for ${findUser(patientId)?.name}`)
    return done()
  }
  const setPrescriptionActive = (patientId: string, rxId: string, active: boolean, reason?: string): Saved => {
    if (LIVE) return run(() => api.setPrescriptionActive(rxId, active, reason))
    const why = reason?.trim() || undefined
    patchPatient(patientId, p => ({ ...p, prescriptions: p.prescriptions.map(x => x.id === rxId ? {
      ...x, active, status: active ? 'active' as const : 'discontinued' as const, stopReason: active ? undefined : why,
      stoppedAt: active ? undefined : stamp(), stoppedBy: active ? undefined : actorId(),
      history: [...(x.history ?? []), { id: uid('rxe'), action: active ? 'restarted' : 'stopped', actorId: actorId(), detail: active ? undefined : why, at: Date.now(), createdAt: stamp() }],
    } : x) }))
    const rx = (findUser(patientId) as PatientUser | undefined)?.prescriptions.find(x => x.id === rxId)
    if (rx) {
      notify(patientId, 'prescription', active ? 'Medication restarted' : 'Medication stopped',
        active ? `${rx.medication} · ${rx.frequency}` : `${rx.medication} has been stopped by your doctor${why ? ` · ${why}` : ''}`, 'medicine')
      logAudit(active ? 'Restarted medication' : 'Stopped medication', `${rx.medication} for ${findUser(patientId)?.name}${why ? ` · ${why}` : ''}`)
    }
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
  const setMealPlan = (plan: Omit<MealPlan, 'setBy'>): Saved => {
    if (new Set(plan.meals.map(m => m.id)).size !== plan.meals.length) return refused('Each meal needs its own name.')
    if (plan.meals.some(m => !m.name.trim())) return refused('Give each meal a name.')
    if (LIVE) return run(() => api.setMealPlan(plan))   // the database checks it, tells the patient and audits it
    setMealPlans(prev => [...prev.filter(p => p.patientId !== plan.patientId), { ...plan, dietaryNote: plan.dietaryNote?.trim() || undefined, setBy: actorId() }])
    notify(plan.patientId, 'message', 'Your meal plan was updated',
      `${findUser(actorId())?.name ?? 'Your doctor'} set your meals${plan.targetKcal ? ` · ${plan.targetKcal} kcal a day` : ''} · ${plan.waterGoal} glasses of water`, 'meals')
    logAudit('Set meal plan', `${findUser(plan.patientId)?.name} · ${plan.meals.length} meals`)
    return done()
  }
  const clearMealPlan = (patientId: string): Saved => {
    if (LIVE) return run(() => api.clearMealPlan(patientId))
    setMealPlans(prev => prev.filter(p => p.patientId !== patientId))
    notify(patientId, 'message', 'Your meal plan was removed', `${findUser(actorId())?.name ?? 'Your doctor'} put you back on the standard meal plan`, 'meals')
    logAudit('Removed meal plan', findUser(patientId)?.name ?? patientId)
    return done()
  }
  const rateDoctor = (patientId: string, doctorId: string, rating: number, comment?: string): Saved => {
    if (LIVE) return run(() => api.rateDoctor(patientId, doctorId, rating, comment))
    setRatings(prev => [...prev.filter(r => !(r.patientId === patientId && r.doctorId === doctorId)), { patientId, doctorId, rating, comment: comment?.trim() || undefined }])
    return done()
  }
  const addClinicalNote = (patientId: string, n: api.NewNote): Saved => {
    const content = n.content.trim()
    if (!content) return refused('Write the note first.')
    if (LIVE) return run(() => api.addClinicalNote(patientId, actorId(), n))   // the database tells the patient (a shared note) and audits it
    const prior = n.amends ? clinicalNotes.find(x => x.id === n.amends) : undefined
    if (n.amends && (!prior || prior.patientId !== patientId)) return refused('That note cannot be amended.')
    if (prior?.amendedBy) return refused('That note has already been corrected. Amend the latest version.')
    const t = Date.now()
    const id = uid('cn')
    const visibility = n.visibility ?? 'shared'
    const next = [
      { id, patientId, authorId: actorId(), content, at: t, createdAt: stamp(new Date(t)), visibility, noteType: n.noteType ?? 'progress' as const, appointmentId: n.appointmentId, amends: n.amends },
      ...clinicalNotes.map(x => x.id === n.amends ? { ...x, amendedBy: id } : x),
    ]
    setClinicalNotes(next)
    // The patient's "note from your doctor" is the newest shared note that has not been replaced.
    patchPatient(patientId, p => ({ ...p, doctorNote: next.find(x => x.patientId === patientId && x.visibility === 'shared' && !x.amendedBy)?.content }))
    if (visibility === 'shared') notify(patientId, 'message', n.amends ? 'Your doctor corrected a note' : 'New note from your doctor', content.slice(0, 80), 'vitals')
    logAudit(n.amends ? 'Amended clinical note' : 'Added clinical note', `${findUser(patientId)?.name} · ${visibility === 'internal' ? 'internal' : 'shared with patient'}`)
    return done()
  }
  const setDoctorNote = (patientId: string, note: string, ref?: string): Saved => addClinicalNote(patientId, { content: note, ref })

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
      const saved = await api.logReading(patientId, reading.vitalId, reading.value, reading.note, reading.clientRef)
      return { level: saved.level, alerted: saved.alerted, readingId: saved.readingId, cleared: saved.cleared, followsAlert: saved.followsAlert }
    })
    const pt = findUser(patientId) as PatientUser | undefined
    const def = vitalDefs.find(v => v.id === reading.vitalId)
    const t = Date.now()
    const full: VitalReading = { ...reading, at: t, loggedAt: stamp(new Date(t)), recordedBy: actorId() }
    patchPatient(patientId, p => ({ ...p, readings: [full, ...p.readings] }))
    if (!pt || !def) return done({ level: 'normal', alerted: false, readingId: full.id })
    const level = evaluate(pt, def, full.value)
    const label = `${def.name} ${full.value} ${def.unit}`
    // A reading the care team entered is announced to the patient, whose record it is.
    if (actorId() !== patientId) {
      notify(patientId, 'message', 'A reading was added to your record', `${findUser(actorId())?.name ?? 'Your doctor'} recorded ${label}`, 'vitals')
      logAudit('Recorded reading for patient', `${pt.name} · ${label}`)
    }

    // The alert still open on this vital: this reading is a re-measurement of it.
    const open = alertsRef.current.find(a =>
      a.patientId === patientId && a.type === 'vital' && alertIsFor(a, def) && a.status !== 'resolved')
    if (open) {
      const linked = { recheckReadingId: full.id, remeasureIds: [...(open.remeasureIds ?? []), full.id] }
      const patch = (more: Partial<AppAlert>) => setAlerts(prev => prev.map(a => (a.id === open.id ? { ...a, ...linked, ...more } : a)))
      const doctor = pt.assignedDoctorId
      // A warning closes on an in-range re-measurement, whenever it comes.
      if (level === 'normal' && open.severity === 'warning') {
        const asked = open.recheckRequestedAt !== undefined
        patch({
          status: 'resolved', resolved: true, resolvedAt: stamp(), resolvedBy: actorId(), resolvedHow: 'remeasure',
          resolutionReason: asked ? 'Re-check back in range' : 'Re-measured in range by patient', resolutionNote: `New reading ${label}`,
        })
        notify(patientId, 'alert', 'Alert cleared', `${def.name}: your new reading is back in range`, 'alerts')
        if (doctor) notify(doctor, 'alert', `Alert cleared: ${pt.name}`, `${label} · re-measured back in range`, 'alerts')
        logAudit('Alert self-cleared', `${pt.name} · ${label}`)
        return done({ level, alerted: false, readingId: full.id, cleared: true })
      }
      // A critical alert is never closed by a number alone, so it goes back to the doctor.
      if (level === 'normal') {
        patch({})
        notify(patientId, 'alert', 'Re-check received', `${def.name}: your new reading is in range. Your doctor will review it and close the alert.`, 'alerts')
        if (doctor) notify(doctor, 'alert', `Re-check in range: ${pt.name}`, `${label} · review and resolve the alert`, 'alerts')
        return done({ level, alerted: false, readingId: full.id, followsAlert: true })
      }
      // Still out of range: the same alert carries on, at the worse of the two severities.
      patch(level === 'critical' ? { severity: 'danger' } : {})
      notify(patientId, 'alert', level === 'critical' ? 'Still critical: contact your doctor' : 'Still outside your range',
        `${label} · ${level === 'critical' ? 'your care team has been told. If you feel unwell, use SOS or call 999.' : 'your doctor has been told. Message them if you feel unwell.'}`, 'alerts')
      if (doctor) notify(doctor, 'alert', `${level === 'critical' ? 'Critical' : 'Still out of range'}: ${pt.name}`, `${label} · re-measurement`, 'alerts')
      return done({ level, alerted: false, readingId: full.id, followsAlert: true })
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
        ? { ...a, status: 'resolved', resolved: true, resolvedAt: stamp(), resolvedBy: patientId, resolvedHow: 'corrected', resolutionReason: 'Corrected by patient',
            resolutionNote: `Entered as ${rd?.value}, corrected to ${value} ${def.unit}` }
        : { ...a, value, severity: level === 'critical' ? 'danger' : 'warning' }))
    return done()
  }

  const invalidateReading = (patientId: string, readingId: string, reason: string): Saved => {
    if (LIVE) return run(() => api.invalidateReading(readingId, reason))
    patchPatient(patientId, p => ({ ...p, readings: p.readings.map(x => x.id === readingId ? { ...x, invalid: true, invalidReason: reason, invalidatedBy: actorId() } : x) }))
    logAudit('Marked reading invalid', `${findUser(patientId)?.name} — ${reason}`)
    // The alert that reading raised has nothing left to respond to.
    const raised = alertsRef.current.find(a => a.readingId === readingId && a.status !== 'resolved')
    if (raised) {
      setAlerts(prev => prev.map(a => a.id === raised.id
        ? { ...a, status: 'resolved', resolved: true, resolvedAt: stamp(), resolvedBy: actorId(), resolvedHow: 'invalid', resolutionReason: 'Reading marked invalid', resolutionNote: reason } : a))
      notify(patientId, 'alert', 'Alert closed', `${raised.vitalName}: your doctor marked the reading as not valid`, 'alerts')
    }
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
    return done()
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

  const resolveAlert = (alertId: string, reason: string, note?: string, booked = false): Saved => {
    const a = alertsRef.current.find(x => x.id === alertId)
    if (!reason.trim()) return refused('Give a reason for resolving the alert.')
    // That reason belongs to scheduleFollowUp, which books the visit with it.
    if (reason === FOLLOW_UP_REASON && !booked) return refused('Book the follow-up appointment to resolve with this reason.')
    if (LIVE) {
      // A patient closes only their own SOS ("I'm safe now"); everything else is the care team's decision.
      const own = a?.type === 'sos' && a.patientId === currentUserId
      return run(() => (own ? api.cancelSos(alertId) : api.resolveAlert(alertId, reason, note)))
    }
    if (a?.status === 'resolved') return refused('That alert is already resolved.')
    setAlerts(prev => prev.map(x => x.id === alertId
      ? { ...x, status: 'resolved', resolved: true, resolvedAt: stamp(), resolvedBy: actorId(), resolvedHow: x.type === 'sos' && x.patientId === actorId() ? 'patient' : 'doctor', resolutionReason: reason, resolutionNote: note?.trim() || undefined }
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

  const addAlertComment = (alertId: string, kind: AlertCommentKind, body: string, ref?: string): Saved => {
    if (!body.trim()) return refused('Write the comment first.')
    if (LIVE) return run(() => api.addAlertComment(alertId, actorId(), kind, body, ref))
    const a = alertsRef.current.find(x => x.id === alertId)
    if (!a) return refused('That alert could not be found.')
    const t = Date.now()
    const by = findUser(actorId())?.name ?? 'Your care team'
    setAlerts(prev => prev.map(x => x.id === alertId
      ? { ...x, comments: [...(x.comments ?? []), { id: uid('ac'), authorId: actorId(), kind, body: body.trim(), at: t, createdAt: stamp(new Date(t)) }] }
      : x))
    notify(a.patientId, 'alert', kind === 'instruction' ? `Instruction from ${by}` : kind === 'action' ? `${by} acted on your alert` : `${by} commented on your alert`,
      `${a.type === 'sos' ? 'SOS' : a.vitalName}: ${body.trim().slice(0, 120)}`, 'alerts')
    logAudit('Commented on alert', `${findUser(a.patientId)?.name} · ${a.vitalName} · ${kind}`)
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
    // One request: the visit is booked and the alert resolved together, or neither is.
    if (LIVE) return run(async () => { await api.scheduleFollowUp(patientId, isoDay(date) ?? date, isoClock(time), note, alertId) })
    const t = Date.now()
    const day = isoDay(date)
    if (!day || day < dayKey()) return refused('Choose a date from today onwards.')
    if (alertId && alertsRef.current.find(x => x.id === alertId)?.status === 'resolved') return refused('That alert is already resolved.')
    // Both or neither: the alert is resolved only once the visit is booked.
    return addAppointment({
      id: uid('ap'), patientId, doctorId, title: 'Follow-up appointment', reason: note?.trim() || 'Scheduled from alert review',
      preferredDate: apptDateLabel(day), preferredTime: apptTimeLabel(isoClock(time)), status: 'approved', approvalNote: note?.trim() || undefined,
      createdBy: doctorId, alertId, createdAt: dateLabel(new Date(t)), at: t,
    }).then(booked => (booked.ok && alertId ? resolveAlert(alertId, FOLLOW_UP_REASON, note, true) : booked))
  }

  /* ─ appointments & messages ─ */
  const apptEvent = (action: string, detail?: string): ApptEvent => ({ id: uid('ev'), actorId: actorId(), action, detail, at: Date.now(), createdAt: stamp() })
  /** Another confirmed visit of the same doctor or patient within half an hour: the same rule the database applies. */
  const apptClash = (a: Appointment) => {
    const at = apptWhen(a).at
    if (at === null || a.preferredTime === 'Any time') return undefined
    const other = appointments.find(x => x.id !== a.id && x.status === 'approved' && x.preferredTime !== 'Any time'
      && (x.doctorId === a.doctorId || x.patientId === a.patientId) && Math.abs((apptWhen(x).at ?? Infinity) - at) < 30 * 60_000)
    return !other ? undefined : other.doctorId === a.doctorId
      ? 'The doctor already has a visit at that time. Choose another time.' : 'The patient already has a visit at that time. Choose another time.'
  }
  const addAppointment = (appt: Appointment): Saved => {
    if (LIVE) {
      const date = isoDay(appt.preferredDate)
      if (!date) return refused('Choose a valid date.')
      return run(() => api.addAppointment({
        patientId: appt.patientId, doctorId: appt.doctorId, title: appt.title, reason: appt.reason, date,
        time: isoClock(appt.preferredTime) ?? '', location: appt.location, ref: appt.clientRef,
        ...(appt.status !== 'requested' ? { status: appt.status, approvalNote: appt.approvalNote } : {}),
      }))
    }
    const day = isoDay(appt.preferredDate)
    if (!day || day < dayKey()) return refused('Choose a date from today onwards.')
    const by = appt.createdBy ?? actorId()
    // The doctor arranges their own day; everyone else is held to the doctor's timetable.
    const outside = by === appt.doctorId ? undefined : slotIssue(appt.doctorId, day, isoClock(appt.preferredTime))
    if (outside) return refused(outside)
    const clash = appt.status === 'approved' ? apptClash(appt) : undefined
    if (clash) return refused(clash)
    setAppointments(prev => [...prev, {
      ...appt, createdBy: by, number: `APT-${new Date().getFullYear()}-${String(prev.length + 1).padStart(5, '0')}`,
      history: [apptEvent(appt.status === 'requested' ? 'requested' : 'booked', `${appt.preferredDate} · ${appt.preferredTime}`)],
    }])
    // Whoever did not make it is told: the doctor of a request, the patient of a visit booked for them.
    if (by !== appt.doctorId) notify(appt.doctorId, 'appointment', 'New appointment request', `${findUser(appt.patientId)?.name} · ${appt.title} · ${appt.preferredDate}`, 'appts')
    if (by !== appt.patientId) notify(appt.patientId, 'appointment', 'Appointment booked', `${findUser(appt.doctorId)?.name} · ${appt.title} · ${appt.preferredDate}`, 'appts')
    return done()
  }
  const updateAppointment = (apptId: string, patch: Partial<Appointment>): Saved => {
    if (LIVE) return run(() => api.updateAppointment(apptId, patch))
    const ap = appointments.find(a => a.id === apptId)
    if (!ap) return refused('That appointment could not be found.')
    if (!isOpenAppt(ap)) return refused('This appointment is closed.')
    if (patch.status === 'no_show' && (ap.status !== 'approved' || (apptWhen(ap).at ?? 0) > Date.now())) return refused('A visit still ahead cannot be recorded as missed.')
    const next = { ...ap, ...patch }
    const clash = next.status === 'approved' ? apptClash(next) : undefined
    if (clash) return refused(clash)
    const detail = patch.status === 'rescheduled' ? `${ap.preferredDate} · ${ap.preferredTime} → ${patch.rescheduledTo} · ${patch.rescheduledTime}${patch.rescheduledReason ? ` · ${patch.rescheduledReason}` : ''}`
      : patch.status === 'approved' && ap.status === 'rescheduled' ? `New time accepted · ${next.preferredDate} · ${next.preferredTime}`
      : patch.status === 'approved' || patch.status === 'completed' ? next.approvalNote : next.rejectionReason
    setAppointments(prev => prev.map(a => a.id === apptId
      ? { ...a, ...patch, history: patch.status ? [...(a.history ?? []), apptEvent(patch.status, detail)] : a.history } : a))
    if (ap && patch.status) {
      const target = currentUserId === ap.patientId ? ap.doctorId : ap.patientId
      notify(target, 'appointment', `Appointment ${patch.status}`, `${ap.title}${patch.rescheduledTo ? ` → ${patch.rescheduledTo} ${patch.rescheduledTime ?? ''}` : ''}`, 'appts')
    }
    return done()
  }

  /* ─ availability (demo mode keeps the same rules the database applies) ─ */
  const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
  const hmOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const weekdayOf = (day: string) => new Date(`${day}T00:00`).getDay()
  const doctorOf = (id: string) => usersRef.current.find(u => u.id === id && u.role === 'doctor') as DoctorUser | undefined
  /** Why a visit cannot be asked for on that day and time, or nothing when it can. */
  const slotIssue = (doctorId: string, day: string, time?: string) => {
    const d = doctorOf(doctorId)
    const name = d?.name ?? 'The doctor'
    if (timeOff.some(o => o.doctorId === doctorId && day >= o.from && day <= o.to)) return `${name} is away on that day. Choose another day.`
    const hours = d?.hours ?? []
    if (!hours.length) return undefined
    const today = hours.filter(h => h.weekday === weekdayOf(day))
    if (!today.length) return `${name} does not see patients on that day. Choose another day.`
    if (time && !today.some(h => minutesOf(time) >= minutesOf(h.start) && minutesOf(time) + (d?.slotMinutes ?? 30) <= minutesOf(h.end)))
      return `That time is outside the hours ${name} sees patients. Choose one of the open times.`
    return undefined
  }
  const availabilityFor = async (doctorId: string, day: string): Saved<DayAvailability> => {
    if (LIVE) {
      try { return { ok: true, value: await api.doctorAvailability(doctorId, day) } }
      catch (e) { return { ok: false, error: api.explain(e) } }
    }
    const d = doctorOf(doctorId)
    if (!d) return { ok: false, error: 'That doctor is not available.' }
    const slot = d.slotMinutes ?? 30
    const away = timeOff.some(o => o.doctorId === doctorId && day >= o.from && day <= o.to)
    const taken = appointments.filter(a => a.doctorId === doctorId && a.status === 'approved' && isoDay(a.preferredDate) === day && a.preferredTime !== 'Any time')
      .map(a => minutesOf(isoClock(a.preferredTime) ?? '00:00'))
    const slots = away ? [] : (d.hours ?? []).filter(h => h.weekday === weekdayOf(day)).flatMap(h => {
      const out: string[] = []
      for (let m = minutesOf(h.start); m + slot <= minutesOf(h.end); m += slot) if (!taken.some(t => Math.abs(t - m) < 30)) out.push(hmOf(m))
      return out
    }).sort()
    return { ok: true, value: { managed: !!d.hours?.length, away, slotMinutes: slot, slots } }
  }
  const setDoctorHours = (hours: WorkBlock[], slotMinutes: number): Saved => {
    if (hours.some(h => h.start >= h.end)) return refused('Each block needs a start and a later end.')
    if (hours.some((a, i) => hours.some((b, j) => i < j && a.weekday === b.weekday && a.start < b.end && b.start < a.end))) return refused('Two blocks on the same day overlap.')
    if (LIVE) return run(() => api.setDoctorHours(hours, slotMinutes))
    patchUser(actorId(), { hours: [...hours].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)), slotMinutes } as Partial<DoctorUser>)
    logAudit('Set working hours', `${findUser(actorId())?.name} · ${hours.length} block${hours.length === 1 ? '' : 's'}`)
    return done()
  }
  const addTimeOff = (from: string, to: string, reason?: string): Saved => {
    if (!from || !to || from > to) return refused('Choose the first and the last day away.')
    if (LIVE) return run(() => api.addTimeOff(actorId(), from, to, reason))
    setTimeOff(prev => [...prev, { id: uid('off'), doctorId: actorId(), from, to, reason: reason?.trim() || undefined }].sort((a, b) => a.from.localeCompare(b.from)))
    return done()
  }
  const removeTimeOff = (id: string): Saved => {
    if (LIVE) return run(() => api.removeTimeOff(id))
    setTimeOff(prev => prev.filter(o => o.id !== id))
    return done()
  }

  /* ─ support staff act on the one appointment record ─ */
  const adminUpdateAppointment: Ctx['adminUpdateAppointment'] = (apptId, change) => {
    if (change.reason.trim().length < 5) return refused('Give the reason the patient and the doctor will read.')
    if (LIVE) return run(() => api.adminUpdateAppointment(apptId, change))
    const ap = appointments.find(a => a.id === apptId)
    if (!ap) return refused('That appointment could not be found.')
    if (!isOpenAppt(ap)) return refused('This appointment is closed.')
    const why = change.reason.trim()
    if (change.action === 'cancel') {
      setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, status: 'cancelled', rejectionReason: why, history: [...(a.history ?? []), apptEvent('cancelled', why)] } : a))
      ;[ap.patientId, ap.doctorId].forEach(id => notify(id, 'appointment', 'Appointment cancelled by mCare support', `${ap.title} · ${why}`, 'appts'))
      logAudit('Appointment cancelled', `${findUser(ap.patientId)?.name} · ${ap.title} · ${why}`)
      return done()
    }
    if (ap.status === 'rescheduled') return refused('The doctor has proposed a new time. The patient can accept it, or the appointment can be cancelled.')
    if (change.date < dayKey()) return refused('Choose a date from today onwards.')
    const outside = slotIssue(ap.doctorId, change.date, change.time || undefined)
    if (outside) return refused(outside)
    const moved = { ...ap, preferredDate: apptDateLabel(change.date), preferredTime: apptTimeLabel(change.time || undefined) }
    const clash = moved.status === 'approved' ? apptClash(moved) : undefined
    if (clash) return refused(clash)
    const detail = `${ap.preferredDate} · ${ap.preferredTime} → ${moved.preferredDate} · ${moved.preferredTime} · ${why}`
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...moved, history: [...(a.history ?? []), apptEvent('moved', detail)] } : a))
    ;[ap.patientId, ap.doctorId].forEach(id => notify(id, 'appointment', 'Appointment moved by mCare support', `${ap.title} → ${moved.preferredDate} · ${moved.preferredTime} · ${why}`, 'appts'))
    logAudit('Moved appointment', `${findUser(ap.patientId)?.name} · ${ap.title} · ${detail}`)
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
  const fulfillReportRequest = async (id: string, opts: { days?: number; interpretation?: string; include?: VitalsReportInclude; notes?: ReportNote[] } = {}): Saved<string> => {
    const rq = reportRequests.find(r => r.id === id)
    if (!rq || rq.status !== 'pending') return { ok: false, error: 'That request has already been answered.' }
    const drafted = await docStore.generateVitalsReport(rq.patientId, opts.days ?? rq.periodDays, opts.interpretation, opts.include, opts.notes)
    if (!drafted.ok) return drafted
    const docId = drafted.value
    if (LIVE) {
      // The draft is saved; if linking it to the request fails the doctor still has the draft, and the request stays open.
      const linked = await run(() => api.fulfilReportRequest(id, docId))
      return linked.ok ? { ok: true, value: docId } : linked
    }
    setReportRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'fulfilled', docId, handledAt: stamp() } : r))
    notify(rq.patientId, 'document', 'Your report is being prepared', `Your doctor drafted your ${rq.periodDays}-day vitals report. You'll get it once it's signed.`, 'docs')
    return { ok: true, value: docId }
  }
  const declineReportRequest = (id: string, reason: string): Saved => {
    if (LIVE) return run(() => api.declineReportRequest(id, reason))
    const rq = reportRequests.find(r => r.id === id)
    if (!rq) return refused('That request could not be found.')
    setReportRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'declined', declineReason: reason.trim(), handledAt: stamp() } : r))
    notify(rq.patientId, 'document', 'Report request declined', reason.trim() || 'Your doctor could not prepare this report.', 'docs')
    return done()
  }

  const sendMessage = (fromId: string, toId: string, content: string, ref?: string): Saved => {
    if (!content.trim()) return refused('Write a message first.')
    if (LIVE) return run(() => api.sendMessage(fromId, toId, content, ref))
    // The same rule the database applies: a patient and a current treating or consulting doctor.
    const a = findUser(fromId), b = findUser(toId)
    const pt = (a?.role === 'patient' ? a : b?.role === 'patient' ? b : undefined) as PatientUser | undefined
    const other = pt?.id === fromId ? toId : fromId
    const doctor = findUser(other)
    const mayMessage = !!pt && (pt.assignedDoctorId === other || careTeam.some(m => m.patientId === pt.id && m.doctorId === other && !m.endedAt))
    if (!pt || doctor?.role !== 'doctor' || !mayMessage) return refused('You can only message a doctor currently on your care team, or a patient assigned to or consulted on by you.')
    setMessages(prev => [...prev, { id: uid('msg'), fromId, toId, content: content.trim(), sentAt: stamp(), at: Date.now(), read: false }])
    notify(toId, 'message', `New message from ${findUser(fromId)?.name ?? 'mCare'}`, content.trim().slice(0, 80), 'messages')
    return done()
  }
  const markMessagesRead = (fromId: string, toId: string): Saved => {
    setMessages(prev => prev.map(m => m.fromId === fromId && m.toId === toId && !m.read ? { ...m, read: true, readAt: Date.now() } : m))
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

  /* ─ care plans ─ */
  const planEvent = (action: string, detail?: string) => ({ id: uid('cpe'), action, actorId: actorId(), detail, at: Date.now(), createdAt: stamp() })
  const planClosed = (p?: CarePlan) => p?.status === 'completed' || p?.status === 'cancelled'
  const saveCarePlan = (draft: CarePlanDraft): Saved<string> => {
    if (!draft.title.trim()) return refused('Give the care plan a title.')
    if (draft.items.some(i => !i.text.trim())) return refused('Describe each goal and intervention.')
    if (draft.items.length > 30) return refused('A care plan can hold up to 30 goals and interventions.')
    if (LIVE) return run(() => api.saveCarePlan(draft))
    const existing = draft.id ? carePlans.find(p => p.id === draft.id) : undefined
    if (draft.id && !existing) return refused('That care plan could not be found.')
    if (planClosed(existing)) return refused('This care plan is closed. Start a new one.')
    const t = Date.now()
    const id = existing?.id ?? uid('cp')
    const items = draft.items.map(i => {
      const kept = existing?.items.find(x => x.id === i.id)
      return { id: kept?.id ?? uid('cpi'), kind: i.kind, text: i.text.trim(), vitalId: i.vitalId || undefined, targetDate: i.targetDate || undefined,
        status: kept?.status ?? 'open' as const, progressNote: kept?.progressNote }
    })
    const goals = items.filter(i => i.kind === 'goal').length
    const plan: CarePlan = existing
      ? { ...existing, title: draft.title.trim(), summary: draft.summary?.trim() || undefined, reviewDate: draft.reviewDate || undefined, items,
          history: [...existing.history, planEvent('edited', `${goals} goals · ${items.length - goals} interventions`)] }
      : { id, patientId: draft.patientId, doctorId: actorId(), title: draft.title.trim(), summary: draft.summary?.trim() || undefined, status: 'draft',
          reviewDate: draft.reviewDate || undefined, createdAt: dateLabel(new Date(t)), at: t, items, history: [planEvent('created', draft.title.trim())] }
    setCarePlans(prev => existing ? prev.map(p => p.id === id ? plan : p) : [plan, ...prev])
    if (existing?.status === 'active') notify(plan.patientId, 'care_plan', 'Your care plan was updated', plan.title, 'care')
    logAudit(existing ? 'Edited care plan' : 'Drafted care plan', `${findUser(plan.patientId)?.name} · ${plan.title}`)
    return done(id)
  }
  const setCarePlanStatus = (planId: string, status: CarePlanStatus, note?: string): Saved => {
    if (LIVE) return run(() => api.setCarePlanStatus(planId, status, note))
    const p = carePlans.find(x => x.id === planId)
    if (!p) return refused('That care plan could not be found.')
    if (planClosed(p)) return refused('This care plan is closed. Start a new one.')
    if (status === 'draft') return refused('A care plan that has started cannot go back to draft.')
    if (p.status === 'draft' && status !== 'active' && status !== 'cancelled') return refused('Start the care plan first.')
    if (status === 'active' && carePlans.some(x => x.patientId === p.patientId && x.status === 'active' && x.id !== p.id))
      return refused('This patient already has an active care plan. Complete it or put it on hold first.')
    if (status === 'active' && !p.items.some(i => i.kind === 'goal')) return refused('Add at least one goal before starting the plan.')
    const closing = status === 'completed' || status === 'cancelled'
    const why = note?.trim() || undefined
    setCarePlans(prev => prev.map(x => x.id === planId ? {
      ...x, status, startDate: status === 'active' ? x.startDate ?? dayKey() : x.startDate,
      closedAt: closing ? stamp() : undefined, closeNote: status === 'active' ? x.closeNote : why,
      history: [...x.history, planEvent(status, why)],
    } : x))
    if (!(p.status === 'draft' && status === 'cancelled')) {
      const title = status === 'active' ? (p.status === 'on_hold' ? 'Your care plan has resumed' : 'Your care plan is ready')
        : status === 'on_hold' ? 'Your care plan is on hold' : status === 'completed' ? 'Care plan completed' : 'Your care plan was cancelled'
      notify(p.patientId, 'care_plan', title, `${p.title}${why ? ` · ${why}` : ''}`, 'care')
    }
    logAudit(`Care plan ${status.replace('_', ' ')}`, `${findUser(p.patientId)?.name} · ${p.title}`)
    return done()
  }
  const setCarePlanItem = (planId: string, itemId: string, status: CarePlanItemStatus, progressNote?: string): Saved => {
    if (LIVE) return run(() => api.setCarePlanItem(itemId, status, progressNote))
    const p = carePlans.find(x => x.id === planId)
    const item = p?.items.find(i => i.id === itemId)
    if (!p || !item) return refused('That goal could not be found.')
    if (planClosed(p)) return refused('This care plan is closed. Start a new one.')
    const note = progressNote?.trim() || undefined
    setCarePlans(prev => prev.map(x => x.id === planId ? {
      ...x, items: x.items.map(i => i.id === itemId ? { ...i, status, progressNote: note } : i),
      history: item.status === status ? x.history : [...x.history, planEvent(`item_${status === 'open' ? 'reopened' : status}`, `${item.text.slice(0, 120)}${note ? ` · ${note}` : ''}`)],
    } : x))
    if (p.status === 'active' && status === 'achieved' && item.status !== 'achieved' && item.kind === 'goal') notify(p.patientId, 'care_plan', 'Goal reached', item.text.slice(0, 120), 'care')
    return done()
  }
  const deleteCarePlanDraft = (planId: string): Saved => {
    if (LIVE) return run(() => api.deleteCarePlanDraft(planId))
    if (carePlans.find(x => x.id === planId)?.status !== 'draft') return refused('Only a draft can be removed. Cancel the plan instead.')
    setCarePlans(prev => prev.filter(x => x.id !== planId))
    return done()
  }

  /* ─ reading only: figures for an administrator, and older audit entries ─ */
  const deliveryReport = async (from: string, to: string): Saved<DeliveryReport> => {
    if (!LIVE) return { ok: true, value: { channels: {}, failures: [] } }   // demo mode sends nothing
    try { return { ok: true, value: await api.deliveryReport(from, to) } }
    catch (e) { return { ok: false, error: api.explain(e) } }
  }
  const setDevicePush = async (on: boolean): Saved => {
    if (!LIVE) return { ok: false, error: 'Push notifications work once mCare is connected to its server.' }
    try {
      if (on) await api.savePushDevice(await subscribePush())
      else { const endpoint = await unsubscribePush(); if (endpoint) await api.removePushDevice(endpoint) }
      return { ok: true, value: undefined }
    } catch (e) { return { ok: false, error: e instanceof Error && !(e instanceof api.ApiError) && !/fetch/i.test(e.message) ? e.message : api.explain(e) } }
  }
  const adminReport = async (from: string, to: string): Saved<AdminReport> => {
    if (LIVE) {
      try { return { ok: true, value: await api.adminReport(from, to) } }
      catch (e) { return { ok: false, error: api.explain(e) } }
    }
    // Demo mode: the same counts, made from the sample records held here.
    const f = new Date(`${from}T00:00`).getTime(), t = new Date(`${to}T00:00`).getTime() + 86_400_000
    const within = (at?: number) => !!at && at >= f && at < t
    const by = <K extends string>(list: K[]) => list.reduce<Partial<Record<K, number>>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {})
    const raised = alerts.filter(a => within(a.at))
    const pts = usersRef.current.filter(u => u.role === 'patient') as PatientUser[]
    return { ok: true, value: {
      from, to,
      accounts: by(usersRef.current.filter(u => u.status === 'active').map(u => u.role)),
      registered: {},
      stopped: usersRef.current.filter(u => u.status === 'suspended' || u.status === 'deactivated').length,
      waiting: {
        doctor_approvals: usersRef.current.filter(u => u.role === 'doctor' && ['pending', 'sent_back'].includes((u as DoctorUser).approvalStatus)).length,
        doctor_requests: pts.filter(p => p.doctorRequest?.status === 'pending').length,
        patients_without_doctor: pts.filter(p => p.status === 'active' && !p.assignedDoctorId).length,
        invitations: invitations.length, support_requests: supportTickets.filter(x => x.status === 'open').length,
        open_alerts: alerts.filter(a => a.status !== 'resolved').length,
      },
      appointments: by(appointments.filter(a => within(a.at)).map(a => a.status)),
      alerts: {
        raised: raised.length, critical: raised.filter(a => a.severity === 'danger' && a.type === 'vital').length, sos: raised.filter(a => a.type === 'sos').length,
        escalated: raised.filter(a => a.escalatedAt).length, resolved: raised.filter(a => a.status === 'resolved').length,
        minutes_to_acknowledge: null, minutes_to_resolve: null,
      },
      activity: {
        readings: pts.reduce((n, p) => n + p.readings.filter(r => within(r.at)).length, 0),
        patients_recording: pts.filter(p => p.readings.some(r => within(r.at))).length,
        prescriptions: 0, documents: docStore.documentsFor(undefined, { allVersions: true }).filter(e => within(e.doc.at)).length, messages: 0,
      },
      support: { opened: supportTickets.filter(x => within(x.at)).length, answered: supportTickets.filter(x => x.status === 'resolved').length },
      doctors: (usersRef.current.filter(u => u.role === 'doctor' && u.status === 'active' && (u as DoctorUser).approvalStatus === 'approved') as DoctorUser[]).map(d => ({
        id: d.id, name: d.name, patients: d.assignedPatientIds.length,
        open_alerts: alerts.filter(a => a.status !== 'resolved' && d.assignedPatientIds.includes(a.patientId)).length,
        visits: appointments.filter(a => a.doctorId === d.id && within(a.at)).length,
        completed: appointments.filter(a => a.doctorId === d.id && a.status === 'completed' && within(a.at)).length,
      })).sort((a, b) => b.patients - a.patients),
    } }
  }
  const AUDIT_PAGE = 100
  const searchAudit = async (q: string, who: AuditWho, beforeId?: string): Saved<AuditEntry[]> => {
    if (LIVE) {
      try { return { ok: true, value: await searchAuditApi(q, who, beforeId, AUDIT_PAGE) } }
      catch (e) { return { ok: false, error: api.explain(e) } }
    }
    // Demo mode keeps the whole trail in memory: the same search, here.
    const needle = q.trim().toLowerCase()
    const start = beforeId ? audit.findIndex(a => a.id === beforeId) + 1 : 0
    const hits = audit.slice(start).filter(a =>
      (who === 'all' || (who === 'system' ? !a.actorRole : who === 'staff' ? a.actorRole === 'admin' || a.actorRole === 'assistant' : a.actorRole === who))
      && (!needle || `${a.action} ${a.detail} ${findUser(a.actorId)?.name ?? ''}`.toLowerCase().includes(needle)))
    return { ok: true, value: hits.slice(0, AUDIT_PAGE) }
  }

  /* ─ care team: consulting doctors read a patient's record; only the treating doctor changes it ─ */
  const addConsultingDoctor = (patientId: string, doctorId: string, reason?: string): Saved => {
    if (LIVE) return run(async () => { await api.addConsultingDoctor(patientId, doctorId, reason?.trim()) })
    const pt = findUser(patientId) as PatientUser | undefined, doc = findUser(doctorId) as DoctorUser | undefined
    if (!pt || !doc || doc.role !== 'doctor' || doc.status !== 'active' || doc.approvalStatus !== 'approved') return refused('That doctor is not available')
    if (pt.assignedDoctorId === doctorId) return refused('That doctor already treats this patient')
    if (careTeam.some(m => m.patientId === patientId && m.doctorId === doctorId && !m.endedAt)) return refused('That doctor is already on the care team')
    const why = reason?.trim() || undefined
    setCareTeam(prev => [{ id: uid('ctm'), patientId, doctorId, reason: why, addedBy: actorId(), startedAt: Date.now() }, ...prev])
    notify(doctorId, 'assignment', 'Added to a care team', `You can now read ${pt.name}'s record as a consulting doctor${why ? ` · ${why}` : ''}`, 'patients')
    notify(patientId, 'assignment', 'Care team updated', `${doc.name} can now read your record as a consulting doctor`, 'care')
    logAudit('Added consulting doctor', `${pt.name} ← ${doc.name}${why ? ` · ${why}` : ''}`)
    return done()
  }
  const removeConsultingDoctor = (memberId: string): Saved => {
    if (LIVE) return run(() => api.removeConsultingDoctor(memberId))
    const m = careTeam.find(x => x.id === memberId && !x.endedAt)
    if (!m) return refused('That doctor is no longer on the care team')
    setCareTeam(prev => prev.map(x => x.id === memberId ? { ...x, endedAt: Date.now() } : x))
    if (m.doctorId !== actorId()) notify(m.doctorId, 'assignment', 'Removed from a care team', `You no longer have access to ${findUser(m.patientId)?.name}'s record`, 'patients')
    notify(m.patientId, 'assignment', 'Care team updated', `${findUser(m.doctorId)?.name} no longer has access to your record`, 'care')
    logAudit('Removed consulting doctor', `${findUser(m.patientId)?.name} ← ${findUser(m.doctorId)?.name}`)
    return done()
  }

  /* ─ settings, monitoring plans, reviews, access log: live calls the database; demo applies the same rules here ─ */
  const isAdminNow = () => currentUser?.role === 'admin' && currentUser.status === 'active'
  const saveSecuritySettings = (v: SecuritySettings): Saved => {
    if (Object.values(v.idleMinutes).some(m => m !== 0 && (m < 5 || m > 720))) return refused('Idle sign-out must be between 5 and 720 minutes, or 0 for never.')
    if (LIVE) return run(() => api.saveSecuritySettings(v))
    if (!isAdminNow()) return refused('Only an admin can change the settings.')
    setSettings(prev => ({ ...prev, security: { mfaRequiredRoles: [...new Set(v.mfaRequiredRoles)].sort(), idleMinutes: v.idleMinutes } }))
    logAudit('Changed settings', 'Security')
    return done()
  }
  const saveRetentionSettings = (v: RetentionSettings): Saved => {
    const bad = (n: number | null, lo: number, hi: number) => n !== null && (!Number.isInteger(n) || n < lo || n > hi)
    if (bad(v.auditDays, 180, 36500)) return refused('Audit entries must be kept between 180 and 36500 days, or empty to keep for ever.')
    if (bad(v.deletedDocumentDays, 1, 3650)) return refused('Deleted documents must be kept between 1 and 3650 days, or empty to keep for ever.')
    if (bad(v.readNotificationDays, 7, 3650) || bad(v.deliveryDays, 7, 3650)) return refused('Notifications and message records must be kept at least 7 days, or empty to keep for ever.')
    if (LIVE) return run(() => api.saveRetentionSettings(v))
    if (!isAdminNow()) return refused('Only an admin can change the settings.')
    setSettings(prev => ({ ...prev, retention: v }))
    logAudit('Changed settings', 'Data retention')
    return done()
  }
  const runRetentionNow = (): Saved<api.RetentionRun> => {
    if (LIVE) return run(() => api.runRetentionNow())
    if (!isAdminNow()) return refused('Only an admin can apply retention.')
    return done({ documents: 0, audit: 0, notifications: 0, deliveries: 0 })
  }
  const saveConditionDef = (def: ConditionDef): Saved => {
    if (!def.name.trim()) return refused('Give the condition a name.')
    if (LIVE) return run(() => api.saveConditionDef(def))
    if (!isAdminNow()) return refused('Only an admin can change the conditions list.')
    const code = def.code || def.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const before = conditionDefs.find(c => c.code === code)
    setConditionDefs(prev => before ? prev.map(c => c.code === code ? { ...def, code, name: def.name.trim() } : c) : [...prev, { ...def, code, name: def.name.trim() }])
    logAudit(before ? (before.active !== def.active ? (def.active ? 'Activated condition' : 'Deactivated condition') : 'Updated condition') : 'Added condition', def.name.trim())
    return done()
  }
  const treatsNow = (patientId: string) => currentUser?.role === 'doctor' && (findUser(patientId) as PatientUser | undefined)?.assignedDoctorId === currentUser.id
  const setVitalPlan = (patientId: string, vitalId: string, frequency: VitalFrequency | null, reason?: string): Saved => {
    if (LIVE) return run(() => api.setVitalPlan(patientId, vitalId, frequency, reason))
    if (!treatsNow(patientId)) return refused("Only the patient's treating doctor can set their monitoring plan.")
    const def = vitalDefs.find(v => v.id === vitalId)
    if (!def?.active) return refused('That vital is not collected.')
    const why = reason?.trim() || undefined
    patchPatient(patientId, p => {
      const plans = { ...(p.vitalPlans ?? {}) }
      if (frequency || why) plans[vitalId] = { frequency: frequency ?? undefined, reason: why, assignedBy: actorId(), assignedAt: Date.now() }
      else delete plans[vitalId]
      return { ...p, vitalPlans: Object.keys(plans).length ? plans : undefined, trackedVitalIds: p.trackedVitalIds.includes(vitalId) ? p.trackedVitalIds : [...p.trackedVitalIds, vitalId] }
    })
    notify(patientId, 'care_plan', `Measuring ${def.name}`, frequency
      ? `${currentUser?.name ?? 'Your doctor'} asked you to measure ${def.name} ${FREQUENCY_LABELS[frequency].toLowerCase()}${why ? ` · ${why}` : ''}`
      : `${currentUser?.name ?? 'Your doctor'} set ${def.name} back to the usual schedule`, 'vitals')
    logAudit('Set monitoring plan', `${findUser(patientId)?.name} · ${def.name} · ${frequency ? FREQUENCY_LABELS[frequency] : 'as usual'}`)
    return done()
  }
  const reviewVitals = (patientId: string, note?: string, ref?: string): Saved => {
    if (LIVE) return run(async () => { await api.reviewVitals(patientId, note, ref) })
    if (!treatsNow(patientId)) return refused("Only the patient's treating doctor can review their readings.")
    const last = vitalReviews.filter(r => r.patientId === patientId).reduce((m, r) => Math.max(m, r.reviewedThrough), 0)
    const pt = findUser(patientId) as PatientUser | undefined
    const count = (pt?.readings ?? []).filter(r => !r.invalid && (r.at ?? 0) > last).length
    const t = Date.now(), clean = note?.trim() || undefined
    setVitalReviews(prev => [{ id: ref ?? uid('vr'), patientId, reviewerId: actorId(), reviewedThrough: t, note: clean, readings: count, createdAt: stamp(new Date(t)) }, ...prev])
    notify(patientId, 'care_plan', 'Your doctor reviewed your readings', `${currentUser?.name ?? 'Your doctor'} looked at your readings${clean ? `: ${clean}` : '.'}`, 'vitals')
    logAudit('Reviewed readings', `${pt?.name} · ${count} reading${count === 1 ? '' : 's'}`)
    return done()
  }
  const logRecordView = (patientId: string, context: RecordViewContext) => {
    if (!currentUser || currentUser.id === patientId) return
    if (LIVE) { api.logRecordView(patientId, context).catch(() => {}); return }
    const t = Date.now()
    setRecordViews(prev => prev.some(v => v.viewerId === currentUser.id && v.patientId === patientId && v.context === context && t - v.at < 30 * MIN) ? prev
      : [{ id: uid('rv'), patientId, viewerId: currentUser.id, viewerRole: currentUser.role, context, at: t, createdAt: stamp(new Date(t)) }, ...prev])
  }
  const exportMyRecord = (): Saved<Record<string, unknown>> => {
    if (LIVE) return run(() => api.exportMyRecord())
    const p = currentUser as PatientUser | null
    if (!p || p.role !== 'patient') return refused('Only a patient can download their own record.')
    logAudit('Downloaded own record', p.name)
    return done({
      format: 'mCare patient record, version 1 (demo)', exported_at: new Date().toISOString(),
      profile: { name: p.name, email: p.email, phone: p.phone, date_of_birth: p.dob }, health: p.health, emergency_contacts: p.emergencyContacts,
      monitoring: p.trackedVitalIds.map(id => ({ vital: id, ...(p.vitalPlans?.[id] ?? {}), target: p.thresholds[id] })),
      readings: p.readings, prescriptions: p.prescriptions,
      notes_from_your_doctor: clinicalNotes.filter(n => n.patientId === p.id && n.visibility === 'shared'),
      appointments: appointments.filter(a => a.patientId === p.id), alerts: alerts.filter(a => a.patientId === p.id),
      messages: messages.filter(m => m.fromId === p.id || m.toId === p.id), who_opened_your_record: recordViews.filter(v => v.patientId === p.id),
    })
  }
  const adminUpdateProfile = (id: string, changes: { name?: string; phone?: string; dob?: string }, reason: string): Saved => {
    if (reason.trim().length < 5) return refused('Say why you are changing these details.')
    if (changes.name !== undefined && !changes.name.trim()) return refused('Enter their name.')
    if (LIVE) return run(() => api.adminUpdateProfile(id, changes, reason))
    const can = currentUser?.role === 'admin' || (currentUser?.role === 'assistant' && (currentUser as AdminUser).permissions.includes('handle_support'))
    if (!can) return refused('Not allowed.')
    if (id === currentUserId) return refused('Change your own details from your profile.')
    patchUser(id, { ...(changes.name !== undefined ? { name: changes.name.trim() } : {}), ...(changes.phone !== undefined ? { phone: changes.phone.trim() } : {}),
      ...(changes.dob !== undefined ? { dob: changes.dob || undefined } : {}) })
    notify(id, 'account', 'Your details were updated', `mCare support updated your details: ${reason.trim()}`)
    logAudit('Support updated details', `${findUser(id)?.name ?? id} · ${reason.trim()}`)
    return done()
  }

  const resetTwoStep = (id: string, reason: string): Saved => {
    if (reason.trim().length < 5) return refused('Say why two-step sign-in is being reset.')
    if (LIVE) return run(() => api.resetTwoStep(id, reason))
    return refused('Two-step sign-in works when mCare is connected to its server.')
  }

  return (
    <AppContext.Provider value={{
      ...docStore,
      now, live: LIVE, currentUser, setCurrentUser, signIn, entering, enterError, retryEnter,
      sync, online, refresh, run, saveError, clearSaveError: () => setSaveError(undefined),
      users, vitalDefs, saveVitalDef,
      updateUser, addUser, invitations, inviteUser, revokeInvitation,
      getDoctors, getPatients, getAdmins,
      updateAssistantPerms, assignPatientToDoctor, resolvePatientRequest, setUserStatus, decideDoctor,
      careAssignments, pastPatients, addClinicalNote,
      carePlans, saveCarePlan, setCarePlanStatus, setCarePlanItem, deleteCarePlanDraft,
      timeOff, setDoctorHours, addTimeOff, removeTimeOff, availabilityFor,
      adminUpdateAppointment, adminReport, deliveryReport, setDevicePush, searchAudit,
      careTeam, addConsultingDoctor, removeConsultingDoctor,
      addPrescription, setPrescriptionActive, logReading, correctReading, invalidateReading, sendAlertNow,
      setDoctorNote, setUnitPref, setThreshold, setCriticalThreshold, clinicalNotes, doses, toggleDose, mealsDone, toggleMeal,
      mealPlans, setMealPlan, clearMealPlan, hydration, setHydration, ratings, rateDoctor,
      alerts, raiseSOS, acknowledgeAlert, resolveAlert, escalateAlert, requestRecheck, addAlertComment, chaseDoctor, scheduleFollowUp,
      appointments, addAppointment, updateAppointment,
      reportRequests, requestReport, fulfillReportRequest, declineReportRequest,
      messages, sendMessage, markMessagesRead,
      notifications, notify, markNotificationRead, markAllNotificationsRead,
      emails, emailsFor, texts, textsFor, resendVerification, verifyByLink, sendWelcomeEmail,
      audit, logAudit, logPatientView, canCorrect,
      changePassword, requestPasswordReset, verifyResetCode, verifyResetLink,
      setPasswordAfterVerification, recoveryChannels, requestAdminPasswordHelp, socialAuth,
      supportTickets, createSupportTicket, resolveSupportTicket,
      signOut, mfa: mfa ? { step: mfa.step, account: mfa.account } : null, completeMfa, cancelMfa,
      settings, saveSecuritySettings, saveRetentionSettings, runRetentionNow, conditionDefs, saveConditionDef,
      setVitalPlan, vitalReviews, reviewVitals, recordViews, logRecordView, exportMyRecord, adminUpdateProfile, resetTwoStep,
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

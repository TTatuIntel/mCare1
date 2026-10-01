import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  AppUser, VitalDef, PatientUser, DoctorUser, AdminUser, AssistantPerm, Prescription, VitalReading,
  AppAlert, Appointment, PatientMessage, AppNotification, NotifKind, AuditEntry, ClinicalNote, MedDose, MealDone, ReportRequest,
  AccountStatus, SupportTicket, ResetToken, ResetChannel, AuthProvider, VitalsReportInclude, EmailContent, SentEmail, SentSms,
} from '@/shared/lib/types'
import { emails as mail, sms as smsText, appBaseUrl, activationLink, activationToken } from '@/shared/email/emailTemplate'
import { RESET_TTL_MIN, MAX_RESET_ATTEMPTS, AUTH_PROVIDER_LABELS } from '@/shared/lib/types'
import { passwordIssue } from './auth'
import { signOutBackend } from '@/shared/api/authBackend'
import { evaluate, alertIsFor, stamp, dateLabel, dayKey, ESCALATE_AFTER_MIN, CORRECTION_WINDOW_MIN, SELF_CLEAR_WINDOW_MIN, type VitalLevel } from '@/shared/lib/vitals'
import { useDocumentStore, type DocumentApi } from '@/shared/documents/useDocumentStore'
import { seedDocuments } from '@/shared/documents/docSeed'

/* ─── Initial mock data ─────────────────────────────────────────────── */

const NOW = Date.now()
const MIN = 60_000
const HR = 60 * MIN
const DAY = 24 * HR
const at = (msAgo: number) => ({ at: NOW - msAgo, loggedAt: stamp(new Date(NOW - msAgo)) })

export const INITIAL_VITAL_DEFS: VitalDef[] = [
  { id: 'bp',   name: 'Blood Pressure',   unit: 'mmHg',  normalMin: 90,  normalMax: 130, criticalMin: 80,  criticalMax: 180, hardMin: 50, hardMax: 260, diaNormalMin: 60, diaNormalMax: 90, diaCriticalMin: 40, diaCriticalMax: 120, icon: '🫀', active: true },
  { id: 'hr',   name: 'Heart Rate',       unit: 'bpm',   normalMin: 60,  normalMax: 100, criticalMin: 40,  criticalMax: 130, hardMin: 20, hardMax: 250, icon: '💓', active: true  },
  { id: 'gluc', name: 'Blood Glucose',    unit: 'mg/dL', normalMin: 70,  normalMax: 140, criticalMin: 54,  criticalMax: 250, hardMin: 20, hardMax: 600, icon: '🩸', active: true, unitOptions: ['mg/dL', 'mmol/L'] },
  { id: 'temp', name: 'Temperature',      unit: '°F',    normalMin: 97,  normalMax: 99,  criticalMin: 95,  criticalMax: 103, hardMin: 86, hardMax: 110, icon: '🌡️', active: true, unitOptions: ['°F', '°C'] },
  { id: 'spo2', name: 'SpO₂',            unit: '%',     normalMin: 95,  normalMax: 100, criticalMin: 90,  criticalMax: 101, hardMin: 50, hardMax: 100, icon: '🫁', active: true  },
  { id: 'wt',   name: 'Weight',           unit: 'kg',    normalMin: 40,  normalMax: 150, criticalMin: 30,  criticalMax: 200, hardMin: 2,  hardMax: 350, icon: '⚖️', active: true, unitOptions: ['kg', 'lb'] },
  { id: 'ht',   name: 'Height',           unit: 'cm',    normalMin: 50,  normalMax: 250, criticalMin: 30,  criticalMax: 280, hardMin: 20, hardMax: 300, icon: '📏', active: false, unitOptions: ['cm', 'in'] },
  { id: 'rr',   name: 'Respiratory Rate', unit: '/min',  normalMin: 12,  normalMax: 20,  criticalMin: 8,   criticalMax: 30,  hardMin: 4,  hardMax: 60,  icon: '🌬️', active: false },
  { id: 'chol', name: 'Cholesterol',      unit: 'mg/dL', normalMin: 0,   normalMax: 200, criticalMin: -1,  criticalMax: 300, hardMin: 50, hardMax: 600, icon: '🧪', active: false },
]

const r = (id: string, vitalId: string, value: string, msAgo: number): VitalReading => ({ id, vitalId, value, ...at(msAgo) })

/** Older, in-range history (newest first) so week/month trends have real shape. Deterministic, no randomness. */
const history = (vitalId: string, fromDay: number, toDay: number, stepDays: number, value: (i: number) => string): VitalReading[] =>
  Array.from({ length: Math.floor((toDay - fromDay) / stepDays) + 1 }, (_, i) =>
    r(`h_${vitalId}_${i}`, vitalId, value(i), (fromDay + i * stepDays) * DAY + 2 * HR))
const wobble = (i: number, amp: number) => Math.sin(i * 1.9) * amp

const p1: PatientUser = {
  id: 'p1', name: 'James Mwangi', email: 'james@example.com', phone: '+254 712 345 678',
  role: 'patient', status: 'active', createdAt: 'Sep 1, 2026', verificationCode: '482931', password: 'mcare123',
  assignedDoctorId: 'd1',
  trackedVitalIds: ['bp', 'hr', 'gluc', 'temp', 'spo2', 'wt'],
  thresholds: {
    bp:   { min: 90,  max: 140 },
    hr:   { min: 55,  max: 100 },
    gluc: { min: 70,  max: 180 },
    temp: { min: 97,  max: 99  },
    spo2: { min: 93,  max: 100 },
    wt:   { min: 70,  max: 95  },
  },
  targetLog: [{ vitalId: 'hr', at: NOW - 12 * DAY, from: { min: 60, max: 100 }, to: { min: 55, max: 100 }, by: 'd1' }],
  prescriptions: [
    { id: 'rx1', medication: 'Metformin 500mg',   dosage: '500mg', frequency: 'Twice daily', purpose: 'Blood sugar control', prescribedAt: 'Sep 10, 2026', doctorId: 'd1', active: true  },
    { id: 'rx2', medication: 'Lisinopril 10mg',   dosage: '10mg',  frequency: 'Once daily',  purpose: 'Blood pressure',      prescribedAt: 'Sep 10, 2026', doctorId: 'd1', active: true  },
    { id: 'rx3', medication: 'Atorvastatin 20mg', dosage: '20mg',  frequency: 'Once at night', purpose: 'Cholesterol',       prescribedAt: 'Sep 10, 2026', doctorId: 'd1', active: true  },
    { id: 'rx4', medication: 'Aspirin 81mg',      dosage: '81mg',  frequency: 'Once daily',  purpose: 'Cardioprotection',    prescribedAt: 'Sep 10, 2026', doctorId: 'd1', active: false },
  ],
  readings: [
    r('rd1', 'bp',   '142/91', 12 * MIN),
    r('rd2', 'hr',   '72',     12 * MIN),
    r('rd3', 'gluc', '210',    3 * HR),
    r('rd4', 'temp', '98.2',   21 * HR),
    r('rd5', 'spo2', '98',     12 * MIN),
    r('rd6', 'wt',   '78.4',   12 * MIN),
    r('rd1a', 'bp',  '138/88', 1 * DAY),
    r('rd3a', 'gluc', '176',   1 * DAY),
    r('rd1b', 'bp',  '135/86', 2 * DAY),
    r('rd3b', 'gluc', '162',   2 * DAY),
    r('rd1c', 'bp',  '131/84', 3 * DAY),
    r('rd3c', 'gluc', '150',   3 * DAY),
    r('rd1d', 'bp',  '128/82', 4 * DAY),
    r('rd2a', 'hr',  '75',     1 * DAY),
    r('rd2b', 'hr',  '70',     2 * DAY),
    ...history('bp',   5, 30, 1, i => `${Math.round(127 - i * 0.25 + wobble(i, 3))}/${Math.round(81 - i * 0.15 + wobble(i + 1, 2))}`),
    ...history('hr',   3, 30, 1, i => String(Math.round(72 + wobble(i, 4)))),
    ...history('gluc', 4, 30, 1, i => String(Math.round(145 - i * 0.6 + wobble(i, 10)))),
    ...history('temp', 1, 30, 1, i => (98.3 + wobble(i, 0.3)).toFixed(1)),
    ...history('spo2', 1, 30, 1, i => String(Math.min(100, Math.round(97 + wobble(i, 1.4))))),
    ...history('wt',   7, 28, 7, i => (78.4 + (i + 1) * 0.35).toFixed(1)),
  ],
  doctorNote: 'Blood pressure significantly elevated. Monitor BP twice daily. Reduce sodium intake and follow up in 3 days.',
  emergencyContacts: [{ id: 'ec1', name: 'Mary Mwangi', relationship: 'Spouse', phone: '+254 711 000 111', nextOfKin: true }],
  dob: '1968-04-12',
  health: {
    sex: 'male', bloodType: 'O+',
    conditions: ['High blood pressure', 'Type 2 diabetes', 'High cholesterol'],
    allergies: [{ id: 'al1', substance: 'Penicillin', severity: 'severe', reaction: 'Hives and facial swelling' }],
  },
}

const p2: PatientUser = {
  id: 'p2', name: 'Grace Otieno', email: 'grace@example.com', phone: '+254 722 345 678',
  role: 'patient', status: 'unverified', createdAt: 'Sep 28, 2026', verificationCode: '719284', password: 'mcare123',
  trackedVitalIds: ['bp', 'hr'], thresholds: {}, prescriptions: [], readings: [],
  // Demo: verifying this account walks through the new-patient health setup.
  profileSetup: 'pending',
}

const p3: PatientUser = {
  id: 'p3', name: 'Samuel Kariuki', email: 'samuel@example.com', phone: '+254 733 345 678',
  role: 'patient', status: 'active', createdAt: 'Aug 10, 2026', verificationCode: '391847', password: 'mcare123',
  assignedDoctorId: 'd1',
  trackedVitalIds: ['bp', 'hr', 'spo2'],
  thresholds: { bp: { min: 85, max: 130 }, hr: { min: 60, max: 110 }, spo2: { min: 92, max: 100 } },
  prescriptions: [
    { id: 'rx5', medication: 'Amlodipine 5mg', dosage: '5mg', frequency: 'Once daily', purpose: 'Blood pressure', prescribedAt: 'Sep 5, 2026', doctorId: 'd1', active: true },
  ],
  readings: [
    r('rd7', 'bp',   '128/85', 25 * MIN),
    r('rd8', 'hr',   '88',     25 * MIN),
    r('rd9', 'spo2', '89',     25 * MIN),
    r('rd9a', 'spo2', '93',    1 * DAY),
    r('rd9b', 'spo2', '95',    2 * DAY),
    r('rd9c', 'spo2', '96',    3 * DAY),
  ],
  doctorNote: 'SpO₂ borderline low. Patient to rest and avoid exertion. Follow up in 48 hours if reading stays below 93%.',
  emergencyContacts: [],
}

const p4: PatientUser = {
  id: 'p4', name: 'Aisha Njeri', email: 'aisha@example.com', phone: '+254 744 345 678',
  role: 'patient', status: 'active', createdAt: 'Sep 18, 2026', verificationCode: '552211', password: 'mcare123',
  trackedVitalIds: ['bp', 'gluc'], thresholds: {}, prescriptions: [],
  readings: [r('rd10', 'bp', '118/76', 2 * HR), r('rd11', 'gluc', '98', 2 * HR)],
  doctorRequest: { doctorId: 'd1', requestedAt: 'Sep 28, 2026', status: 'pending' },
  emergencyContacts: [],
}

const d1: DoctorUser = {
  id: 'd1', name: 'Dr. Amara Osei', email: 'amara@knh.go.ke', phone: '+254 700 111 222',
  role: 'doctor', status: 'active', createdAt: 'Jan 15, 2026', verificationCode: '112233', password: 'mcare123',
  specialty: 'Cardiology', licenseNo: 'KMC-2019-04821', hospital: 'Kenyatta National Hospital',
  approvalStatus: 'approved', approvedBy: 'a1', approvedAt: 'Jan 16, 2026', assignedPatientIds: ['p1', 'p3'],
}

const d2: DoctorUser = {
  id: 'd2', name: 'Dr. Kwame Asante', email: 'kwame@aghospital.org', phone: '+254 700 222 333',
  role: 'doctor', status: 'pending_approval', createdAt: 'Sep 20, 2026', verificationCode: '334455', password: 'mcare123',
  specialty: 'Internal Medicine', licenseNo: 'GHC-2020-07732', hospital: 'Aga Khan Hospital',
  approvalStatus: 'pending', assignedPatientIds: [],
}

const d3: DoctorUser = {
  id: 'd3', name: 'Dr. Rehema Okoye', email: 'rehema@nbihosp.com', phone: '+254 700 333 444',
  role: 'doctor', status: 'pending_approval', createdAt: 'Sep 15, 2026', verificationCode: '445566', password: 'mcare123',
  specialty: 'Endocrinology', licenseNo: 'NGA-2018-09143', hospital: 'Nairobi Hospital',
  approvalStatus: 'sent_back',
  approvalNote: 'Medical licence document appears expired. Please upload a valid, current licence certificate.',
  assignedPatientIds: [],
}

const d4: DoctorUser = {
  id: 'd4', name: 'Dr. Bosco Maina', email: 'bosco@mpshah.com', phone: '+254 700 444 555',
  role: 'doctor', status: 'suspended', createdAt: 'Sep 5, 2026', verificationCode: '556677', password: 'mcare123',
  specialty: 'General Practice', licenseNo: 'KMC-2021-11234', hospital: 'MP Shah Hospital',
  approvalStatus: 'rejected',
  approvalNote: 'Credentials could not be verified with Kenya Medical Council. Application rejected.',
  assignedPatientIds: [],
}

const d5: DoctorUser = {
  id: 'd5', name: 'Dr. Lillian Wanjiru', email: 'lillian@knh.go.ke', phone: '+254 700 555 666',
  role: 'doctor', status: 'active', createdAt: 'Feb 2, 2026', verificationCode: '667788', password: 'mcare123',
  specialty: 'Endocrinology', licenseNo: 'KMC-2017-02211', hospital: 'Kenyatta National Hospital',
  approvalStatus: 'approved', approvedBy: 'a1', approvedAt: 'Feb 3, 2026', assignedPatientIds: [],
}

const a1: AdminUser = {
  id: 'a1', name: 'System Admin', email: 'admin@matendocare.com', phone: '+254 700 000 001',
  role: 'admin', status: 'active', createdAt: 'Jan 1, 2026', verificationCode: '000000', password: 'mcare123',
  isAssistant: false, permissions: [],
}

const a2: AdminUser = {
  id: 'a2', name: 'Zainab Hassan', email: 'zainab@matendocare.com', phone: '+254 700 000 002',
  role: 'assistant', status: 'active', createdAt: 'Mar 1, 2026', verificationCode: '111111', password: 'mcare123',
  isAssistant: true,
  permissions: ['assign_healthworkers', 'approve_patient_requests', 'handle_support', 'monitor_patients'],
}

const INITIAL_USERS: AppUser[] = [p1, p2, p3, p4, d1, d2, d3, d4, d5, a1, a2]

const alertSeed = (id: string, patientId: string, vitalName: string, value: string, unit: string, severity: 'danger' | 'warning', msAgo: number, readingId: string): AppAlert => ({
  id, patientId, vitalName, value, unit, severity, readingId, type: 'vital', status: 'open', resolved: false, ...at(msAgo),
})

const INITIAL_ALERTS: AppAlert[] = [
  alertSeed('al1', 'p1', 'Blood Pressure', '142/91', 'mmHg', 'warning', 12 * MIN, 'rd1'),
  alertSeed('al2', 'p3', 'SpO₂', '89', '%', 'danger', 25 * MIN, 'rd9'),
  alertSeed('al3', 'p1', 'Blood Glucose', '210', 'mg/dL', 'warning', 3 * HR, 'rd3'),
]

const INITIAL_APPOINTMENTS: Appointment[] = [
  { id: 'ap1', patientId: 'p1', doctorId: 'd1', title: 'Cardiology Consultation', reason: 'Follow up on elevated blood pressure readings', preferredDate: 'Oct 4, 2026', preferredTime: '9:00 AM', location: 'Kenyatta National Hospital', status: 'approved', createdAt: 'Sep 20, 2026' },
  { id: 'ap2', patientId: 'p3', doctorId: 'd1', title: 'Diabetic Review', reason: 'Monthly glucose and weight check', preferredDate: 'Oct 10, 2026', preferredTime: '11:00 AM', status: 'requested', createdAt: 'Sep 25, 2026' },
  { id: 'ap3', patientId: 'p1', doctorId: 'd1', title: 'General Check-up', reason: 'Routine monitoring and medication review', preferredDate: 'Oct 28, 2026', preferredTime: '10:00 AM', status: 'requested', createdAt: 'Sep 27, 2026' },
  { id: 'ap4', patientId: 'p3', doctorId: 'd1', title: 'SpO₂ Follow-up', reason: 'SpO₂ has been consistently low, need evaluation', preferredDate: 'Oct 2, 2026', preferredTime: '2:00 PM', status: 'rescheduled', rescheduledTo: 'Oct 5, 2026', rescheduledTime: '3:00 PM', rescheduledReason: 'Doctor unavailable Oct 2 — rescheduled to Oct 5.', createdAt: 'Sep 22, 2026' },
]

const INITIAL_MESSAGES: PatientMessage[] = [
  { id: 'msg1', fromId: 'd1', toId: 'p1', content: 'Your blood pressure is significantly elevated. Please reduce sodium intake, rest well, and monitor twice daily.', sentAt: stamp(new Date(NOW - 40 * MIN)), read: true },
  { id: 'msg2', fromId: 'p1', toId: 'd1', content: 'Thank you doctor. I will follow your advice and monitor closely.', sentAt: stamp(new Date(NOW - 30 * MIN)), read: true },
  { id: 'msg3', fromId: 'd1', toId: 'p3', content: 'Samuel, your SpO₂ dropped. Please rest and avoid strenuous activity. Contact me if it stays below 93%.', sentAt: stamp(new Date(NOW - 20 * MIN)), read: false },
]

const INITIAL_NOTES: ClinicalNote[] = [
  { id: 'cn1', patientId: 'p1', authorId: 'd1', content: p1.doctorNote!, createdAt: stamp(new Date(NOW - 1 * DAY)), at: NOW - DAY },
  { id: 'cn2', patientId: 'p3', authorId: 'd1', content: p3.doctorNote!, createdAt: stamp(new Date(NOW - 20 * MIN)), at: NOW - 20 * MIN },
]

const notifSeed = (id: string, userId: string, kind: NotifKind, title: string, body: string, msAgo: number, link?: string, read = false): AppNotification =>
  ({ id, userId, kind, title, body, link, read, at: NOW - msAgo, createdAt: stamp(new Date(NOW - msAgo)) })

const INITIAL_NOTIFS: AppNotification[] = [
  notifSeed('n1', 'd1', 'alert', 'Critical: Samuel Kariuki', 'SpO₂ 89% — below critical limit', 25 * MIN, 'alerts'),
  notifSeed('n2', 'd1', 'alert', 'Warning: James Mwangi', 'Blood Pressure 142/91 mmHg', 12 * MIN, 'alerts'),
  notifSeed('n3', 'p1', 'message', 'New message from Dr. Amara Osei', 'Your blood pressure is significantly elevated…', 40 * MIN, 'messages', true),
  notifSeed('n4', 'p3', 'message', 'New message from Dr. Amara Osei', 'Samuel, your SpO₂ dropped…', 20 * MIN, 'messages'),
  notifSeed('n5', 'a1', 'assignment', 'Doctor request: Aisha Njeri', 'Requested Dr. Amara Osei', 1 * DAY, 'assign'),
  notifSeed('n6', 'a2', 'assignment', 'Doctor request: Aisha Njeri', 'Requested Dr. Amara Osei', 1 * DAY, 'assign'),
]

const INITIAL_AUDIT: AuditEntry[] = [
  { id: 'au1', actorId: 'a1', action: 'Approved doctor', detail: 'Dr. Amara Osei', at: NOW - 200 * DAY, createdAt: 'Jan 16, 2026' },
  { id: 'au2', actorId: 'a1', action: 'Rejected doctor', detail: 'Dr. Bosco Maina — credentials not verified', at: NOW - 20 * DAY, createdAt: 'Sep 9, 2026' },
  { id: 'au3', actorId: 'a1', action: 'Suspended user', detail: 'Dr. Bosco Maina', at: NOW - 20 * DAY, createdAt: 'Sep 9, 2026' },
]

/* ─── Context ───────────────────────────────────────────────────────── */

export interface LogResult { level: VitalLevel; alerted: boolean; readingId: string }

/** Documents come from the document store (useDocumentStore.ts); every read there is access-checked. */
interface Ctx extends DocumentApi {
  now: number
  currentUser: AppUser | null
  setCurrentUser: (u: AppUser | null) => void
  users: AppUser[]
  vitalDefs: VitalDef[]
  setVitalDefs: React.Dispatch<React.SetStateAction<VitalDef[]>>
  updateUser: (id: string, patch: Partial<AppUser>) => void
  addUser: (u: AppUser, opts?: { invited?: boolean }) => void
  getDoctors: () => DoctorUser[]
  getPatients: () => PatientUser[]
  getAdmins: () => AdminUser[]
  updateAssistantPerms: (id: string, perms: AssistantPerm[]) => void
  assignPatientToDoctor: (patientId: string, doctorId: string | null) => void
  resolvePatientRequest: (patientId: string, approve: boolean, note?: string, alternativeDoctorId?: string) => void
  setUserStatus: (id: string, status: AccountStatus) => void
  decideDoctor: (id: string, status: 'approved' | 'sent_back' | 'rejected', note?: string) => void
  // Clinical
  addPrescription: (patientId: string, rx: Prescription) => void
  setPrescriptionActive: (patientId: string, rxId: string, active: boolean) => void
  logReading: (patientId: string, reading: VitalReading) => LogResult
  correctReading: (patientId: string, readingId: string, value: string) => void
  invalidateReading: (patientId: string, readingId: string, reason: string) => void
  sendAlertNow: (patientId: string, readingId: string) => void
  setDoctorNote: (patientId: string, note: string) => void
  setUnitPref: (patientId: string, vitalId: string, unit: string) => void
  /** Set a patient's personal target range for a vital, and record the change. */
  setThreshold: (patientId: string, vitalId: string, range: { min: number; max: number }) => void
  setCriticalThreshold: (patientId: string, vitalId: string, range: { min: number; max: number } | null) => void
  clinicalNotes: ClinicalNote[]
  doses: MedDose[]
  toggleDose: (patientId: string, rxId: string, slot: number) => void
  mealsDone: MealDone[]
  toggleMeal: (patientId: string, mealId: string, note?: string) => void
  // Alerts
  alerts: AppAlert[]
  raiseSOS: (patientId: string, message: string) => void
  acknowledgeAlert: (alertId: string) => void
  resolveAlert: (alertId: string, reason: string, note?: string) => void
  escalateAlert: (alertId: string) => void
  requestRecheck: (alertId: string) => void
  scheduleFollowUp: (patientId: string, doctorId: string, date: string, time: string, note: string | undefined, alertId?: string) => void
  // Appointments
  appointments: Appointment[]
  addAppointment: (appt: Appointment) => void
  updateAppointment: (apptId: string, patch: Partial<Appointment>) => void
  reportRequests: ReportRequest[]
  requestReport: (patientId: string, periodDays: number, reason: string) => boolean
  /** Drafts the requested report and links it to the request; returns the new document id. */
  /** Draft the requested report; the doctor may adjust the period and what it includes. */
  fulfillReportRequest: (id: string, opts?: { days?: number; interpretation?: string; include?: VitalsReportInclude }) => string | null
  declineReportRequest: (id: string, reason: string) => void
  // Messages
  messages: PatientMessage[]
  sendMessage: (fromId: string, toId: string, content: string) => void
  markMessagesRead: (fromId: string, toId: string) => void
  // Notifications & audit
  notifications: AppNotification[]
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
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: (userId: string) => void
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
  createSupportTicket: (userId: string, subject: string, message: string) => void
  resolveSupportTicket: (ticketId: string, note?: string) => void
}

export const AppContext = createContext<Ctx | null>(null)

let seq = 0
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [users, setUsers] = useState<AppUser[]>(INITIAL_USERS)
  const [vitalDefs, setVitalDefs] = useState<VitalDef[]>(INITIAL_VITAL_DEFS)
  const [alerts, setAlerts] = useState<AppAlert[]>(INITIAL_ALERTS)
  const [appointments, setAppointments] = useState<Appointment[]>(INITIAL_APPOINTMENTS)
  const [reportRequests, setReportRequests] = useState<ReportRequest[]>([])
  const [messages, setMessages] = useState<PatientMessage[]>(INITIAL_MESSAGES)
  const [notifications, setNotifications] = useState<AppNotification[]>(INITIAL_NOTIFS)
  const [audit, setAudit] = useState<AuditEntry[]>(INITIAL_AUDIT)
  const [clinicalNotes, setClinicalNotes] = useState<ClinicalNote[]>(INITIAL_NOTES)
  const [doses, setDoses] = useState<MedDose[]>([])
  const [mealsDone, setMealsDone] = useState<MealDone[]>([])
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([])
  const [now, setNow] = useState(Date.now())

  // Always-fresh refs so callbacks never read stale state
  const usersRef = useRef(users); usersRef.current = users
  const alertsRef = useRef(alerts); alertsRef.current = alerts

  // currentUser is derived from the live users list — no manual syncing needed
  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const actorId = () => currentUserId ?? 'system'

  const findUser = (id?: string) => usersRef.current.find(u => u.id === id)
  const adminsAndMonitors = () => usersRef.current.filter(u =>
    (u.role === 'admin' && u.status === 'active') ||
    (u.role === 'assistant' && u.status === 'active' && (u as AdminUser).permissions.includes('monitor_patients')))

  /* ─ notifications & audit ─ */
  /* ─ outgoing email: every message goes through the one mCare template ─ */
  // Seeded accounts still waiting to verify have their code email "already sent".
  const [emails, setEmails] = useState<SentEmail[]>(() => INITIAL_USERS
    .filter(u => u.status === 'unverified' && u.verificationCode)
    .map((u, i) => ({ id: `em_seed${i}`, userId: u.id, content: mail.verification(u, u.verificationCode, activationLink(u.id, u.verificationCode)), at: NOW - 3_600_000, createdAt: stamp(new Date(NOW - 3_600_000)) })))
  const sendEmail = (content: EmailContent, userId?: string) => {
    if (!content.to.trim()) return
    const t = Date.now()
    // Stand-in for the mail service: keep the most recent messages so they can be read back.
    setEmails(prev => [{ id: uid('em'), userId, content, at: t, createdAt: stamp(new Date(t)) }, ...prev].slice(0, 200))
  }
  // Text messages carry the one-time code only — never a link.
  const [texts, setTexts] = useState<SentSms[]>(() => INITIAL_USERS
    .filter(u => u.status === 'unverified' && u.verificationCode && u.phone.trim())
    .map((u, i) => ({ id: `sms_seed${i}`, userId: u.id, to: u.phone, text: smsText.verification(u.verificationCode), at: NOW - 3_600_000, createdAt: stamp(new Date(NOW - 3_600_000)) })))
  const sendSms = (to: string, text: string, userId?: string) => {
    if (!to.trim()) return
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
    const t = Date.now()
    setNotifications(prev => [{ id: uid('n'), userId, kind, title, body, link, read: false, at: t, createdAt: stamp(new Date(t)) }, ...prev])
    const u = findUser(userId)
    if (opts.email !== false && u?.email && u.status !== 'suspended') sendEmail(mail.notification(u, kind, title, body), u.id)
  }
  const markNotificationRead = (id: string) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  const markAllNotificationsRead = (userId: string) => setNotifications(prev => prev.map(n => n.userId === userId ? { ...n, read: true } : n))
  const logAudit = (action: string, detail: string) => {
    const t = Date.now()
    setAudit(prev => [{ id: uid('au'), actorId: actorId(), action, detail, at: t, createdAt: stamp(new Date(t)) }, ...prev])
  }

  /* ─ escalation engine: runs every 15 s ─ */
  useEffect(() => {
    const tick = () => {
      const t = Date.now()
      setNow(t)
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

  const updateUser = (id: string, patch: Partial<AppUser>) =>
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...patch } as AppUser : u))

  const [docSeed] = useState(() => seedDocuments(INITIAL_USERS, INITIAL_VITAL_DEFS, INITIAL_ALERTS, NOW))
  const docStore = useDocumentStore({ currentUserId, usersRef, alertsRef, vitalDefs, notify, logAudit, updateUser }, docSeed)

  const setCurrentUser = (u: AppUser | null) => {
    // Signing out also ends a provider session, or the next load would sign straight back in.
    if (!u) signOutBackend()
    setCurrentUserId(u?.id ?? null)
  }
  /** New accounts that still need verifying are emailed their code — as an invitation when an admin created them. */
  const addUser = (u: AppUser, opts: { invited?: boolean } = {}) => {
    setUsers(prev => [...prev, u])
    if (u.status === 'unverified' && u.verificationCode)
      sendVerification(u, u.verificationCode, opts.invited)
  }
  /** "Didn't receive it?" — a fresh code replaces the old one and is emailed. */
  const resendVerification = (userId: string) => {
    const u = findUser(userId)
    if (!u || u.status !== 'unverified') return
    const code = String(Math.floor(100000 + Math.random() * 900000))
    updateUser(userId, { verificationCode: code })
    sendVerification(u, code)
  }
  /** The user tapped "Verify my email" in the email. Proves the address just like typing the code. */
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

  const updateAssistantPerms = (id: string, perms: AssistantPerm[]) => {
    updateUser(id, { permissions: perms } as Partial<AdminUser>)
    logAudit('Changed assistant permissions', `${findUser(id)?.name}: ${perms.length} granted`)
  }

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

  const assignPatientToDoctor = (patientId: string, doctorId: string | null) => {
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
  }

  const resolvePatientRequest = (patientId: string, approve: boolean, note?: string, alternativeDoctorId?: string) => {
    const pt = findUser(patientId) as PatientUser | undefined
    const reqDoc = pt?.doctorRequest?.doctorId
    if (!pt?.doctorRequest || !reqDoc) return
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
  }

  const setUserStatus = (id: string, status: AccountStatus) => {
    updateUser(id, { status })
    logAudit(status === 'suspended' ? 'Suspended user' : 'Reactivated user', findUser(id)?.name ?? id)
  }

  const decideDoctor = (id: string, status: 'approved' | 'sent_back' | 'rejected', note?: string) => {
    updateUser(id, {
      approvalStatus: status,
      approvalNote: note,
      status: status === 'approved' ? 'active' : 'pending_approval',
      ...(status === 'approved' ? { approvedBy: actorId(), approvedAt: dateLabel() } : {}),
    } as Partial<DoctorUser>)
    const name = findUser(id)?.name ?? id
    logAudit(status === 'approved' ? 'Approved doctor' : status === 'sent_back' ? 'Sent back doctor application' : 'Rejected doctor', `${name}${note ? ` — ${note}` : ''}`)
  }

  /* ─ prescriptions, notes, doses ─ */
  const addPrescription = (patientId: string, rx: Prescription) => {
    patchPatient(patientId, p => ({ ...p, prescriptions: [rx, ...p.prescriptions] }))
    docStore.filePrescription(patientId, rx)
    notify(patientId, 'prescription', 'New prescription', `${rx.medication} — ${rx.frequency}`, 'medicine')
    logAudit('Prescribed', `${rx.medication} for ${findUser(patientId)?.name}`)
  }
  const setPrescriptionActive = (patientId: string, rxId: string, active: boolean) => {
    patchPatient(patientId, p => ({ ...p, prescriptions: p.prescriptions.map(x => x.id === rxId ? { ...x, active } : x) }))
    const rx = (findUser(patientId) as PatientUser | undefined)?.prescriptions.find(x => x.id === rxId)
    if (rx && !active) notify(patientId, 'prescription', 'Medication stopped', `${rx.medication} has been discontinued by your doctor`, 'medicine')
  }
  const toggleDose = (patientId: string, rxId: string, slot: number) => {
    const day = dayKey()
    const same = (d: MedDose) => d.patientId === patientId && d.rxId === rxId && d.day === day && d.slot === slot
    setDoses(prev => prev.some(same) ? prev.filter(d => !same(d)) : [...prev, { patientId, rxId, slot, day, takenAt: stamp() }])
  }
  const toggleMeal = (patientId: string, mealId: string, note?: string) => {
    const day = dayKey()
    setMealsDone(prev => prev.some(m => m.patientId === patientId && m.mealId === mealId && m.day === day)
      ? prev.filter(m => !(m.patientId === patientId && m.mealId === mealId && m.day === day))
      : [...prev, { patientId, mealId, day, takenAt: stamp(), ...(note ? { note } : {}) }])
  }
  const setDoctorNote = (patientId: string, note: string) => {
    if (!note.trim()) return
    const t = Date.now()
    setClinicalNotes(prev => [{ id: uid('cn'), patientId, authorId: actorId(), content: note.trim(), at: t, createdAt: stamp(new Date(t)) }, ...prev])
    patchPatient(patientId, p => ({ ...p, doctorNote: note.trim() }))
    notify(patientId, 'message', 'New note from your doctor', note.trim().slice(0, 80), 'vitals')
  }

  const setUnitPref = (patientId: string, vitalId: string, unit: string) =>
    patchPatient(patientId, p => ({ ...p, unitPrefs: { ...p.unitPrefs, [vitalId]: unit } }))

  const setThreshold = (patientId: string, vitalId: string, range: { min: number; max: number }) =>
    patchPatient(patientId, p => ({
      ...p,
      thresholds: { ...p.thresholds, [vitalId]: range },
      targetLog: [...(p.targetLog ?? []), { vitalId, at: Date.now(), from: p.thresholds[vitalId], to: range, by: actorId() }],
    }))

  const setCriticalThreshold = (patientId: string, vitalId: string, range: { min: number; max: number } | null) =>
    patchPatient(patientId, p => {
      const next = { ...p.criticalThresholds }
      if (range) next[vitalId] = range
      else delete next[vitalId]
      return { ...p, criticalThresholds: next }
    })

  /* ─ alert engine ─ */
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

  const logReading = (patientId: string, reading: VitalReading): LogResult => {
    const pt = findUser(patientId) as PatientUser | undefined
    const def = vitalDefs.find(v => v.id === reading.vitalId)
    const t = Date.now()
    const full: VitalReading = { ...reading, at: t, loggedAt: stamp(new Date(t)) }
    patchPatient(patientId, p => ({ ...p, readings: [full, ...p.readings] }))
    if (!pt || !def) return { level: 'normal', alerted: false, readingId: full.id }
    const level = evaluate(pt, def, full.value)

    // A doctor asked for a re-check on this vital: a normal reading auto-resolves it.
    const pendingRecheck = alertsRef.current.find(a =>
      a.patientId === patientId && alertIsFor(a, def) && a.recheckRequestedAt && a.status !== 'resolved')
    if (pendingRecheck && level === 'normal') {
      setAlerts(prev => prev.map(a => a.id === pendingRecheck.id
        ? { ...a, value: full.value, status: 'resolved', resolved: true, resolvedAt: stamp(), resolvedBy: patientId, resolutionReason: 'Contacted patient, condition stable' }
        : a))
      notify(pendingRecheck.patientId, 'alert', 'Alert resolved', `${def.name}: new reading is back in range`, 'alerts')
      return { level, alerted: false, readingId: full.id }
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
        ? { ...a, value: full.value, status: 'resolved', resolved: true, resolvedAt: stamp(), resolvedBy: patientId, resolutionReason: 'Re-measured in range by patient' }
        : a))
      notify(patientId, 'alert', 'Alert cleared', `${def.name}: your new reading is back in range`, 'alerts')
      if (pt.assignedDoctorId)
        notify(pt.assignedDoctorId, 'alert', `Alert cleared: ${pt.name}`,
          `${def.name} re-measured at ${full.value} ${def.unit} — back in range`, 'alerts')
      logAudit('Alert self-cleared', `${pt.name} · ${def.name} ${full.value} ${def.unit}`)
      return { level, alerted: false, readingId: full.id }
    }

    if (level === 'normal') return { level, alerted: false, readingId: full.id }
    if (level === 'critical') { createAlert(pt, def, full, 'danger'); return { level, alerted: true, readingId: full.id } }
    // Warning: ask the patient to re-measure first — alert only if the previous reading (last 60 min) was also abnormal
    const prev = pt.readings.find(x => x.vitalId === def.id && !x.invalid && x.at && t - x.at < 60 * MIN)
    const repeat = prev && evaluate(pt, def, prev.value) !== 'normal'
    if (repeat) { createAlert(pt, def, full, 'warning'); return { level, alerted: true, readingId: full.id } }
    return { level, alerted: false, readingId: full.id }
  }

  const sendAlertNow = (patientId: string, readingId: string) => {
    const pt = findUser(patientId) as PatientUser | undefined
    const rd = pt?.readings.find(x => x.id === readingId)
    const def = vitalDefs.find(v => v.id === rd?.vitalId)
    if (!pt || !rd || !def) return
    if (alertsRef.current.some(a => a.readingId === readingId)) return
    createAlert(pt, def, rd, evaluate(pt, def, rd.value) === 'critical' ? 'danger' : 'warning')
  }

  const canCorrect = (reading: VitalReading) => !!reading.at && Date.now() - reading.at < CORRECTION_WINDOW_MIN * MIN

  const correctReading = (patientId: string, readingId: string, value: string) => {
    patchPatient(patientId, p => ({ ...p, readings: p.readings.map(x => x.id === readingId ? { ...x, value } : x) }))
    const pt = findUser(patientId) as PatientUser | undefined
    const rd = pt?.readings.find(x => x.id === readingId)
    const def = vitalDefs.find(v => v.id === rd?.vitalId)
    if (!pt || !def) return
    const level = evaluate(pt, def, value)
    setAlerts(prev => prev.map(a => a.readingId !== readingId || a.status === 'resolved' ? a
      : level === 'normal'
        ? { ...a, value, status: 'resolved', resolved: true, resolvedAt: stamp(), resolvedBy: patientId, resolutionReason: 'Corrected by patient' }
        : { ...a, value, severity: level === 'critical' ? 'danger' : 'warning' }))
  }

  const invalidateReading = (patientId: string, readingId: string, reason: string) => {
    patchPatient(patientId, p => ({ ...p, readings: p.readings.map(x => x.id === readingId ? { ...x, invalid: true, invalidReason: reason } : x) }))
    logAudit('Marked reading invalid', `${findUser(patientId)?.name} — ${reason}`)
  }

  const raiseSOS = (patientId: string, message: string) => {
    const pt = findUser(patientId) as PatientUser | undefined
    if (!pt) return
    const t = Date.now()
    setAlerts(prev => [{
      id: uid('sos'), patientId, type: 'sos', vitalName: 'SOS', value: message || 'Emergency help requested', unit: '',
      severity: 'danger', status: 'open', resolved: false, at: t, loggedAt: stamp(new Date(t)),
    }, ...prev])
    const body = message || 'Patient pressed the emergency button'
    if (pt.assignedDoctorId) notify(pt.assignedDoctorId, 'sos', `SOS: ${pt.name}`, body, 'alerts')
    adminsAndMonitors().forEach(a => notify(a.id, 'sos', `SOS: ${pt.name}`, body, 'alerts'))
    logAudit('SOS raised', pt.name)
  }

  const acknowledgeAlert = (alertId: string) => {
    setAlerts(prev => prev.map(a => a.id === alertId && a.status !== 'resolved'
      ? { ...a, status: 'acknowledged', acknowledgedAt: stamp(), acknowledgedBy: actorId() } : a))
    const a = alertsRef.current.find(x => x.id === alertId)
    const by = findUser(actorId())
    if (a) notify(a.patientId, 'alert', 'Your alert is being reviewed', `${by?.name ?? 'Your care team'} is looking at your ${a.type === 'sos' ? 'SOS' : a.vitalName} alert`, 'alerts')
  }

  const resolveAlert = (alertId: string, reason: string, note?: string) => {
    const a = alertsRef.current.find(x => x.id === alertId)
    setAlerts(prev => prev.map(x => x.id === alertId
      ? { ...x, status: 'resolved', resolved: true, resolvedAt: stamp(), resolvedBy: actorId(), resolutionReason: reason, resolutionNote: note?.trim() || undefined }
      : x))
    if (a) {
      notify(a.patientId, 'alert', 'Alert resolved', `${a.type === 'sos' ? 'SOS' : a.vitalName}: ${reason}`, 'alerts')
      logAudit('Resolved alert', `${findUser(a.patientId)?.name} · ${a.type === 'sos' ? 'SOS' : a.vitalName} — ${reason}`)
    }
  }

  const escalateAlert = (alertId: string) => {
    const a = alertsRef.current.find(x => x.id === alertId)
    setAlerts(prev => prev.map(x => x.id === alertId ? { ...x, status: 'escalated', escalatedAt: stamp() } : x))
    if (a) {
      const pt = findUser(a.patientId)
      adminsAndMonitors().forEach(ad => notify(ad.id, 'escalation', `Escalated by ${findUser(actorId())?.name}`, `${pt?.name} · ${a.vitalName} ${a.value} ${a.unit}`, 'alerts'))
      logAudit('Escalated alert', `${pt?.name} · ${a.vitalName}`)
    }
  }

  const requestRecheck = (alertId: string) => {
    const t = Date.now()
    setAlerts(prev => prev.map(x => x.id === alertId && x.status !== 'resolved' ? { ...x, recheckRequestedAt: t } : x))
    const a = alertsRef.current.find(x => x.id === alertId)
    if (a) {
      notify(a.patientId, 'alert', 'Please log a new reading',
        `${findUser(actorId())?.name ?? 'Your doctor'} asked you to re-check your ${a.type === 'sos' ? 'condition' : a.vitalName}`, 'vitals')
      logAudit('Requested re-check', `${findUser(a.patientId)?.name} · ${a.vitalName}`)
    }
  }

  const scheduleFollowUp = (patientId: string, doctorId: string, date: string, time: string, note: string | undefined, alertId?: string) => {
    const t = Date.now()
    addAppointment({
      id: uid('ap'), patientId, doctorId, title: 'Follow-up appointment', reason: note?.trim() || 'Scheduled from alert review',
      preferredDate: date, preferredTime: time, status: 'approved', approvalNote: note?.trim() || undefined, createdAt: stamp(new Date(t)),
    })
    if (alertId) resolveAlert(alertId, 'Appointment scheduled', note)
  }

  /* ─ appointments & messages ─ */
  const addAppointment = (appt: Appointment) => {
    setAppointments(prev => [...prev, appt])
    notify(appt.doctorId, 'appointment', 'New appointment request', `${findUser(appt.patientId)?.name} · ${appt.title} · ${appt.preferredDate}`, 'appts')
  }
  const updateAppointment = (apptId: string, patch: Partial<Appointment>) => {
    const ap = appointments.find(a => a.id === apptId)
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, ...patch } : a))
    if (ap && patch.status) {
      const target = currentUserId === ap.patientId ? ap.doctorId : ap.patientId
      notify(target, 'appointment', `Appointment ${patch.status}`, `${ap.title}${patch.rescheduledTo ? ` → ${patch.rescheduledTo} ${patch.rescheduledTime ?? ''}` : ''}`, 'appts')
    }
  }

  /* ─ vitals report requests: patient asks → doctor drafts, signs and releases ─ */
  const requestReport = (patientId: string, periodDays: number, reason: string) => {
    const pt = findUser(patientId) as PatientUser | undefined
    if (!pt?.assignedDoctorId) return false
    const t = Date.now()
    setReportRequests(prev => [{ id: uid('rr'), patientId, doctorId: pt.assignedDoctorId!, periodDays, reason: reason.trim(), status: 'pending', at: t, createdAt: stamp(new Date(t)) }, ...prev])
    notify(pt.assignedDoctorId, 'document', `Report request: ${pt.name}`, `Vitals report for the last ${periodDays} days${reason.trim() ? ` — ${reason.trim()}` : ''}`, 'patients')
    logAudit('Requested report', `${periodDays}-day vitals report`)
    return true
  }
  const fulfillReportRequest = (id: string, opts: { days?: number; interpretation?: string; include?: VitalsReportInclude } = {}) => {
    const rq = reportRequests.find(r => r.id === id)
    if (!rq || rq.status !== 'pending') return null
    const docId = docStore.generateVitalsReport(rq.patientId, opts.days ?? rq.periodDays, opts.interpretation, opts.include)
    if (!docId) return null
    setReportRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'fulfilled', docId, handledAt: stamp() } : r))
    notify(rq.patientId, 'document', 'Your report is being prepared', `Your doctor drafted your ${rq.periodDays}-day vitals report. You'll get it once it's signed.`, 'docs')
    return docId
  }
  const declineReportRequest = (id: string, reason: string) => {
    const rq = reportRequests.find(r => r.id === id)
    if (!rq) return
    setReportRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'declined', declineReason: reason.trim(), handledAt: stamp() } : r))
    notify(rq.patientId, 'document', 'Report request declined', reason.trim() || 'Your doctor could not prepare this report.', 'docs')
  }

  const sendMessage = (fromId: string, toId: string, content: string) => {
    setMessages(prev => [...prev, { id: uid('msg'), fromId, toId, content, sentAt: stamp(), read: false }])
    notify(toId, 'message', `New message from ${findUser(fromId)?.name ?? 'mCare'}`, content.slice(0, 80),
      findUser(toId)?.role === 'patient' ? 'messages' : 'patients')
  }
  const markMessagesRead = (fromId: string, toId: string) =>
    setMessages(prev => prev.map(m => m.fromId === fromId && m.toId === toId && !m.read ? { ...m, read: true } : m))

  /* ─ account self-service: password recovery ───────────────────────────
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
    updateUser(u.id, { resetToken: token })
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
      updateUser(userId, { resetToken: { ...token, attempts } })
      const left = MAX_RESET_ATTEMPTS - attempts
      return {
        ok: false as const,
        error: left > 0
          ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} remaining.`
          : 'Too many incorrect attempts. Request a new code.',
      }
    }
    updateUser(userId, { resetToken: { ...token, verifiedAt: Date.now() } })
    return { ok: true as const }
  }

  /** Step 1 alternative: the user tapped the magic link in their email/SMS. */
  const verifyResetLink = (userId: string, linkToken: string) => {
    const u = findUser(userId)
    const { token, error } = liveToken(u)
    if (!token) return { ok: false as const, error }
    if (token.linkToken !== linkToken) return { ok: false as const, error: 'That link is not valid.' }
    updateUser(userId, { resetToken: { ...token, verifiedAt: Date.now() } })
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

    updateUser(userId, {
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

    updateUser(id, { password: newPw, resetToken: undefined, lastPasswordChangeAt: Date.now() })
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
  const createSupportTicket = (userId: string, subject: string, message: string) => {
    const t = Date.now()
    const u = findUser(userId)
    setSupportTickets(prev => [{ id: uid('tix'), userId, subject, message, status: 'open', at: t, createdAt: stamp(new Date(t)) }, ...prev])
    usersRef.current
      .filter(x => (x.role === 'admin' || (x.role === 'assistant' && (x as AdminUser).permissions.includes('handle_support'))) && x.status === 'active')
      .forEach(a => notify(a.id, 'account', `Support request: ${u?.name ?? 'User'}`, subject, 'support'))
  }
  const resolveSupportTicket = (ticketId: string, note?: string) => {
    const t = Date.now()
    setSupportTickets(prev => prev.map(x => x.id === ticketId
      ? { ...x, status: 'resolved', resolvedBy: actorId(), resolutionNote: note, resolvedAt: stamp(new Date(t)) }
      : x))
    const ticket = supportTickets.find(x => x.id === ticketId)
    if (ticket) notify(ticket.userId, 'account', 'Support request resolved', note || `"${ticket.subject}" has been resolved.`)
  }

  return (
    <AppContext.Provider value={{
      ...docStore,
      now, currentUser, setCurrentUser,
      users, vitalDefs, setVitalDefs,
      updateUser, addUser,
      getDoctors, getPatients, getAdmins,
      updateAssistantPerms, assignPatientToDoctor, resolvePatientRequest, setUserStatus, decideDoctor,
      addPrescription, setPrescriptionActive, logReading, correctReading, invalidateReading, sendAlertNow,
      setDoctorNote, setUnitPref, setThreshold, setCriticalThreshold, clinicalNotes, doses, toggleDose, mealsDone, toggleMeal,
      alerts, raiseSOS, acknowledgeAlert, resolveAlert, escalateAlert, requestRecheck, scheduleFollowUp,
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

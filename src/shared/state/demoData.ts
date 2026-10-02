/**
 * Sample data for demo mode: the people and records the prototype starts with
 * when no backend is configured. None of it is used in live mode, where
 * everything comes from the database (see shared/api/records.ts).
 */
import type {
  AppUser, VitalDef, PatientUser, DoctorUser, AdminUser, VitalReading, AppAlert, Appointment, PatientMessage,
  AppNotification, NotifKind, AuditEntry, ClinicalNote,
} from '@/shared/lib/types'
import { stamp } from '@/shared/lib/vitals'

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
  { id: 'ap1', patientId: 'p1', doctorId: 'd1', title: 'Cardiology Consultation', reason: 'Follow up on elevated blood pressure readings', preferredDate: 'Oct 4, 2026', preferredTime: '9:00 AM', location: 'Kenyatta National Hospital', status: 'approved', createdBy: 'p1', createdAt: 'Sep 20, 2026' },
  { id: 'ap2', patientId: 'p3', doctorId: 'd1', title: 'Diabetic Review', reason: 'Monthly glucose and weight check', preferredDate: 'Oct 10, 2026', preferredTime: '11:00 AM', status: 'requested', createdBy: 'p3', createdAt: 'Sep 25, 2026' },
  { id: 'ap3', patientId: 'p1', doctorId: 'd1', title: 'General Check-up', reason: 'Routine monitoring and medication review', preferredDate: 'Oct 28, 2026', preferredTime: '10:00 AM', status: 'requested', createdBy: 'p1', createdAt: 'Sep 27, 2026' },
  { id: 'ap4', patientId: 'p3', doctorId: 'd1', title: 'SpO₂ Follow-up', reason: 'SpO₂ has been consistently low, need evaluation', preferredDate: 'Oct 2, 2026', preferredTime: '2:00 PM', status: 'rescheduled', rescheduledTo: 'Oct 5, 2026', rescheduledTime: '3:00 PM', rescheduledReason: 'Doctor unavailable Oct 2 — rescheduled to Oct 5.', createdBy: 'p3', createdAt: 'Sep 22, 2026' },
]

const INITIAL_MESSAGES: PatientMessage[] = [
  { id: 'msg1', fromId: 'd1', toId: 'p1', content: 'Your blood pressure is significantly elevated. Please reduce sodium intake, rest well, and monitor twice daily.', sentAt: stamp(new Date(NOW - 40 * MIN)), read: true },
  { id: 'msg2', fromId: 'p1', toId: 'd1', content: 'Thank you doctor. I will follow your advice and monitor closely.', sentAt: stamp(new Date(NOW - 30 * MIN)), read: true },
  { id: 'msg3', fromId: 'd1', toId: 'p3', content: 'Samuel, your SpO₂ dropped. Please rest and avoid strenuous activity. Contact me if it stays below 93%.', sentAt: stamp(new Date(NOW - 20 * MIN)), read: false },
]

const INITIAL_NOTES: ClinicalNote[] = [
  { id: 'cn1', patientId: 'p1', authorId: 'd1', content: p1.doctorNote!, createdAt: stamp(new Date(NOW - 1 * DAY)), at: NOW - DAY, visibility: 'shared', noteType: 'instruction' },
  { id: 'cn2', patientId: 'p3', authorId: 'd1', content: p3.doctorNote!, createdAt: stamp(new Date(NOW - 20 * MIN)), at: NOW - 20 * MIN, visibility: 'shared', noteType: 'instruction' },
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

/** Everything demo mode starts from. */
export const DEMO = {
  now: NOW,
  users: INITIAL_USERS,
  vitalDefs: INITIAL_VITAL_DEFS,
  alerts: INITIAL_ALERTS,
  appointments: INITIAL_APPOINTMENTS,
  messages: INITIAL_MESSAGES,
  clinicalNotes: INITIAL_NOTES,
  notifications: INITIAL_NOTIFS,
  audit: INITIAL_AUDIT,
}

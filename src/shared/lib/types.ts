export type UserRole = 'patient' | 'doctor' | 'admin' | 'assistant'
export type ApprovalStatus = 'pending' | 'approved' | 'sent_back' | 'rejected'
export type AccountStatus = 'unverified' | 'pending_approval' | 'active' | 'suspended'

export type AssistantPerm =
  | 'approve_doctors'
  | 'create_users'
  | 'view_logs'
  | 'assign_healthworkers'
  | 'approve_patient_requests'
  | 'handle_support'
  | 'monitor_patients'
  | 'document_support'

export const PERM_LABELS: Record<AssistantPerm, string> = {
  approve_doctors: 'Approve Doctors',
  create_users: 'Create Users',
  view_logs: 'View Audit Logs',
  assign_healthworkers: 'Assign Healthworkers',
  approve_patient_requests: 'Approve Patient Requests',
  handle_support: 'Handle Support Tickets',
  monitor_patients: 'Monitor Patients',
  document_support: 'Document Support (metadata & recovery)',
}

export const ALL_PERMS = Object.keys(PERM_LABELS) as AssistantPerm[]

export interface VitalDef {
  id: string
  name: string
  unit: string
  normalMin: number
  normalMax: number
  icon: string
  active: boolean
  /** Readings at or beyond these are critical (danger). Optional → derived. */
  criticalMin?: number
  criticalMax?: number
  /** Plausible input limits — values outside are rejected as typos. */
  hardMin: number
  hardMax: number
  /** Blood pressure only: diastolic ranges */
  diaNormalMin?: number
  diaNormalMax?: number
  diaCriticalMin?: number
  diaCriticalMax?: number
  /** Alternate display/input units this vital supports (device-dependent), e.g. ['°F','°C']. All stored values, thresholds and hard limits stay in `unit` (the canonical unit); conversion happens only at the display/input boundary. First entry should equal `unit`. */
  unitOptions?: string[]
}

/** How the account was created. Social accounts have no local password. */
export type AuthProvider = 'email' | 'google' | 'apple' | 'facebook' | 'instagram' | 'x' | 'yahoo'

export const AUTH_PROVIDER_LABELS: Record<AuthProvider, string> = {
  email: 'Email & Password',
  google: 'Google',
  apple: 'Apple',
  x: 'X',
  yahoo: 'Yahoo',
  facebook: 'Facebook',
  instagram: 'Instagram',
}

/** Where a one-time code / magic link was delivered. */
export type ResetChannel = 'email' | 'sms'

/**
 * A live password-recovery challenge. Exactly one is outstanding per user;
 * requesting a new one replaces the old, and a successful reset clears it.
 */
export interface ResetToken {
  /** 6-digit code the user types in. */
  code: string
  /** Opaque token behind the emailed "reset my password" link. */
  linkToken: string
  channel: ResetChannel
  /** Where it went, already masked for display (e.g. "j•••@example.com"). */
  sentTo: string
  issuedAt: number
  expiresAt: number
  /** Wrong-code attempts so far. The token dies at MAX_RESET_ATTEMPTS. */
  attempts: number
  /** Set once the code is typed correctly or the link is opened. */
  verifiedAt?: number
}

/** Minutes a reset code / link stays valid. */
export const RESET_TTL_MIN = 10
/** Wrong-code attempts allowed before the token is burned. */
export const MAX_RESET_ATTEMPTS = 5

export type ThemePref = 'light' | 'dark' | 'auto'
export type FontSizePref = 'sm' | 'md' | 'lg'

export interface AvatarSpec {
  emoji: string
  gradient: string  // key into AVATAR_GRADIENTS
  /** Uploaded profile picture as a data URL. Takes precedence over emoji/initials. */
  photo?: string
}

export interface BaseUser {
  id: string
  name: string
  email: string
  phone: string
  role: UserRole
  status: AccountStatus
  createdAt: string
  verificationCode: string
  /** Empty for social accounts until the user sets one. */
  password: string
  dob?: string              // YYYY-MM-DD — age is always derived, never stored
  avatar?: AvatarSpec
  theme?: ThemePref
  fontSize?: FontSizePref
  /** How this account signs in. Defaults to 'email' when absent. */
  authProvider?: AuthProvider
  /** Outstanding password-recovery challenge, if any. */
  resetToken?: ResetToken
  /** Epoch ms of the last successful password change. */
  lastPasswordChangeAt?: number
  /** Epoch ms when the user agreed to the Terms and Privacy Policy at sign-up. */
  termsAcceptedAt?: number
}

export interface DoctorRequest {
  doctorId: string
  requestedAt: string
  status: 'pending' | 'approved' | 'rejected'
  responseNote?: string
}

export interface VitalReading {
  id: string
  vitalId: string
  value: string   // string handles "124/82" for BP or "72" for HR
  loggedAt: string
  /** epoch ms — used for sorting, trends and the 15-minute correction window */
  at?: number
  note?: string
  invalid?: boolean
  invalidReason?: string
}

export interface EmergencyContact {
  id: string
  name: string
  relationship: string
  phone: string
  /** The patient's next of kin: the first person to call. At most one contact carries this. */
  nextOfKin?: boolean
}

export type BiologicalSex = 'female' | 'male' | 'intersex' | 'undisclosed'
export type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-'
export type AllergySeverity = 'mild' | 'moderate' | 'severe'

export interface Allergy {
  id: string
  substance: string
  severity: AllergySeverity
  /** What happens, e.g. "rash", "swelling". */
  reaction?: string
}

/**
 * What the patient tells us about their health. Collected at setup, editable
 * from Profile, and shown to their care team.
 */
export interface HealthProfile {
  sex?: BiologicalSex
  /** Undefined means "don't know". */
  bloodType?: BloodType
  allergies: Allergy[]
  /** Explicit "no known allergies": an empty list alone could just mean "never asked". */
  noKnownAllergies?: boolean
  /** Long-term conditions, by name (from COMMON_CONDITIONS or typed by the patient). */
  conditions: string[]
  /** Explicit "no long-term conditions". */
  noConditions?: boolean
  /** Medicines or supplements taken outside mCare prescriptions. */
  otherMedicines?: string
}

export interface ClinicalNote {
  id: string
  patientId: string
  authorId: string
  content: string
  createdAt: string
  at: number
}

export interface MedDose {
  patientId: string
  rxId: string
  slot: number      // scheduled time (minutes after midnight), or ANYTIME_SLOT
  day: string       // YYYY-MM-DD
  takenAt: string
}

export interface MealDone {
  patientId: string
  mealId: string
  day: string       // YYYY-MM-DD
  takenAt: string
  note?: string     // what was actually eaten, when it differs from the plan
}

export type NotifKind = 'alert' | 'sos' | 'message' | 'appointment' | 'assignment' | 'prescription' | 'account' | 'escalation' | 'document'

export interface AppNotification {
  id: string
  userId: string
  kind: NotifKind
  title: string
  body: string
  createdAt: string
  at: number
  read: boolean
  /** tab to open when tapped */
  link?: string
}

export type EmailKind = 'verification' | 'invitation' | 'password_reset' | 'password_changed' | 'welcome' | 'notification'

/** What goes into an email. The layout (logo, colours, footer) is always the mCare template. */
export interface EmailContent {
  /** Recipient address. */
  to: string
  kind: EmailKind
  subject: string
  /** Inbox preview line. */
  preheader?: string
  heading: string
  greeting?: string
  lines: string[]
  /** One-time code shown in the highlighted box. */
  code?: { label: string; value: string; expires?: string }
  /** Button linking back into mCare. */
  action?: { label: string; url: string; fallback?: string }
  /** Paragraphs after the code / button. */
  after?: string[]
  /** "Wasn't you?" note. */
  security?: string
  /** `urgent` turns the accent red (SOS and escalations). */
  tone?: 'urgent'
}

/** One email handed to the mail service. Kept so support and the recipient can see what was sent. */
export interface SentEmail {
  id: string
  userId?: string
  content: EmailContent
  at: number
  createdAt: string
}

/** A text message to a phone. Only ever a one-time code — links go by email. */
export interface SentSms {
  id: string
  userId?: string
  to: string
  text: string
  at: number
  createdAt: string
}

export interface AuditEntry {
  id: string
  actorId: string
  action: string
  detail: string
  at: number
  createdAt: string
}

export interface Prescription {
  id: string
  medication: string
  dosage: string
  frequency: string
  purpose: string
  prescribedAt: string
  doctorId: string
  active: boolean
}

export interface TargetChange {
  vitalId: string
  /** epoch ms */
  at: number
  /** The range in force before; absent when this was the first personal target. */
  from?: { min: number; max: number }
  to: { min: number; max: number }
  /** User id of whoever changed it. */
  by: string
}

export interface PatientUser extends BaseUser {
  role: 'patient'
  assignedDoctorId?: string
  doctorRequest?: DoctorRequest
  trackedVitalIds: string[]
  thresholds: Record<string, { min: number; max: number }>
  /** Every change a clinician made to a target range, so a vital's page can show when the goal moved. */
  targetLog?: TargetChange[]
  /** Doctor-set critical band per vital, overriding the admin default for this patient. */
  criticalThresholds?: Record<string, { min: number; max: number }>
  /** Patient's preferred display/input unit per vital (must be one of that vital's unitOptions). Falls back to the vital's canonical unit. */
  unitPrefs?: Record<string, string>
  prescriptions: Prescription[]
  readings: VitalReading[]    // newest first
  doctorNote?: string         // latest note shown to the patient
  emergencyContacts?: EmergencyContact[]
  /** Document privacy preferences. Enforced by the document access policy, not just the UI. */
  docPrefs?: PatientDocPrefs
  health?: HealthProfile
  /**
   * New accounts start 'pending' and are routed to the health-profile setup; absent means nothing to do.
   * 'skipped' lets the patient into the portal, where Home reminds them to finish it.
   */
  profileSetup?: 'pending' | 'skipped' | 'done'
}

export interface PatientDocPrefs {
  /** New personal uploads start private (patient only) instead of shared with the care team. */
  privateByDefault: boolean
}

export interface DoctorUser extends BaseUser {
  role: 'doctor'
  specialty: string
  licenseNo: string
  hospital: string
  approvalStatus: ApprovalStatus
  approvalNote?: string
  approvedBy?: string
  approvedAt?: string
  assignedPatientIds: string[]
  /** Handwritten signature (PNG data URL, transparent background). Stamped onto each report at signing. */
  signature?: string
}

export interface AdminUser extends BaseUser {
  role: 'admin' | 'assistant'
  isAssistant: boolean
  permissions: AssistantPerm[]
}

export type AppUser = PatientUser | DoctorUser | AdminUser

export interface AppAlert {
  id: string
  patientId: string
  /** The vital this alert is about. Absent on SOS alerts and on alerts raised before ids were stored. */
  vitalId?: string
  vitalName: string
  value: string
  unit: string
  loggedAt: string
  severity: 'danger' | 'warning'
  /** kept for backwards compatibility — true when status === 'resolved' */
  resolved: boolean
  resolvedAt?: string
  resolutionNote?: string
  type: 'vital' | 'sos'
  status: AlertStatus
  at: number
  readingId?: string
  acknowledgedAt?: string
  acknowledgedBy?: string
  resolvedBy?: string
  resolutionReason?: string
  escalatedAt?: string
  /** Set when a doctor asks the patient to log a fresh reading for this vital. A normal follow-up reading auto-resolves the alert. */
  recheckRequestedAt?: number
}

export type AlertStatus = 'open' | 'acknowledged' | 'escalated' | 'resolved'

export const RESOLUTION_REASONS = [
  'Contacted patient, condition stable',
  'Medication adjusted',
  'Appointment scheduled',
  'Referred to emergency care',
  'False reading / device error',
  "Expected for patient's condition",
  'Other',
] as const

export type AppointmentStatus = 'requested' | 'approved' | 'rejected' | 'rescheduled' | 'completed' | 'cancelled'

export interface Appointment {
  id: string
  patientId: string
  doctorId: string
  title: string
  reason: string
  preferredDate: string
  preferredTime: string
  location?: string
  status: AppointmentStatus
  approvalNote?: string
  rejectionReason?: string
  rescheduledTo?: string
  rescheduledTime?: string
  rescheduledReason?: string
  createdAt: string
}

/** A patient asking their care team for an official vitals report. */
export interface ReportRequest {
  id: string
  patientId: string
  doctorId: string
  periodDays: number
  reason: string
  status: 'pending' | 'fulfilled' | 'declined'
  at: number
  createdAt: string
  docId?: string          // the report drafted for this request
  declineReason?: string
  handledAt?: string
}

export interface PatientMessage {
  id: string
  fromId: string
  toId: string
  content: string
  sentAt: string
  read: boolean
}

export type SupportTicketStatus = 'open' | 'resolved'

export interface SupportTicket {
  id: string
  userId: string
  subject: string
  message: string
  status: SupportTicketStatus
  createdAt: string
  at: number
  resolvedBy?: string
  resolutionNote?: string
  resolvedAt?: string
}

/* ─── Documents & reports ─────────────────────────────────────────────
   One library per patient. Every document — a patient's own upload, a
   file a clinician attaches, or a report the system generates from the
   record — lives in the same structure, so search, access control,
   versioning, audit and recovery work the same way for all of them.
   What a given user may see is decided only by the access policy in
   documents.ts; screens never filter for privacy themselves. */

export type DocCategory =
  | 'vitals_report' | 'lab' | 'imaging' | 'prescription' | 'visit_summary'
  | 'discharge' | 'referral' | 'insurance' | 'personal' | 'other'

/** Who produced the document. Clinician and system documents are "official"; patient uploads are "personal". */
export type DocOrigin = 'patient_upload' | 'clinician_upload' | 'system_generated'

/** File-transfer lifecycle. Only uploads have one; generated reports start ready. */
export type UploadState = 'uploading' | 'scanning' | 'ready' | 'failed'

/** Clinical lifecycle of an official document. Patients only ever see `released`. */
export type ClinicalStatus = 'draft' | 'signed' | 'released'

/** Personal uploads only: `private` hides the file from the care team. Official documents are always `care_team`. */
export type DocVisibility = 'care_team' | 'private'

/** A pointer back into the clinical record this document was built from. */
export interface DocSourceLink {
  kind: 'reading' | 'alert' | 'prescription' | 'note' | 'appointment'
  id: string
  label: string
}

export interface DocFile {
  /** Sanitised original file name. */
  name: string
  mime: string
  size: number
  /** Content hash — used for duplicate detection, idempotent retries and integrity checks. */
  sha256: string
  /** In-memory stand-in for object storage. Absent for seeded demo files. */
  dataUrl?: string
}

export interface VitalsReportRow {
  vitalId: string
  name: string
  unit: string
  icon: string
  latest: string
  latestAt: string
  average: number
  min: number
  max: number
  target: string
  inRange: number
  total: number
  level: 'normal' | 'warning' | 'critical' | 'none'
  /** Time series for the report chart, oldest first. v2 = diastolic for blood pressure. */
  points?: { at: number; v: number; v2?: number; level: 'normal' | 'warning' | 'critical' }[]
  direction?: 'rising' | 'falling' | 'steady' | 'unknown'
  /** Change first → last reading over the period, canonical units. */
  change?: number
  targetMin?: number
  targetMax?: number
  /** Blood pressure: "126/81"-style average and range, since both numbers matter clinically. */
  averageText?: string
  rangeText?: string
}

/** Sections a doctor can switch on or off when generating a vitals report. */
export interface VitalsReportInclude {
  /** Vitals to report on. Absent = every vital the patient tracks. */
  vitalIds?: string[]
  /** Charts and trend notes per vital. Off = a compact results table. */
  trends: boolean
  findings: boolean
  alerts: boolean
  medications: boolean
  /** Sex, blood type, allergies and long-term conditions. */
  healthProfile: boolean
  /** Appendix listing every reading in the period. */
  readingsLog: boolean
}

export type DocBody =
  | {
      type: 'vitals'
      periodDays: number
      generatedAt: string
      rows: VitalsReportRow[]
      alerts: { id: string; label: string; status: string; at: string; severity?: 'danger' | 'warning'; resolution?: string }[]
      readingsCount: number
      summary: string
      /** Period covered, epoch ms. */
      periodStart?: number
      periodEnd?: number
      /** Clinician-voice key findings, generated from the data. */
      findings?: string[]
      /** Active medications at the time the report was produced. */
      medications?: { name: string; dose: string; frequency: string; purpose: string }[]
      /** The signing clinician's interpretation and plan. Editable until the report is released. */
      interpretation?: string
      /** What the doctor chose to include. Absent on older reports = everything. */
      include?: VitalsReportInclude
    }
  | { type: 'prescription'; medication: string; dosage: string; frequency: string; purpose: string }
  | { type: 'lab'; lab: string; rows: { test: string; value: string; unit: string; ref: string; flag?: 'H' | 'L' }[]; comment?: string }
  | { type: 'text'; text: string }

export interface UploadInfo {
  state: UploadState
  /** 0–100 */
  progress: number
  error?: string
  attempts: number
  /** patient + content hash. Re-sending the same file reuses the record instead of creating a duplicate. */
  idempotencyKey: string
}

export interface MedicalDocument {
  /** Opaque and random — never sequential, so IDs cannot be guessed. */
  id: string
  patientId: string
  title: string
  category: DocCategory
  origin: DocOrigin
  description?: string
  /** Clinical date of the document (YYYY-MM-DD) — used for date filters. */
  documentDate: string
  createdAt: string
  at: number
  /** Uploader or author. */
  createdBy: string
  file?: DocFile
  body?: DocBody
  upload?: UploadInfo
  /** Official documents only. */
  status?: ClinicalStatus
  signedBy?: string
  signedAt?: string
  /** The signer's handwritten signature as it was at signing — later changes to their profile don't alter signed reports. */
  signatureImage?: string
  releasedBy?: string
  releasedAt?: string
  /** Clinician uploads: sign and release automatically once the file is stored. */
  releaseOnReady?: boolean
  /** All versions of one report share a seriesId. */
  seriesId: string
  version: number
  supersedes?: string
  supersededBy?: string
  correctionReason?: string
  links: DocSourceLink[]
  visibility: DocVisibility
  /** Soft delete — recoverable for DOC_RETENTION_DAYS. */
  deletedAt?: number
  deletedBy?: string
  /** Patient has opened the library since this was released to them. */
  seenByPatient?: boolean
}

export type DocAction =
  | 'view' | 'download' | 'upload' | 'upload_failed' | 'retry' | 'rejected' | 'sign' | 'release' | 'correct'
  | 'share' | 'share_revoke' | 'share_open' | 'visibility' | 'delete' | 'restore' | 'support_access' | 'denied'

/** Access-and-change history for a document. Kept separately from the general audit log so patients can see who opened their files. */
export interface DocEvent {
  id: string
  docId: string
  patientId: string
  actorId: string
  action: DocAction
  detail?: string
  at: number
  createdAt: string
}

/** Patient-issued, time-limited link so an outside clinician can view selected documents. */
export interface ShareLink {
  id: string
  token: string
  patientId: string
  docIds: string[]
  recipient: string
  at: number
  createdAt: string
  expiresAt: number
  oneTime: boolean
  usedAt?: number
  revokedAt?: number
}

/** Time-boxed, reason-stated content access for a full admin handling a support case. */
export interface SupportGrant {
  id: string
  adminId: string
  docId: string
  reason: string
  at: number
  expiresAt: number
}

export interface DocBackup {
  id: string
  at: number
  createdAt: string
  createdBy: string
  count: number
  checksum: string
  payload: string
  lastTest?: { at: number; ok: boolean; detail: string }
}

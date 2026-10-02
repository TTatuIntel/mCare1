export type UserRole = 'patient' | 'doctor' | 'admin' | 'assistant'
export type ApprovalStatus = 'pending' | 'approved' | 'sent_back' | 'rejected'
/**
 * unverified        signed up, email not confirmed yet (demo mode)
 * pending_approval  a doctor waiting to be approved
 * active            can use mCare
 * suspended         stopped by an administrator, with a reason
 * deactivated       closed: by the person themself, or by an administrator when someone has left
 * A stopped account keeps its record and can be made active again.
 */
export type AccountStatus = 'unverified' | 'pending_approval' | 'active' | 'suspended' | 'deactivated'
/** The account cannot be used: every request it makes is refused. */
export const isStopped = (status: AccountStatus) => status === 'suspended' || status === 'deactivated'

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
  /** Why the account was suspended or deactivated, and when its status last changed. */
  statusReason?: string
  statusChangedAt?: string
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
  /** Who entered it: the patient, or the treating doctor. */
  recordedBy?: string
  /** What was first saved, when a typo was corrected afterwards. */
  correctedFrom?: string
  /** The doctor who marked it invalid. */
  invalidatedBy?: string
  /** The form's reference (see lib/ids): sent with the save so a repeat is recognised. Never shown. */
  clientRef?: string
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

/** `internal` is the treating doctor's working note; `shared` is also the patient's to read. */
export type NoteVisibility = 'internal' | 'shared'
export type NoteType = 'progress' | 'assessment' | 'plan' | 'instruction' | 'other'
export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  progress: 'Progress', assessment: 'Assessment', plan: 'Plan', instruction: 'Instruction for the patient', other: 'Other',
}

export interface ClinicalNote {
  id: string
  patientId: string
  authorId: string
  content: string
  createdAt: string
  at: number
  visibility: NoteVisibility
  noteType: NoteType
  /** The visit it was written at. */
  appointmentId?: string
  /** The note this one corrects. A note is never rewritten: the correction replaces it. */
  amends?: string
  /** Set on a note that has since been corrected: the id of the note that replaced it. */
  amendedBy?: string
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

export type NotifKind = 'alert' | 'sos' | 'message' | 'appointment' | 'assignment' | 'prescription' | 'account' | 'escalation' | 'document' | 'care_plan' | 'support'

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
  /** The record it is about, so the tap can open that patient or appointment. */
  resource?: { type: string; id: string }
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
  /** The role the author held when it happened. */
  actorRole?: UserRole
  action: string
  detail: string
  /** What the entry is about: the kind of record, its id, and the patient it belongs to. */
  resourceType?: string
  resourceId?: string
  patientId?: string
  at: number
  createdAt: string
}

export type RxRoute = 'oral' | 'topical' | 'inhaled' | 'injection' | 'sublingual' | 'eye' | 'ear' | 'nasal' | 'rectal' | 'other'
export const RX_ROUTE_LABELS: Record<RxRoute, string> = {
  oral: 'By mouth', topical: 'On the skin', inhaled: 'Inhaled', injection: 'Injection', sublingual: 'Under the tongue',
  eye: 'Eye', ear: 'Ear', nasal: 'Nose', rectal: 'Rectal', other: 'Other',
}
/** `completed` is a course that reached its last day; `discontinued` was stopped by the doctor. */
export type RxStatus = 'active' | 'completed' | 'discontinued'

/** One step in a prescription's history. Written by the database. */
export interface RxEvent {
  id: string
  /** prescribed | stopped | completed | restarted */
  action: string
  actorId?: string
  detail?: string
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
  /** True while the patient should be taking it. Always agrees with `status`. */
  active: boolean
  status?: RxStatus
  route?: RxRoute
  /** How to take it, e.g. "With breakfast". */
  instructions?: string
  /** YYYY-MM-DD. `endDate` is the last day of a course; absent for a medicine taken until stopped. */
  startDate?: string
  endDate?: string
  stopReason?: string
  stoppedAt?: string
  stoppedBy?: string
  history?: RxEvent[]
  /** The form's reference (see lib/ids). Never shown. */
  clientRef?: string
}

/* ─── Care plans ──────────────────────────────────────────────────────
   Goals and interventions the treating doctor sets for one patient. The
   patient sees a plan once it has started. One plan is active at a time;
   a completed or cancelled plan is kept as it was. */
export type CarePlanStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled'
export const CARE_PLAN_STATUS: Record<CarePlanStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'gray' }, active: { label: 'Active', color: 'green' }, on_hold: { label: 'On hold', color: 'amber' },
  completed: { label: 'Completed', color: 'teal' }, cancelled: { label: 'Cancelled', color: 'gray' },
}
export type CarePlanItemStatus = 'open' | 'achieved' | 'dropped'

export interface CarePlanItem {
  id: string
  kind: 'goal' | 'intervention'
  text: string
  /** The vital a goal is measured by, when it is. */
  vitalId?: string
  /** YYYY-MM-DD */
  targetDate?: string
  status: CarePlanItemStatus
  progressNote?: string
}

export interface CarePlanEvent {
  id: string
  /** created | edited | active | on_hold | completed | cancelled | item_achieved | item_dropped | item_reopened */
  action: string
  actorId?: string
  detail?: string
  at: number
  createdAt: string
}

export interface CarePlan {
  id: string
  patientId: string
  /** Who wrote it. */
  doctorId: string
  title: string
  summary?: string
  status: CarePlanStatus
  startDate?: string
  reviewDate?: string
  createdAt: string
  at: number
  closedAt?: string
  closeNote?: string
  items: CarePlanItem[]
  history: CarePlanEvent[]
}

/** What a care-plan form sends: the plan and its goals and interventions together. */
export interface CarePlanDraft {
  id?: string
  patientId: string
  title: string
  summary?: string
  reviewDate?: string
  items: { id?: string; kind: 'goal' | 'intervention'; text: string; vitalId?: string; targetDate?: string }[]
}

/* ─── Who treated whom ────────────────────────────────────────────────
   One row for each time a doctor was assigned to a patient. The open one
   (no `endedAt`) is the patient's doctor now. */
export interface CareAssignment {
  id: string
  patientId: string
  doctorId: string
  startedAt: number
  endedAt?: number
  assignedBy?: string
  endedBy?: string
  /** Why this doctor was assigned, and why the assignment ended. */
  reason?: string
  endReason?: string
}

/**
 * A consulting doctor on a patient's care team: they read the record, and change nothing.
 * The treating doctor is not a row here; they are `PatientUser.assignedDoctorId`.
 */
export interface CareTeamMember {
  id: string
  patientId: string
  doctorId: string
  reason?: string
  addedBy?: string
  startedAt: number
  endedAt?: number
}

/** Someone a doctor used to treat. A name and dates only: the record is no longer theirs to open. */
export interface PastPatient {
  patientId: string
  name: string
  startedAt: number
  endedAt: number
  endReason?: string
}

/* ─── Availability ────────────────────────────────────────────────────
   When a doctor sees patients. Times are "HH:MM" (24 h), in the clinic's
   own time, as on appointments. */
export interface WorkBlock {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
  start: string
  end: string
}
export interface TimeOff {
  id: string
  doctorId: string
  /** YYYY-MM-DD, both days included. */
  from: string
  to: string
  reason?: string
}
/** What a booking form needs for one doctor on one day. */
export interface DayAvailability {
  /** The doctor keeps a timetable: only `slots` can be asked for. Otherwise any time may be requested. */
  managed: boolean
  away: boolean
  slotMinutes: number
  /** Start times still free, "HH:MM". */
  slots: string[]
}

/** Counts for an administrator, over a period. Never a patient's name or a clinical value. */
export interface AdminReport {
  from: string
  to: string
  accounts: Partial<Record<UserRole, number>>
  registered: Partial<Record<UserRole, number>>
  stopped: number
  waiting: { doctor_approvals: number; doctor_requests: number; patients_without_doctor: number; invitations: number; support_requests: number; open_alerts: number }
  appointments: Partial<Record<AppointmentStatus, number>>
  alerts: { raised: number; critical: number; sos: number; escalated: number; resolved: number; minutes_to_acknowledge: number | null; minutes_to_resolve: number | null }
  activity: { readings: number; patients_recording: number; prescriptions: number; documents: number; messages: number }
  support: { opened: number; answered: number }
  doctors: { id: string; name: string; patients: number; open_alerts: number; visits: number; completed: number }[]
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
  /** The working week. Empty: no timetable is kept, and a visit can be asked for at any time. */
  hours?: WorkBlock[]
  /** How long one visit lasts, in minutes. */
  slotMinutes?: number
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
  /** Set when a doctor asks the patient to log a fresh reading for this vital. An in-range follow-up closes a warning; a critical alert goes back to the doctor. */
  recheckRequestedAt?: number
  /** The reading logged in answer to the re-check. */
  recheckReadingId?: string
  /** Every reading logged for this vital while the alert was open, oldest first. The readings themselves live on the patient. */
  remeasureIds?: string[]
  /** What closed it: an in-range re-measurement, the care team, or the reading being withdrawn. */
  resolvedHow?: AlertResolvedHow
  /** What the care team said or did about it, oldest first. */
  comments?: AlertComment[]
}

export type AlertResolvedHow = 'remeasure' | 'doctor' | 'invalid' | 'corrected' | 'patient'

export type AlertCommentKind = 'comment' | 'action' | 'instruction'
export const ALERT_COMMENT_KINDS: { id: AlertCommentKind; label: string }[] = [
  { id: 'comment', label: 'Clinical comment' },
  { id: 'action', label: 'Action taken' },
  { id: 'instruction', label: 'Follow-up instruction' },
]

/** One thing the care team wrote on an alert. Never edited: a correction is a new comment. */
export interface AlertComment {
  id: string
  authorId: string
  kind: AlertCommentKind
  body: string
  at: number
  createdAt: string
}

export type AlertStatus = 'open' | 'acknowledged' | 'escalated' | 'resolved'

/** Resolving with this reason books the follow-up visit in the same step; the database refuses it on its own. */
export const FOLLOW_UP_REASON = 'Appointment scheduled'

/** The clinician confirms an in-range re-measurement; offered from the reading itself in the resolve sheet. */
export const REMEASURED_REASON = 'Re-measured, back in range'

export const RESOLUTION_REASONS = [
  REMEASURED_REASON,
  'Contacted patient, condition stable',
  'Medication adjusted',
  FOLLOW_UP_REASON,
  'Referred to emergency care',
  'False reading / device error',
  "Expected for patient's condition",
  'Other',
] as const

export type AppointmentStatus = 'requested' | 'approved' | 'rejected' | 'rescheduled' | 'completed' | 'cancelled' | 'no_show'

/** One step in an appointment's history: who did what, and when. Written by the database. */
export interface ApptEvent {
  id: string
  actorId?: string
  /** requested | booked | approved | rescheduled | rejected | cancelled | completed | no_show */
  action: string
  detail?: string
  at: number
  createdAt: string
}

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
  /** Who made it: the patient who asked, or the doctor who booked it. */
  createdBy?: string
  /** The alert this follow-up was booked from. */
  alertId?: string
  /** The reference a person can quote to support, e.g. APT-2026-00042. */
  number?: string
  /** Everything that has happened to it, oldest first. */
  history?: ApptEvent[]
  createdAt: string
  /** epoch ms the request was made, for sorting */
  at?: number
  /** The form's reference (see lib/ids). Never shown. */
  clientRef?: string
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
  /** Epoch ms it was sent. */
  at?: number
  read: boolean
}

/** One meal of a patient's plan. `at` is minutes after midnight. */
export interface PlannedMeal {
  id: string
  name: string
  at: number
  foods: string
  kcal: number
  icon: string
  protein?: number
  carbs?: number
  fat?: number
}

/** What the treating doctor set for a patient's meals. A patient without one follows the standard plan. */
export interface MealPlan {
  patientId: string
  /** Empty = the standard meals. */
  meals: PlannedMeal[]
  targetKcal?: number
  /** Glasses of water a day. */
  waterGoal: number
  dietaryNote?: string
  setBy?: string
}

export interface HydrationLog {
  patientId: string
  day: string       // YYYY-MM-DD
  glasses: number
}

/** A patient's rating of the doctor who treats them. */
export interface DoctorRating {
  patientId: string
  doctorId: string
  rating: number    // 1–5
  comment?: string
}

/** What a save came to: the value it produced, or a message fit to show the person. */
export type Outcome<T = void> = { ok: true; value: T } | { ok: false; error: string }

/** Someone an admin registered in advance. They get this role when they sign up with this email. */
export interface Invitation {
  id: string
  email: string
  name: string
  phone: string
  role: UserRole
  invitedBy?: string
  createdAt: string
  /** Epoch ms after which the invitation no longer counts. */
  expiresAt: number
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
  /** The file's bytes, once loaded. Demo mode keeps them here; live mode fetches them from storage when the document is opened. */
  dataUrl?: string
  /** Where the file lives in storage (live mode). */
  path?: string
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

/** A clinical note copied onto a report. */
export interface ReportNote {
  id: string
  /** When it was written, as shown on the note. */
  at: string
  author: string
  content: string
}

export type DocBody =
  | {
      type: 'vitals'
      periodDays: number
      generatedAt: string
      rows: VitalsReportRow[]
      alerts: {
        id: string; label: string; status: string; at: string; severity?: 'danger' | 'warning'; resolution?: string
        /** How it ended, or that it is still open. Absent on reports made before this was recorded. */
        outcome?: string
        /** What followed the reading, in order: re-measurements, the care team's comments and actions, the resolution. */
        steps?: { when: string; text: string; by?: string }[]
      }[]
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
      /** Clinical notes the doctor chose to attach, as they read when the report was produced. */
      notes?: ReportNote[]
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

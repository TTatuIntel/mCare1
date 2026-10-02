/**
 * Changing the record on the backend (live mode).
 *
 * One function per thing a person can do. Each sends a single request; the
 * database validates it, applies the access rules, runs the clinical rules
 * (grading, alerts), writes the notifications and the audit trail, and either
 * commits all of that or none of it. Nothing here decides who may do what.
 *
 * Every function resolves when the change is saved and throws an `ApiError`
 * whose message can be shown to the person as it is.
 *
 * Reading lives in ./records.
 */
import type {
  AccountStatus, Appointment, ApprovalStatus, AssistantPerm, AvatarSpec, EmergencyContact, FontSizePref, HealthProfile,
  Prescription, ThemePref, VitalDef,
} from '@/shared/lib/types'
import type { VitalLevel } from '@/shared/lib/vitals'
import { getSupabase } from './supabase'
import { fromVitalDef, isoClock, isoDay } from './records'

export class ApiError extends Error {}

/** The one message for "the request never got an answer". The store also uses it to mark the data on screen as possibly out of date. */
export const OFFLINE = 'You are offline, or mCare cannot be reached. Check your connection and try again.'

/** Turns whatever went wrong into one sentence the person can act on. */
export function explain(e: unknown, status?: number): string {
  if (e instanceof ApiError) return e.message
  const err = (e ?? {}) as { message?: string; code?: string }
  const msg = err.message ?? ''
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return OFFLINE
  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg) || (status !== undefined && status >= 500 && !err.code)) return OFFLINE
  if (status === 401 || /jwt|session ended/i.test(msg)) return 'Your session has ended. Please sign in again.'
  if (/row-level security|permission denied/i.test(msg)) return 'You do not have permission to do that.'
  if (err.code === '23505') return 'That is already saved.'
  if (err.code === '23503') return 'That refers to something that no longer exists. Refresh and try again.'
  if (err.code === '23514' || err.code === '23502' || err.code === '22P02') return 'Some of what you entered is not valid. Check it and try again.'
  // Messages raised by the database's own rules are written for the person ("Choose a date from today onwards").
  return msg || 'Something went wrong. Please try again.'
}

/** What a supabase-js request resolves with: the data, or the error. */
type Reply = { data: unknown; error: { message: string; code?: string } | null; status?: number }
/** The data of a request that worked; otherwise an ApiError that says what to do. */
async function ok<T = unknown>(request: PromiseLike<Reply>): Promise<T> {
  let reply: Reply
  try { reply = await request } catch (e) { throw new ApiError(explain(e)) }
  if (reply.error) throw new ApiError(explain(reply.error, reply.status))
  return reply.data as T
}
const db = getSupabase
const blank = (v?: string | null) => (v?.trim() ? v.trim() : null)

/* ─── Account ───────────────────────────────────────────────────────── */
export interface ProfileChanges { name?: string; phone?: string; dob?: string; avatar?: AvatarSpec; theme?: ThemePref; fontSize?: FontSizePref }

export async function updateProfile(id: string, c: ProfileChanges) {
  const row: Record<string, unknown> = {}
  if (c.name !== undefined) row.full_name = c.name.trim()
  if (c.phone !== undefined) row.phone = c.phone.trim()
  if ('dob' in c) row.dob = c.dob || null
  if ('avatar' in c) row.avatar = c.avatar ?? null
  if (c.theme !== undefined) row.theme = c.theme
  if (c.fontSize !== undefined) row.font_size = c.fontSize
  if (!Object.keys(row).length) return
  if ('full_name' in row && !row.full_name) throw new ApiError('Enter your name.')
  await ok((await db()).from('profiles').update(row).eq('id', id))
}

export const acceptTerms = async () => { await ok((await db()).rpc('accept_terms', { doc_version: '1' })) }
export const deactivateMyAccount = async () => { await ok((await db()).rpc('deactivate_my_account')) }
export const setUserStatus = async (id: string, status: AccountStatus) => { await ok((await db()).from('profiles').update({ status }).eq('id', id)) }

/** Changes the signed-in person's password. The current one is checked first, so an unlocked phone is not enough. */
export async function changePassword(email: string, current: string, next: string) {
  const supabase = await db()
  const check = await supabase.auth.signInWithPassword({ email, password: current })
  if (check.error) throw new ApiError(check.error.code === 'invalid_credentials' ? 'Your current password is incorrect.' : explain(check.error, check.error.status))
  const { error } = await supabase.auth.updateUser({ password: next })
  if (error) throw new ApiError(explain(error, error.status))
}

/** Ends this person's sessions on every other device. This one stays signed in. */
export async function signOutOtherDevices() {
  const { error } = await (await db()).auth.signOut({ scope: 'others' })
  if (error) throw new ApiError(explain(error, error.status))
}

export const createSupportTicket = async (userId: string, subject: string, message: string) => {
  await ok((await db()).from('support_tickets').insert({ user_id: userId, subject: subject.trim(), message: message.trim() }))
}
export const resolveSupportTicket = async (id: string, note?: string) => {
  await ok((await db()).from('support_tickets').update({ status: 'resolved', resolution_note: blank(note) }).eq('id', id))
}
/** Screen-level events worth keeping ("Signed in"). Clinical changes are audited by the database itself. */
export const logAudit = async (actorId: string, action: string, detail: string) => {
  await ok((await db()).from('audit_log').insert({ actor_id: actorId, action, detail }))
}

/* ─── The patient's own record ──────────────────────────────────────── */
export async function saveHealth(h: HealthProfile) {
  await ok((await db()).rpc('save_health_profile', {
    profile: {
      sex: h.sex ?? '', blood_type: h.bloodType ?? '',
      no_known_allergies: !!h.noKnownAllergies, no_conditions: !!h.noConditions,
      other_medicines: h.otherMedicines ?? '',
      allergies: h.allergies.map(a => ({ substance: a.substance, severity: a.severity, reaction: a.reaction ?? '' })),
      conditions: h.conditions,
    },
  }))
}

/** The vitals now tracked: the database keeps the ones a doctor set, whatever was asked. */
export async function setTrackedVitals(ids: string[], patientId?: string) {
  return ok<string[]>((await db()).rpc('set_tracked_vitals', { ids, ...(patientId ? { patient: patientId } : {}) }))
}

export async function saveEmergencyContact(c: Omit<EmergencyContact, 'id'> & { id?: string }) {
  return ok<string>((await db()).rpc('save_emergency_contact', {
    contact: { id: c.id ?? '', name: c.name, relationship: c.relationship, phone: c.phone, next_of_kin: !!c.nextOfKin },
  }))
}
export const removeEmergencyContact = async (id: string) => { await ok((await db()).from('emergency_contacts').delete().eq('id', id)) }

export const setProfileSetup = async (patientId: string, state: 'pending' | 'skipped' | 'done') => {
  await ok((await db()).from('patients').update({ profile_setup: state }).eq('id', patientId))
}
export const setUnitPrefs = async (patientId: string, prefs: Record<string, string>) => {
  await ok((await db()).from('patients').update({ unit_prefs: prefs }).eq('id', patientId))
}
export const setDocPrivacyDefault = async (patientId: string, privateByDefault: boolean) => {
  await ok((await db()).from('patients').update({ docs_private_default: privateByDefault }).eq('id', patientId))
}
export const requestDoctor = async (doctorId: string) => { await ok((await db()).rpc('request_doctor', { doctor: doctorId })) }
export const rateDoctor = async (patientId: string, doctorId: string, rating: number, comment?: string) => {
  await ok((await db()).from('doctor_ratings').upsert({ patient_id: patientId, doctor_id: doctorId, rating, comment: blank(comment) }))
}
export async function doctorRatingSummary(doctorId: string): Promise<{ average: number | null; ratings: number }> {
  const rows = await ok<{ average: number | null; ratings: number }[]>((await db()).rpc('doctor_rating_summary', { doctor: doctorId }))
  return { average: rows[0]?.average === null || rows[0]?.average === undefined ? null : Number(rows[0].average), ratings: rows[0]?.ratings ?? 0 }
}

/* ─── Vitals and alerts ─────────────────────────────────────────────── */
export interface SavedReading {
  readingId: string
  /** How the database graded it against the patient's targets. */
  level: VitalLevel
  /** An alert was raised for this reading and the care team has been told. */
  alerted: boolean
  /** This reading closed an open alert (a warning re-measured in range). */
  cleared: boolean
}

export async function logReading(patientId: string, vitalId: string, value: string, note?: string): Promise<SavedReading> {
  const supabase = await db()
  const row = await ok<{ id: string; level: VitalLevel }>(
    supabase.from('readings').insert({ patient_id: patientId, vital_id: vitalId, value, note: blank(note) }).select('id, level').single())
  // The alert, if any, was decided by the database in the same transaction as the reading.
  const linked = await ok<{ reading_id: string | null; status: string }[]>(
    supabase.from('alerts').select('reading_id, status').or(`reading_id.eq.${row.id},recheck_reading_id.eq.${row.id}`))
  return {
    readingId: row.id, level: row.level,
    alerted: linked.some(a => a.reading_id === row.id),
    cleared: linked.some(a => a.reading_id !== row.id && a.status === 'resolved'),
  }
}
export const correctReading = async (id: string, value: string) => { await ok((await db()).from('readings').update({ value }).eq('id', id)) }
export const invalidateReading = async (id: string, reason: string) => {
  await ok((await db()).from('readings').update({ invalid: true, invalid_reason: reason.trim() }).eq('id', id))
}
export const sendAlertNow = async (readingId: string) => { await ok((await db()).rpc('send_alert_now', { reading: readingId })) }

export const setThreshold = async (patientId: string, vitalId: string, range: { min: number; max: number }) => {
  await ok((await db()).from('thresholds').upsert({ patient_id: patientId, vital_id: vitalId, target_min: range.min, target_max: range.max }))
}
export async function setCriticalThreshold(patientId: string, vitalId: string, range: { min: number; max: number } | null, fallbackTarget: { min: number; max: number }) {
  const supabase = await db()
  const existing = await ok<{ vital_id: string }[]>(supabase.from('thresholds').select('vital_id').eq('patient_id', patientId).eq('vital_id', vitalId))
  if (existing.length) await ok(supabase.from('thresholds').update({ critical_min: range?.min ?? null, critical_max: range?.max ?? null }).eq('patient_id', patientId).eq('vital_id', vitalId))
  else if (range) await ok(supabase.from('thresholds').insert({ patient_id: patientId, vital_id: vitalId, target_min: fallbackTarget.min, target_max: fallbackTarget.max, critical_min: range.min, critical_max: range.max }))
}
export const addClinicalNote = async (patientId: string, authorId: string, content: string) => {
  await ok((await db()).from('clinical_notes').insert({ patient_id: patientId, author_id: authorId, content: content.trim() }))
}

export const raiseSos = async (message: string) => ok<string>((await db()).rpc('raise_sos', { message }))
export const cancelSos = async (alertId: string) => { await ok((await db()).rpc('cancel_sos', { alert: alertId })) }
export const acknowledgeAlert = async (id: string) => { await ok((await db()).from('alerts').update({ status: 'acknowledged' }).eq('id', id)) }
export const escalateAlert = async (id: string) => { await ok((await db()).from('alerts').update({ status: 'escalated' }).eq('id', id)) }
export const requestRecheck = async (id: string) => { await ok((await db()).from('alerts').update({ recheck_requested_at: new Date().toISOString() }).eq('id', id)) }
export const resolveAlert = async (id: string, reason: string, note?: string) => {
  await ok((await db()).from('alerts').update({ status: 'resolved', resolution_reason: reason, resolution_note: blank(note) }).eq('id', id))
}

/* ─── Medication and meals ──────────────────────────────────────────── */
export const addPrescription = async (patientId: string, doctorId: string, rx: Pick<Prescription, 'medication' | 'dosage' | 'frequency' | 'purpose'>) => {
  await ok((await db()).from('prescriptions').insert({ patient_id: patientId, doctor_id: doctorId, medication: rx.medication, dosage: rx.dosage, frequency: rx.frequency, purpose: rx.purpose }))
}
export const setPrescriptionActive = async (id: string, active: boolean) => { await ok((await db()).from('prescriptions').update({ active }).eq('id', id)) }

export async function setDose(patientId: string, rxId: string, slot: number, day: string, taken: boolean) {
  const supabase = await db()
  if (taken) await ok(supabase.from('dose_logs').upsert({ patient_id: patientId, prescription_id: rxId, slot, day }, { ignoreDuplicates: true }))
  else await ok(supabase.from('dose_logs').delete().eq('prescription_id', rxId).eq('slot', slot).eq('day', day))
}
export async function setMeal(patientId: string, mealId: string, day: string, eaten: boolean, note?: string) {
  const supabase = await db()
  if (eaten) await ok(supabase.from('meal_logs').upsert({ patient_id: patientId, meal_id: mealId, day, note: blank(note) }))
  else await ok(supabase.from('meal_logs').delete().eq('patient_id', patientId).eq('meal_id', mealId).eq('day', day))
}
export const setHydration = async (patientId: string, day: string, glasses: number) => {
  await ok((await db()).from('hydration_logs').upsert({ patient_id: patientId, day, glasses }))
}

/* ─── Appointments ──────────────────────────────────────────────────── */
export interface NewAppointment {
  patientId: string
  doctorId: string
  title: string
  reason?: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM (24 h), or '' for any time */
  time?: string
  location?: string
  /** Only the treating doctor may book one as already approved (a follow-up). */
  status?: Appointment['status']
  approvalNote?: string
}
export const addAppointment = async (a: NewAppointment) => {
  await ok((await db()).from('appointments').insert({
    patient_id: a.patientId, doctor_id: a.doctorId, title: a.title.trim(), reason: a.reason?.trim() ?? '',
    preferred_date: a.date, preferred_time: a.time || null, location: blank(a.location),
    ...(a.status ? { status: a.status } : {}), ...(a.approvalNote ? { approval_note: a.approvalNote.trim() } : {}),
  }))
}

/** Answers or changes an appointment. A patient may only cancel, or accept a proposed new time: the database moves the date itself. */
export async function updateAppointment(id: string, patch: Partial<Appointment>) {
  const row: Record<string, unknown> = {}
  if (patch.status) row.status = patch.status
  if ('approvalNote' in patch) row.approval_note = blank(patch.approvalNote)
  if ('rejectionReason' in patch) row.rejection_reason = blank(patch.rejectionReason)
  if ('rescheduledReason' in patch) row.rescheduled_reason = blank(patch.rescheduledReason)
  if (patch.rescheduledTo) {
    row.rescheduled_date = isoDay(patch.rescheduledTo)
    if (!row.rescheduled_date) throw new ApiError('Choose a valid date.')
  }
  if ('rescheduledTime' in patch) row.rescheduled_time = isoClock(patch.rescheduledTime) ?? null
  if (!Object.keys(row).length) return
  await ok((await db()).from('appointments').update(row).eq('id', id))
}

/* ─── Messages, notifications, reports ──────────────────────────────── */
export const sendMessage = async (fromId: string, toId: string, content: string) => {
  await ok((await db()).from('messages').insert({ from_id: fromId, to_id: toId, content: content.trim() }))
}
export const markMessagesRead = async (fromId: string, toId: string) => {
  await ok((await db()).from('messages').update({ read: true }).eq('from_id', fromId).eq('to_id', toId).eq('read', false))
}
export const markNotificationRead = async (id: string) => { await ok((await db()).from('notifications').update({ read: true }).eq('id', id)) }
export const markAllNotificationsRead = async (userId: string) => {
  await ok((await db()).from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false))
}

export const requestReport = async (patientId: string, doctorId: string, periodDays: number, reason: string) => {
  await ok((await db()).from('report_requests').insert({ patient_id: patientId, doctor_id: doctorId, period_days: periodDays, reason: reason.trim() }))
}
export const declineReportRequest = async (id: string, reason: string) => {
  await ok((await db()).from('report_requests').update({ status: 'declined', decline_reason: blank(reason) }).eq('id', id))
}
export const fulfilReportRequest = async (id: string, documentId: string) => {
  await ok((await db()).from('report_requests').update({ status: 'fulfilled', document_id: documentId }).eq('id', id))
}

/* ─── Care coordination (admins and assistants) ─────────────────────── */
export const assignDoctor = async (patientId: string, doctorId: string | null) => {
  await ok((await db()).from('patients').update({ assigned_doctor_id: doctorId }).eq('id', patientId))
}
export async function decideDoctorRequest(patientId: string, approve: boolean, note?: string, alternativeDoctorId?: string) {
  const supabase = await db()
  const pending = await ok<{ id: string }[]>(supabase.from('doctor_requests').select('id').eq('patient_id', patientId).eq('status', 'pending'))
  if (!pending.length) throw new ApiError('That request has already been answered.')
  await ok(supabase.rpc('decide_doctor_request', { request: pending[0].id, approve, note: note ?? null, alternative: alternativeDoctorId ?? null }))
}
export const decideDoctor = async (doctorId: string, decision: Exclude<ApprovalStatus, 'pending'>, note?: string) => {
  await ok((await db()).rpc('decide_doctor', { doctor: doctorId, decision, note: note ?? null }))
}
export const resubmitDoctorApplication = async (specialty: string, licenseNo: string, hospital: string) => {
  await ok((await db()).rpc('resubmit_doctor_application', { new_specialty: specialty, new_license_no: licenseNo, new_hospital: hospital }))
}
export const setDoctorDetails = async (id: string, d: { specialty?: string; licenseNo?: string; hospital?: string; signature?: string | null }) => {
  const row: Record<string, unknown> = {}
  if (d.specialty !== undefined) row.specialty = d.specialty.trim()
  if (d.licenseNo !== undefined) row.license_no = d.licenseNo.trim()
  if (d.hospital !== undefined) row.hospital = d.hospital.trim()
  if ('signature' in d) row.signature = d.signature ?? null
  if (Object.keys(row).length) await ok((await db()).from('doctors').update(row).eq('id', id))
}
export const chaseAlert = async (alertId: string) => { await ok((await db()).rpc('chase_alert', { alert: alertId })) }
export const setAssistantPerms = async (id: string, permissions: AssistantPerm[]) => {
  await ok((await db()).from('staff').update({ permissions }).eq('id', id))
}
export const saveVitalDefs = async (defs: VitalDef[]) => { await ok((await db()).from('vital_defs').upsert(defs.map(fromVitalDef))) }

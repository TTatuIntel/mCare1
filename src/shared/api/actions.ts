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
  AccountStatus, AdminReport, DeliveryReport, NotifyPrefs, AlertCommentKind, Appointment, ApprovalStatus, AssistantPerm, AvatarSpec, CarePlanDraft, CarePlanItemStatus, CarePlanStatus,
  ConditionDef, DayAvailability, EmergencyContact, FontSizePref, HealthProfile, MealPlan, NoteType, NoteVisibility, Prescription, RecordViewContext,
  RetentionSettings, SecuritySettings, ThemePref, UserRole, VitalDef, VitalFrequency, WorkBlock,
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
  // The app is ahead of the database (a table, column or function it asks for is not there yet). Nothing the person can fix.
  if (/^(42P01|42883|42703|PGRST20\d)$/.test(err.code ?? '') || /does not exist|schema cache/i.test(msg)) {
    console.error('mCare backend is out of date:', msg)
    return 'mCare is being updated. Please try again in a moment.'
  }
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

/**
 * Saves a record that carries a form reference (`client_ref`). When the database answers that this reference
 * is already saved, the first attempt went through and only its answer was lost: that is success, not an error.
 * `fresh` is false in that case, so the caller can read back what was saved.
 */
async function okOnce(request: PromiseLike<Reply>): Promise<{ data: unknown; fresh: boolean }> {
  let reply: Reply
  try { reply = await request } catch (e) { throw new ApiError(explain(e)) }
  if (reply.error?.code === '23505' && /client_ref/.test(reply.error.message)) return { data: null, fresh: false }
  if (reply.error) throw new ApiError(explain(reply.error, reply.status))
  return { data: reply.data, fresh: true }
}
const withRef = (ref?: string) => (ref ? { client_ref: ref } : {})

/* ─── Account ───────────────────────────────────────────────────────── */
export interface ProfileChanges { name?: string; phone?: string; dob?: string; avatar?: AvatarSpec; theme?: ThemePref; fontSize?: FontSizePref; notify?: NotifyPrefs }

export async function updateProfile(id: string, c: ProfileChanges) {
  const row: Record<string, unknown> = {}
  if (c.name !== undefined) row.full_name = c.name.trim()
  if (c.phone !== undefined) row.phone = c.phone.trim()
  if ('dob' in c) row.dob = c.dob || null
  if ('avatar' in c) row.avatar = c.avatar ?? null
  if (c.theme !== undefined) row.theme = c.theme
  if (c.fontSize !== undefined) row.font_size = c.fontSize
  if (c.notify) { row.notify_email = c.notify.email; row.notify_sms = c.notify.sms; row.notify_push = c.notify.push }
  if (!Object.keys(row).length) return
  if ('full_name' in row && !row.full_name) throw new ApiError('Enter your name.')
  await ok((await db()).from('profiles').update(row).eq('id', id))
}

export const acceptTerms = async () => { await ok((await db()).rpc('accept_terms', { doc_version: '1' })) }
export const deactivateMyAccount = async () => { await ok((await db()).rpc('deactivate_my_account')) }
/** An administrator makes an account active, suspends it or deactivates it. Stopping one needs a reason; the database keeps who, when and why. */
export const setUserStatus = async (id: string, status: AccountStatus, reason?: string) => {
  await ok((await db()).rpc('set_account_status', { person: id, new_status: status, reason: reason ?? null }))
}

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
/** Staff opened one patient's vitals. The database writes the audit entry; the browser cannot write the trail itself. */
export const logPatientView = async (patientId: string) => { await ok((await db()).rpc('log_patient_view', { patient: patientId })) }

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
  /** This reading was a re-measurement for an alert that is still open: out of range again, or in range on a critical alert the doctor must close. */
  followsAlert: boolean
}

export async function logReading(patientId: string, vitalId: string, value: string, note?: string, ref?: string): Promise<SavedReading> {
  const supabase = await db()
  const saved = await okOnce(
    supabase.from('readings').insert({ patient_id: patientId, vital_id: vitalId, value, note: blank(note), ...withRef(ref) }).select('id, level').single())
  const row = saved.fresh ? saved.data as { id: string; level: VitalLevel }
    : await ok<{ id: string; level: VitalLevel }>(supabase.from('readings').select('id, level').eq('client_ref', ref!).single())
  // The alert, if any, was decided by the database in the same transaction as the reading.
  const linked = await ok<{ reading_id: string | null; status: string }[]>(
    supabase.from('alerts').select('reading_id, status').or(`reading_id.eq.${row.id},recheck_reading_id.eq.${row.id}`))
  return {
    readingId: row.id, level: row.level,
    alerted: linked.some(a => a.reading_id === row.id),
    cleared: linked.some(a => a.reading_id !== row.id && a.status === 'resolved'),
    followsAlert: linked.some(a => a.reading_id !== row.id && a.status !== 'resolved'),
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
export interface NewNote {
  content: string
  visibility?: NoteVisibility
  noteType?: NoteType
  /** The note this one corrects. */
  amends?: string
  appointmentId?: string
  ref?: string
}
export const addClinicalNote = async (patientId: string, authorId: string, n: NewNote) => {
  await okOnce((await db()).from('clinical_notes').insert({
    patient_id: patientId, author_id: authorId, content: n.content.trim(), visibility: n.visibility ?? 'shared', note_type: n.noteType ?? 'progress',
    amends: n.amends ?? null, appointment_id: n.appointmentId ?? null, ...withRef(n.ref),
  }))
}

export const raiseSos = async (message: string) => ok<string>((await db()).rpc('raise_sos', { message }))
export const cancelSos = async (alertId: string) => { await ok((await db()).rpc('cancel_sos', { alert: alertId })) }
export const acknowledgeAlert = async (id: string) => { await ok((await db()).from('alerts').update({ status: 'acknowledged' }).eq('id', id)) }
export const escalateAlert = async (id: string) => { await ok((await db()).from('alerts').update({ status: 'escalated' }).eq('id', id)) }
export const requestRecheck = async (id: string) => { await ok((await db()).from('alerts').update({ recheck_requested_at: new Date().toISOString() }).eq('id', id)) }
/** A comment, an action taken or an instruction on an alert, without resolving it. The database fills in who and when. */
export const addAlertComment = async (alertId: string, authorId: string, kind: AlertCommentKind, body: string, ref?: string) => {
  await okOnce((await db()).from('alert_comments').insert({ alert_id: alertId, author_id: authorId, kind, body: body.trim(), ...withRef(ref) }))
}
export const resolveAlert = async (id: string, reason: string, note?: string) => {
  await ok((await db()).from('alerts').update({ status: 'resolved', resolution_reason: reason, resolution_note: blank(note) }).eq('id', id))
}

/* ─── Medication and meals ──────────────────────────────────────────── */
export const addPrescription = async (patientId: string, doctorId: string,
  rx: Pick<Prescription, 'medication' | 'dosage' | 'frequency' | 'purpose' | 'route' | 'instructions' | 'startDate' | 'endDate' | 'clientRef'>) => {
  await okOnce((await db()).from('prescriptions').insert({
    patient_id: patientId, doctor_id: doctorId, medication: rx.medication, dosage: rx.dosage, frequency: rx.frequency, purpose: rx.purpose,
    route: rx.route ?? null, instructions: blank(rx.instructions), ...(rx.startDate ? { start_date: rx.startDate } : {}), end_date: rx.endDate || null,
    ...withRef(rx.clientRef),
  }))
}
/** Stops a medicine with the reason, or restarts it. The row itself is never rewritten or deleted. */
export const setPrescriptionActive = async (id: string, active: boolean, reason?: string) => {
  await ok((await db()).from('prescriptions').update(active ? { status: 'active' } : { status: 'discontinued', stop_reason: blank(reason) }).eq('id', id))
}

/* ─── Care plans ────────────────────────────────────────────────────── */
/** The plan and its goals and interventions in one transaction. Resolves with the plan's id. */
export const saveCarePlan = async (p: CarePlanDraft) => ok<string>((await db()).rpc('save_care_plan', {
  plan: {
    id: p.id ?? '', patient_id: p.patientId, title: p.title.trim(), summary: p.summary?.trim() ?? '', review_date: p.reviewDate ?? '',
    items: p.items.map(i => ({ id: i.id ?? '', kind: i.kind, text: i.text.trim(), vital_id: i.vitalId ?? '', target_date: i.targetDate ?? '' })),
  },
}))
export const setCarePlanStatus = async (id: string, status: CarePlanStatus, note?: string) => {
  await ok((await db()).rpc('set_care_plan_status', { plan: id, new_status: status, note: blank(note) }))
}
export const setCarePlanItem = async (itemId: string, status: CarePlanItemStatus, progressNote?: string) => {
  await ok((await db()).from('care_plan_items').update({ status, progress_note: blank(progressNote) }).eq('id', itemId))
}
/** Only a draft can be removed; a plan that has started is cancelled instead. */
export const deleteCarePlanDraft = async (id: string) => { await ok((await db()).from('care_plans').delete().eq('id', id)) }

/* ─── Availability ──────────────────────────────────────────────────── */
export const setDoctorHours = async (hours: WorkBlock[], slotMinutes: number) => {
  await ok((await db()).rpc('set_doctor_hours', { hours, visit_minutes: slotMinutes }))
}
export const addTimeOff = async (doctorId: string, from: string, to: string, reason?: string) => {
  await ok((await db()).from('doctor_time_off').insert({ doctor_id: doctorId, from_date: from, to_date: to, reason: blank(reason) }))
}
export const removeTimeOff = async (id: string) => { await ok((await db()).from('doctor_time_off').delete().eq('id', id)) }
/** The open times of one doctor on one day (YYYY-MM-DD). */
export async function doctorAvailability(doctorId: string, day: string): Promise<DayAvailability> {
  const a = await ok<{ managed: boolean; away: boolean; slot_minutes: number; slots: string[] }>((await db()).rpc('doctor_availability', { doctor: doctorId, day }))
  return { managed: a.managed, away: a.away, slotMinutes: a.slot_minutes, slots: a.slots ?? [] }
}

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
/** The treating doctor's plan for a patient: one row per patient. The database checks it, tells the patient and audits it. */
export const setMealPlan = async (plan: Omit<MealPlan, 'setBy'>) => {
  await ok((await db()).from('meal_plans').upsert({
    patient_id: plan.patientId, meals: plan.meals, target_kcal: plan.targetKcal ?? null, water_goal: plan.waterGoal, dietary_note: blank(plan.dietaryNote),
  }))
}
/** Back to the standard plan. */
export const clearMealPlan = async (patientId: string) => { await ok((await db()).from('meal_plans').delete().eq('patient_id', patientId)) }

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
  /** The form's reference: a booking sent twice is one appointment. */
  ref?: string
}
export const addAppointment = async (a: NewAppointment) => {
  await okOnce((await db()).from('appointments').insert({
    patient_id: a.patientId, doctor_id: a.doctorId, title: a.title.trim(), reason: a.reason?.trim() ?? '',
    preferred_date: a.date, preferred_time: a.time || null, location: blank(a.location),
    ...(a.status ? { status: a.status } : {}), ...(a.approvalNote ? { approval_note: a.approvalNote.trim() } : {}), ...withRef(a.ref),
  }))
}

/** Books a follow-up and, when it comes from an alert, resolves that alert: both or neither. */
export const scheduleFollowUp = async (patientId: string, date: string, time: string | undefined, note: string | undefined, alertId?: string) =>
  ok<string>((await db()).rpc('schedule_follow_up', { patient: patientId, visit_date: date, visit_time: time || null, visit_note: blank(note), alert: alertId ?? null }))

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
export const sendMessage = async (fromId: string, toId: string, content: string, ref?: string) => {
  await okOnce((await db()).from('messages').insert({ from_id: fromId, to_id: toId, content: content.trim(), ...withRef(ref) }))
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
/** Assigns, moves or (with no doctor) removes a patient's doctor. Removing one needs the reason. */
export const assignDoctor = async (patientId: string, doctorId: string | null, reason?: string) => {
  await ok((await db()).rpc('assign_doctor', { patient: patientId, doctor: doctorId, reason: reason ?? null }))
}
/** Adds a consulting doctor to a patient's care team: they read the record and change nothing. */
export const addConsultingDoctor = async (patientId: string, doctorId: string, reason?: string) =>
  ok<string>((await db()).rpc('add_consulting_doctor', { patient: patientId, doctor: doctorId, reason: reason ?? null }))
export const removeConsultingDoctor = async (memberId: string) => { await ok((await db()).rpc('remove_consulting_doctor', { member: memberId })) }
/** Support moves an appointment to another time, or cancels it. Same record; both people are told. */
export const adminUpdateAppointment = async (id: string, change: { action: 'move'; date: string; time?: string; reason: string } | { action: 'cancel'; reason: string }) => {
  await ok((await db()).rpc('admin_update_appointment', {
    appt: id, action: change.action, new_date: change.action === 'move' ? change.date : null,
    new_time: change.action === 'move' ? change.time || null : null, reason: change.reason,
  }))
}
/** Counts for a period (YYYY-MM-DD to YYYY-MM-DD), made by the database from the records. */
export const adminReport = async (from: string, to: string) => ok<AdminReport>((await db()).rpc('admin_report', { from_day: from, to_day: to }))
export const deliveryReport = async (from: string, to: string) => ok<DeliveryReport>((await db()).rpc('delivery_report', { from_day: from, to_day: to }))

/** Keeps this device as one that receives push notifications (the same device again replaces itself). */
export async function savePushDevice(d: { endpoint: string; p256dh: string; auth: string; userAgent: string }) {
  const supabase = await db()
  await ok(supabase.from('push_subscriptions').delete().eq('endpoint', d.endpoint))
  await ok(supabase.from('push_subscriptions').insert({ endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth, user_agent: d.userAgent }))
}
export const removePushDevice = async (endpoint: string) => { await ok((await db()).from('push_subscriptions').delete().eq('endpoint', endpoint)) }
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
export const setDoctorDetails = async (id: string, d: { specialty?: string; licenseNo?: string; hospital?: string }) => {
  const row: Record<string, unknown> = {}
  if (d.specialty !== undefined) row.specialty = d.specialty.trim()
  if (d.licenseNo !== undefined) row.license_no = d.licenseNo.trim()
  if (d.hospital !== undefined) row.hospital = d.hospital.trim()
  if (Object.keys(row).length) await ok((await db()).from('doctors').update(row).eq('id', id))
}
/** A doctor's handwritten signature, kept where only they can read it (null removes it). The database stamps it onto what they sign. */
export const saveSignature = async (doctorId: string, image: string | null) => {
  const supabase = await db()
  if (image) await ok(supabase.from('doctor_signatures').upsert({ doctor_id: doctorId, image }))
  else await ok(supabase.from('doctor_signatures').delete().eq('doctor_id', doctorId))
}
export const chaseAlert = async (alertId: string) => { await ok((await db()).rpc('chase_alert', { alert: alertId })) }
export const setAssistantPerms = async (id: string, permissions: AssistantPerm[]) => {
  await ok((await db()).from('staff').update({ permissions }).eq('id', id))
}
/** Adds or changes one vital definition. The database audits it. */
export const saveVitalDef = async (def: VitalDef) => { await ok((await db()).from('vital_defs').upsert(fromVitalDef(def))) }

/** Registers someone in advance: they get this role when they sign up with this email (staff roles once the email is confirmed). */
export const inviteAccount = async (i: { email: string; name: string; role: UserRole; phone?: string }) =>
  ok<string>((await db()).rpc('invite_account', { invite_email: i.email, invite_name: i.name, invite_role: i.role, invite_phone: i.phone ?? '' }))
export const revokeInvitation = async (id: string) => { await ok((await db()).rpc('revoke_invitation', { invitation: id })) }

/* ─── Settings, monitoring plans, reviews, access log, the patient's copy ─ */
/** An admin changes one area of the settings. The database checks the values and audits the change. */
export const saveSecuritySettings = async (v: SecuritySettings) => {
  await ok((await db()).rpc('save_settings', { area: 'security', new_value: { mfa_required_roles: v.mfaRequiredRoles, idle_minutes: v.idleMinutes } }))
}
export const saveRetentionSettings = async (v: RetentionSettings) => {
  await ok((await db()).rpc('save_settings', { area: 'retention', new_value: {
    audit_days: v.auditDays, deleted_document_days: v.deletedDocumentDays, read_notification_days: v.readNotificationDays, delivery_days: v.deliveryDays,
  } }))
}
export interface RetentionRun { documents: number; audit: number; notifications: number; deliveries: number }
/** Applies the retention settings now instead of waiting for the nightly job. Resolves with what it removed. */
export const runRetentionNow = async () => ok<RetentionRun>((await db()).rpc('run_retention_now'))
/** Adds or changes a condition in the catalogue, with the vitals it calls for, in one transaction. */
export const saveConditionDef = async (c: ConditionDef) => {
  await ok((await db()).rpc('save_condition_def', { def: { code: c.code, name: c.name.trim(), icon: c.icon, icd10: c.icd10 ?? '', active: c.active, vitals: c.vitals } }))
}
/** The treating doctor sets how often a patient measures a vital (null: the usual schedule). The patient is told. */
export const setVitalPlan = async (patientId: string, vitalId: string, frequency: VitalFrequency | null, reason?: string) => {
  await ok((await db()).rpc('set_vital_plan', { patient: patientId, vital: vitalId, frequency, reason: blank(reason) }))
}
/** The treating doctor marks a patient's readings reviewed up to now. `ref` makes a form sent twice one review. */
export const reviewVitals = async (patientId: string, note?: string, ref?: string) =>
  ok<string>((await db()).rpc('review_vitals', { patient: patientId, note: blank(note), ref: ref ?? null }))
/** The caller opened part of a patient's record: the patient sees it in their access log. */
export const logRecordView = async (patientId: string, context: RecordViewContext) => {
  await ok((await db()).rpc('log_record_view', { patient: patientId, context }))
}
/** Everything mCare holds about the signed-in patient, as one document. */
export const exportMyRecord = async () => ok<Record<string, unknown>>((await db()).rpc('export_my_record'))
/** An admin removes the authenticator app of someone who lost their phone, with the reason. Their sessions end; they are told. */
export const resetTwoStep = async (id: string, reason: string) => { await ok((await db()).rpc('reset_two_step', { person: id, reason: reason.trim() })) }
/** Support corrects someone's name, phone or date of birth, with the reason. Audited as acting for them; they are told. */
export const adminUpdateProfile = async (id: string, changes: { name?: string; phone?: string; dob?: string }, reason: string) => {
  await ok((await db()).rpc('admin_update_profile', { person: id, changes, reason: reason.trim() }))
}

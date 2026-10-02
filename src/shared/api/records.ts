/**
 * Reading the record from the backend (live mode).
 *
 * `loadRecords` asks for every table the signed-in person may see and turns
 * the rows into the shapes the screens already use. It never filters for
 * privacy: the database's row rules decide what comes back, so a patient
 * receives their own record, a doctor their patients', and so on.
 *
 * Writing lives in ./actions.
 */
import type {
  AccountStatus, AdminUser, AppAlert, AppNotification, AppUser, Appointment, ApprovalStatus, AssistantPerm, AuditEntry,
  ClinicalNote, DocEvent, DoctorRating, DoctorRequest, DoctorUser, HydrationLog, MealDone, MealPlan, MedDose, MedicalDocument,
  PatientMessage, PatientUser, ReportRequest, ShareLink, SupportTicket, TargetChange, VitalDef, VitalReading,
} from '@/shared/lib/types'
import { dateLabel, dayKey, stamp } from '@/shared/lib/vitals'
import { getSupabase } from './supabase'

/** A row as the API returns it. The columns are the ones in supabase/migrations. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

/** How far back readings, doses and meals are loaded. Older history stays in the database. */
const HISTORY_DAYS = 400
const LOG_DAYS = 45

export interface Records {
  users: AppUser[]
  vitalDefs: VitalDef[]
  alerts: AppAlert[]
  appointments: Appointment[]
  messages: PatientMessage[]
  notifications: AppNotification[]
  doses: MedDose[]
  mealsDone: MealDone[]
  reportRequests: ReportRequest[]
  clinicalNotes: ClinicalNote[]
  supportTickets: SupportTicket[]
  audit: AuditEntry[]
  mealPlans: MealPlan[]
  hydration: HydrationLog[]
  ratings: DoctorRating[]
  documents: MedicalDocument[]
  docEvents: DocEvent[]
  shareLinks: ShareLink[]
}

/* ─── Dates and times ───────────────────────────────────────────────── */
const ms = (iso?: string | null) => (iso ? new Date(iso).getTime() : undefined)
const when = (iso?: string | null) => (iso ? stamp(new Date(iso)) : undefined)
/** "2026-10-04" → "Oct 4, 2026" */
export const dayLabel = (day?: string | null) => (day ? dateLabel(new Date(`${day}T00:00`)) : undefined)
/** "14:30:00" → "2:30 PM" */
export function clockLabel(time?: string | null) {
  if (!time) return undefined
  const [h, m] = time.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
/** "Oct 4, 2026" (or an ISO day) → "2026-10-04" */
export function isoDay(label: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label
  const d = new Date(label)
  return Number.isNaN(d.getTime()) ? undefined : dayKey(d)
}
/** "2:30 PM" (or "14:30") → "14:30" */
export function isoClock(label?: string) {
  const m = label?.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!m) return undefined
  const h = m[3] ? (Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0) : Number(m[1])
  return `${String(h).padStart(2, '0')}:${m[2]}`
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)

/* ─── Rows → the app's shapes ───────────────────────────────────────── */
const num = (v: unknown) => (v === null || v === undefined ? undefined : Number(v))

export const toVitalDef = (r: Row): VitalDef => ({
  id: r.id, name: r.name, unit: r.unit, icon: r.icon, active: r.active,
  normalMin: Number(r.normal_min), normalMax: Number(r.normal_max),
  criticalMin: num(r.critical_min), criticalMax: num(r.critical_max),
  hardMin: Number(r.hard_min), hardMax: Number(r.hard_max),
  diaNormalMin: num(r.dia_normal_min), diaNormalMax: num(r.dia_normal_max),
  diaCriticalMin: num(r.dia_critical_min), diaCriticalMax: num(r.dia_critical_max),
  unitOptions: r.unit_options ?? undefined,
})

export const fromVitalDef = (v: VitalDef): Row => ({
  id: v.id, name: v.name, unit: v.unit, icon: v.icon, active: v.active,
  normal_min: v.normalMin, normal_max: v.normalMax, critical_min: v.criticalMin ?? null, critical_max: v.criticalMax ?? null,
  hard_min: v.hardMin, hard_max: v.hardMax,
  dia_normal_min: v.diaNormalMin ?? null, dia_normal_max: v.diaNormalMax ?? null,
  dia_critical_min: v.diaCriticalMin ?? null, dia_critical_max: v.diaCriticalMax ?? null,
  unit_options: v.unitOptions ?? null,
})

export const toReading = (r: Row): VitalReading => ({
  id: r.id, vitalId: r.vital_id, value: r.value, at: ms(r.taken_at), loggedAt: when(r.taken_at) ?? '',
  note: r.note ?? undefined, invalid: r.invalid || undefined, invalidReason: r.invalid_reason ?? undefined,
  recordedBy: r.recorded_by ?? undefined, correctedFrom: r.corrected_from ?? undefined,
})

const toAlert = (r: Row, defs: VitalDef[]): AppAlert => ({
  id: r.id, patientId: r.patient_id, type: r.type, severity: r.severity, status: r.status, resolved: r.status === 'resolved',
  vitalId: r.vital_id ?? undefined, vitalName: r.type === 'sos' ? 'SOS' : defs.find(d => d.id === r.vital_id)?.name ?? 'Reading',
  value: r.value, unit: r.unit ?? '', readingId: r.reading_id ?? undefined,
  at: ms(r.created_at) ?? 0, loggedAt: when(r.created_at) ?? '',
  acknowledgedAt: when(r.acknowledged_at), acknowledgedBy: r.acknowledged_by ?? undefined,
  escalatedAt: when(r.escalated_at),
  recheckRequestedAt: ms(r.recheck_requested_at), recheckReadingId: r.recheck_reading_id ?? undefined,
  resolvedAt: when(r.resolved_at), resolvedBy: r.resolved_by ?? undefined,
  resolutionReason: r.resolution_reason ?? undefined, resolutionNote: r.resolution_note ?? undefined,
})

const toAppointment = (r: Row): Appointment => ({
  id: r.id, patientId: r.patient_id, doctorId: r.doctor_id, title: r.title, reason: r.reason ?? '',
  preferredDate: dayLabel(r.preferred_date) ?? '', preferredTime: clockLabel(r.preferred_time) ?? 'Any time',
  location: r.location ?? undefined, status: r.status,
  approvalNote: r.approval_note ?? undefined, rejectionReason: r.rejection_reason ?? undefined,
  rescheduledTo: dayLabel(r.rescheduled_date), rescheduledTime: clockLabel(r.rescheduled_time),
  rescheduledReason: r.rescheduled_reason ?? undefined,
  createdAt: dateLabel(new Date(r.created_at)), at: ms(r.created_at),
})

const toMessage = (r: Row): PatientMessage => ({
  id: r.id, fromId: r.from_id, toId: r.to_id, content: r.content, sentAt: when(r.created_at) ?? '', read: r.read,
})

const toNotification = (r: Row): AppNotification => ({
  id: r.id, userId: r.user_id, kind: r.kind, title: r.title, body: r.body, link: r.link ?? undefined, read: r.read,
  at: ms(r.created_at) ?? 0, createdAt: when(r.created_at) ?? '',
})

export const toDocument = (r: Row): MedicalDocument => ({
  id: r.id, patientId: r.patient_id, title: r.title, category: r.category, origin: r.origin,
  description: r.description ?? undefined, documentDate: r.document_date,
  createdAt: when(r.created_at) ?? '', at: ms(r.created_at) ?? 0, createdBy: r.created_by,
  file: r.file_name ? { name: r.file_name, mime: r.file_mime ?? 'application/octet-stream', size: Number(r.file_size ?? 0), sha256: r.file_sha256 ?? '', path: r.file_path ?? undefined } : undefined,
  body: r.body ?? undefined,
  upload: r.upload_state ? {
    state: r.upload_state, progress: r.upload_state === 'ready' ? 100 : 0, error: r.upload_error ?? undefined,
    attempts: r.upload_attempts ?? 1, idempotencyKey: `${r.patient_id}:${r.file_sha256 ?? r.id}`,
  } : undefined,
  status: r.status ?? undefined,
  signedBy: r.signed_by ?? undefined, signedAt: when(r.signed_at), signatureImage: r.signature_image ?? undefined,
  releasedBy: r.released_by ?? undefined, releasedAt: when(r.released_at), releaseOnReady: r.release_on_ready || undefined,
  seriesId: r.series_id, version: r.version, supersedes: r.supersedes ?? undefined, supersededBy: r.superseded_by ?? undefined,
  correctionReason: r.correction_reason ?? undefined, links: r.links ?? [], visibility: r.visibility,
  deletedAt: ms(r.deleted_at), deletedBy: r.deleted_by ?? undefined,
  seenByPatient: r.origin === 'patient_upload' ? undefined : r.seen_by_patient,
})

/* ─── Loading ───────────────────────────────────────────────────────── */
class LoadError extends Error {}

/**
 * Everything the signed-in person may see, in one round of requests.
 * `me` is the account that signed in; its sign-in method is kept, since the
 * database does not hold it.
 */
export async function loadRecords(me: AppUser): Promise<Records> {
  const supabase = await getSupabase()
  /** Rows of one table, optionally filtered and ordered. What the person may not see simply is not in the answer. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = async (table: string, shape: (query: any) => any = query => query): Promise<Row[]> => {
    const { data, error } = await shape(supabase.from(table).select('*'))
    if (error) throw new LoadError(error.message)
    return data ?? []
  }
  const since = daysAgo(HISTORY_DAYS).toISOString()
  const logsSince = dayKey(daysAgo(LOG_DAYS))
  const staff = me.role === 'admin' || me.role === 'assistant'

  const [
    profiles, patients, doctors, staffRows, allergies, conditions, contacts, doctorRequests,
    vitalDefRows, tracked, thresholds, thresholdChanges, readings, alertRows,
    prescriptions, doseLogs, mealLogs, mealPlanRows, hydrationRows,
    appointmentRows, messageRows, notificationRows, reportRows, noteRows, ticketRows, auditRows,
    ratingRows, consentRows, documentRows, docEventRows, shareRows,
  ] = await Promise.all([
    rows('profiles'), rows('patients'), rows('doctors'), rows('staff'), rows('allergies'), rows('conditions'),
    rows('emergency_contacts', q => q.order('created_at')),
    rows('doctor_requests', q => q.order('requested_at', { ascending: false })),
    rows('vital_defs'), rows('tracked_vitals'), rows('thresholds'),
    rows('threshold_changes', q => q.order('changed_at')),
    rows('readings', q => q.gte('taken_at', since).order('taken_at', { ascending: false }).limit(5000)),
    rows('alerts', q => q.order('created_at', { ascending: false }).limit(1000)),
    rows('prescriptions', q => q.order('prescribed_at', { ascending: false })),
    rows('dose_logs', q => q.gte('day', logsSince)),
    rows('meal_logs', q => q.gte('day', logsSince)),
    rows('meal_plans'),
    rows('hydration_logs', q => q.gte('day', logsSince)),
    rows('appointments', q => q.order('created_at', { ascending: false })),
    rows('messages', q => q.order('created_at').limit(2000)),
    rows('notifications', q => q.order('created_at', { ascending: false }).limit(100)),
    rows('report_requests', q => q.order('created_at', { ascending: false })),
    rows('clinical_notes', q => q.order('created_at', { ascending: false })),
    rows('support_tickets', q => q.order('created_at', { ascending: false })),
    staff ? rows('audit_log', q => q.order('created_at', { ascending: false }).limit(300)) : Promise.resolve([] as Row[]),
    rows('doctor_ratings'),
    rows('consents', q => q.eq('user_id', me.id).order('created_at', { ascending: false })),
    rows('documents', q => q.order('document_date', { ascending: false })),
    rows('document_events', q => q.order('created_at', { ascending: false }).limit(500)),
    rows('share_links', q => q.order('created_at', { ascending: false })),
  ])

  const vitalDefs = vitalDefRows.map(toVitalDef)
  const by = <T extends Row>(list: T[], key: string) => {
    const map = new Map<string, T[]>()
    list.forEach(r => { const k = r[key] as string; map.set(k, [...(map.get(k) ?? []), r]) })
    return (id: string) => map.get(id) ?? []
  }
  const one = (list: Row[]) => { const map = new Map(list.map(r => [r.id as string, r])); return (id: string) => map.get(id) }
  const patientOf = one(patients), doctorOf = one(doctors), staffOf = one(staffRows)
  const allergiesOf = by(allergies, 'patient_id'), conditionsOf = by(conditions, 'patient_id'), contactsOf = by(contacts, 'patient_id')
  const requestsOf = by(doctorRequests, 'patient_id'), trackedOf = by(tracked, 'patient_id'), thresholdsOf = by(thresholds, 'patient_id')
  const changesOf = by(thresholdChanges, 'patient_id'), readingsOf = by(readings, 'patient_id'), prescriptionsOf = by(prescriptions, 'patient_id')
  const termsAt = ms(consentRows.find(c => c.kind === 'terms' && c.granted)?.created_at)

  const users = profiles.map((p): AppUser => {
    const base = {
      id: p.id as string, name: p.full_name as string, email: p.email as string, phone: (p.phone as string) ?? '',
      status: p.status as AccountStatus, createdAt: dateLabel(new Date(p.created_at)),
      dob: p.dob ?? undefined, avatar: p.avatar ?? undefined, theme: p.theme ?? undefined, fontSize: p.font_size ?? undefined,
      // Passwords and codes are held by the sign-in service; the app never sees them.
      verificationCode: '', password: '',
      ...(p.id === me.id ? { authProvider: me.authProvider, termsAcceptedAt: termsAt } : {}),
    }
    if (p.role === 'doctor') {
      const d = doctorOf(p.id)
      const doctor: DoctorUser = {
        ...base, role: 'doctor', specialty: d?.specialty ?? '', licenseNo: d?.license_no ?? '', hospital: d?.hospital ?? '',
        approvalStatus: (d?.approval_status ?? 'pending') as ApprovalStatus, approvalNote: d?.approval_note ?? undefined,
        approvedBy: d?.approved_by ?? undefined, approvedAt: d?.approved_at ? dateLabel(new Date(d.approved_at)) : undefined,
        signature: d?.signature ?? undefined,
        assignedPatientIds: patients.filter(pt => pt.assigned_doctor_id === p.id).map(pt => pt.id as string),
      }
      return doctor
    }
    if (p.role === 'admin' || p.role === 'assistant') {
      const s = staffOf(p.id)
      const admin: AdminUser = {
        ...base, role: p.role, isAssistant: p.role === 'assistant' || !!s?.is_assistant, permissions: (s?.permissions ?? []) as AssistantPerm[],
      }
      return admin
    }
    const pt = patientOf(p.id)
    const req = requestsOf(p.id).find(r => r.status === 'pending') ?? requestsOf(p.id)[0]
    const doctorRequest: DoctorRequest | undefined = req && {
      doctorId: req.doctor_id, requestedAt: dateLabel(new Date(req.requested_at)), status: req.status, responseNote: req.response_note ?? undefined,
    }
    const targets = thresholdsOf(p.id)
    const critical = targets.filter(t => t.critical_min !== null && t.critical_max !== null)
    const patient: PatientUser = {
      ...base, role: 'patient',
      assignedDoctorId: pt?.assigned_doctor_id ?? undefined,
      // An approved request has done its job once the doctor is assigned; only a waiting or declined one is shown.
      doctorRequest: doctorRequest && !(doctorRequest.status === 'approved' && pt?.assigned_doctor_id) ? doctorRequest : undefined,
      profileSetup: pt?.profile_setup === 'done' ? 'done' : pt?.profile_setup === 'skipped' ? 'skipped' : 'pending',
      trackedVitalIds: trackedOf(p.id).map(t => t.vital_id as string),
      thresholds: Object.fromEntries(targets.map(t => [t.vital_id, { min: Number(t.target_min), max: Number(t.target_max) }])),
      criticalThresholds: critical.length ? Object.fromEntries(critical.map(t => [t.vital_id, { min: Number(t.critical_min), max: Number(t.critical_max) }])) : undefined,
      targetLog: changesOf(p.id).filter(c => c.to_min !== null).map((c): TargetChange => ({
        vitalId: c.vital_id, at: ms(c.changed_at) ?? 0, by: c.changed_by ?? '',
        from: c.from_min !== null ? { min: Number(c.from_min), max: Number(c.from_max) } : undefined,
        to: { min: Number(c.to_min), max: Number(c.to_max) },
      })),
      unitPrefs: pt?.unit_prefs ?? {},
      prescriptions: prescriptionsOf(p.id).map(r => ({
        id: r.id, medication: r.medication, dosage: r.dosage, frequency: r.frequency, purpose: r.purpose ?? '',
        prescribedAt: dateLabel(new Date(r.prescribed_at)), doctorId: r.doctor_id, active: r.active,
      })),
      readings: readingsOf(p.id).map(toReading),
      doctorNote: pt?.doctor_note ?? undefined,
      // Next of kin first, so SOS offers to call them.
      emergencyContacts: contactsOf(p.id)
        .map(c => ({ id: c.id as string, name: c.name as string, relationship: c.relationship as string, phone: c.phone as string, nextOfKin: !!c.next_of_kin }))
        .sort((a, b) => Number(b.nextOfKin) - Number(a.nextOfKin)),
      docPrefs: { privateByDefault: !!pt?.docs_private_default },
      health: pt ? {
        sex: pt.sex ?? undefined, bloodType: pt.blood_type ?? undefined,
        allergies: allergiesOf(p.id).map(a => ({ id: a.id, substance: a.substance, severity: a.severity, reaction: a.reaction ?? undefined })),
        noKnownAllergies: pt.no_known_allergies || undefined,
        conditions: conditionsOf(p.id).map(c => c.name as string),
        noConditions: pt.no_conditions || undefined,
        otherMedicines: pt.other_medicines ?? undefined,
      } : undefined,
    }
    return patient
  })
  // The signed-in account is always present, even if its profile row could not be read.
  if (!users.some(u => u.id === me.id)) users.push(me)

  return {
    users, vitalDefs,
    alerts: alertRows.map(r => toAlert(r, vitalDefs)),
    appointments: appointmentRows.map(toAppointment),
    messages: messageRows.map(toMessage),
    notifications: notificationRows.map(toNotification),
    doses: doseLogs.map(r => ({ patientId: r.patient_id, rxId: r.prescription_id, slot: r.slot, day: r.day, takenAt: when(r.taken_at) ?? '' })),
    mealsDone: mealLogs.map(r => ({ patientId: r.patient_id, mealId: r.meal_id, day: r.day, takenAt: when(r.taken_at) ?? '', note: r.note ?? undefined })),
    reportRequests: reportRows.map(r => ({
      id: r.id, patientId: r.patient_id, doctorId: r.doctor_id, periodDays: r.period_days, reason: r.reason ?? '', status: r.status,
      at: ms(r.created_at) ?? 0, createdAt: when(r.created_at) ?? '', docId: r.document_id ?? undefined,
      declineReason: r.decline_reason ?? undefined, handledAt: when(r.handled_at),
    })),
    clinicalNotes: noteRows.map(r => ({ id: r.id, patientId: r.patient_id, authorId: r.author_id, content: r.content, at: ms(r.created_at) ?? 0, createdAt: when(r.created_at) ?? '' })),
    supportTickets: ticketRows.map(r => ({
      id: r.id, userId: r.user_id, subject: r.subject, message: r.message ?? '', status: r.status,
      at: ms(r.created_at) ?? 0, createdAt: when(r.created_at) ?? '',
      resolvedBy: r.resolved_by ?? undefined, resolutionNote: r.resolution_note ?? undefined, resolvedAt: when(r.resolved_at),
    })),
    audit: auditRows.map(r => ({ id: String(r.id), actorId: r.actor_id ?? 'system', action: r.action, detail: r.detail ?? '', at: ms(r.created_at) ?? 0, createdAt: when(r.created_at) ?? '' })),
    mealPlans: mealPlanRows.map(r => ({
      patientId: r.patient_id, meals: Array.isArray(r.meals) ? r.meals : [], targetKcal: r.target_kcal ?? undefined,
      waterGoal: r.water_goal ?? 8, dietaryNote: r.dietary_note ?? undefined, setBy: r.set_by ?? undefined,
    })),
    hydration: hydrationRows.map(r => ({ patientId: r.patient_id, day: r.day, glasses: r.glasses })),
    ratings: ratingRows.map(r => ({ patientId: r.patient_id, doctorId: r.doctor_id, rating: r.rating, comment: r.comment ?? undefined })),
    documents: documentRows.map(toDocument),
    docEvents: docEventRows.map(r => ({
      id: String(r.id), docId: r.document_id, patientId: r.patient_id, actorId: r.actor_id ?? (r.actor_label ? `external:${r.actor_label}` : 'system'),
      action: r.action, detail: r.detail ?? undefined, at: ms(r.created_at) ?? 0, createdAt: when(r.created_at) ?? '',
    })),
    shareLinks: shareRows.map(r => ({
      // Only a hash of the link is kept by the server, so a stored link has no token to show again.
      id: r.id, token: '', patientId: r.patient_id, docIds: r.document_ids ?? [], recipient: r.recipient, oneTime: r.one_time,
      at: ms(r.created_at) ?? 0, createdAt: when(r.created_at) ?? '', expiresAt: ms(r.expires_at) ?? 0,
      usedAt: r.one_time && r.opened_count > 0 ? ms(r.created_at) : undefined, revokedAt: ms(r.revoked_at),
    })),
  }
}

/** The id of the newest notification, or '' when there are none: a cheap way to learn that something changed. */
export async function latestNotificationId(): Promise<string> {
  const supabase = await getSupabase()
  const { data, error } = await supabase.from('notifications').select('id').order('created_at', { ascending: false }).limit(1)
  if (error) throw new LoadError(error.message)
  return (data?.[0]?.id as string | undefined) ?? ''
}

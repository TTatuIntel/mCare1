/** Supabase persistence for the signed-in patient portal. Demo mode never calls this module. */
import type { PostgrestError } from '@supabase/supabase-js'
import type {
  AppAlert, Appointment, DoctorUser, EmergencyContact, HealthProfile, MealDone, MedDose,
  PatientMessage, PatientUser, Prescription, ReportRequest, VitalDef, VitalReading,
} from '@/shared/lib/types'
import { getSupabase } from './supabase'

const isoLabel = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const stamp = (value: string) => new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const fail = (error: PostgrestError | null) => { if (error) throw new Error(error.message) }

export interface PatientSnapshot {
  patient: Partial<PatientUser>
  doctors: DoctorUser[]
  vitalDefs: VitalDef[]
  alerts: AppAlert[]
  appointments: Appointment[]
  messages: PatientMessage[]
  doses: MedDose[]
  meals: MealDone[]
  reports: ReportRequest[]
}

/** Loads every relational record used by the patient screens in one parallel round trip. */
export async function loadPatientSnapshot(patientId: string): Promise<PatientSnapshot> {
  const db = await getSupabase()
  const [pt, tracked, thresholds, readings, prescriptions, contacts, allergies, conditions, doctors, defs, alerts, appts, messages, doses, meals, reports] = await Promise.all([
    db.from('patients').select('*').eq('id', patientId).single(),
    db.from('tracked_vitals').select('vital_id').eq('patient_id', patientId),
    db.from('thresholds').select('*').eq('patient_id', patientId),
    db.from('readings').select('*').eq('patient_id', patientId).order('taken_at', { ascending: false }),
    db.from('prescriptions').select('*').eq('patient_id', patientId).order('prescribed_at', { ascending: false }),
    db.from('emergency_contacts').select('*').eq('patient_id', patientId).order('created_at'),
    db.from('allergies').select('*').eq('patient_id', patientId),
    db.from('conditions').select('name').eq('patient_id', patientId),
    db.from('doctors').select('*, profiles!inner(*)').eq('approval_status', 'approved'),
    db.from('vital_defs').select('*').order('name'),
    db.from('alerts').select('*, vital_defs(name)').eq('patient_id', patientId).order('created_at', { ascending: false }),
    db.from('appointments').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
    db.from('messages').select('*').or(`from_id.eq.${patientId},to_id.eq.${patientId}`).order('created_at'),
    db.from('dose_logs').select('*').eq('patient_id', patientId),
    db.from('meal_logs').select('*').eq('patient_id', patientId),
    db.from('report_requests').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
  ])
  ;[pt, tracked, thresholds, readings, prescriptions, contacts, allergies, conditions, doctors, defs, alerts, appts, messages, doses, meals, reports].forEach(r => fail(r.error))

  const patientRow = pt.data!
  const health: HealthProfile = {
    sex: patientRow.sex ?? undefined, bloodType: patientRow.blood_type ?? undefined,
    noKnownAllergies: patientRow.no_known_allergies, noConditions: patientRow.no_conditions,
    otherMedicines: patientRow.other_medicines ?? undefined,
    allergies: (allergies.data ?? []).map(a => ({ id: a.id, substance: a.substance, severity: a.severity, reaction: a.reaction ?? undefined })),
    conditions: (conditions.data ?? []).map(c => c.name),
  }
  return {
    patient: {
      assignedDoctorId: patientRow.assigned_doctor_id ?? undefined, profileSetup: patientRow.profile_setup,
      doctorNote: patientRow.doctor_note ?? undefined, docPrefs: { privateByDefault: patientRow.docs_private_default }, health,
      trackedVitalIds: (tracked.data ?? []).map(x => x.vital_id),
      thresholds: Object.fromEntries((thresholds.data ?? []).map(x => [x.vital_id, { min: Number(x.target_min), max: Number(x.target_max) }])),
      criticalThresholds: Object.fromEntries((thresholds.data ?? []).filter(x => x.critical_min != null && x.critical_max != null).map(x => [x.vital_id, { min: Number(x.critical_min), max: Number(x.critical_max) }])),
      readings: (readings.data ?? []).map(x => ({ id: x.id, vitalId: x.vital_id, value: x.value, note: x.note ?? undefined, invalid: x.invalid, invalidReason: x.invalid_reason ?? undefined, at: new Date(x.taken_at).getTime(), loggedAt: stamp(x.taken_at) })),
      prescriptions: (prescriptions.data ?? []).map(x => ({ id: x.id, medication: x.medication, dosage: x.dosage, frequency: x.frequency, purpose: x.purpose, doctorId: x.doctor_id, active: x.active, prescribedAt: isoLabel(x.prescribed_at) })),
      emergencyContacts: (contacts.data ?? []).map(x => ({ id: x.id, name: x.name, relationship: x.relationship, phone: x.phone, nextOfKin: x.next_of_kin })),
    },
    doctors: (doctors.data ?? []).map((x: any) => ({ id: x.id, role: 'doctor', name: x.profiles.full_name, email: x.profiles.email, phone: x.profiles.phone, status: x.profiles.status, createdAt: isoLabel(x.profiles.created_at), verificationCode: '', password: '', specialty: x.specialty, licenseNo: x.license_no, hospital: x.hospital, approvalStatus: x.approval_status, assignedPatientIds: [] })),
    vitalDefs: (defs.data ?? []).map(x => ({ id: x.id, name: x.name, unit: x.unit, icon: x.icon, active: x.active, normalMin: Number(x.normal_min), normalMax: Number(x.normal_max), criticalMin: x.critical_min == null ? undefined : Number(x.critical_min), criticalMax: x.critical_max == null ? undefined : Number(x.critical_max), hardMin: Number(x.hard_min), hardMax: Number(x.hard_max), diaNormalMin: x.dia_normal_min == null ? undefined : Number(x.dia_normal_min), diaNormalMax: x.dia_normal_max == null ? undefined : Number(x.dia_normal_max), diaCriticalMin: x.dia_critical_min == null ? undefined : Number(x.dia_critical_min), diaCriticalMax: x.dia_critical_max == null ? undefined : Number(x.dia_critical_max), unitOptions: x.unit_options ?? undefined })),
    alerts: (alerts.data ?? []).map((x: any) => ({ id: x.id, patientId: x.patient_id, vitalId: x.vital_id ?? undefined, vitalName: x.vital_defs?.name ?? (x.type === 'sos' ? 'SOS' : 'Vital'), value: x.value, unit: x.unit, severity: x.severity, type: x.type, status: x.status, resolved: x.status === 'resolved', readingId: x.reading_id ?? undefined, at: new Date(x.created_at).getTime(), loggedAt: stamp(x.created_at), acknowledgedAt: x.acknowledged_at ? stamp(x.acknowledged_at) : undefined, acknowledgedBy: x.acknowledged_by ?? undefined, resolvedAt: x.resolved_at ? stamp(x.resolved_at) : undefined, resolvedBy: x.resolved_by ?? undefined, resolutionReason: x.resolution_reason ?? undefined, resolutionNote: x.resolution_note ?? undefined, escalatedAt: x.escalated_at ? stamp(x.escalated_at) : undefined, recheckRequestedAt: x.recheck_requested_at ? new Date(x.recheck_requested_at).getTime() : undefined })),
    appointments: (appts.data ?? []).map(x => ({ id: x.id, patientId: x.patient_id, doctorId: x.doctor_id, title: x.title, reason: x.reason, preferredDate: isoLabel(x.preferred_date), preferredTime: x.preferred_time ?? 'Any time', location: x.location ?? undefined, status: x.status, approvalNote: x.approval_note ?? undefined, rejectionReason: x.rejection_reason ?? undefined, rescheduledTo: x.rescheduled_date ? isoLabel(x.rescheduled_date) : undefined, rescheduledTime: x.rescheduled_time ?? undefined, rescheduledReason: x.rescheduled_reason ?? undefined, createdAt: isoLabel(x.created_at) })),
    messages: (messages.data ?? []).map(x => ({ id: x.id, fromId: x.from_id, toId: x.to_id, content: x.content, read: x.read, sentAt: stamp(x.created_at) })),
    doses: (doses.data ?? []).map(x => ({ patientId: x.patient_id, rxId: x.prescription_id, slot: x.slot, day: x.day, takenAt: stamp(x.taken_at) })),
    meals: (meals.data ?? []).map(x => ({ patientId: x.patient_id, mealId: x.meal_id, day: x.day, note: x.note ?? undefined, takenAt: stamp(x.taken_at) })),
    reports: (reports.data ?? []).map(x => ({ id: x.id, patientId: x.patient_id, doctorId: x.doctor_id, periodDays: x.period_days, reason: x.reason, status: x.status, at: new Date(x.created_at).getTime(), createdAt: stamp(x.created_at), docId: x.document_id ?? undefined, declineReason: x.decline_reason ?? undefined, handledAt: x.handled_at ? stamp(x.handled_at) : undefined })),
  }
}

export async function updatePatientProfile(id: string, patch: Record<string, unknown>) { const db = await getSupabase(); fail((await db.from('patients').update(patch).eq('id', id)).error) }
export async function updateProfile(id: string, patch: Record<string, unknown>) { const db = await getSupabase(); fail((await db.from('profiles').update(patch).eq('id', id)).error) }
export async function replaceTrackedVitals(id: string, ids: string[]) { const db = await getSupabase(); fail((await db.from('tracked_vitals').delete().eq('patient_id', id)).error); if (ids.length) fail((await db.from('tracked_vitals').insert(ids.map(vital_id => ({ patient_id: id, vital_id })))).error) }
export async function replaceHealth(id: string, h: HealthProfile) { const db = await getSupabase(); fail((await db.from('patients').update({ sex: h.sex ?? null, blood_type: h.bloodType ?? null, no_known_allergies: !!h.noKnownAllergies, no_conditions: !!h.noConditions, other_medicines: h.otherMedicines ?? null }).eq('id', id)).error); fail((await db.from('allergies').delete().eq('patient_id', id)).error); fail((await db.from('conditions').delete().eq('patient_id', id)).error); if (h.allergies.length) fail((await db.from('allergies').insert(h.allergies.map(a => ({ patient_id: id, substance: a.substance, severity: a.severity, reaction: a.reaction ?? null })))).error); if (h.conditions.length) fail((await db.from('conditions').insert(h.conditions.map(name => ({ patient_id: id, name })))).error) }
export async function saveContact(patientId: string, c: EmergencyContact) { const db = await getSupabase(); if (c.nextOfKin) fail((await db.from('emergency_contacts').update({ next_of_kin: false }).eq('patient_id', patientId)).error); const row = { patient_id: patientId, name: c.name, relationship: c.relationship, phone: c.phone, next_of_kin: !!c.nextOfKin }; const q = c.id.startsWith('ec_') ? db.from('emergency_contacts').insert(row) : db.from('emergency_contacts').update(row).eq('id', c.id); fail((await q).error) }
export async function deleteContact(id: string) { const db = await getSupabase(); fail((await db.from('emergency_contacts').delete().eq('id', id)).error) }
export async function requestDoctor(doctorId: string) { const db = await getSupabase(); fail((await db.rpc('request_doctor', { doctor: doctorId })).error) }
export async function createAppointment(a: Appointment, date: string, time: string) { const db = await getSupabase(); fail((await db.from('appointments').insert({ patient_id: a.patientId, doctor_id: a.doctorId, title: a.title, reason: a.reason, preferred_date: date, preferred_time: time || null, location: a.location ?? null, status: 'requested' })).error) }
export async function createReportRequest(patientId: string, doctorId: string, periodDays: number, reason: string) { const db = await getSupabase(); fail((await db.from('report_requests').insert({ patient_id: patientId, doctor_id: doctorId, period_days: periodDays, reason })).error) }
export async function createReading(patientId: string, reading: VitalReading) { const db = await getSupabase(); fail((await db.from('readings').insert({ patient_id: patientId, vital_id: reading.vitalId, value: reading.value, note: reading.note ?? null })).error) }
export async function updateReading(id: string, value: string) { const db = await getSupabase(); fail((await db.from('readings').update({ value }).eq('id', id)).error) }
export async function raiseSos(message: string) { const db = await getSupabase(); fail((await db.rpc('raise_sos', { message })).error) }
export async function setDose(patientId: string, rxId: string, slot: number, day: string, taken: boolean) { const db = await getSupabase(); const q = taken ? db.from('dose_logs').insert({ patient_id: patientId, prescription_id: rxId, slot, day }) : db.from('dose_logs').delete().eq('patient_id', patientId).eq('prescription_id', rxId).eq('slot', slot).eq('day', day); fail((await q).error) }
export async function setMeal(patientId: string, mealId: string, day: string, note: string | undefined, taken: boolean) { const db = await getSupabase(); const q = taken ? db.from('meal_logs').insert({ patient_id: patientId, meal_id: mealId, day, note: note ?? null }) : db.from('meal_logs').delete().eq('patient_id', patientId).eq('meal_id', mealId).eq('day', day); fail((await q).error) }
export async function createMessage(fromId: string, toId: string, content: string) { const db = await getSupabase(); fail((await db.from('messages').insert({ from_id: fromId, to_id: toId, content })).error) }
export async function readMessages(fromId: string, toId: string) { const db = await getSupabase(); fail((await db.from('messages').update({ read: true }).eq('from_id', fromId).eq('to_id', toId).eq('read', false)).error) }
export async function markNotification(id: string) { const db = await getSupabase(); fail((await db.from('notifications').update({ read: true }).eq('id', id)).error) }
export async function markNotifications(userId: string) { const db = await getSupabase(); fail((await db.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)).error) }

/**
 * The doctor portal's data layer.
 *
 * Every doctor screen reads and changes the record through this hook, never
 * through the store's generic `updateUser` and never by reading the full user
 * list. What it returns is already narrowed to this doctor: their patients,
 * and the alerts, visits, notes and requests that belong to those patients.
 * The database applies the same rule to every request (a doctor reaches only
 * the patients assigned to them); this hook only stops a screen from having
 * to repeat it.
 *
 * Live mode: the record was loaded when the doctor signed in and is kept
 * fresh in the background; every action saves to the database, which checks
 * the doctor may do it, tells the patient and writes the audit trail. Demo
 * mode: the same actions change sample data held in memory.
 *
 * Every action resolves with `{ ok: true }` or `{ ok: false, error }`, where
 * `error` is a sentence fit to show. Nothing throws.
 *
 *   const { doctor, patients, status, error, reload, prescribe } = useDoctor()
 */
import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import { useLoadStatus } from '@/shared/state/useLoadStatus'
import { partnersOf } from '@/shared/lib/messaging'
import type { Appointment, DoctorUser, MealPlan, PatientUser, RxRoute } from '@/shared/lib/types'
import * as api from '@/shared/api/actions'
import { dateLabel } from '@/shared/lib/vitals'

let seq = 0
/** Demo mode: a client id for a new record. In live mode the database issues the id. */
const tempId = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`

export interface NewPrescription {
  medication: string
  dosage: string
  frequency: string
  purpose: string
  route?: RxRoute
  instructions?: string
  /** YYYY-MM-DD. Leave `endDate` out for a medicine taken until it is stopped. */
  startDate?: string
  endDate?: string
  /** The form's reference (`useSave().ref`): a prescription sent twice is saved once. */
  ref?: string
}

export interface NewVisit {
  patientId: string
  title: string
  reason: string
  /** As shown: "Oct 4, 2026" and "2:30 PM" (see lib/schedule). */
  date: string
  time: string
  location?: string
  ref?: string
}

export function useDoctor() {
  const app = useApp()
  const doctor = app.currentUser as DoctorUser
  const load = useLoadStatus()
  const { live } = app

  const mine = new Set(doctor.assignedPatientIds)
  const patients = app.getPatients().filter(p => mine.has(p.id))
  const alerts = app.alerts.filter(a => mine.has(a.patientId))

  return {
    ...load,
    doctor,
    now: app.now,
    /** GET vital_defs */
    vitalDefs: app.vitalDefs,

    /** GET patients, profiles (assigned to this doctor) */
    patients,
    patient: (id: string | undefined | null): PatientUser | undefined => patients.find(p => p.id === id),
    /** GET care_team_members: patients whose record this doctor reads as a consulting doctor, and changes nothing in. */
    consulting: app.careTeam.filter(m => m.doctorId === doctor.id && !m.endedAt)
      .flatMap(m => { const p = app.getPatients().find(x => x.id === m.patientId); return p ? [{ member: m, patient: p }] : [] }),
    /** GET alerts of one patient this doctor may see (their own patient, or one they consult on). */
    alertsOf: (patientId: string) => app.alerts.filter(a => a.patientId === patientId),
    /** RPC remove_consulting_doctor: this doctor leaves a care team. */
    leaveCareTeam: app.removeConsultingDoctor,
    /** RPC my_past_patients: who this doctor used to treat. Names and dates only; their records are no longer open to them. */
    pastPatients: app.pastPatients,
    /** Display name for anyone this doctor's records mention. Someone they may not see (a previous doctor) gets the fallback. */
    nameOf: (id: string | undefined | null, fallback = 'Patient') =>
      app.users.find(u => u.id === id)?.name ?? app.pastPatients.find(p => p.patientId === id)?.name ?? fallback,

    /** GET alerts (of this doctor's patients) */
    alerts,
    activeAlerts: alerts.filter(isActiveAlert)
      .sort((a, b) => (a.severity === 'danger' ? 0 : 1) - (b.severity === 'danger' ? 0 : 1) || b.at - a.at),
    /** GET appointments (with this doctor) */
    appointments: app.appointments.filter(a => a.doctorId === doctor.id),
    /** GET messages (between this doctor and their patients, past and present) */
    messages: app.messages.filter(m => m.toId === doctor.id || m.fromId === doctor.id),
    /** Everyone this doctor has exchanged a message with, including patients who have since moved on. */
    messagePartners: partnersOf(app.messages, doctor.id),
    unreadFrom: (patientId: string) => app.messages.filter(m => m.fromId === patientId && m.toId === doctor.id && !m.read).length,
    /** GET clinical_notes: shared and internal, newest first. A corrected note carries `amendedBy`. */
    notesFor: (patientId: string) => app.clinicalNotes.filter(n => n.patientId === patientId),
    /** GET care_plans, care_plan_items, care_plan_events */
    carePlansFor: (patientId: string) => app.carePlans.filter(p => p.patientId === patientId),
    /** GET doctor_time_off (own) */
    timeOff: app.timeOff.filter(o => o.doctorId === doctor.id),
    /** GET report_requests (waiting for this doctor) */
    reportRequests: app.reportRequests.filter(r => r.doctorId === doctor.id && mine.has(r.patientId)),
    /** GET dose_logs, meal_logs, meal_plans, hydration_logs: what the patient ticked off, and the plan they follow. */
    doses: app.doses,
    mealsDone: app.mealsDone,
    hydration: app.hydration,
    mealPlanOf: (patientId: string): MealPlan | undefined => app.mealPlans.find(p => p.patientId === patientId),

    /* ── vitals ── */
    /** RPC set_tracked_vitals: which vitals the patient records. */
    setTrackedVitals: (patientId: string, ids: string[]) => {
      const unique = [...new Set(ids)]
      return live ? app.run(async () => { await api.setTrackedVitals(unique, patientId) })
        : app.updateUser(patientId, { trackedVitalIds: unique } as Partial<PatientUser>)
    },
    /** UPSERT thresholds: the patient's personal target for a vital. The database keeps the history and tells the patient. */
    setTarget: app.setThreshold,
    /** UPDATE thresholds: the patient's own critical range, or `null` to go back to the standard one. */
    setCriticalRange: app.setCriticalThreshold,
    /** INSERT readings: a reading taken in clinic. The database grades it, raises any alert and tells the patient. */
    recordReading: (patientId: string, r: { vitalId: string; value: string; note?: string; ref?: string }) =>
      app.logReading(patientId, { id: tempId('r'), vitalId: r.vitalId, value: r.value.trim(), loggedAt: '', note: r.note?.trim() || undefined, clientRef: r.ref }),
    /** UPDATE readings: the reading stays in the record, out of trends; the alert it raised is closed. */
    invalidateReading: app.invalidateReading,

    /* ── alerts ── */
    /** UPDATE alerts */
    acknowledgeAlert: app.acknowledgeAlert,
    escalateAlert: app.escalateAlert,

    /* ── medication ── */
    /** INSERT prescriptions: the database tells the patient, files the prescription in their documents and audits it. */
    prescribe: (patientId: string, rx: NewPrescription) => app.addPrescription(patientId, {
      id: tempId('rx'), medication: rx.medication.trim(), dosage: rx.dosage.trim(), frequency: rx.frequency, purpose: rx.purpose.trim(),
      route: rx.route, instructions: rx.instructions?.trim() || undefined, startDate: rx.startDate || undefined, endDate: rx.endDate || undefined,
      prescribedAt: dateLabel(), doctorId: doctor.id, active: true, clientRef: rx.ref,
    }),
    /** UPDATE prescriptions: stopped with its reason, kept in the record; never deleted. */
    stopMedicine: (patientId: string, rxId: string, reason: string) => app.setPrescriptionActive(patientId, rxId, false, reason),
    restartMedicine: (patientId: string, rxId: string) => app.setPrescriptionActive(patientId, rxId, true),

    /* ── notes ── */
    /** INSERT clinical_notes: internal (care team only) or shared with the patient; `amends` corrects an earlier note. */
    addNote: app.addClinicalNote,

    /* ── care plans ── */
    /** RPC save_care_plan: the plan with its goals and interventions, in one transaction. */
    saveCarePlan: app.saveCarePlan,
    /** RPC set_care_plan_status: start, put on hold, resume, complete or cancel. */
    setCarePlanStatus: app.setCarePlanStatus,
    /** UPDATE care_plan_items: a goal reached or dropped, with a note on progress. */
    setCarePlanItem: app.setCarePlanItem,
    /** DELETE care_plans (a draft only) */
    deleteCarePlanDraft: app.deleteCarePlanDraft,

    /* ── availability ── */
    /** RPC set_doctor_hours: the working week, replaced in one step. */
    setHours: app.setDoctorHours,
    /** INSERT / DELETE doctor_time_off */
    addTimeOff: app.addTimeOff,
    removeTimeOff: app.removeTimeOff,

    /* ── nutrition ── */
    /** UPSERT / DELETE meal_plans */
    setMealPlan: app.setMealPlan,
    clearMealPlan: app.clearMealPlan,

    /* ── visits ── */
    /** INSERT appointments: booked as confirmed; the patient is told. */
    bookVisit: (v: NewVisit) => app.addAppointment({
      id: tempId('ap'), patientId: v.patientId, doctorId: doctor.id, title: v.title.trim(), reason: v.reason.trim(),
      preferredDate: v.date, preferredTime: v.time, location: v.location?.trim() || undefined,
      status: 'approved', createdBy: doctor.id, createdAt: dateLabel(), at: Date.now(), clientRef: v.ref,
    }),
    /** UPDATE appointments: confirm, decline, propose a new time, complete, record a missed visit, cancel. */
    answerVisit: (id: string, patch: Partial<Appointment>) => app.updateAppointment(id, patch),

    /* ── reports ── */
    /** UPDATE report_requests */
    declineReportRequest: app.declineReportRequest,

    /* ── monitoring plan, reviews, access log ── */
    /** RPC set_vital_plan: how often the patient measures a vital (null: the usual schedule), and why. The patient is told. */
    setVitalPlan: app.setVitalPlan,
    /** GET vital_reviews: each review of a patient's readings, newest first. */
    reviewsOf: (patientId: string) => app.vitalReviews.filter(r => r.patientId === patientId).sort((a, b) => b.reviewedThrough - a.reviewedThrough),
    /** Valid readings a patient logged since the last review (all of them before the first). */
    unreviewedOf: (patientId: string) => {
      const last = app.vitalReviews.filter(r => r.patientId === patientId).reduce((m, r) => Math.max(m, r.reviewedThrough), 0)
      return (patients.find(p => p.id === patientId)?.readings ?? []).filter(r => !r.invalid && (r.at ?? 0) > last)
    },
    /** RPC review_vitals: marks a patient's readings reviewed up to now, with an optional note the patient reads. */
    reviewVitals: app.reviewVitals,
    /** RPC log_record_view: opening a patient's record is in that patient's access log. */
    logRecordView: app.logRecordView,
  }
}

/**
 * The patient portal's data layer.
 *
 * Every patient screen reads and changes the signed-in patient's record
 * through this hook — never through the store's generic `updateUser`, and
 * never by reading the full user list. That gives the portal one seam, and
 * each member is one request to the backend (noted beside it).
 *
 * Live mode: the record was loaded from the database when the patient signed
 * in and is kept fresh in the background; every action saves to the database,
 * which checks that the patient may do it. Demo mode (no backend configured):
 * the same actions change sample data held in memory.
 *
 * Every action resolves with `{ ok: true }` or `{ ok: false, error }`, where
 * `error` is a sentence fit to show. Nothing throws.
 *
 *   const { patient, doctor, status, error, reload, setTrackedVitals } = usePatient()
 */
import { useApp } from '@/shared/state/AppContext'
import { useLoadStatus } from '@/shared/state/useLoadStatus'
import type {
  AppUser, Appointment, DoctorUser, EmergencyContact, HealthProfile, MealPlan, Outcome, PatientUser, AvatarSpec, PlannedMeal,
} from '@/shared/lib/types'
import * as api from '@/shared/api/actions'
import { dateLabel, dayKey } from '@/shared/lib/vitals'
import { DAILY_MEALS } from '@/shared/lib/schedule'

/** What a patient may know about a clinician: directory details only — never credentials or other patients. */
export type PublicDoctor = Pick<DoctorUser,
  'id' | 'name' | 'role' | 'email' | 'phone' | 'avatar' | 'specialty' | 'hospital' | 'licenseNo' | 'status' | 'approvalStatus'>

const toPublicDoctor = (d: DoctorUser): PublicDoctor => ({
  id: d.id, name: d.name, role: d.role, email: d.email, phone: d.phone, avatar: d.avatar,
  specialty: d.specialty, hospital: d.hospital, licenseNo: d.licenseNo, status: d.status, approvalStatus: d.approvalStatus,
})

/** The only fields a patient can change on their own record. Everything else is set by the care team or the system. */
type SelfPatch = Partial<Pick<PatientUser, 'trackedVitalIds' | 'emergencyContacts' | 'health' | 'dob' | 'avatar' | 'profileSetup' | 'doctorRequest'>>

export interface AppointmentRequest {
  doctorId: string
  title: string
  reason: string
  /** YYYY-MM-DD from the date picker. */
  date: string
  /** HH:MM (24 h) from the time picker, or '' for any time. */
  time: string
  location?: string
}

const fail = (error: string): Promise<Outcome> => Promise.resolve({ ok: false, error })

let seq = 0
/** Demo mode: a client id for a new record. In live mode the database issues the id. */
const tempId = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`

/** What the patient eats today: the doctor's plan when there is one, otherwise the standard plan. */
export interface TodaysMeals {
  meals: PlannedMeal[]
  /** True when the treating doctor set this plan for the patient. */
  personal: boolean
  targetKcal?: number
  waterGoal: number
  dietaryNote?: string
}

export function usePatient() {
  const app = useApp()
  const patient = app.currentUser as PatientUser
  const { live } = app

  // The record is loaded before the portal opens (the sign-in screen waits for it), so a screen always has data.
  // If the backend then becomes unreachable, the banner at the top of the portal says so; screens keep the last load.
  const { status, error, reload } = useLoadStatus()

  /** Demo mode: PATCH /me — whitelisted fields only. */
  const patchSelf = (patch: SelfPatch) => app.updateUser(patient.id, patch as Partial<AppUser>)

  const doctorById = (id?: string): PublicDoctor | undefined => {
    const u = id ? app.users.find(x => x.id === id) : undefined
    return u?.role === 'doctor' ? toPublicDoctor(u as DoctorUser) : undefined
  }

  const plan: MealPlan | undefined = app.mealPlans.find(p => p.patientId === patient.id)
  const todaysMeals: TodaysMeals = {
    meals: plan?.meals.length ? plan.meals : DAILY_MEALS,
    personal: !!plan?.meals.length,
    targetKcal: plan?.targetKcal,
    waterGoal: plan?.waterGoal ?? 8,
    dietaryNote: plan?.dietaryNote,
  }

  return {
    status, error, reload,
    /** True when the record is saved to the backend; false in demo mode. */
    live,

    /** GET profiles, patients (own rows) */
    patient,
    /** GET doctors, profiles (the assigned doctor) */
    doctor: doctorById(patient.assignedDoctorId),
    doctorById,
    /** GET doctors — approved, active clinicians a patient can ask for. */
    doctors: app.getDoctors().filter(d => d.status === 'active' && d.approvalStatus === 'approved').map(toPublicDoctor),
    /** GET care_plans: the plans the doctor has started for this patient (never a draft), newest first. */
    carePlans: app.carePlans.filter(p => p.patientId === patient.id && p.status !== 'draft'),
    /** RPC doctor_availability: the open times of a doctor on a day (YYYY-MM-DD). */
    availabilityFor: app.availabilityFor,
    /** Display name for anyone the patient's record mentions (prescriber, who resolved an alert…). */
    nameOf: (id: string | undefined, fallback = 'Your care team') => app.users.find(u => u.id === id)?.name ?? fallback,

    /**
     * Whether the patient may stop tracking a vital themself. Once a doctor is assigned, or has set a target
     * for the vital, only the doctor removes it. The database enforces the same rule.
     */
    canStopTracking: (vitalId: string) => !patient.assignedDoctorId && !patient.thresholds[vitalId],

    /** RPC set_tracked_vitals — the database keeps the vitals the doctor set, whatever is sent. */
    setTrackedVitals: (ids: string[]) => {
      const unique = [...new Set(ids)]
      return live ? app.run(async () => { await api.setTrackedVitals(unique) }) : patchSelf({ trackedVitalIds: unique })
    },

    /** RPC save_health_profile — optionally starts tracking vitals that a newly added condition calls for. */
    saveHealth: (health: HealthProfile, alsoTrack: string[] = []) => {
      const clean = { ...health, otherMedicines: health.otherMedicines?.trim() || undefined }
      const tracked = [...new Set([...patient.trackedVitalIds, ...alsoTrack])]
      if (live) return app.run(async () => {
        await api.saveHealth(clean)
        if (alsoTrack.length) await api.setTrackedVitals(tracked)
      })
      return patchSelf({ health: clean, ...(alsoTrack.length ? { trackedVitalIds: tracked } : {}) })
    },

    /** PATCH profiles — date of birth and profile picture. */
    saveAbout: (dob: string | undefined, avatar: AvatarSpec) => patchSelf({ dob, avatar }),

    /** RPC save_emergency_contact — there is one next of kin, and they are listed first so SOS offers to call them. */
    saveEmergencyContact: (c: Omit<EmergencyContact, 'id'> & { id?: string }) => {
      if (!c.name.trim()) return fail('Enter the contact’s name.')
      if (c.phone.replace(/\D/g, '').length < 7) return fail('Enter a valid phone number.')
      if (live) return app.run(async () => { await api.saveEmergencyContact(c) })
      const contact: EmergencyContact = { ...c, id: c.id ?? tempId('ec') }
      const others = (patient.emergencyContacts ?? []).filter(x => x.id !== contact.id)
      return patchSelf({
        emergencyContacts: contact.nextOfKin
          ? [contact, ...others.map(x => ({ ...x, nextOfKin: false }))]
          : [...others, contact],
      })
    },
    /** DELETE emergency_contacts */
    removeEmergencyContact: (id: string) => live
      ? app.run(() => api.removeEmergencyContact(id))
      : patchSelf({ emergencyContacts: (patient.emergencyContacts ?? []).filter(x => x.id !== id) }),

    /** PATCH patients.profile_setup */
    completeSetup: () => patchSelf({ profileSetup: 'done' }),
    /** Into the portal now; Home keeps a reminder to finish. What was already entered stays saved. */
    skipSetup: () => patchSelf({ profileSetup: 'skipped' }),
    /** Back to the setup steps from the Home reminder. */
    resumeSetup: () => patchSelf({ profileSetup: 'pending' }),

    /** RPC request_doctor — the people who can approve are told. */
    requestDoctor: (doctorId: string) => {
      const doc = doctorById(doctorId)
      if (!doc) return fail('That doctor is not available.')
      if (live) return app.run(() => api.requestDoctor(doctorId))
      app.getAdmins().filter(a => !a.isAssistant || a.permissions.includes('approve_patient_requests'))
        .forEach(a => app.notify(a.id, 'assignment', `Doctor request: ${patient.name}`, `Requested ${doc.name}`, 'assign'))
      return patchSelf({ doctorRequest: { doctorId, requestedAt: dateLabel(), status: 'pending' } })
    },

    /** The patient's rating of a doctor, if they gave one. */
    myRating: (doctorId: string) => app.ratings.find(r => r.patientId === patient.id && r.doctorId === doctorId),
    /** UPSERT doctor_ratings — only the doctor who treats this patient can be rated. */
    rateDoctor: (doctorId: string, rating: number, comment?: string) => {
      if (doctorId !== patient.assignedDoctorId) return fail('You can rate the doctor who treats you.')
      if (rating < 1 || rating > 5) return fail('Choose 1 to 5 stars.')
      return app.rateDoctor(patient.id, doctorId, rating, comment)
    },

    /** RPC doctor_rating_summary — the average and how many patients rated. Never who rated or what they wrote. */
    ratingSummary: async (doctorId: string): Promise<{ average: number | null; ratings: number } | null> => {
      if (live) return api.doctorRatingSummary(doctorId).catch(() => null)
      const all = app.ratings.filter(r => r.doctorId === doctorId)
      return { average: all.length ? Math.round((all.reduce((s, r) => s + r.rating, 0) / all.length) * 10) / 10 : null, ratings: all.length }
    },

    /** INSERT appointments */
    requestAppointment: (r: AppointmentRequest) => {
      if (!r.doctorId) return fail('Choose a doctor.')
      if (!r.title.trim()) return fail('Say what the visit is for.')
      if (!r.date) return fail('Choose a date.')
      if (r.date < dayKey()) return fail('Choose a date from today onwards.')
      if (live) return app.run(() => api.addAppointment({ patientId: patient.id, doctorId: r.doctorId, title: r.title, reason: r.reason, date: r.date, time: r.time, location: r.location }))
      const [h, m] = r.time ? r.time.split(':').map(Number) : []
      const appt: Appointment = {
        id: tempId('ap'), patientId: patient.id, doctorId: r.doctorId,
        title: r.title.trim(), reason: r.reason.trim(),
        preferredDate: new Date(`${r.date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        preferredTime: r.time ? `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : 'Any time',
        location: r.location?.trim() || undefined,
        status: 'requested', createdAt: dateLabel(), at: Date.now(),
      }
      return app.addAppointment(appt)
    },
    /** PATCH appointments — the patient's own appointments, newest request first. */
    appointments: app.appointments.filter(a => a.patientId === patient.id).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)),
    cancelAppointment: (id: string) => app.updateAppointment(id, { status: 'cancelled' }),
    /** Accepts the new time the doctor proposed. The database moves the appointment to it. */
    acceptNewTime: (a: Appointment) => app.updateAppointment(a.id, {
      status: 'approved', preferredDate: a.rescheduledTo ?? a.preferredDate, preferredTime: a.rescheduledTime ?? a.preferredTime,
    }),

    /** GET meal_plans, hydration_logs */
    todaysMeals,
    /** Glasses of water logged today. */
    waterToday: app.hydration.find(h => h.patientId === patient.id && h.day === dayKey())?.glasses ?? 0,
    /** UPSERT hydration_logs */
    setWater: (glasses: number) => app.setHydration(patient.id, glasses),

    /** GET report_requests — newest first. `ready` once the signed report can be opened in Documents. */
    reportRequests: app.reportRequests.filter(r => r.patientId === patient.id)
      .map(r => ({ ...r, ready: !!r.docId && !!app.getDocument(r.docId) })),
    /** INSERT report_requests — asks the care team for a signed vitals report. Fails without a doctor. */
    requestReport: (periodDays: number, reason: string) => app.requestReport(patient.id, periodDays, reason),

    /** RPC raise_sos / cancel_sos */
    raiseSos: (message: string) => app.raiseSOS(patient.id, message),
    cancelSos: (alertId: string) => app.resolveAlert(alertId, 'Patient marked safe'),

    /** POST auth logout (others) — ends this account's sessions on every other device. */
    signOutOtherDevices: () => live ? app.run(() => api.signOutOtherDevices()) : fail('Other devices are only tracked when mCare is connected to its backend.'),

    /** Ends the session on this device. */
    signOut: () => app.setCurrentUser(null),
  }
}

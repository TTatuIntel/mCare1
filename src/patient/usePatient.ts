/**
 * The patient portal's data layer.
 *
 * Every patient screen reads and changes the signed-in patient's record
 * through this hook — never through the store's generic `updateUser`, and
 * never by reading the full user list. That gives the portal one seam:
 * today the hook is backed by the in-memory store; when the API arrives each
 * member maps to one endpoint (noted beside it) and the screens don't change.
 *
 *   const { patient, doctor, status, error, reload, setTrackedVitals } = usePatient()
 */
import { useApp } from '@/shared/state/AppContext'
import type { LoadStatus } from '@/shared'
import type { AppUser, Appointment, DoctorUser, EmergencyContact, HealthProfile, PatientUser, AvatarSpec } from '@/shared/lib/types'
import { dateLabel } from '@/shared/lib/vitals'
import { backendConfigured } from '@/shared/api/supabase'
import {
  createAppointment, createReportRequest, deleteContact, replaceHealth, replaceTrackedVitals,
  requestDoctor as requestDoctorLive, saveContact, updatePatientProfile, updateProfile,
} from '@/shared/api/patientBackend'

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

let seq = 0
/** Temporary client id. The API will return the real id when the record is created. */
const tempId = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`

export function usePatient() {
  const app = useApp()
  const patient = app.currentUser as PatientUser

  const status: LoadStatus = backendConfigured
    ? app.patientLoadStatus === 'error' ? 'error' : app.patientLoadStatus === 'ready' ? 'ready' : 'loading'
    : 'ready'
  const error = app.patientLoadError
  const reload = app.reloadPatient
  const persist = (work: Promise<unknown>) => { void work.then(reload).catch(err => console.error('Patient record was not saved', err)) }

  /** PATCH /me — whitelisted fields only. */
  const patchSelf = (patch: SelfPatch) => app.updateUser(patient.id, patch as Partial<AppUser>)

  const doctorById = (id?: string): PublicDoctor | undefined => {
    const u = id ? app.users.find(x => x.id === id) : undefined
    return u?.role === 'doctor' ? toPublicDoctor(u as DoctorUser) : undefined
  }

  return {
    status, error, reload,

    /** GET /me */
    patient,
    /** GET /me/doctor */
    doctor: doctorById(patient.assignedDoctorId),
    doctorById,
    /** GET /doctors — approved, active clinicians a patient can ask for. */
    doctors: app.getDoctors().filter(d => d.status === 'active' && d.approvalStatus === 'approved').map(toPublicDoctor),
    /** Display name for anyone the patient's record mentions (prescriber, who resolved an alert…). */
    nameOf: (id: string | undefined, fallback = 'Your care team') => app.users.find(u => u.id === id)?.name ?? fallback,

    /** PUT /me/tracked-vitals */
    setTrackedVitals: (ids: string[]) => {
      const next = [...new Set(ids)]
      patchSelf({ trackedVitalIds: next })
      if (backendConfigured) persist(replaceTrackedVitals(patient.id, next))
    },

    /** PUT /me/health — optionally starts tracking vitals that a newly added condition calls for. */
    saveHealth: (health: HealthProfile, alsoTrack: string[] = []) => {
      const clean = { ...health, otherMedicines: health.otherMedicines?.trim() || undefined }
      const tracked = [...new Set([...patient.trackedVitalIds, ...alsoTrack])]
      patchSelf({ health: clean, ...(alsoTrack.length ? { trackedVitalIds: tracked } : {}) })
      if (backendConfigured) persist(Promise.all([replaceHealth(patient.id, clean), ...(alsoTrack.length ? [replaceTrackedVitals(patient.id, tracked)] : [])]))
    },

    /** PATCH /me — date of birth and profile picture. */
    saveAbout: (dob: string | undefined, avatar: AvatarSpec) => {
      patchSelf({ dob, avatar })
      if (backendConfigured) persist(updateProfile(patient.id, { dob: dob ?? null, avatar }))
    },

    /** POST /me/emergency-contacts — there is one next of kin, and they are listed first so SOS offers to call them. */
    saveEmergencyContact: (c: Omit<EmergencyContact, 'id'> & { id?: string }) => {
      const contact: EmergencyContact = { ...c, id: c.id ?? tempId('ec') }
      const others = (patient.emergencyContacts ?? []).filter(x => x.id !== contact.id)
      patchSelf({
        emergencyContacts: contact.nextOfKin
          ? [contact, ...others.map(x => ({ ...x, nextOfKin: false }))]
          : [...others, contact],
      })
      if (backendConfigured) persist(saveContact(patient.id, contact))
      return contact
    },
    /** DELETE /me/emergency-contacts/:id */
    removeEmergencyContact: (id: string) => {
      patchSelf({ emergencyContacts: (patient.emergencyContacts ?? []).filter(x => x.id !== id) })
      if (backendConfigured) persist(deleteContact(id))
    },

    /** POST /me/setup/complete */
    completeSetup: () => { patchSelf({ profileSetup: 'done' }); if (backendConfigured) persist(updatePatientProfile(patient.id, { profile_setup: 'done' })) },
    /** POST /me/setup/skip — into the portal now; Home keeps a reminder to finish. What was already entered stays saved. */
    skipSetup: () => { patchSelf({ profileSetup: 'skipped' }); if (backendConfigured) persist(updatePatientProfile(patient.id, { profile_setup: 'skipped' })) },
    /** POST /me/setup/resume — back to the setup steps from the Home reminder. */
    resumeSetup: () => { patchSelf({ profileSetup: 'pending' }); if (backendConfigured) persist(updatePatientProfile(patient.id, { profile_setup: 'pending' })) },

    /** POST /me/doctor-request — admins who can approve are told. */
    requestDoctor: (doctorId: string) => {
      const doc = doctorById(doctorId)
      if (!doc) return false
      patchSelf({ doctorRequest: { doctorId, requestedAt: dateLabel(), status: 'pending' } })
      if (backendConfigured) persist(requestDoctorLive(doctorId))
      app.getAdmins().filter(a => !a.isAssistant || a.permissions.includes('approve_patient_requests'))
        .forEach(a => app.notify(a.id, 'assignment', `Doctor request: ${patient.name}`, `Requested ${doc.name}`, 'assign'))
      return true
    },

    /** POST /appointments */
    requestAppointment: (r: AppointmentRequest) => {
      if (!r.title.trim() || !r.date || !r.doctorId) return false
      const [h, m] = r.time ? r.time.split(':').map(Number) : []
      const appt: Appointment = {
        id: tempId('ap'), patientId: patient.id, doctorId: r.doctorId,
        title: r.title.trim(), reason: r.reason.trim(),
        preferredDate: new Date(`${r.date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        preferredTime: r.time ? `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : 'Any time',
        location: r.location?.trim() || undefined,
        status: 'requested', createdAt: dateLabel(),
      }
      app.addAppointment(appt)
      if (backendConfigured) persist(createAppointment(appt, r.date, r.time))
      return true
    },

    /** GET /me/report-requests — newest first. `ready` once the signed report can be opened in Documents. */
    reportRequests: app.reportRequests.filter(r => r.patientId === patient.id)
      .map(r => ({ ...r, ready: !!r.docId && !!app.getDocument(r.docId) })),
    /** POST /me/report-requests — asks the care team for a signed vitals report. False without a doctor. */
    requestReport: (periodDays: number, reason: string) => {
      const ok = app.requestReport(patient.id, periodDays, reason)
      if (ok && backendConfigured && patient.assignedDoctorId) persist(createReportRequest(patient.id, patient.assignedDoctorId, periodDays, reason.trim()))
      return ok
    },

    /** POST /auth/logout */
    signOut: () => app.setCurrentUser(null),
  }
}

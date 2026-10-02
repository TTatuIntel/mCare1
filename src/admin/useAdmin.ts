/**
 * The staff portal's data layer (admins and mCare assistants).
 *
 * Every admin screen reads and changes the record through this hook, never
 * through the store's generic `updateUser`. Staff work across people rather
 * than on one record, so the lists here are whole lists; what is in them is
 * what the database allowed this person to load. An assistant without
 * "Monitor patients" simply receives no readings or alerts, whatever a screen
 * asks for.
 *
 * `can()` tells a screen which controls to show. It is a courtesy, not the
 * rule: the database checks the same permission again on every request, and
 * refuses with a sentence the screen shows as it is.
 *
 * Every action resolves with `{ ok: true }` or `{ ok: false, error }`.
 * Nothing throws.
 *
 *   const { admin, can, patients, status, error, reload, assignDoctor } = useAdmin()
 */
import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import { useLoadStatus } from '@/shared/state/useLoadStatus'
import type { AdminUser, AppUser, AssistantPerm, DoctorUser, PatientUser } from '@/shared/lib/types'
import { can as allowed, isFullAdmin } from '@/assistant/permissions'

export function useAdmin() {
  const app = useApp()
  const admin = app.currentUser as AdminUser
  const load = useLoadStatus()

  const patients = app.getPatients()
  const doctors = app.getDoctors()
  const person = (id: string | undefined | null): AppUser | undefined => app.users.find(u => u.id === id)

  return {
    ...load,
    admin,
    now: app.now,
    /** A full admin; assistants hold only the permissions granted to them. */
    full: isFullAdmin(admin),
    /** Whether this person holds any one of these permissions (a full admin holds them all). */
    can: (...perms: AssistantPerm[]) => allowed(admin, ...perms),

    /* ── people ── */
    /** GET profiles, patients, doctors, staff */
    people: app.users,
    patients,
    doctors,
    staff: app.getAdmins(),
    person,
    patient: (id: string | undefined | null) => patients.find(p => p.id === id) as PatientUser | undefined,
    doctor: (id: string | undefined | null) => doctors.find(d => d.id === id) as DoctorUser | undefined,
    nameOf: (id: string | undefined | null, fallback = 'Someone') => person(id)?.name ?? fallback,
    /** Approved, active doctors a patient can be assigned to, lightest load first. */
    assignableDoctors: doctors.filter(d => d.approvalStatus === 'approved' && d.status === 'active')
      .sort((a, b) => a.assignedPatientIds.length - b.assignedPatientIds.length),
    /** GET account_invitations: registered in advance, not signed up yet. */
    invitations: app.invitations,

    /* ── oversight ── */
    /** GET vital_defs */
    vitalDefs: app.vitalDefs,
    /** GET alerts */
    alerts: app.alerts,
    activeAlerts: app.alerts.filter(isActiveAlert),
    /** GET appointments, appointment_events */
    appointments: app.appointments,
    /** GET audit_log: the newest entries, as loaded with the record. */
    audit: app.audit,
    /** RPC search_audit: one page of the whole trail, by words, by person and by kind of person. */
    searchAudit: app.searchAudit,
    /** GET care_assignments: who treated a patient, and when. */
    assignmentsOf: (patientId: string) => app.careAssignments.filter(a => a.patientId === patientId),
    /** GET doctor_time_off */
    timeOffOf: (doctorId: string) => app.timeOff.filter(o => o.doctorId === doctorId),
    /** RPC admin_report: counts for a period. */
    report: app.adminReport,
    /** RPC delivery_report: emails, text messages and push sent and failed over a period. */
    deliveryReport: app.deliveryReport,
    /** GET support_tickets */
    supportTickets: app.supportTickets,

    /* ── accounts ── */
    /** RPC invite_account: they get this role when they sign up with this email. */
    invite: app.inviteUser,
    /** RPC revoke_invitation */
    withdrawInvitation: app.revokeInvitation,
    /** RPC set_account_status: active, suspended or deactivated, with the reason. The database refuses to leave mCare without an admin, or patients with a doctor who cannot open their record. */
    setStatus: app.setUserStatus,
    /** UPDATE staff.permissions (full admin only): audited, and the assistant is told. */
    setPermissions: app.updateAssistantPerms,
    /** RPC decide_doctor: approve, send back or reject a doctor's application. */
    decideDoctor: app.decideDoctor,

    /* ── care coordination ── */
    /** RPC assign_doctor: assign, move or (with `null` and a reason) remove a patient's doctor. Everyone involved is told; the history is kept. */
    assignDoctor: app.assignPatientToDoctor,
    /** RPC admin_update_appointment: support moves or cancels a visit, with the reason. */
    updateAppointment: app.adminUpdateAppointment,
    /** RPC doctor_availability: the open times of a doctor on a day. */
    availabilityFor: app.availabilityFor,
    /** RPC decide_doctor_request: approve, or decline and assign someone else. */
    answerDoctorRequest: app.resolvePatientRequest,
    /** RPC chase_alert: asks the treating doctor to respond to an open alert. */
    chaseDoctor: app.chaseDoctor,
    /** RPC log_patient_view: opening one patient's vitals is recorded in the audit trail. */
    logPatientView: app.logPatientView,

    /* ── configuration ── */
    /** UPSERT vital_defs (full admin only) */
    saveVitalDef: app.saveVitalDef,

    /* ── support ── */
    /** UPDATE support_tickets */
    resolveTicket: app.resolveSupportTicket,
  }
}

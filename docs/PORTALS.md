# Portals

What each portal does, which screen does it, and which tables and database functions sit behind it. Status per feature is in [STATUS.md](STATUS.md); every file is listed in [AGENTS.md §6](../AGENTS.md#6-code-map).

`src/App.tsx` picks the portal for the signed-in person by role (and shows `SharedDocuments` for a `?share=<token>` link, or the sign-in screens when nobody is signed in). Every portal renders inside `PortalShell`; profile opens from the header avatar.

**Navigation pattern (all portals).** `<Role>App.tsx` holds `NAV` (the tabs in the bar), `SCREENS` (every screen id, tabs and off-nav), a `go(screen, target?)` function and a `badge` record. A notification's `link` is a screen id; its `resource` is the record to open (`NotificationBell` → `onNavigate`). To add a screen: create the file, add its id to `SCREENS` (and `NAV` if it is a tab), render it in the switch, and, in the admin portal, add it to `ADMIN_TABS`, `NAV_ITEMS` and, if gated, `TAB_PERMS` in `src/assistant/permissions.ts`.

## Patient (`src/patient/`, data through `usePatient()`)

Tabs: Home (`home`) · Vitals (`vitals`) · Meds (`medicine`) · Chat (`messages`) · Appts (`appts`). Off-nav: `docs`, `profile`, `meals`, `care`, `alerts`. The floating "Log vitals" button (`QuickLogFab`) shows on `home`, `alerts`, `vitals`.

| Feature | Screen(s) | What works |
| --- | --- | --- |
| Sign-up, sign-in, sessions | `src/shared/auth/*` | Account creation (the form names every missing field), consent recorded on the server, session kept across reloads, password change (other devices signed out), "sign out of all other devices", reset by emailed code. |
| First-run health setup | `HealthSetup`, `healthForms` | Each step saved before the next opens; can be skipped and resumed. |
| Home | `HomeTab`, `VitalsStrip`, `ReminderSheet` | Health score, up-next ticker, reminders, recent readings, doctor's latest note, open alerts with a Re-measure button. |
| Vitals | `VitalsTab`, `VitalDetail`, `VitalLogSheets`, `QuickLogFab` | Log one, a group or all; validation before saving; server grading; trends, history, filters; unit choice saved; a typo corrected within 15 minutes, first value kept. |
| Alerts | `MyAlertsTab`, `alertKit` | Raised by the database; "send to doctor now"; Re-measure on every open alert, with the result explained (cleared, still out of range, waiting for the doctor); status steps; the full story of each alert. |
| SOS | `SosSheet` | Sent to the doctor and care team; "I'm safe now"; if it cannot be sent the patient is told and the call buttons stay. |
| Medication | `MedicineTab`, `useDaySchedule` | Active prescriptions, dose times, tick and un-tick; stopped medicines kept as history. |
| Meals | `MealsTab` | The doctor's plan when there is one, else the standard plan; meals and water logged per day. |
| Appointments | `AppointmentsTab` | Request with validation against the doctor's hours; upcoming and history; withdraw or cancel; accept a proposed time. |
| Care team | `CareTeamTab`, `DoctorProfileSheet` | Assigned and consulting doctors, care plans, directory, request a doctor (one pending), doctor profile, rating. |
| Messages | `MessagesTab` (shared `Inbox`, `ChatThread`) | One private thread with the treating doctor and one with each current consulting doctor; former doctors' threads stay read-only; an unsent message stays in the box with the reason. |
| Documents | `DocsTab`, `ReportRequest`, shared `documents/*` | Official documents once released; upload with type and content checks; view, download, zip; private or shared; delete and restore; access history; share link for report content; ask for a signed vitals report. |
| Notifications | shared `NotificationBell`, `NotificationsSheet` | Written by the database; mark one or all read; choose email, SMS and push. |
| Profile, privacy | `ProfileTab`, `HealthEditSheet`, `EmergencyContacts`, shared `profile/*` | Details and photo; health profile; emergency contacts (one next of kin); who can see the record; consent; deactivate account. |
| Failure states | `PortalShell`, `Page` | Every form shows busy and error states; a banner says when mCare cannot be reached and how old the data is. Nothing claims to be saved before it is. |

## Doctor (`src/doctor/`, data through `useDoctor()`)

Tabs: Home (`dashboard`) · Patients (`patients`) · Chat (`messages`) · Appts (`appts`) · Alerts (`alerts`); Profile from the avatar. `useDoctor()` returns data already narrowed to this doctor: `patients` (treated), `consulting` (patients they consult on), and actions. `useBoard()` (patients by risk) and `useVisits()` (appointments) are built on it. One patient's record: `PatientDetail.tsx` is the frame (sections: vitals, meds, care plan, nutrition, notes, docs), each part its own file. A consulted patient opens in `ConsultView` (read only).

| Feature | Screen | Tables and functions | History kept |
| --- | --- | --- | --- |
| Dashboard: patients by risk, alerts, reports to sign, requests, today's visits | `DashboardTab` | the doctor's own records | |
| Patient list; past patients (name and dates only) | `PatientsTab`, `PatientChips` | `patients`, `my_past_patients()` | `care_assignments` |
| Readings and trends; record a clinic reading; mark one invalid | `PatientVitals` | `readings` | recorder, `invalidated_by/at`, audit |
| Tracked vitals, target and critical ranges | `PatientVitals` | `set_tracked_vitals()`, `thresholds` | `threshold_changes` |
| Alerts: acknowledge, escalate, ask for a re-measurement, see it arrive, comment / action / instruction without resolving, resolve (or "resolve with this reading"), book a follow-up | `AlertsTab`, `AlertCard`, shared `ResolveAlertSheet` | `alerts`, `alert_comments`, `alert_remeasures`, `schedule_follow_up()` | the alert's steps, comments and re-measurements |
| Prescribe; stop with a reason or restart | `PatientMeds` | `prescriptions` | `prescription_events` |
| Clinical notes (shared or internal); correct a note | `PatientNotes` | `clinical_notes` | append-only |
| Care plan: goals, interventions, steps, progress | `PatientCarePlan` | `save_care_plan()`, `set_care_plan_status()` | `care_plan_events` |
| Meal plan | `PatientNutrition` | `meal_plans` | audit |
| Appointments: confirm, decline, propose, complete, no-show, cancel, book | `AppointmentsTab`, `useVisits` | `appointments` | `appointment_events` |
| Working hours, visit length, days away | `AvailabilityCard` (Profile) | `set_doctor_hours()`, `doctor_time_off` | audit |
| Messages: one private thread per treated or consulted patient; former patients read-only; the Chat badge counts unread from both | `MessagesTab`, shared `Inbox` | `messages` | never edited |
| Documents and reports: upload, build a vitals report (with the period's abnormal readings, their re-measurements and resolutions, which can be commented on or resolved from the builder), sign, release, correct | `PatientDocs`, `ReportBuilderSheet`, shared `DocumentViewer` | `documents`, `sign_document()`, `release_document()`, `correct_document()` | versions, `document_events` |
| Care team: add or remove a consulting doctor; read a consulted patient | `PatientDetail`, shared `CareTeamCard`, `ConsultView` | `care_team_members` | audit |
| Signature (stamped on signed reports) | shared `SignatureSheet` (Profile) | `doctors.signature` | |

Rules: access is the assignment (reassignment moves it in the same transaction; a patient no longer theirs shows "no longer under your care"); a new treating doctor can stop a predecessor's medicine but not delete it; a doctor's own bookings are not held to their timetable, a patient's request is. A doctor whose account is `pending_approval` sees `DoctorStatusScreen` instead of the portal.

## Admin and assistant (`src/admin/`, `src/assistant/`, data through `useAdmin()`)

Tabs (`ADMIN_TABS` in `AdminApp.tsx`): `dashboard` · People: `approvals`, `assign`, `users` · Clinical: `alerts`, `vitals`, `appointments` · System: `support`, `documents`, `audit`, `reports` · `profile`. Entries marked `webOnly` show in the web sidebar; on phones they open from the dashboard.

`AssistantApp.tsx` renders the same portal with `canOpenTab()` as the gate. Permissions live in `staff.permissions` and are enforced by `staff_can()`; `can()` only decides what to show. An admin is not a clinician: no screen prescribes, sets a target, signs a document or writes a note.

| Feature | Screen | Needs | Functions |
| --- | --- | --- | --- |
| Dashboard | `DashboardTab`, `PermissionsCard` (assistant) | per tile | |
| Approve, send back or reject a doctor | `ApprovalsTab` | Approve doctors | `decide_doctor()` |
| Register a person in advance; withdraw it | `UsersTab` | Create users (staff roles: admin only) | `invite_account()`, `revoke_invitation()` |
| Find, suspend, deactivate, reactivate (with a reason); assistant permissions | `UsersTab` | admin only for status and permissions | `set_account_status()` |
| Assign, move or remove a doctor; history; consulting doctors | `AssignTab`, `PatientAssignmentView`, `DoctorPicker` | Assign healthworkers | `assign_doctor()`, `add_consulting_doctor()` |
| Answer a patient's request for a doctor | `PatientAssignmentView` | Approve patient requests | `decide_doctor_request()` |
| Alert monitor: chase the doctor, work and resolve alerts, close an SOS | `AlertsMonitorTab` | Monitor patients | `chase_alert()`, `alerts` |
| Vital definitions | `VitalsTab` | admin only | `vital_defs` |
| A patient's latest readings (the view is audited) | `PatientThresholdView` | Monitor patients | `log_patient_view()` |
| Appointments: find, move, cancel | `AppointmentsTab` | Monitor patients / Handle support | `admin_update_appointment()` |
| Support requests | `SupportTab` | Handle support | `support_tickets` |
| Documents: registry, recovery, purge, support access | `DocumentsTab` | Document support; content: admin only | `document_registry()`, `staff_restore_document()`, `request_support_access()` |
| Audit log: search, filter, page, export | `AuditTab` | View audit logs | `search_audit()` |
| Report: accounts, waiting work, alerts, appointments, activity, workload, delivery by channel | `ReportsTab` | View audit logs | `admin_report()`, `delivery_report()` |

Rules: the audit trail is written by the database with the author's role, the record and before/after, and nobody can change it; stopping an account needs a reason and is refused for yourself, the last active admin and a doctor with patients; removing a patient's doctor without a replacement needs a reason; an admin moving an appointment is still checked against the doctor's hours; a role is not edited (register the person again).

## Signed out (`src/shared/auth/`)

`WelcomeScreen` (feature tour in `AuthShell`, "Get started", demo entry in demo mode) → `SelfRegisterScreen` (patients only; a doctor or staff member joins by invitation, `invite_account()`, then signs up with that email and gets the invited role; a doctor waits in `DoctorStatusScreen` until approved) → live: `LiveAuth` `ConfirmEmail`; demo: `VerificationScreen`. `LoginScreen` → `ForgotPassword` (demo) or `LiveRecovery` (live). `SocialAuth` is hidden unless a hosted project has providers. `SuspendedScreen` for a stopped account. `Legal` holds the consent text (placeholder: replace before launch).

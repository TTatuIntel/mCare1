# The admin module (admins and mCare assistants)

The operational workspace: people, assignments, oversight, support and the audit trail. It works on the same records as the other portals; see [data-flow.md](data-flow.md). An admin is not a clinician here: no screen prescribes, sets a target, signs a document or writes a note.

## How it is built

- **Screens**: `src/admin/`. `AdminApp.tsx` holds the tabs. `src/assistant/AssistantApp.tsx` renders the same portal with `canOpenTab()` as the gate, so an assistant sees only the screens their permissions open.
- **Data layer**: `useAdmin()` (`src/admin/useAdmin.ts`): the lists, `can(permission)` and one named action per change.
- **Permissions** are stored in `staff.permissions` and enforced by `staff_can()` in the database. `can()` only decides what to show. Where one screen needs two permissions (Care Assignments: assigning a doctor, and answering a patient's request), each control follows its own.

## What staff can do

| Feature | Screen | Needs | Tables and functions | Effect on others |
| --- | --- | --- | --- | --- |
| Dashboard: what is true now and what is waiting | `DashboardTab` | per tile | counted from loaded records | |
| Approve, send back or reject a doctor | `ApprovalsTab` | Approve doctors | `decide_doctor()` | the doctor is told; approval activates the account |
| Register a person in advance; withdraw it | `UsersTab` | Create users (staff roles: admin only) | `invite_account()`, `revoke_invitation()` | they get the role when they sign up with that email |
| Find people by name, email, phone, role, status | `UsersTab` | Create users or Assign healthworkers | `profiles` | |
| Suspend, deactivate, reactivate, with a reason | `UsersTab` | admin only | `set_account_status()` | the account is refused at once; the person is told |
| Grant or remove an assistant's permissions | `UsersTab` | admin only | `staff.permissions` | the assistant is told |
| Assign, move or remove a patient's doctor; read the history | `AssignTab`, `PatientAssignmentView` | Assign healthworkers | `assign_doctor()`, `care_assignments` | patient and both doctors are told; access moves at once |
| Answer a patient's request for a doctor | `PatientAssignmentView` | Approve patient requests | `decide_doctor_request()` | patient is told; declining assigns another doctor |
| Alert monitor: chase the doctor, reassign, close an SOS with a reason | `AlertsMonitorTab` | Monitor patients | `chase_alert()`, `alerts` | doctor or patient is told |
| Vital definitions (standard ranges, which vitals are collected) | `VitalsTab` | admin only | `vital_defs` | applies where a doctor set no personal range |
| A patient's latest readings, for oversight | `PatientThresholdView` | Monitor patients | `log_patient_view()` | the view itself is audited |
| Find an appointment; move or cancel it for someone | `AppointmentsTab` | read: Monitor patients or Handle support. Change: Handle support | `admin_update_appointment()` | patient and doctor are told; a line in its history |
| Support requests: answer and close | `SupportTab` | Handle support | `support_tickets` | the person who asked is told |
| Documents: registry (metadata only), recovery, purge; open one for a support case | `DocumentsTab` | Document support; opening content: admin only | `document_registry()`, `staff_restore_document()`, `request_support_access()` | the patient is told when a document is opened |
| Audit log: search the whole trail in the database, filter by who, page back, export | `AuditTab` | View audit logs | `search_audit()` | |
| A patient's care team: add or remove a consulting doctor | `PatientAssignmentView`, shared `CareTeamCard` | Assign healthworkers | `add_consulting_doctor()`, `remove_consulting_doctor()` | the doctor and the patient are told |
| Report: accounts, what is waiting, alerts, appointments, activity, doctor workload; export | `ReportsTab` | View audit logs | `admin_report()` | counts only |

## Rules worth knowing

- **The audit trail is written by the database**, in the same transaction as the change, with the author's role, the record it is about, and before and after where that applies. Nobody, at any level, can add, edit or delete an entry.
- **Stopping an account** needs a reason, cannot be done to yourself, cannot leave mCare with no active admin, and is refused for a doctor who still has patients (move them first). Nothing the person did is deleted.
- **Removing a patient's doctor** without assigning another needs a reason.
- **An admin moving an appointment** is still checked against the doctor's hours and against other confirmed visits.
- **Clinical privacy**: an admin sees readings and alerts for oversight, never private messages, internal notes, or a document's content without a reasoned, time-limited grant that the patient is told about.
- **A role is not edited.** To change what someone is, register them again with the role they need.

## Checks

- `supabase/tests/rules.test.mjs` and `api.test.mjs`: every action above as an admin, as an assistant with and without the permission, and as a patient or doctor trying it.
- `supabase/tests/ui.test.mjs`: in a browser, the admin registers a user, reads the audit log and the document registry, assigns a doctor, answers a support request, suspends an account (and the database then refuses that person) and opens the report; an assistant is shown only their permitted screens; every screen at phone, tablet and laptop width.

## Not done

- Every notification is queued as an email; on a hosted project it is sent by `supabase/functions/deliver` once a Resend key is set (not yet run against a hosted project). Invitations are not emailed: the admin tells the person to sign up.
- Admins and assistants have no messaging. A person reaches the mCare team through a support request.
- There is no screen for system-wide settings other than vital definitions.
- Backups are the hosting service's; the app has no backup tool in live mode.

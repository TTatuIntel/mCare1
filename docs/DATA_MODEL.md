# Data model and ownership

Who a person is, who owns each record, who may do what, and how a change travels. The tables themselves (keys, constraints, triggers, functions) are in [DATABASE.md](DATABASE.md).

> A record exists once, under one ID, in one database. Each role sees and changes it through its own screens, the database decides what each may do, and every change is audited and reaches the other roles.

## Identity

One person is one sign-in account (`auth.users`) and one `profiles` row with the same ID. The role is a column on that row, not a second identity.

| Table | Keyed by | Holds |
| --- | --- | --- |
| `profiles` | `id` = the account | name, contact, role, status (who changed it, when, why), notification channels |
| `patients` | `id` → `profiles.id` | the treating doctor, health facts, preferences |
| `doctors` | `id` → `profiles.id` | specialty, licence, approval, signature, visit length |
| `staff` | `id` → `profiles.id` | whether an assistant, and which permissions |

Relationships are always by ID; a name is only looked up for display.

Account status: `pending_approval` (a doctor not yet approved), `active`, `suspended` (by an administrator, with a reason), `deactivated` (closed by the person, or by an administrator). A stopped account keeps its record and history and can be made active again. "Invited" is an open row in `account_invitations`: there is no account yet. (`unverified` is also in the `account_status` enum: signed up, email not yet confirmed, used by demo mode.)

## Who owns each record

"Created by" and "changed by" name the role the database allows; everyone else is refused whatever a screen sends.

| Record (table) | Belongs to | Created by | Changed by | Read by | Kept |
| --- | --- | --- | --- | --- | --- |
| Assignment (`patients.assigned_doctor_id`, `care_assignments`) | patient | care coordinator | care coordinator | patient, the doctors named, coordinators, monitors | every assignment is a row with start, end, who and why |
| Consulting doctor (`care_team_members`) | patient | treating doctor, coordinator | either side ends it | patient, the doctors, coordinators | the row is kept |
| Reading (`readings`) | patient | patient, treating doctor | recorder, for 15 minutes; doctor marks invalid | patient, treating and consulting doctors, monitors | never deleted; first value and who invalidated it are kept |
| Target and critical range (`thresholds`) | patient | treating doctor | treating doctor | patient, doctors, monitors | `threshold_changes` |
| Alert (`alerts`) | patient | the database only | treating doctor, monitors (steps only) | patient, doctors, monitors | never deleted; a resolved alert cannot be edited |
| Re-measurement (`alert_remeasures`) | patient | the database only | nobody | patient, doctors, monitors | a link from the alert to the reading; the reading is never copied |
| Alert comment (`alert_comments`) | patient | treating doctor, monitors | nobody: a correction is a new comment | patient, doctors, monitors | append-only |
| Prescription (`prescriptions`) | patient | treating doctor | treating doctor (stop, restart only) | patient, doctors, monitors | never deleted; `prescription_events` |
| Dose, meal, water logs | patient | patient | patient | patient, doctors, monitors | |
| Clinical note (`clinical_notes`) | patient | treating doctor | nobody: a correction is a new note | shared: patient, doctors, monitors. Internal: treating doctor only | append-only |
| Care plan (`care_plans`, `care_plan_items`) | patient | treating doctor | treating doctor | treating doctor; patient, consulting doctors and monitors once it has left draft | `care_plan_events`; a closed plan is frozen |
| Appointment (`appointments`) | patient and doctor | patient (request), doctor (booking) | patient (cancel, accept), doctor (answer, complete), support (move, cancel) | patient, the doctor, admins, monitors, support | `appointment_events` |
| Availability (`doctor_hours`, `doctor_time_off`) | doctor | doctor | doctor | hours: everyone signed in. Why a doctor is away: the doctor and staff | |
| Message (`messages`) | one patient–doctor pair | patient, or a current treating or consulting doctor of that patient | receiver marks read | only the two people in that pair | cannot be edited; an ended relationship keeps its thread read-only |
| Document (`documents`) | patient | patient (upload), treating doctor (official) | owner; doctor signs, releases, corrects | see `can_open_document` | `document_events`; soft delete, versions |
| Notification (`notifications`) | the recipient | the database only | recipient marks read | recipient | each is queued for delivery |
| Push device (`push_subscriptions`) | the person | the person | the person | the person | |
| Support request (`support_tickets`) | the person asking | anyone | support staff answer it once | the person, support staff | |
| Audit entry (`audit_log`) | mCare | the database only | nobody | staff with "View audit logs" | append-only |

## Who may do what

- **Patient**: their own rows (`patient_id = auth.uid()`).
- **Treating doctor**: patients assigned to them, while approved and active (`treats()`). Losing the assignment removes access at once; the former doctor keeps the patient's name and the dates only (`my_past_patients()`).
- **Consulting doctor**: reads a patient whose care team they are on (`consults()`, which widens `can_see_patient()`); cannot change clinical records. They may exchange private one-to-one messages with that patient while the care-team membership is open. Internal notes, documents and other pairs' messages stay out of reach.
- **Admin**: everything administrative. For clinical content, what "Monitor patients" gives; a document's content needs a time-limited, reasoned support grant and the patient is told. Never private messages or internal notes.
- **Assistant**: only what `staff.permissions` holds, checked by `staff_can()` in the database. The portal hides what a permission does not open; that is a courtesy, not the rule.

| Action | Patient | Doctor | Admin | Assistant |
| --- | --- | --- | --- | --- |
| Read a patient's record | own | assigned (and consulted) patients | with "Monitor patients" scope | with "Monitor patients" |
| Record a reading | own | assigned patients | no | no |
| Prescribe, set targets, write notes, care plans | no | assigned patients | no | no |
| Work an alert (acknowledge, comment, resolve) | cancel own SOS | assigned patients | yes | with "Monitor patients" |
| Assign or remove a doctor | request one | no | yes | with "Assign healthworkers" |
| Answer a patient's doctor request | no | no | yes | with "Approve patient requests" |
| Request / book an appointment | request | book for own patients | no | no |
| Move or cancel someone's appointment | own: cancel | own: all steps | yes | with "Handle support" |
| Approve a doctor | no | no | yes | with "Approve doctors" |
| Register a person | no | no | yes | patients and doctors, with "Create users" |
| Suspend, deactivate, reactivate; grant permissions | close own | close own | yes | no |
| Read the audit log and the report | no | no | yes | with "View audit logs" |
| Message | current treating and consulting doctors, one private thread each | assigned and consulted patients, one private thread each | no | no |

Assistant permission keys (`AssistantPerm` in `src/shared/lib/types.ts`, checked by `staff_can()` in `0002_helpers.sql`): `approve_doctors`, `create_users`, `view_logs`, `assign_healthworkers`, `approve_patient_requests`, `handle_support`, `monitor_patients`, `document_support`.

Every refusal in this table is tested in `supabase/tests/rules.test.mjs`, as the role concerned.

## The path of every change

```text
person acts
  → the form checks what it can (required fields, ranges)
  → one request to the API, as the signed-in person
  → the database checks the session, the account status and the row rule
  → validates the values (constraints, triggers)
  → in one transaction: the change, its history line, the audit entry, the notifications
  → the answer: saved, or a sentence saying why not
  → the screen shows that answer, and reloads the record
  → other open screens learn the record changed, and reload
```

In code: screen → portal hook (`usePatient` / `useDoctor` / `useAdmin`) → `AppContext` action → `run(() => api.x())` → `src/shared/api/actions.ts` → Supabase → `loadRecords()` in `src/shared/api/records.ts` reloads.

## How other screens find out

The database counts changes: `patient_changes` has one row per patient, bumped by a trigger on every table that belongs to a patient, and `system_changes` one row per shared list (`people`, `settings`). `my_change_token()` turns the rows a person may see into one short value.

- **Hosted Supabase**: the two tables are published for Realtime; the app subscribes and reloads when told.
- **Everywhere, including the local backend**: the app asks for the token every 15 seconds, on returning to the tab and on reconnecting, and reloads when it differs.

The counters say only that something changed; what is then loaded is still decided by each table's row rules.

## Workflows

**Patient records a vital.** The database stamps the time and recorder, validates and grades the reading against the patient's target and critical range, raises an alert if it must and notifies the doctor and monitors; the change counter moves and the doctor's open portal reloads.

**Abnormal reading is re-measured.** The patient taps Re-measure on the alert (Home, My Alerts, the vital's page, the quick-log button) and saves a reading → the database links it to the open alert for that vital (`alert_remeasures`) and grades it:
- in range, on a warning: the alert is resolved (`resolved_how = 'remeasure'`) and both sides are told;
- in range, on a critical alert: it goes back to the doctor, who closes it ("Resolve with this reading");
- still out of range: the same alert stays open (no second alert, severity raised if it is now critical) and the patient is told to contact the doctor.

The doctor can ask for a re-measurement, add a clinical comment, an action taken or a follow-up instruction at any point (`alert_comments`), and resolves with a reason. `alertStory()` in `lib/vitals` turns the alert, its re-measurements, comments and resolution into the one sequence that My Alerts, the resolve sheet, the patient record and the printed report all show.

**Doctor prescribes.** `INSERT prescriptions` (refused unless `treats()`) → the trigger writes the history line, files the prescription as a released document, notifies the patient and audits it, in one transaction.

**Admin assigns a doctor.** `assign_doctor(patient, doctor, reason)` → checks the permission and that the doctor is approved and active → ends the open assignment and starts the new one → both doctors and the patient are told, any pending request closes, the audit entry carries before and after → access moves in the same instant.

**Appointment.** Patient requests (checked against the doctor's hours and days away) → doctor confirms, declines or proposes a time → patient accepts → doctor completes it or records a missed visit. Support may move or cancel it with a reason both read. Each step is a line in `appointment_events`; it is one row throughout.

**Messages.** A conversation is every `messages` row between two people (`lib/messaging.ts`), shown by the same `Inbox` and `ChatThread` in the patient and doctor portals. A patient has a separate private thread with their current treating doctor and with each current consulting doctor. Only those two participants can read that pair's messages; the treating doctor, staff and other consultants cannot see another pair's thread. Once an assignment or consulting membership ends, both participants keep the old thread to read but cannot send new messages. A message's notification names the conversation, so a tap opens the thread. Staff neither message nor read messages: people reach the mCare team through a support request. Rule: `messages_send` policy (`0011_patient_doctor_messages.sql`); demo-mode mirror: `sendMessage` in `AppContext.tsx`.

**Consulting doctor.** The treating doctor (or a coordinator) adds another approved doctor to the care team; that doctor reads the record and every clinical change from them is refused (they may message the patient). Either side can end it; access ends at once and the row is kept. A consulting doctor who becomes the treating doctor stops being listed as consulting.

**Account suspended.** `set_account_status(person, 'suspended', reason)` → refused for yourself, for the last active admin and for a doctor who still has patients → from that moment every table refuses that account, on the session it already holds → the person is told; their records stay.

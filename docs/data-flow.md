# mCare data map: one record, many authorised views

The rule everything else follows:

> A record exists once, under one ID, in one database. Each role sees and changes it through its own screens, the database decides what each may do, and every change is audited and reaches the other roles.

There is no patient database, doctor database or admin database. `src/patient`, `src/doctor`, `src/admin` and `src/assistant` are four sets of screens over the same rows.

For the tables, keys and policies see [database.md](database.md). For each portal see [patient-module.md](patient-module.md), [doctor-module.md](doctor-module.md) and [admin-module.md](admin-module.md).

## 1. Identity

One person is one sign-in account (`auth.users`) and one `profiles` row with the same ID. The role is a column on that row, not a second identity. Role-specific facts hang off the same ID:

| Table | Keyed by | Holds |
| --- | --- | --- |
| `profiles` | `id` = the account | name, contact, role, status (who changed it, when, why) |
| `patients` | `id` → `profiles.id` | the treating doctor, health facts, preferences |
| `doctors` | `id` → `profiles.id` | specialty, licence, approval, signature, visit length |
| `staff` | `id` → `profiles.id` | whether an assistant, and which permissions |

Relationships are always by ID. A name is only ever looked up for display, so renaming someone changes nothing else.

Account status: `pending_approval` (a doctor not yet approved), `active`, `suspended` (by an administrator, with a reason), `deactivated` (closed by the person, or by an administrator when someone has left). A stopped account keeps its record and its history and can be made active again. "Invited" is an open row in `account_invitations`: there is no account yet. Locking after failed sign-ins belongs to the sign-in service.

## 2. Who owns each record

"Creates" and "changes" name the role the database allows; everyone else is refused whatever a screen sends. "Kept" says what happens instead of deletion.

| Record (table) | Belongs to | Created by | Changed by | Read by | Kept |
| --- | --- | --- | --- | --- | --- |
| Assignment (`patients.assigned_doctor_id`, `care_assignments`) | patient | care coordinator | care coordinator | patient, the doctors named, coordinators, monitors | every assignment is a row with start, end, who and why |
| Reading (`readings`) | patient | patient, treating doctor | recorder, for 15 minutes; doctor marks invalid | patient, treating doctor, monitors | never deleted; first value and who invalidated it are kept |
| Target and critical range (`thresholds`) | patient | treating doctor | treating doctor | patient, treating doctor, monitors | `threshold_changes` |
| Alert (`alerts`) | patient | the database only | treating doctor, monitors (steps only) | patient, treating doctor, monitors | never deleted; a resolved alert cannot be edited |
| Re-measurement (`alert_remeasures`) | patient | the database only | nobody | patient, treating doctor, monitors | a link from the alert to the reading; the reading is never copied |
| Alert comment (`alert_comments`) | patient | treating doctor, monitors | nobody: a correction is a new comment | patient, treating doctor, monitors | append-only |
| Prescription (`prescriptions`) | patient | treating doctor | treating doctor (stop, restart only) | patient, treating doctor, monitors | never deleted; `prescription_events` |
| Dose, meal, water logs | patient | patient | patient | patient, treating doctor, monitors | |
| Clinical note (`clinical_notes`) | patient | treating doctor | nobody: a correction is a new note | shared: patient, doctor, monitors. Internal: treating doctor only | append-only |
| Care plan (`care_plans`, `care_plan_items`) | patient | treating doctor | treating doctor | treating doctor; patient and monitors once it has left draft | `care_plan_events`; a closed plan is frozen |
| Appointment (`appointments`) | patient and doctor | patient (request), doctor (booking) | patient (cancel, accept), doctor (answer, complete), support (move, cancel) | patient, the doctor, admins, monitors, support | `appointment_events` |
| Availability (`doctor_hours`, `doctor_time_off`) | doctor | doctor | doctor | hours: everyone signed in. Why a doctor is away: the doctor and staff | |
| Message (`messages`) | the two people | patient, treating doctor | receiver marks read | the two people only | cannot be edited |
| Document (`documents`) | patient | patient (upload), treating doctor (official) | owner; doctor signs, releases, corrects | see `can_open_document` | `document_events`; soft delete, versions |
| Notification (`notifications`) | the recipient | the database only | recipient marks read | recipient | |
| Support request (`support_tickets`) | the person asking | anyone | support staff answer it once | the person, support staff | |
| Audit entry (`audit_log`) | mCare | the database only | nobody | staff with "View audit logs" | append-only |

## 3. Permissions

Who is asking, what they hold, and their relationship to the record:

- **Patient**: their own rows (`patient_id = auth.uid()`).
- **Doctor**: patients assigned to them, while approved and active (`treats()`). Losing the assignment removes access at once; the former doctor keeps the patient's name and the dates only (`my_past_patients()`).
- **Admin**: everything administrative. For clinical content an admin has what "Monitor patients" gives; a document's content needs a time-limited, reasoned support grant and the patient is told. An admin never reads private messages or internal notes.
- **Assistant**: only what `staff.permissions` holds, checked by `staff_can()` in the database. The portal hides the screens and buttons a permission does not open; that is a courtesy, not the rule.

A screen never decides access. `can()` in `src/assistant/permissions.ts` only decides what to show.

## 4. The path of every change

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

On the client this is one shape everywhere: an action returns `{ ok: true, value }` or `{ ok: false, error }` and never throws; a form runs it through `useSave()` and shows `<SaveError>`; nothing says "saved" before the answer.

A form sent twice (a double tap, a retry after a lost answer) saves once: the form's reference travels with the save as `client_ref`, and the database refuses a second row with the same reference.

## 5. How other screens find out

The database counts changes: `patient_changes` has one row per patient, bumped by a trigger on every table that belongs to a patient, and `system_changes` one row per shared list. `my_change_token()` turns the rows a person may see into one short value.

- **Hosted Supabase**: the two tables are published for Realtime; the app subscribes and reloads when told.
- **Everywhere, including the local backend** (which has no Realtime service): the app asks for the token every 15 seconds, on returning to the tab and on reconnecting, and reloads when it differs.

The counters say only that something changed. What is then loaded is still decided by each table's row rules.

## 6. Workflows

**Doctor prescribes.** Doctor opens their patient → Prescribe → `INSERT prescriptions` (refused unless `treats()`) → the trigger writes the history line, files the prescription as a released document, notifies the patient and audits it, all in the same transaction → the patient's Meds screen shows it on its next reload; so does staff who monitor that patient.

**Patient records a vital.** Patient saves a reading → the database stamps the time and the recorder, validates and grades it against the patient's target and critical range → if it must, raises the alert and notifies the doctor and the monitors → the patient's change counter moves → the doctor's open portal reloads and shows it.

**Abnormal reading is re-measured.** The patient taps Re-measure on the alert (My Alerts, Home, the vital's page) and saves a reading → the database links it to the open alert for that vital (`alert_remeasures`) and grades it → in range on a warning: the alert is resolved (`resolved_how = 'remeasure'`), both sides are told. In range on a critical alert: it goes back to the doctor, who closes it ("Resolve with this reading"). Still out of range: the same alert stays open (no second alert), the patient is told to contact the doctor. The doctor may add a comment, an action taken or an instruction at any point (`alert_comments`) and resolves with a reason. `alertStory()` in `lib/vitals` turns the alert, its re-measurements, comments and resolution into the one sequence that My Alerts, the resolve sheet and the printed report all show.

**Admin assigns a doctor.** `assign_doctor(patient, doctor, reason)` → checks the permission and that the doctor is approved and active → the open assignment is ended and the new one started (one open row per patient) → both doctors and the patient are notified, any pending request of the patient is closed, the audit entry carries before and after → the new doctor gains the record and the former loses it in the same instant.

**Appointment.** Patient requests (checked against the doctor's hours and days away) → doctor confirms, declines or proposes a time → patient accepts → doctor completes it or records a missed visit. Support may move or cancel it for either of them, with a reason both read. Each step is a line in `appointment_events`. It is one row throughout.

**Messages.** A conversation is not stored: it is every `messages` row between two people (`src/shared/lib/messaging.ts`), shown by the same `Inbox` and `ChatThread` in the patient and doctor portals. Only a patient and the doctor who treats them now can write to each other; after a reassignment both keep the old conversation to read. Each message carries its form reference, so a retry does not send it twice. Its notification names the conversation, so a tap opens that thread. Staff do not message and cannot read messages: a person reaches the mCare team through a support request.

**Consulting doctor.** The treating doctor (or a coordinator) adds another approved doctor to the care team. That doctor then reads the same record (readings, alerts, medicines, shared notes, the started care plan) and the database refuses any change from them; internal notes, documents and messages stay out of reach. Either side can end it; access ends at once and the row is kept.

**Email.** Every notification is also queued as an email (`notification_deliveries`). A sender outside the database claims a batch, sends, and reports each result: the local backend prints them, `supabase/functions/deliver` sends through Resend on a hosted project. SMS is not sent.

**Account suspended.** `set_account_status(person, 'suspended', reason)` → refused for yourself, for the last active admin and for a doctor who still has patients → from that moment every table refuses that account, on the session it already holds → the person is told; their records stay.

## 7. What each role may do

| Action | Patient | Doctor | Admin | Assistant |
| --- | --- | --- | --- | --- |
| Read a patient's record | own | assigned patients | with "Monitor patients" scope | with "Monitor patients" |
| Record a reading | own | assigned patients | no | no |
| Prescribe, set targets, write notes, care plans | no | assigned patients | no | no |
| Work an alert (acknowledge, resolve) | cancel own SOS | assigned patients | yes | with "Monitor patients" |
| Assign or remove a doctor | request one | no | yes | with "Assign healthworkers" |
| Answer a patient's doctor request | no | no | yes | with "Approve patient requests" |
| Request / book an appointment | request | book for own patients | no | no |
| Move or cancel someone's appointment | own: cancel | own: all steps | yes | with "Handle support" |
| Approve a doctor | no | no | yes | with "Approve doctors" |
| Register a person | no | no | yes | patients and doctors, with "Create users" |
| Suspend, deactivate, reactivate; grant permissions | close own | close own | yes | no |
| Read the audit log and the report | no | no | yes | with "View audit logs" |
| Message | own doctor | own patients | no | no |

Every refusal in this table is tested in `supabase/tests/rules.test.mjs`, as the role concerned.

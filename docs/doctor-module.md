# The doctor module

The clinical workspace for an approved, active doctor. Everything in it is the same record the patient's portal shows; see [data-flow.md](data-flow.md).

## How it is built

- **Screens**: `src/doctor/`. `DoctorApp.tsx` holds the tabs (Home, Patients, Appointments, Alerts; Messages and Profile open from Home and the avatar).
- **Data layer**: `useDoctor()` (`src/doctor/useDoctor.ts`). Every doctor screen reads and changes the record through it. What it returns is already narrowed to this doctor's patients; each action is one request. `useBoard()` (patients by risk) and `useVisits()` (the appointment card, its sheets and booking) are built on it.
- **One patient's record**: `PatientDetail.tsx` is the frame; each part is its own file: `PatientVitals`, `PatientMeds`, `PatientCarePlan`, `PatientNutrition`, `PatientNotes`, `PatientDocs`.
- **Saving**: every form uses `useSave()` and `<SaveError>`; a button that saves on its own uses `useAct()`. Nothing is announced before the database has answered.

## What a doctor can do

| Feature | Screen | Tables and functions | Who else sees it | History kept |
| --- | --- | --- | --- | --- |
| Dashboard: patients by risk, active alerts, reports to sign, requests, today's visits | `DashboardTab` | counted from the doctor's own records | | |
| Patient list; past patients (name and dates only) | `PatientsTab` | `patients`, `my_past_patients()` | | `care_assignments` |
| Readings and trends over 14, 30, 90 days or all | `PatientVitals` | `readings` | patient, monitors | |
| Record a reading taken in clinic | `PatientVitals` | `INSERT readings` | patient is told | recorder kept |
| Mark a reading invalid, with a reason | `PatientVitals` | `UPDATE readings` | its alert is closed; patient is told | `invalidated_by/at`, audit |
| Which vitals a patient records | `PatientVitals` | `set_tracked_vitals()` | patient | |
| Target range and critical range per vital | `PatientVitals` | `thresholds` | patient is told of a new target | `threshold_changes`, audit |
| Alerts: acknowledge, escalate, ask for a re-check, resolve with a reason, book a follow-up | `AlertsTab`, `AlertCard`, shared `ResolveAlertSheet` | `alerts`, `schedule_follow_up()` | patient, monitors | steps and who took them stay on the alert |
| Prescribe: dose, route, frequency, first and last day, instructions | `PatientMeds` | `INSERT prescriptions` | patient is told; filed in their documents | `prescription_events` |
| Stop (with a reason) or restart a medicine | `PatientMeds` | `UPDATE prescriptions` | patient is told | `prescription_events`, audit |
| Clinical notes: shared or internal; correct a note | `PatientNotes` | `INSERT clinical_notes` | shared: patient. Internal: nobody else | append-only; a correction links to what it amends |
| Care plan: goals and interventions; start, hold, resume, complete, cancel; progress on each goal | `PatientCarePlan` | `save_care_plan()`, `set_care_plan_status()`, `care_plan_items` | patient, once started | `care_plan_events` |
| Meal plan | `PatientNutrition` | `meal_plans` | patient | audit |
| Appointments: confirm, decline, propose a time, complete, no-show, cancel; book a visit | `AppointmentsTab`, `useVisits` | `appointments` | patient; support staff | `appointment_events` |
| Working hours, visit length, days away | `AvailabilityCard` (Profile) | `set_doctor_hours()`, `doctor_time_off` | patients are offered the open times | audit |
| Messages | `MessagesTab`, shared `ChatThread` | `messages` | the patient only | |
| Documents and reports: upload, build a vitals report, sign, release, correct | `PatientDocs`, `ReportBuilderSheet`, shared `DocumentViewer` | `documents`, `sign_document()`, `release_document()`, `correct_document()` | patient, once released | versions, `document_events` |
| Signature, profile, password | `ProfileTab` | `doctors`, `profiles` | | |

## Rules worth knowing

- **Access is the assignment.** A doctor reaches a patient only while `patients.assigned_doctor_id` names them and their account is approved and active. Reassignment moves access in the same transaction. Opening a patient who is no longer theirs shows "no longer under your care", not an empty record.
- **Nothing clinical is deleted or rewritten.** A wrong reading is marked invalid; a wrong note is corrected by a new note; a prescription is stopped; a care plan is cancelled or completed.
- **A new treating doctor can stop a medicine the previous doctor prescribed**, and cannot delete it.
- **Booking** by the doctor is not held to their own timetable; a patient's request is.
- **A course with a last day** is completed by a scheduled job (`complete_ended_prescriptions`), and the patient is told.

## Checks

- `supabase/tests/rules.test.mjs`: every rule above as the doctor, the patient, another doctor, a former doctor and staff.
- `supabase/tests/api.test.mjs`: the same workflows over HTTP with the real client.
- `supabase/tests/ui.test.mjs`: in a browser, the doctor opens a patient, sets a meal plan, records a reading, prescribes and stops a medicine, writes an internal note, writes and starts a care plan, completes a visit, acknowledges a new alert that arrived by itself, and sets working hours; every screen at phone, tablet and laptop width.

## Not done

- A doctor cannot correct the value of a reading a patient entered; they mark it invalid and record a new one.
- One doctor treats a patient at a time. There is no shared care team of several doctors.
- Availability has no public holidays calendar and no per-day exceptions other than days away.
- The prescription document filed at prescribing is not rewritten when the medicine is stopped; the stop is in the prescription's history.
- Email, SMS and push are not sent; notifications are in-app.

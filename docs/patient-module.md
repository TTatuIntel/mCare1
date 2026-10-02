# The patient module: what was found, what was built, what is still open

Related: `docs/local-setup.md` (running it, test accounts, phone testing) and `docs/database.md` (relationships, access rules, automation).

## 1. What was found

The patient portal was a designed prototype. Its 26 screens were complete to look at, and none of them saved anything.

| Area | State before |
| --- | --- |
| Data | Every screen read one in-memory store seeded with sample people (James Mwangi, Dr. Amara Osei…). A refresh lost everything. |
| Backend | A full Postgres schema with row-level rules existed in `supabase/migrations` and passed 132 rule tests, but no screen called it. Only sign-in used Supabase. |
| Live sign-in | A real account was added to the sample list, so a real patient saw sample doctors and no way to persist anything. |
| Rules | Alert grading, self-clear and escalation ran in the browser, so a modified client could skip them. |
| Saves | Every action was instant and could not fail. No screen had a busy state or an error path. Success messages appeared before anything was saved. |
| Hardcoded figures | Meals showed fixed macros (65 g / 180 g / 42 g), fixed hydration (6 of 8 glasses) and a fixed "doctor's dietary note". |
| Actions that did nothing | "Submit Rating" on a doctor showed a thank-you and stored nothing. "Chase doctor" (admin) only showed a toast in any real setup. |
| Layout | Four patient sheets were hand-built and stayed pinned to the bottom on tablet and web, instead of becoming dialogs. |
| Clinical rule | A doctor's "re-check" closed any alert, including a critical one, on the next in-range reading, with the reason recorded as "Contacted patient, condition stable", which nobody had done. The alert's value was overwritten with the normal one. |
| Access | A suspended patient with a live session could still read and write their own record. |
| Stability | Signing out drew the patient portal for one frame with no user, which could crash the page. |
| Dates | "Today" was the UTC day, so between midnight and 3 a.m. in Nairobi doses were logged against yesterday. |

## 2. What was built

### One data layer, two modes

- **Live mode** (a backend is configured): the record is loaded from the database when the person signs in, every action saves to it, and the app re-syncs when something changes.
- **Demo mode** (no `.env.local`): unchanged behaviour on the sample data.

Screens do not know which mode is running. The pieces:

| File | Role |
| --- | --- |
| `src/shared/api/records.ts` | Reads every table the signed-in person may see and maps rows to the app's shapes. Never filters for privacy: the database decides. |
| `src/shared/api/actions.ts`, `documentActions.ts` | One function per change. Each throws an error whose message can be shown as it is. |
| `src/shared/state/AppContext.tsx` | The store. In live mode: loads at sign-in (the sign-in page waits, so no portal ever opens empty), saves through the API, reloads after each save, checks for news every 15 s, reloads on focus and on reconnect. |
| `src/shared/state/demoData.ts` | The sample people, moved out of the store. Not used in live mode. |
| `src/patient/usePatient.ts` | The patient screens' only door to the record. Every action returns `{ ok }` or `{ ok: false, error }`. |
| `supabase/dev/server.mjs` | The local backend: the migrations on a real Postgres engine, behind the Supabase API. |

### Patient features, all on real data

| Feature | What works |
| --- | --- |
| Sign-up, sign-in, sessions | Account creation, consent recorded on the server, session kept across reloads, wrong-password message that gives nothing away, password change (current password checked; other devices signed out), "sign out of all other devices", reset by emailed code. |
| First-run health setup | Each step is saved before the next opens; can be skipped and resumed. |
| Dashboard | Health score, up-next ticker, reminders, recent readings, doctor's latest note, alerts card: all from the record. |
| Vitals | Log one, a group or all; validation before saving; server grading; trends, history, filters; unit choice saved; a typo corrected within 15 minutes, with the first value kept and shown. |
| Alerts | Raised by the database; "send to doctor now"; status steps (sent, reviewing, resolved); the doctor's reason and note; resolution history. |
| SOS | Sent to the doctor and care team; "I'm safe now"; if it cannot be sent the patient is told plainly and the call buttons stay. |
| Medication | Active prescriptions, dose times, tick and un-tick, stopped medicines kept as history. |
| Meals | The doctor's plan when there is one (meals, energy target, water goal, dietary note), else the standard plan; meals logged with what was eaten; water logged per day. Macros shown only when the plan gives them. |
| Appointments | Request with validation; upcoming and history; withdraw or cancel with confirmation; accept a new time the doctor proposed. |
| Care team | Assigned doctor, directory, request a doctor (one pending at a time), doctor profile with contact links, rating that is stored and can be changed. |
| Messages | Thread with the treating doctor; an unsent message stays in the box with the reason. |
| Documents | Official documents once released; upload with type and content checks; view, download, zip of everything; private or shared with care team; delete and restore; access history; share link for report content, which opens once for someone without an account. |
| Notifications | Written by the database for every care-team action; mark one or all read. |
| Profile, privacy | Edit details and photo; health profile; emergency contacts (add, edit, remove; one next of kin); who can see the record; consent date; deactivate account. |
| Failure states | Every form shows busy and error states. A banner says when mCare cannot be reached and how old the data on screen is. Nothing claims to be saved before it is. |

### Database (migration `0004_patient_module.sql`)

Who recorded a reading and what it said before a correction; alerts that change only through defined steps and are never edited once resolved; a critical alert closed only by a clinician; clinical notes, target history, consent and doctor ratings as rows; notifications and audit written by triggers in the same transaction as the change; appointment, prescription and message guards; multi-row saves as single-transaction functions; lockout of suspended accounts on every table; indexes for the queries the portals run, and check and uniqueness constraints. Details in `docs/database.md`.

### Other roles

The doctor, admin and assistant portals use the same store, so they now read real data in live mode too, and their existing actions save: acknowledge, resolve and escalate alerts, request a re-check, notes, prescriptions, targets, appointment answers, report drafting, doctor assignment, answering doctor requests, doctor approval. Their "saved" messages now wait for the save.

### Care integration (migration `0005_care_integration.sql`)

A second pass over every place where another role touches the patient's record. What was found and what replaced it:

| Found | Now |
| --- | --- |
| The patient's Meals tab read a doctor's plan, but no screen could write one. | Doctor → patient → **Nutrition**: the plan (meals, energy target, water goal, dietary note), what the patient logged today and over 7 days. Saving it is what the patient sees; the patient is told. |
| The database let the treating doctor record a reading; no screen did. | Doctor → patient → Vitals → **Record a reading**. Same record, same grading and alerts; attributed to the doctor; the patient is told. |
| Admin "Register user" showed "registered" and a code in live mode, and saved nothing. | An **invitation** is saved. The person signs up with that email and gets the role (staff roles once the email is confirmed). "Waiting to sign up" lists them and lets the admin withdraw. |
| Admin Documents was empty in live mode (staff may not read document rows), and its restore, purge and backup acted on nothing. | The registry reads `document_registry()` (metadata only). Restore and purge are real and audited. The in-app backup card is replaced by a note that the host takes backups. |
| Vital definitions were saved from inside a state update, said "updated" before saving, and wrote their own audit line. | One save per change, the sheet waits for it, and the database audits it. |
| A follow-up from an alert was two requests: the visit could be booked and the alert left open. | One function: both, or neither. |
| The prescription sheet closed even when the save failed. | It stays open and shows why. |
| The Home screen advertised "mCare Premium", which does not exist. | Removed. |

## 3. How it was checked

| Check | Result |
| --- | --- |
| `npm run typecheck` | Clean. |
| `npm run build` | Succeeds. |
| `npm run test:db` | **350 passed, 0 failed.** Every access and clinical rule, run as patient, other patient, treating doctor, other doctor, admin, assistant, suspended account and signed-out visitor. |
| `npm run test:api` | **144 passed, 0 failed.** The real client over HTTP: sign-up and sessions, each patient workflow, the care-team side, forged tokens, changed ids, files, and the care-integration flows as doctor, other doctor, admin, assistant, patient and signed-out visitor. |
| `npm run test:ui` | **65 passed, 0 failed.** A headless browser: a new sign-up through setup, a full patient day, the care team's answers arriving in the open app, a reload, the backend becoming unreachable, the doctor setting a meal plan and recording a reading and the patient seeing both, the admin registering a user and reading the audit log and the document registry, and all 11 patient screens at 390, 834 and 1366 px (no sideways overflow, no script errors). After each step the database is queried to confirm the change. |
| Doctor and admin portals, live | Checked in the browser: alert acknowledged and resolved with a note, clinical note, prescription (with its filed document), doctor request approved, audit log entries. |
| Demo mode | Checked in the browser after the shared changes: patient, doctor and admin sample accounts. |
| Network address | The preview on port 8443 was opened on the laptop's network address and the test patient signed in. |

Bugs found by these checks and fixed: the sign-out crash, the suspended-account gap, social sign-in buttons shown where they cannot work, demo-account link shown in live mode.

## 4. What is not done

1. **A physical phone has not been used by the test suite.** Phone behaviour was checked in the Safari engine at iPhone size and the Chrome engine at Pixel size, including a throttled connection and the "reduce motion" setting, on the laptop's network address. On a real phone use `npm run phone` (port 8444): see `docs/local-setup.md`.
2. **A hosted Supabase project has not been used.** No project keys were available. The local backend implements the part of the Supabase API the app calls; a hosted project may differ in details. The storage rules and the scheduled jobs in migration `0004` only run where those features exist, so they are unexercised.
3. **Uploaded files cannot be sent through share links**, only report content. Giving a file to someone without an account needs a server-side function that issues signed links.
4. **Files are checked in the browser only** (type, content signature, macros, size). A server-side scan needs a server function.
5. **Email and SMS.** The local backend prints codes in its terminal instead of sending email. Nothing sends SMS.
6. **Updates.** On hosted Supabase the app is told of a change at once (Realtime on the change counters, migration `0015`). On the local backend, which has no Realtime service, it asks every 15 s and on focus. The Realtime path has not been exercised: no hosted project was available.
7. **Social sign-in** works only on a hosted project with providers configured. It is hidden on the local backend.
8. **Admin, in live mode:** an invitation is saved, but nothing emails it: the admin has to tell the person to sign up. A staff invitation is only as safe as email confirmation, so keep confirmation switched on in production (the local backend has it off unless `MCARE_CONFIRM_EMAIL=1`). Backups are the host's; the app has no backup tool in live mode. Replacing a released document with a new file is unavailable (correcting a report works).
9. **Sign-out elsewhere.** The local backend ends other sessions at once. On hosted Supabase an access token already issued stays valid until it expires (up to an hour).
10. **Encryption.** Hosted Supabase encrypts at rest and in transit. The local database files are not encrypted and the local network uses plain http: test data only.
11. **Not browser-tested:** editing vital definitions, doctor approval, withdrawing an invitation, restoring a document as support, moving an appointment as support, and the availability picker with a doctor who keeps a timetable. They are wired and covered by the rule and API tests. The doctor and admin portals are browser-tested in live mode at three widths (see `doctor-module.md`, `admin-module.md`).
12. **Account changes that span several tables** (`updateUser` for another person's profile, vitals and doctor details together) are still several requests, not one transaction. Patient screens do not use that path.
13. **Minimum password length** is now 8 (was 5). Supabase refuses fewer than 6.

## 5. Notes on the merge of 2 October

A parallel change (`daeefab`) added `src/shared/api/patientBackend.ts` and `supabase/migrations/0004_patient_portal.sql`. After the merge:

- `0004_patient_portal.sql` could not run: it creates `report_requests`, which `0002_documents.sql` already creates, and references a table `medical_documents` that does not exist (the table is `documents`). With it present the database would not start. It was removed.
- `patientBackend.ts` was no longer imported anywhere; `records.ts` and `actions.ts` cover everything it did, for every role, with failures reported to the person. It was removed.
- `AppContext.tsx` kept a block that called the removed loader and no longer compiled. It was removed.

Anyone with that branch checked out should rebase onto the current `main`.

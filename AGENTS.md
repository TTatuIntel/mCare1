# mCare — agent guide

Loaded at the start of every session (`CLAUDE.md` imports it). It is written so a task can start **without reading the source first**: where the project stands, the rules the code follows, a map of every file, and where each kind of change goes. Open a source file only once this guide has told you which one; for a big file, read only the section you need ([§6](#big-files-by-section)).

Reference detail lives in `docs/`; open the one the task needs:

| Read | When the task touches |
| --- | --- |
| [docs/STATUS.md](docs/STATUS.md) | what works, what is in progress or recently finished, what is pending, known gaps, tech debt, latest test results |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | who owns a record, who may do what (per role), workflows end to end |
| [docs/DATABASE.md](docs/DATABASE.md) | migrations, which file defines which function/trigger, tables and keys, RLS summary, what triggers do, the local backend |
| [docs/PORTALS.md](docs/PORTALS.md) | a portal's tabs, features → screens → tables/functions |
| [docs/DELIVERY.md](docs/DELIVERY.md) | notifications, email / SMS / push, the sender, providers |
| [docs/TESTING.md](docs/TESTING.md) | the three test suites and how to write a check |
| [docs/RUNNING.md](docs/RUNNING.md) | setup, env vars, phones, hosted Supabase |

**Contents:** [Working on a request](#working-on-a-request) · [Words and screens → code](#words-and-screens--code) · [1 Snapshot](#1-snapshot) · [2 Commands](#2-commands) · [3 Code rules](#3-code-rules) · [4 Where to change what](#4-where-to-change-what) · [5 Recipes](#5-recipes) · [6 Code map](#6-code-map) · [7 Notifications and delivery](#7-notifications-and-delivery) · [8 Keeping these docs true](#8-keeping-these-docs-true)

---

## Working on a request

Requests are often short and informal ("fix the chat page", "loader shows too long", "add X for the doctor"). Turn each one into a precise, complete change:

1. **Locate.** Translate the words into code with [Words and screens → code](#words-and-screens--code) and [§4](#4-where-to-change-what), then open only the files they name. If two readings are plausible and would lead to different changes, ask one short question; otherwise take the reading that fits the rules below and say which you took.
2. **Check what is in flight.** [STATUS.md → In progress](docs/STATUS.md#in-progress-uncommitted) and `git status`: build on uncommitted work in that area, never overwrite it.
3. **Find every layer the change touches.** Screen → portal hook → `AppContext` (live **and** demo branch) → `api/actions.ts` / `api/records.ts` → a new migration → tests. A look-and-feel request stays in the UI; a rule ("only X may…", "should notify…") is never UI-only: it belongs in SQL first.
4. **Check every portal that shares it.** `src/shared/**` is used by several portals: `grep` the component name and check each caller.
5. **Follow [§3](#3-code-rules)** (container variants, rem sizes, teal actions, `Outcome` + `useSave`, nothing clinical deleted, the database decides).
6. **Verify.** `npm run typecheck`; `npm test` if SQL changed. The browser test finds elements by visible text and labels, so **when you change any visible text, grep `supabase/tests/ui.test.mjs` for it** and update the test; run `npm run test:ui` when a journey changed.
7. **Update the docs in the same change** ([§8](#8-keeping-these-docs-true)), then report: what changed (with file links), what was verified and how, and anything left undone.

## Words and screens → code

What the person sees or says, and where it lives. Screen titles are the `Page` / `BackHeader` titles in the app.

**Patient**

| Says / sees | Code |
| --- | --- |
| Home, health score, "up next", reminders, recent readings | `patient/HomeTab.tsx`, `VitalsStrip.tsx`, `ReminderSheet.tsx` |
| "Vitals" page | `patient/VitalsTab.tsx` |
| One vital's page ("Vital"), chart, history, fix a typo | `patient/VitalDetail.tsx`, `shared/ui/VitalHistory.tsx`, `shared/ui/vitals.tsx` |
| Log a reading, "Log all", re-measure banner | `patient/VitalLogSheets.tsx` |
| Floating "Log vitals" button, FAB, quick log | `patient/QuickLogFab.tsx` |
| "My Alerts", re-measure, alert story | `patient/MyAlertsTab.tsx`, `alertKit.tsx`; story: `alertStory` in `lib/vitals.ts` |
| SOS, "I'm safe now" | `patient/SosSheet.tsx` |
| Meds, "Medications", dose ticks | `patient/MedicineTab.tsx`, `useDaySchedule.ts`, `lib/schedule.ts` |
| Meals, water | `patient/MealsTab.tsx` |
| Chat, "Messages" | `patient/MessagesTab.tsx`, `shared/ui/Inbox.tsx`, `ChatThread.tsx` |
| Appts, "Appointments", request a visit | `patient/AppointmentsTab.tsx`, `shared/ui/appointments.tsx`, `SlotPicker.tsx` |
| "Care Team", find / request / rate a doctor | `patient/CareTeamTab.tsx`, `DoctorProfileSheet.tsx`, `shared/ui/CareTeamCard.tsx`, `CarePlanCard.tsx` |
| "Documents", upload, share link, download | `patient/DocsTab.tsx`, `shared/documents/*` (`UploadSheet`, `ShareSheet`, `DownloadSheet`, `DocumentViewer`) |
| Ask for a report | `patient/ReportRequest.tsx` |
| First-run setup, "About you", conditions, allergies | `patient/HealthSetup.tsx`, `healthForms.tsx` |
| Profile, health profile, emergency contacts / next of kin | `patient/ProfileTab.tsx`, `HealthEditSheet.tsx`, `EmergencyContacts.tsx` |

**Doctor**

| Says / sees | Code |
| --- | --- |
| Doctor home, dashboard, risk board | `doctor/DashboardTab.tsx`, `useBoard.ts` |
| "Patients", past patients | `doctor/PatientsTab.tsx`, `PatientChips.tsx` |
| A patient's record ("Patient") | `doctor/PatientDetail.tsx` + the section file below |
| Readings, targets, thresholds, ranges, mark invalid | `doctor/PatientVitals.tsx`, `shared/ui/vitals.tsx` (`VitalThresholdRow`) |
| Prescribe, stop / restart medicine | `doctor/PatientMeds.tsx` |
| Notes, internal note, correct a note | `doctor/PatientNotes.tsx` |
| Care plan, goals, interventions | `doctor/PatientCarePlan.tsx`, `shared/ui/CarePlanCard.tsx` |
| Meal plan, nutrition | `doctor/PatientNutrition.tsx` |
| Vitals report, report builder, sign, release, correct | `doctor/ReportBuilderSheet.tsx`, `PatientDocs.tsx`, `shared/documents/DocumentViewer.tsx`, `reportTemplate.ts` |
| Doctor's "Alerts", acknowledge, resolve, follow-up | `doctor/AlertsTab.tsx`, `AlertCard.tsx`, `shared/ui/alerts.tsx` (`ResolveAlertSheet`) |
| Doctor's appointments, book, confirm, propose | `doctor/AppointmentsTab.tsx`, `useVisits.tsx` |
| Doctor's chat | `doctor/MessagesTab.tsx` |
| Working hours, availability, days away | `doctor/AvailabilityCard.tsx` |
| Signature | `shared/profile/SignatureSheet.tsx`, `shared/ui/SignaturePad.tsx` |
| Consulting doctor, second opinion, care team | `doctor/ConsultView.tsx`, `shared/ui/CareTeamCard.tsx` |
| "Waiting for approval" screen | `shared/auth/DoctorStatusScreen.tsx` |

**Admin and assistant**

| Says / sees | Code |
| --- | --- |
| Admin / assistant home | `admin/DashboardTab.tsx`, `assistant/PermissionsCard.tsx` |
| "Doctor Approvals" | `admin/ApprovalsTab.tsx` |
| "Care Assignments", assign a doctor / health worker, patient's doctor request | `admin/AssignTab.tsx`, `PatientAssignmentView.tsx`, `DoctorPicker.tsx` |
| "Users", invite / register, suspend, deactivate, permissions | `admin/UsersTab.tsx`; gates: `assistant/permissions.ts` |
| "Alert Monitor" | `admin/AlertsMonitorTab.tsx` |
| Admin "Vitals" (definitions, a patient's readings) | `admin/VitalsTab.tsx`, `PatientThresholdView.tsx` |
| Appointments desk, "Support", "Documents" registry, "Audit Log", "Reports" | `admin/AppointmentsTab.tsx`, `SupportTab.tsx`, `DocumentsTab.tsx`, `AuditTab.tsx`, `ReportsTab.tsx` |

**Signed out**

| Says / sees | Code |
| --- | --- |
| Welcome page, feature tour, "Get started" | `shared/auth/WelcomeScreen.tsx`, `AuthShell.tsx` |
| Sign up, register | `shared/auth/SelfRegisterScreen.tsx` |
| Sign in, login, demo account list | `shared/auth/LoginScreen.tsx` |
| OTP, code, verify email, activation link | `shared/auth/LiveAuth.tsx` (live), `VerificationScreen.tsx` (demo), `api/authBackend.ts` |
| Forgot / reset password | `LiveAuth.tsx` `LiveRecovery` (live), `ForgotPassword.tsx` (demo) |
| Terms, consent, privacy text | `shared/auth/Legal.tsx` |
| Google / social sign-in | `shared/auth/SocialAuth.tsx` |
| Password rules | `shared/state/auth.ts` (`passwordIssue`) and the backend's sign-up check |
| Form inputs, icons on these screens | `shared/auth/authKit.tsx` |

**Everywhere**

| Says / sees | Code |
| --- | --- |
| Loader, loading popup, spinner | `shared/ui/Loader.tsx` (overlay on the page, only for real waits) |
| Splash, logo at start | `index.html` `#boot-splash`, `shared/layout/SplashScreen.tsx` |
| Logo | `shared/layout/MCareLogo.tsx`, `brand.ts` |
| Bottom bar, side bar, menu, nav | `shared/layout/NavBar.tsx`, `PortalShell.tsx` |
| "Can't reach mCare" / offline / "could not save" banner | `shared/layout/PortalShell.tsx` |
| Popup, sheet, dialog, modal | `shared/ui/BottomSheet.tsx` |
| Toast, "saved" message | `useToast` in `shared/ui/BottomSheet.tsx` |
| Bell, notifications list | `shared/ui/NotificationBell.tsx` |
| Notification settings (email / SMS / push) | `shared/profile/NotificationsSheet.tsx` |
| Header with greeting and avatar, hero card, quick buttons | `shared/ui/home.tsx` |
| Profile card, edit profile, change password, theme, font size, help, deactivate | `shared/profile/ProfileCard.tsx`, `AccountSheets.tsx` |
| Empty page message | `EmptyState` in `shared/ui/Page.tsx` |
| Colours, fonts, animations, text size | `src/index.css`, `shared/layout/deviceScale.ts` |
| "Static on the phone", reduce motion, Animations setting | `shared/layout/motion.ts`, `index.html` (inline script), `ThemeFontSheet` in `shared/profile/AccountSheets.tsx` |
| Emails, SMS wording | `shared/email/emailTemplate.ts` |
| Demo mode, sample people | `shared/state/demoData.ts`, `shared/documents/docSeed.ts` |

**Words:** *health worker* = doctor · *coordinator* = admin, or assistant with "Assign healthworkers" · *monitor* = staff with "Monitor patients" · *thresholds / targets / ranges* = `thresholds` (normal) and critical range · *re-measure / re-check* = `alert_remeasures` · *assistant* = `staff.is_assistant` with `permissions` · *live* = backed by Postgres, *demo* = in memory.

---

## 1. Snapshot

*As of 3 October 2026, branch `consulting-messages-and-docs` (not yet merged into `main`), features at `bcbab19`. Full detail: [docs/STATUS.md](docs/STATUS.md).*

mCare is remote patient monitoring. Patients log vitals, medicines, meals and water; their doctor follows them, answers alerts, prescribes, writes notes and care plans and issues signed reports; administrators and mCare assistants run assignments, approvals, support and the audit trail.

> A record exists once, under one ID, in one database. Each role sees and changes it through its own screens, the database decides what each may do, and every change is audited and reaches the other roles.

There is no patient database, doctor database or admin database: `src/patient`, `src/doctor`, `src/admin` and `src/assistant` are four sets of screens over the same rows.

| Layer | Technology |
| --- | --- |
| App | React 19, TypeScript 5.7 (strict), Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`, no config file), oxfmt. Runtime deps: `react`, `react-dom`, `@supabase/supabase-js` only. |
| Backend | Supabase: Postgres with row-level security, Auth, Storage |
| Local backend | `supabase/dev/server.mjs`: the same migrations on PGlite, served as the Supabase API |
| Sending | `supabase/functions/deliver`: Edge Function for queued email, SMS, push |

**State.** All four portals are feature-complete against the local backend. Last verified run: typecheck clean · `test:db` 354/0 · `test:api` 153/0 · `test:ui` 66/0.

**Recently finished** (`bcbab19`, tested): patients message consulting doctors in private threads (migration `0011`); sign-up names each missing field; test OTPs shown only in dev builds; auth/welcome spacing. The docs restructure is a separate commit.

**Pending** (not started): hosted Supabase project, real email/SMS/push providers, reviewed legal text, server-side file scanning, files via share links, physical-phone testing, CI. See [STATUS.md → Pending](docs/STATUS.md#pending-before-production).

---

## 2. Commands

Node 22+. First time: `npm install && npm i --no-save @electric-sql/pglite` (PGlite and Playwright are kept out of `package.json` on purpose).

| Command | What it does |
| --- | --- |
| `npm run backend` | Local Postgres + Supabase API on :54321; applies new migrations; writes `.env.local` (switches the app to live mode). One backend per data folder; seeds a new database; keeps a copy at each clean stop and recovers from it after a kill. |
| `npm run dev` | The app on :8443 (hot reload). |
| `npm run backend:seed` | Test accounts (safe to repeat). |
| `npm run backend:stop` | Stop a running backend cleanly from another terminal. |
| `npm run backend:reset` | Delete the local database and its copies (not while a backend runs); then `backend`. |
| `npm run typecheck` | **Run after changing `src/`.** |
| `npm test` | Rule + API suites. **Run after changing a migration.** |
| `npm run test:ui` | Four portals in headless Chromium at three widths (needs Playwright; minutes). |
| `npm run phone` | Production build on :8444 for a phone on the same Wi-Fi. |
| `npm run build` · `preview` · `format` · `db:schema` | Build · serve it · oxfmt · print what the migrations build. |

Test accounts (password `M7c24`): `test.patient@mcare.test` (Patient One: two weeks of readings, an open alert, medicines, care plan, visits, messages), `test.patient2@mcare.test`, `test.patient3@mcare.test` (waiting for a doctor), `test.doctor@mcare.test` (Dr. Test Achieng, treats One and Two), `test.doctor2@mcare.test` (Dr. Test Mutua, consults on One), `test.doctor3@mcare.test` (awaiting approval), `test.admin@mcare.test`, `test.assistant@mcare.test`. What each holds: [RUNNING.md → Test accounts](docs/RUNNING.md#test-accounts).

**Modes.** *Live* when `.env.local` sets `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (local backend or hosted); *demo* otherwise (sample data in memory from `src/shared/state/demoData.ts`, nothing saved). Delete `.env.local` to go back to demo. More: [docs/RUNNING.md](docs/RUNNING.md).

---

## 3. Code rules

### Layout and design (the patient portal is the reference)

- Every portal renders inside `PortalShell`. Profile opens from the header avatar, not from a nav tab.
- **Responsive.** `PhoneShell` fills the window and is a CSS container. Build mobile-first, then use Tailwind **container** variants: `@2xl:` tablet (672px+), `@5xl:` web (1024px+). Never viewport variants (`md:`, `lg:`). `PortalShell` turns the bottom tab bar into a side rail (tablet) and a sidebar (web) and keeps content to a readable width; sheets become centred dialogs on tablet and web automatically.
- Stacked cards flow into two columns on tablet and web through `card-flow` (`Page` applies it; pass `flow={false}` for a screen with its own grid). Plain-stack roots add `card-flow` themselves; `span-all` keeps a child full width. `PortalShell` takes `narrow` for single-column screens such as Profile.
- A font size cannot be switched with a container variant on the same element as `text-[9px]`/`text-xs`… (the font-scale rules in `index.css` win): render two elements and show one per size.
- **Device scale.** Size in rem through Tailwind's scales (`w-6`, `gap-3`, `text-sm`), not px (`w-[18px]`, inline `fontSize: 40`). The root font size follows the device's text size and shrinks on phones narrower than 390px (`layout/deviceScale.ts`). A new `text-[Npx]` size needs a matching line in the font-scale block of `index.css`.
- Charts measure their own width (`useElementWidth` from `@/shared`); never hard-code an SVG width.
- Every home screen: `PortalHeader`, then `HeroCard`, then `QuickGrid`, then `NoticeCard`s.
- Other screens are wrapped in `Page` (title row, spacing, loading and error states) or start with `BackHeader` for detail views. `EmptyState` for empty lists. `PageTitle` is the older form; prefer `Page`.
- Brand teal (`teal-700`) is the only colour for action buttons. Blue, purple and amber mark status or role only.
- Fonts: `font-display` for headings, `font-mono` for numbers. Never inline `fontFamily`.
- The loading popup (`Loading` / `useLoader`) overlays the page that is already up, and only for real waits; never a standalone loading screen.
- **Motion** follows one setting, `data-motion` on `<html>` (`layout/motion.ts`: the device's reduce-motion setting unless the person chose Full or Reduced in Theme & Font). Never test `prefers-reduced-motion` yourself: CSS uses `:where(:root[data-motion='reduce']) .x { … }`, markup uses `motion-safe:` / `motion-reduce:` (redefined in `index.css`), scripts call `reducedMotion()`. Under reduce, movement becomes a fade or an in-place glow, not nothing; opacity-only effects (`animate-pulse`) need no guard.
- **Secure-context APIs** (`navigator.clipboard`, `crypto.randomUUID`, `crypto.subtle`, service worker, push) are missing on a phone opening `http://<laptop IP>`. Use the helpers that fall back (`copyText`, `newRef`) and never let a feature depend on one silently.
- Reusable UI goes in `src/shared/ui/`, not inside a screen. Import UI from `@/shared`.
- Tailwind v4 needs no config file: global CSS and theme customisation go in `src/index.css`, `@import` statements first, then `@font-face` and font defaults.
- Imports: `@/…` for anything in another folder, `./…` within the same folder, never `../`. No other files belong at the top of `src/`.

### Data and saving

- **One data hook per portal**; its screens read and change the record only through it: `usePatient()`, `useDoctor()`, `useAdmin()` (also used by the assistant portal). Never call `updateUser` or read the raw `users` list from a screen; add a named action or a scoped read to the hook. Each action is one request to the backend. Shared widgets (documents, chat, notifications, alerts, profile) may use `useApp()` directly.
- **One record, many views.** Never copy a record for another role. A new feature is one table keyed by `patient_id` (or the owner's id), one function in `api/actions.ts`, one action in `AppContext`, and each portal's hook exposing what that role may do with it ([recipe A](#a-a-new-patient-owned-record-end-to-end)).
- **Saving.** Every action that saves returns a promise of `Outcome` (`{ ok: true, value }` or `{ ok: false, error }`), in live and demo mode, and never throws. In a form, run it through `useSave()` and show `<SaveError>`: disable the button while `busy`; close the sheet or show success only once `ok`. A button that saves on its own uses `useAct()`. Never say "saved" before the save has come back.
- **Once only.** A form that creates a record passes `useSave().ref` as `clientRef`; the database keeps one row per reference, so a double tap or a retry does not create a second.
- **Nothing clinical is deleted or rewritten.** A reading is marked invalid, a note is corrected by a new note, a prescription is stopped, a care plan is cancelled. Keep the history tables the database writes (`*_events`, `care_assignments`, `threshold_changes`).
- **Live and demo.** `AppContext` loads the record from the backend at sign-in (live) or from `demoData` (demo); a new action needs both a live branch (`if (LIVE) return run(() => api.something())`) and the in-memory one, which mirrors the database's rule. Never put sample people or sample numbers in a screen: show an `EmptyState`.
- **The database decides.** Access rules, clinical rules (grading, alerts), notifications and the audit trail belong to `supabase/migrations`, not to a screen. A screen may hide a button the person cannot use; it must never be the only thing stopping them. The browser cannot write the audit trail: audit inside the trigger or function that makes the change (`audit_event(...)`).
- **Staying current.** A table that belongs to a patient needs the `zz_touch_patient` trigger, or open screens will not learn of its changes.
- **Migrations.** Add a new numbered file (next: `0012_…`); never edit one that has been applied. New functions must have their default grants revoked ([DATABASE.md → Adding a change](docs/DATABASE.md#adding-a-change)).
- **Sending.** Never send email, SMS or push from a screen: the database queues every channel ([§7](#7-notifications-and-delivery)).
- **Errors** shown to people are sentences: every `api/actions.ts` request goes through `ok(…)`, which throws an `ApiError` whose message (`explain()`) can be shown as it is; `run()` in `AppContext` turns it into `{ ok: false, error }`.

---

## 4. Where to change what

| To change… | Edit (in this order) |
| --- | --- |
| Who may read or change a table | New migration with replaced policy (current ones: `0009_security.sql`, grep `policy <table>_`) → demo-mode mirror in the `AppContext` action → `rules.test.mjs` |
| A clinical rule (grading, alert raising, re-measure) | `0004_vitals_alerts.sql` functions via a new migration → demo mirror: `AppContext.tsx` section "alert engine" + `src/shared/lib/vitals.ts` (`evaluate`, `alertStory`) |
| What a screen shows for a role | `src/<role>/<Screen>.tsx`; data from `use<Role>()` (`src/patient/usePatient.ts`, `src/doctor/useDoctor.ts`, `src/admin/useAdmin.ts`) |
| A new action (button that saves) | `src/shared/api/actions.ts` → `AppContext.tsx` (`Ctx` interface + implementation + `value`) → the portal hook → screen with `useSave`/`useAct` ([recipe B](#b-a-new-action-on-an-existing-table)) |
| What is loaded from the backend | `src/shared/api/records.ts` (`Records`, `loadRecords`, `to*` mappers) → `AppContext.tsx` setters after `loadRecords` (≈ line 420) |
| App-wide types | `src/shared/lib/types.ts` (grep `export interface <Name>`) |
| Vital ranges, units, trends, risk, alert story | `src/shared/lib/vitals.ts`; default definitions: `0010_reference_data_jobs.sql` (live) and `INITIAL_VITAL_DEFS` in `demoData.ts` (demo) |
| Daily schedule (doses, meals, reminders, badges) | `src/shared/lib/schedule.ts` (`buildDaySchedule`) |
| Conversations / message threads | `src/shared/lib/messaging.ts`, `ui/Inbox.tsx`, `ui/ChatThread.tsx`, each portal's `MessagesTab.tsx`; rule: `messages_send` policy (`0011`) |
| A tab or screen in a portal | `src/<role>/<Role>App.tsx` (`NAV`, `SCREENS`; admin: `ADMIN_TABS`, `NAV_ITEMS`) + `src/assistant/permissions.ts` `TAB_PERMS` if gated |
| Assistant permissions | `AssistantPerm` + `PERM_LABELS` in `types.ts`; `staff_can()` callers in SQL; `permissions.ts` |
| A notification | The SQL trigger/function: `notify_user(...)` / `notify_about(...)` ([DELIVERY.md](docs/DELIVERY.md#adding-a-notification)); demo mirror: `notify(...)` in the `AppContext` action |
| An email's wording or layout | `src/shared/email/emailTemplate.ts` (`emails`, `sms`); the hosted sender builds from `supabase/functions/deliver/index.ts` |
| Email / SMS / push providers | `supabase/functions/deliver/index.ts` (`emailSender`, `smsSender`, `pushSender`) |
| Documents: access, categories, upload checks | `src/shared/documents/documents.ts` (demo policy), `fileFormats.ts` (detection, safety), `0007_documents.sql` (live) |
| Reports (printed / PDF / .docx) | `src/shared/documents/reportTemplate.ts`, `exporters.ts`, `analysis.ts`; builder UI `src/doctor/ReportBuilderSheet.tsx` |
| Sign-in, sign-up, recovery | `src/shared/auth/*`, `src/shared/api/authBackend.ts`, password policy `src/shared/state/auth.ts` |
| Profile and account settings (all roles) | `src/shared/profile/*` |
| Nav bar, frame, connection banner | `src/shared/layout/PortalShell.tsx`, `NavBar.tsx`, `PhoneShell.tsx` |
| Theme, fonts, animations, font scale | `src/index.css`; how much things move: `src/shared/layout/motion.ts` |
| Boot splash | `index.html` (`#boot-splash`), `src/shared/layout/SplashScreen.tsx`, `splashSignal.ts` |
| Demo sample data | `src/shared/state/demoData.ts`, `src/shared/documents/docSeed.ts` |
| Test accounts | `supabase/dev/seed.mjs` |
| Local API behaviour (PostgREST/auth subset) | `supabase/dev/server.mjs` |
| Dev proxy, ports, aliases | `vite.config.ts` |

---

## 5. Recipes

Grep anchors are given instead of line numbers where code moves. After any recipe: `npm run typecheck`, `npm test` if SQL changed, update [docs/STATUS.md](docs/STATUS.md) and the relevant `docs/` file.

### A. A new patient-owned record, end to end

Pattern to copy: doctor ratings (`doctor_ratings` → `rateDoctor`).

1. **Migration** `supabase/migrations/0012_<what>.sql`: the table with `patient_id`, constraints, `client_ref uuid` + `create unique index <t>_client_ref_key on <t> (client_ref) where client_ref is not null` if a form creates it; RLS + policies + `<t>_active_only` + `zz_touch_patient` trigger; any multi-row function as `security definer` with `audit_event`/`notify_*` and explicit grants. Exact SQL: [DATABASE.md → Adding a change](docs/DATABASE.md#adding-a-change).
2. **Tests**: `rules.test.mjs` (allowed + every refused role), `api.test.mjs` if the app calls it. `npm test`.
3. **Type** in `src/shared/lib/types.ts`.
4. **Read**: `src/shared/api/records.ts` — add to `interface Records`, query in `loadRecords` (`rows('<table>')` in the `Promise.all`), map snake_case → camelCase in the returned object.
5. **Write**: `src/shared/api/actions.ts` — in the right section, one request wrapped in `ok(…)` (which throws an `ApiError` with a sentence on failure), e.g. `export const rateDoctor = async (…) => { await ok((await db()).from('doctor_ratings').upsert({ … })) }`; RPCs: `ok((await db()).rpc('<fn>', { … }))`. snake_case columns here, camelCase in the app.
6. **State and action**: `src/shared/state/AppContext.tsx` — add to `interface Ctx` (≈ line 72, under the matching `// Clinical` / `// Alerts` … comment); `useState` beside the others (≈ line 255); set it from records (≈ line 420) and empty it on sign-out (≈ line 440); implement the action in the matching `/* ─ … ─ */` section: `if (LIVE) return run(() => api.doThing(…))`, then the demo branch that applies the same rule and returns `done()` / `refused('<sentence>')`; add both to the provider `value` (≈ line 1760).
7. **Demo data** (optional): `src/shared/state/demoData.ts`.
8. **Hook**: expose a scoped read and the action from `usePatient` / `useDoctor` / `useAdmin` (`return { … }` block).
9. **Screen**: `Page` + `useSave()` (`save.run(() => thing(…))`, `<SaveError>`, `ref` as `clientRef`), `EmptyState` when empty.
10. **Browser test** in `ui.test.mjs` if it is a main journey. Update [PORTALS.md](docs/PORTALS.md) and [STATUS.md](docs/STATUS.md).

### B. A new action on an existing table

Steps 5, 6, 8, 9 of recipe A, plus a rule test if the database must allow something new (then a migration first).

### C. A new column

Migration `alter table … add column …` (and the `guard_*` trigger in a new migration if it must be protected) → type → `records.ts` mapper → `actions.ts` write → screen.

### D. A new screen or tab

File `src/<role>/<Name>Tab.tsx` wrapped in `Page` → `<Role>App.tsx`: id in `SCREENS` (+ `NAV` for a tab; admin: `ADMIN_TABS`, `NAV_ITEMS`, gate in `src/assistant/permissions.ts`) → render it beside the others (`{tab === '<id>' && <NameTab … />}` inside `PortalShell`) → add it to the screen lists of the width sweep in `ui.test.mjs` (`const screens = [` ≈ line 629, per-portal lists ≈ 700).

### E. A new assistant permission

`AssistantPerm`, `PERM_LABELS` (and `ALL_PERMS`) in `types.ts` → `TAB_PERMS` / `can()` calls in the admin screens → SQL (new migration): widen the `staff_permissions_known` check constraint on `staff` (it lists every allowed permission), then use `staff_can('<perm>')` in the policies or functions it opens → `rules.test.mjs` as an assistant with and without it.

### F. A new vital

Live: insert into `vital_defs` in a new migration (shape: `0010_reference_data_jobs.sql`), or let an admin add it in Vitals. Demo: `INITIAL_VITAL_DEFS` in `demoData.ts`. Grouping: `VITAL_GROUPS` / `groupOf` in `vitals.ts`. Condition suggestions: `suggestedVitals` in `lib/health.ts`.

### G. A new email

Add the message to `emails` (and `sms` if it goes by text) in `src/shared/email/emailTemplate.ts`; the database queues it through a notification. Never build email HTML anywhere else.

---

## 6. Code map

Every source file, one line each. Sizes are lines (≈). `ui/`, `layout/` and `profile/` exports come through `@/shared` (`src/shared/index.ts`).

### Root

| File | Holds |
| --- | --- |
| `index.html` | HTML shell, metadata, the inline script that sets `data-motion` before paint, the plain-HTML boot splash `#boot-splash`. |
| `vite.config.ts` | React + Tailwind plugins, `@` → `src/`, proxy of `/auth/v1` `/rest/v1` `/storage/v1` `/__dev` to the local backend, `__APP_VERSION__`. |
| `package.json` · `tsconfig.json` · `.mise.toml` | Scripts · strict TS with `@/*` paths · Node 22 + pnpm 10. |
| `public/` | `brand/mcare-logo.png` (also used in emails), `sw.js` (push service worker), `robots.txt`. |
| `src/main.tsx` | Entry: imports `index.css`, mounts `App`. |
| `src/App.tsx` | Role router: share link → `SharedDocuments`; signed out → auth; else the portal for the role. |
| `src/index.css` (417) | Tailwind import, `motion-safe`/`motion-reduce` variants, theme tokens, fonts, font-scale rules, `card-flow`, sheet and auth animations, reduced-motion rules. |
| `src/vite-env.d.ts` | Env var types (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`), `__APP_VERSION__`. |

Ignored, not source: `dist/` (build), `supabase/.data/` (local DB, keys, files, screenshots), `.env.local`, `.grok-changes/` (another tool's state).

### `src/patient/` — patient portal

| File | Holds |
| --- | --- |
| `PatientApp.tsx` | Root: `NAV` (home, vitals, medicine, messages, appts), `SCREENS`, badges, `go()`, the floating log button. |
| `usePatient.ts` (244) | The portal's data hook: the signed-in patient's record, doctors (`doctor`, `consultingDoctors`, `doctorById`), `messagePartners`, and every patient action. |
| `useDaySchedule.ts` | Today's doses/meals with a `toggle`. |
| `HomeTab.tsx` | Home: health score, up-next, reminders, recent readings, doctor's note, open alerts. |
| `VitalsStrip.tsx` (497) | Home-card vitals strip. |
| `ReminderSheet.tsx` | Reminder detail sheet. |
| `VitalsTab.tsx` (673) | Vitals overview by group, logging entry points. |
| `VitalDetail.tsx` (538) | One vital: chart, history, insights, log/correct. |
| `VitalLogSheets.tsx` (397) | `useVitalLog`, `LogAllSheet`, self-clear (re-measure) banner. |
| `QuickLogFab.tsx` | Floating "Log vitals": one, a group or all. |
| `MyAlertsTab.tsx` | My alerts: Sent → Reviewing → Resolved, each alert's story. |
| `alertKit.tsx` | `useAlertView`, `AlertSummaryCard`: how the patient sees an alert. |
| `SosSheet.tsx` | SOS and "I'm safe now". |
| `MedicineTab.tsx` | Prescriptions, dose ticks, stopped history. |
| `MealsTab.tsx` | Meal plan, meal and water logs. |
| `AppointmentsTab.tsx` | Request, list, cancel, accept a proposed time. |
| `CareTeamTab.tsx` | Treating and consulting doctors, care plans, directory, request a doctor. |
| `DoctorProfileSheet.tsx` | A doctor's profile and rating. |
| `MessagesTab.tsx` | Private threads with the treating doctor and each consulting doctor; former doctors read-only. |
| `DocsTab.tsx` | The patient's documents. |
| `ReportRequest.tsx` | Ask the care team for a signed vitals report. |
| `ProfileTab.tsx` | Profile, health profile, privacy, account. |
| `HealthSetup.tsx` (309) | First-run health setup, step by step. |
| `healthForms.tsx` | Health-profile form sections shared by setup and profile. |
| `HealthEditSheet.tsx` · `EmergencyContacts.tsx` | Edit health profile · emergency contacts (one next of kin). |

### `src/doctor/` — doctor portal

| File | Holds |
| --- | --- |
| `DoctorApp.tsx` | Root: `NAV` (dashboard, patients, messages, appts, alerts), `SCREENS`, badges, open patient / chat. |
| `useDoctor.ts` (189) | Data hook narrowed to this doctor: `patients`, `consulting`, alerts, appointments, `messagePartners`, every doctor action. |
| `useBoard.ts` · `useVisits.tsx` | Patients by live risk · appointment lists and actions. |
| `DashboardTab.tsx` | Home: risk board, alerts, reports to sign, requests, today's visits. |
| `PatientsTab.tsx` · `PatientChips.tsx` | Patient list, past patients · filter chips. |
| `PatientDetail.tsx` (239) | One patient's record frame (sections) and care team card. |
| `PatientVitals.tsx` | Readings, record a reading, mark invalid, targets and critical ranges. |
| `PatientMeds.tsx` | Prescribe, stop, restart. |
| `PatientCarePlan.tsx` | Care plan editor and steps. |
| `PatientNutrition.tsx` | Meal plan. |
| `PatientNotes.tsx` | Clinical notes, shared/internal, corrections. |
| `PatientDocs.tsx` · `ReportBuilderSheet.tsx` (270) | The patient's documents · build a vitals report. |
| `ConsultView.tsx` | Read-only record of a consulted patient. |
| `AlertsTab.tsx` · `AlertCard.tsx` | Alert queue · acknowledge / escalate / resolve card. |
| `AppointmentsTab.tsx` | Appointments. |
| `MessagesTab.tsx` | One private thread per treated or consulted patient; former patients read-only. |
| `ProfileTab.tsx` · `AvailabilityCard.tsx` | Profile · working hours, visit length, days away. |

### `src/admin/` and `src/assistant/` — staff portal

| File | Holds |
| --- | --- |
| `admin/AdminApp.tsx` | `ADMIN_TABS`, `ATab`, `NAV_ITEMS` (grouped, `webOnly`), `AdminPortal` (shared with assistants). |
| `admin/useAdmin.ts` | Staff data hook: whole lists and every staff action. |
| `admin/DashboardTab.tsx` | Staff home tiles. |
| `admin/ApprovalsTab.tsx` | Doctor approvals. |
| `admin/UsersTab.tsx` (313) | Find, register (invite), suspend/deactivate/reactivate, assistant permissions. |
| `admin/AssignTab.tsx` · `PatientAssignmentView.tsx` · `DoctorPicker.tsx` | Assignment list · one patient's assignment, history, requests, consulting doctors · doctor chooser. |
| `admin/AlertsMonitorTab.tsx` | Alert monitor. |
| `admin/VitalsTab.tsx` · `PatientThresholdView.tsx` | Vital definitions · one patient's readings (audited view). |
| `admin/AppointmentsTab.tsx` | Find, move, cancel appointments. |
| `admin/SupportTab.tsx` | Support tickets. |
| `admin/DocumentsTab.tsx` | Registry, recovery, purge, support access. |
| `admin/AuditTab.tsx` | Audit search, filter, export. |
| `admin/ReportsTab.tsx` | Operations report and delivery report. |
| `admin/ProfileTab.tsx` | Profile. |
| `assistant/AssistantApp.tsx` | The admin portal gated by `canOpenTab`. |
| `assistant/permissions.ts` | `can()`, `isFullAdmin()`, `TAB_PERMS`, `canOpenTab()`. |
| `assistant/PermissionsCard.tsx` | "What can I do?" card. |

### `src/shared/`

| File | Holds |
| --- | --- |
| **state/** | |
| `AppContext.tsx` (1,800) | `AppProvider` / `useApp`: all app state and every action in both modes, loading, sync, the demo alert engine. See [sections](#big-files-by-section). |
| `auth.ts` | Password policy (5+ chars, uppercase, number), email/phone checks, phone countries. |
| `demoData.ts` | Demo-mode people and records (`DEMO`, `INITIAL_VITAL_DEFS`). Never used live. |
| `useLoadStatus.ts` | A screen's loading / ready / error for `Page`. |
| **api/** | |
| `supabase.ts` | Connection: `backendConfigured`, `getSupabase`, `checkBackend`, `localBackend`. |
| `authBackend.ts` | Supabase Auth: sign-in/up, codes, recovery, social, `getLocalTestAuthCode` (dev only). |
| `records.ts` (468) | `loadRecords(me)`: every table the person may see → app shapes; `changeToken`, `searchAudit`. |
| `actions.ts` (429) | One function per change (sections: account, own record, vitals and alerts, medication and meals, care plans, availability, appointments, messages/notifications/reports, care coordination); `ApiError`, `explain`. |
| `documentActions.ts` | Documents and storage: upload, download, visibility, sign, release, correct, share, support access. |
| **lib/** | |
| `types.ts` (1,030) | Every app type, enum-like union and label map. Grep `export (interface\|type) <Name>`. |
| `vitals.ts` (605) | Grading (`evaluate`, `targetRange`), validation, risk and health score, `alertStory`, units, trends, insights, check-in cadence, `VITAL_GROUPS`. |
| `schedule.ts` | `buildDaySchedule`: what is due when (doses, meals, vitals, appointments). |
| `messaging.ts` | `threadOf`, `partnersOf`, `conversationsOf`. |
| `health.ts` | Conditions, allergies, `suggestedVitals`, `healthGaps`. |
| `push.ts` | This device's push subscription. |
| `ids.ts` | `newRef()` (form reference for once-only saves). |
| `clipboard.ts` | `copyText()`: copies on https and on plain-http network addresses. |
| `photo.ts` | `readSquarePhoto` (avatar crop/downscale). |
| **ui/** | |
| `primitives.tsx` | `Avatar`, `Pill`, `Toggle`, `SectionHead`, `InfoRow`, `PageTitle` (old), `AddButton`, `BackHeader`. |
| `BottomSheet.tsx` | `BottomSheet`, `Field`, `inputCls`, `SheetButton`, `useSave`, `SaveError`, `useToast`. |
| `Page.tsx` | `Page`, `EmptyState`, `ErrorState`. |
| `controls.tsx` | `Segmented`, `ChipFilter`, `StatTiles`, `useAct`. |
| `home.tsx` | `PortalHeader`, `HeroCard`, `QuickGrid`, `NoticeCard`, `NoticeRow`. |
| `Loader.tsx` | Global loading popup: `Loading`, `useLoader`, `LoaderProvider`. |
| `alerts.tsx` | `AlertStatusPill`, `AlertTimeline`, `ResolveAlertSheet`. |
| `appointments.tsx` | `AppointmentCard`, `APPT_STATUS`, `useApptLinks`. |
| `vitals.tsx` | `VitalCard`, `VitalChart`, `VitalThresholdRow`, `InsightNotes`, `useElementWidth`. |
| `VitalHistory.tsx` | A vital's history list with filters. |
| `Inbox.tsx` · `ChatThread.tsx` | Conversation list (`InboxPerson`) · one thread, quick replies. |
| `NotificationBell.tsx` | Bell + sheet; tap navigates by `link`/`resource`. |
| `CarePlanCard.tsx` · `CareTeamCard.tsx` | One care plan · a patient's care team. |
| `SlotPicker.tsx` | Time field from a doctor's open slots. |
| `HealthSummary.tsx` | Health summary, `AllergyBanner`. |
| `SignaturePad.tsx` | Draw or upload a signature. |
| **layout/** | |
| `PortalShell.tsx` · `NavBar.tsx` · `PhoneShell.tsx` | Portal frame and connection/save banner · tab bar / rail / sidebar · the container frame. |
| `SplashScreen.tsx` · `splashSignal.ts` | Takes the boot splash down · splash timing signals. |
| `deviceScale.ts` · `StatusBar.tsx` | Root font scaling · fake iOS status bar. |
| `motion.ts` | Motion setting: `data-motion` on `<html>`, `reducedMotion()`, `useMotionPref()`, `startMotion()` (main.tsx). |
| `MCareLogo.tsx` · `brand.ts` | Animated logo · brand constants (EKG path, colours). |
| **profile/** | |
| `ProfileCard.tsx` | The profile card used by every role. |
| `AccountSheets.tsx` (516) | Edit profile, change password, theme/font/animations, help, deactivate. |
| `NotificationsSheet.tsx` | Email / SMS / push choices. |
| `SignatureSheet.tsx` | Doctor's signature. |
| **auth/** | |
| `WelcomeScreen.tsx` · `AuthShell.tsx` (440) | Welcome + help · the signed-out frame with the animated feature tour. |
| `LoginScreen.tsx` · `SelfRegisterScreen.tsx` | Sign in · patient sign-up (names every missing field). |
| `LiveAuth.tsx` | Live mode: confirm email, recovery, dev-only test OTP display. |
| `VerificationScreen.tsx` · `ForgotPassword.tsx` | Demo-mode equivalents. |
| `SocialAuth.tsx` · `Legal.tsx` | Social sign-in buttons · consent text (placeholder). |
| `DoctorStatusScreen.tsx` · `SuspendedScreen.tsx` | Doctor awaiting approval · stopped account. |
| `authKit.tsx` (455) | Signed-out form controls, icons, OTP input. |
| **documents/** | |
| `useDocumentStore.ts` (737) | The document store both modes use (`DocumentApi`, spread into `AppContext`). |
| `documents.ts` (483) | Categories, upload validation, demo access policy (`canView`, `canSign`…), `buildVitalsReport`. |
| `fileFormats.ts` (476) | Format detection from bytes, macro/JS checks, previews, zip. |
| `reportTemplate.ts` (489) · `exporters.ts` · `analysis.ts` | Report HTML · PDF/.docx/HTML/zip export · suggested interpretation. |
| `DocKit.tsx` (479) | `DocRow`, `DocList`, filters, badges, `DocBodyView`. |
| `DocumentViewer.tsx` (428) · `DocumentReader.tsx` · `FilePreview.tsx` | Full viewer with actions · read-only reader · file preview. |
| `UploadSheet.tsx` · `ShareSheet.tsx` · `DownloadSheet.tsx` | Upload · share link · download options. |
| `SharedDocuments.tsx` | What a share-link visitor sees. |
| `docSeed.ts` | Demo documents. |
| **email/** | |
| `emailTemplate.ts` | The one email layout and the catalogue (`emails`, `sms`). |
| `Mailbox.tsx` | In-app email preview (demo). |

### `supabase/`

| File | Holds |
| --- | --- |
| `migrations/0001`–`0011` | The database. One line each: [DATABASE.md → Migrations](docs/DATABASE.md#migrations); which file defines which function: [the index](docs/DATABASE.md#function-and-trigger-index). |
| `dev/server.mjs` (945) | Local backend: PGlite + auth, REST (PostgREST subset, RPC), storage, `/__dev/auth-codes`, local sender and jobs. `startBackend(options)`. Owns its data folder (`backend.pid`), keeps `pg-backup`, recovers a damaged `pg`; `--reset`, `--check`. |
| `dev/bootstrap.sql` | Stubs Supabase's `auth` schema and roles. |
| `dev/seed.mjs` | Test accounts and the test world, written through the app's own calls by each role (local or hosted); `MCARE_SEED_BASIC=1` for accounts and a starter record only. |
| `dev/fingerprint.mjs` | `npm run db:schema`. |
| `dev/_audit.mjs` | One-off schema audit (triggers, missing `zz_touch_patient`, policies). |
| `functions/deliver/index.ts` | Hosted sender: providers per channel. |
| `tests/rules.test.mjs` (1,060) · `api.test.mjs` (502) · `ui.test.mjs` (719) | [docs/TESTING.md](docs/TESTING.md). |

### Big files by section

Read only the section you need (`Read` with `offset`/`limit`). Line numbers are as of 3 October 2026; if they have moved, grep the marker.

**`src/shared/state/AppContext.tsx`** — grep `/\* ─`:

| ≈ Line | Section |
| --- | --- |
| 23 | Where the record lives (`LIVE` = `backendConfigured`) |
| 72 | `interface Ctx`: every action's signature, grouped by `// Clinical`, `// Alerts`, `// Appointments`, `// Messages`, `// Notifications & audit`, `// Account self-service`, `// Support tickets` |
| 250 | `AppProvider`: `useState`s |
| 292 | live mode: loading and saving (`run` ≈ 386, records → state ≈ 420, sign-out reset ≈ 440) |
| 305 | notifications, audit, outgoing email (demo) |
| 359 | the clock; demo escalation |
| 510 | change-token polling; ≈ 550 Realtime |
| 577 | accounts |
| 791 | prescriptions, notes, doses (≈ 856 `rateDoctor`, the model action) |
| 919 | alert engine (demo mirror of `0004`) |
| 1156 | appointments & messages (`sendMessage`) |
| 1215 | availability |
| 1271 | support staff and appointments |
| 1299 | vitals report requests |
| 1362 | password recovery (demo) |
| 1565 | support tickets |
| 1587 | care plans |
| 1662 | admin figures, older audit entries |
| 1734 | care team (consulting doctors) |
| 1760 | provider `value` |

**`src/shared/lib/types.ts`**: accounts and users (top; `BaseUser` ≈ 124, `PatientUser` ≈ 534, `DoctorUser` ≈ 565, `AdminUser` ≈ 583), vitals, notifications, prescriptions, care plans (≈ 381), assignments (≈ 442), availability (≈ 481), alerts (`AppAlert` ≈ 591), appointments (≈ 664), `Outcome` (≈ 773), documents (≈ 803; `MedicalDocument` ≈ 940).

**`src/shared/lib/vitals.ts`**: grading and score (top), time helpers (133), the story of an alert (167), units (252), trends and insights (340), check-in cadence (538), groups (588).

**`src/shared/api/actions.ts`**: account (74), own record (122), vitals and alerts (165), medication and meals (238), care plans (252), availability (269), appointments (305), messages/notifications/reports (350), care coordination (372).

**`src/shared/api/records.ts`**: `Records` (28), date helpers (62), row mappers (88), `loadRecords` (205), `changeToken` (449), `searchAudit` (463).

**`supabase/dev/server.mjs`**: helpers and PostgREST parsing (45), the database folder: lock, backup, recovery (188), `startBackend` (272; auth ≈ 374, REST/RPC ≈ 550, storage ≈ 673, `/__dev` ≈ 773, sender and jobs ≈ 807), CLI: `--check`, `--reset`, start, signals (850).

---

## 7. Notifications and delivery

Every notification is written by the database in the same transaction as the change (`notify_*` in `0002_helpers.sql`) and shown in the app. A trigger queues it in `notification_deliveries` for each channel the person allows: email for all, SMS only for SOS / escalation / critical reading, push per allowed device. A sender claims batches and reports back: locally `server.mjs` prints every 10 s; hosted, `supabase/functions/deliver` sends through Resend, Africa's Talking or Twilio, and Web Push. A channel without a provider waits in the queue. Provider calls have **never been run**. Setup, secrets, scheduling and adding a notification: [docs/DELIVERY.md](docs/DELIVERY.md).

---

## 8. Keeping these docs true

These docs are only useful while they match the code. As part of every change:

- **New, renamed or deleted file** → its line in [§6](#6-code-map).
- **New migration** → [DATABASE.md](docs/DATABASE.md) migration table, function index and "next file number"; [§3](#data-and-saving) next number.
- **Feature added, finished or found broken** → [STATUS.md](docs/STATUS.md) (feature table, in progress, pending) and [PORTALS.md](docs/PORTALS.md).
- **Rule or ownership changed** → [DATA_MODEL.md](docs/DATA_MODEL.md).
- **Committed** → move the item out of "In progress" in STATUS.md and update the [§1](#1-snapshot) snapshot (date, commit, test counts).
- Big-file line numbers in §6 drift: refresh them when a section moves by more than ~50 lines.
- [README.md](README.md) is the human introduction; keep its Status section in step with STATUS.md.

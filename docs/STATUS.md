# Status

What works, what is in progress, and what is still to do. **Update this file whenever you finish, start or discover something** (see [AGENTS.md §8](../AGENTS.md#8-keeping-these-docs-true)).

Last updated: **7 October 2026** · branch `features` (not yet merged into `main`).

## Verified

Run on 5 October 2026 on the code committed on branch `features`.

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run test:db` | 356 passed, 0 failed |
| `npm run test:api` | 154 passed, 0 failed |
| `npm run test:ui` | 67 passed, 0 failed (phone, tablet, laptop) |

Never verified: a hosted Supabase project, any real email / SMS / push provider, a physical phone.

## In progress (uncommitted)

Nothing at the moment. Check `git status` too: work may have started since this was written.

## Recently finished

On branch `features` (pushed, not yet merged into `main`), tested (see above).

| Change | Files |
| --- | --- |
| **Delete read notifications.** Each read notification has a red delete button; "Clear read (N)" removes them all. Unread ones cannot be deleted. Email/SMS/push delivery records are kept. | `supabase/migrations/0012_clear_read_notifications.sql`, `src/shared/api/actions.ts` (`deleteNotification`, `clearReadNotifications`), `src/shared/state/AppContext.tsx`, `src/shared/ui/NotificationBell.tsx`, `supabase/dev/server.mjs` (outbox label), `rules.test.mjs`, `api.test.mjs`, `ui.test.mjs` |
| **Faster updates on the local backend.** The change check runs every 2 s locally (no Realtime there); hosted stays 15 s behind Realtime. | `src/shared/state/AppContext.tsx` (`CHECK_EVERY_MS`), `docs/DATA_MODEL.md`, `docs/RUNNING.md` |

Earlier, on `consulting-messages-and-docs` (merged into `main` as PR #1):

| Change | Files |
| --- | --- |
| **Patients message consulting doctors.** One private thread per patient–doctor pair (the treating doctor and each current consulting doctor); nobody else reads a pair's thread; ended relationships keep a read-only thread. | `supabase/migrations/0011_patient_doctor_messages.sql` (new `messages_send` policy), `src/shared/state/AppContext.tsx` (`sendMessage` demo rule), `src/patient/MessagesTab.tsx`, `src/doctor/MessagesTab.tsx`, `src/doctor/DoctorApp.tsx` (Chat badge counts consulted patients), tests in all three suites |
| **Sign-up explains what is missing.** The Sign up button stays enabled and names every missing or invalid field instead of silently staying disabled. | `src/shared/auth/SelfRegisterScreen.tsx`, `ui.test.mjs` |
| **Test OTPs only in dev builds.** The on-screen one-time code and "Open test activation link" now also require `import.meta.env.DEV`, so a production build never asks for them. | `src/shared/api/authBackend.ts`, `src/shared/auth/LiveAuth.tsx`, `src/shared/auth/LoginScreen.tsx` |
| **Welcome and auth spacing.** Larger feature label, smaller mobile headline, a soft surface behind the feature preview on mobile and tablet, more space around "Get started". | `src/shared/auth/AuthShell.tsx`, `src/shared/auth/WelcomeScreen.tsx` |
| **Docs restructured** (separate commit). AGENTS.md became the always-loaded agent guide with a word-to-code glossary and a working routine; reference detail moved to `docs/`. | `AGENTS.md`, `README.md`, `docs/*` |

## Feature status

**Done** = built in both modes, covered by rule, API and browser tests. **Done, no browser test** = built and covered by rule/API tests only. **Unverified** = written but never run against the real service.

### Accounts and access

| Feature | Status |
| --- | --- |
| Patient sign-up, email confirmation, sign-in, sessions, password reset by code | Done |
| Password change (signs out other devices), "sign out of all other devices" | Done |
| Consent recorded on the server; deactivate own account | Done |
| Doctor / staff registration by invitation; invitation email | Done |
| Withdrawing an invitation | Done, no browser test |
| Doctor approval (approve, send back, reject, resubmit) | Done, no browser test |
| Suspend / deactivate / reactivate with reason; assistant permissions | Done |
| Row-level security on every table; restrictive "active accounts only" | Done |
| Social sign-in (Google etc.) | Unverified: needs a hosted project with providers; hidden on the local backend |

### Clinical

| Feature | Status |
| --- | --- |
| Vitals: log one / group / all, server grading, trends, units, 15-minute correction | Done |
| Alerts: raise, re-measure, acknowledge, escalate, comment / action / instruction, resolve, follow-up booking | Done |
| Escalation of unacknowledged critical alerts (10 min) | Done locally (interval in `server.mjs`); `pg_cron` schedule unverified |
| SOS and "I'm safe now" | Done |
| Targets, critical ranges, tracked vitals, history | Done |
| Prescriptions: prescribe, stop, restart, history, filed as a document; auto-complete at end date | Done |
| Clinical notes (shared / internal, corrected by a new note) | Done |
| Care plans (goals, interventions, steps, events) | Done |
| Meal plans, meal and water logs | Done |
| Vital definitions (admin) | Done, no browser test |

### Care coordination and communication

| Feature | Status |
| --- | --- |
| Assign / move / remove doctor, history, patient requests | Done |
| Consulting doctors (add, read-only access, leave) | Done |
| Private messages: patient ↔ treating doctor | Done |
| Private messages: patient ↔ consulting doctor | Done (migration 0011) |
| Appointments: request, confirm, decline, propose, accept, complete, no-show, cancel | Done |
| Support moving / cancelling an appointment | Done, no browser test |
| Doctor working hours, visit length, days away; slot picker | Done; slot picker with a timetable: no browser test |
| Support tickets | Done |
| In-app notifications, mark read, delete read ones | Done |
| Delivery queue (email, SMS, push), choices per person, delivery report | Done (queue); provider calls Unverified |
| Push on the device (service worker, subscription) | Unverified: needs VAPID keys and https |

### Documents

| Feature | Status |
| --- | --- |
| Uploads with type/signature/macro/size checks (in the browser) | Done |
| Official documents: draft, sign, release, correct, versions, history | Done |
| Vitals report builder with abnormal readings and their stories; patient report requests | Done |
| Download (original, PDF via print, .docx, web page), zip of the library | Done |
| Share links (report content only) | Done |
| Admin registry, support access (15 min, reasoned), restore, purge | Done; restore as support: no browser test |
| Storage bucket and its rules on hosted Supabase | Unverified |

### Platform

| Feature | Status |
| --- | --- |
| Demo mode (in-memory sample data) | Done |
| Local backend (PGlite + Supabase API subset) | Done |
| Live updates: change token polling (2 s local, 15 s hosted) | Done |
| Live updates: Realtime on hosted Supabase | Unverified |
| Responsive layout: phone, tablet, laptop | Done (emulated) |
| Phone over Wi-Fi (`npm run phone`) | Done by hand; not in the test suite |

## Pending before production

In rough order. None of these is started.

1. **Hosted Supabase project**: run the migrations, enable `pg_cron`, confirm the storage bucket, Realtime publication and scheduled jobs work ([RUNNING.md](RUNNING.md#hosted-supabase)).
2. **Delivery**: deploy `supabase/functions/deliver`, set provider secrets, schedule it, send one email, one SMS and one push and confirm each ([DELIVERY.md](DELIVERY.md)).
3. **Email confirmation on** in the hosted project (staff invitations depend on it).
4. **Legal text**: replace the plain-language summary in `src/shared/auth/Legal.tsx` with the reviewed text.
5. **Demo email preview flags**: `src/shared/auth/VerificationScreen.tsx` and `ForgotPassword.tsx` let demo mode open the "sent" email on screen; switch off once real delivery exists.
6. **Server-side file checks**: uploads are checked in the browser only; add a server function that scans files.
7. **Files through share links**: only report content can be shared with someone without an account; files need a server function issuing signed links.
8. **Test on physical phones** (iOS Safari, Android Chrome).
9. **CI**: no pipeline exists (`.github/` is absent). Run `npm run typecheck` and `npm test` on every push; `test:ui` nightly.
10. **`.env.example`**: allowed by `.gitignore` but not present; add one naming every variable in [RUNNING.md](RUNNING.md#environment).
11. Backups and retention policy are the host's; decide and document them.

## Known gaps and limits

1. **Hosted Supabase never used.** The local backend implements only the part of the API the app calls; a hosted project may differ in details.
2. **Sign-out elsewhere:** on hosted Supabase an access token already issued stays valid until it expires (up to an hour).
3. **Encryption:** hosted Supabase encrypts at rest and in transit; the local database is not encrypted and the local network is plain http. Test data only.
4. **Staff invitations** are only as safe as email confirmation (off on the local backend unless `MCARE_CONFIRM_EMAIL=1`).
5. **Clinical scope:** a doctor cannot correct a patient-entered value (mark invalid and record a new one); one treating doctor per patient; availability has no holiday calendar; a filed prescription document is not rewritten when the medicine stops (the stop is in its history); a critical alert is never closed by a number alone.
6. **Admin scope:** no messaging for staff (support requests instead); no system settings screen beyond vital definitions.
7. **Account changes spanning several tables** for another person (`updateUser` in `AppContext`) are several requests, not one transaction. Patient screens do not use that path.

## Technical debt

- `src/shared/state/AppContext.tsx` is 1,800 lines: every piece of state and every action, both modes, in one provider. Navigate it by its section markers ([AGENTS.md §6](../AGENTS.md#big-files-by-section)); a split by domain would help.
- `src/shared/lib/types.ts` (1,000 lines) holds every app type.
- Shared profile and auth screens (`AccountSheets`, `NotificationsSheet`, `VerificationScreen`, `DoctorStatusScreen`, `SocialAuth`) still call `updateUser` directly rather than a named action.
- `PageTitle` (older) is still used in two files; new screens use `Page`.
- No linter beyond `oxfmt` formatting and `tsc`.

## Recent history

| Commit | What |
| --- | --- |
| (next) | Docs restructured: AGENTS.md agent guide, `docs/` reference |
| `bcbab19` | Patients message consulting doctors; clearer sign-up errors; test OTPs only in dev builds |
| `a83d947` | Deleted unwanted files |
| `fe64f46` | Notifications by email, text message and push, as each person chooses |
| `128326c` | Unified messaging, consulting doctors, email queue and audit search |
| `6c95964` | Real-data backend (Supabase, local backend, migrations) |
| earlier | Welcome page, authentication design, patient home and dashboard |

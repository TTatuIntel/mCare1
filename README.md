# mCare

**Remote patient monitoring for patients, their doctors and the care team.**

Patients log vitals, medicines, meals and water from their phone. Their doctor follows every reading, answers alerts, prescribes, writes notes and care plans and issues signed reports. Administrators and mCare assistants run approvals, assignments, support and the audit trail. Every role works on the same record; the database decides who may see and change what, and audits every change.

![React 19](https://img.shields.io/badge/React-19-61dafb) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6) ![Vite](https://img.shields.io/badge/Vite-8-646cff) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8) ![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e)

---

## Status

*As of 3 October 2026. Detail: [docs/STATUS.md](docs/STATUS.md).*

| | |
| --- | --- |
| **Works** | All four portals, end to end, against the bundled local backend (real Postgres) and in demo mode. Phone, tablet and laptop layouts. |
| **Tested** | Typecheck clean · 354 database-rule checks · 153 API checks · 66 browser checks across all portals at three screen widths: all passing. |
| **Recently finished** | Private messages between a patient and each consulting doctor; clearer sign-up errors; test codes only in dev builds; welcome-screen spacing. |
| **Not yet done** | Running on a hosted Supabase project · real email, SMS and push providers · reviewed legal text · server-side file scanning · sharing files (not just reports) by link · physical-phone testing · CI. |

## Features

| Portal | Highlights |
| --- | --- |
| **Patient** | Vitals with server-side grading, trends and history · alerts with one-tap **Re-measure** (an in-range reading clears a warning automatically) · SOS · medication schedule · meal plan and water · appointments · private chats with the treating doctor and each consulting doctor · medical documents with private sharing · notifications by email, SMS and push |
| **Doctor** | Patients ranked by risk · alert workflow: acknowledge, request a re-measurement, comment, record actions and instructions, resolve or book a follow-up · readings, targets and critical ranges · prescriptions · clinical notes · care plans · meal plans · appointments and working hours · signed vitals reports showing every abnormal reading and how it was resolved · consulting doctors |
| **Admin / Assistant** | Doctor approvals · registration by invitation · account status · doctor assignment and history · alert monitoring · appointment and support desk · document registry and recovery · searchable audit log · operational reports · assistants limited to the permissions they are granted |

Built for clinical safety: nothing clinical is deleted or rewritten (readings are marked invalid, notes are corrected by new notes, prescriptions are stopped), a critical alert is always closed by a clinician, a form sent twice saves once, and nothing is shown as saved before the database has answered.

## Architecture

```text
 Phone / tablet / laptop browser
 ┌─────────────────────────────────────────────┐
 │ React app (Vite)                            │
 │  patient · doctor · admin · assistant       │
 │  one data hook per portal → AppContext      │
 └──────────────────────┬──────────────────────┘
                        │ supabase-js, as the signed-in person
 ┌──────────────────────▼──────────────────────┐
 │ Supabase: Postgres + Auth + Storage         │
 │  row-level security on every table          │
 │  triggers: grading, alerts, history,        │
 │  notifications, audit, change counters      │
 └──────────────────────┬──────────────────────┘
                        │ delivery queue
              supabase/functions/deliver → email · SMS · push
```

Without backend keys the app runs in **demo mode** on sample data kept in memory. With them it runs in **live mode** against Postgres, either a hosted Supabase project or the bundled local backend.

## Quick start

Requires **Node.js 22+**.

```sh
npm install
npm i --no-save @electric-sql/pglite   # local database engine (kept out of package.json on purpose)

npm run backend                        # terminal 1: local Postgres + Supabase API, writes .env.local
npm run dev                            # terminal 2: the app at http://localhost:8443
npm run backend:seed                   # once: test accounts
```

Sign in with `test.patient@mcare.test`, `test.doctor@mcare.test`, `test.admin@mcare.test` or `test.assistant@mcare.test`, password `A1b23`.

To try it on a phone on the same Wi-Fi, run `npm run phone` and open `http://<laptop IP>:8444`.

## Scripts

| Command | Purpose |
| --- | --- |
<<<<<<< Updated upstream
| `npm run dev` | Development server with hot reload |
| `npm run build` · `npm run preview` | Production build · serve it |
| `npm run phone` | Build and serve on port 8444 for phones |
| `npm run backend` · `npm run backend:seed` · `npm run backend:reset` | Local database and API · test accounts · start the local database afresh |
| `npm run typecheck` | TypeScript check |
| `npm test` | Every access rule and workflow, in SQL and over HTTP |
| `npm run test:ui` | All four portals in a headless browser, at phone, tablet and laptop width |
| `npm run format` | Format with oxfmt |
=======
| Patient (two weeks of readings, an open alert, medicines, messages) | `test.patient@mcare.test` |
| Doctor (treats Patient One and Two) | `test.doctor@mcare.test` |
| Doctor (consulting on Patient One) | `test.doctor2@mcare.test` |
| Admin | `test.admin@mcare.test` |
| Assistant | `test.assistant@mcare.test` |

Three more (a stable patient, a patient waiting for a doctor, a doctor waiting for approval) and what each one holds: [Test accounts](#test-accounts).

### Every day after that

| To | Run |
| --- | --- |
| Start again | `npm run backend` in one terminal, `npm run dev` in another. Everything saved is still there. |
| Stop | **Ctrl+C** in each terminal (the backend keeps a copy of the database at each clean stop). |
| Get the latest code | `git pull`, then `npm install`, then `npm i --no-save @electric-sql/pglite`. `npm run backend` adds new database changes by itself. |
| Put the test accounts' passwords back | `npm run backend:seed` (safe to repeat) |
| Start over with a fresh database | stop the backend, `npm run backend:reset`, then `npm run backend` |
| Use it on a phone on the same Wi-Fi | `npm run phone`, then open `http://<laptop address>:8444` on the phone: see [On a phone](#on-a-phone) |
| Look around without a database | `npm run dev` alone, with no `.env.local` file: **demo mode**, sample people in the browser, nothing saved ("Try a demo account" on the welcome page) |

### If something goes wrong

| You see | Do |
| --- | --- |
| `'npm' is not recognized` / `command not found: node` | Install Node.js (step 1) and open a new terminal. |
| PowerShell: `npm.ps1 cannot be loaded because running scripts is disabled` | Use Command Prompt instead, or run once in PowerShell: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `Cannot find package '@electric-sql/pglite'` | `npm i --no-save @electric-sql/pglite` (step 3, second line) |
| The sign-in page says mCare cannot be reached | The backend is not running: `npm run backend` in another terminal. |
| `Port 54321 is already in use` / "Another mCare backend is already using…" | A backend is already running in another terminal: use that one, or stop it there with Ctrl+C (or `npm run backend:stop`). |
| Port 8443 is busy | Another `npm run dev` is running; close it, or start on another port: `npx vite --port 8450` |
| "Built from the old migration history" | `npm run backend:reset`, then `npm run backend` |

More cases under [Commands](#commands).

## Running mCare

Setup, every command, test accounts, phones, hosted Supabase and hosting.

### Modes

| Mode | When | Where the data lives |
| --- | --- | --- |
| **Live** | `.env.local` sets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` | Postgres. Everything saved survives a refresh, a new session, another device. |
| **Demo** | no `.env.local` | Sample people kept in the browser's memory (`src/shared/state/demoData.ts`). Nothing is saved. |

Screens never check which mode is running: `AppContext` picks the live or in-memory branch inside each action (see [AGENTS.md §3](AGENTS.md#3-code-rules)).

### First time and start

Step by step from a fresh download: [Install and run](#install-and-run-from-github). Needs Node.js 22 or newer (`.mise.toml` pins Node 22 and pnpm 10). PGlite (and Playwright, for the browser tests) are installed with `--no-save`, so they stay out of `package.json` and `pnpm-lock.yaml`; install them in one command when you need both (`npm i --no-save @electric-sql/pglite playwright`), since each `npm install` removes what `package.json` does not list.

`npm run backend` applies any migration the database has not had yet, seeds a new database, prints the addresses to open and writes `.env.local`, which switches the app to live mode (the dev server restarts by itself). A migration added while it runs is applied the first time the app asks for something it adds.

### Test accounts

Created by `npm run backend:seed` (and by `npm run backend` for a new database). Every one is named "Test …" with an `@mcare.test` address and every record is labelled TEST, so test records cannot be mistaken for real patients. Password: `M7c24` (exactly five characters; set `MCARE_SEED_PASSWORD` before seeding to choose another). Reseeding resets the seeded accounts to this password; the test world below is built only once (`npm run backend:reset` starts over).

| Role | Email | What is there to test |
| --- | --- | --- |
| Patient | `test.patient@mcare.test` | Test Patient One, under Dr. Test Achieng, health setup done (hypertension, type 2 diabetes, penicillin allergy, a next of kin). Two weeks of readings (blood pressure twice a day, heart rate, sugar, weight, SpO₂, temperature) drifting up; today's blood pressure high twice, so **one open alert**. Amlodipine and Metformin, blood-pressure and sugar targets, a meal plan, an active care plan, Dr. Test Mutua as consulting doctor, a visit requested and one booked, messages with both doctors, a report request. |
| Patient | `test.patient2@mcare.test` | Test Patient Two, under Dr. Test Achieng, stable (asthma); a visit request, a message, a support ticket. |
| Patient | `test.patient3@mcare.test` | Test Patient Three, no doctor yet: has asked for Dr. Test Mutua (decide as admin or assistant in Care Assignments). |
| Doctor | `test.doctor@mcare.test` | Dr. Test Achieng, approved; treats Patients One and Two; Mon–Fri 9–5, 30-minute visits. |
| Doctor | `test.doctor2@mcare.test` | Dr. Test Mutua, approved; consulting doctor for Patient One; same hours. |
| Doctor | `test.doctor3@mcare.test` | Dr. Test Wanjiru, **waiting for approval** (Doctor Approvals). |
| Admin | `test.admin@mcare.test` | |
| Assistant | `test.assistant@mcare.test` | Approves doctor requests, assigns doctors, monitors patients, handles support. |

Every record is written through the same calls the app makes, by the role that would make it, so alerts, notifications and the audit trail are real. The one exception: on the local backend the seed then moves its readings into the past days (`/__dev/backdate-readings`, service key, `@mcare.test` patients only, off when `NODE_ENV=production`), because the API stamps every reading with the server's clock. A hosted project gets today's readings only. `MCARE_SEED_BASIC=1` seeds the accounts and the small starter record only (the browser tests use it).

New patients can also sign up from the welcome page. The local backend confirms the email at once by default; set `MCARE_CONFIRM_EMAIL=1` before starting it to test signup verification.

**Two-step sign-in on the local backend.** Profile → Two-step sign-in works locally with any authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Scan the QR code (the local backend draws one with `supabase/dev/qr.mjs`, as a hosted project does), or type in the setup key, or tap the `otpauth://` link on the phone itself. To try "required for a role": sign in as `test.admin@mcare.test`, turn two-step sign-in on for yourself, then Home → Settings → require it for doctors; the next doctor sign-in is taken through setting it up. A lost phone: Users → the person → Reset two-step sign-in.

**Google and Apple on the local backend.** There is no real Google or Apple to go to locally, so in the dev app (`npm run dev`) "Continue with Google / Apple" opens a stand-in page served by the backend (`/auth/v1/authorize`, marked "Local testing only"): type any email (and a name for a new account) and it returns to the app signed in, the way the real provider would. A new email becomes an active patient; the email of an existing, confirmed patient account signs into that account (Supabase links identities by verified email); an account still waiting for its email confirmation is refused, and so are doctor and staff accounts (anyone who can reach the dev server could type their email; they sign in with their password). The stand-in only exists in test builds (off when `NODE_ENV=production`, hidden in `npm run phone`) and only returns to addresses on this machine or the local network.

**Real Google sign-in on the local backend.** With a Google OAuth client, the local backend signs people in with their real Google account (Apple stays a stand-in: Apple accepts only https return addresses on a registered domain):

1. In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services: configure the **OAuth consent screen** (External, app name mCare, your support email; scopes `openid`, `email`, `profile`; while it is in "Testing", add each Google account that will sign in under **Test users**).
2. **Credentials → Create credentials → OAuth client ID**, type **Web application**. Authorised redirect URI: `http://localhost:8443/auth/v1/callback` (Google allows plain http only for `localhost`, so not for `192.168.x.x`).
3. **Download JSON** and save it as `supabase/.data/google-oauth.json` (ignored by git, beside the backend's other keys). Or set `MCARE_GOOGLE_CLIENT_ID` and `MCARE_GOOGLE_CLIENT_SECRET`; `MCARE_GOOGLE_REDIRECT_URI` if the app runs on another port. Never put the secret in the app, `.env.local` or a commit.
4. Restart `npm run backend`: it prints `Google     real sign-in`. Open the app **on this laptop** at `http://localhost:8443` and press "Continue with Google".

What happens: the backend sends the browser to Google with a one-time `state` and `nonce`, Google returns a code to `/auth/v1/callback`, the backend trades it (with the secret) for Google's ID token, checks it is for this client, this sign-in and an email Google has verified, then signs the person in. A new email becomes an active patient with the name from Google; an existing account with that email is opened, whatever its role (two-step sign-in and doctor approval still apply); an account registered with that email but never confirmed is confirmed for its owner and the password its registrant chose stops working. A phone on the Wi-Fi cannot use real Google locally (Google will not return to a network address); it gets it once mCare is hosted on https.

**Password reset on the local backend.** "Forgot password?" sends a reset email only to an address confirmed at registration (the answer on screen is the same either way, so nobody can test which emails have accounts). The email carries a link and a 6-digit code; they expire together after 10 minutes, and using either spends both. After the new password is saved, every other device is signed out and the person gets a "Your password was changed" notice in the app and by email (migration `0018`).

**One-time codes on the local backend.** The backend prints every signup and recovery code (and the reset link) in its terminal. In the dev app (`npm run dev`) the verification screen also shows the code, signup offers an "Open test activation link" and password reset an "Open test reset link". These come from the backend's `/__dev/auth-codes` endpoint (`supabase/dev/server.mjs`, on unless `NODE_ENV=production`, proxied by `vite.config.ts`). The app only asks for them when `import.meta.env.DEV` is true and the backend is local (`localBackend` in `src/shared/api/supabase.ts`). Production builds and hosted Supabase never expose codes.

### On a phone

Use the built app: `npm run phone`, then open `http://<laptop address>:8444` on the phone. The dev server on 8443 sends the code unbundled (about 140 files, 10 MB), which takes around a minute over a hotspot; `npm run phone` builds it (about 15 files, 1.2 MB compressed) and serves it with the same backend forwarding. It does not update by itself: after changing code, run it again and reload the phone.

- Same Wi-Fi or hotspot as the laptop. Never `localhost` or `127.0.0.1` on the phone: there they mean the phone.
- One address is enough: the app's server forwards `/auth/v1`, `/rest/v1`, `/storage/v1` and `/__dev` to the backend, which listens on the laptop only. `VITE_SUPABASE_URL=/` means "the address this page was opened from", so one setting works on both devices.
- **Firewall** (Windows): allow inbound Node.js on the active profile, e.g. PowerShell as Administrator: `New-NetFirewallRule -DisplayName "mCare dev server" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8443,8444`.
- **Address**: `ipconfig` gives the Wi-Fi adapter's IPv4 address. A VirtualBox or VPN adapter address (such as `192.168.56.1`) is not reachable from the phone.
- **Guest or client-isolation Wi-Fi** blocks devices from seeing each other; use a hotspot or home network.
- **Looks more static than the laptop?** The phone is asking apps to reduce motion (iOS Settings → Accessibility → Motion → Reduce Motion; Android "Remove animations"; often switched on by a battery saver). mCare follows it by default and then fades and glows in place instead of moving. To see every animation on that phone: Profile → Theme & Font → Animations → **Full** (kept on that device only). One rule decides it, `shared/layout/motion.ts`.
- **Plain http, not https.** Over the network address the phone does not treat mCare as a secure site, so browsers allow no push notifications there (Profile → Notifications says so). Everything else works the same as on the laptop.

Try: log a reading on the phone and watch it reach the laptop at once (the local backend tells every open app the moment something is saved; the 15-second check is the fallback); sign in as the test doctor on the laptop, resolve the alert with a note, and watch it arrive on the phone.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | The app with hot reload (port 8443). |
| `npm run backend` | The local database and API. Data is kept in `supabase/.data/pg`; a new database gets the test accounts automatically. Each clean stop (Ctrl+C or closing the terminal) keeps a copy in `supabase/.data/pg-backup`. |
| `npm run backend:seed` | Creates or refreshes the test accounts. Safe to repeat. |
| `npm run backend:stop` | Stops a running backend cleanly from another terminal (for one started in the background, where Ctrl+C cannot reach it). Uses the service key in `supabase/.data/keys.json`; the app and phones cannot. |
| `npm run backend:reset` | Deletes the local database and its copies (refuses while a backend is running); `npm run backend` then starts a new, seeded one. |
| `npm run db:schema` | Prints everything the migrations build, for comparing two versions of them (`supabase/dev/fingerprint.mjs`). |
| `npm run phone` | Production build served on port 8444, for phones. |
| `npm run build` / `npm run preview` | Production build into `dist/` / serve it. `vite build --mode development` gives a readable build with inline source maps. |
| `npm run typecheck` | TypeScript check of the app and the Edge Function, unused code included. Run after changing `src/` or `supabase/functions/`. |
| `npm run format` | oxfmt. |
| `npm test` | Database rules and API workflows (`test:db` + `test:api`). Run after changing a migration. |
| `npm run test:ui` | The four portals in a headless browser; fails on any console warning or error. Needs Playwright; several minutes. See [§12 Testing](AGENTS.md#12-testing). |

- **Empty database:** stop the backend, `npm run backend:reset`, then `npm run backend` (it seeds the new database itself).
- **"Port 54321 is already in use" / "Another mCare backend is already using…"**: a backend is already running in another terminal. Use that one, or stop it there with Ctrl+C. Only one backend may open a database folder: two at once is what damaged it before.
- **"The backend stopped by itself"**: its terminal now always says why and when, e.g. `16:02:31  Stopping the backend: Ctrl+C` / `this terminal is closing` / `asked by "npm run backend:stop" from another terminal`. A bug is printed in full ("The backend hit an unexpected error") and the database is still closed cleanly. Two `npm run backend` started together: exactly one runs, the other refuses before opening the database.
- **Backend killed** (Task Manager, a crash, power): the next `npm run backend` checks the folder in a separate process. If it opens, it carries on ("the database recovered"); if not, it moves it aside to `supabase/.data/pg-unreadable-<time>` (the two newest are kept) and brings back `pg-backup`, the copy from the last clean stop, or creates a new seeded database if there is none. Work since that last clean stop is in the set-aside folder only.
- **Back to demo mode:** delete `.env.local`.
- **Backend not running:** the sign-in page says so and names the command; nothing is shown as saved.
- **"Built from the old migration history"**: `npm run backend` stops with this message for a database made before the 3 October 2026 baseline. Run `npm run backend:reset`, then `npm run backend` and `npm run backend:seed`.

### Environment

All optional. `.env.example` lists every variable (without values); copy it to `.env.local` for a hosted project.

| Variable | Default | Used by |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | unset (demo mode) | the app; written to `.env.local` by `npm run backend` |
| `VITE_VAPID_PUBLIC_KEY` | unset (push off) | the app; see [§10 Notifications](#configuring-the-hosted-sender) |
| `MCARE_BACKEND_PORT` / `MCARE_BACKEND_HOST` | `54321` / `127.0.0.1` | local backend, and the dev proxy |
| `MCARE_BACKEND_URL` | `http://127.0.0.1:$MCARE_BACKEND_PORT` | the dev proxy target |
| `MCARE_DATA_DIR` | `supabase/.data` | local backend |
| `MCARE_CONFIRM_EMAIL=1` | off | new accounts must enter the emailed code |
| `MCARE_SEED_PASSWORD` | `M7c24` | seed script |
| `PORT` / `HOST` | `8443` / `0.0.0.0` | dev server and preview |
| `BASE_URL` | `/` | the path the app is served under |
| `PLAYWRIGHT_PATH` | unset | `test:ui`, a project that has Playwright installed |

`supabase/.data` (database, signing keys, uploaded files, UI-test screenshots), `.env.local` and `dist/` are ignored by git.

### Hosted Supabase

The app code does not change.

1. Create a project and run `supabase/migrations` in order (SQL editor, or `supabase db push`).
2. Enable `pg_cron` first: `0010_reference_data_jobs.sql` then schedules alert escalation (every minute), the nightly purge of deleted documents and the completion of finished prescriptions, and creates the private `documents` storage bucket and its rules when the storage schema exists.
3. In `.env.local` (or the host's build environment): `VITE_SUPABASE_URL=https://<project>.supabase.co`, `VITE_SUPABASE_ANON_KEY=<anon key>`.
4. Test accounts there: `SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run backend:seed`. The service key never goes into the app.
5. Keep email confirmation **on** (staff invitations rely on it). In Authentication settings also: enable MFA (TOTP); minimum password length 5 with uppercase and a number to match the app (decision D-5); leaked-password protection and CAPTCHA (Pro plan); site URL and redirect URLs limited to the production and staging addresses; Google and Apple providers (decision D-7, below). Turn on the "password changed" security email too (Authentication → Emails → Security), or rely on the in-app notice and email that migration `0018` sends.
   - **Reset email**: Authentication → Emails → Reset password. Keep both the link and the code in the template, e.g. `<a href="{{ .ConfirmationURL }}">Reset your password</a> … or enter this code: {{ .Token }}`. Set the email OTP expiry to 600 seconds (10 minutes) to match the local backend. Hosted Supabase sends the reset email to any registered address; with email confirmation on, opening the link also proves the address.
   - **Google**: in Google Cloud Console create an OAuth client (type "Web application") with the authorised redirect URI `https://<project>.supabase.co/auth/v1/callback`, and the consent screen with the scopes `email`, `profile`, `openid`. Paste the client ID and secret into Supabase → Authentication → Sign In / Providers → Google.
   - **Apple** (Apple Developer Program needed): create an App ID with "Sign in with Apple", a Services ID whose return URL is `https://<project>.supabase.co/auth/v1/callback`, and a Sign in with Apple key (.p8). In Supabase → Providers → Apple enter the Services ID, Team ID, Key ID and generate the secret from the key; it expires after 6 months, so diarise renewing it. Apple may hide the email (a relay address) and sends the name only on the first sign-in.
   - Supabase links a provider sign-in to an existing account with the same **verified** email, so a person who registered with a password and later taps "Continue with Google" lands in the same record. The buttons appear by themselves once the app points at the hosted project.
6. Deploy `supabase/functions/deliver` for email, SMS and push ([§10 Notifications](#configuring-the-hosted-sender)).
7. `npm run build` and host `dist/` on any static host: see Hosting below.

### Hosting (decision D-3: host to be chosen)

`npm run build` writes `dist/` and, beside it, `dist/_headers` with the production security headers (Content-Security-Policy with the hashes of the two inline scripts and the Supabase project as the only API origin, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy). Netlify and Cloudflare Pages apply `_headers` as it is. On Vercel, put the same headers in `vercel.json`; on your own server (nginx, Caddy), copy them into its configuration. Build with the production `VITE_SUPABASE_URL` set, so the policy names the right project. Check at https://securityheaders.com after the first deploy. Details: [§11 Security → The browser and transport](AGENTS.md#the-browser-and-transport).

Checklist for any host: https only; the build environment holds only the public values (`VITE_*`); separate development, staging and production Supabase projects; production data never copied to the others; deploys from `main` after CI passes ([`.github/workflows/ci.yml`](.github/workflows/ci.yml): typecheck, `npm test` and a build on every push; the browser suite on pull requests to `main` and nightly).

## Notifications by email, SMS and push

Every notification appears in the app and is queued by the database for email, text message (only what cannot wait: SOS, escalation, a critical reading) and push, as each person chooses in Profile → Notifications. Locally the backend prints them instead of sending; on a hosted project the Edge Function `supabase/functions/deliver` sends them. A channel without a provider simply waits in the queue. How it works in detail: [AGENTS.md §10](AGENTS.md#10-notifications-and-delivery).

### Configuring the hosted sender

Set the secrets for the providers you have, deploy, and call the function every minute.

```sh
supabase secrets set MCARE_APP_URL=https://your-mcare-address
# Email (Resend)
supabase secrets set MCARE_EMAIL_PROVIDER=resend RESEND_API_KEY=… MCARE_MAIL_FROM="mCare <no-reply@your-domain>"
# Text messages: Africa's Talking …
supabase secrets set MCARE_SMS_PROVIDER=africastalking AT_USERNAME=… AT_API_KEY=… AT_SENDER_ID=…   # sender id optional
# … or Twilio
supabase secrets set MCARE_SMS_PROVIDER=twilio TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… TWILIO_FROM=+1…
# Push (Web Push): generate a key pair once with  npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:support@your-domain

supabase functions deploy deliver --no-verify-jwt
```

Run it every minute with the service key (it refuses any other caller), for example from the database with `pg_cron` and `pg_net`:

```sql
select cron.schedule('mcare-deliver', '* * * * *', $$
  select net.http_post(url := 'https://<project>.supabase.co/functions/v1/deliver',
                       headers := jsonb_build_object('Authorization', 'Bearer <service role key>'))
$$);
```

For push, the app also needs the **public** key in its build environment: `VITE_VAPID_PUBLIC_KEY=<the same VAPID_PUBLIC_KEY>`. Push needs the app on an https address (or `localhost`). Without the key, Profile → Notifications says push is not set up yet and offers nothing to switch on.

## Testing

| Command | What it checks | When |
| --- | --- | --- |
| `npm run typecheck` | The whole app and the Edge Function (`tsc`, unused code is an error). | After changing `src/` or `supabase/functions/`. |
| `npm test` | Every access and clinical rule in SQL, as each kind of user (`test:db`), and every workflow over HTTP with the real client (`test:api`). | After changing a migration or the local backend. |
| `npm run test:ui` | All four portals in headless Chromium at phone, tablet and laptop width; each step confirmed in the database; any console warning or error fails it. Needs `npm i --no-save @electric-sql/pglite playwright && npx playwright install chromium`. | After changing screens (several minutes). |

Each suite builds its own in-memory database from `supabase/migrations`, so none needs a running backend. CI (`.github/workflows/ci.yml`) runs typecheck, `npm test` and a build on every push, and the browser suite on pull requests to `main` and nightly. Writing a check: [AGENTS.md §12](AGENTS.md#12-testing).

## Keeping the application clean

Every check below passes today; keep it that way in each change.

| Check | Guaranteed by |
| --- | --- |
| No TypeScript errors or warnings, no unused variables, imports or parameters | `npm run typecheck` (`strict`, `noUnusedLocals`, `noUnusedParameters` in `tsconfig.json`; the Edge Function through `supabase/functions/tsconfig.json`) |
| A build without warnings | `npm run build`: React is split into its own cached file (`codeSplitting` in `vite.config.ts`), so no file passes Vite's 500 kB limit |
| No warnings or errors in the browser console | `npm run test:ui` fails on any console warning or error in any portal, at phone, tablet and laptop width (the app runs as a development build there, so React's own warnings count) |
| Every access rule and workflow | `npm test` (database rules and API) |
| Two documents, no leftovers | Only `README.md` and `AGENTS.md`; no `.txt` files, no one-off scripts, no other tools' folders. A new topic becomes a section in one of them. |

CI (`.github/workflows/ci.yml`) runs the typecheck, `npm test` and the build on every push, and the browser suite on pull requests to `main` and nightly.

## Security

The database is the final gatekeeper: row-level security on every table follows real care relationships; two-step sign-in (an authenticator app) is each person's choice and an admin can require it per role, enforced by the database itself; a patient's clinical record cannot be deleted; every change is audited with who, when, from which device and for whom; doctors' signatures and contact details are private; idle sessions sign out; the production build ships strict security headers. The full architecture, the control matrix and how the security plan maps to the code: [AGENTS.md §11](AGENTS.md#11-security).
>>>>>>> Stashed changes

## Project layout

```text
src/
  shared/      UI kit, app state, API layer, domain logic, documents, email, layout
  patient/     patient portal
  doctor/      doctor portal
  admin/       admin portal
  assistant/   assistant portal (admin screens, gated by permissions)
supabase/
  migrations/  the database: schema, helpers, one file per domain, security, reference data, changes since
  dev/         local backend and seeding
  functions/   deliver: email, SMS and push sender
  tests/       rule, API and browser tests
docs/          reference: status, data model, database, portals, delivery, testing, running
public/        logo, push service worker, robots.txt
```

## Deploying

1. Create a Supabase project, enable `pg_cron`, and run `supabase/migrations` in order. Keep email confirmation on.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the build, then `npm run build` and host `dist/` on any static host.
3. Deploy `supabase/functions/deliver` with the email, SMS and push provider keys, and schedule it.

Step by step: [docs/RUNNING.md](docs/RUNNING.md#hosted-supabase) and [docs/DELIVERY.md](docs/DELIVERY.md).

## Documentation

| Document | For |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Anyone changing the code (people and coding agents): code rules, a map of every file, where each kind of change goes, step-by-step recipes |
| [docs/STATUS.md](docs/STATUS.md) | What works, what is in progress, what is pending, known gaps |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Who owns each record, who may do what, workflows |
| [docs/DATABASE.md](docs/DATABASE.md) | Migrations, tables, access rules, what the database does by itself |
| [docs/PORTALS.md](docs/PORTALS.md) | Each portal's features, screens and the tables behind them |
| [docs/DELIVERY.md](docs/DELIVERY.md) | Notifications by email, SMS and push |
| [docs/TESTING.md](docs/TESTING.md) | The test suites and how to add a check |
| [docs/RUNNING.md](docs/RUNNING.md) | Setup, environment, phones, hosted Supabase |

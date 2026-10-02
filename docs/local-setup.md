# Running mCare with a real database, on a laptop and a phone

mCare runs in one of two modes, decided by whether `.env.local` exists:

| Mode | When | Where the data lives |
| --- | --- | --- |
| **Live** | `.env.local` sets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` | A Postgres database. Everything saved survives a refresh, a new session, another device. |
| **Demo** | no `.env.local` | Sample people kept in the browser's memory. Nothing is saved. |

For local work the database is the **local mCare backend**: the migrations in `supabase/migrations` running on a real Postgres engine (PGlite), served the way a Supabase project serves it. The app uses the same client for it as for a hosted Supabase project.

## 1. First time

Needs Node.js 22 or newer.

```sh
npm install                               # the app's dependencies (skip if node_modules exists)
npm i --no-save @electric-sql/pglite      # the database engine for the local backend and the tests
```

`--no-save` is deliberate: it keeps `package.json` and `pnpm-lock.yaml` unchanged.

## 2. Start it

Two terminals.

```sh
npm run backend        # terminal 1: the database and its API
npm run dev            # terminal 2: the app (already running inside Figma Make)
```

The first time, also create the test accounts (terminal 3, once):

```sh
npm run backend:seed
```

`npm run backend` prints the addresses to open, and writes `.env.local` so the app switches to live mode. The dev server restarts by itself when that file appears.

| | Address |
| --- | --- |
| This laptop | `http://localhost:8443` |
| A phone on the same network | `http://<the laptop's address>:8443`, as printed by `npm run backend` |

### Test accounts

Created by `npm run backend:seed`. Every one is named "Test …" and uses an `@mcare.test` address, so test records cannot be mistaken for real patients. Password for all: `Mcare-Test-2026` (set `MCARE_SEED_PASSWORD` before seeding to choose another).

| Role | Email | Notes |
| --- | --- | --- |
| Patient | `test.patient@mcare.test` | Under Dr. Test Achieng. Has one prescription, one target and one note, all labelled TEST. |
| Patient | `test.patient2@mcare.test` | No doctor yet: use it to try the doctor request. |
| Doctor | `test.doctor@mcare.test` | Dr. Test Achieng, approved. |
| Doctor | `test.doctor2@mcare.test` | Dr. Test Mutua, approved. |
| Admin | `test.admin@mcare.test` | |
| Assistant | `test.assistant@mcare.test` | May approve doctor requests, assign doctors, monitor patients, handle support. |

You can also sign up as a new patient from the welcome page. The local backend confirms the email at once. A password reset "email" is not sent anywhere: its 6-digit code is printed in terminal 1.

## 3. Testing from a phone

**Use the built app on a phone: `npm run phone`, then open `http://<laptop address>:8444`.**
The development server on port 8443 sends the code unbundled (about 136 files, 10 MB), which is fine on the laptop but takes around a minute over a hotspot, during which the phone looks stuck. `npm run phone` builds the app (15 files, about 1.2 MB, sent compressed) and serves it on port 8444 with the same backend forwarding, so it starts in a few seconds and behaves the same as on the laptop. It does not update by itself: after changing code, stop it, run it again, and reload the page on the phone.

1. Put the phone on the **same Wi-Fi or hotspot** as the laptop.
2. On the phone's browser open `http://<laptop address>:8444` (after `npm run phone`). Use the address it prints for the Wi-Fi adapter (for example `http://172.20.10.2:8444`). Port 8443 also works, slowly.
3. Do **not** use `127.0.0.1` or `localhost` on the phone: on a phone those mean the phone itself.

Why one address is enough: the phone only ever talks to the app's server (8444 built, 8443 development). That server forwards `/auth/v1`, `/rest/v1` and `/storage/v1` to the backend, which listens on the laptop alone (`127.0.0.1:54321`). `VITE_SUPABASE_URL=/` in `.env.local` means "the address this page was opened from", so the same setting works on both devices and the database's port is never opened to the network.

If the phone cannot connect:

- **Firewall.** Windows must allow inbound connections to Node.js on the network's profile. Check (PowerShell):
  `Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow | Where-Object DisplayName -match 'Node'`
  If nothing is listed for the active profile, allow it (PowerShell as Administrator):
  `New-NetFirewallRule -DisplayName "mCare dev server" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8443,8444`
- **Address.** `ipconfig` shows the laptop's IPv4 address on the Wi-Fi adapter. A VirtualBox or VPN adapter's address (such as `192.168.56.1`) is not reachable from the phone.
- **Guest or "client isolation" Wi-Fi** blocks devices from seeing each other. Use a phone hotspot or a home network.

Things to try once it opens, on both devices with the same account: log a reading on the phone and watch it appear on the laptop within about 15 seconds; refresh either one and see everything still there; sign in as the test doctor on the laptop, resolve the patient's alert with a note, and watch the note arrive on the phone.

## 4. Everyday commands

| Command | What it does |
| --- | --- |
| `npm run backend` | Starts the database and API. Data is kept in `supabase/.data` between runs. |
| `npm run backend:seed` | Creates the test accounts. Safe to repeat. |
| `npm run dev` | The app. |
| `npm run typecheck` | TypeScript check. |
| `npm run build` | Production build. |
| `npm test` | Database rules (308 checks) and API (136 checks). About a minute. |
| `npm run test:ui` | The patient, doctor, admin and assistant portals in a headless browser (58 checks). Needs Playwright, see the top of `supabase/tests/ui.test.mjs`. Takes several minutes. |

- **Start again with an empty database:** stop the backend, delete the `supabase/.data` folder, start it and seed again.
- **Back to demo mode:** delete `.env.local`.
- **Backend not running:** the sign-in page says so and names the command. Nothing is shown as saved.

Settings (environment variables, all optional): `MCARE_BACKEND_PORT` (54321), `MCARE_DATA_DIR` (`supabase/.data`), `MCARE_CONFIRM_EMAIL=1` (new accounts must enter the emailed code, which is printed in the backend's terminal), `PORT` (8443, the app).

`supabase/.data` holds the database, its signing keys and uploaded files. It is ignored by git, as is `.env.local`.

## 5. Using a hosted Supabase project instead

The app code does not change.

1. Create a project and run the files in `supabase/migrations` in order (SQL editor, or `supabase db push`).
2. In `.env.local` set `VITE_SUPABASE_URL=https://<project>.supabase.co` and `VITE_SUPABASE_ANON_KEY=<anon key>`.
3. Migration `0004` creates the private `documents` storage bucket and its two access rules when it finds the storage schema, and schedules the two jobs (alert escalation every minute, purge of deleted documents nightly) when `pg_cron` is enabled. Enable `pg_cron` before running it, or schedule those two functions yourself.
4. To create the test accounts there: `SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run backend:seed`. The service key must never be put in the app.

This path has not been run in this workspace (no project keys were available). See "What is not done" in `docs/patient-module.md`.

# Running mCare

Setup, every command, test accounts, phones and hosted Supabase. The short version is in [AGENTS.md §2](../AGENTS.md#2-commands).

## Modes

| Mode | When | Where the data lives |
| --- | --- | --- |
| **Live** | `.env.local` sets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` | Postgres. Everything saved survives a refresh, a new session, another device. |
| **Demo** | no `.env.local` | Sample people kept in the browser's memory (`src/shared/state/demoData.ts`). Nothing is saved. |

Screens never check which mode is running: `AppContext` picks the live or in-memory branch inside each action (see [AGENTS.md §3](../AGENTS.md#3-code-rules)).

## First time

Needs Node.js 22 or newer (`.mise.toml` pins Node 22 and pnpm 10).

```sh
npm install                               # the app's dependencies
npm i --no-save @electric-sql/pglite      # the database engine for the local backend and the tests
```

`--no-save` is deliberate: PGlite (and Playwright, for the browser tests) stay out of `package.json` and `pnpm-lock.yaml`.

## Start

```sh
npm run backend        # terminal 1: the database and its API (http://127.0.0.1:54321)
npm run dev            # terminal 2: the app (http://localhost:8443)
npm run backend:seed   # once: the test accounts
```

`npm run backend` applies any migration the database has not had yet, prints the addresses to open and writes `.env.local`, which switches the app to live mode (the dev server restarts by itself). A migration added while it runs is applied the first time the app asks for something it adds.

## Test accounts

Created by `npm run backend:seed`. Every one is named "Test …" with an `@mcare.test` address so test records cannot be mistaken for real patients. Password: `A1b23` (exactly five characters; set `MCARE_SEED_PASSWORD` before seeding to choose another). Reseeding resets existing seeded accounts to this password.

| Role | Email | Notes |
| --- | --- | --- |
| Patient | `test.patient@mcare.test` | Under Dr. Test Achieng; one prescription, one target and one note, labelled TEST. |
| Doctor | `test.doctor@mcare.test` | Dr. Test Achieng, approved. |
| Doctor | `test.doctor2@mcare.test` | Dr. Test Mutua, approved. |
| Admin | `test.admin@mcare.test` | |
| Assistant | `test.assistant@mcare.test` | Approves doctor requests, assigns doctors, monitors patients, handles support. |

New patients can also sign up from the welcome page. The local backend confirms the email at once by default; set `MCARE_CONFIRM_EMAIL=1` before starting it to test signup verification.

**One-time codes on the local backend.** The backend prints every signup and recovery code in its terminal. In the dev app (`npm run dev`) the verification screen also shows the code, and signup offers an "Open test activation link". These come from the backend's `/__dev/auth-codes` endpoint (`supabase/dev/server.mjs`, on unless `NODE_ENV=production`, proxied by `vite.config.ts`). The app only asks for them when `import.meta.env.DEV` is true and the backend is local (`localBackend` in `src/shared/api/supabase.ts`). Production builds and hosted Supabase never expose codes.

## On a phone

Use the built app: `npm run phone`, then open `http://<laptop address>:8444` on the phone. The dev server on 8443 sends the code unbundled (about 140 files, 10 MB), which takes around a minute over a hotspot; `npm run phone` builds it (about 15 files, 1.2 MB compressed) and serves it with the same backend forwarding. It does not update by itself: after changing code, run it again and reload the phone.

- Same Wi-Fi or hotspot as the laptop. Never `localhost` or `127.0.0.1` on the phone: there they mean the phone.
- One address is enough: the app's server forwards `/auth/v1`, `/rest/v1`, `/storage/v1` and `/__dev` to the backend, which listens on the laptop only. `VITE_SUPABASE_URL=/` means "the address this page was opened from", so one setting works on both devices.
- **Firewall** (Windows): allow inbound Node.js on the active profile, e.g. PowerShell as Administrator: `New-NetFirewallRule -DisplayName "mCare dev server" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8443,8444`.
- **Address**: `ipconfig` gives the Wi-Fi adapter's IPv4 address. A VirtualBox or VPN adapter address (such as `192.168.56.1`) is not reachable from the phone.
- **Guest or client-isolation Wi-Fi** blocks devices from seeing each other; use a hotspot or home network.

Try: log a reading on the phone and watch it reach the laptop within about 15 seconds; sign in as the test doctor on the laptop, resolve the alert with a note, and watch it arrive on the phone.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | The app with hot reload (port 8443). |
| `npm run backend` | The local database and API. Data is kept in `supabase/.data`. |
| `npm run backend:seed` | Creates the test accounts. Safe to repeat. |
| `npm run backend:reset` | Deletes the local database (`supabase/.data/pg`); start the backend and seed again after it. |
| `npm run db:schema` | Prints everything the migrations build, for comparing two versions of them (`supabase/dev/fingerprint.mjs`). |
| `node supabase/dev/_audit.mjs` | One-off schema audit: triggers per table, patient tables missing `zz_touch_patient`, write policies per table, status columns. |
| `npm run phone` | Production build served on port 8444, for phones. |
| `npm run build` / `npm run preview` | Production build into `dist/` / serve it. `vite build --mode development` gives a readable build with inline source maps. |
| `npm run typecheck` | TypeScript check. Run after changing `src/`. |
| `npm run format` | oxfmt. |
| `npm test` | Database rules and API workflows (`test:db` + `test:api`). Run after changing a migration. |
| `npm run test:ui` | The four portals in a headless browser. Needs Playwright; several minutes. See [TESTING.md](TESTING.md). |

- **Empty database:** stop the backend, `npm run backend:reset`, start it and seed again.
- **Back to demo mode:** delete `.env.local`.
- **Backend not running:** the sign-in page says so and names the command; nothing is shown as saved.
- **"Built from the old migration history"**: `npm run backend` stops with this message for a database made before the 3 October 2026 baseline. Run `npm run backend:reset`, then `npm run backend` and `npm run backend:seed`.

## Environment

All optional.

| Variable | Default | Used by |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | unset (demo mode) | the app; written to `.env.local` by `npm run backend` |
| `VITE_VAPID_PUBLIC_KEY` | unset (push off) | the app; see [DELIVERY.md](DELIVERY.md) |
| `MCARE_BACKEND_PORT` / `MCARE_BACKEND_HOST` | `54321` / `127.0.0.1` | local backend, and the dev proxy |
| `MCARE_BACKEND_URL` | `http://127.0.0.1:$MCARE_BACKEND_PORT` | the dev proxy target |
| `MCARE_DATA_DIR` | `supabase/.data` | local backend |
| `MCARE_CONFIRM_EMAIL=1` | off | new accounts must enter the emailed code |
| `MCARE_SEED_PASSWORD` | `A1b23` | seed script |
| `PORT` / `HOST` | `8443` / `0.0.0.0` | dev server and preview |
| `BASE_URL` | `/` | the path the app is served under |
| `PLAYWRIGHT_PATH` | unset | `test:ui`, a project that has Playwright installed |

`supabase/.data` (database, signing keys, uploaded files, UI-test screenshots), `.env.local` and `dist/` are ignored by git. So is `.grok-changes/`, another tool's local state; it is not part of the app.

## Hosted Supabase

The app code does not change.

1. Create a project and run `supabase/migrations` in order (SQL editor, or `supabase db push`).
2. Enable `pg_cron` first: `0010_reference_data_jobs.sql` then schedules alert escalation (every minute), the nightly purge of deleted documents and the completion of finished prescriptions, and creates the private `documents` storage bucket and its rules when the storage schema exists.
3. In `.env.local` (or the host's build environment): `VITE_SUPABASE_URL=https://<project>.supabase.co`, `VITE_SUPABASE_ANON_KEY=<anon key>`.
4. Test accounts there: `SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run backend:seed`. The service key never goes into the app.
5. Keep email confirmation **on** (staff invitations rely on it).
6. Deploy `supabase/functions/deliver` for email, SMS and push ([DELIVERY.md](DELIVERY.md)).
7. `npm run build` and host `dist/` on any static host.

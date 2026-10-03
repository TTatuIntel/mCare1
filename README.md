# mCare

**Remote patient monitoring for patients, their doctors and the care team.**

Patients log vitals, medicines, meals and water from their phone. Their doctor follows every reading, answers alerts, prescribes, writes notes and care plans and issues signed reports. Administrators and mCare assistants run approvals, assignments, support and the audit trail. Every role works on the same record; the database decides who may see and change what, and audits every change.

![React 19](https://img.shields.io/badge/React-19-61dafb) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6) ![Vite](https://img.shields.io/badge/Vite-8-646cff) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8) ![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e)

---

## Features

| Portal | Highlights |
| --- | --- |
| **Patient** | Vitals with server-side grading, trends and history · alerts with one-tap **Re-measure** (an in-range reading clears a warning automatically) · SOS · medication schedule · meal plan and water · appointments · messages with the doctor · medical documents with private sharing · notifications by email, SMS and push |
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

Sign in with `test.patient@mcare.test`, `test.doctor@mcare.test` or `test.admin@mcare.test`, password `A1b23`.

To try it on a phone on the same Wi-Fi, run `npm run phone` and open `http://<laptop IP>:8444`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` · `npm run preview` | Production build · serve it |
| `npm run phone` | Build and serve on port 8444 for phones |
| `npm run backend` · `npm run backend:seed` · `npm run backend:reset` | Local database and API · test accounts · start the local database afresh |
| `npm run typecheck` | TypeScript check |
| `npm test` | Every access rule and workflow, in SQL and over HTTP |
| `npm run test:ui` | All four portals in a headless browser, at phone, tablet and laptop width |
| `npm run format` | Format with oxfmt |

## Project layout

```text
src/
  shared/      UI kit, app state, API layer, domain logic, documents, email, layout
  patient/     patient portal
  doctor/      doctor portal
  admin/       admin portal
  assistant/   assistant portal (admin screens, gated by permissions)
supabase/
  migrations/  the database in 10 files: schema, helpers, one file per domain, security, reference data
  dev/         local backend and seeding
  functions/   deliver: email, SMS and push sender
  tests/       rule, API and browser tests
public/        logo, push service worker, robots.txt
```

## Deploying

1. Create a Supabase project, enable `pg_cron`, and run `supabase/migrations` in order.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the build, then `npm run build` and host `dist/` on any static host.
3. Deploy `supabase/functions/deliver` with the email, SMS and push provider keys, and schedule it.

## Documentation

Everything else (code rules, data model and ownership, every database rule and automation, each portal in detail, notification delivery, testing and known gaps) is in **[AGENTS.md](AGENTS.md)**.

## Status

Fully working against the bundled local backend and covered by the rule, API and browser test suites. Not yet run against a hosted Supabase project or real email/SMS/push providers; see *Known gaps* in [AGENTS.md](AGENTS.md#10-known-gaps).

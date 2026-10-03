# Testing

Three suites, all in `supabase/tests/`, all plain Node scripts (no test framework). Each prints `  ok  <name>` or `FAIL <name>  → <detail>` per check and ends with `N passed, M failed`; the exit code is non-zero on any failure. Latest results are in [STATUS.md](STATUS.md#verified).

| Check | Command | Covers | When to run |
| --- | --- | --- | --- |
| Types | `npm run typecheck` | The whole app (`tsc --noEmit`). | After changing `src/`. |
| Build | `npm run build` | Production build. | Before a release. |
| Database rules | `npm run test:db` (`rules.test.mjs`) | Every access and clinical rule in SQL, as patient, other patient, treating doctor, other doctor, consulting doctor, admin, assistant, suspended account and signed-out visitor. | After changing a migration. |
| API workflows | `npm run test:api` (`api.test.mjs`) | The same workflows over HTTP with the real `supabase-js` client against the local backend: sign-up and sessions, each workflow per role, forged tokens, changed ids, files, the delivery queue. | After changing a migration or `server.mjs`. |
| Both | `npm test` | `test:db` then `test:api`. | After changing a migration. |
| Browser | `npm run test:ui` (`ui.test.mjs`) | A headless Chromium drives all four portals: a new sign-up (with email confirmation and test OTP) through setup, a patient's day, the care team's answers arriving in the open app, private chats with each care-team doctor, the backend becoming unreachable, the doctor's and admin's workflows, an assistant limited to their screens, and every screen at phone (390), tablet (834) and laptop (1366) width (no sideways overflow, no script errors). After each step the database is queried to confirm the change. Screenshots go to `supabase/.data/screens/` (failures as `<size>-fail-<step>.png`). | After changing screens; several minutes. |

Prerequisites: `npm i --no-save @electric-sql/pglite` for all three; for the browser suite also `npm i --no-save playwright && npx playwright install chromium` (or set `PLAYWRIGHT_PATH` to a project that has it). Every suite builds its own in-memory database from `supabase/migrations`, so none needs `npm run backend` running and none touches `supabase/.data/pg`.

## Writing a check

### `rules.test.mjs`: SQL as a role

PGlite in memory, the migrations applied in order, Supabase's `auth` schema stubbed. Fixed users in `ID` (`pat`, `pat2`, `doc`, `doc2`, `admin`, `asst`, `evil`); sections are marked with `/* ── Name ── */` and `console.log('\nName')`.

```js
await as(ID.pat, `select … where …`, [params])          // rows, run as that signed-in user (null = signed out)
await denied(ID.doc, `insert into …`, [params])          // { blocked: true, why } when refused, else { blocked: false, rows }
await one(`select count(*)::int n from audit_log …`)      // one row, run with no role (sees everything)
check('a consulting doctor cannot prescribe', (await denied(DOC, `insert into prescriptions …`)).blocked)
```

For every new rule, add the allowed case **and** a refusal for each role that must be refused (another patient, another doctor, a consulting doctor, an assistant without the permission, a suspended account, signed out). Check the audit row and the notification where the rule writes them.

### `api.test.mjs`: the real client

`startBackend({ port: 0, dataDir: 'memory', quiet: true, jobs: false, exposeTestAuth: true })`, then `client()` for a fresh anonymous `supabase-js` client (`client(backend.serviceKey)` for the service role). Sign up with `auth.signUp`, act with `.from(…)` / `.rpc(…)`, and assert on `data` / `error`. `await backend.deliver()` runs the sender once; `backend.outbox` holds what it "sent".

### `ui.test.mjs`: the browser

`session('phone' | 'tablet' | 'laptop')` returns `s` with `page`, `signIn(email)`, `nav(label)`, `home()`, `sheet()`, `openLog()`, `shot(name)` and `errors`. Wrap each user action in `await step(s, '<what the user achieves>', async () => { … })`; a failing step is reported, screenshotted, and the journey carries on. Confirm the effect in the database with `row(service.from(…)…)`. Prefer role and label locators (`getByRole('button', { name })`, `getByLabel`) over CSS; they also keep the screens accessible.

## Not browser-tested

Covered by rule and API tests only: editing vital definitions, doctor approval, withdrawing an invitation, restoring a document as support, moving an appointment as support, the availability picker with a doctor who keeps a timetable. No physical phone is in the loop (phones are emulated by viewport).

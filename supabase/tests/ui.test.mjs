/**
 * The patient portal in a real browser, on real data.
 *
 * Starts a throwaway backend (in memory), the app in live mode against it, and
 * a headless Chromium, then walks the patient journey the way a person would:
 * taps, typing, waiting for what appears on screen. After each step the
 * database is asked directly whether the change really happened.
 *
 *   npm i --no-save @electric-sql/pglite playwright && npx playwright install chromium
 *   npm run test:ui
 *
 * Playwright installed elsewhere? Point at it:  PLAYWRIGHT_PATH=/path/to/project-with-playwright npm run test:ui
 * Screenshots of every screen at phone, tablet and laptop width go to supabase/.data/screens/.
 */
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { createServer } from 'vite'
import { startBackend } from '../dev/server.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const SHOTS = join(HERE, '..', '.data', 'screens')
const PW = 'Mcare-Test-2026'
const SIZES = { phone: { width: 390, height: 844 }, tablet: { width: 834, height: 1112 }, laptop: { width: 1366, height: 768 } }

async function loadPlaywright() {
  const base = process.env.PLAYWRIGHT_PATH ? pathToFileURL(join(resolve(process.env.PLAYWRIGHT_PATH), 'package.json')) : import.meta.url
  try { return createRequire(base)('playwright') }
  catch { console.error('Playwright is not installed. Run:  npm i --no-save playwright && npx playwright install chromium\n(or set PLAYWRIGHT_PATH to a project that has it)'); process.exit(2) }
}
const { chromium } = await loadPlaywright()

/* ── the stack: backend → test accounts → app ── */
const backend = await startBackend({ port: 0, dataDir: 'memory', quiet: true, jobs: false })
// The test accounts are made by the same script a developer runs. It must not block this process: the backend it talks to lives here.
const seeded = await new Promise(done => {
  const child = spawn(process.execPath, [join(HERE, '..', 'dev', 'seed.mjs')], {
    env: { ...process.env, SUPABASE_URL: backend.url, SUPABASE_SERVICE_ROLE_KEY: backend.serviceKey, SUPABASE_ANON_KEY: backend.anonKey, MCARE_SEED_PASSWORD: PW },
  })
  let output = ''
  child.stdout.on('data', d => { output += d }); child.stderr.on('data', d => { output += d })
  child.on('close', status => done({ status, output }))
})
if (seeded.status !== 0) { console.error(seeded.output); await backend.close(); process.exit(1) }

Object.assign(process.env, { VITE_SUPABASE_URL: '/', VITE_SUPABASE_ANON_KEY: backend.anonKey, MCARE_BACKEND_URL: backend.url, PORT: String(18000 + Math.floor(Math.random() * 2000)) })
const vite = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', open: false, hmr: false } })
await vite.listen()
const APP = `http://127.0.0.1:${vite.config.server.port}`

const api = key => createClient(backend.url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const service = api(backend.serviceKey)
const row = async q => (await q).data

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : '  → ' + String(extra).slice(0, 300)}`) }
fs.mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch()
async function session(size = 'phone') {
  const context = await browser.newContext({ viewport: SIZES[size] })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const s = {
    context, page, errors, size,
    text: async () => (await page.locator('body').innerText()).replace(/\n+/g, ' | '),
    shot: name => page.screenshot({ path: join(SHOTS, `${size}-${name}.png`) }),
    nav: label => page.getByRole('navigation').getByRole('button', { name: new RegExp(label + '$') }).first().click(),
    sheet: () => page.getByRole('dialog'),
    /** The floating "Log vitals" button never stops moving, so it is clicked by event, not by position. */
    openLog: () => page.getByRole('button', { name: 'Log vitals' }).last().dispatchEvent('click'),
    home: async () => { await s.nav('Home'); await page.getByText('Health Score').waitFor({ timeout: 15000 }) },
    /** Home of a portal other than the patient's: `marker` is text only that home shows. */
    home2: async marker => { await s.nav('Home'); await page.getByText(marker).first().waitFor({ timeout: 15000 }) },
    signIn: async (email, password = PW) => {
      await page.goto(APP)
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
      await page.goto(APP)
      await page.getByLabel('mCare is starting').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
      if (!(await page.getByPlaceholder('you@example.com').isVisible().catch(() => false))) await page.getByRole('button', { name: 'Sign in', exact: true }).first().click()
      await page.getByPlaceholder('you@example.com').fill(email)
      await page.getByPlaceholder('Enter your password').fill(password)
      await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    },
  }
  return s
}
/** One step of the journey. A failure is reported and the journey carries on. */
const step = async (s, name, work) => {
  try { await work(); check(name, true) }
  catch (e) { check(name, false, String(e.message).split('\n').slice(0, 3).join(' / ')); await s.shot('fail-' + name.replace(/\W+/g, '-').slice(0, 40)).catch(() => {}); await s.page.keyboard.press('Escape').catch(() => {}) }
}
const inDays = n => { const d = new Date(Date.now() + n * 86_400_000); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') }
/** The `n`th Monday after today (0 = the next one), as YYYY-MM-DD. */
const mondayAfter = n => { let k = 1; while (new Date(Date.now() + k * 86_400_000).getDay() !== 1) k++; return inDays(k + 7 * n) }

try {
  /* ── A new patient ── */
  console.log('\nA new patient signs up')
  const s = await session('phone')
  const { page } = s
  const email = `test.new${Date.now()}@mcare.test`
  await step(s, 'sign-up creates the account and opens the health setup', async () => {
    await page.goto(APP)
    await page.getByLabel('mCare is starting').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
    await page.getByRole('button', { name: 'Get Started' }).click()
    await page.getByPlaceholder('Grace Otieno').fill('Test New Patient')
    await page.getByPlaceholder('you@example.com').fill(email)
    await page.locator('input[type=tel]').first().fill('712345678')
    await page.getByPlaceholder(/characters, Aa and 1/).fill(PW)
    await page.getByPlaceholder('Repeat your password').fill(PW)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Sign up' }).click()
    await page.getByRole('heading', { name: 'About you' }).waitFor({ timeout: 25000 })
  })
  const newId = (await row(service.from('profiles').select('id, role').eq('email', email).maybeSingle()))?.id
  check('the database holds the new account as a patient, with consent recorded', !!newId && (await row(service.from('consents').select('kind').eq('user_id', newId))).length === 2)
  await step(s, 'each setup step is saved before the next one opens', async () => {
    await page.locator('input[type=date]').fill('1985-03-09')
    await page.getByRole('button', { name: 'Female', exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('heading', { name: /long-term conditions/i }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: /Type 2 diabetes/ }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('heading', { name: /allergies/i }).waitFor({ timeout: 10000 })
    await page.getByText('No known allergies').click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('heading', { name: /next of kin/i }).waitFor({ timeout: 10000 })
    await page.getByPlaceholder('e.g. Mary Wanjiku').fill('Test Kin Person')
    await page.getByPlaceholder('+254 7XX XXX XXX').fill('+254 700 000 777')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('heading', { name: /What should we track/i }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Finish', exact: true }).click()
    await page.getByRole('button', { name: 'Go to my dashboard' }).click()
    await page.getByText('Health Score').waitFor({ timeout: 15000 })
  })
  const saved = await row(service.from('patients').select('sex, profile_setup').eq('id', newId).single())
  check('the health profile, next of kin and tracked vitals are in the database', saved?.sex === 'female' && saved?.profile_setup === 'done'
    && (await row(service.from('conditions').select('name').eq('patient_id', newId)))[0]?.name === 'Type 2 diabetes'
    && (await row(service.from('emergency_contacts').select('next_of_kin').eq('patient_id', newId)))[0]?.next_of_kin === true
    && (await row(service.from('tracked_vitals').select('vital_id').eq('patient_id', newId))).some(v => v.vital_id === 'gluc'))
  const fresh = await s.text()
  check('a new account shows no sample people or readings', !/James Mwangi|Amara Osei|Samuel Kariuki/.test(fresh) && /No readings yet/.test(fresh), fresh.slice(0, 200))
  await step(s, 'empty screens say what to do instead of inventing data', async () => {
    await s.nav('Meds'); await page.getByText('No active prescriptions').waitFor({ timeout: 10000 })
    await s.nav('Appts'); await page.getByText('No appointments yet').waitFor({ timeout: 10000 })
    await s.nav('Chat'); await page.getByText('No doctor assigned yet').waitFor({ timeout: 10000 })
  })
  await step(s, 'signing out returns to the sign-in page without an error', async () => {
    await s.home(); await page.getByRole('button', { name: 'Profile' }).click()
    await page.getByRole('button', { name: 'Sign Out', exact: true }).click()
    await page.getByRole('button', { name: 'Sign in', exact: true }).first().waitFor({ timeout: 15000 })
  })
  check('no script errors', s.errors.length === 0, s.errors.join(' | '))
  await s.context.close()

  /* ── A patient with a doctor ── */
  console.log('\nA day as a patient under a doctor')
  const p = await session('phone')
  const patient = api(backend.anonKey), doctor = api(backend.anonKey)
  await patient.auth.signInWithPassword({ email: 'test.patient@mcare.test', password: PW })
  await doctor.auth.signInWithPassword({ email: 'test.doctor@mcare.test', password: PW })
  const patId = (await patient.auth.getUser()).data.user.id, docId = (await doctor.auth.getUser()).data.user.id
  await service.from('patients').update({ profile_setup: 'done' }).eq('id', patId)
  await p.signIn('test.patient@mcare.test')
  await p.page.getByText('Health Score').waitFor({ timeout: 25000 })
  check('the dashboard shows the doctor\'s note and prescription from the database', /TEST NOTE/.test(await p.text()) && /TEST Amlodipine 5mg/.test(await p.text()))

  await step(p, 'a normal reading is saved and shown', async () => {
    await p.openLog()
    await p.sheet().getByRole('button', { name: /Heart Rate/ }).first().click()
    await p.page.getByLabel(/Heart Rate in bpm/).fill('72')
    await p.page.getByRole('button', { name: 'Save Reading' }).click()
    await p.page.getByLabel(/Heart Rate in bpm/).waitFor({ state: 'detached', timeout: 15000 })
  })
  check('…and is in the database, graded by the server', (await row(service.from('readings').select('value, level, recorded_by').eq('patient_id', patId)))[0]?.level === 'normal')
  await step(p, 'an impossible value cannot be saved', async () => {
    await p.openLog()
    await p.sheet().getByRole('button', { name: /Heart Rate/ }).first().click()
    await p.page.getByLabel(/Heart Rate in bpm/).fill('900')
    await p.page.getByText(/That looks wrong/).waitFor({ timeout: 5000 })
    if (!(await p.page.getByRole('button', { name: 'Save Reading' }).isDisabled())) throw new Error('Save should be disabled')
    await p.page.getByRole('button', { name: 'Cancel' }).click()
  })
  await step(p, 'a critical reading tells the patient the doctor has been alerted', async () => {
    await p.openLog()
    await p.sheet().getByRole('button', { name: /Blood Pressure/ }).first().click()
    await p.page.getByLabel(/Blood Pressure in mmHg/).fill('185/125')
    await p.page.getByRole('button', { name: 'Save Reading' }).click()
    await p.page.getByText('Critical reading').waitFor({ timeout: 15000 })
    await p.page.getByRole('button', { name: 'OK', exact: true }).click()
    await p.page.getByRole('button', { name: /View all/ }).click()
    await p.page.getByText('Sent to your doctor').first().waitFor({ timeout: 10000 })
  })
  const alert = (await row(service.from('alerts').select('*').eq('patient_id', patId).eq('value', '185/125')))[0]
  check('the alert exists, open, and the doctor was notified', alert?.status === 'open' && alert?.severity === 'danger'
    && (await row(doctor.from('notifications').select('title').like('title', 'Critical:*'))).length === 1)

  await step(p, 'a dose is ticked off', async () => {
    await p.nav('Meds')
    await p.page.getByRole('button', { name: /8:00 AM/ }).first().click()
    await p.page.getByRole('button', { name: /✓ 8:00 AM/ }).waitFor({ timeout: 10000 })
  })
  await step(p, 'a meal and water are logged', async () => {
    await p.home(); await p.page.getByRole('button', { name: /Meals$/ }).click()
    await p.page.getByRole('button', { name: 'Mark Breakfast eaten' }).click()
    await p.page.getByText('Logged today').waitFor({ timeout: 10000 })
    await p.page.getByRole('button', { name: '3 glasses' }).click()
    await p.page.getByText(/3 \/ 8 glasses/).waitFor({ timeout: 10000 })
  })
  await p.page.waitForTimeout(1500)
  check('dose, meal and water are in the database', (await row(service.from('dose_logs').select('slot').eq('patient_id', patId))).length === 1
    && (await row(service.from('meal_logs').select('meal_id').eq('patient_id', patId)))[0]?.meal_id === 'breakfast'
    && (await row(service.from('hydration_logs').select('glasses').eq('patient_id', patId)))[0]?.glasses === 3)

  await step(p, 'an appointment is requested', async () => {
    await p.nav('Appts')
    await p.page.getByRole('button', { name: 'Request an appointment', exact: true }).first().click()
    await p.page.getByPlaceholder('e.g. Blood pressure follow-up').fill('TEST BP review')
    await p.page.locator('input[type=date]').fill(inDays(5))
    await p.page.locator('input[type=time]').fill('10:30')
    await p.page.getByRole('button', { name: 'Send request' }).click()
    await p.page.getByText('Waiting for doctor').first().waitFor({ timeout: 15000 })
  })
  await step(p, 'a message is sent to the doctor', async () => {
    await p.nav('Chat')
    await p.page.getByLabel('Message').fill('TEST message from the phone')
    await p.page.getByRole('button', { name: 'Send' }).click()
    await p.page.getByText('TEST message from the phone').waitFor({ timeout: 15000 })
  })
  await step(p, 'a document is uploaded and listed', async () => {
    await p.home(); await p.page.getByRole('button', { name: /Records/ }).click()
    await p.page.getByRole('button', { name: 'Add', exact: true }).first().click()
    const pdf = join(SHOTS, 'test-lab-result.pdf')
    fs.writeFileSync(pdf, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
    await p.page.locator('input[type=file]').setInputFiles(pdf)
    await p.sheet().getByRole('button', { name: 'Upload', exact: true }).click()
    await p.page.getByText(/test lab result/i).first().waitFor({ timeout: 20000 })
  })
  const appt = (await row(doctor.from('appointments').select('*').eq('status', 'requested')))[0]
  check('the doctor received the request, the message and the shared document', !!appt
    && (await row(doctor.from('messages').select('content').eq('from_id', patId)))[0]?.content === 'TEST message from the phone'
    && (await row(doctor.from('documents').select('origin'))).some(d => d.origin === 'patient_upload'))

  /* the care team answers; the open app shows it without a reload */
  console.log('\nThe care team answers')
  await doctor.from('alerts').update({ status: 'resolved', resolution_reason: 'Medication adjusted', resolution_note: 'TEST: dose increased' }).eq('id', alert.id)
  await doctor.from('appointments').update({ status: 'rescheduled', rescheduled_date: inDays(6), rescheduled_time: '15:00', rescheduled_reason: 'TEST: clinic is full' }).eq('id', appt.id)
  await doctor.from('messages').insert({ from_id: docId, to_id: patId, content: 'TEST reply from the doctor' })
  await step(p, 'the resolution note reaches the open app by itself', async () => {
    await p.home(); await p.page.getByRole('button', { name: /Alerts/ }).first().click()
    await p.page.getByText('TEST: dose increased').waitFor({ timeout: 45000 })
  })
  await step(p, 'the proposed new time is accepted, and the database moves the appointment', async () => {
    await p.nav('Appts')
    await p.page.getByRole('button', { name: 'Accept new time' }).click()
    await p.page.getByText('Confirmed').first().waitFor({ timeout: 15000 })
    const moved = await row(service.from('appointments').select('status, preferred_date').eq('id', appt.id).single())
    if (moved.status !== 'approved' || moved.preferred_date !== inDays(6)) throw new Error(JSON.stringify(moved))
  })
  await step(p, 'the doctor\'s reply is in the chat', async () => { await p.nav('Chat'); await p.page.getByText('TEST reply from the doctor').waitFor({ timeout: 15000 }) })
  await step(p, 'a reload keeps the session and the record', async () => {
    await p.page.reload()
    await p.page.getByText('Health Score').waitFor({ timeout: 25000 })
    if (!/185\/125/.test(await p.text())) throw new Error('readings missing after reload')
  })

  /* ── when the backend cannot be reached ── */
  console.log('\nWhen mCare cannot be reached')
  await p.context.route(/\/(rest|auth|storage)\/v1\//, route => route.abort('internetdisconnected'))
  await step(p, 'a reading that cannot be saved says so and keeps what was typed', async () => {
    await p.openLog()
    await p.sheet().getByRole('button', { name: /Heart Rate/ }).first().click()
    await p.page.getByLabel(/Heart Rate in bpm/).fill('74')
    await p.page.getByRole('button', { name: 'Save Reading' }).click()
    await p.sheet().getByRole('alert').waitFor({ timeout: 20000 })
    if ((await p.page.getByLabel(/Heart Rate in bpm/).inputValue()) !== '74') throw new Error('typed value was lost')
    await p.sheet().getByRole('button', { name: 'Cancel' }).click()
    await p.page.getByText(/Showing what was loaded at/).waitFor({ timeout: 20000 })
  })
  await p.context.unroute(/\/(rest|auth|storage)\/v1\//)
  check('nothing was saved while it was unreachable', (await row(service.from('readings').select('value').eq('patient_id', patId))).every(r => r.value !== '74'))
  check('no script errors', p.errors.length === 0, p.errors.join(' | '))
  await p.context.close()

  /* ── the same record from the doctor's and the admin's portals ── */
  console.log('\nOne record, three portals')
  // A second patient for the doctor, so the Messages screen is a list of conversations.
  await service.from('patients').update({ assigned_doctor_id: docId }).eq('id', newId)
  const d = await session('laptop')
  await d.signIn('test.doctor@mcare.test')
  await step(d, 'the doctor opens the patient and sees what the patient logged', async () => {
    await d.nav('Patients')
    await d.page.getByRole('button', { name: /Test Patient One/ }).first().click()
    await d.page.getByRole('button', { name: 'Nutrition', exact: true }).click()
    await d.page.getByText('Standard plan').waitFor({ timeout: 15000 })
    await d.page.getByText('3/8').waitFor({ timeout: 10000 })   // the water logged on the phone
  })
  await step(d, 'the doctor sets a meal plan; it is saved before it says so', async () => {
    await d.page.getByRole('button', { name: 'Set a plan' }).click()
    await d.sheet().getByPlaceholder('e.g. 1800').fill('1800')
    await d.sheet().getByPlaceholder(/Keep salt low/).fill('TEST: keep salt low')
    await d.sheet().getByRole('button', { name: 'Save plan' }).click()
    await d.page.getByText('Meal plan saved and shared with patient').waitFor({ timeout: 15000 })
    const plan = await row(service.from('meal_plans').select('set_by, target_kcal, meals').eq('patient_id', patId).single())
    if (plan?.set_by !== docId || plan.target_kcal !== 1800 || plan.meals.length !== 4) throw new Error(JSON.stringify(plan))
  })
  await step(d, 'the doctor records a reading on the patient\'s record', async () => {
    await d.page.getByRole('button', { name: 'Vitals', exact: true }).click()
    await d.page.getByRole('button', { name: '+ Record a reading' }).click()
    await d.sheet().getByRole('button', { name: /Heart Rate/ }).click()
    await d.sheet().getByPlaceholder('e.g. 72').fill('76')
    await d.sheet().getByRole('button', { name: 'Save reading' }).click()
    await d.page.getByText(/Heart Rate recorded/).waitFor({ timeout: 15000 })
    const r = (await row(service.from('readings').select('recorded_by, level').eq('patient_id', patId).eq('value', '76')))[0]
    if (r?.recorded_by !== docId) throw new Error(JSON.stringify(r))
  })
  await step(d, 'the doctor prescribes; it is saved before it says so, and the patient is told', async () => {
    await d.page.getByRole('button', { name: 'Meds', exact: true }).click()
    await d.page.getByRole('button', { name: '+ New Prescription' }).click()
    await d.sheet().getByPlaceholder('e.g. Amlodipine 5mg').fill('TEST Enalapril 5mg')
    await d.sheet().getByPlaceholder('e.g. 5mg').fill('5mg')
    await d.sheet().getByPlaceholder(/With breakfast/).fill('TEST: with breakfast')
    await d.sheet().getByRole('button', { name: 'Prescribe' }).click()
    await d.page.getByText('Prescription sent to patient').waitFor({ timeout: 15000 })
    const rx = (await row(service.from('prescriptions').select('doctor_id, status, instructions, route').eq('patient_id', patId).eq('medication', 'TEST Enalapril 5mg')))[0]
    if (rx?.doctor_id !== docId || rx.status !== 'active' || rx.instructions !== 'TEST: with breakfast' || rx.route !== 'oral') throw new Error(JSON.stringify(rx))
    if (!(await row(patient.from('notifications').select('title'))).some(n => n.title === 'New prescription')) throw new Error('patient was not told')
  })
  await step(d, 'the doctor stops it with a reason; the prescription is kept as stopped', async () => {
    await d.page.getByRole('button', { name: 'Stop', exact: true }).last().click()
    await d.sheet().getByPlaceholder(/Persistent dry cough/).fill('TEST: dry cough')
    await d.sheet().getByRole('button', { name: 'Stop medicine' }).click()
    await d.page.getByText(/stopped · patient told/).waitFor({ timeout: 15000 })
    const rx = (await row(service.from('prescriptions').select('status, stop_reason, stopped_by').eq('patient_id', patId).eq('stop_reason', 'TEST: dry cough')))[0]
    if (rx?.status !== 'discontinued' || rx.stopped_by !== docId) throw new Error(JSON.stringify(rx))
  })
  await step(d, 'an internal note is saved for the doctor and never reaches the patient', async () => {
    await d.page.getByRole('button', { name: 'Notes', exact: true }).click()
    await d.page.getByRole('tab', { name: 'Internal' }).click()
    await d.page.getByLabel('Clinical note').fill('TEST internal: consider white-coat effect')
    await d.page.getByRole('button', { name: 'Save Note' }).click()
    await d.page.getByText('Internal note saved').waitFor({ timeout: 15000 })
    const note = (await row(service.from('clinical_notes').select('visibility').eq('content', 'TEST internal: consider white-coat effect')))[0]
    if (note?.visibility !== 'internal') throw new Error(JSON.stringify(note))
    if ((await row(patient.from('clinical_notes').select('id').eq('content', 'TEST internal: consider white-coat effect'))).length !== 0) throw new Error('the patient can read an internal note')
  })
  await step(d, 'the doctor writes a care plan and starts it; the patient can then read it', async () => {
    await d.page.getByRole('button', { name: 'Care plan', exact: true }).click()
    await d.page.getByRole('button', { name: '+ New care plan' }).click()
    await d.sheet().getByPlaceholder('e.g. Blood pressure control').fill('TEST Blood pressure control')
    await d.sheet().getByPlaceholder(/Morning blood pressure under/).first().fill('TEST: morning BP under 135/85')
    await d.sheet().getByRole('button', { name: 'Save plan' }).click()
    await d.page.getByText(/Draft saved/).waitFor({ timeout: 15000 })
    if ((await row(patient.from('care_plans').select('id'))).length !== 0) throw new Error('the patient can read a draft')
    await d.page.getByRole('button', { name: 'Start plan' }).first().click()
    await d.sheet().getByRole('button', { name: 'Start plan' }).click()
    await d.page.getByText(/Care plan started/).waitFor({ timeout: 15000 })
    const plan = (await row(patient.from('care_plans').select('status, title')))[0]
    if (plan?.status !== 'active' || plan.title !== 'TEST Blood pressure control') throw new Error(JSON.stringify(plan))
  })
  await step(d, 'the doctor adds a consulting doctor, who can then read the record and change nothing', async () => {
    await d.page.getByRole('button', { name: 'Overview', exact: true }).click()
    await d.page.getByRole('button', { name: '+ Consulting doctor' }).click()
    await d.sheet().getByRole('radio', { name: /Dr\. Test Mutua/ }).click()
    await d.sheet().getByPlaceholder('e.g. Cardiology opinion').fill('TEST: second opinion')
    await d.sheet().getByRole('button', { name: 'Add to care team' }).click()
    await d.page.getByText(/Consulting doctor added/).waitFor({ timeout: 15000 })
    const mutua = api(backend.anonKey)
    await mutua.auth.signInWithPassword({ email: 'test.doctor2@mcare.test', password: PW })
    if (!(await row(mutua.from('readings').select('id').eq('patient_id', patId))).length) throw new Error('the consulting doctor cannot read the readings')
    const tried = await mutua.from('prescriptions').insert({ patient_id: patId, doctor_id: (await mutua.auth.getUser()).data.user.id, medication: 'X', dosage: '1', frequency: 'Once daily' })
    if (!tried.error) throw new Error('a consulting doctor could prescribe')
  })
  await step(d, 'the doctor completes the visit the patient accepted', async () => {
    await d.nav('Appts')
    await d.page.getByRole('button', { name: 'Completed', exact: true }).first().click()
    await d.sheet().getByPlaceholder(/BP stable/).fill('TEST: reviewed, continue')
    await d.sheet().getByRole('button', { name: 'Mark completed' }).click()
    await d.page.getByText('Visit completed').waitFor({ timeout: 15000 })
    const done = await row(service.from('appointments').select('status, approval_note').eq('id', appt.id).single())
    if (done.status !== 'completed' || done.approval_note !== 'TEST: reviewed, continue') throw new Error(JSON.stringify(done))
  })
  await step(d, 'a new critical reading reaches the open doctor portal by itself, and is acknowledged', async () => {
    await patient.from('readings').insert({ patient_id: patId, vital_id: 'spo2', value: '84' })
    await d.nav('Alerts')
    await d.page.getByText(/SpO₂: 84/).first().waitFor({ timeout: 45000 })
    await d.page.getByRole('button', { name: /Acknowledge/ }).first().click()
    await d.page.getByText(/is reviewing/).first().waitFor({ timeout: 15000 })
    const a = (await row(service.from('alerts').select('status, acknowledged_by').eq('patient_id', patId).eq('value', '84')))[0]
    if (a?.status !== 'acknowledged' || a.acknowledged_by !== docId) throw new Error(JSON.stringify(a))
  })
  await step(d, 'the doctor replies from Messages; the patient has the same thread and is pointed at it', async () => {
    await d.nav('Chat')
    const conversations = d.page.getByRole('group', { name: 'Conversations' })
    await conversations.getByRole('button', { name: /Test New Patient/ }).waitFor({ timeout: 15000 })
    await d.page.getByText('Choose a conversation').waitFor({ timeout: 5000 })
    await conversations.getByRole('button', { name: /Test Patient One/ }).click()
    await d.page.getByText('TEST message from the phone').waitFor({ timeout: 15000 })
    await d.page.getByLabel('Message').fill('TEST reply typed in the doctor portal')
    await d.page.getByRole('button', { name: 'Send', exact: true }).click()
    await d.page.getByRole('log').getByText('TEST reply typed in the doctor portal').waitFor({ timeout: 15000 })
    const sent = await row(patient.from('messages').select('from_id, client_ref').eq('content', 'TEST reply typed in the doctor portal'))
    if (sent.length !== 1 || sent[0].from_id !== docId || !sent[0].client_ref) throw new Error(JSON.stringify(sent))
    const told = (await row(patient.from('notifications').select('link, resource_type, resource_id').eq('kind', 'message').order('created_at', { ascending: false }).limit(1)))[0]
    if (told?.link !== 'messages' || told.resource_type !== 'conversation' || told.resource_id !== docId) throw new Error(JSON.stringify(told))
  })
  await step(d, 'the doctor sets working hours from Profile', async () => {
    await d.home2('Patients under care'); await d.page.getByRole('button', { name: 'Profile', exact: true }).click()
    await d.page.getByRole('button', { name: 'Set hours' }).click()
    await d.sheet().getByRole('switch', { name: 'See patients on Monday' }).click()
    await d.sheet().getByRole('button', { name: 'Save hours' }).click()
    await d.page.getByText(/Working hours saved/).waitFor({ timeout: 15000 })
    const hours = await row(service.from('doctor_hours').select('weekday, start_time').eq('doctor_id', docId))
    if (hours.length !== 1 || hours[0].weekday !== 1 || !hours[0].start_time.startsWith('09:00')) throw new Error(JSON.stringify(hours))
  })
  check('the doctor portal: no script errors', d.errors.length === 0, d.errors.join(' | '))
  await d.shot('doctor-patient'); await d.context.close()

  const p2 = await session('phone')
  await p2.signIn('test.patient@mcare.test')
  await step(p2, 'the patient sees the doctor\'s plan and the reading, and was told of both', async () => {
    await p2.page.getByText('Health Score').waitFor({ timeout: 25000 })
    await p2.page.getByRole('button', { name: /Meals$/ }).click()
    await p2.page.getByText('target set by your doctor').waitFor({ timeout: 15000 })
    await p2.page.getByText('TEST: keep salt low').waitFor({ timeout: 5000 })
    const told = (await row(patient.from('notifications').select('title'))).map(n => n.title)
    if (!told.includes('Your meal plan was updated') || !told.includes('A reading was added to your record')) throw new Error(told.join(', '))
  })
  await step(p2, 'the patient sees the consulting doctor on their care team', async () => {
    await p2.home(); await p2.page.getByRole('button', { name: /Care Team$/ }).click()
    await p2.page.getByText('Also on your care team').waitFor({ timeout: 15000 })
    await p2.page.getByText('Dr. Test Mutua').first().waitFor({ timeout: 5000 })
  })
  await step(p2, 'the patient is offered only the doctor\'s open times, and books one', async () => {
    await p2.nav('Appts')
    await p2.page.getByRole('button', { name: 'Request an appointment', exact: true }).first().click()
    await p2.page.getByPlaceholder('e.g. Blood pressure follow-up').fill('TEST slot visit')
    await p2.sheet().locator('input[type=date]').fill(mondayAfter(0))
    await p2.page.getByRole('radiogroup', { name: 'Open times' }).waitFor({ timeout: 15000 })
    if (await p2.sheet().locator('input[type=time]').count()) throw new Error('a free time field is offered for a doctor with a timetable')
    await p2.page.getByRole('radio', { name: '9:30 AM' }).click()
    await p2.page.getByRole('button', { name: 'Send request' }).click()
    await p2.page.getByText('TEST slot visit').first().waitFor({ timeout: 15000 })
    const ap = (await row(service.from('appointments').select('preferred_date, preferred_time, status').eq('title', 'TEST slot visit')))[0]
    if (ap?.preferred_date !== mondayAfter(0) || !ap.preferred_time?.startsWith('09:30') || ap.status !== 'requested') throw new Error(JSON.stringify(ap))
  })
  await p2.context.close()

  // A doctor who has just signed up, waiting to be approved.
  const pending = api(backend.anonKey)
  const pendingUp = await pending.auth.signUp({ email: 'test.pendingdoc@mcare.test', password: PW, options: { data: { full_name: 'Dr. Test Pending', role: 'doctor' } } })
  await service.from('doctors').update({ specialty: 'Nephrology', license_no: 'TEST-0003', hospital: 'mCare Test Clinic' }).eq('id', pendingUp.data.user.id)

  const a = await session('laptop')
  await a.signIn('test.admin@mcare.test')
  await step(a, 'the admin registers a user; nothing is claimed until it is saved', async () => {
    await a.nav('Users')
    await a.page.getByRole('button', { name: '+ Register' }).click()
    await a.sheet().getByPlaceholder('Their full name').fill('Test Invited Nurse')
    await a.sheet().getByPlaceholder('email@example.com').fill('test.invited@mcare.test')
    await a.sheet().getByRole('button', { name: 'mCare Assistant' }).click()
    await a.sheet().getByRole('button', { name: 'Register User' }).click()
    await a.page.getByText('Waiting to sign up (1)').waitFor({ timeout: 15000 })
    const inv = (await row(service.from('account_invitations').select('role, email')))[0]
    if (inv?.role !== 'assistant' || inv.email !== 'test.invited@mcare.test') throw new Error(JSON.stringify(inv))
  })
  await step(a, 'the admin sees the doctor\'s actions in the audit log, and documents without their titles', async () => {
    await a.nav('Audit Log')
    await a.page.getByText('Set meal plan').first().waitFor({ timeout: 15000 })
    await a.page.getByText('Recorded reading for patient').first().waitFor({ timeout: 5000 })
    // the search runs over the whole trail in the database
    await a.page.getByLabel('Search the audit log').fill('consulting')
    await a.page.getByText('Added consulting doctor').first().waitFor({ timeout: 15000 })
    await a.page.waitForTimeout(500)
    if (await a.page.getByText('Set meal plan').count()) throw new Error('the search did not narrow the list')
    await a.nav('Documents')
    await a.page.getByText('(title hidden)').first().waitFor({ timeout: 15000 })
    if (/test lab result/i.test(await a.text())) throw new Error('a document title is visible to the admin')
  })
  const pat2Id = (await row(service.from('profiles').select('id').eq('email', 'test.patient2@mcare.test').single())).id
  const doc2Id = (await row(service.from('profiles').select('id').eq('email', 'test.doctor2@mcare.test').single())).id
  await step(a, 'the admin assigns a doctor; the patient, the doctor and the history all show it', async () => {
    await a.nav('Assign')
    await a.page.getByRole('button', { name: /Test Patient Two/ }).first().click()
    await a.page.getByRole('button', { name: 'Assign a Doctor' }).click()
    await a.sheet().getByRole('button', { name: /Dr\. Test Mutua/ }).click()
    await a.page.getByText(/Doctor assigned/).waitFor({ timeout: 15000 })
    await a.page.getByText('Current').first().waitFor({ timeout: 10000 })
    const pt = await row(service.from('patients').select('assigned_doctor_id').eq('id', pat2Id).single())
    const open = await row(service.from('care_assignments').select('doctor_id, assigned_by').eq('patient_id', pat2Id).is('ended_at', null))
    if (pt.assigned_doctor_id !== doc2Id || open.length !== 1 || open[0].doctor_id !== doc2Id || !open[0].assigned_by) throw new Error(JSON.stringify({ pt, open }))
  })
  await patient.from('support_tickets').insert({ user_id: patId, subject: 'TEST wrong phone number', message: 'Please correct it' })
  await step(a, 'the admin answers a support request; the person who asked is told', async () => {
    await a.nav('Support')
    await a.page.getByText('TEST wrong phone number').waitFor({ timeout: 45000 })
    await a.page.getByRole('button', { name: 'Answer and close' }).first().click()
    await a.sheet().getByPlaceholder(/has been updated/).fill('TEST: number corrected')
    await a.sheet().getByRole('button', { name: 'Send and close' }).click()
    await a.page.getByText(/Answered ·/).waitFor({ timeout: 15000 })
    const t = (await row(service.from('support_tickets').select('status, resolution_note').eq('subject', 'TEST wrong phone number')))[0]
    if (t?.status !== 'resolved' || t.resolution_note !== 'TEST: number corrected') throw new Error(JSON.stringify(t))
    if (!(await row(patient.from('notifications').select('title'))).some(n => n.title === 'Support request answered')) throw new Error('the patient was not told')
  })
  await step(a, 'the admin suspends an account with a reason; the database then refuses that person', async () => {
    await a.nav('Users')
    await a.page.getByRole('row', { name: /Test Patient Two/ }).click()
    await a.sheet().getByRole('button', { name: /Suspend account/ }).click()
    await a.sheet().getByPlaceholder(/Kept with the account/).fill('TEST: requested by the patient')
    await a.sheet().getByRole('button', { name: 'Suspend', exact: true }).click()
    await a.page.getByText('Test Patient Two suspended').waitFor({ timeout: 15000 })
    const prof = await row(service.from('profiles').select('status, status_reason').eq('id', pat2Id).single())
    if (prof.status !== 'suspended' || prof.status_reason !== 'TEST: requested by the patient') throw new Error(JSON.stringify(prof))
    const blocked = api(backend.anonKey)
    await blocked.auth.signInWithPassword({ email: 'test.patient2@mcare.test', password: PW })
    if ((await row(blocked.from('patients').select('id')))?.length) throw new Error('a suspended patient can still read their record')
  })
  await step(a, 'the report is counted from the records', async () => {
    await a.nav('Reports')
    await a.page.getByText('Doctor workload').waitFor({ timeout: 20000 })
    await a.page.getByRole('row', { name: /Dr\. Test Achieng/ }).waitFor({ timeout: 5000 })
  })
  await step(a, 'the admin approves a doctor after checking the licence; the doctor can then work', async () => {
    await a.nav('Approvals')
    await a.page.getByText('Dr. Test Pending').waitFor({ timeout: 15000 })
    await a.page.getByRole('button', { name: 'Approve', exact: true }).first().click()
    await a.sheet().getByRole('button', { name: 'Approve', exact: true }).click()
    await a.page.getByText(/Dr\. Test Pending approved/).waitFor({ timeout: 15000 })
    const doc = await row(service.from('doctors').select('approval_status').eq('id', pendingUp.data.user.id).single())
    const prof = await row(service.from('profiles').select('status').eq('id', pendingUp.data.user.id).single())
    if (doc.approval_status !== 'approved' || prof.status !== 'active') throw new Error(JSON.stringify({ doc, prof }))
  })
  await step(a, 'support moves an appointment for the patient, within the doctor\'s hours; both are told', async () => {
    await a.nav('Appointments')
    await a.page.getByPlaceholder(/Search by reference/).fill('TEST slot visit')
    await a.page.getByRole('button', { name: 'Move', exact: true }).first().click()
    await a.sheet().locator('input[type=date]').fill(mondayAfter(1))
    await a.sheet().getByRole('radio', { name: '10:00 AM' }).click()
    await a.sheet().getByPlaceholder(/cannot travel/).fill('TEST: patient phoned')
    await a.sheet().getByRole('button', { name: 'Move appointment' }).click()
    await a.page.getByText(/Appointment moved ·/).waitFor({ timeout: 15000 })
    const ap = (await row(service.from('appointments').select('id, preferred_date, preferred_time').eq('title', 'TEST slot visit')))[0]
    if (ap?.preferred_date !== mondayAfter(1) || !ap.preferred_time?.startsWith('10:00')) throw new Error(JSON.stringify(ap))
    const moved = await row(service.from('appointment_events').select('action, detail').eq('appointment_id', ap.id).eq('action', 'moved'))
    if (moved.length !== 1 || !/TEST: patient phoned/.test(moved[0].detail)) throw new Error(JSON.stringify(moved))
    if (!(await row(patient.from('notifications').select('title'))).some(n => n.title === 'Appointment moved by mCare support')) throw new Error('the patient was not told')
  })
  check('the admin portal: no script errors', a.errors.length === 0, a.errors.join(' | '))
  await a.shot('admin-documents'); await a.context.close()

  /* an assistant sees only what their permissions open */
  const as = await session('laptop')
  await as.signIn('test.assistant@mcare.test')
  await step(as, 'an assistant is shown only the screens their permissions open', async () => {
    await as.page.getByRole('navigation').getByRole('button', { name: /Assign$/ }).waitFor({ timeout: 25000 })
    const nav = await as.page.getByRole('navigation').innerText()
    if (/Approvals|Audit Log|Documents|Reports/.test(nav)) throw new Error(`screens beyond the permissions are listed: ${nav.replace(/\n+/g, ' | ')}`)
    if (!/Alerts/.test(nav) || !/Support/.test(nav) || !/Appointments/.test(nav)) throw new Error(`a permitted screen is missing: ${nav.replace(/\n+/g, ' | ')}`)
  })
  check('the assistant portal: no script errors', as.errors.length === 0, as.errors.join(' | '))
  await as.context.close()

  /* ── every screen, three widths ── */
  console.log('\nLayout at phone, tablet and laptop width')
  for (const size of Object.keys(SIZES)) {
    const r = await session(size)
    const sticksOut = () => r.page.evaluate(() => {
      const vw = document.documentElement.clientWidth, out = []
      if (document.documentElement.scrollWidth > vw + 1) out.push('the page scrolls sideways')
      for (const el of document.querySelectorAll('#root *')) {
        const b = el.getBoundingClientRect()
        if (!b.width || !b.height || (b.right <= vw + 2 && b.left >= -2)) continue
        let a = el.parentElement, clipped = false
        while (a) { if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(a).overflowX)) { clipped = true; break } a = a.parentElement }
        if (!clipped) out.push(`${el.tagName.toLowerCase()} sticks out`)
      }
      return out.slice(0, 3)
    })
    const screens = [
      ['home', async () => {}],
      ['vitals', async () => { await r.nav('Vitals'); await r.page.getByRole('heading', { name: 'Vitals' }).waitFor() }],
      ['vital-detail', async () => { await r.page.locator('[data-vital="bp"]').getByRole('button').first().click(); await r.page.getByText('Latest reading').waitFor() }],
      ['meds', async () => { await r.nav('Meds'); await r.page.getByRole('heading', { name: 'Medications' }).waitFor() }],
      ['chat', async () => { await r.nav('Chat'); await r.page.getByLabel('Message').waitFor() }],
      ['appointments', async () => { await r.nav('Appts'); await r.page.getByRole('heading', { name: 'Appointments' }).waitFor() }],
      ['alerts', async () => { await r.home(); await r.page.getByRole('button', { name: /Alerts/ }).first().click(); await r.page.getByRole('heading', { name: 'My Alerts' }).waitFor() }],
      ['care-team', async () => { await r.home(); await r.page.getByRole('button', { name: /Care Team$/ }).click(); await r.page.getByRole('heading', { name: 'Care Team' }).waitFor() }],
      ['documents', async () => { await r.home(); await r.page.getByRole('button', { name: /Records/ }).click(); await r.page.getByRole('heading', { name: 'Documents' }).waitFor() }],
      ['meals', async () => { await r.home(); await r.page.getByRole('button', { name: /Meals$/ }).click(); await r.page.getByRole('heading', { name: 'Meals' }).waitFor() }],
      ['profile', async () => { await r.home(); await r.page.getByRole('button', { name: 'Profile', exact: true }).click(); await r.page.getByRole('heading', { name: 'Profile' }).waitFor() }],
    ]
    const problems = []
    try {
      await r.signIn('test.patient@mcare.test')
      await r.page.getByText('Health Score').waitFor({ timeout: 25000 })
      for (const [name, go] of screens) {
        await go(); await r.page.waitForTimeout(350); await r.shot(name)
        const out = await sticksOut()
        if (out.length) problems.push(`${name}: ${out.join(', ')}`)
      }
    } catch (e) { problems.push(String(e.message).split('\n')[0]) }
    check(`${size} (${SIZES[size].width}px): all ${screens.length} screens fit, no script errors`, problems.length === 0 && r.errors.length === 0, [...problems, ...r.errors].join(' | '))
    await r.context.close()

    /* the doctor's and the admin's portals at the same width */
    const portals = [
      ['doctor', 'test.doctor@mcare.test', 'Patients under care', [
        ['home', async x => {}],
        ['patients', async x => { await x.nav('Patients'); await x.page.getByRole('heading', { name: 'Patients' }).first().waitFor() }],
        ['patient', async x => { await x.page.getByRole('button', { name: /Test Patient One/ }).first().click(); await x.page.getByText('Latest Readings').waitFor() }],
        ['patient-vitals', async x => { await x.page.getByRole('button', { name: 'Vitals', exact: true }).click(); await x.page.getByText('Vitals and ranges').waitFor() }],
        ['patient-meds', async x => { await x.page.getByRole('button', { name: 'Meds', exact: true }).click(); await x.page.getByRole('button', { name: '+ New Prescription' }).waitFor() }],
        ['patient-plan', async x => { await x.page.getByRole('button', { name: 'Care plan', exact: true }).click(); await x.page.getByRole('button', { name: '+ New care plan' }).waitFor() }],
        ['patient-notes', async x => { await x.page.getByRole('button', { name: 'Notes', exact: true }).click(); await x.page.getByText('New Clinical Note').waitFor() }],
        ['appointments', async x => { await x.nav('Appts'); await x.page.getByRole('heading', { name: 'Appointments' }).waitFor() }],
        ['alerts', async x => { await x.nav('Alerts'); await x.page.getByRole('heading', { name: 'Alerts' }).waitFor() }],
        ['messages', async x => { await x.home2('Patients under care'); await x.page.getByRole('button', { name: /Messages/ }).click(); await x.page.getByRole('heading', { name: 'Messages' }).waitFor() }],
        ['profile', async x => { await x.home2('Patients under care'); await x.page.getByRole('button', { name: 'Profile', exact: true }).click(); await x.page.getByText('Availability').waitFor() }],
      ]],
      ['admin', 'test.admin@mcare.test', 'Patients on mCare', [
        ['home', async x => {}],
        ['approvals', async x => { await x.nav('Approvals'); await x.page.getByRole('heading', { name: 'Doctor Approvals' }).waitFor() }],
        ['assign', async x => { await x.nav('Assign'); await x.page.getByRole('heading', { name: 'Care Assignments' }).waitFor() }],
        ['users', async x => { await x.nav('Users'); await x.page.getByRole('heading', { name: 'Users' }).waitFor() }],
        ['alerts', async x => { await x.nav('Alerts'); await x.page.getByRole('heading', { name: 'Alert Monitor' }).waitFor() }],
        ['vitals', async x => { await x.nav('Vitals'); await x.page.getByRole('heading', { name: 'Vitals' }).waitFor() }],
        ['appointments', async x => { await x.home2('Patients on mCare'); await x.page.getByRole('button', { name: /^(📅\s*)?Appointments$/ }).first().click(); await x.page.getByPlaceholder(/Search by reference/).waitFor() }],
        ['support', async x => { await x.home2('Patients on mCare'); await x.page.getByRole('button', { name: /Support$/ }).first().click(); await x.page.getByText(/waiting ·/).waitFor() }],
        ['reports', async x => { await x.home2('Patients on mCare'); await x.page.getByRole('button', { name: /Reports$/ }).first().click(); await x.page.getByText('Doctor workload').waitFor({ timeout: 20000 }) }],
        ['audit', async x => { await x.home2('Patients on mCare'); await x.page.getByRole('button', { name: /Audit Log$/ }).first().click(); await x.page.getByPlaceholder(/Search the whole trail/).waitFor() }],
      ]],
    ]
    for (const [portal, email, marker, list] of portals) {
      const x = await session(size)
      const issues = []
      try {
        await x.signIn(email)
        await x.page.getByText(marker).first().waitFor({ timeout: 25000 })
        for (const [name, go] of list) {
          await go(x); await x.page.waitForTimeout(350); await x.shot(`${portal}-${name}`)
          const out = await x.page.evaluate(() => {
            const vw = document.documentElement.clientWidth, found = []
            if (document.documentElement.scrollWidth > vw + 1) found.push('the page scrolls sideways')
            for (const el of document.querySelectorAll('#root *')) {
              const b = el.getBoundingClientRect()
              if (!b.width || !b.height || (b.right <= vw + 2 && b.left >= -2)) continue
              let p = el.parentElement, clipped = false
              while (p) { if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(p).overflowX)) { clipped = true; break } p = p.parentElement }
              if (!clipped) found.push(`${el.tagName.toLowerCase()} sticks out`)
            }
            return found.slice(0, 3)
          })
          if (out.length) issues.push(`${name}: ${out.join(', ')}`)
        }
      } catch (e) { issues.push(String(e.message).split('\n').slice(0, 2).join(' / ')) }
      check(`${size} (${SIZES[size].width}px): the ${portal} portal's ${list.length} screens fit, no script errors`, issues.length === 0 && x.errors.length === 0, [...issues, ...x.errors].join(' | '))
      await x.context.close()
    }
  }
} finally {
  await browser.close()
  await vite.close()
  await backend.close()
}
console.log(`\n${pass} passed, ${fail} failed · screenshots in supabase/.data/screens`)
process.exit(fail ? 1 : 0)

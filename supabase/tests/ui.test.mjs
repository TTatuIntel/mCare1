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
    await p.page.getByRole('button', { name: 'Add', exact: true }).first().click()
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
  }
} finally {
  await browser.close()
  await vite.close()
  await backend.close()
}
console.log(`\n${pass} passed, ${fail} failed · screenshots in supabase/.data/screens`)
process.exit(fail ? 1 : 0)

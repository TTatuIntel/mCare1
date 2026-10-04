#!/usr/bin/env node
/**
 * Creates the labelled TEST accounts and a test world to try mCare with real data.
 *
 *   npm run backend:seed            (the local backend must be running)
 *
 * Every account is named "Test …" and uses an @mcare.test address, so test
 * records can never be mistaken for real patients. Safe to run again: it
 * creates missing accounts, refreshes the existing ones, and builds the test
 * world only once (npm run backend:reset starts over).
 *
 * The world is written through the same calls the app makes, each by the role
 * that would make it (the patient logs readings, the doctor prescribes, …), so
 * every rule, alert, notification and audit entry happens as it would for real.
 * The one exception: on the local backend, readings are then moved into the
 * past days so charts and trends have a history (the API stamps every reading
 * "now"). A hosted project gets today's readings only.
 *
 * MCARE_SEED_BASIC=1 makes the accounts and a small starter record only (the
 * browser tests use it). To seed a hosted project, set SUPABASE_URL,
 * SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (never put the service key in the app).
 */
import { createClient } from '@supabase/supabase-js'
import { readLocalKeys } from './server.mjs'

const local = readLocalKeys()
const url = process.env.SUPABASE_URL ?? `http://127.0.0.1:${process.env.MCARE_BACKEND_PORT || 54321}`
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? local?.serviceKey
const anonKey = process.env.SUPABASE_ANON_KEY ?? local?.anonKey
const password = process.env.MCARE_SEED_PASSWORD ?? 'M7c24'
const basic = process.env.MCARE_SEED_BASIC === '1'

if (!serviceKey || !anonKey) {
  console.error('No backend keys found. Start the backend first:  npm run backend')
  process.exit(1)
}

const ACCOUNTS = [
  { key: 'admin',     email: 'test.admin@mcare.test',     name: 'Test Admin',        role: 'admin' },
  { key: 'assistant', email: 'test.assistant@mcare.test', name: 'Test Assistant',    role: 'assistant',
    permissions: ['approve_patient_requests', 'assign_healthworkers', 'monitor_patients', 'handle_support'] },
  { key: 'doctor',    email: 'test.doctor@mcare.test',    name: 'Dr. Test Achieng',  role: 'doctor',
    doctor: { specialty: 'Cardiology', license_no: 'TEST-0001', hospital: 'mCare Test Clinic' } },
  { key: 'doctor2',   email: 'test.doctor2@mcare.test',   name: 'Dr. Test Mutua',    role: 'doctor',
    doctor: { specialty: 'Internal Medicine', license_no: 'TEST-0002', hospital: 'mCare Test Clinic' } },
  { key: 'patient',   email: 'test.patient@mcare.test',   name: 'Test Patient One',  role: 'patient', phone: '+254 700 000 101' },
]
/** The rest of the test world: a stable patient, a patient waiting for a doctor, a doctor waiting for approval. */
const WORLD_ACCOUNTS = [
  { key: 'patient2', email: 'test.patient2@mcare.test', name: 'Test Patient Two',   role: 'patient', phone: '+254 700 000 102' },
  { key: 'patient3', email: 'test.patient3@mcare.test', name: 'Test Patient Three', role: 'patient', phone: '+254 700 000 103' },
  { key: 'doctor3',  email: 'test.doctor3@mcare.test',  name: 'Dr. Test Wanjiru',   role: 'doctor', pending: true,
    doctor: { specialty: 'Endocrinology', license_no: 'TEST-0003', hospital: 'mCare Test Clinic' } },
]
const accounts = basic ? ACCOUNTS : [...ACCOUNTS, ...WORLD_ACCOUNTS]

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, serviceKey, options)
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data }
/** A client signed in as one of the test accounts: the world is written by whoever would write it in the app. */
async function as(email) {
  const client = createClient(url, anonKey, options)
  must(await client.auth.signInWithPassword({ email, password }), `sign in as ${email} (was the password changed?)`)
  return client
}

/* ─── time helpers (this computer's time zone, like the app) ─── */
const pad = n => String(n).padStart(2, '0')
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const daysAgo = (n, hh = 8, mm = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hh, mm, 0, 0); return d }
/** The next given weekday (0 = Sunday) at least `minDays` away, as YYYY-MM-DD. */
const nextWeekday = (weekday, minDays = 1) => {
  const d = new Date(); d.setDate(d.getDate() + minDays)
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1)
  return dayKey(d)
}
/** Repeatable "random" wobble, so every seeded world looks the same. */
const wobble = (i, spread) => Math.round(Math.sin(i * 12.9898) * 43758.5453 % 1 * spread)

try {
  /* ─── 1. accounts ─── */
  const existing = must(await admin.auth.admin.listUsers(), 'list users').users
  const ids = {}
  for (const a of accounts) {
    let user = existing.find(u => u.email === a.email)
    if (!user) {
      user = must(await admin.auth.admin.createUser({
        email: a.email, password, email_confirm: true,
        user_metadata: { full_name: a.name, phone: a.phone ?? '', ...(a.role === 'doctor' ? { role: 'doctor' } : {}) },
      }), `create ${a.email}`).user
    } else {
      must(await admin.auth.admin.updateUserById(user.id, { password }), `reset password for ${a.email}`)
    }
    ids[a.key] = user.id

    // Sign-up only ever makes a patient or a doctor awaiting approval. Staff and approval are set here, with the service key.
    if (a.role === 'admin' || a.role === 'assistant') {
      must(await admin.from('profiles').update({ role: a.role, status: 'active' }).eq('id', user.id), `role of ${a.email}`)
      must(await admin.from('patients').delete().eq('id', user.id), `patient row of ${a.email}`)
      must(await admin.from('staff').upsert({ id: user.id, is_assistant: a.role === 'assistant', permissions: a.permissions ?? [] }), `staff ${a.email}`)
    }
    if (a.role === 'doctor' && a.pending) {
      must(await admin.from('doctors').update(a.doctor).eq('id', user.id), `application of ${a.email}`)
    } else if (a.role === 'doctor') {
      must(await admin.from('doctors').update({ ...a.doctor, approval_status: 'approved', approved_by: ids.admin, approved_at: new Date().toISOString() }).eq('id', user.id), `approve ${a.email}`)
      must(await admin.from('profiles').update({ status: 'active' }).eq('id', user.id), `activate ${a.email}`)
    }
  }

  /* ─── 2. the starter record: Test Patient One under Dr. Test Achieng ─── */
  const pt = must(await admin.from('patients').select('assigned_doctor_id').eq('id', ids.patient).single(), 'read patient')
  if (!pt.assigned_doctor_id)
    must(await admin.from('patients').update({ assigned_doctor_id: ids.doctor }).eq('id', ids.patient), 'assign doctor')

  const doctor = await as('test.doctor@mcare.test')
  const rx = must(await doctor.from('prescriptions').select('id').eq('patient_id', ids.patient), 'read prescriptions')
  if (rx.length === 0) {
    must(await doctor.from('prescriptions').insert({ patient_id: ids.patient, doctor_id: ids.doctor, medication: 'TEST Amlodipine 5mg', dosage: '5mg', frequency: 'Once daily', purpose: 'Test record: blood pressure' }), 'prescribe')
    must(await doctor.from('thresholds').upsert({ patient_id: ids.patient, vital_id: 'bp', target_min: 90, target_max: 135 }), 'set target')
    must(await doctor.from('clinical_notes').insert({ patient_id: ids.patient, author_id: ids.doctor, content: 'TEST NOTE: log your blood pressure morning and evening this week.' }), 'add note')
  }

  /* ─── 3. the test world (once) ─── */
  let world = 'skipped (MCARE_SEED_BASIC=1)'
  if (!basic) {
    const already = must(await admin.from('readings').select('id').eq('patient_id', ids.patient).limit(1), 'look for readings')
    world = already.length ? 'already there (npm run backend:reset to start over)' : await buildWorld(ids, doctor)
  }
  await doctor.auth.signOut()

  /* ─── what to test with ─── */
  console.log('\nTest accounts (password for all: ' + password + ')\n')
  for (const a of accounts) console.log(`  ${(a.pending ? 'doctor*' : a.role).padEnd(10)} ${a.email.padEnd(28)} ${a.name}`)
  if (!basic) console.log('  * waiting for approval: approve as the admin (Doctor Approvals)')
  console.log(`\nTest world: ${world}\n`)
} catch (e) {
  console.error(`Seeding failed. ${e.message}`)
  if (/fetch failed|ECONNREFUSED/.test(String(e.message) + String(e.cause?.message ?? ''))) console.error('Is the backend running?  npm run backend')
  process.exit(1)
}

/** Builds the test world. Returns a line describing what was made. */
async function buildWorld(ids, doctor) {
  const doctor2 = await as('test.doctor2@mcare.test')
  const p1 = await as('test.patient@mcare.test')
  const p2 = await as('test.patient2@mcare.test')
  const p3 = await as('test.patient3@mcare.test')

  // Working hours, so visits can be asked for and booked (Monday to Friday, 9 to 5, 30-minute visits).
  const weekdays = [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '17:00' }))
  for (const [client, who] of [[doctor, 'Dr. Achieng'], [doctor2, 'Dr. Mutua']]) {
    must(await client.rpc('set_doctor_hours', { hours: weekdays, visit_minutes: 30 }), `working hours of ${who}`)
  }

  // Health profiles, as each patient fills in the first-run setup.
  const setup = async (client, id, who, { dob, health, vitals, contact }) => {
    must(await client.from('profiles').update({ dob }).eq('id', id), `date of birth of ${who}`)
    must(await client.rpc('save_health_profile', { profile: health }), `health profile of ${who}`)
    must(await client.rpc('set_tracked_vitals', { ids: vitals }), `tracked vitals of ${who}`)
    if (contact) must(await client.rpc('save_emergency_contact', { contact: { id: '', ...contact } }), `emergency contact of ${who}`)
    must(await client.from('patients').update({ profile_setup: 'done' }).eq('id', id), `finish setup of ${who}`)
  }
  await setup(p1, ids.patient, 'Test Patient One', {
    dob: '1968-04-12', vitals: ['bp', 'hr', 'gluc', 'wt', 'spo2', 'temp'],
    health: { sex: 'female', blood_type: 'O+', no_known_allergies: false, no_conditions: false, other_medicines: 'TEST Vitamin D 1000 IU',
      allergies: [{ substance: 'Penicillin', severity: 'moderate', reaction: 'Rash' }], conditions: ['Hypertension', 'Type 2 diabetes'] },
    contact: { name: 'Test Contact Mary', relationship: 'Sister', phone: '+254 700 000 201', next_of_kin: true },
  })
  await setup(p2, ids.patient2, 'Test Patient Two', {
    dob: '1985-09-30', vitals: ['bp', 'hr', 'spo2', 'temp'],
    health: { sex: 'male', blood_type: 'A+', no_known_allergies: true, no_conditions: false, other_medicines: '', allergies: [], conditions: ['Asthma'] },
    contact: { name: 'Test Contact James', relationship: 'Brother', phone: '+254 700 000 202', next_of_kin: true },
  })
  await setup(p3, ids.patient3, 'Test Patient Three', {
    dob: '1992-02-14', vitals: ['bp', 'hr', 'wt'],
    health: { sex: 'female', blood_type: 'B+', no_known_allergies: true, no_conditions: true, other_medicines: '', allergies: [], conditions: [] },
  })

  // Patient Two is under Dr. Achieng too; Patient Three asks for Dr. Mutua and waits for the care team to decide.
  must(await admin.from('patients').update({ assigned_doctor_id: ids.doctor }).eq('id', ids.patient2), 'assign Patient Two')
  must(await p3.rpc('request_doctor', { doctor: ids.doctor2 }), 'Patient Three asks for a doctor')

  // The doctor's side of Patient One: a second medicine, a sugar target, a meal plan, a care plan, a consultant.
  must(await doctor.from('prescriptions').insert({ patient_id: ids.patient, doctor_id: ids.doctor, medication: 'TEST Metformin 500mg', dosage: '500mg',
    frequency: 'Twice daily', route: 'oral', instructions: 'With breakfast and supper', purpose: 'Blood sugar' }), 'prescribe Metformin')
  must(await doctor.from('thresholds').upsert({ patient_id: ids.patient, vital_id: 'gluc', target_min: 80, target_max: 130 }), 'sugar target')
  must(await doctor.from('meal_plans').upsert({ patient_id: ids.patient, target_kcal: 1800, water_goal: 8, dietary_note: 'TEST: low salt, limit sugar',
    meals: [
      { id: 'breakfast', name: 'Breakfast', at: 450, foods: 'Oat porridge, banana', kcal: 380, icon: '🌅' },
      { id: 'lunch', name: 'Lunch', at: 780, foods: 'Brown rice, beans, sukuma wiki', kcal: 620, icon: '☀️' },
      { id: 'supper', name: 'Supper', at: 1140, foods: 'Ugali, greens, fish', kcal: 600, icon: '🌙' },
    ] }), 'meal plan')
  const plan = must(await doctor.rpc('save_care_plan', { plan: {
    id: '', patient_id: ids.patient, title: 'TEST Blood pressure and sugar control', summary: 'Three months: bring blood pressure and fasting sugar into range.',
    review_date: dayKey(daysAgo(-30)),
    items: [
      { id: '', kind: 'goal', text: 'Systolic blood pressure under 135', vital_id: 'bp', target_date: dayKey(daysAgo(-60)) },
      { id: '', kind: 'goal', text: 'Fasting blood sugar between 80 and 130', vital_id: 'gluc', target_date: dayKey(daysAgo(-60)) },
      { id: '', kind: 'intervention', text: 'Walk 30 minutes, five days a week', vital_id: '', target_date: '' },
      { id: '', kind: 'intervention', text: 'Take Amlodipine every morning', vital_id: '', target_date: '' },
    ] } }), 'care plan')
  must(await doctor.rpc('set_care_plan_status', { plan, new_status: 'active', note: null }), 'start the care plan')
  must(await doctor.rpc('add_consulting_doctor', { patient: ids.patient, doctor: ids.doctor2, reason: 'TEST: second opinion on blood sugar' }), 'add consulting doctor')
  must(await doctor.from('clinical_notes').insert({ patient_id: ids.patient, author_id: ids.doctor, content: 'TEST internal note: consider raising Amlodipine if BP stays above 135.', visibility: 'internal', note_type: 'assessment' }), 'internal note')

  // Two weeks of readings, all in range, logged by the patients and then moved into the past days.
  const history = []
  for (let day = 13; day >= 1; day--) {
    const i = 14 - day   // later days drift up a little: a trend for the charts and insights
    history.push(
      { patient_id: ids.patient, vital_id: 'bp', value: `${118 + Math.floor(i / 2) + wobble(i, 4)}/${76 + wobble(i + 50, 6)}`, at: daysAgo(day, 7, 30) },
      { patient_id: ids.patient, vital_id: 'bp', value: `${120 + Math.floor(i / 2) + wobble(i + 9, 4)}/${78 + wobble(i + 60, 6)}`, at: daysAgo(day, 19, 30) },
      { patient_id: ids.patient, vital_id: 'hr', value: String(70 + wobble(i + 20, 10)), at: daysAgo(day, 7, 35) },
      { patient_id: ids.patient, vital_id: 'gluc', value: String(104 + i + wobble(i + 30, 10)), at: daysAgo(day, 7, 0) },
      { patient_id: ids.patient2, vital_id: 'bp', value: `${116 + wobble(i + 70, 6)}/${74 + wobble(i + 80, 6)}`, at: daysAgo(day, 8, 15) },
      { patient_id: ids.patient2, vital_id: 'hr', value: String(68 + wobble(i + 90, 8)), at: daysAgo(day, 8, 20) },
      { patient_id: ids.patient2, vital_id: 'spo2', value: String(97 + wobble(i + 100, 2)), at: daysAgo(day, 8, 25) },
    )
    if (day % 3 === 1) history.push({ patient_id: ids.patient, vital_id: 'wt', value: (78.6 - i * 0.1).toFixed(1), at: daysAgo(day, 7, 40) })
    if (day % 2 === 0) history.push({ patient_id: ids.patient, vital_id: 'spo2', value: String(96 + wobble(i + 40, 2)), at: daysAgo(day, 7, 45) })
    if (day % 4 === 0) history.push({ patient_id: ids.patient, vital_id: 'temp', value: (98.0 + wobble(i + 110, 5) / 10).toFixed(1), at: daysAgo(day, 7, 50) })
    if (day <= 3) history.push({ patient_id: ids.patient3, vital_id: 'bp', value: `${114 + wobble(i + 120, 5)}/${72 + wobble(i + 130, 5)}`, at: daysAgo(day, 9, 0) })
  }
  const moves = []
  for (const [client, id] of [[p1, ids.patient], [p2, ids.patient2], [p3, ids.patient3]]) {
    const mine = history.filter(r => r.patient_id === id)
    const rows = must(await client.from('readings').insert(mine.map(({ at, ...r }) => r)).select('id'), 'log the readings history')
    rows.forEach((row, k) => moves.push({ id: row.id, at: mine[k].at.toISOString() }))
  }
  let dated = false
  const res = await fetch(`${url}/__dev/backdate-readings`, {
    method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(moves),
  }).catch(() => null)
  if (res?.ok) dated = true
  else console.warn('  Readings history stays at today: this backend cannot move readings into the past (only the local one can).')

  // The doctor's monitoring plan, and a review of the two weeks so far: today's readings come after it, so they wait for review.
  must(await doctor.rpc('set_vital_plan', { patient: ids.patient, vital: 'bp', frequency: 'twice_daily', reason: 'TEST: while we adjust Amlodipine', condition: 'hypertension' }), 'blood pressure plan')
  must(await doctor.rpc('set_vital_plan', { patient: ids.patient, vital: 'gluc', frequency: 'daily', reason: 'TEST: one fasting reading each morning', condition: 'diabetes_t2' }), 'sugar plan')
  must(await doctor.rpc('review_vitals', { patient: ids.patient, note: 'TEST: Two steady weeks. Keep going.', ref: null }), 'review of the readings')

  // Today, one at a time as a person would: in range, then blood pressure high twice in a row, which raises an alert.
  const today = [['hr', '76'], ['gluc', '118'], ['spo2', '97'], ['temp', '98.4'], ['bp', '128/82'], ['bp', '152/96'], ['bp', '156/98']]
  for (const [vital_id, value] of today) must(await p1.from('readings').insert({ patient_id: ids.patient, vital_id, value }), `today's ${vital_id}`)
  must(await p2.from('readings').insert({ patient_id: ids.patient2, vital_id: 'bp', value: '118/76' }), "Patient Two's reading")

  // Patient One's day so far, visits, messages and requests.
  must(await p1.from('hydration_logs').upsert({ patient_id: ids.patient, day: dayKey(new Date()), glasses: 3 }), 'water')
  must(await p1.from('meal_logs').upsert({ patient_id: ids.patient, meal_id: 'breakfast', day: dayKey(new Date()), note: 'Oat porridge' }), 'breakfast')
  must(await p1.from('appointments').insert({ patient_id: ids.patient, doctor_id: ids.doctor, title: 'TEST Blood pressure review',
    reason: 'My readings were high this morning', preferred_date: nextWeekday(2, 2), preferred_time: '10:00' }), 'visit request')
  must(await doctor.from('appointments').insert({ patient_id: ids.patient, doctor_id: ids.doctor, title: 'TEST Follow-up visit',
    reason: 'Review the new medicine', preferred_date: nextWeekday(4, 2), preferred_time: '11:00', status: 'approved', approval_note: 'Booked by Dr. Achieng' }), 'booked visit')
  must(await p2.from('appointments').insert({ patient_id: ids.patient2, doctor_id: ids.doctor, title: 'TEST Asthma check',
    reason: 'Routine check', preferred_date: nextWeekday(3, 2), preferred_time: '14:00' }), "Patient Two's visit request")
  const say = async (client, from_id, to_id, content) => must(await client.from('messages').insert({ from_id, to_id, content }), 'message')
  await say(p1, ids.patient, ids.doctor, 'TEST: My blood pressure was a bit high this morning.')
  await say(doctor, ids.doctor, ids.patient, 'TEST: Thank you. Rest for five minutes and measure again, and keep taking Amlodipine.')
  await say(p1, ids.patient, ids.doctor2, 'TEST: A question for my consultant about my sugar levels.')
  await say(p2, ids.patient2, ids.doctor, 'TEST: Is it fine to exercise with my inhaler?')
  must(await p1.from('report_requests').insert({ patient_id: ids.patient, doctor_id: ids.doctor, period_days: 30, reason: 'TEST: for my insurance' }), 'report request')
  must(await p2.from('support_tickets').insert({ user_id: ids.patient2, subject: 'TEST: I cannot change my phone number', message: 'The new number is not accepted.' }), 'support ticket')

  for (const c of [doctor2, p1, p2, p3]) await c.auth.signOut()
  return `built${dated ? ', with two weeks of readings' : ' (readings dated today)'}. Test Patient One has an open blood-pressure alert, `
    + 'two visits, messages and a report request; Patient Three waits for a doctor; Dr. Test Wanjiru waits for approval.'
}

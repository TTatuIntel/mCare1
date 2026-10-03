#!/usr/bin/env node
/**
 * Creates the labelled TEST accounts used to try mCare with real data.
 *
 *   npm run backend:seed            (the local backend must be running)
 *
 * Every account is named "Test …" and uses an @mcare.test address, so test
 * records can never be mistaken for real patients. Safe to run again: it
 * creates missing accounts and refreshes the existing test accounts.
 *
 * It uses the same supabase-js calls a hosted project accepts. To seed a
 * hosted project instead, set SUPABASE_URL, SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY (never put the service key in the app).
 */
import { createClient } from '@supabase/supabase-js'
import { readLocalKeys } from './server.mjs'

const local = readLocalKeys()
const url = process.env.SUPABASE_URL ?? `http://127.0.0.1:${process.env.MCARE_BACKEND_PORT || 54321}`
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? local?.serviceKey
const anonKey = process.env.SUPABASE_ANON_KEY ?? local?.anonKey
const password = process.env.MCARE_SEED_PASSWORD ?? 'A1b23'

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

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, serviceKey, options)
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data }

try {
  const existing = must(await admin.auth.admin.listUsers(), 'list users').users
  const ids = {}
  for (const a of ACCOUNTS) {
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
    if (a.role === 'doctor') {
      must(await admin.from('doctors').update({ ...a.doctor, approval_status: 'approved', approved_by: ids.admin, approved_at: new Date().toISOString() }).eq('id', user.id), `approve ${a.email}`)
      must(await admin.from('profiles').update({ status: 'active' }).eq('id', user.id), `activate ${a.email}`)
    }
  }

  // The single seeded patient is under Dr. Test Achieng and has a small clinical starter record.
  const pt = must(await admin.from('patients').select('assigned_doctor_id').eq('id', ids.patient).single(), 'read patient')
  if (!pt.assigned_doctor_id)
    must(await admin.from('patients').update({ assigned_doctor_id: ids.doctor }).eq('id', ids.patient), 'assign doctor')

  // A few clinical records, written as the doctor through the same API the doctor portal uses.
  const doctor = createClient(url, anonKey, options)
  must(await doctor.auth.signInWithPassword({ email: 'test.doctor@mcare.test', password }), 'sign in as the test doctor (was the password changed?)')
  const rx = must(await doctor.from('prescriptions').select('id').eq('patient_id', ids.patient), 'read prescriptions')
  if (rx.length === 0) {
    must(await doctor.from('prescriptions').insert({ patient_id: ids.patient, doctor_id: ids.doctor, medication: 'TEST Amlodipine 5mg', dosage: '5mg', frequency: 'Once daily', purpose: 'Test record: blood pressure' }), 'prescribe')
    must(await doctor.from('thresholds').upsert({ patient_id: ids.patient, vital_id: 'bp', target_min: 90, target_max: 135 }), 'set target')
    must(await doctor.from('clinical_notes').insert({ patient_id: ids.patient, author_id: ids.doctor, content: 'TEST NOTE: log your blood pressure morning and evening this week.' }), 'add note')
  }
  await doctor.auth.signOut()

  console.log('\nTest accounts (password for all: ' + password + ')\n')
  for (const a of ACCOUNTS) console.log(`  ${a.role.padEnd(10)} ${a.email.padEnd(28)} ${a.name}`)
  console.log('\nTest Patient One is assigned to Dr. Test Achieng.\n')
} catch (e) {
  console.error(`Seeding failed. ${e.message}`)
  if (/fetch failed|ECONNREFUSED/.test(String(e.message) + String(e.cause?.message ?? ''))) console.error('Is the backend running?  npm run backend')
  process.exit(1)
}

/**
 * End-to-end checks of the backend API, the way the app uses it: the real
 * supabase-js client talks HTTP to the local backend (supabase/dev/server.mjs),
 * which runs the migrations on a real Postgres engine.
 *
 *   npm i --no-save @electric-sql/pglite && node supabase/tests/api.test.mjs
 *
 * Covers sign-up and sessions, every patient workflow, the care-team side of
 * those workflows, and what happens when someone asks for records that are
 * not theirs. Nothing is kept: the database lives in memory for the run.
 */
import { createClient } from '@supabase/supabase-js'
import { startBackend } from '../dev/server.mjs'

const backend = await startBackend({ port: 0, dataDir: 'memory', quiet: true, jobs: false })
const client = (key = backend.anonKey) => createClient(backend.url, key, { auth: { persistSession: false, autoRefreshToken: false } })

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))}`) }
const PW = 'Test-Pass-2026'
const today = new Date().toISOString().slice(0, 10)
const inDays = n => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

/* ── Accounts ── */
console.log('\nSign-up and sessions')
const admin = client(backend.serviceKey)
const pat = client(), pat2 = client(), doc = client(), doc2 = client(), staff = client()

const up = await pat.auth.signUp({ email: 'Test.Patient@mcare.test ', password: PW, options: { data: { full_name: 'Test Patient One', phone: '+254 700 000 101', role: 'admin' } } })
check('sign-up signs the person in', !!up.data.session && up.data.user?.email === 'test.patient@mcare.test', up.error?.message)
const patId = up.data.user.id
const me = await pat.from('profiles').select('*').eq('id', patId).single()
check('the database made the profile, as a patient whatever the browser asked for', me.data?.role === 'patient' && me.data?.full_name === 'Test Patient One', me.error?.message ?? me.data?.role)
check('a new patient tracks blood pressure and heart rate', (await pat.from('tracked_vitals').select('vital_id')).data?.length === 2)
check('the same email cannot register twice', (await client().auth.signUp({ email: 'test.patient@mcare.test', password: PW })).error?.message === 'User already registered')
check('a short password is refused', !!(await client().auth.signUp({ email: 'short@mcare.test', password: 'Ab1' })).error)
const bad = await client().auth.signInWithPassword({ email: 'test.patient@mcare.test', password: 'wrong-password' })
check('wrong password: one message, no hint which part was wrong', bad.error?.code === 'invalid_credentials')
check('unknown email gets the same answer', (await client().auth.signInWithPassword({ email: 'nobody@mcare.test', password: PW })).error?.code === 'invalid_credentials')

const p2 = await pat2.auth.signUp({ email: 'test.patient2@mcare.test', password: PW, options: { data: { full_name: 'Test Patient Two' } } })
const pat2Id = p2.data.user.id
const mkDoctor = async (c, email, name) => {
  const r = await c.auth.signUp({ email, password: PW, options: { data: { full_name: name, role: 'doctor' } } })
  await admin.from('doctors').update({ approval_status: 'approved', specialty: 'Cardiology', hospital: 'mCare Test Clinic', license_no: 'TEST-1' }).eq('id', r.data.user.id)
  await admin.from('profiles').update({ status: 'active' }).eq('id', r.data.user.id)
  return r.data.user.id
}
const docId = await mkDoctor(doc, 'test.doctor@mcare.test', 'Dr. Test Achieng')
const doc2Id = await mkDoctor(doc2, 'test.doctor2@mcare.test', 'Dr. Test Mutua')
const st = await staff.auth.signUp({ email: 'test.admin@mcare.test', password: PW, options: { data: { full_name: 'Test Admin' } } })
const staffId = st.data.user.id
await admin.from('profiles').update({ role: 'admin' }).eq('id', staffId)
await admin.from('patients').delete().eq('id', staffId)
await admin.from('staff').upsert({ id: staffId, is_assistant: false, permissions: [] })

check('a signed-out visitor reads nothing', (await client().from('profiles').select('id')).data?.length === 0 && (await client().from('readings').select('id')).data?.length === 0)
check('a forged token is refused', await (async () => {
  const forged = createClient(backend.url, backend.anonKey, { global: { headers: { Authorization: `Bearer ${backend.anonKey.split('.').slice(0, 2).join('.')}.forged` } }, auth: { persistSession: false } })
  const r = await forged.from('profiles').select('id'); return r.status === 401
})())
check('the service key is not accepted from a signed-in user for admin calls', !!(await pat.auth.admin.listUsers()).error)

const before = (await pat.auth.getSession()).data.session
const refreshed = await pat.auth.refreshSession()
check('the session refreshes, and the old refresh token is spent', !!refreshed.data.session && refreshed.data.session.refresh_token !== before.refresh_token
  && !!(await client().auth.refreshSession({ refresh_token: before.refresh_token })).error)

/* ── The patient's own record ── */
console.log('\nPatient record')
check('profile: name, phone, birth date and theme save', !(await pat.from('profiles').update({ full_name: 'Test Patient One', phone: '+254 700 000 111', dob: '1980-05-17', theme: 'dark', font_size: 'lg' }).eq('id', patId)).error
  && (await pat.from('profiles').select('dob, theme').eq('id', patId).single()).data?.theme === 'dark')
check('…but not role, status or email', !!(await pat.from('profiles').update({ role: 'admin' }).eq('id', patId)).error && !!(await pat.from('profiles').update({ status: 'suspended' }).eq('id', patId)).error)
check("another person's profile cannot be changed", (await pat.from('profiles').update({ full_name: 'Hacked' }).eq('id', pat2Id).select()).data?.length === 0)
check('health profile saves in one request', !(await pat.rpc('save_health_profile', { profile: { sex: 'male', blood_type: 'O+', conditions: ['High blood pressure'], allergies: [{ substance: 'Penicillin', severity: 'severe', reaction: 'Hives' }], other_medicines: 'Vitamin D' } })).error
  && (await pat.from('allergies').select('substance')).data?.[0]?.substance === 'Penicillin' && (await pat.from('conditions').select('name')).data?.length === 1)
check('an invalid blood type is refused', !!(await pat.rpc('save_health_profile', { profile: { blood_type: 'Z+' } })).error)
const tv = await pat.rpc('set_tracked_vitals', { ids: ['bp', 'hr', 'gluc', 'spo2'] })
check('tracked vitals save and come back', tv.data?.slice().sort().join() === 'bp,gluc,hr,spo2', tv.error?.message ?? tv.data)
const ec = await pat.rpc('save_emergency_contact', { contact: { name: 'Mary Test', relationship: 'Spouse', phone: '+254 700 000 201', next_of_kin: true } })
check('emergency contact saves', typeof ec.data === 'string' && (await pat.from('emergency_contacts').select('name, next_of_kin')).data?.[0]?.next_of_kin === true, ec.error?.message)
check('…and can be removed', !(await pat.from('emergency_contacts').delete().eq('id', ec.data)).error && (await pat.from('emergency_contacts').select('id')).data?.length === 0)
check('setup state and unit preference save', !(await pat.from('patients').update({ profile_setup: 'done', unit_prefs: { temp: '°C' } }).eq('id', patId)).error
  && (await pat.from('patients').select('profile_setup, unit_prefs').single()).data?.unit_prefs?.temp === '°C')
check('consent is recorded at the server', !(await pat.rpc('accept_terms', { doc_version: '1' })).error && (await pat.from('consents').select('kind')).data?.length === 2)

/* ── Care team ── */
console.log('\nCare team')
const dir = await pat.from('doctors').select('id, specialty')
check('the patient sees the approved doctors', dir.data?.length === 2, dir.error?.message)
check('patient cannot assign their own doctor', !!(await pat.from('patients').update({ assigned_doctor_id: docId }).eq('id', patId)).error)
const rq = await pat.rpc('request_doctor', { doctor: docId })
check('doctor request is recorded and the admin is notified', typeof rq.data === 'string' && (await staff.from('notifications').select('title').like('title', 'Doctor request:*')).data?.length === 1, rq.error?.message)
check('the patient cannot approve their own request', !!(await pat.rpc('decide_doctor_request', { request: rq.data, approve: true })).error)
check('the admin approves; the doctor is assigned in the same step', !(await staff.rpc('decide_doctor_request', { request: rq.data, approve: true })).error
  && (await pat.from('patients').select('assigned_doctor_id').single()).data?.assigned_doctor_id === docId)
check('the doctor now sees this patient and no other', (await doc.from('patients').select('id')).data?.map(r => r.id).join() === patId
  && (await doc2.from('patients').select('id')).data?.length === 0)
check('patient rates their doctor; the directory shows the average', !(await pat.from('doctor_ratings').upsert({ patient_id: patId, doctor_id: docId, rating: 4 })).error
  && Number((await pat2.rpc('doctor_rating_summary', { doctor: docId })).data?.[0]?.average) === 4)

/* ── Vitals and alerts ── */
console.log('\nVitals and alerts')
const log = (c, vital, value, patient = patId, note) => c.from('readings').insert({ patient_id: patient, vital_id: vital, value, note }).select().single()
const n1 = await log(pat, 'hr', '72', patId, 'Resting')
check('a reading is saved, graded and time-stamped by the server', n1.data?.level === 'normal' && n1.data?.recorded_by === patId && !!n1.data?.taken_at, n1.error?.message)
check('an impossible value is refused with a readable reason', /usually between/.test((await log(pat, 'hr', '900')).error?.message ?? ''))
check('a reading cannot be filed under another patient', !!(await log(pat, 'hr', '70', pat2Id)).error)
check('the grade cannot be chosen by the browser', (await pat.from('readings').insert({ patient_id: patId, vital_id: 'spo2', value: '97', level: 'critical' }).select().single()).data?.level === 'normal')
const w1 = await log(pat, 'bp', '142/91')
check('first out-of-range reading: no alert yet', w1.data?.level === 'warning' && (await pat.from('alerts').select('id')).data?.length === 0)
const sent = await pat.rpc('send_alert_now', { reading: w1.data.id })
check('"send to doctor now" raises the alert for that reading', typeof sent.data === 'string' && (await pat.from('alerts').select('reading_id, severity')).data?.[0]?.reading_id === w1.data.id, sent.error?.message)
const c1 = await log(pat, 'spo2', '86')
const alerts = (await pat.from('alerts').select('*').order('created_at', { ascending: false })).data
const critical = alerts.find(a => a.reading_id === c1.data.id)
check('a critical reading raises an alert at once', c1.data?.level === 'critical' && critical?.severity === 'danger' && critical?.status === 'open')
check('the doctor and the patient are both notified', (await doc.from('notifications').select('title').like('title', 'Critical:*')).data?.length === 1
  && (await pat.from('notifications').select('title').like('title', 'Critical reading*')).data?.length === 1)
check('the patient cannot create, resolve or edit an alert', !!(await pat.from('alerts').insert({ patient_id: patId, severity: 'warning', value: '1', vital_id: 'hr' })).error
  && (await pat.from('alerts').update({ status: 'resolved', resolution_reason: 'I am fine' }).eq('id', critical.id).select()).data?.length === 0)
check('another patient sees none of it', (await pat2.from('readings').select('id').eq('patient_id', patId)).data?.length === 0
  && (await pat2.from('alerts').select('id')).data?.length === 0 && (await pat2.from('notifications').select('id').eq('user_id', patId)).data?.length === 0)
check('a doctor who does not treat the patient sees none of it', (await doc2.from('readings').select('id')).data?.length === 0 && (await doc2.from('alerts').select('id')).data?.length === 0)

check('the doctor acknowledges; the patient is told', (await doc.from('alerts').update({ status: 'acknowledged' }).eq('id', critical.id).select().single()).data?.acknowledged_by === docId
  && (await pat.from('notifications').select('id').eq('title', 'Your alert is being reviewed')).data?.length === 1)
check('resolving without a reason is refused', !!(await doc.from('alerts').update({ status: 'resolved' }).eq('id', critical.id)).error)
const res = await doc.from('alerts').update({ status: 'resolved', resolution_reason: 'Medication adjusted', resolution_note: 'Call if it drops again' }).eq('id', critical.id).select().single()
check('the doctor resolves with a reason; the patient reads it', res.data?.resolved_by === docId
  && (await pat.from('alerts').select('resolution_reason, resolution_note, value').eq('id', critical.id).single()).data?.resolution_note === 'Call if it drops again', res.error?.message)
check('a resolved alert cannot be reopened', !!(await doc.from('alerts').update({ status: 'open' }).eq('id', critical.id)).error)
const fix = await pat.from('readings').update({ value: '73' }).eq('id', n1.data.id).select().single()
check('a typo is corrected within 15 minutes and the first value is kept', fix.data?.value === '73' && fix.data?.corrected_from === '72', fix.error?.message)
check('the doctor marks a reading invalid; the patient cannot', !!(await pat.from('readings').update({ invalid: true, invalid_reason: 'x' }).eq('id', w1.data.id)).error
  && (await doc.from('readings').update({ invalid: true, invalid_reason: 'Cuff slipped' }).eq('id', w1.data.id).select().single()).data?.invalid === true)
const dr = await log(doc, 'hr', '80')
check('the treating doctor records a reading; it is attributed to them', dr.data?.recorded_by === docId && dr.data?.patient_id === patId, dr.error?.message)
check('the other doctor cannot', !!(await log(doc2, 'hr', '80')).error)

const sos = await pat.rpc('raise_sos', { message: 'Chest pain' })
check('SOS reaches the doctor and the admin', typeof sos.data === 'string' && (await doc.from('notifications').select('id').like('title', 'SOS:*')).data?.length === 1
  && (await staff.from('notifications').select('id').like('title', 'SOS:*')).data?.length === 1, sos.error?.message)
check('a doctor cannot raise an SOS', !!(await doc.rpc('raise_sos', { message: 'x' })).error)
check('the patient marks themself safe', !(await pat.rpc('cancel_sos', { alert: sos.data })).error
  && (await pat.from('alerts').select('status, resolution_reason').eq('id', sos.data).single()).data?.resolution_reason === 'Patient marked safe')

/* ── Medication, meals ── */
console.log('\nMedication and meals')
check('a patient cannot prescribe', !!(await pat.from('prescriptions').insert({ patient_id: patId, doctor_id: docId, medication: 'X', dosage: '1', frequency: 'Once daily' })).error)
const rx = await doc.from('prescriptions').insert({ patient_id: patId, doctor_id: docId, medication: 'TEST Amlodipine 5mg', dosage: '5mg', frequency: 'Once daily', purpose: 'Blood pressure' }).select().single()
check('the doctor prescribes; the patient sees it and is notified', (await pat.from('prescriptions').select('medication')).data?.[0]?.medication === 'TEST Amlodipine 5mg'
  && (await pat.from('notifications').select('id').eq('title', 'New prescription')).data?.length === 1, rx.error?.message)
check('the prescription is filed in the patient\'s documents', (await pat.from('documents').select('category, status')).data?.[0]?.status === 'released')
const dose = { patient_id: patId, prescription_id: rx.data.id, slot: 480, day: today }
check('a dose is ticked off, once', !(await pat.from('dose_logs').insert(dose)).error && (await pat.from('dose_logs').insert(dose)).status === 409)
check('…and can be un-ticked', !(await pat.from('dose_logs').delete().eq('prescription_id', rx.data.id).eq('slot', 480).eq('day', today)).error && (await pat.from('dose_logs').select('slot')).data?.length === 0)
check('another patient cannot log against that prescription', !!(await pat2.from('dose_logs').insert({ ...dose, patient_id: pat2Id })).error)
check('the doctor stops it; the patient is told', !(await doc.from('prescriptions').update({ active: false }).eq('id', rx.data.id)).error
  && (await pat.from('notifications').select('id').eq('title', 'Medication stopped')).data?.length === 1)
check('a meal is logged with what was eaten', !(await pat.from('meal_logs').insert({ patient_id: patId, meal_id: 'lunch', day: today, note: 'Ugali and sukuma wiki' })).error
  && (await pat.from('meal_logs').select('note')).data?.[0]?.note === 'Ugali and sukuma wiki')
check('water is saved once per day and can be changed', !(await pat.from('hydration_logs').upsert({ patient_id: patId, day: today, glasses: 3 })).error
  && !(await pat.from('hydration_logs').upsert({ patient_id: patId, day: today, glasses: 5 })).error
  && (await pat.from('hydration_logs').select('glasses')).data?.map(r => r.glasses).join() === '5')
check('the doctor sets the meal plan; the patient reads it', !(await doc.from('meal_plans').upsert({ patient_id: patId, set_by: docId, target_kcal: 1800, water_goal: 8, dietary_note: 'Limit sodium' })).error
  && (await pat.from('meal_plans').select('dietary_note').single()).data?.dietary_note === 'Limit sodium'
  && (await pat.from('meal_plans').update({ target_kcal: 5000 }).eq('patient_id', patId).select()).data?.length === 0)

/* ── Appointments, messages, notifications, reports ── */
console.log('\nAppointments, messages, reports')
const ap = await pat.from('appointments').insert({ patient_id: patId, doctor_id: docId, title: 'BP review', reason: 'Readings high', preferred_date: inDays(7), preferred_time: '10:00' }).select().single()
check('the patient requests an appointment; the doctor is told', ap.data?.status === 'requested' && (await doc.from('notifications').select('id').eq('title', 'New appointment request')).data?.length === 1, ap.error?.message)
check('a past date and self-approval are refused', !!(await pat.from('appointments').insert({ patient_id: patId, doctor_id: docId, title: 'x', preferred_date: inDays(-2) })).error
  && !!(await pat.from('appointments').update({ status: 'approved' }).eq('id', ap.data.id)).error)
check('an appointment cannot be requested in another patient\'s name', !!(await pat.from('appointments').insert({ patient_id: pat2Id, doctor_id: docId, title: 'x', preferred_date: inDays(3) })).error)
await doc.from('appointments').update({ status: 'rescheduled', rescheduled_date: inDays(9), rescheduled_time: '14:30', rescheduled_reason: 'Clinic closed' }).eq('id', ap.data.id)
const acc = await pat.from('appointments').update({ status: 'approved' }).eq('id', ap.data.id).select().single()
check('the doctor proposes a new time; accepting moves the appointment', acc.data?.status === 'approved' && acc.data?.preferred_date === inDays(9) && acc.data?.preferred_time?.startsWith('14:30'), acc.error?.message)
check('the patient cancels; the doctor is told', (await pat.from('appointments').update({ status: 'cancelled' }).eq('id', ap.data.id).select().single()).data?.status === 'cancelled'
  && (await doc.from('notifications').select('id').eq('title', 'Appointment cancelled')).data?.length === 1)
check('the other doctor never saw it', (await doc2.from('appointments').select('id')).data?.length === 0)

const msg = await pat.from('messages').insert({ from_id: patId, to_id: docId, content: 'Feeling dizzy after the new dose' }).select().single()
check('the patient messages their doctor; the doctor is notified', !!msg.data?.id && (await doc.from('notifications').select('id').like('title', 'New message from*')).data?.length === 1, msg.error?.message)
check('…but not a doctor who is not theirs, nor as someone else', !!(await pat.from('messages').insert({ from_id: patId, to_id: doc2Id, content: 'Hi' })).error
  && !!(await pat.from('messages').insert({ from_id: docId, to_id: patId, content: 'Forged' })).error)
check('the doctor replies and marks it read; the admin cannot read the conversation', !(await doc.from('messages').insert({ from_id: docId, to_id: patId, content: 'Take it with food' })).error
  && (await doc.from('messages').update({ read: true }).eq('from_id', patId).eq('to_id', docId).eq('read', false).select()).data?.length === 1
  && (await staff.from('messages').select('id')).data?.length === 0)
const mine = (await pat.from('notifications').select('id, read').eq('read', false)).data
check('notifications are marked read, one or all', mine.length > 2
  && (await pat.from('notifications').update({ read: true }).eq('id', mine[0].id).select()).data?.length === 1
  && (await pat.from('notifications').update({ read: true }).eq('user_id', patId).eq('read', false).select()).data?.length === mine.length - 1
  && (await pat.from('notifications').update({ read: true }).eq('user_id', docId).select()).data?.length === 0)

const rr = await pat.from('report_requests').insert({ patient_id: patId, doctor_id: docId, period_days: 30, reason: 'Insurance' }).select().single()
check('the patient asks for a vitals report; the doctor is told', rr.data?.status === 'pending' && (await doc.from('notifications').select('id').like('title', 'Report request:*')).data?.length === 1, rr.error?.message)
check('the doctor declines with a reason; the patient reads it', !(await doc.from('report_requests').update({ status: 'declined', decline_reason: 'Not enough readings yet' }).eq('id', rr.data.id)).error
  && (await pat.from('report_requests').select('decline_reason').single()).data?.decline_reason === 'Not enough readings yet')
check('a support request is saved and reaches the admin', !(await pat.from('support_tickets').insert({ user_id: patId, subject: 'Change my email', message: 'Please help' })).error
  && (await staff.from('support_tickets').select('subject')).data?.length === 1 && (await pat2.from('support_tickets').select('id')).data?.length === 0)

/* ── Documents and files ── */
console.log('\nDocuments')
const bytes = new TextEncoder().encode('%PDF-1.4 test file for mCare')
const path = `${patId}/0123abcd.pdf`
const upload = await pat.storage.from('documents').upload(path, bytes, { contentType: 'application/pdf', upsert: true })
check('the patient uploads a file into their own folder', !upload.error, upload.error?.message)
check('…and not into someone else\'s', !!(await pat.storage.from('documents').upload(`${pat2Id}/x.pdf`, bytes, { contentType: 'application/pdf' })).error)
check('a path that climbs out of the folder is refused', !!(await pat.storage.from('documents').upload(`${patId}/../x.pdf`, bytes, { contentType: 'application/pdf' })).error)
const row = await pat.from('documents').insert({ patient_id: patId, title: 'Lab result', category: 'lab', origin: 'patient_upload', file_path: path, file_name: 'lab.pdf', file_mime: 'application/pdf', file_size: bytes.length, file_sha256: '0123abcd', upload_state: 'ready', visibility: 'care_team' }).select().single()
check('the document is recorded; the same file twice is refused', !!row.data?.id && (await pat.from('documents').insert({ patient_id: patId, title: 'Again', category: 'lab', origin: 'patient_upload', file_sha256: '0123abcd', upload_state: 'ready' })).status === 409, row.error?.message)
const text = async c => { const d = await c.storage.from('documents').download(path); return d.data ? await d.data.text() : null }
check('the patient and the treating doctor can open the file', (await text(pat))?.startsWith('%PDF') && (await text(doc))?.startsWith('%PDF'))
check('another patient, another doctor and the admin cannot', (await text(pat2)) === null && (await text(doc2)) === null && (await text(staff)) === null)
check('opening is recorded in the document\'s history', !(await pat.rpc('record_document_access', { doc: row.data.id, act: 'view' })).error
  && (await pat.from('document_events').select('action').eq('document_id', row.data.id)).data?.some(e => e.action === 'view'))
check('made private, the doctor loses the row and the file', !(await pat.from('documents').update({ visibility: 'private' }).eq('id', row.data.id)).error
  && (await doc.from('documents').select('id').eq('id', row.data.id)).data?.length === 0 && (await text(doc)) === null)
const link = await pat.rpc('create_share_link', { docs: [row.data.id], recipient: 'Dr. Outside, Test Hospital', ttl_hours: 24, one_time: true })
check('a share link opens once for someone without an account', typeof link.data === 'string'
  && (await client().rpc('open_share_link', { token: link.data })).data?.length === 1 && !!(await client().rpc('open_share_link', { token: link.data })).error, link.error?.message)
check('the patient deletes and restores their upload', !(await pat.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', row.data.id)).error
  && !(await pat.from('documents').update({ deleted_at: null }).eq('id', row.data.id)).error
  && (await pat.from('documents').select('deleted_at').eq('id', row.data.id).single()).data?.deleted_at === null)
check('the patient cannot forge an official report', !!(await pat.from('documents').insert({ patient_id: patId, title: 'Fake', category: 'vitals_report', origin: 'system_generated', status: 'released' })).error)

/* ── Sessions end ── */
console.log('\nPassword and sign-out')
await client().auth.resetPasswordForEmail('test.patient2@mcare.test')
const code = backend.outbox.find(m => m.to === 'test.patient2@mcare.test' && m.kind === 'recovery')?.code
const rec = client()
check('a wrong reset code is refused', !!(await client().auth.verifyOtp({ email: 'test.patient2@mcare.test', token: '000000', type: 'recovery' })).error)
const verified = await rec.auth.verifyOtp({ email: 'test.patient2@mcare.test', token: code, type: 'recovery' })
check('the emailed code proves the person, once', !!verified.data.session && !!(await client().auth.verifyOtp({ email: 'test.patient2@mcare.test', token: code, type: 'recovery' })).error, verified.error?.message)
check('a new password replaces the old one', !(await rec.auth.updateUser({ password: 'New-Pass-2027' })).error
  && !!(await client().auth.signInWithPassword({ email: 'test.patient2@mcare.test', password: PW })).error
  && !!(await client().auth.signInWithPassword({ email: 'test.patient2@mcare.test', password: 'New-Pass-2027' })).data.session)
check('changing the password signs out the other devices', (await pat2.from('profiles').select('id')).status === 401)
check('asking to reset an unknown email gives nothing away', !(await client().auth.resetPasswordForEmail('nobody@mcare.test')).error)

const token = (await pat.auth.getSession()).data.session.access_token
await pat.auth.signOut()
const stale = createClient(backend.url, backend.anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } })
check('after sign-out the old token no longer works', (await stale.from('profiles').select('id')).status === 401)
check('deactivating an account locks it out', await (async () => {
  const c = client(); await c.auth.signInWithPassword({ email: 'test.patient@mcare.test', password: PW })
  await c.rpc('deactivate_my_account')
  return (await c.from('readings').select('id')).data?.length === 0 && !!(await c.rpc('raise_sos', { message: 'x' })).error
    && (await staff.from('profiles').select('status').eq('id', patId).single()).data?.status === 'suspended'
})())

console.log(`\n${pass} passed, ${fail} failed`)
await backend.close()
process.exit(fail ? 1 : 0)

/**
 * Runs the migrations against a real Postgres engine (PGlite, in memory) and
 * checks the access rules and alert rules as each kind of user.
 *
 *   npm i --no-save @electric-sql/pglite && node supabase/tests/rules.test.mjs
 *
 * Supabase provides the `auth` schema and the `authenticated` role; here they
 * are stubbed with the same shape so the migration runs unchanged.
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const db = new PGlite()

await db.exec(`
  create role authenticated nologin; create role anon nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  -- Supabase's defaults: new tables and functions in public are granted to app users as they are created.
  grant usage on schema public to authenticated, anon;
  alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
  alter default privileges in schema public grant usage on sequences to authenticated;
  alter default privileges in schema public grant execute on functions to authenticated, anon;
`)
const dir = join(here, '..', 'migrations')
for (const f of readdirSync(dir).sort()) {
  try { await db.exec(readFileSync(join(dir, f), 'utf8')) }
  catch (e) { console.error(`Migration ${f} failed: ${e.message}${e.position ? ` (at character ${e.position})` : ''}`); process.exit(1) }
}

const ID = { pat: '11111111-1111-4111-8111-111111111111', pat2: '22222222-2222-4222-8222-222222222222',
  doc: '33333333-3333-4333-8333-333333333333', doc2: '44444444-4444-4444-8444-444444444444',
  admin: '55555555-5555-4555-8555-555555555555', asst: '66666666-6666-4666-8666-666666666666', evil: '77777777-7777-4777-8777-777777777777' }

/** Run SQL as a signed-in user, the way a request from the app arrives. */
async function as(user, sql, params = []) {
  // No user = a signed-out visitor: Supabase runs those requests as the `anon` role.
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${user ?? ''}', false);`)
  try { return (await db.query(sql, params)).rows } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
const denied = async (user, sql, params) => { try { const r = await as(user, sql, params); return { blocked: false, rows: r.length } } catch (e) { return { blocked: true, why: e.message } } }

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : '  → ' + extra}`) }

/* ── Sign-ups (what Supabase Auth does on register) ── */
await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${ID.pat}',  'james@example.com', '{"full_name":"James Mwangi","phone":"+254 712 345 678"}'),
    ('${ID.pat2}', 'grace@example.com', '{"full_name":"Grace Otieno"}'),
    ('${ID.doc}',  'amara@knh.go.ke',   '{"full_name":"Dr. Amara Osei","role":"doctor"}'),
    ('${ID.doc2}', 'other@knh.go.ke',   '{"full_name":"Dr. Other","role":"doctor"}'),
    ('${ID.evil}', 'evil@example.com',  '{"full_name":"Mallory","role":"admin"}'),
    ('${ID.admin}','admin@mcare.app',   '{"full_name":"Admin"}'),
    ('${ID.asst}', 'asst@mcare.app',    '{"full_name":"Assistant"}');
  -- An existing admin promotes staff and approves doctors (service-role actions).
  update profiles set role = 'admin' where id = '${ID.admin}'; delete from patients where id = '${ID.admin}'; insert into staff (id) values ('${ID.admin}');
  update profiles set role = 'assistant' where id = '${ID.asst}'; delete from patients where id = '${ID.asst}';
  insert into staff (id, is_assistant, permissions) values ('${ID.asst}', true, '{approve_patient_requests}');
  update doctors set approval_status = 'approved', specialty = 'Cardiology'; update profiles set status = 'active' where role = 'doctor';
`)
console.log('\nSign-up')
const roles = Object.fromEntries((await db.query(`select id, role from profiles`)).rows.map(r => [r.id, r.role]))
check('sign-up asking for "admin" becomes a patient', roles[ID.evil] === 'patient', roles[ID.evil])
check('doctor sign-up creates a doctor', roles[ID.doc] === 'doctor')
check('new patient tracks blood pressure and heart rate', (await db.query(`select count(*)::int n from tracked_vitals where patient_id = $1`, [ID.pat])).rows[0].n === 2)

/* ── Who can see whom ── */
console.log('\nPrivacy')
check('patient sees only their own patient record', (await as(ID.pat, `select id from patients`)).length === 1)
check('patient cannot read another patient by id', (await as(ID.pat, `select id from patients where id = $1`, [ID.pat2])).length === 0)
check('unassigned doctor sees no patients', (await as(ID.doc, `select id from patients`)).length === 0)
check('signed-out visitor is refused', (await denied(null, `select id from profiles`)).blocked && (await denied(null, `select id from readings`)).blocked)
check('patient sees approved doctors (directory)', (await as(ID.pat, `select id from doctors`)).length === 2)
check('patient cannot make themself admin', (await denied(ID.pat, `update profiles set role = 'admin' where id = $1`, [ID.pat])).blocked)
check('patient cannot assign their own doctor', (await denied(ID.pat, `update patients set assigned_doctor_id = $1 where id = $2`, [ID.doc, ID.pat])).blocked)

/* ── Doctor request → assignment ── */
console.log('\nDoctor request')
await as(ID.pat, `select request_doctor($1)`, [ID.doc])
check('request is recorded', (await as(ID.pat, `select status from doctor_requests`))[0]?.status === 'pending')
check('approvers are notified (admin + assistant with permission)', (await db.query(`select count(*)::int n from notifications where kind = 'assignment'`)).rows[0].n === 2)
await denied(ID.asst, `update patients set assigned_doctor_id = $1 where id = $2`, [ID.doc, ID.pat])
check('assistant without assign permission cannot assign', (await db.query(`select assigned_doctor_id from patients where id = $1`, [ID.pat])).rows[0].assigned_doctor_id === null)
await as(ID.admin, `update patients set assigned_doctor_id = $1 where id = $2`, [ID.doc, ID.pat])
check('admin assigns the doctor', (await db.query(`select assigned_doctor_id from patients where id = $1`, [ID.pat])).rows[0].assigned_doctor_id === ID.doc)
check('assigned doctor now sees that patient only', (await as(ID.doc, `select id from patients`)).length === 1)
check('other doctor still sees nobody', (await as(ID.doc2, `select id from patients`)).length === 0)

/* ── Readings and alerts ── */
console.log('\nReadings and alerts')
const alertsN = async () => (await db.query(`select count(*)::int n from alerts where patient_id = $1`, [ID.pat])).rows[0].n
const log = (v, val, who = ID.pat, pt = ID.pat) => as(who, `insert into readings (patient_id, vital_id, value) values ($1, $2, $3) returning level`, [pt, v, val])
check('normal reading: graded normal, no alert', (await log('hr', '72'))[0].level === 'normal' && await alertsN() === 0)
check('one warning reading: no alert yet (asked to re-measure)', (await log('bp', '142/91'))[0].level === 'warning' && await alertsN() === 0)
check('second abnormal reading within the hour: warning alert', (await log('bp', '144/92'))[0].level === 'warning' && await alertsN() === 1)
check('in-range re-measure within 30 min clears the warning', (await log('bp', '120/80'))[0].level === 'normal'
  && (await db.query(`select status, resolution_reason from alerts where patient_id = $1`, [ID.pat])).rows[0].status === 'resolved')
check('critical reading alerts immediately', (await log('spo2', '86'))[0].level === 'critical' && await alertsN() === 2)
check('diastolic alone can make blood pressure critical', (await log('bp', '128/124'))[0].level === 'critical')
check('impossible value is rejected', (await denied(ID.pat, `insert into readings (patient_id, vital_id, value) values ($1, 'hr', '900')`, [ID.pat])).blocked)
check('badly formatted blood pressure is rejected', (await denied(ID.pat, `insert into readings (patient_id, vital_id, value) values ($1, 'bp', '120')`, [ID.pat])).blocked)
check('patient cannot log a reading for someone else', (await denied(ID.pat, `insert into readings (patient_id, vital_id, value) values ($1, 'hr', '70')`, [ID.pat2])).blocked)
check('patient cannot create an alert directly', (await denied(ID.pat, `insert into alerts (patient_id, severity, value) values ($1, 'danger', 'x')`, [ID.pat])).blocked)
check('patient cannot resolve their own vital alert', (await as(ID.pat, `update alerts set status = 'resolved' where patient_id = $1 returning id`, [ID.pat])).length === 0)
check('care team was notified of the critical alert', (await as(ID.doc, `select 1 from notifications where kind = 'alert' and title like 'Critical:%'`)).length >= 1)
check('treating doctor reads the readings', (await as(ID.doc, `select id from readings`)).length === 6)
check('other doctor reads none', (await as(ID.doc2, `select id from readings`)).length === 0)
check('other patient reads none', (await as(ID.pat2, `select id from readings where patient_id = $1`, [ID.pat])).length === 0)
check('doctor acknowledges an alert', (await as(ID.doc, `update alerts set status = 'acknowledged', acknowledged_by = $1, acknowledged_at = now() where status = 'open' returning id`, [ID.doc])).length === 2)

// Doctor's personal target changes the grade.
await as(ID.doc, `insert into thresholds (patient_id, vital_id, target_min, target_max) values ($1, 'hr', 50, 70)`, [ID.pat])
check('doctor target applies: 72 bpm is now a warning', (await log('hr', '72'))[0].level === 'warning')
check('patient cannot set their own targets', (await denied(ID.pat, `insert into thresholds (patient_id, vital_id, target_min, target_max) values ($1, 'gluc', 0, 999)`, [ID.pat])).blocked)
check('patient cannot stop tracking a vital the doctor set', (await as(ID.pat, `delete from tracked_vitals where patient_id = $1 and vital_id = 'hr' returning vital_id`, [ID.pat])).length === 0)

// Correction window and invalidation.
const rid = (await as(ID.pat, `select id from readings where vital_id = 'spo2' limit 1`))[0].id
check('patient corrects a typo within 15 minutes; its alert resolves', (await as(ID.pat, `update readings set value = '97' where id = $1 returning level`, [rid]))[0].level === 'normal'
  && (await db.query(`select status, resolution_reason from alerts where reading_id = $1`, [rid])).rows[0].resolution_reason === 'Corrected by patient')
await db.query(`alter table readings disable trigger reading_before`); await db.query(`update readings set taken_at = now() - interval '20 minutes' where id = $1`, [rid]); await db.query(`alter table readings enable trigger reading_before`)
check('correction is refused after 15 minutes', (await denied(ID.pat, `update readings set value = '99' where id = $1`, [rid])).blocked)
check('patient cannot mark a reading invalid', (await denied(ID.pat, `update readings set invalid = true where id = $1`, [rid])).blocked)
check('treating doctor can mark it invalid', (await as(ID.doc, `update readings set invalid = true, invalid_reason = 'Cuff slipped' where id = $1 returning id`, [rid])).length === 1)

/* ── SOS ── */
console.log('\nSOS')
const sos = (await as(ID.pat, `select raise_sos('Chest pain') id`))[0].id
check('SOS creates a danger alert', (await db.query(`select severity, type from alerts where id = $1`, [sos])).rows[0].severity === 'danger')
check('doctor cannot raise an SOS', (await denied(ID.doc, `select raise_sos('x')`)).blocked)
await db.query(`update alerts set created_at = now() - interval '11 minutes' where id = $1`, [sos])
check('unacknowledged SOS escalates after 10 minutes', (await db.query(`select escalate_stale_alerts() n`)).rows[0].n === 1
  && (await db.query(`select status from alerts where id = $1`, [sos])).rows[0].status === 'escalated')
check('app users cannot run the escalation job', (await denied(ID.pat, `select escalate_stale_alerts()`)).blocked)
await as(ID.pat, `select cancel_sos($1)`, [sos])
check('patient can mark themself safe', (await db.query(`select status from alerts where id = $1`, [sos])).rows[0].status === 'resolved')

/* ── Health record, meds, appointments, messages ── */
console.log('\nRecord, medication, appointments, messages')
await as(ID.pat, `insert into allergies (patient_id, substance, severity) values ($1, 'Penicillin', 'severe')`, [ID.pat])
await as(ID.pat, `insert into emergency_contacts (patient_id, name, phone, next_of_kin) values ($1, 'Mary', '+254700000001', true)`, [ID.pat])
check('only one next of kin is allowed', (await denied(ID.pat, `insert into emergency_contacts (patient_id, name, phone, next_of_kin) values ($1, 'John', '+254700000002', true)`, [ID.pat])).blocked)
check('doctor sees the allergy before prescribing', (await as(ID.doc, `select substance from allergies`)).length === 1)
check('patient cannot write to another patient\'s record', (await denied(ID.pat, `insert into allergies (patient_id, substance, severity) values ($1, 'x', 'mild')`, [ID.pat2])).blocked)
const rx = (await as(ID.doc, `insert into prescriptions (patient_id, doctor_id, medication, dosage, frequency) values ($1, $2, 'Lisinopril', '10mg', 'Once daily') returning id`, [ID.pat, ID.doc]))[0].id
check('patient cannot prescribe', (await denied(ID.pat, `insert into prescriptions (patient_id, doctor_id, medication, dosage, frequency) values ($1, $2, 'X', '1', 'x')`, [ID.pat, ID.doc])).blocked)
check('non-treating doctor cannot prescribe', (await denied(ID.doc2, `insert into prescriptions (patient_id, doctor_id, medication, dosage, frequency) values ($1, $2, 'X', '1', 'x')`, [ID.pat, ID.doc2])).blocked)
check('patient logs a dose', (await as(ID.pat, `insert into dose_logs (patient_id, prescription_id, slot, day) values ($1, $2, 480, current_date) returning slot`, [ID.pat, rx])).length === 1)
check('same dose cannot be logged twice', (await denied(ID.pat, `insert into dose_logs (patient_id, prescription_id, slot, day) values ($1, $2, 480, current_date)`, [ID.pat, rx])).blocked)
check('other patient cannot log against that prescription', (await denied(ID.pat2, `insert into dose_logs (patient_id, prescription_id, slot, day) values ($1, $2, 480, current_date)`, [ID.pat2, rx])).blocked)

const ap = (await as(ID.pat, `insert into appointments (patient_id, doctor_id, title, preferred_date) values ($1, $2, 'BP review', current_date + 7) returning id`, [ID.pat, ID.doc]))[0].id
check('patient cannot approve their own appointment', (await denied(ID.pat, `update appointments set status = 'approved' where id = $1`, [ap])).blocked)
check('patient cannot book as already approved', (await denied(ID.pat, `insert into appointments (patient_id, doctor_id, title, preferred_date, status) values ($1, $2, 'x', current_date, 'approved')`, [ID.pat, ID.doc])).blocked)
check('doctor proposes a new time', (await as(ID.doc, `update appointments set status = 'rescheduled', rescheduled_date = current_date + 8 where id = $1 returning id`, [ap])).length === 1)
check('patient accepts the new time', (await as(ID.pat, `update appointments set status = 'approved' where id = $1 returning id`, [ap])).length === 1)
check('other doctor cannot see the appointment', (await as(ID.doc2, `select id from appointments`)).length === 0)

check('patient messages their doctor', (await as(ID.pat, `insert into messages (from_id, to_id, content) values ($1, $2, 'Hello') returning id`, [ID.pat, ID.doc])).length === 1)
check('patient cannot message a doctor who is not theirs', (await denied(ID.pat, `insert into messages (from_id, to_id, content) values ($1, $2, 'Hi')`, [ID.pat, ID.doc2])).blocked)
check('patient cannot send as someone else', (await denied(ID.pat, `insert into messages (from_id, to_id, content) values ($1, $2, 'Hi')`, [ID.doc, ID.pat])).blocked)
check('admin cannot read private messages', (await as(ID.admin, `select id from messages`)).length === 0)
check('notifications are private to their owner', (await as(ID.pat2, `select id from notifications`)).length === 0)

/* ── Reassignment removes access ── */
console.log('\nReassignment')
await as(ID.admin, `update patients set assigned_doctor_id = $1 where id = $2`, [ID.doc2, ID.pat])
check('previous doctor loses the patient', (await as(ID.doc, `select id from patients`)).length === 0 && (await as(ID.doc, `select id from readings`)).length === 0)
check('new doctor gains the patient', (await as(ID.doc2, `select id from readings`)).length > 0)
await db.query(`update profiles set status = 'suspended' where id = $1`, [ID.doc2])
check('suspended doctor loses access', (await as(ID.doc2, `select id from readings`)).length === 0)


/* ── Internal functions are not callable from the app ── */
console.log('\nInternal functions')
check('app users cannot send notifications to others', (await denied(ID.pat, `select notify_user($1, 'account', 'x', 'y')`, [ID.pat2])).blocked)
check('app users cannot write document history', (await denied(ID.pat, `select log_doc_event(gen_random_uuid(), 'release')`)).blocked)

/* ── Documents ── */
console.log('\nDocuments')
await db.query(`update profiles set status = 'active' where id = $1`, [ID.doc2])   // doc2 now treats James
const DOC = ID.doc2
await db.query(`update doctors set signature = 'data:image/png;base64,AAAA' where id = $1`, [DOC])
const up = async (who, pt, extra = {}) => (await as(who, `insert into documents (patient_id, title, category, origin, file_sha256, upload_state, visibility)
  values ($1, $2, 'lab', 'patient_upload', $3, 'ready', $4) returning id`, [pt, extra.title ?? 'My lab result', extra.sha ?? 'sha-a', extra.vis ?? 'care_team']))[0].id
const shared = await up(ID.pat, ID.pat)
const priv = await up(ID.pat, ID.pat, { title: 'Insurance card', sha: 'sha-b', vis: 'private' })
check('same file sent twice is refused (no duplicates)', (await denied(ID.pat, `insert into documents (patient_id, title, category, origin, file_sha256, upload_state) values ($1, 'again', 'lab', 'patient_upload', 'sha-a', 'ready')`, [ID.pat])).blocked)
check('patient cannot upload into another record', (await denied(ID.pat, `insert into documents (patient_id, title, category, origin) values ($1, 'x', 'lab', 'patient_upload')`, [ID.pat2])).blocked)
check('patient cannot create an official document', (await denied(ID.pat, `insert into documents (patient_id, title, category, origin, status) values ($1, 'Fake report', 'vitals_report', 'system_generated', 'released')`, [ID.pat])).blocked)
check('treating doctor sees the shared upload, not the private one', JSON.stringify((await as(DOC, `select id from documents where origin = 'patient_upload'`)).map(r => r.id)) === JSON.stringify([shared]))
check('private upload cannot be fetched by id either', (await as(DOC, `select id from documents where id = $1`, [priv])).length === 0)
check('former doctor sees none', (await as(ID.doc, `select id from documents`)).length === 0)
check('admin sees no document content', (await as(ID.admin, `select id from documents`)).length === 0)
check("doctor cannot edit the patient's upload", (await denied(DOC, `update documents set title = 'changed' where id = $1`, [shared])).blocked)

const rep = (await as(DOC, `insert into documents (patient_id, title, category, origin, body, status, signed_by, released_by, released_at)
  values ($1, 'Vitals Report — last 30 days', 'vitals_report', 'system_generated', '{"type":"vitals","interpretation":"v1"}', 'released', $2, $2, now()) returning id, status, signed_by`, [ID.pat, DOC]))[0]
check('a new report always starts as an unsigned draft', rep.status === 'draft' && rep.signed_by === null)
check('patient cannot see a draft', (await as(ID.pat, `select id from documents where id = $1`, [rep.id])).length === 0)
check('status cannot be changed by a plain update', (await denied(DOC, `update documents set status = 'released' where id = $1`, [rep.id])).blocked)
check('patient cannot sign', (await denied(ID.pat, `select sign_document($1)`, [rep.id])).blocked)
check('admin cannot sign', (await denied(ID.admin, `select sign_document($1)`, [rep.id])).blocked)
check('non-treating doctor cannot sign', (await denied(ID.doc, `select sign_document($1)`, [rep.id])).blocked)
await as(DOC, `select sign_document($1)`, [rep.id])
const signed = (await db.query(`select status, signed_by, signature_image from documents where id = $1`, [rep.id])).rows[0]
check('treating doctor signs; signature is stamped on the document', signed.status === 'signed' && signed.signed_by === DOC && signed.signature_image?.startsWith('data:image/png'))
await as(DOC, `update documents set body = '{"type":"vitals","interpretation":"edited"}' where id = $1`, [rep.id])
check('editing after signing voids the signature', (await db.query(`select status, signed_by from documents where id = $1`, [rep.id])).rows[0].status === 'draft')
check('unreleased report is still hidden from the patient', (await as(ID.pat, `select id from documents where id = $1`, [rep.id])).length === 0)
await as(DOC, `select release_document($1)`, [rep.id])
check('released report reaches the patient', (await as(ID.pat, `select status from documents where id = $1`, [rep.id]))[0]?.status === 'released')
check('…and not the other patient', (await as(ID.pat2, `select id from documents`)).length === 0)
check('patient is notified of the release', (await as(ID.pat, `select 1 from notifications where title = 'New report from your doctor'`)).length === 1)
check('released report cannot be edited', (await denied(DOC, `update documents set title = 'x' where id = $1`, [rep.id])).blocked)
check('released report cannot be deleted', (await denied(DOC, `update documents set deleted_at = now() where id = $1`, [rep.id])).blocked && (await as(DOC, `delete from documents where id = $1 returning id`, [rep.id])).length === 0)
check('patient cannot alter an official document', (await denied(ID.pat, `update documents set title = 'x' where id = $1`, [rep.id])).blocked)
await as(ID.pat, `select record_document_access($1, 'view')`, [rep.id])
check('opening is recorded and marks it seen', (await db.query(`select seen_by_patient from documents where id = $1`, [rep.id])).rows[0].seen_by_patient
  && (await db.query(`select count(*)::int n from document_events where document_id = $1 and action = 'view'`, [rep.id])).rows[0].n === 1)
check("opening someone else's document is refused and looks like \"not found\"", /not found/i.test((await denied(ID.pat2, `select record_document_access($1)`, [rep.id])).why ?? ''))

// Corrections and versions
check('correction needs a reason', (await denied(DOC, `select correct_document($1, 'x')`, [rep.id])).blocked)
const v2 = (await as(DOC, `select correct_document($1, 'Glucose reading was in mmol/L') id`, [rep.id]))[0].id
check('correction is a version-2 draft', (await db.query(`select version, status, supersedes from documents where id = $1`, [v2])).rows[0].version === 2)
check('only one correction at a time', (await denied(DOC, `select correct_document($1, 'another reason')`, [rep.id])).blocked)
check('patient still sees version 1 until the correction is released', (await as(ID.pat, `select id from documents where series_id = $1`, [rep.id])).length === 1)
await as(DOC, `select release_document($1)`, [v2])
const v1 = (await db.query(`select superseded_by from documents where id = $1`, [rep.id])).rows[0]
check('releasing the correction supersedes version 1; both stay in the history', v1.superseded_by === v2 && (await as(ID.pat, `select id from documents where series_id = $1`, [rep.id])).length === 2)

// History
check('app users cannot rewrite history', (await as(DOC, `update document_events set action = 'x' returning id`).catch(() => [])).length === 0
  && (await db.query(`select count(*)::int n from document_events where action = 'x'`)).rows[0].n === 0)
check('history cannot be erased, even by the database owner', await db.query(`delete from document_events`).then(() => false, () => true))
check('patient reads the history of their documents', (await as(ID.pat, `select action from document_events where document_id = $1`, [rep.id])).some(e => e.action === 'release'))

// Staff: registry, grants
const reg = await as(ID.admin, `select * from document_registry()`)
check('admin registry lists documents without titles or content', reg.length === 5 && !('title' in reg[0]) && !('body' in reg[0]), `rows ${reg.length}`)
check('assistant without document permission cannot use the registry', (await denied(ID.asst, `select * from document_registry()`)).blocked)
check('patient cannot use the registry', (await denied(ID.pat, `select * from document_registry()`)).blocked)
check('support access needs a real reason', (await denied(ID.admin, `select request_support_access($1, 'look')`, [rep.id])).blocked)
check('assistant can never open a document', (await denied(ID.asst, `select request_support_access($1, 'Patient reported a broken file')`, [rep.id])).blocked)
await as(ID.admin, `select request_support_access($1, 'Patient reported the file will not open')`, [rep.id])
check('with a grant the admin opens that one document only', JSON.stringify((await as(ID.admin, `select id from documents`)).map(r => r.id)) === JSON.stringify([rep.id]))
check('patient is told about the support access', (await as(ID.pat, `select 1 from notifications where title = 'mCare support opened a document'`)).length === 1)
await db.query(`update support_grants set expires_at = now() - interval '1 second'`)
check('the grant expires', (await as(ID.admin, `select id from documents`)).length === 0)

// Sharing
check('doctor cannot create a share link', (await denied(DOC, `select create_share_link($1, 'Dr. X')`, [[rep.id]])).blocked)
check("patient cannot share someone else's document", (await denied(ID.pat2, `select create_share_link($1, 'Dr. X')`, [[rep.id]])).blocked)
const token = (await as(ID.pat, `select create_share_link($1, 'Dr. Otieno, Nairobi Hospital', 24, true) t`, [[v2, shared]]))[0].t
check('only a hash of the link is stored', (await db.query(`select count(*)::int n from share_links where token_hash = $1`, [token])).rows[0].n === 0)
check('outside clinician opens the link without an account', (await as(null, `select id from open_share_link($1)`, [token])).length === 2)
check('a one-time link works once', (await denied(null, `select id from open_share_link($1)`, [token])).blocked)
check('a guessed link is refused', (await denied(null, `select id from open_share_link('0000000000000000')`)).blocked)
const t2 = (await as(ID.pat, `select create_share_link($1, 'Clinic', 1) t`, [[shared]]))[0].t
await as(ID.pat, `update share_links set revoked_at = now() where revoked_at is null`)
check('a revoked link stops working', (await denied(null, `select id from open_share_link($1)`, [t2])).blocked)
check('signed-out visitors still cannot read documents directly', (await denied(null, `select id from documents`)).blocked)

// Soft delete and restore
await as(ID.pat, `update documents set deleted_at = now() where id = $1`, [shared])
check('a deleted upload disappears for the doctor', (await as(DOC, `select id from documents where id = $1`, [shared])).length === 0)
check('patient restores it within 30 days', (await as(ID.pat, `update documents set deleted_at = null where id = $1 returning id`, [shared])).length === 1)
await as(ID.pat, `update documents set deleted_at = now() where id = $1`, [priv])
await db.query(`alter table documents disable trigger guard_document`); await db.query(`update documents set deleted_at = now() - interval '31 days' where id = $1`, [priv]); await db.query(`alter table documents enable trigger guard_document`)
check('restore is refused after 30 days', (await denied(ID.pat, `update documents set deleted_at = null where id = $1`, [priv])).blocked)
check('expired deletions are purged; released reports never are', (await db.query(`select purge_deleted_documents() n`)).rows[0].n === 1
  && (await db.query(`select count(*)::int n from documents where status = 'released'`)).rows[0].n === 3)
check('patient switches an upload to private; the doctor loses it', (await as(ID.pat, `update documents set visibility = 'private' where id = $1 returning id`, [shared])).length === 1
  && (await as(DOC, `select id from documents where id = $1`, [shared])).length === 0)

/* ── Report requests, tickets, meal plans ── */
console.log('\nReport requests, support, meals')
check('patient asks their own doctor for a report', (await as(ID.pat, `insert into report_requests (patient_id, doctor_id, period_days) values ($1, $2, 30) returning id`, [ID.pat, DOC])).length === 1)
check('…but not a doctor who is not theirs', (await denied(ID.pat, `insert into report_requests (patient_id, doctor_id, period_days) values ($1, $2, 30)`, [ID.pat, ID.doc])).blocked)
check('the doctor is notified', (await as(DOC, `select 1 from notifications where title like 'Report request:%'`)).length === 1)
check('doctor declines with a reason; patient is told', (await as(DOC, `update report_requests set status = 'declined', decline_reason = 'Not enough readings yet' returning id`)).length === 1
  && (await as(ID.pat, `select 1 from notifications where title = 'Report request declined'`)).length === 1)
check('user opens a support ticket', (await as(ID.pat, `insert into support_tickets (user_id, subject) values ($1, 'Cannot upload') returning id`, [ID.pat])).length === 1)
check('other users cannot read it', (await as(ID.pat2, `select id from support_tickets`)).length === 0)
check('assistant without support permission cannot read it', (await as(ID.asst, `select id from support_tickets`)).length === 0)
check('admin resolves it', (await as(ID.admin, `update support_tickets set status = 'resolved', resolved_by = $1 returning id`, [ID.admin])).length === 1)
check('doctor sets a meal plan for their patient', (await as(DOC, `insert into meal_plans (patient_id, target_kcal, dietary_note, set_by) values ($1, 1800, 'Limit sodium', $2) returning patient_id`, [ID.pat, DOC])).length === 1)
check('patient reads the plan but cannot change it', (await as(ID.pat, `select target_kcal from meal_plans`))[0]?.target_kcal === 1800
  && (await as(ID.pat, `update meal_plans set target_kcal = 5000 returning patient_id`)).length === 0)
check('patient logs water', (await as(ID.pat, `insert into hydration_logs (patient_id, day, glasses) values ($1, current_date, 6) returning glasses`, [ID.pat]))[0].glasses === 6)

/* ── Patient module (0004): recorder, corrections, alert steps, care-team actions ── */
console.log('\nPatient module')
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
// A fresh pair: Grace (pat2) with Dr. Amara (doc), so earlier sections do not interfere.
await db.query(`update profiles set status = 'active' where id = any ($1)`, [[ID.doc, ID.doc2]])
await as(ID.admin, `update patients set assigned_doctor_id = $1 where id = $2`, [ID.doc, ID.pat2])
check('assignment is audited and both sides are told', (await one(`select count(*)::int n from audit_log where action = 'Assigned doctor' and detail like 'Grace Otieno%'`)).n === 1
  && (await as(ID.pat2, `select 1 from notifications where title = 'Care team updated'`)).length === 1
  && (await as(ID.doc, `select 1 from notifications where title = 'New patient assigned' and body like 'Grace%'`)).length === 1)
check('a suspended or unapproved doctor cannot be assigned', await (async () => {
  await db.query(`update profiles set status = 'suspended' where id = $1`, [ID.doc2])
  const r = await denied(ID.admin, `update patients set assigned_doctor_id = $1 where id = $2`, [ID.doc2, ID.pat2])
  await db.query(`update profiles set status = 'active' where id = $1`, [ID.doc2])
  return r.blocked
})())

const g = (v, val, who = ID.pat2) => as(who, `insert into readings (patient_id, vital_id, value) values ($1, $2, $3) returning id, level, recorded_by`, [ID.pat2, v, val])
const r1 = (await g('hr', '72'))[0]
check('a reading remembers who entered it', r1.recorded_by === ID.pat2)
const byDoc = (await g('hr', '74', ID.doc))[0]
check('treating doctor can record a reading for their patient', byDoc.recorded_by === ID.doc)
check('a doctor who does not treat the patient cannot', (await denied(ID.doc2, `insert into readings (patient_id, vital_id, value) values ($1, 'hr', '70')`, [ID.pat2])).blocked)
check('the recorder cannot be forged', (await as(ID.pat2, `insert into readings (patient_id, vital_id, value, recorded_by) values ($1, 'hr', '71', $2) returning recorded_by`, [ID.pat2, ID.doc]))[0].recorded_by === ID.pat2)
check('a vital that is switched off cannot be logged', (await denied(ID.pat2, `insert into readings (patient_id, vital_id, value) values ($1, 'rr', '16')`, [ID.pat2])).blocked)
check('patient cannot correct a reading the doctor entered', (await denied(ID.pat2, `update readings set value = '99' where id = $1`, [byDoc.id])).blocked)
await as(ID.pat2, `update readings set value = '73' where id = $1`, [r1.id])
check('a correction keeps the first value', (await one(`select corrected_from, corrected_at from readings where id = $1`, [r1.id])).corrected_from === '72'
  && (await one(`select count(*)::int n from audit_log where action = 'Corrected reading'`)).n >= 1)

// Critical alert: told to the patient, worked in steps, never closed by a number alone.
const crit = (await g('spo2', '85'))[0]
const al = await one(`select * from alerts where reading_id = $1`, [crit.id])
check('critical reading alerts and the patient is told', al?.severity === 'danger'
  && (await as(ID.pat2, `select 1 from notifications where title like 'Critical reading%'`)).length === 1)
check('asking again does not raise a second alert', (await as(ID.pat2, `select send_alert_now($1) id`, [crit.id]))[0].id === al.id
  && (await one(`select count(*)::int n from alerts where reading_id = $1`, [crit.id])).n === 1)
check('resolving needs a reason', (await denied(ID.doc, `update alerts set status = 'resolved' where id = $1`, [al.id])).blocked)
check("an alert's reading cannot be edited", (await denied(ID.doc, `update alerts set value = '99', severity = 'warning' where id = $1`, [al.id])).blocked)
await as(ID.doc, `update alerts set status = 'acknowledged', acknowledged_by = $2, acknowledged_at = now() - interval '1 day' where id = $1`, [al.id, ID.doc2])
const ack = await one(`select acknowledged_by, acknowledged_at > now() - interval '1 minute' fresh from alerts where id = $1`, [al.id])
check('who acknowledged, and when, come from the server', ack.acknowledged_by === ID.doc && ack.fresh)
check('patient is told the alert is being reviewed', (await as(ID.pat2, `select 1 from notifications where title = 'Your alert is being reviewed'`)).length === 1)
await as(ID.doc, `update alerts set recheck_requested_at = now() where id = $1`, [al.id])
check('re-check request reaches the patient', (await as(ID.pat2, `select 1 from notifications where title = 'Please log a new reading'`)).length === 1)
const recheck = (await g('spo2', '97'))[0]
const afterRecheck = await one(`select status, value, recheck_reading_id from alerts where id = $1`, [al.id])
check('an in-range re-check does not close a critical alert', afterRecheck.status === 'acknowledged' && afterRecheck.recheck_reading_id === recheck.id)
check('the alert keeps the value that raised it', afterRecheck.value === '85')
check('the doctor is told the re-check is in', (await as(ID.doc, `select 1 from notifications where title like 'Re-check in range:%'`)).length === 1)
await as(ID.doc, `update alerts set status = 'resolved', resolution_reason = 'Medication adjusted', resolution_note = ' Increased dose ' where id = $1`, [al.id])
const done = await one(`select status, resolved_by, resolution_note from alerts where id = $1`, [al.id])
check('clinician resolves with reason and note', done.status === 'resolved' && done.resolved_by === ID.doc && done.resolution_note === 'Increased dose')
check('a resolved alert cannot be changed or reopened', (await denied(ID.doc, `update alerts set status = 'open' where id = $1`, [al.id])).blocked
  && (await denied(ID.doc, `update alerts set resolution_note = 'x' where id = $1`, [al.id])).blocked)
check('resolution is audited', (await one(`select count(*)::int n from audit_log where action = 'Resolved alert' and detail like 'Grace%Medication adjusted%'`)).n === 1)

// A warning with a re-check requested does close on an in-range reading, with an honest reason.
await g('bp', '145/92'); const w2 = (await g('bp', '146/93'))[0]
const wa = await one(`select id from alerts where reading_id = $1`, [w2.id])
await db.query(`update alerts set created_at = now() - interval '40 minutes' where id = $1`, [wa.id])   // past the self-clear window
await as(ID.doc, `update alerts set recheck_requested_at = now() where id = $1`, [wa.id])
await g('bp', '121/79')
const wr = await one(`select status, resolution_reason, resolution_note from alerts where id = $1`, [wa.id])
check('requested re-check in range closes a warning, named as what it was', wr.status === 'resolved' && wr.resolution_reason === 'Re-check back in range' && /Dr\. Amara Osei/.test(wr.resolution_note))
check("send_alert_now refuses an in-range reading and other people's readings", (await denied(ID.pat2, `select send_alert_now($1)`, [r1.id])).blocked
  && (await denied(ID.pat, `select send_alert_now($1)`, [crit.id])).blocked)
check('a second SOS while one is open returns the same alert', await (async () => {
  const a = (await as(ID.pat2, `select raise_sos('Fell down') id`))[0].id, b = (await as(ID.pat2, `select raise_sos('Again') id`))[0].id
  await as(ID.pat2, `select cancel_sos($1)`, [a]); return a === b
})())

// Targets, notes, prescriptions.
await as(ID.doc, `insert into thresholds (patient_id, vital_id, target_min, target_max) values ($1, 'gluc', 80, 150)`, [ID.pat2])
await as(ID.doc, `update thresholds set target_max = 160 where patient_id = $1 and vital_id = 'gluc'`, [ID.pat2])
check('target changes are kept as history the patient can read', (await as(ID.pat2, `select from_max, to_max from threshold_changes where vital_id = 'gluc' order by id`)).map(r => Number(r.to_max)).join() === '150,160')
check('a target starts the vital being tracked', (await as(ID.pat2, `select 1 from tracked_vitals where vital_id = 'gluc'`)).length === 1)
await as(ID.doc, `insert into clinical_notes (patient_id, author_id, content) values ($1, $2, 'Reduce salt. Review in 2 weeks.')`, [ID.pat2, ID.doc])
check('a clinical note becomes the latest doctor note', (await as(ID.pat2, `select doctor_note from patients`))[0].doctor_note === 'Reduce salt. Review in 2 weeks.'
  && (await as(ID.pat2, `select 1 from clinical_notes`)).length === 1)
check('patient cannot write a clinical note, nor a doctor in another name', (await denied(ID.pat2, `insert into clinical_notes (patient_id, author_id, content) values ($1, $1, 'x')`, [ID.pat2])).blocked
  && (await denied(ID.doc, `insert into clinical_notes (patient_id, author_id, content) values ($1, $2, 'x')`, [ID.pat2, ID.doc2])).blocked)
check('notes cannot be rewritten', (await denied(ID.doc, `update clinical_notes set content = 'changed'`)).blocked || (await one(`select count(*)::int n from clinical_notes where content = 'changed'`)).n === 0)
const rx2 = (await as(ID.doc, `insert into prescriptions (patient_id, doctor_id, medication, dosage, frequency, purpose) values ($1, $2, 'Amlodipine 5mg', '5mg', 'Once daily', 'Blood pressure') returning id`, [ID.pat2, ID.doc]))[0].id
check('a prescription reaches the patient and is filed as a signed document', (await as(ID.pat2, `select 1 from notifications where title = 'New prescription'`)).length === 1
  && (await as(ID.pat2, `select status from documents where category = 'prescription'`))[0]?.status === 'released')
check('a prescription cannot be rewritten', (await denied(ID.doc, `update prescriptions set dosage = '50mg' where id = $1`, [rx2])).blocked)
await as(ID.doc, `update prescriptions set active = false where id = $1`, [rx2])
check('stopping it records who and when, and tells the patient', (await one(`select stopped_by, stopped_at is not null t from prescriptions where id = $1`, [rx2])).stopped_by === ID.doc
  && (await as(ID.pat2, `select 1 from notifications where title = 'Medication stopped'`)).length === 1)

// Appointments.
check('a date in the past is refused', (await denied(ID.pat2, `insert into appointments (patient_id, doctor_id, title, preferred_date) values ($1, $2, 'Review', current_date - 1)`, [ID.pat2, ID.doc])).blocked)
const ap2 = (await as(ID.pat2, `insert into appointments (patient_id, doctor_id, title, preferred_date, preferred_time) values ($1, $2, ' Review ', current_date + 3, '10:00') returning id, title, created_by`, [ID.pat2, ID.doc]))[0]
check('request is trimmed, attributed and the doctor is told', ap2.title === 'Review' && ap2.created_by === ID.pat2
  && (await as(ID.doc, `select 1 from notifications where title = 'New appointment request' and body like 'Grace%'`)).length === 1)
check('patient cannot move the date themself', (await as(ID.pat2, `update appointments set preferred_date = current_date + 30 where id = $1 returning preferred_date = current_date + 3 same`, [ap2.id]))[0].same)
check('rescheduling needs a date; rejecting needs a reason', (await denied(ID.doc, `update appointments set status = 'rescheduled' where id = $1`, [ap2.id])).blocked
  && (await denied(ID.doc, `update appointments set status = 'rejected' where id = $1`, [ap2.id])).blocked)
await as(ID.doc, `update appointments set status = 'rescheduled', rescheduled_date = current_date + 5, rescheduled_time = '14:30', rescheduled_reason = 'Clinic closed' where id = $1`, [ap2.id])
check('accepting the new time moves the appointment to it', (await as(ID.pat2, `update appointments set status = 'approved' where id = $1 returning preferred_date = current_date + 5 moved, preferred_time::text t`, [ap2.id]))[0].moved)
await as(ID.pat2, `update appointments set status = 'cancelled' where id = $1`, [ap2.id])
check('a closed appointment stays closed', (await denied(ID.doc, `update appointments set status = 'approved' where id = $1`, [ap2.id])).blocked)
check('treating doctor books a follow-up; the patient is told', (await as(ID.doc, `insert into appointments (patient_id, doctor_id, title, preferred_date, status) values ($1, $2, 'Follow-up', current_date + 10, 'approved') returning id`, [ID.pat2, ID.doc])).length === 1
  && (await as(ID.pat2, `select 1 from notifications where title = 'Appointment booked'`)).length === 1)
check("a doctor cannot book for someone else's patient", (await denied(ID.doc2, `insert into appointments (patient_id, doctor_id, title, preferred_date, status) values ($1, $2, 'x', current_date + 1, 'approved')`, [ID.pat2, ID.doc2])).blocked)

// Messages and notifications.
const mid = (await as(ID.pat2, `insert into messages (from_id, to_id, content) values ($1, $2, '  Feeling better  ') returning id, content`, [ID.pat2, ID.doc]))[0]
check('message is trimmed and the doctor is notified', mid.content === 'Feeling better' && (await as(ID.doc, `select 1 from notifications where title = 'New message from Grace Otieno'`)).length === 1)
check('the receiver can mark it read but not edit it', (await as(ID.doc, `update messages set read = true where id = $1 returning id`, [mid.id])).length === 1
  && (await denied(ID.doc, `update messages set content = 'forged' where id = $1`, [mid.id])).blocked)
check('a notification can be marked read, not rewritten', (await as(ID.pat2, `update notifications set read = true where id = (select id from notifications limit 1) returning id`)).length === 1
  && (await denied(ID.pat2, `update notifications set title = 'x'`)).blocked)

// The patient's own record.
await as(ID.pat2, `select save_health_profile($1)`, [{ sex: 'female', blood_type: 'A+', no_known_allergies: true, conditions: ['Asthma', 'Asthma', ' '],
  allergies: [{ substance: 'Penicillin', severity: 'severe', reaction: 'Rash' }, { substance: 'penicillin', severity: 'mild' }], other_medicines: ' Vitamin D ' }])
const hp = await one(`select sex, blood_type, no_known_allergies, other_medicines from patients where id = $1`, [ID.pat2])
check('health profile saves in one step, without duplicates', hp.sex === 'female' && hp.other_medicines === 'Vitamin D' && hp.no_known_allergies === false
  && (await as(ID.pat2, `select 1 from allergies`)).length === 1 && (await as(ID.pat2, `select 1 from conditions`)).length === 1)
check("a doctor cannot save a patient's health profile", (await denied(ID.doc, `select save_health_profile('{}')`)).blocked)
const tracked = (await as(ID.pat2, `select set_tracked_vitals('{bp,wt,rr}') v`)).map(r => r.v).sort().join()
check('tracked vitals: adds the active ones; with a doctor assigned the patient cannot drop any', tracked === 'bp,gluc,hr,wt', tracked)
const kin1 = (await as(ID.pat2, `select save_emergency_contact($1) id`, [{ name: 'Peter Otieno', phone: '+254 700 111 222', relationship: 'Spouse', next_of_kin: true }]))[0].id
await as(ID.pat2, `select save_emergency_contact($1) id`, [{ name: 'Ann Otieno', phone: '+254 700 333 444', next_of_kin: true }])
check('a new next of kin replaces the old one in the same step', (await as(ID.pat2, `select name from emergency_contacts where next_of_kin`)).map(r => r.name).join() === 'Ann Otieno'
  && (await one(`select next_of_kin from emergency_contacts where id = $1`, [kin1])).next_of_kin === false)
check('a contact needs a name and a real phone number', (await denied(ID.pat2, `select save_emergency_contact($1)`, [{ name: 'X', phone: '12' }])).blocked)
check('another patient cannot edit that contact', (await denied(ID.pat, `select save_emergency_contact($1)`, [{ id: kin1, name: 'Hijack', phone: '+254 700 000 000' }])).blocked)
check("unit preferences are the patient's own", (await as(ID.pat2, `update patients set unit_prefs = '{"temp":"°C"}' where id = $1 returning id`, [ID.pat2])).length === 1
  && (await as(ID.pat, `update patients set unit_prefs = '{"temp":"°C"}' where id = $1 returning id`, [ID.pat2])).length === 0)
check('a birth date in the future is refused', (await denied(ID.pat2, `update profiles set dob = current_date + 1 where id = $1`, [ID.pat2])).blocked)
await as(ID.pat2, `select accept_terms('1')`)
check('consent is recorded and cannot be erased', (await as(ID.pat2, `select kind from consents order by kind`)).map(r => r.kind).join() === 'privacy,terms'
  && (await as(ID.pat, `select 1 from consents`)).length === 0 && await db.query(`delete from consents`).then(() => false, () => true))
check('patient rates their own doctor only', (await as(ID.pat2, `insert into doctor_ratings (patient_id, doctor_id, rating) values ($1, $2, 5) returning rating`, [ID.pat2, ID.doc])).length === 1
  && (await denied(ID.pat2, `insert into doctor_ratings (patient_id, doctor_id, rating) values ($1, $2, 1)`, [ID.pat2, ID.doc2])).blocked
  && (await denied(ID.pat2, `update doctor_ratings set rating = 9 where patient_id = $1`, [ID.pat2])).blocked)
check('the directory shows the average, the doctor cannot read who rated', Number((await as(ID.pat, `select average from doctor_rating_summary($1)`, [ID.doc]))[0].average) === 5
  && (await as(ID.doc, `select 1 from doctor_ratings`)).length === 0)

// Requests and account.
await as(ID.pat2, `select request_doctor($1)`, [ID.doc2])
const rq = (await as(ID.pat2, `select id from doctor_requests where status = 'pending'`))[0].id
check('only an approver can answer a doctor request', (await denied(ID.pat2, `select decide_doctor_request($1, true)`, [rq])).blocked && (await denied(ID.doc, `select decide_doctor_request($1, true)`, [rq])).blocked)
await as(ID.asst, `select decide_doctor_request($1, true)`, [rq])
check('approving a request assigns the doctor in the same step', (await one(`select assigned_doctor_id from patients where id = $1`, [ID.pat2])).assigned_doctor_id === ID.doc2
  && (await as(ID.pat2, `select 1 from notifications where title = 'Doctor request approved'`)).length === 1)
check('the previous doctor loses the record at once', (await as(ID.doc, `select 1 from readings where patient_id = $1`, [ID.pat2])).length === 0)
check('a request cannot be answered twice', (await denied(ID.admin, `select decide_doctor_request($1, false)`, [rq])).blocked)
check('support request reaches the people who handle support', await (async () => {
  const before = (await one(`select count(*)::int n from notifications where title like 'Support request:%'`)).n
  await as(ID.pat2, `insert into support_tickets (user_id, subject, message) values ($1, 'Phone number', 'Please update it')`, [ID.pat2])
  return (await one(`select count(*)::int n from notifications where title like 'Support request:%'`)).n === before + 1   // the admin; the assistant lacks handle_support
})())
await as(ID.pat2, `select deactivate_my_account()`)
check('a patient can suspend their own account, and it locks them out', (await one(`select status from profiles where id = $1`, [ID.pat2])).status === 'suspended'
  && (await denied(ID.pat2, `select raise_sos('x')`)).blocked)
check('signed-out visitors cannot call the new functions', (await denied(null, `select accept_terms('1')`)).blocked && (await denied(null, `select doctor_rating_summary($1)`, [ID.doc])).blocked
  && (await denied(null, `select save_health_profile('{}')`)).blocked)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

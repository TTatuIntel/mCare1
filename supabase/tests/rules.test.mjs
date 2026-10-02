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
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
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
check('a patient can close their own account, and it locks them out', (await one(`select status, status_reason from profiles where id = $1`, [ID.pat2])).status === 'deactivated'
  && (await denied(ID.pat2, `select raise_sos('x')`)).blocked && (await as(ID.pat2, `select 1 from readings`)).length === 0)
check('signed-out visitors cannot call the new functions', (await denied(null, `select accept_terms('1')`)).blocked && (await denied(null, `select doctor_rating_summary($1)`, [ID.doc])).blocked
  && (await denied(null, `select save_health_profile('{}')`)).blocked)

/* ── Care integration (0005): invitations, nutrition, clinician readings, follow-up, vital definitions, document support ── */
console.log('\nCare integration')
const NEW = { nurse: '88888888-8888-4888-8888-888888888881', boss: '88888888-8888-4888-8888-888888888882', drnew: '88888888-8888-4888-8888-888888888883',
  gone: '88888888-8888-4888-8888-888888888884', late: '88888888-8888-4888-8888-888888888885' }
const roleOf = async id => (await one(`select role, status from profiles where id = $1`, [id]))
const signUp = (id, email, meta = {}, confirmed = false) => db.query(`insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3, $4)`,
  [id, email, JSON.stringify(meta), confirmed ? new Date().toISOString() : null])

// Invitations: an admin says in advance what a person will be.
check('only people who register users can invite', (await denied(ID.pat, `select invite_account('x@mcare.app', 'X', 'patient')`)).blocked
  && (await denied(ID.asst, `select invite_account('x@mcare.app', 'X', 'patient')`)).blocked && (await denied(null, `select invite_account('x@mcare.app', 'X', 'patient')`)).blocked)
const inv = (await as(ID.admin, `select invite_account(' Nurse@mCare.app ', 'Nurse Wanjiru', 'assistant', '+254 700 000 900') id`))[0].id
check('admin invites an assistant; the invitation is audited', !!inv && (await one(`select count(*)::int n from audit_log where action = 'Invited user' and detail like 'Nurse Wanjiru (assistant)%'`)).n === 1)
check('an email is invited once, and never when already registered', (await denied(ID.admin, `select invite_account('nurse@mcare.app', 'Again', 'patient')`)).blocked
  && (await denied(ID.admin, `select invite_account('james@example.com', 'James', 'patient')`)).blocked)
check('a bad email or an empty name is refused', (await denied(ID.admin, `select invite_account('not-an-email', 'X', 'patient')`)).blocked
  && (await denied(ID.admin, `select invite_account('ok@mcare.app', '  ', 'patient')`)).blocked)
check('invitations are read only by people who register users', (await as(ID.admin, `select 1 from account_invitations`)).length === 1
  && (await as(ID.pat, `select 1 from account_invitations`)).length === 0 && (await as(ID.doc, `select 1 from account_invitations`)).length === 0)
check('invitations cannot be written directly', (await denied(ID.admin, `insert into account_invitations (email, full_name, role) values ('direct@mcare.app', 'D', 'admin')`)).blocked)
await db.query(`update staff set permissions = permissions || '{create_users}' where id = $1`, [ID.asst])
check('an assistant who registers users can invite a doctor, never staff', (await as(ID.asst, `select invite_account('dr.new@knh.go.ke', 'Dr. New', 'doctor') id`)).length === 1
  && (await denied(ID.asst, `select invite_account('boss2@mcare.app', 'Boss', 'admin')`)).blocked)

await signUp(NEW.nurse, 'nurse@mcare.app', { role: 'admin' })
check('an invited staff account is an ordinary patient until its email is confirmed', (await roleOf(NEW.nurse)).role === 'patient'
  && (await one(`select accepted_at from account_invitations where id = $1`, [inv])).accepted_at === null)
await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [NEW.nurse])
check('confirming the email gives the invited role, with no permissions yet', (await roleOf(NEW.nurse)).role === 'assistant'
  && (await one(`select is_assistant, permissions from staff where id = $1`, [NEW.nurse])).permissions.length === 0
  && (await one(`select count(*)::int n from patients where id = $1`, [NEW.nurse])).n === 0
  && (await one(`select accepted_by from account_invitations where id = $1`, [inv])).accepted_by === NEW.nurse)
check('the inviter is told, and the name on the invitation is used', (await as(ID.admin, `select 1 from notifications where title = 'Invitation accepted' and body like 'Nurse Wanjiru%'`)).length === 1
  && (await one(`select full_name, phone from profiles where id = $1`, [NEW.nurse])).full_name === 'Nurse Wanjiru')
await as(ID.admin, `select invite_account('boss@mcare.app', 'Second Admin', 'admin')`)
await signUp(NEW.boss, 'boss@mcare.app', {}, true)
check('an already confirmed invited admin is an admin at once', (await roleOf(NEW.boss)).role === 'admin' && (await as(NEW.boss, `select is_admin() a`))[0].a === true)
await signUp(NEW.drnew, 'dr.new@knh.go.ke', {})
check('an invited doctor still waits for approval', (await roleOf(NEW.drnew)).role === 'doctor' && (await roleOf(NEW.drnew)).status === 'pending_approval'
  && (await one(`select count(*)::int n from account_invitations where email = 'dr.new@knh.go.ke' and accepted_by = $1`, [NEW.drnew])).n === 1)
const invGone = (await as(ID.admin, `select invite_account('gone@mcare.app', 'Withdrawn', 'admin') id`))[0].id
check('only an admin withdraws a staff invitation', (await denied(ID.asst, `select revoke_invitation($1)`, [invGone])).blocked)
await as(ID.admin, `select revoke_invitation($1)`, [invGone])
await signUp(NEW.gone, 'gone@mcare.app', {}, true)
check('a withdrawn invitation gives nothing, and cannot be withdrawn twice', (await roleOf(NEW.gone)).role === 'patient' && (await denied(ID.admin, `select revoke_invitation($1)`, [invGone])).blocked)
const invLate = (await as(ID.admin, `select invite_account('late@mcare.app', 'Too Late', 'admin') id`))[0].id
await db.query(`update account_invitations set expires_at = now() - interval '1 minute' where id = $1`, [invLate])
await signUp(NEW.late, 'late@mcare.app', {}, true)
check('an invitation that ran out gives nothing', (await roleOf(NEW.late)).role === 'patient')

// Nutrition: James (pat) is treated by doc2 (DOC).
const meals = [{ id: 'breakfast', name: 'Breakfast', at: 450, foods: 'Porridge, fruit', kcal: 350, icon: '🌅' }, { id: 'supper', name: 'Supper', at: 1140, foods: 'Ugali, greens, fish', kcal: 600, icon: '🌙' }]
const plan = (await as(DOC, `insert into meal_plans (patient_id, meals, target_kcal, water_goal, dietary_note, set_by) values ($1, $2, 1900, 10, '  Low salt  ', $3)
  on conflict (patient_id) do update set meals = excluded.meals, target_kcal = excluded.target_kcal, water_goal = excluded.water_goal, dietary_note = excluded.dietary_note, set_by = excluded.set_by
  returning set_by, dietary_note`, [ID.pat, JSON.stringify(meals), ID.doc]))[0]
check('the meal plan records the doctor who saved it, whatever was sent', plan.set_by === DOC && plan.dietary_note === 'Low salt')
check('the patient reads the same plan and is told it changed', (await as(ID.pat, `select jsonb_array_length(meals) n, water_goal from meal_plans`))[0].n === 2
  && (await as(ID.pat, `select 1 from notifications where title = 'Your meal plan was updated'`)).length >= 1
  && (await one(`select count(*)::int n from audit_log where action = 'Set meal plan' and detail like 'James Mwangi%'`)).n >= 1)
check('a plan with repeated meals or impossible energy is refused', (await denied(DOC, `update meal_plans set meals = $2 where patient_id = $1`, [ID.pat, JSON.stringify([meals[0], meals[0]])])).blocked
  && (await denied(DOC, `update meal_plans set meals = $2 where patient_id = $1`, [ID.pat, JSON.stringify([{ ...meals[0], kcal: 9000 }])])).blocked
  && (await denied(DOC, `update meal_plans set meals = '{"a":1}' where patient_id = $1`, [ID.pat])).blocked)
check('a doctor who does not treat the patient cannot change the plan', (await as(ID.doc, `update meal_plans set target_kcal = 900 where patient_id = $1 returning patient_id`, [ID.pat])).length === 0
  && (await denied(ID.doc, `insert into meal_plans (patient_id, set_by) values ($1, $2)`, [ID.pat, ID.doc])).blocked)
check('the treating doctor sees what the patient ate and drank', (await as(ID.pat, `insert into meal_logs (patient_id, meal_id, day) values ($1, 'breakfast', current_date) returning meal_id`, [ID.pat])).length === 1
  && (await as(DOC, `select 1 from meal_logs where patient_id = $1`, [ID.pat])).length === 1 && (await as(DOC, `select glasses from hydration_logs where patient_id = $1`, [ID.pat]))[0].glasses === 6
  && (await as(ID.doc, `select 1 from meal_logs`)).length === 0)
await as(DOC, `delete from meal_plans where patient_id = $1`, [ID.pat])
check('removing the plan tells the patient', (await as(ID.pat, `select 1 from notifications where title = 'Your meal plan was removed'`)).length === 1)

// A reading the doctor records.
const beforeN = (await as(ID.pat, `select 1 from notifications where title = 'A reading was added to your record'`)).length
await as(DOC, `insert into readings (patient_id, vital_id, value) values ($1, 'wt', '82')`, [ID.pat])
check('a reading recorded by the doctor is announced to the patient and audited', (await as(ID.pat, `select 1 from notifications where title = 'A reading was added to your record'`)).length === beforeN + 1
  && (await one(`select count(*)::int n from audit_log where action = 'Recorded reading for patient' and actor_id = $1`, [DOC])).n === 1)
await as(ID.pat, `insert into readings (patient_id, vital_id, value) values ($1, 'wt', '81')`, [ID.pat])
check("the patient's own readings are not announced to themself", (await as(ID.pat, `select 1 from notifications where title = 'A reading was added to your record'`)).length === beforeN + 1)

// Follow-up from an alert: one transaction.
const critJ = (await as(ID.pat, `insert into readings (patient_id, vital_id, value) values ($1, 'spo2', '84') returning id`, [ID.pat]))[0].id
const alJ = (await one(`select id from alerts where reading_id = $1`, [critJ])).id
const apptsN = async () => (await one(`select count(*)::int n from appointments where patient_id = $1`, [ID.pat])).n
const apBefore = await apptsN()
check('only the treating doctor books a follow-up, and not in the past', (await denied(ID.doc, `select schedule_follow_up($1, current_date + 3)`, [ID.pat])).blocked
  && (await denied(ID.pat, `select schedule_follow_up($1, current_date + 3)`, [ID.pat])).blocked
  && (await denied(DOC, `select schedule_follow_up($1, current_date - 1)`, [ID.pat])).blocked && await apptsN() === apBefore)
check('"Appointment scheduled" cannot close an alert without the appointment',
  (await denied(DOC, `update alerts set status = 'resolved', resolution_reason = ' appointment scheduled ' where id = $1`, [alJ])).blocked
  && (await one(`select status from alerts where id = $1`, [alJ])).status !== 'resolved' && await apptsN() === apBefore)
const fu = (await as(DOC, `select schedule_follow_up($1, current_date + 3, '10:00', ' Review oxygen ', $2) id`, [ID.pat, alJ]))[0].id
const fuAlert = await one(`select status, resolution_reason, resolution_note, resolved_by from alerts where id = $1`, [alJ])
check('the follow-up is booked and the alert resolved together', (await one(`select status, approval_note from appointments where id = $1`, [fu])).status === 'approved'
  && fuAlert.status === 'resolved' && fuAlert.resolution_reason === 'Appointment scheduled' && fuAlert.resolution_note === 'Review oxygen' && fuAlert.resolved_by === DOC)
check('if the alert cannot be resolved, no appointment is left behind', (await denied(DOC, `select schedule_follow_up($1, current_date + 4, null, null, $2)`, [ID.pat, alJ])).blocked && await apptsN() === apBefore + 1)
check('the follow-up remembers its alert, and no other visit can claim one', (await one(`select alert_id from appointments where id = $1`, [fu])).alert_id === alJ
  && (await as(DOC, `insert into appointments (patient_id, doctor_id, title, preferred_date, status, alert_id) values ($1, $2, 'Claimed', current_date + 5, 'approved', $3) returning alert_id`, [ID.pat, DOC, alJ]))[0].alert_id === null
  && (await as(DOC, `update appointments set alert_id = null where id = $1 returning alert_id`, [fu]))[0].alert_id === alJ)
check('a visit is not booked for, or moved to, a day already gone',
  (await denied(DOC, `insert into appointments (patient_id, doctor_id, title, preferred_date, status) values ($1, $2, 'Past', current_date - 1, 'approved')`, [ID.pat, DOC])).blocked
  && (await denied(DOC, `update appointments set status = 'rescheduled', rescheduled_date = current_date - 1 where id = $1`, [fu])).blocked)

// The appointment record (0008): reference, history, clashes, no-show, staff lookup.
const rec = await one(`select number from appointments where id = $1`, [fu])
check('every appointment has a reference the browser cannot change', /^APT-\d{4}-\d{5}$/.test(rec.number)
  && (await as(DOC, `update appointments set number = 'APT-0' where id = $1 returning number`, [fu]))[0].number === rec.number)
const hist = async id => (await db.query(`select action, detail, actor_id from appointment_events where appointment_id = $1 order by created_at, action`, [id])).rows
check('booking is the first line of its history', (await hist(fu)).some(e => e.action === 'booked' && e.actor_id === DOC))
check('a second confirmed visit at the same time is refused, for the doctor and for the patient',
  (await denied(DOC, `insert into appointments (patient_id, doctor_id, title, preferred_date, preferred_time, status) values ($1, $2, 'Clash', current_date + 3, '10:15', 'approved')`, [ID.pat, DOC])).blocked
  && (await as(DOC, `insert into appointments (patient_id, doctor_id, title, preferred_date, preferred_time, status) values ($1, $2, 'Later', current_date + 3, '11:00', 'approved') returning id`, [ID.pat, DOC])).length === 1)
await as(DOC, `update appointments set status = 'rescheduled', rescheduled_date = current_date + 6, rescheduled_time = '09:00', rescheduled_reason = 'In theatre' where id = $1`, [fu])
check('a move keeps the time it was moved from', (await hist(fu)).some(e => e.action === 'rescheduled' && /10:00 AM → .* 9:00 AM · In theatre/.test(e.detail)))
check('the patient reads the history of their own appointment, and cannot write it', (await as(ID.pat, `select 1 from appointment_events where appointment_id = $1`, [fu])).length === 2
  && (await denied(ID.pat, `insert into appointment_events (appointment_id, action) values ($1, 'approved')`, [fu])).blocked
  && (await as(ID.pat2, `select 1 from appointment_events where appointment_id = $1`, [fu])).length === 0)
const today = (await as(DOC, `insert into appointments (patient_id, doctor_id, title, preferred_date, status) values ($1, $2, 'Today', current_date, 'approved') returning id`, [ID.pat, DOC]))[0].id
check('only the doctor records a missed visit, and not for one still ahead',
  (await denied(ID.pat, `update appointments set status = 'no_show' where id = $1`, [today])).blocked
  && (await denied(DOC, `update appointments set status = 'no_show' where id = (select id from appointments where title = 'Later')`)).blocked
  && (await as(DOC, `update appointments set status = 'no_show', rejection_reason = 'Did not attend' where id = $1 returning id`, [today])).length === 1
  && (await denied(DOC, `update appointments set status = 'approved' where id = $1`, [today])).blocked)
check('support staff can find an appointment but not change it', (await as(ID.admin, `select 1 from appointments where id = $1`, [fu])).length === 1
  && (await as(ID.admin, `update appointments set status = 'cancelled' where id = $1 returning id`, [fu])).length === 0)

// Vital definitions.
await as(ID.admin, `update vital_defs set active = true where id = 'rr'`)
await as(ID.admin, `update vital_defs set normal_max = 22 where id = 'rr'`)
check('changes to a vital definition are audited', (await one(`select count(*)::int n from audit_log where action = 'Activated vital type' and detail = 'Respiratory Rate'`)).n === 1
  && (await one(`select count(*)::int n from audit_log where action = 'Updated vital definition' and detail like 'Respiratory Rate%'`)).n === 1)
check('an impossible range is refused, and only an admin edits definitions', (await denied(ID.admin, `update vital_defs set normal_min = 50, normal_max = 10 where id = 'rr'`)).blocked
  && (await as(ID.doc, `update vital_defs set normal_max = 999 where id = 'rr' returning id`)).length === 0
  && (await as(ID.asst, `update vital_defs set normal_max = 999 where id = 'rr' returning id`)).length === 0)

// Document support.
await as(ID.pat, `update documents set deleted_at = now() where id = $1`, [shared])
check('only document support can restore for a patient', (await denied(ID.asst, `select staff_restore_document($1)`, [shared])).blocked
  && (await denied(ID.doc, `select staff_restore_document($1)`, [shared])).blocked)
await as(ID.admin, `select staff_restore_document($1)`, [shared])
check('support restores a deleted upload; the patient is told and it is in the history', (await one(`select deleted_at from documents where id = $1`, [shared])).deleted_at === null
  && (await as(ID.pat, `select 1 from notifications where title = 'A document was restored'`)).length === 1
  && (await one(`select count(*)::int n from document_events where document_id = $1 and action = 'restore'`, [shared])).n >= 1
  && (await one(`select count(*)::int n from audit_log where action = 'Restored document'`)).n === 1)
check('what is not deleted cannot be "restored"', (await denied(ID.admin, `select staff_restore_document($1)`, [shared])).blocked)
check('only a full admin purges', (await denied(ID.asst, `select purge_expired_documents()`)).blocked && (await denied(ID.pat, `select purge_expired_documents()`)).blocked
  && (await as(ID.admin, `select purge_expired_documents() n`))[0].n === 0)
check('signed-out visitors cannot call any of it', (await denied(null, `select schedule_follow_up($1, current_date + 1)`, [ID.pat])).blocked
  && (await denied(null, `select revoke_invitation($1)`, [inv])).blocked && (await denied(null, `select staff_restore_document($1)`, [shared])).blocked)

/* ── Integrity (0010): audit, account guards, prescriptions, report requests, targets, invalid readings, repeats ── */
console.log('\nIntegrity')
// James (pat) is treated by doc2 (DOC); Dr. Amara (doc) treats nobody; there are two admins (admin, boss).
check('the browser cannot write the audit trail', (await denied(ID.pat, `insert into audit_log (actor_id, action, detail) values ($1, 'Forged', 'x')`, [ID.pat])).blocked
  && (await denied(ID.admin, `insert into audit_log (actor_id, action, detail) values ($1, 'Forged', 'x')`, [ID.admin])).blocked
  && (await one(`select count(*)::int n from audit_log where action = 'Forged'`)).n === 0)
check('an entry carries the role its author held', (await one(`select actor_role from audit_log where action = 'Set meal plan' order by id desc limit 1`)).actor_role === 'doctor')

await as(ID.admin, `update staff set permissions = '{approve_patient_requests,create_users,monitor_patients}' where id = $1`, [ID.asst])
const permAudit = await one(`select before_state, after_state, resource_id from audit_log where action = 'Changed assistant permissions' order by id desc limit 1`)
check('a permission change is audited with before and after, and the assistant is told', permAudit?.resource_id === ID.asst
  && permAudit.after_state.includes('monitor_patients') && !permAudit.before_state.includes('monitor_patients')
  && (await as(ID.asst, `select 1 from notifications where title = 'Your permissions changed'`)).length === 1)
check('an unknown permission is refused, and an assistant cannot grant themself any', (await denied(ID.admin, `update staff set permissions = '{root}' where id = $1`, [ID.asst])).blocked
  && (await as(ID.asst, `update staff set permissions = '{view_logs}' where id = $1 returning id`, [ID.asst])).length === 0)
await as(ID.asst, `select log_patient_view($1)`, [ID.pat]); await as(ID.asst, `select log_patient_view($1)`, [ID.pat])
check("opening a patient's vitals is recorded once, against that patient", (await one(`select count(*)::int n from audit_log where action = 'Viewed patient vitals' and patient_id = $1 and actor_id = $2`, [ID.pat, ID.asst])).n === 1
  && (await denied(ID.doc, `select log_patient_view($1)`, [ID.pat])).blocked && (await denied(ID.pat, `select log_patient_view($1)`, [ID.pat])).blocked)

check('the treating doctor stops a medicine the previous doctor prescribed', (await as(DOC, `update prescriptions set active = false where id = $1 returning stopped_by`, [rx]))[0]?.stopped_by === DOC)
check('a prescription is never deleted', (await as(DOC, `delete from prescriptions where id = $1 returning id`, [rx])).length === 0
  && (await one(`select count(*)::int n from prescriptions where id = $1`, [rx])).n === 1)
check('the former doctor can no longer change it', (await as(ID.doc, `update prescriptions set active = true where id = $1 returning id`, [rx])).length === 0)

const setStatus = (who, person, status, reason = null) => as(who, `select set_account_status($1, $2, $3)`, [person, status, reason])
check('an admin cannot suspend themself, or change a role', (await denied(ID.admin, `select set_account_status($1, 'suspended', 'Testing the rule')`, [ID.admin])).blocked
  && (await denied(ID.admin, `update profiles set role = 'admin' where id = $1`, [ID.pat])).blocked)
check('a doctor who still has patients cannot be suspended', /still has patients/.test((await denied(ID.admin, `select set_account_status($1, 'suspended', 'Licence under review')`, [DOC])).why ?? ''))
check('stopping an account needs a reason, by any route', /Give a reason/.test((await denied(ID.admin, `select set_account_status($1, 'suspended')`, [ID.doc])).why ?? '')
  && (await denied(ID.admin, `update profiles set status = 'suspended' where id = $1`, [ID.doc])).blocked)
await setStatus(ID.admin, ID.doc, 'suspended', 'Licence under review')
const stopped = await one(`select status, status_reason, status_changed_by, status_changed_at > now() - interval '1 minute' fresh from profiles where id = $1`, [ID.doc])
check('a doctor with no patients can; who, when and why are kept and it is audited', stopped.status === 'suspended' && stopped.status_reason === 'Licence under review'
  && stopped.status_changed_by === ID.admin && stopped.fresh
  && (await one(`select count(*)::int n from audit_log where action = 'Suspended user' and detail = 'Dr. Amara Osei · Licence under review' and resource_id = $1`, [ID.doc])).n === 1)
check('only an administrator changes a status, and the reason cannot be forged', (await denied(ID.asst, `select set_account_status($1, 'active')`, [ID.doc])).blocked
  && (await denied(ID.pat, `select set_account_status($1, 'active')`, [ID.doc])).blocked
  && (await as(ID.doc, `update profiles set status_reason = 'x', phone = '1' where id = $1 returning status_reason`, [ID.doc]).catch(() => [{}]))[0]?.status_reason !== 'x')
await setStatus(ID.admin, ID.doc, 'active')
check('reactivating is audited and the person is told', (await one(`select count(*)::int n from audit_log where action = 'Reactivated user' and resource_id = $1`, [ID.doc])).n === 1
  && (await as(ID.doc, `select 1 from notifications where title = 'Your account is active again'`)).length === 1)
await setStatus(ID.admin, NEW.boss, 'deactivated', 'Left the organisation')
check('the last active admin cannot leave mCare without one', /at least one active administrator/.test((await denied(ID.admin, `select deactivate_my_account()`)).why ?? '')
  && (await as(NEW.boss, `select is_admin() a`))[0].a === false)
await setStatus(ID.admin, NEW.boss, 'active')

await setStatus(ID.admin, ID.pat, 'suspended', 'Requested by the patient while travelling')
check('a suspended patient cannot share or open documents', (await denied(ID.pat, `select create_share_link($1, 'Clinic')`, [[v2]])).blocked
  && (await denied(ID.pat, `select record_document_access($1)`, [v2])).blocked
  && (await as(ID.pat, `select 1 from appointment_events`)).length === 0)
await setStatus(ID.admin, ID.pat, 'active')

check('an answered report request cannot be answered again', (await denied(DOC, `update report_requests set status = 'fulfilled', document_id = $1 where patient_id = $2`, [v2, ID.pat])).blocked)
const rr2 = (await as(ID.pat, `insert into report_requests (patient_id, doctor_id, period_days) values ($1, $2, 14) returning id`, [ID.pat, DOC]))[0].id
check('fulfilling a request needs the report; the request itself cannot be rewritten', (await denied(DOC, `update report_requests set status = 'fulfilled' where id = $1`, [rr2])).blocked
  && (await denied(DOC, `update report_requests set period_days = 300 where id = $1`, [rr2])).blocked
  && (await as(DOC, `update report_requests set status = 'fulfilled', document_id = $2 where id = $1 returning handled_at`, [rr2, v2]))[0]?.handled_at != null)

const targetNotes = async () => (await as(ID.pat, `select 1 from notifications where title = 'Your target was updated'`)).length
const notesBefore = await targetNotes()
await as(DOC, `update thresholds set critical_min = 40, critical_max = 120 where patient_id = $1 and vital_id = 'hr'`, [ID.pat])
const crit2 = await one(`select from_min, to_min, to_critical_max from threshold_changes where patient_id = $1 and vital_id = 'hr' order by id desc limit 1`, [ID.pat])
check('a change to the critical range is kept in the history and audited, without announcing a new target', Number(crit2.to_critical_max) === 120 && Number(crit2.from_min) === Number(crit2.to_min)
  && (await one(`select count(*)::int n from audit_log where action = 'Set critical range' and patient_id = $1`, [ID.pat])).n === 1 && await targetNotes() === notesBefore)

const badReading = (await as(ID.pat, `insert into readings (patient_id, vital_id, value) values ($1, 'spo2', '83') returning id`, [ID.pat]))[0].id
await as(DOC, `update readings set invalid = true, invalid_reason = 'Sensor fell off' where id = $1`, [badReading])
const inv2 = await one(`select r.invalidated_by, r.invalidated_at is not null stamped, a.status, a.resolution_reason, a.resolved_by from readings r join alerts a on a.reading_id = r.id where r.id = $1`, [badReading])
check('marking a reading invalid records who did it and closes its alert', inv2.invalidated_by === DOC && inv2.stamped && inv2.status === 'resolved'
  && inv2.resolution_reason === 'Reading marked invalid' && inv2.resolved_by === DOC
  && (await as(ID.pat, `select 1 from notifications where title = 'Alert closed'`)).length === 1)
check('who marked it cannot be forged', (await as(ID.pat, `insert into readings (patient_id, vital_id, value, invalidated_by, invalidated_at) values ($1, 'wt', '80', $2, now()) returning invalidated_by`, [ID.pat, DOC]))[0].invalidated_by === null)

const ref = '99999999-9999-4999-8999-999999999999'
await as(ID.pat, `insert into readings (patient_id, vital_id, value, client_ref) values ($1, 'wt', '79', $2)`, [ID.pat, ref])
check('the same form sent twice saves once', (await denied(ID.pat, `insert into readings (patient_id, vital_id, value, client_ref) values ($1, 'wt', '79', $2)`, [ID.pat, ref])).blocked
  && (await one(`select count(*)::int n from readings where client_ref = $1`, [ref])).n === 1)

const about = (await as(DOC, `select resource_type, resource_id from notifications where title like 'Critical:%' order by created_at desc limit 1`))[0]
check('a care-team notification says which patient it is about', about?.resource_type === 'patient' && about?.resource_id === ID.pat)
check('reading a notification stamps when, and what it is about cannot be changed', (await as(ID.pat, `update notifications set read = true where id = (select id from notifications where not read limit 1) returning read_at`))[0]?.read_at != null
  && (await denied(DOC, `update notifications set resource_id = 'x'`)).blocked)

/* ── Relationships and accounts (0011): assignment history, removing a doctor, past patients ── */
console.log('\nRelationships')
// So far James (pat) went from Dr. Amara (doc) to doc2, and so did Grace (pat2).
const openFor = async pt => (await db.query(`select doctor_id, reason, assigned_by from care_assignments where patient_id = $1 and ended_at is null`, [pt])).rows
const jamesHistory = (await db.query(`select doctor_id, ended_at, end_reason from care_assignments where patient_id = $1 order by started_at`, [ID.pat])).rows
check('every assignment is kept, with one open at a time', jamesHistory.length === 2 && jamesHistory[0].doctor_id === ID.doc && jamesHistory[0].ended_at !== null
  && /Moved to Dr\. Other/.test(jamesHistory[0].end_reason) && jamesHistory[1].ended_at === null && (await openFor(ID.pat))[0].doctor_id === DOC)
check('a second open assignment for one patient cannot exist', await db.query(`insert into care_assignments (patient_id, doctor_id) values ($1, $2)`, [ID.pat, ID.doc]).then(() => false, () => true))
const past = await as(ID.doc, `select full_name, ended_at from my_past_patients()`)
check('a doctor sees who they used to treat, by name only', past.map(r => r.full_name).sort().join() === 'Grace Otieno,James Mwangi' && past.every(r => r.ended_at)
  && (await as(ID.doc, `select 1 from readings`)).length === 0 && (await as(DOC, `select 1 from my_past_patients()`)).length === 0
  && (await as(ID.pat, `select 1 from my_past_patients()`)).length === 0)
check('the history is read by the patient, the doctors in it and care coordinators only', (await as(ID.pat, `select 1 from care_assignments`)).length === 2
  && (await as(ID.doc, `select 1 from care_assignments`)).length === 2 && (await as(ID.evil, `select 1 from care_assignments`)).length === 0
  && (await denied(ID.admin, `insert into care_assignments (patient_id, doctor_id) values ($1, $2)`, [ID.evil, ID.doc])).blocked)
check('removing a doctor needs a reason', /Say why/.test((await denied(ID.admin, `update patients set assigned_doctor_id = null where id = $1`, [ID.pat])).why ?? '')
  && /Say why/.test((await denied(ID.admin, `select assign_doctor($1, null, ' ')`, [ID.pat])).why ?? ''))
check('only someone who assigns healthworkers uses assign_doctor', (await denied(ID.asst, `select assign_doctor($1, $2)`, [ID.pat, ID.doc])).blocked
  && (await denied(ID.pat, `select assign_doctor($1, $2)`, [ID.pat, ID.doc])).blocked)
await as(ID.admin, `select assign_doctor($1, null, 'Patient moved abroad')`, [ID.pat])
check('removal ends the assignment with its reason, tells both and is audited', (await openFor(ID.pat)).length === 0
  && (await one(`select end_reason, ended_by from care_assignments where patient_id = $1 and doctor_id = $2`, [ID.pat, DOC])).end_reason === 'Patient moved abroad'
  && (await as(ID.pat, `select 1 from notifications where title = 'Care team updated' and body like 'You no longer%'`)).length === 1
  && (await one(`select count(*)::int n from audit_log where action = 'Removed doctor assignment' and patient_id = $1 and detail like '%Patient moved abroad'`, [ID.pat])).n === 1)
await as(ID.admin, `select assign_doctor($1, $2, 'Closer to the patient')`, [ID.pat, ID.doc])
const reopened = (await openFor(ID.pat))[0]
check('a new assignment records who made it and why; the doctor is told which patient', reopened.doctor_id === ID.doc && reopened.reason === 'Closer to the patient' && reopened.assigned_by === ID.admin
  && (await as(ID.doc, `select resource_id from notifications where title = 'New patient assigned' order by created_at desc limit 1`))[0].resource_id === ID.pat)
const TREAT = ID.doc   // Dr. Amara treats James again; doc2 no longer does

/* ── Clinical record (0012): note visibility and amendments, prescription details and status, care plans ── */
console.log('\nClinical record')
const noteCount = async () => (await as(ID.pat, `select 1 from notifications where title = 'New note from your doctor'`)).length
const noteTold = await noteCount()
const noteWas = (await one(`select doctor_note from patients where id = $1`, [ID.pat])).doctor_note
await as(TREAT, `insert into clinical_notes (patient_id, author_id, content, visibility, note_type) values ($1, $2, 'Consider anxiety as a contributor.', 'internal', 'assessment')`, [ID.pat, TREAT])
check('an internal note stays with the treating doctor', (await as(TREAT, `select 1 from clinical_notes where visibility = 'internal'`)).length === 1
  && (await as(ID.pat, `select 1 from clinical_notes where visibility = 'internal'`)).length === 0
  && (await as(ID.asst, `select 1 from clinical_notes where visibility = 'internal'`)).length === 0
  && await noteCount() === noteTold && (await one(`select doctor_note from patients where id = $1`, [ID.pat])).doctor_note === noteWas)
const n1 = (await as(TREAT, `insert into clinical_notes (patient_id, author_id, content) values ($1, $2, 'Take the tablet with food.') returning id`, [ID.pat, TREAT]))[0].id
const n2 = (await as(TREAT, `insert into clinical_notes (patient_id, author_id, content, amends) values ($1, $2, 'Take the tablet after food.', $3) returning id`, [ID.pat, TREAT, n1]))[0].id
check("a correction replaces the note it amends as the patient's current note, and the patient is told", (await one(`select doctor_note from patients where id = $1`, [ID.pat])).doctor_note === 'Take the tablet after food.'
  && (await as(ID.pat, `select 1 from notifications where title = 'Your doctor corrected a note'`)).length === 1
  && (await as(ID.pat, `select 1 from clinical_notes where id = any ($1)`, [[n1, n2]])).length === 2)
const graceNote = (await one(`select id from clinical_notes where patient_id = $1 limit 1`, [ID.pat2])).id
check("a note is corrected once, and never with another patient's note", (await denied(TREAT, `insert into clinical_notes (patient_id, author_id, content, amends) values ($1, $2, 'Again', $3)`, [ID.pat, TREAT, n1])).blocked
  && (await denied(TREAT, `insert into clinical_notes (patient_id, author_id, content, amends) values ($1, $2, 'Wrong record', $3)`, [ID.pat, TREAT, graceNote])).blocked)
check('a note is audited against its patient', (await one(`select count(*)::int n from audit_log where action = 'Amended clinical note' and patient_id = $1 and resource_id = $2`, [ID.pat, n2])).n === 1)

const rxNew = (await as(TREAT, `insert into prescriptions (patient_id, doctor_id, medication, dosage, frequency, route, instructions, start_date, end_date)
  values ($1, $2, 'Enalapril', '5mg', 'Once daily', 'oral', '  With breakfast  ', current_date, current_date + 13) returning id, status, instructions`, [ID.pat, TREAT]))[0]
check('a prescription carries how and for how long it is taken', rxNew.status === 'active' && rxNew.instructions === 'With breakfast'
  && (await as(ID.pat, `select action from prescription_events where prescription_id = $1`, [rxNew.id])).map(e => e.action).join() === 'prescribed')
check('an end before the start, or an unknown route, is refused', (await denied(TREAT, `insert into prescriptions (patient_id, doctor_id, medication, dosage, frequency, start_date, end_date) values ($1, $2, 'X', '1', 'Once daily', current_date, current_date - 1)`, [ID.pat, TREAT])).blocked
  && (await denied(TREAT, `insert into prescriptions (patient_id, doctor_id, medication, dosage, frequency, route) values ($1, $2, 'X', '1', 'Once daily', 'telepathy')`, [ID.pat, TREAT])).blocked)
await as(TREAT, `update prescriptions set status = 'discontinued', stop_reason = 'Dry cough' where id = $1`, [rxNew.id])
const stoppedRx = await one(`select active, status, stopped_by, stop_reason from prescriptions where id = $1`, [rxNew.id])
check('stopping records the reason, in the history and to the patient', stoppedRx.active === false && stoppedRx.stopped_by === TREAT && stoppedRx.stop_reason === 'Dry cough'
  && (await as(ID.pat, `select detail from prescription_events where prescription_id = $1 and action = 'stopped'`, [rxNew.id]))[0]?.detail === 'Dry cough'
  && (await as(ID.pat, `select 1 from notifications where title = 'Medication stopped' and body like '%Dry cough'`)).length === 1)
await as(TREAT, `update prescriptions set active = true where id = $1`, [rxNew.id])
check('restarting clears the reason; status and the on/off switch always agree', (await one(`select status, stop_reason, stopped_at from prescriptions where id = $1`, [rxNew.id])).status === 'active'
  && (await one(`select stop_reason from prescriptions where id = $1`, [rxNew.id])).stop_reason === null
  && (await denied(ID.pat, `insert into prescription_events (prescription_id, patient_id, action) values ($1, $2, 'stopped')`, [rxNew.id, ID.pat])).blocked)
const course = (await as(TREAT, `insert into prescriptions (patient_id, doctor_id, medication, dosage, frequency, start_date, end_date) values ($1, $2, 'Amoxicillin', '500mg', 'Three times daily', current_date - 7, current_date - 1) returning id`, [ID.pat, TREAT]))[0].id
check('a course whose last day has passed is completed by the schedule, and the patient is told', (await db.query(`select complete_ended_prescriptions() n`)).rows[0].n === 1
  && (await one(`select status, active, stop_reason from prescriptions where id = $1`, [course])).status === 'completed'
  && (await as(ID.pat, `select 1 from notifications where title = 'Course finished'`)).length === 1
  && (await denied(TREAT, `select complete_ended_prescriptions()`)).blocked)

const planJson = extra => JSON.stringify({ patient_id: ID.pat, title: ' Blood pressure control ', summary: 'Bring BP under 135/85 in three months.', review_date: null,
  items: [{ kind: 'goal', text: 'Morning BP under 135/85 on 5 of 7 days', vital_id: 'bp' }, { kind: 'intervention', text: 'Walk 30 minutes, five days a week' }], ...extra })
const plan1 = (await as(TREAT, `select save_care_plan($1) id`, [planJson()]))[0].id
check('a care plan is saved with its goals in one step, as a draft only the treating doctor sees', (await one(`select status, title, doctor_id from care_plans where id = $1`, [plan1])).status === 'draft'
  && (await one(`select title from care_plans where id = $1`, [plan1])).title === 'Blood pressure control'
  && (await as(TREAT, `select 1 from care_plan_items where plan_id = $1`, [plan1])).length === 2
  && (await as(ID.pat, `select 1 from care_plans`)).length === 0 && (await as(ID.pat, `select 1 from care_plan_items`)).length === 0
  && (await as(DOC, `select 1 from care_plans`)).length === 0)
check("a doctor who does not treat the patient cannot write their plan, nor a patient", (await denied(DOC, `select save_care_plan($1)`, [planJson()])).blocked
  && (await denied(ID.pat, `select save_care_plan($1)`, [planJson()])).blocked
  && (await denied(DOC, `select save_care_plan($1)`, [planJson({ id: plan1 })])).blocked)
const plan2 = (await as(TREAT, `select save_care_plan($1) id`, [JSON.stringify({ patient_id: ID.pat, title: 'Sleep', items: [{ kind: 'intervention', text: 'No screens after 9pm' }] })]))[0].id
check('a plan needs a goal before it starts; a draft can be dropped', /at least one goal/.test((await denied(TREAT, `select set_care_plan_status($1, 'active')`, [plan2])).why ?? '')
  && (await as(TREAT, `delete from care_plans where id = $1 returning id`, [plan2])).length === 1)
await as(TREAT, `select set_care_plan_status($1, 'active')`, [plan1])
check('starting the plan shows it to the patient and tells them', (await as(ID.pat, `select status, start_date = current_date today from care_plans`))[0]?.status === 'active'
  && (await as(ID.pat, `select 1 from care_plan_items`)).length === 2
  && (await as(ID.pat, `select resource_id from notifications where kind = 'care_plan' and title = 'Your care plan is ready'`))[0]?.resource_id === plan1)
const plan3 = (await as(TREAT, `select save_care_plan($1) id`, [planJson({ title: 'Second plan' })]))[0].id
check('one active plan at a time', /already has an active care plan/.test((await denied(TREAT, `select set_care_plan_status($1, 'active')`, [plan3])).why ?? ''))
const goal = (await as(TREAT, `select id from care_plan_items where plan_id = $1 and kind = 'goal'`, [plan1]))[0].id
await as(TREAT, `update care_plan_items set status = 'achieved', progress_note = 'Six of seven mornings in range' where id = $1`, [goal])
check('progress on a goal is kept in the history and the patient is told; the patient cannot change it', (await as(ID.pat, `select action from care_plan_events where plan_id = $1 and action = 'item_achieved'`, [plan1])).length === 1
  && (await as(ID.pat, `select 1 from notifications where title = 'Goal reached'`)).length === 1
  && (await as(ID.pat, `update care_plan_items set status = 'open' where id = $1 returning id`, [goal])).length === 0)
await as(TREAT, `select save_care_plan($1)`, [JSON.stringify({ id: plan1, title: 'Blood pressure control', summary: 'Reviewed.', items: [{ id: goal, kind: 'goal', text: 'Morning BP under 130/80 on 5 of 7 days', vital_id: 'bp' }] })])
const afterEdit = (await db.query(`select kind, status, text from care_plan_items where plan_id = $1`, [plan1])).rows
check('editing a plan keeps the progress already made, and drops what was removed', afterEdit.length === 1 && afterEdit[0].status === 'achieved' && /130\/80/.test(afterEdit[0].text)
  && (await as(ID.pat, `select 1 from care_plan_events where plan_id = $1 and action = 'edited'`, [plan1])).length >= 1)
await as(TREAT, `select set_care_plan_status($1, 'on_hold', 'Patient travelling')`, [plan1])
await as(TREAT, `select set_care_plan_status($1, 'active')`, [plan1])
check('a plan cannot go back to draft', (await denied(TREAT, `select set_care_plan_status($1, 'draft')`, [plan1])).blocked)
await as(TREAT, `select set_care_plan_status($1, 'completed', ' Target reached ')`, [plan1])
const closedPlan = await one(`select status, closed_at is not null closed, close_note from care_plans where id = $1`, [plan1])
check('a completed plan is closed: it and its goals stay as they were', closedPlan.status === 'completed' && closedPlan.closed && closedPlan.close_note === 'Target reached'
  && (await denied(TREAT, `select set_care_plan_status($1, 'active')`, [plan1])).blocked
  && (await denied(TREAT, `select save_care_plan($1)`, [planJson({ id: plan1 })])).blocked
  && (await denied(TREAT, `update care_plan_items set status = 'open' where id = $1`, [goal])).blocked)
check('the patient reads the whole history of their plan', (await as(ID.pat, `select action from care_plan_events where plan_id = $1 order by id`, [plan1])).map(e => e.action).join()
  === 'created,active,item_achieved,edited,on_hold,active,completed')

/* ── Availability (0013): working hours, days away, and booking checked against them ── */
console.log('\nAvailability')
const dow = async n => (await one(`select extract(dow from current_date + ${n})::int d`)).d
const hours = JSON.stringify([{ weekday: await dow(7), start: '09:00', end: '12:00' }, { weekday: await dow(7), start: '14:00', end: '16:00' }])
check('only a doctor sets working hours, and blocks cannot overlap', (await denied(ID.pat, `select set_doctor_hours($1)`, [hours])).blocked
  && (await denied(ID.admin, `select set_doctor_hours($1)`, [hours])).blocked
  && (await denied(TREAT, `select set_doctor_hours($1)`, [JSON.stringify([{ weekday: 1, start: '09:00', end: '12:00' }, { weekday: 1, start: '11:00', end: '13:00' }])])).blocked
  && (await as(TREAT, `select 1 from doctor_hours`)).length === 0)
await as(TREAT, `select set_doctor_hours($1, 30)`, [hours])
const avail = async (n, who = ID.pat) => (await as(who, `select doctor_availability($1, current_date + ${n}) a`, [TREAT]))[0].a
const day7 = await avail(7)
check('a patient sees the open times of a day, and nothing else', day7.managed === true && day7.away === false && day7.slots.join() === '09:00,09:30,10:00,10:30,11:00,11:30,14:00,14:30,15:00,15:30'
  && (await avail(8)).slots.length === 0 && !('reason' in day7))
const ask = (n, time, who = ID.pat, doctor = TREAT) => as(who, `insert into appointments (patient_id, doctor_id, title, preferred_date, preferred_time) values ($1, $2, 'Review', current_date + ${n}, $3) returning id`, [ID.pat, doctor, time])
const inHours = (await ask(7, '10:00'))[0].id
check('a request inside the hours is taken; outside them, or on a day off, it is refused', !!inHours
  && /outside the hours/.test((await ask(7, '12:30').then(() => ({}), e => ({ why: e.message }))).why ?? '')
  && /outside the hours/.test((await ask(7, '11:45').then(() => ({}), e => ({ why: e.message }))).why ?? '')
  && /does not see patients on that day/.test((await ask(8, '10:00').then(() => ({}), e => ({ why: e.message }))).why ?? ''))
await as(TREAT, `insert into doctor_time_off (doctor_id, from_date, to_date, reason) values ($1, current_date + 14, current_date + 14, 'Conference')`, [TREAT])
check('a day away takes no requests; why the doctor is away stays private', (await avail(14)).away === true && (await avail(14)).slots.length === 0
  && /is away on that day/.test((await ask(14, '10:00').then(() => ({}), e => ({ why: e.message }))).why ?? '')
  && (await as(ID.pat, `select 1 from doctor_time_off`)).length === 0 && (await as(ID.admin, `select reason from doctor_time_off`))[0].reason === 'Conference')
await as(TREAT, `update appointments set status = 'approved' where id = $1`, [inHours])
check('a confirmed visit takes its time off the list', !(await avail(7)).slots.includes('10:00') && (await avail(7)).slots.includes('10:30'))
check('the doctor can still place a visit in their own day; a doctor with no timetable is unrestricted',
  (await as(TREAT, `insert into appointments (patient_id, doctor_id, title, preferred_date, preferred_time, status) values ($1, $2, 'Evening call', current_date + 7, '18:00', 'approved') returning id`, [ID.pat, TREAT])).length === 1
  && (await ask(8, '06:15', ID.pat, DOC)).length === 1 && (await as(ID.pat, `select doctor_availability($1, current_date + 8) a`, [DOC]))[0].a.managed === false)

/* ── Administration (0014): support acts on the one appointment; support requests; the operational report ── */
console.log('\nAdministration')
const move = (who, id, date, time, reason) => denied(who, `select admin_update_appointment($1, 'move', current_date + ${date}, $2, $3)`, [id, time, reason])
check('only someone who handles support changes an appointment for others, and always with a reason', (await move(ID.asst, inHours, 7, '11:00', 'Patient asked by phone')).blocked
  && (await move(ID.pat, inHours, 7, '11:00', 'I want to')).blocked && (await move(ID.admin, inHours, 7, '11:00', ' ')).blocked)
check("a move is still checked against the doctor's hours", /outside the hours/.test((await move(ID.admin, inHours, 7, '13:00', 'Patient asked by phone')).why ?? ''))
const movedOk = await move(ID.admin, inHours, 7, '11:00', 'Patient asked by phone')
const movedAppt = await one(`select preferred_time::text t, status from appointments where id = $1`, [inHours])
check('support moves the same appointment; both are told; it is in the history and the audit trail', !movedOk.blocked && movedAppt.t === '11:00:00' && movedAppt.status === 'approved'
  && (await hist(inHours)).some(e => e.action === 'moved' && e.actor_id === ID.admin && /Patient asked by phone/.test(e.detail))
  && (await as(ID.pat, `select 1 from notifications where title = 'Appointment moved by mCare support' and resource_id = $1`, [inHours])).length === 1
  && (await as(TREAT, `select 1 from notifications where title = 'Appointment moved by mCare support' and resource_id = $1`, [inHours])).length === 1
  && (await one(`select count(*)::int n from audit_log where action = 'Moved appointment' and resource_id = $1 and patient_id = $2`, [inHours, ID.pat])).n === 1
  && (await one(`select count(*)::int n from appointments where patient_id = $1 and title = 'Review' and doctor_id = $2`, [ID.pat, TREAT])).n === 1)
await as(ID.admin, `select admin_update_appointment($1, 'cancel', null, null, 'Doctor called away')`, [inHours])
check('support cancels it with the reason; a closed appointment is not changed again', (await one(`select status, rejection_reason from appointments where id = $1`, [inHours])).rejection_reason === 'Doctor called away'
  && (await as(TREAT, `select 1 from notifications where title = 'Appointment cancelled by mCare support'`)).length === 1
  && (await move(ID.admin, inHours, 7, '09:00', 'Trying again')).blocked)

const ticket = (await as(ID.pat, `insert into support_tickets (user_id, subject, message) values ($1, 'Wrong phone number', 'Please correct it') returning id`, [ID.pat]))[0].id
check('a support request reaches the people who handle support, as its own kind of notification', (await as(ID.admin, `select resource_id from notifications where kind = 'support' and title like 'Support request:%' order by created_at desc limit 1`))[0]?.resource_id === ticket)
await as(ID.admin, `update support_tickets set status = 'resolved', resolution_note = ' Number corrected ' where id = $1`, [ticket])
check('it is answered once, the person is told and it is audited', (await one(`select resolution_note, resolved_by from support_tickets where id = $1`, [ticket])).resolution_note === 'Number corrected'
  && (await as(ID.pat, `select 1 from notifications where title = 'Support request answered' and body = 'Number corrected'`)).length === 1
  && (await denied(ID.admin, `update support_tickets set resolution_note = 'changed' where id = $1`, [ticket])).blocked
  && (await one(`select count(*)::int n from audit_log where action = 'Answered support request' and resource_id = $1`, [ticket])).n === 1)

const report = (await as(ID.admin, `select admin_report(current_date - 30, current_date) r`))[0].r
check('the operational report is counted from the records', report.accounts.patient >= 1 && report.alerts.raised >= 1 && report.activity.readings >= 1
  && report.doctors.some(d => d.name === 'Dr. Amara Osei' && d.patients === 1) && typeof report.waiting.support_requests === 'number'
  && !JSON.stringify(report).includes('James'))
check('it is for an administrator or someone who reads the audit log, and for a year at most', (await denied(TREAT, `select admin_report(current_date - 30, current_date)`)).blocked
  && (await denied(ID.asst, `select admin_report(current_date - 30, current_date)`)).blocked && (await denied(ID.pat, `select admin_report(current_date - 30, current_date)`)).blocked
  && (await denied(ID.admin, `select admin_report(current_date - 800, current_date)`)).blocked)

/* ── Synchronisation (0015): one token that changes when anything a person may see changes ── */
console.log('\nSynchronisation')
const changeToken = async who => (await as(who, `select my_change_token() t`))[0].t
const [docT, patT, adminT, otherT] = [await changeToken(TREAT), await changeToken(ID.pat), await changeToken(ID.admin), await changeToken(ID.evil)]
await as(ID.pat, `insert into dose_logs (patient_id, prescription_id, slot, day) values ($1, $2, 600, current_date)`, [ID.pat, rxNew.id])
check("a change that writes no notification still changes the token of everyone who sees that patient", await changeToken(TREAT) !== docT && await changeToken(ID.pat) !== patT && await changeToken(ID.admin) !== adminT)
check('and of nobody else', await changeToken(ID.evil) === otherT)
const docT2 = await changeToken(TREAT), adminT2 = await changeToken(ID.admin)
await as(ID.evil, `insert into readings (patient_id, vital_id, value) values ($1, 'hr', '70')`, [ID.evil])
check("another patient's record does not move a doctor's token, but does move the staff's", await changeToken(TREAT) === docT2 && await changeToken(ID.admin) !== adminT2)
const patT2 = await changeToken(ID.pat)
await as(ID.admin, `select invite_account('sync.test@mcare.app', 'Sync Test', 'patient')`)
check('a change to the shared lists moves every token', await changeToken(ID.pat) !== patT2)
check('the counters are read only by those who may see the patient, and written by nobody', (await as(ID.pat, `select 1 from patient_changes`)).length === 1
  && (await as(ID.evil, `select 1 from patient_changes where patient_id = $1`, [ID.pat])).length === 0
  && (await as(ID.pat, `update patient_changes set version = 0 returning patient_id`).catch(() => [])).length === 0
  && (await denied(ID.pat, `insert into system_changes (topic) values ('x')`)).blocked)
check('a signed-out visitor or a closed account gets no token', (await denied(null, `select my_change_token()`)).blocked && (await denied(ID.pat2, `select my_change_token()`)).blocked)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

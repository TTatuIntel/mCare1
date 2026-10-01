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
check('treating doctor sees the shared upload, not the private one', JSON.stringify((await as(DOC, `select id from documents`)).map(r => r.id)) === JSON.stringify([shared]))
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
check('admin registry lists documents without titles or content', reg.length === 4 && !('title' in reg[0]) && !('body' in reg[0]), `rows ${reg.length}`)
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
  && (await db.query(`select count(*)::int n from documents where status = 'released'`)).rows[0].n === 2)
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

-- mCare schema: types, tables, keys, constraints and indexes.
--
-- One record, many authorised views. Every clinical row hangs off one patient
-- through `patient_id`; a patient is one `profiles` row, which is one sign-in
-- account (`auth.users`). Doctors, admins and assistants are profiles too.
-- Nothing is copied per role: the four portals read and change these same rows,
-- and the access rules (0009_security.sql) decide who reaches what.
--
-- Conventions:
--   • ids are random uuids, except append-only logs (bigint identity)
--   • a row that belongs to a patient is deleted with the patient (on delete cascade)
--   • who did something is a reference to their profile. Accounts are deactivated, not
--     deleted, so these references hold; where a log must outlive a removed account the
--     reference becomes null (on delete set null), otherwise removing it is refused
--   • every foreign key is backed by an index where rows are looked up or deleted through it
--   • clinical history is never rewritten: events tables keep each step
--   • `client_ref` is the reference of the form that created a row, unique where set,
--     so a form sent twice saves once
--
-- Files: 0001 schema · 0002 helpers · 0003 accounts · 0004 vitals and alerts ·
-- 0005 clinical record · 0006 appointments · 0007 documents · 0008 messages and
-- delivery · 0009 security · 0010 reference data and scheduled jobs


/* ═══ Types ═══════════════════════════════════════════════════════════ */
create type user_role          as enum ('patient', 'doctor', 'admin', 'assistant');
create type account_status     as enum ('unverified', 'pending_approval', 'active', 'suspended', 'deactivated');
create type approval_status    as enum ('pending', 'approved', 'sent_back', 'rejected');
create type vital_level        as enum ('normal', 'warning', 'critical');   -- ordered: comparisons pick the worse grade
create type alert_type         as enum ('vital', 'sos');
create type alert_severity     as enum ('danger', 'warning');
create type alert_status       as enum ('open', 'acknowledged', 'escalated', 'resolved');
create type request_status     as enum ('pending', 'approved', 'rejected');
create type appointment_status as enum ('requested', 'approved', 'rejected', 'rescheduled', 'completed', 'cancelled', 'no_show');
create type notif_kind         as enum ('alert', 'sos', 'message', 'appointment', 'assignment', 'prescription', 'account',
                                        'escalation', 'document', 'care_plan', 'support');
create type doc_category       as enum ('vitals_report', 'lab', 'imaging', 'prescription', 'visit_summary', 'discharge',
                                        'referral', 'insurance', 'personal', 'other');
create type doc_origin         as enum ('patient_upload', 'clinician_upload', 'system_generated');
create type doc_status         as enum ('draft', 'signed', 'released');
create type upload_state       as enum ('uploading', 'scanning', 'ready', 'failed');
create type doc_visibility     as enum ('care_team', 'private');


/* ═══ People ══════════════════════════════════════════════════════════
   One row per account. Passwords live in Supabase Auth (auth.users), never here.
   The role is a column, not a second identity; role-specific facts hang off the
   same id in doctors, staff or patients. */
create table profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  role              user_role      not null default 'patient',
  status            account_status not null default 'active',
  -- why the status last changed, who changed it, and when (suspension and deactivation need a reason)
  status_reason     text check (status_reason is null or length(status_reason) <= 300),
  status_changed_by uuid references profiles (id) on delete set null,
  status_changed_at timestamptz,
  full_name         text not null check (length(trim(full_name)) > 0),
  email             text not null,
  phone             text not null default '',
  dob               date,
  avatar            jsonb,
  theme             text check (theme in ('light', 'dark', 'auto')),
  font_size         text check (font_size in ('sm', 'md', 'lg')),
  -- the channels a notification may also go out on
  notify_email      boolean not null default true,
  notify_sms        boolean not null default true,
  notify_push       boolean not null default true,
  created_at        timestamptz not null default now(),
  constraint profiles_name_length  check (length(full_name) <= 120),
  constraint profiles_phone_length check (length(phone) <= 32)
);

create table doctors (
  id              uuid primary key references profiles (id) on delete cascade,
  specialty       text not null default '',
  license_no      text not null default '',
  hospital        text not null default '',
  approval_status approval_status not null default 'pending',
  approval_note   text,
  approved_by     uuid references profiles (id),
  approved_at     timestamptz,
  signature       text,   -- handwritten signature (PNG data URL) stamped onto reports at signing
  slot_minutes    int not null default 30 check (slot_minutes in (10, 15, 20, 30, 45, 60))   -- length of one visit
);

-- Admins and mCare assistants. An assistant holds only the permissions listed here.
create table staff (
  id           uuid primary key references profiles (id) on delete cascade,
  is_assistant boolean not null default false,
  permissions  text[]  not null default '{}',
  constraint staff_permissions_known check (permissions <@ array[
    'approve_doctors', 'create_users', 'view_logs', 'assign_healthworkers', 'approve_patient_requests',
    'handle_support', 'monitor_patients', 'document_support']::text[])
);

create table patients (
  id                   uuid primary key references profiles (id) on delete cascade,
  assigned_doctor_id   uuid references doctors (id) on delete set null,   -- the one treating doctor; every access rule follows it
  profile_setup        text not null default 'pending' check (profile_setup in ('pending', 'skipped', 'done')),
  sex                  text check (sex in ('female', 'male', 'intersex', 'undisclosed')),
  blood_type           text check (blood_type in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  no_known_allergies   boolean not null default false,
  no_conditions        boolean not null default false,
  other_medicines      text,
  doctor_note          text,     -- the newest shared clinical note, shown to the patient (kept by the database)
  docs_private_default boolean not null default false,
  unit_prefs           jsonb not null default '{}'
    check (jsonb_typeof(unit_prefs) = 'object' and length(unit_prefs::text) <= 2000)
);
create index patients_doctor_idx on patients (assigned_doctor_id);

create table allergies (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients (id) on delete cascade,
  substance  text not null,
  severity   text not null check (severity in ('mild', 'moderate', 'severe')),
  reaction   text,
  constraint allergies_filled check (length(trim(substance)) > 0)
);
create index allergies_patient_idx on allergies (patient_id);
create unique index allergies_once on allergies (patient_id, lower(substance));

create table conditions (
  patient_id uuid not null references patients (id) on delete cascade,
  name       text not null,
  primary key (patient_id, name)
);

create table emergency_contacts (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references patients (id) on delete cascade,
  name         text not null,
  relationship text not null default 'Contact',
  phone        text not null,
  next_of_kin  boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint emergency_contacts_filled check (length(trim(name)) > 0 and length(regexp_replace(phone, '\D', '', 'g')) >= 7)
);
create index emergency_contacts_patient_idx on emergency_contacts (patient_id);
-- At most one next of kin per patient.
create unique index emergency_contacts_one_kin on emergency_contacts (patient_id) where next_of_kin;

-- What a person agreed to, and when. Rows are only ever added; the newest row per kind is the current answer.
create table consents (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles (id) on delete cascade,
  kind       text not null check (kind in ('terms', 'privacy')),
  granted    boolean not null,
  version    text not null default '1' check (length(version) between 1 and 20),
  created_at timestamptz not null default now()
);
create index consents_user_idx on consents (user_id, kind, created_at desc);

/* Accounts are created by the sign-in service, by the person themself. An admin
   says in advance what someone will be: the invitation is matched by email when
   they sign up. A patient or doctor invitation takes effect at once; a staff
   invitation only once the email address is confirmed. */
create table account_invitations (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = lower(trim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(email) <= 254),
  full_name   text not null check (length(trim(full_name)) between 1 and 120),
  phone       text not null default '' check (length(phone) <= 32),
  role        user_role not null,
  invited_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_by uuid references profiles (id) on delete set null,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  check ((accepted_by is null) = (accepted_at is null)),
  check (accepted_at is null or revoked_at is null)
);
-- One open invitation per email address.
create unique index account_invitations_one_open on account_invitations (email) where accepted_at is null and revoked_at is null;
create index account_invitations_time_idx on account_invitations (created_at desc);


/* ═══ Care relationships ══════════════════════════════════════════════ */

-- A patient asks for a doctor; a coordinator answers. One open request per patient.
create table doctor_requests (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients (id) on delete cascade,
  doctor_id     uuid not null references doctors (id) on delete cascade,
  status        request_status not null default 'pending',
  response_note text,
  requested_at  timestamptz not null default now(),
  decided_by    uuid references profiles (id),
  decided_at    timestamptz
);
create unique index doctor_requests_one_pending on doctor_requests (patient_id) where status = 'pending';
create index doctor_requests_doctor_idx on doctor_requests (doctor_id);
create index doctor_requests_patient_idx on doctor_requests (patient_id, requested_at desc);

/* Every assignment of a treating doctor, with its start, end, who made it and why.
   Written by the database when patients.assigned_doctor_id changes; at most one open row per patient. */
create table care_assignments (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients (id) on delete cascade,
  doctor_id   uuid not null references doctors (id),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  assigned_by uuid references profiles (id) on delete set null,
  ended_by    uuid references profiles (id) on delete set null,
  reason      text check (reason is null or length(reason) <= 300),       -- why this doctor was assigned
  end_reason  text check (end_reason is null or length(end_reason) <= 300),
  check (ended_at is null or ended_at >= started_at)
);
create unique index care_assignments_one_open on care_assignments (patient_id) where ended_at is null;
create index care_assignments_patient_idx on care_assignments (patient_id, started_at desc);
create index care_assignments_doctor_idx  on care_assignments (doctor_id, started_at desc);

/* Consulting doctors: they READ the patient's record (consults()) and change nothing.
   Only the treating doctor (treats()) changes the record. */
create table care_team_members (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients (id) on delete cascade,
  doctor_id  uuid not null references doctors (id),
  reason     text check (reason is null or length(reason) <= 300),
  added_by   uuid references profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  ended_by   uuid references profiles (id) on delete set null,
  check (ended_at is null or ended_at >= started_at)
);
create unique index care_team_one_open on care_team_members (patient_id, doctor_id) where ended_at is null;
create index care_team_doctor_idx on care_team_members (doctor_id) where ended_at is null;

-- A patient's rating of the doctor who treats them. One per patient and doctor; it can be changed.
create table doctor_ratings (
  patient_id uuid not null references patients (id) on delete cascade,
  doctor_id  uuid not null references doctors (id) on delete cascade,
  rating     int  not null check (rating between 1 and 5),
  comment    text check (comment is null or length(comment) <= 1000),
  updated_at timestamptz not null default now(),
  primary key (patient_id, doctor_id)
);
create index doctor_ratings_doctor_idx on doctor_ratings (doctor_id);


/* ═══ Vitals and alerts ═══════════════════════════════════════════════ */

-- The vitals mCare knows, with their standard ranges. Edited by admins only.
create table vital_defs (
  id               text primary key,
  name             text not null,
  unit             text not null,
  icon             text not null default '',
  active           boolean not null default true,
  normal_min       numeric not null,
  normal_max       numeric not null,
  critical_min     numeric,
  critical_max     numeric,
  hard_min         numeric not null,     -- plausible limits: a value outside them is refused as a typo
  hard_max         numeric not null,
  dia_normal_min   numeric,              -- blood pressure only: the diastolic ranges
  dia_normal_max   numeric,
  dia_critical_min numeric,
  dia_critical_max numeric,
  unit_options     text[],
  constraint vital_defs_named           check (length(trim(name)) between 1 and 60 and length(trim(unit)) between 1 and 20),
  constraint vital_defs_normal_order    check (normal_min < normal_max),
  constraint vital_defs_plausible_order check (hard_min < hard_max)
);

create table tracked_vitals (
  patient_id uuid not null references patients (id) on delete cascade,
  vital_id   text not null references vital_defs (id),
  primary key (patient_id, vital_id)
);

-- A doctor's personal targets for one patient. A row here also "locks" the vital: only the doctor removes it.
create table thresholds (
  patient_id   uuid not null references patients (id) on delete cascade,
  vital_id     text not null references vital_defs (id),
  target_min   numeric not null,
  target_max   numeric not null,
  critical_min numeric,
  critical_max numeric,
  set_by       uuid references profiles (id),
  updated_at   timestamptz not null default now(),
  primary key (patient_id, vital_id),
  check (target_min < target_max),
  constraint thresholds_critical_order check (critical_min is null or critical_max is null or critical_min < critical_max)
);

-- When a doctor changed a patient's target or critical range for a vital, and from what. Written by the database.
create table threshold_changes (
  id                bigint generated always as identity primary key,
  patient_id        uuid not null references patients (id) on delete cascade,
  vital_id          text not null references vital_defs (id),
  from_min          numeric,
  from_max          numeric,
  to_min            numeric,     -- null when the personal target was removed
  to_max            numeric,
  changed_by        uuid references profiles (id) on delete set null,
  changed_at        timestamptz not null default now(),
  from_critical_min numeric,
  from_critical_max numeric,
  to_critical_min   numeric,
  to_critical_max   numeric
);
create index threshold_changes_patient_idx on threshold_changes (patient_id, vital_id, changed_at desc);

/* A reading is validated, graded and timed by the database (0004). It is never
   deleted: a typo is corrected within 15 minutes (the first value is kept), and a
   wrong reading is marked invalid by the treating doctor. */
create table readings (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references patients (id) on delete cascade,
  vital_id        text not null references vital_defs (id),
  value           text not null,          -- as entered, canonical unit: "124/82" or "72"
  primary_value   numeric not null,       -- filled by trigger (systolic for blood pressure)
  secondary_value numeric,                -- diastolic
  level           vital_level not null default 'normal',   -- filled by trigger
  note            text,
  invalid         boolean not null default false,
  invalid_reason  text,
  taken_at        timestamptz not null default now(),       -- the server's clock
  recorded_by     uuid references profiles (id) on delete set null,   -- the patient, or the treating doctor
  corrected_from  text,                   -- what was first saved, kept when a typo is corrected
  corrected_at    timestamptz,
  invalidated_by  uuid references profiles (id) on delete set null,
  invalidated_at  timestamptz,
  client_ref      uuid,
  constraint readings_note_length check (note is null or length(note) <= 500)
);
create index readings_patient_vital_idx on readings (patient_id, vital_id, taken_at desc);
create index readings_patient_time_idx  on readings (patient_id, taken_at desc);
create unique index readings_client_ref_key on readings (client_ref) where client_ref is not null;

/* Raised by the database only (a reading, or an SOS). The care team moves it
   through its steps; once resolved it cannot be changed. */
create table alerts (
  id                   uuid primary key default gen_random_uuid(),
  patient_id           uuid not null references patients (id) on delete cascade,
  type                 alert_type     not null default 'vital',
  severity             alert_severity not null,
  status               alert_status   not null default 'open',
  vital_id             text references vital_defs (id),
  reading_id           uuid references readings (id) on delete set null,   -- the reading that raised it
  value                text not null,                                      -- the value that raised it, never overwritten
  unit                 text not null default '',
  created_at           timestamptz not null default now(),
  acknowledged_at      timestamptz,
  acknowledged_by      uuid references profiles (id),
  escalated_at         timestamptz,
  recheck_requested_at timestamptz,
  recheck_requested_by uuid references profiles (id),
  recheck_reading_id   uuid references readings (id) on delete set null,   -- the latest re-measurement
  resolved_at          timestamptz,
  resolved_by          uuid references profiles (id),
  resolved_how         text check (resolved_how in ('remeasure', 'doctor', 'invalid', 'corrected', 'patient')),
  resolution_reason    text,
  resolution_note      text,
  constraint alerts_resolved_complete check ((status = 'resolved') = (resolved_at is not null)),
  constraint alerts_resolution_reason check (status <> 'resolved' or length(trim(coalesce(resolution_reason, ''))) > 0),
  constraint alerts_vital_named       check (type = 'sos' or vital_id is not null)
);
create index alerts_patient_idx on alerts (patient_id, created_at desc);
create index alerts_open_idx on alerts (status) where status <> 'resolved';
-- One alert per reading, however many times the app asks.
create unique index alerts_one_per_reading on alerts (reading_id) where reading_id is not null;
-- The alert a re-measurement answers (looked up after every saved reading).
create index alerts_recheck_reading_idx on alerts (recheck_reading_id) where recheck_reading_id is not null;

-- Every reading logged for a vital while its alert was open. A link: the reading itself is never copied.
create table alert_remeasures (
  reading_id uuid primary key references readings (id) on delete cascade,
  alert_id   uuid not null references alerts (id) on delete cascade,
  patient_id uuid not null references patients (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index alert_remeasures_alert_idx on alert_remeasures (alert_id, created_at);
create index alert_remeasures_patient_idx on alert_remeasures (patient_id);

-- What the care team said or did about an alert, without resolving it. Never edited.
create table alert_comments (
  id         uuid primary key default gen_random_uuid(),
  alert_id   uuid not null references alerts (id) on delete cascade,
  patient_id uuid not null references patients (id) on delete cascade,
  author_id  uuid not null references profiles (id),
  kind       text not null default 'comment' check (kind in ('comment', 'action', 'instruction')),
  body       text not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  client_ref uuid
);
create index alert_comments_alert_idx on alert_comments (alert_id, created_at);
create unique index alert_comments_client_ref_key on alert_comments (client_ref) where client_ref is not null;
create index alert_comments_patient_idx on alert_comments (patient_id);


/* ═══ Medication and nutrition ════════════════════════════════════════ */

-- Never deleted and never rewritten: a medicine is stopped (with a reason) or completed, and restarted as needed.
create table prescriptions (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients (id) on delete cascade,
  doctor_id     uuid not null references doctors (id),
  medication    text not null,
  dosage        text not null,
  frequency     text not null,
  purpose       text not null default '',
  route         text check (route is null or route in ('oral', 'topical', 'inhaled', 'injection', 'sublingual', 'eye', 'ear', 'nasal', 'rectal', 'other')),
  instructions  text check (instructions is null or length(instructions) <= 500),
  start_date    date not null default current_date,
  end_date      date,
  status        text not null default 'active',
  active        boolean not null default true,   -- the same as status = 'active'
  prescribed_at timestamptz not null default now(),
  stopped_at    timestamptz,
  stopped_by    uuid references profiles (id),
  stop_reason   text check (stop_reason is null or length(stop_reason) <= 300),
  client_ref    uuid,
  constraint prescriptions_filled check (length(trim(medication)) > 0 and length(trim(dosage)) > 0 and length(trim(frequency)) > 0),
  constraint prescriptions_status check (status in ('active', 'completed', 'discontinued')),
  constraint prescriptions_status_matches check ((status = 'active') = active),
  constraint prescriptions_dates check (end_date is null or end_date >= start_date)
);
create index prescriptions_patient_idx on prescriptions (patient_id);
create unique index prescriptions_client_ref_key on prescriptions (client_ref) where client_ref is not null;
create index prescriptions_doctor_idx on prescriptions (doctor_id);

-- What happened to a prescription, in order. Written by the database only.
create table prescription_events (
  id              bigint generated always as identity primary key,
  prescription_id uuid not null references prescriptions (id) on delete cascade,
  patient_id      uuid not null references patients (id) on delete cascade,
  actor_id        uuid references profiles (id) on delete set null,
  action          text not null check (action in ('prescribed', 'stopped', 'completed', 'restarted')),
  detail          text,
  created_at      timestamptz not null default now()
);
create index prescription_events_idx on prescription_events (prescription_id, created_at);
create index prescription_events_patient_idx on prescription_events (patient_id);

create table dose_logs (
  patient_id      uuid not null references patients (id) on delete cascade,
  prescription_id uuid not null references prescriptions (id) on delete cascade,
  slot            int  not null,     -- scheduled minute of the day, or -1 for "any time"
  day             date not null,
  taken_at        timestamptz not null default now(),
  primary key (prescription_id, slot, day),
  constraint dose_logs_slot check (slot between -1 and 1439)
);
create index dose_logs_patient_day_idx on dose_logs (patient_id, day);

-- A patient's own meal plan, set by their doctor. No plan = the app's standard plan.
create table meal_plans (
  patient_id   uuid primary key references patients (id) on delete cascade,
  meals        jsonb not null default '[]',   -- [{ id, name, at, foods, kcal, protein, carbs, fat }]
  target_kcal  int check (target_kcal between 500 and 6000),
  water_goal   int not null default 8 check (water_goal between 1 and 30),
  dietary_note text,
  set_by       uuid references doctors (id),
  updated_at   timestamptz not null default now(),
  constraint meal_plans_note_length check (dietary_note is null or length(dietary_note) <= 1000)
);

create table meal_logs (
  patient_id uuid not null references patients (id) on delete cascade,
  meal_id    text not null,
  day        date not null,
  note       text,
  taken_at   timestamptz not null default now(),
  primary key (patient_id, meal_id, day),
  constraint meal_logs_note_length check (note is null or length(note) <= 500)
);

create table hydration_logs (
  patient_id uuid not null references patients (id) on delete cascade,
  day        date not null,
  glasses    int  not null check (glasses between 0 and 30),
  primary key (patient_id, day)
);


/* ═══ Appointments and availability ═══════════════════════════════════ */

-- The reference a person can quote to support: APT-2026-00042.
create sequence appointment_number_seq;

-- One row from request to outcome; every step is a line in appointment_events.
create table appointments (
  id                 uuid primary key default gen_random_uuid(),
  number             text not null unique
                       default 'APT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('appointment_number_seq')::text, 5, '0'),
  patient_id         uuid not null references patients (id) on delete cascade,
  doctor_id          uuid not null references doctors (id),
  title              text not null check (length(trim(title)) > 0),
  reason             text not null default '',
  preferred_date     date not null,
  preferred_time     time,
  location           text,
  status             appointment_status not null default 'requested',
  approval_note      text,
  rejection_reason   text,
  rescheduled_date   date,
  rescheduled_time   time,
  rescheduled_reason text,
  created_by         uuid references profiles (id),   -- the patient who asked, or the doctor who booked
  alert_id           uuid references alerts (id) on delete set null,   -- the alert a follow-up was booked from
  created_at         timestamptz not null default now(),
  client_ref         uuid,
  constraint appointments_new_time  check (status <> 'rescheduled' or rescheduled_date is not null),
  constraint appointments_rejection check (status <> 'rejected' or length(trim(coalesce(rejection_reason, ''))) > 0)
);
create index appointments_patient_idx on appointments (patient_id);
create index appointments_doctor_idx  on appointments (doctor_id);
create index appointments_when_idx    on appointments (patient_id, preferred_date);
-- An alert has at most one follow-up visit.
create unique index appointments_alert_idx on appointments (alert_id) where alert_id is not null;
create unique index appointments_client_ref_key on appointments (client_ref) where client_ref is not null;

create table appointment_events (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments (id) on delete cascade,
  actor_id       uuid references profiles (id),
  action         text not null,   -- requested | booked | approved | rescheduled | rejected | cancelled | completed | no_show
  detail         text,
  created_at     timestamptz not null default now()
);
create index appointment_events_idx on appointment_events (appointment_id, created_at);

-- The hours a doctor works on each day of the week. Two blocks on one day leave a break between them.
create table doctor_hours (
  id         uuid primary key default gen_random_uuid(),
  doctor_id  uuid not null references doctors (id) on delete cascade,
  weekday    int  not null check (weekday between 0 and 6),   -- 0 = Sunday … 6 = Saturday
  start_time time not null,
  end_time   time not null,
  check (start_time < end_time),
  unique (doctor_id, weekday, start_time)
);
create index doctor_hours_idx on doctor_hours (doctor_id, weekday);

-- Days away (leave, a conference), as date ranges.
create table doctor_time_off (
  id         uuid primary key default gen_random_uuid(),
  doctor_id  uuid not null references doctors (id) on delete cascade,
  from_date  date not null,
  to_date    date not null,
  reason     text check (reason is null or length(reason) <= 200),
  created_at timestamptz not null default now(),
  check (from_date <= to_date)
);
create index doctor_time_off_idx on doctor_time_off (doctor_id, from_date);


/* ═══ Clinical record ═════════════════════════════════════════════════ */

/* Every note the treating doctor writes. Append-only: a correction is a new note
   that `amends` the previous one. Internal notes are the doctor's alone. */
create table clinical_notes (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patients (id) on delete cascade,
  author_id      uuid not null references profiles (id),
  content        text not null check (length(trim(content)) between 1 and 4000),
  visibility     text not null default 'shared'   check (visibility in ('internal', 'shared')),
  note_type      text not null default 'progress' check (note_type in ('progress', 'assessment', 'plan', 'instruction', 'other')),
  appointment_id uuid references appointments (id),   -- the visit it belongs to
  amends         uuid references clinical_notes (id),  -- the note this one corrects
  created_at     timestamptz not null default now(),
  client_ref     uuid
);
create index clinical_notes_patient_idx on clinical_notes (patient_id, created_at desc);
-- A note is corrected once; a further correction amends the correction, so the versions form one line.
create unique index clinical_notes_one_amendment on clinical_notes (amends) where amends is not null;
create unique index clinical_notes_client_ref_key on clinical_notes (client_ref) where client_ref is not null;
create index clinical_notes_appointment_idx on clinical_notes (appointment_id) where appointment_id is not null;

/* A patient may have several plans over time and one active plan at a time.
   draft → active → on hold → completed or cancelled. A closed plan is frozen. */
create table care_plans (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients (id) on delete cascade,
  doctor_id   uuid not null references doctors (id),            -- who wrote it
  title       text not null check (length(trim(title)) between 1 and 120),
  summary     text check (summary is null or length(summary) <= 2000),
  status      text not null default 'draft' check (status in ('draft', 'active', 'on_hold', 'completed', 'cancelled')),
  start_date  date,
  review_date date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles (id) on delete set null,
  closed_at   timestamptz,
  close_note  text check (close_note is null or length(close_note) <= 500),
  check ((status in ('completed', 'cancelled')) = (closed_at is not null))
);
create unique index care_plans_one_active on care_plans (patient_id) where status = 'active';
create index care_plans_patient_idx on care_plans (patient_id, created_at desc);
create index care_plans_doctor_idx on care_plans (doctor_id);

create table care_plan_items (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references care_plans (id) on delete cascade,
  patient_id    uuid not null references patients (id) on delete cascade,
  kind          text not null check (kind in ('goal', 'intervention')),
  text          text not null check (length(trim(text)) between 1 and 500),
  vital_id      text references vital_defs (id),     -- the vital a goal is measured by, when it is
  target_date   date,
  status        text not null default 'open' check (status in ('open', 'achieved', 'dropped')),
  progress_note text check (progress_note is null or length(progress_note) <= 1000),
  position      int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index care_plan_items_plan_idx on care_plan_items (plan_id, position);
create index care_plan_items_patient_idx on care_plan_items (patient_id);

create table care_plan_events (
  id         bigint generated always as identity primary key,
  plan_id    uuid not null references care_plans (id) on delete cascade,
  patient_id uuid not null references patients (id) on delete cascade,
  actor_id   uuid references profiles (id) on delete set null,
  action     text not null,   -- created | edited | active | on_hold | completed | cancelled | item_achieved | item_dropped | item_reopened
  detail     text,
  created_at timestamptz not null default now()
);
create index care_plan_events_idx on care_plan_events (plan_id, created_at);
create index care_plan_events_patient_idx on care_plan_events (patient_id);


/* ═══ Documents ═══════════════════════════════════════════════════════
   A patient opens their own uploads, and official documents once released. The
   treating doctor opens official documents and the uploads the patient shared.
   Staff see that a document exists (the registry), not its content, unless an
   admin opens one for 15 minutes with a stated reason. Released documents are
   never edited or deleted; every step is in document_events. */
create table documents (
  id                uuid primary key default gen_random_uuid(),   -- random, so ids cannot be guessed
  patient_id        uuid not null references patients (id) on delete cascade,
  title             text not null check (length(trim(title)) > 0),
  category          doc_category not null,
  origin            doc_origin   not null,
  description       text,
  document_date     date not null default current_date,
  created_at        timestamptz not null default now(),
  created_by        uuid not null references profiles (id),
  -- the stored file (object-storage path; the bytes never live in the database)
  file_path         text,
  file_name         text,
  file_mime         text,
  file_size         bigint check (file_size is null or file_size between 1 and 20 * 1024 * 1024),
  file_sha256       text,
  upload_state      upload_state,
  upload_error      text,
  upload_attempts   int not null default 0,
  -- generated report content (vitals / lab / prescription)
  body              jsonb,
  links             jsonb not null default '[]',   -- the readings, alerts and notes a report was built from
  -- clinical lifecycle (official documents only)
  status            doc_status,
  signed_by         uuid references doctors (id),
  signed_at         timestamptz,
  signature_image   text,          -- the signer's signature as it was at signing
  released_by       uuid references doctors (id),
  released_at       timestamptz,
  release_on_ready  boolean not null default false,
  -- versions of one report share a series
  series_id         uuid not null,
  version           int  not null default 1,
  supersedes        uuid references documents (id),
  superseded_by     uuid references documents (id),
  correction_reason text,
  visibility        doc_visibility not null default 'care_team',
  deleted_at        timestamptz,
  deleted_by        uuid references profiles (id),
  seen_by_patient   boolean not null default false,
  check ((origin = 'patient_upload') = (status is null)),
  check (origin = 'patient_upload' or visibility = 'care_team')
);
create index documents_patient_idx on documents (patient_id, document_date desc);
create index documents_series_idx on documents (series_id, version);
-- The same file sent twice for one patient is the same record: retries never create duplicates.
create unique index documents_no_duplicate_file on documents (patient_id, file_sha256) where file_sha256 is not null and deleted_at is null;

create table document_events (
  id          bigint generated always as identity primary key,
  document_id uuid not null,   -- no foreign key on purpose: the history outlives a purged document
  patient_id  uuid not null,
  actor_id    uuid references profiles (id) on delete set null,
  actor_label text,       -- for people without an account, e.g. the recipient of a share link
  action      text not null,
  detail      text,
  created_at  timestamptz not null default now()
);
create index document_events_doc_idx on document_events (document_id, created_at desc);

create table share_links (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,     -- only a hash is stored; the link itself is shown once
  patient_id   uuid not null references patients (id) on delete cascade,
  document_ids uuid[] not null check (cardinality(document_ids) > 0),
  recipient    text not null check (length(trim(recipient)) > 0),
  one_time     boolean not null default false,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  opened_count int not null default 0
);
create index share_links_patient_idx on share_links (patient_id);

-- An admin's 15-minute, reasoned access to one document's content. The patient is told.
create table support_grants (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references profiles (id) on delete cascade,
  document_id uuid not null references documents (id) on delete cascade,
  reason      text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index support_grants_lookup on support_grants (admin_id, document_id, expires_at);
create index support_grants_document_idx on support_grants (document_id);

-- A patient asks their doctor for a report; answered once (fulfilled with a document, or declined).
create table report_requests (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patients (id) on delete cascade,
  doctor_id      uuid not null references doctors (id),
  period_days    int  not null check (period_days between 1 and 365),
  reason         text not null default '',
  status         text not null default 'pending' check (status in ('pending', 'fulfilled', 'declined')),
  document_id    uuid references documents (id) on delete set null,
  decline_reason text,
  created_at     timestamptz not null default now(),
  handled_at     timestamptz
);
create index report_requests_patient_idx on report_requests (patient_id, created_at desc);
create index report_requests_doctor_idx  on report_requests (doctor_id) where status = 'pending';


/* ═══ Messages, notifications and delivery ════════════════════════════ */

-- Between a patient and their treating doctor only. Never edited.
create table messages (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null references profiles (id) on delete cascade,
  to_id      uuid not null references profiles (id) on delete cascade,
  content    text not null check (length(trim(content)) > 0),
  read       boolean not null default false,
  created_at timestamptz not null default now(),
  client_ref uuid,
  constraint messages_length check (length(content) <= 4000)
);
create index messages_pair_idx on messages (from_id, to_id, created_at);
create index messages_unread_idx on messages (to_id) where not read;
create unique index messages_client_ref_key on messages (client_ref) where client_ref is not null;

-- Written by the database only, with the change they describe.
create table notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  kind          notif_kind not null,
  title         text not null,
  body          text not null default '',
  link          text,          -- the screen a tap opens
  resource_type text,          -- …and the record on it: 'patient', 'appointment', 'conversation', …
  resource_id   text,
  read          boolean not null default false,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where not read;

-- Each device a person allowed to receive push notifications. Only the owner sees or removes it.
create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references profiles (id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://'),
  p256dh       text not null,
  auth         text not null,
  user_agent   text check (user_agent is null or length(user_agent) <= 300),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);

/* Every notification queued for the channels the person allows (email, SMS, push).
   A sender outside the database claims a batch, sends and reports back; failures are
   retried, then marked failed with the reason. Nobody reaches it through the app. */
create table notification_deliveries (
  id              bigint generated always as identity primary key,
  notification_id uuid references notifications (id) on delete cascade,   -- null for an invitation email (no account yet)
  user_id         uuid references profiles (id) on delete cascade,
  channel         text not null default 'email' check (channel in ('email', 'sms', 'push')),
  subscription_id uuid references push_subscriptions (id) on delete cascade,   -- the device, for push
  to_address      text not null,
  subject         text not null,
  body            text not null,
  link            text,
  urgent          boolean not null default false,
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts        int not null default 0,
  error           text,
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  constraint notification_deliveries_push_target check ((channel = 'push') = (subscription_id is not null))
);
create index notification_deliveries_queue_idx on notification_deliveries (created_at) where status in ('queued', 'sending');
create index notification_deliveries_report_idx on notification_deliveries (created_at, channel, status);
create index notification_deliveries_notification_idx on notification_deliveries (notification_id) where notification_id is not null;
create index notification_deliveries_user_idx on notification_deliveries (user_id) where user_id is not null;
create index notification_deliveries_subscription_idx on notification_deliveries (subscription_id) where subscription_id is not null;


/* ═══ Support, audit and synchronisation ══════════════════════════════ */

create table support_tickets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles (id) on delete cascade,
  subject         text not null check (length(trim(subject)) > 0),
  message         text not null default '',
  status          text not null default 'open' check (status in ('open', 'resolved')),
  created_at      timestamptz not null default now(),
  resolved_by     uuid references profiles (id),
  resolution_note text,
  resolved_at     timestamptz
);
create index support_tickets_user_idx on support_tickets (user_id, created_at desc);

/* Written by the database only, in the same transaction as the change. `action`
   and `detail` are the sentence a person reads; the other columns let a screen
   filter by record or patient and show what changed. patient_id has no foreign
   key on purpose: the trail is append-only and must outlive a removed record. */
create table audit_log (
  id            bigint generated always as identity primary key,
  actor_id      uuid references profiles (id) on delete set null,
  actor_role    user_role,       -- stamped by the database
  action        text not null,
  detail        text not null default '',
  resource_type text,            -- 'patient' | 'appointment' | 'prescription' | 'staff' | …
  resource_id   text,
  patient_id    uuid,
  before_state  jsonb,
  after_state   jsonb,
  created_at    timestamptz not null default now()
);
create index audit_log_time_idx    on audit_log (created_at desc);
create index audit_log_actor_idx   on audit_log (actor_id, created_at desc);
create index audit_log_patient_idx on audit_log (patient_id, created_at desc) where patient_id is not null;

/* Change counters: they say only THAT something changed, never what. An open
   screen compares my_change_token() and reloads; on hosted Supabase they are
   also published for Realtime. */
create table patient_changes (
  patient_id uuid primary key references patients (id) on delete cascade,
  version    bigint not null default 1,
  changed_at timestamptz not null default now()
);

create table system_changes (
  topic      text primary key,     -- 'people' | 'settings'
  version    bigint not null default 1,
  changed_at timestamptz not null default now()
);

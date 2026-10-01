-- mCare core schema (Supabase / Postgres).
--
-- People, the patient record, vitals, alerts, medication, appointments,
-- messages and notifications. Every table has row-level security: the
-- database itself decides who may read or change each row, so no screen has
-- to be trusted. Rules mirror the prototype:
--   • a patient sees and edits only their own record
--   • a doctor sees only patients assigned to them
--   • admins see everything; assistants only what their permissions allow
--   • alerts are raised by the database when a reading is saved, never by the browser


/* ─── Types ────────────────────────────────────────────────────────── */
create type user_role          as enum ('patient', 'doctor', 'admin', 'assistant');
create type account_status     as enum ('unverified', 'pending_approval', 'active', 'suspended');
create type approval_status    as enum ('pending', 'approved', 'sent_back', 'rejected');
create type vital_level        as enum ('normal', 'warning', 'critical');
create type alert_type         as enum ('vital', 'sos');
create type alert_severity     as enum ('danger', 'warning');
create type alert_status       as enum ('open', 'acknowledged', 'escalated', 'resolved');
create type request_status     as enum ('pending', 'approved', 'rejected');
create type appointment_status as enum ('requested', 'approved', 'rejected', 'rescheduled', 'completed', 'cancelled');
create type notif_kind         as enum ('alert', 'sos', 'message', 'appointment', 'assignment', 'prescription', 'account', 'escalation', 'document');

/* ─── People ───────────────────────────────────────────────────────── */
-- One row per account. Passwords live in Supabase Auth (auth.users), never here.
create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        user_role      not null default 'patient',
  status      account_status not null default 'active',
  full_name   text not null check (length(trim(full_name)) > 0),
  email       text not null,
  phone       text not null default '',
  dob         date,
  avatar      jsonb,
  theme       text check (theme in ('light', 'dark', 'auto')),
  font_size   text check (font_size in ('sm', 'md', 'lg')),
  created_at  timestamptz not null default now()
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
  signature       text   -- handwritten signature (PNG data URL) stamped onto reports at signing
);

create table staff (
  id           uuid primary key references profiles (id) on delete cascade,
  is_assistant boolean not null default false,
  permissions  text[]  not null default '{}'
);

create table patients (
  id                   uuid primary key references profiles (id) on delete cascade,
  assigned_doctor_id   uuid references doctors (id) on delete set null,
  profile_setup        text not null default 'pending' check (profile_setup in ('pending', 'done')),
  sex                  text check (sex in ('female', 'male', 'intersex', 'undisclosed')),
  blood_type           text check (blood_type in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  no_known_allergies   boolean not null default false,
  no_conditions        boolean not null default false,
  other_medicines      text,
  doctor_note          text,     -- latest note from the treating doctor, shown to the patient
  docs_private_default boolean not null default false
);
create index patients_doctor_idx on patients (assigned_doctor_id);

create table allergies (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients (id) on delete cascade,
  substance  text not null,
  severity   text not null check (severity in ('mild', 'moderate', 'severe')),
  reaction   text
);
create index allergies_patient_idx on allergies (patient_id);

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
  created_at   timestamptz not null default now()
);
-- At most one next of kin per patient.
create unique index emergency_contacts_one_kin on emergency_contacts (patient_id) where next_of_kin;

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
-- One open request per patient.
create unique index doctor_requests_one_pending on doctor_requests (patient_id) where status = 'pending';

/* ─── Vitals ───────────────────────────────────────────────────────── */
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
  hard_min         numeric not null,
  hard_max         numeric not null,
  dia_normal_min   numeric,
  dia_normal_max   numeric,
  dia_critical_min numeric,
  dia_critical_max numeric,
  unit_options     text[]
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
  check (target_min < target_max)
);

create table readings (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patients (id) on delete cascade,
  vital_id       text not null references vital_defs (id),
  value          text not null,          -- as entered, canonical unit: "124/82" or "72"
  primary_value  numeric not null,       -- filled by trigger (systolic for blood pressure)
  secondary_value numeric,               -- diastolic
  level          vital_level not null default 'normal',   -- filled by trigger
  note           text,
  invalid        boolean not null default false,
  invalid_reason text,
  taken_at       timestamptz not null default now()
);
create index readings_patient_vital_idx on readings (patient_id, vital_id, taken_at desc);

create table alerts (
  id                   uuid primary key default gen_random_uuid(),
  patient_id           uuid not null references patients (id) on delete cascade,
  type                 alert_type     not null default 'vital',
  severity             alert_severity not null,
  status               alert_status   not null default 'open',
  vital_id             text references vital_defs (id),
  reading_id           uuid references readings (id) on delete set null,
  value                text not null,
  unit                 text not null default '',
  created_at           timestamptz not null default now(),
  acknowledged_at      timestamptz,
  acknowledged_by      uuid references profiles (id),
  escalated_at         timestamptz,
  recheck_requested_at timestamptz,
  resolved_at          timestamptz,
  resolved_by          uuid references profiles (id),
  resolution_reason    text,
  resolution_note      text
);
create index alerts_patient_idx on alerts (patient_id, created_at desc);
create index alerts_open_idx on alerts (status) where status <> 'resolved';

/* ─── Medication & meals ───────────────────────────────────────────── */
create table prescriptions (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients (id) on delete cascade,
  doctor_id     uuid not null references doctors (id),
  medication    text not null,
  dosage        text not null,
  frequency     text not null,
  purpose       text not null default '',
  active        boolean not null default true,
  prescribed_at timestamptz not null default now()
);
create index prescriptions_patient_idx on prescriptions (patient_id);

create table dose_logs (
  patient_id      uuid not null references patients (id) on delete cascade,
  prescription_id uuid not null references prescriptions (id) on delete cascade,
  slot            int  not null,     -- scheduled minute of the day, or -1 for "any time"
  day             date not null,
  taken_at        timestamptz not null default now(),
  primary key (prescription_id, slot, day)
);

create table meal_logs (
  patient_id uuid not null references patients (id) on delete cascade,
  meal_id    text not null,
  day        date not null,
  note       text,
  taken_at   timestamptz not null default now(),
  primary key (patient_id, meal_id, day)
);

/* ─── Appointments, messages, notifications, audit ─────────────────── */
create table appointments (
  id                 uuid primary key default gen_random_uuid(),
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
  created_at         timestamptz not null default now()
);
create index appointments_patient_idx on appointments (patient_id);
create index appointments_doctor_idx on appointments (doctor_id);

create table messages (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null references profiles (id) on delete cascade,
  to_id      uuid not null references profiles (id) on delete cascade,
  content    text not null check (length(trim(content)) > 0),
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index messages_pair_idx on messages (from_id, to_id, created_at);

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  kind       notif_kind not null,
  title      text not null,
  body       text not null default '',
  link       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);

create table audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references profiles (id) on delete set null,
  action     text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);

/* ─── Who is asking? ───────────────────────────────────────────────────
   Helper functions used by the access rules. SECURITY DEFINER so they can
   look up the caller without being blocked by the very rules they serve. */
create function my_role() returns user_role language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and status <> 'suspended' $$;

create function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'admin' from profiles where id = auth.uid() and status = 'active'), false) $$;

/** Admin, or an active assistant holding this permission. */
create function staff_can(perm text) returns boolean language sql stable security definer set search_path = public as
$$ select is_admin() or exists (
     select 1 from profiles p join staff s on s.id = p.id
     where p.id = auth.uid() and p.status = 'active' and p.role = 'assistant' and perm = any (s.permissions)) $$;

/** The caller is the approved, active doctor assigned to this patient. */
create function treats(patient uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from patients pt join doctors d on d.id = pt.assigned_doctor_id join profiles p on p.id = d.id
     where pt.id = patient and d.id = auth.uid() and d.approval_status = 'approved' and p.status = 'active') $$;

/** Patient themself, their treating doctor, or staff who monitor patients. */
create function can_see_patient(patient uuid) returns boolean language sql stable security definer set search_path = public as
$$ select patient = auth.uid() or treats(patient) or staff_can('monitor_patients') $$;

create function notify_user(to_user uuid, k notif_kind, t text, b text, l text default null) returns void
language sql security definer set search_path = public as
$$ insert into notifications (user_id, kind, title, body, link) values (to_user, k, t, b, l) $$;

/** Everyone who must hear about an alert: the treating doctor, admins, and assistants who monitor patients. */
create function notify_care_team(patient uuid, k notif_kind, t text, b text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, kind, title, body, link)
  select u.id, k, t, b, 'alerts' from (
    select assigned_doctor_id as id from patients where id = patient and assigned_doctor_id is not null
    union
    select p.id from profiles p left join staff s on s.id = p.id
    where p.status = 'active' and (p.role = 'admin' or (p.role = 'assistant' and 'monitor_patients' = any (s.permissions)))
  ) u;
end $$;

/* ─── New accounts ─────────────────────────────────────────────────────
   Supabase Auth creates auth.users; this creates the mCare profile beside
   it. A sign-up can only ever become a patient, or a doctor awaiting
   approval — admin and assistant accounts are created by an admin. */
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare
  wants_doctor boolean := coalesce(new.raw_user_meta_data ->> 'role', '') = 'doctor';
begin
  insert into profiles (id, role, status, full_name, email, phone, dob)
  values (new.id,
          case when wants_doctor then 'doctor' else 'patient' end::user_role,
          case when wants_doctor then 'pending_approval' else 'active' end::account_status,
          coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
          new.email,
          coalesce(new.raw_user_meta_data ->> 'phone', ''),
          nullif(new.raw_user_meta_data ->> 'dob', '')::date);
  if wants_doctor then
    insert into doctors (id) values (new.id);
  else
    insert into patients (id) values (new.id);
    insert into tracked_vitals (patient_id, vital_id) select new.id, id from vital_defs where id in ('bp', 'hr');
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

/* ─── Protected fields ─────────────────────────────────────────────────
   Row rules decide WHICH rows; these triggers decide which COLUMNS a
   person may change on a row they can reach. */
create function guard_profile() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or is_admin() then return new; end if;   -- service role / admin
  if new.role is distinct from old.role or new.status is distinct from old.status or new.email is distinct from old.email then
    raise exception 'You cannot change role, status or email' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_profile before update on profiles for each row execute function guard_profile();

create function guard_patient() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if new.assigned_doctor_id is distinct from old.assigned_doctor_id and not staff_can('assign_healthworkers') then
    raise exception 'Only the care coordination team can assign a doctor' using errcode = '42501';
  end if;
  if new.doctor_note is distinct from old.doctor_note and not treats(old.id) then
    raise exception 'Only the treating doctor can write the doctor''s note' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_patient before update on patients for each row execute function guard_patient();

create function guard_doctor() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or staff_can('approve_doctors') then return new; end if;
  if new.approval_status is distinct from old.approval_status or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at or new.approval_note is distinct from old.approval_note then
    raise exception 'Only an approver can change approval' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_doctor before update on doctors for each row execute function guard_doctor();

-- A patient can cancel, or accept the new time the doctor proposed — never approve their own request.
create function guard_appointment() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or auth.uid() <> old.patient_id then return new; end if;
  if new.patient_id <> old.patient_id or new.doctor_id <> old.doctor_id
     or new.approval_note is distinct from old.approval_note or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'You cannot change that part of an appointment' using errcode = '42501';
  end if;
  if new.status <> old.status and not (new.status = 'cancelled' or (old.status = 'rescheduled' and new.status = 'approved')) then
    raise exception 'Only your doctor can confirm an appointment' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_appointment before update on appointments for each row execute function guard_appointment();

/* ─── Readings: validate, grade, and raise alerts ──────────────────────
   Runs in the database on every saved reading, so it works even if the
   app is closed and cannot be skipped by a modified client. */
create function grade(n numeric, tmin numeric, tmax numeric, cmin numeric, cmax numeric) returns vital_level
language sql immutable as
$$ select case when n <= cmin or n >= cmax then 'critical' when n < tmin or n > tmax then 'warning' else 'normal' end::vital_level $$;

create function grade_reading(patient uuid, vital text, prim numeric, sec numeric) returns vital_level
language plpgsql stable security definer set search_path = public as $$
declare
  d vital_defs; t thresholds; span numeric; lvl vital_level; dia vital_level;
begin
  select * into d from vital_defs where id = vital;
  select * into t from thresholds where patient_id = patient and vital_id = vital;
  span := d.normal_max - d.normal_min;
  lvl := grade(prim,
    coalesce(t.target_min, d.normal_min), coalesce(t.target_max, d.normal_max),
    coalesce(t.critical_min, d.critical_min, d.normal_min - span * 0.25),
    coalesce(t.critical_max, d.critical_max, d.normal_max + span * 0.25));
  if vital = 'bp' and sec is not null then
    dia := grade(sec, coalesce(d.dia_normal_min, 60), coalesce(d.dia_normal_max, 90),
                      coalesce(d.dia_critical_min, 40), coalesce(d.dia_critical_max, 120));
    if dia > lvl then lvl := dia; end if;   -- enum order: normal < warning < critical
  end if;
  return lvl;
end $$;

create function reading_before() returns trigger language plpgsql security definer set search_path = public as $$
declare
  d vital_defs; m text[];
begin
  select * into d from vital_defs where id = new.vital_id;
  if tg_op = 'UPDATE' then
    if new.patient_id <> old.patient_id or new.vital_id <> old.vital_id or new.taken_at <> old.taken_at then
      raise exception 'A reading cannot be moved' using errcode = '42501';
    end if;
    -- The patient may correct a typo for 15 minutes; after that only the treating doctor can mark it invalid.
    if new.value <> old.value and auth.uid() = old.patient_id and now() - old.taken_at > interval '15 minutes' then
      raise exception 'Readings can only be corrected within 15 minutes' using errcode = '42501';
    end if;
    if (new.invalid <> old.invalid or new.invalid_reason is distinct from old.invalid_reason)
       and auth.uid() is not null and not treats(old.patient_id) then
      raise exception 'Only the treating doctor can mark a reading invalid' using errcode = '42501';
    end if;
  else
    new.taken_at := now();   -- the server's clock, not the phone's
  end if;

  new.value := trim(new.value);
  if new.vital_id = 'bp' then
    m := regexp_match(new.value, '^(\d{2,3})\s*/\s*(\d{2,3})$');
    if m is null then raise exception 'Use the format 120/80' using errcode = '22023'; end if;
    new.primary_value := m[1]::numeric; new.secondary_value := m[2]::numeric;
    if new.secondary_value < 30 or new.secondary_value > 150 or new.secondary_value >= new.primary_value then
      raise exception 'That blood pressure does not look right' using errcode = '22023';
    end if;
  else
    if new.value !~ '^-?\d+(\.\d+)?$' then raise exception 'Enter a number' using errcode = '22023'; end if;
    new.primary_value := new.value::numeric; new.secondary_value := null;
  end if;
  if new.primary_value < d.hard_min or new.primary_value > d.hard_max then
    raise exception '% is usually between % and % %', d.name, d.hard_min, d.hard_max, d.unit using errcode = '22023';
  end if;
  new.level := grade_reading(new.patient_id, new.vital_id, new.primary_value, new.secondary_value);
  return new;
end $$;
create trigger reading_before before insert or update on readings for each row execute function reading_before();

create function reading_after_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare
  d vital_defs; who text; a alerts; prev vital_level;
begin
  select * into d from vital_defs where id = new.vital_id;
  select full_name into who from profiles where id = new.patient_id;

  if new.level = 'normal' then
    -- A doctor asked for a re-check: an in-range reading resolves it.
    select * into a from alerts where patient_id = new.patient_id and vital_id = new.vital_id
      and status <> 'resolved' and recheck_requested_at is not null order by created_at desc limit 1;
    if found then
      update alerts set status = 'resolved', value = new.value, resolved_at = now(), resolved_by = new.patient_id,
        resolution_reason = 'Contacted patient, condition stable' where id = a.id;
      perform notify_user(new.patient_id, 'alert', 'Alert resolved', d.name || ': new reading is back in range', 'alerts');
      return new;
    end if;
    -- Self-clear: an untouched warning, re-measured in range within 30 minutes. Critical alerts always get a clinician.
    select * into a from alerts where patient_id = new.patient_id and vital_id = new.vital_id and type = 'vital'
      and severity = 'warning' and status = 'open' and created_at > now() - interval '30 minutes'
      order by created_at desc limit 1;
    if found then
      update alerts set status = 'resolved', value = new.value, resolved_at = now(), resolved_by = new.patient_id,
        resolution_reason = 'Re-measured in range by patient' where id = a.id;
      perform notify_user(new.patient_id, 'alert', 'Alert cleared', d.name || ': your new reading is back in range', 'alerts');
      perform notify_care_team(new.patient_id, 'alert', 'Alert cleared: ' || who,
        d.name || ' re-measured at ' || new.value || ' ' || d.unit || ' — back in range');
    end if;
    return new;
  end if;

  if new.level = 'warning' then
    -- Ask the patient to re-measure first: alert only if the previous reading in the last hour was abnormal too.
    select level into prev from readings where patient_id = new.patient_id and vital_id = new.vital_id and not invalid
      and id <> new.id and taken_at > now() - interval '60 minutes' order by taken_at desc limit 1;
    if prev is null or prev = 'normal' then return new; end if;
  end if;

  insert into alerts (patient_id, type, severity, vital_id, reading_id, value, unit)
  values (new.patient_id, 'vital', case when new.level = 'critical' then 'danger' else 'warning' end::alert_severity,
          new.vital_id, new.id, new.value, d.unit);
  perform notify_care_team(new.patient_id, 'alert',
    case when new.level = 'critical' then 'Critical: ' else 'Alert: ' end || who, d.name || ' ' || new.value || ' ' || d.unit);
  return new;
end $$;
create trigger reading_after_insert after insert on readings for each row execute function reading_after_insert();

-- A corrected reading re-grades its alert: back in range resolves it, otherwise the severity follows.
create function reading_after_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.value = old.value then return new; end if;
  if new.level = 'normal' then
    update alerts set status = 'resolved', value = new.value, resolved_at = now(), resolved_by = new.patient_id,
      resolution_reason = 'Corrected by patient' where reading_id = new.id and status <> 'resolved';
  else
    update alerts set value = new.value, severity = case when new.level = 'critical' then 'danger' else 'warning' end::alert_severity
      where reading_id = new.id and status <> 'resolved';
  end if;
  return new;
end $$;
create trigger reading_after_update after update on readings for each row execute function reading_after_update();

/* ─── Actions the app calls (RPC) ──────────────────────────────────── */
/** Patient presses SOS. */
create function raise_sos(message text default '') returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid; who text; body text := coalesce(nullif(trim(message), ''), 'Emergency help requested');
begin
  if my_role() is distinct from 'patient' then raise exception 'Only a patient can raise an SOS' using errcode = '42501'; end if;
  select full_name into who from profiles where id = auth.uid();
  insert into alerts (patient_id, type, severity, value) values (auth.uid(), 'sos', 'danger', body) returning id into aid;
  perform notify_care_team(auth.uid(), 'sos', 'SOS: ' || who, body);
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'SOS raised', who);
  return aid;
end $$;

/** Patient marks themself safe: cancels their own open SOS. */
create function cancel_sos(alert uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_reason = 'Patient marked safe'
  where id = alert and patient_id = auth.uid() and type = 'sos' and status <> 'resolved';
  if not found then raise exception 'Nothing to cancel' using errcode = '42501'; end if;
end $$;

/** Patient asks for a doctor; the people who can approve are told. */
create function request_doctor(doctor uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid; who text; doc text;
begin
  if my_role() is distinct from 'patient' then raise exception 'Only a patient can request a doctor' using errcode = '42501'; end if;
  select p.full_name into doc from doctors d join profiles p on p.id = d.id
    where d.id = doctor and d.approval_status = 'approved' and p.status = 'active';
  if doc is null then raise exception 'That doctor is not available' using errcode = '22023'; end if;
  select full_name into who from profiles where id = auth.uid();
  update doctor_requests set status = 'rejected', response_note = 'Replaced by a newer request', decided_at = now()
    where patient_id = auth.uid() and status = 'pending';
  insert into doctor_requests (patient_id, doctor_id) values (auth.uid(), doctor) returning id into rid;
  insert into notifications (user_id, kind, title, body, link)
  select p.id, 'assignment', 'Doctor request: ' || who, 'Requested ' || doc, 'assign'
  from profiles p left join staff s on s.id = p.id
  where p.status = 'active' and (p.role = 'admin' or (p.role = 'assistant' and 'approve_patient_requests' = any (s.permissions)));
  return rid;
end $$;

/** Runs on a schedule (pg_cron, every minute): critical alerts nobody acknowledged in 10 minutes go up to the care team. */
create function escalate_stale_alerts() returns int language plpgsql security definer set search_path = public as $$
declare a record; n int := 0;
begin
  for a in update alerts set status = 'escalated', escalated_at = now()
           where status = 'open' and severity = 'danger' and created_at < now() - interval '10 minutes'
           returning id, patient_id, type, value, unit, vital_id loop
    insert into notifications (user_id, kind, title, body, link)
    select p.id, 'escalation', 'Escalated: ' || (select full_name from profiles where id = a.patient_id),
           case when a.type = 'sos' then 'SOS' else coalesce((select name from vital_defs where id = a.vital_id), '') || ' ' || a.value || ' ' || a.unit end
             || ' not acknowledged within 10 min', 'alerts'
    from profiles p left join staff s on s.id = p.id
    where p.status = 'active' and (p.role = 'admin' or (p.role = 'assistant' and 'monitor_patients' = any (s.permissions)));
    n := n + 1;
  end loop;
  return n;
end $$;
-- Internal only. Supabase grants new functions to app users by default, so take that back explicitly.
revoke execute on function escalate_stale_alerts() from public, anon, authenticated;
revoke execute on function notify_user(uuid, notif_kind, text, text, text) from public, anon, authenticated;
revoke execute on function notify_care_team(uuid, notif_kind, text, text) from public, anon, authenticated;

/* ─── Access rules (row-level security) ────────────────────────────── */
alter table profiles           enable row level security;
alter table doctors            enable row level security;
alter table staff              enable row level security;
alter table patients           enable row level security;
alter table allergies          enable row level security;
alter table conditions         enable row level security;
alter table emergency_contacts enable row level security;
alter table doctor_requests    enable row level security;
alter table vital_defs         enable row level security;
alter table tracked_vitals     enable row level security;
alter table thresholds         enable row level security;
alter table readings           enable row level security;
alter table alerts             enable row level security;
alter table prescriptions      enable row level security;
alter table dose_logs          enable row level security;
alter table meal_logs          enable row level security;
alter table appointments       enable row level security;
alter table messages           enable row level security;
alter table notifications      enable row level security;
alter table audit_log          enable row level security;

-- profiles: yourself; your patients; your own doctor and the approved-doctor directory; staff see all.
create policy profiles_read on profiles for select to authenticated using (
  id = auth.uid()
  or treats(id)
  or (role = 'doctor' and status = 'active' and exists (select 1 from doctors d where d.id = profiles.id and d.approval_status = 'approved'))
  or my_role() in ('admin', 'assistant'));
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());

-- doctors: the approved directory is visible to signed-in users; a doctor sees their own row; approvers see all.
create policy doctors_read on doctors for select to authenticated using (
  approval_status = 'approved' or id = auth.uid() or staff_can('approve_doctors') or my_role() = 'admin');
create policy doctors_update on doctors for update to authenticated
  using (id = auth.uid() or staff_can('approve_doctors')) with check (id = auth.uid() or staff_can('approve_doctors'));

create policy staff_read on staff for select to authenticated using (id = auth.uid() or is_admin());
create policy staff_write on staff for all to authenticated using (is_admin()) with check (is_admin());

-- patients and everything hanging off a patient.
create policy patients_read on patients for select to authenticated using (
  can_see_patient(id) or staff_can('assign_healthworkers') or staff_can('approve_patient_requests'));
create policy patients_update on patients for update to authenticated
  using (id = auth.uid() or treats(id) or staff_can('assign_healthworkers'))
  with check (id = auth.uid() or treats(id) or staff_can('assign_healthworkers'));

create policy allergies_read on allergies for select to authenticated using (can_see_patient(patient_id));
create policy allergies_write on allergies for all to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());

create policy conditions_read on conditions for select to authenticated using (can_see_patient(patient_id));
create policy conditions_write on conditions for all to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());

create policy contacts_read on emergency_contacts for select to authenticated using (can_see_patient(patient_id));
create policy contacts_write on emergency_contacts for all to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());

-- Requests are created through request_doctor(); approvers decide them.
create policy doctor_requests_read on doctor_requests for select to authenticated using (
  patient_id = auth.uid() or staff_can('approve_patient_requests'));
create policy doctor_requests_decide on doctor_requests for update to authenticated
  using (staff_can('approve_patient_requests')) with check (staff_can('approve_patient_requests'));

create policy vital_defs_read on vital_defs for select to authenticated using (true);
create policy vital_defs_write on vital_defs for all to authenticated using (is_admin()) with check (is_admin());

create policy tracked_read on tracked_vitals for select to authenticated using (can_see_patient(patient_id));
create policy tracked_add on tracked_vitals for insert to authenticated with check (patient_id = auth.uid() or treats(patient_id));
-- A patient cannot drop a vital their doctor set targets for; with a doctor assigned, only the doctor removes vitals.
create policy tracked_remove on tracked_vitals for delete to authenticated using (
  treats(patient_id)
  or (patient_id = auth.uid()
      and not exists (select 1 from thresholds t where t.patient_id = tracked_vitals.patient_id and t.vital_id = tracked_vitals.vital_id)
      and not exists (select 1 from patients p where p.id = tracked_vitals.patient_id and p.assigned_doctor_id is not null)));

create policy thresholds_read on thresholds for select to authenticated using (can_see_patient(patient_id));
create policy thresholds_write on thresholds for all to authenticated using (treats(patient_id)) with check (treats(patient_id));

create policy readings_read on readings for select to authenticated using (can_see_patient(patient_id));
create policy readings_add on readings for insert to authenticated with check (patient_id = auth.uid());
create policy readings_update on readings for update to authenticated
  using (patient_id = auth.uid() or treats(patient_id)) with check (patient_id = auth.uid() or treats(patient_id));

-- Alerts are created only by the database (reading trigger, raise_sos). The care team works them.
create policy alerts_read on alerts for select to authenticated using (can_see_patient(patient_id));
create policy alerts_work on alerts for update to authenticated
  using (treats(patient_id) or staff_can('monitor_patients')) with check (treats(patient_id) or staff_can('monitor_patients'));

create policy rx_read on prescriptions for select to authenticated using (can_see_patient(patient_id));
create policy rx_write on prescriptions for all to authenticated
  using (treats(patient_id)) with check (treats(patient_id) and doctor_id = auth.uid());

create policy doses_read on dose_logs for select to authenticated using (can_see_patient(patient_id));
create policy doses_write on dose_logs for all to authenticated using (patient_id = auth.uid()) with check (
  patient_id = auth.uid() and exists (select 1 from prescriptions rx where rx.id = prescription_id and rx.patient_id = auth.uid()));

create policy meals_read on meal_logs for select to authenticated using (can_see_patient(patient_id));
create policy meals_write on meal_logs for all to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());

-- Appointments: the patient asks; the doctor it is with answers.
create policy appts_read on appointments for select to authenticated using (
  patient_id = auth.uid() or doctor_id = auth.uid() or my_role() = 'admin');
create policy appts_request on appointments for insert to authenticated with check (
  patient_id = auth.uid() and status = 'requested'
  and exists (select 1 from doctors d join profiles p on p.id = d.id where d.id = doctor_id and d.approval_status = 'approved' and p.status = 'active'));
create policy appts_update on appointments for update to authenticated
  using (patient_id = auth.uid() or doctor_id = auth.uid()) with check (patient_id = auth.uid() or doctor_id = auth.uid());

-- Messages: only between a patient and their treating doctor, and only the two of them can read them.
create policy messages_read on messages for select to authenticated using (from_id = auth.uid() or to_id = auth.uid());
create policy messages_send on messages for insert to authenticated with check (
  from_id = auth.uid() and (treats(to_id) or exists (select 1 from patients p where p.id = auth.uid() and p.assigned_doctor_id = to_id)));
create policy messages_mark_read on messages for update to authenticated using (to_id = auth.uid()) with check (to_id = auth.uid());

create policy notifications_read on notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy audit_read on audit_log for select to authenticated using (staff_can('view_logs'));
create policy audit_add on audit_log for insert to authenticated with check (actor_id = auth.uid());

/* ─── Vital definitions (same defaults as the prototype) ───────────── */
insert into vital_defs (id, name, unit, icon, active, normal_min, normal_max, critical_min, critical_max, hard_min, hard_max,
                        dia_normal_min, dia_normal_max, dia_critical_min, dia_critical_max, unit_options) values
  ('bp',   'Blood Pressure',   'mmHg',  '🫀', true,  90, 130, 80, 180, 50, 260, 60, 90, 40, 120, null),
  ('hr',   'Heart Rate',       'bpm',   '💓', true,  60, 100, 40, 130, 20, 250, null, null, null, null, null),
  ('gluc', 'Blood Glucose',    'mg/dL', '🩸', true,  70, 140, 54, 250, 20, 600, null, null, null, null, '{mg/dL,mmol/L}'),
  ('temp', 'Temperature',      '°F',    '🌡️', true,  97, 99,  95, 103, 86, 110, null, null, null, null, '{°F,°C}'),
  ('spo2', 'SpO₂',             '%',     '🫁', true,  95, 100, 90, 101, 50, 100, null, null, null, null, null),
  ('wt',   'Weight',           'kg',    '⚖️', true,  40, 150, 30, 200, 2,  350, null, null, null, null, '{kg,lb}'),
  ('ht',   'Height',           'cm',    '📏', false, 50, 250, 30, 280, 20, 300, null, null, null, null, '{cm,in}'),
  ('rr',   'Respiratory Rate', '/min',  '🌬️', false, 12, 20,  8,  30,  4,  60,  null, null, null, null, null),
  ('chol', 'Cholesterol',      'mg/dL', '🧪', false, 0,  200, -1, 300, 50, 600, null, null, null, null, null);

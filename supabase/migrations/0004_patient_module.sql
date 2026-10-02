-- mCare patient module: what the patient portal needs to run on real data.
--
-- The first three migrations created the record and its access rules. This one
-- adds the pieces the prototype kept only in the browser, and moves the rules
-- that protect patients into the database so no screen can skip them:
--   • who recorded a reading, and what it said before a correction
--   • alerts change only through defined steps; a resolved alert is never edited
--   • a critical alert is closed by a clinician, never by a number alone
--   • clinical notes, target changes, consent and ratings are kept as rows, with history
--   • notifications and the audit trail are written by the database, in the same
--     transaction as the change they describe
--
-- Triggers are used where they guard integrity or must not be skippable
-- (grading, alerts, notifications, audit). Multi-step saves the app performs
-- are functions, so each one is a single transaction.


/* ─── Columns ──────────────────────────────────────────────────────── */
alter table patients add column unit_prefs jsonb not null default '{}'
  check (jsonb_typeof(unit_prefs) = 'object' and length(unit_prefs::text) <= 2000);

alter table profiles add constraint profiles_name_length  check (length(full_name) <= 120);
alter table profiles add constraint profiles_phone_length check (length(phone) <= 32);

alter table readings add column recorded_by    uuid references profiles (id) on delete set null;   -- the patient, or the treating doctor
alter table readings add column corrected_from text;          -- what was first saved, kept when a typo is corrected
alter table readings add column corrected_at   timestamptz;
alter table readings add constraint readings_note_length check (note is null or length(note) <= 500);
update readings set recorded_by = patient_id where recorded_by is null;

alter table alerts add column recheck_requested_by uuid references profiles (id);
alter table alerts add column recheck_reading_id   uuid references readings (id) on delete set null;   -- the reading logged in answer to a re-check
alter table alerts add constraint alerts_resolved_complete check ((status = 'resolved') = (resolved_at is not null));
alter table alerts add constraint alerts_resolution_reason check (status <> 'resolved' or length(trim(coalesce(resolution_reason, ''))) > 0);
alter table alerts add constraint alerts_vital_named       check (type = 'sos' or vital_id is not null);
-- One alert per reading, however many times the app asks.
create unique index alerts_one_per_reading on alerts (reading_id) where reading_id is not null;

alter table prescriptions add column stopped_at timestamptz;
alter table prescriptions add column stopped_by uuid references profiles (id);
alter table prescriptions add constraint prescriptions_filled check (
  length(trim(medication)) > 0 and length(trim(dosage)) > 0 and length(trim(frequency)) > 0);
alter table dose_logs add constraint dose_logs_slot check (slot between -1 and 1439);
alter table meal_logs add constraint meal_logs_note_length check (note is null or length(note) <= 500);

alter table appointments add column created_by uuid references profiles (id);   -- the patient who asked, or the doctor who booked a follow-up
alter table appointments add constraint appointments_new_time check (status <> 'rescheduled' or rescheduled_date is not null);
alter table appointments add constraint appointments_rejection check (status <> 'rejected' or length(trim(coalesce(rejection_reason, ''))) > 0);

alter table messages add constraint messages_length check (length(content) <= 4000);
alter table emergency_contacts add constraint emergency_contacts_filled check (length(trim(name)) > 0 and length(regexp_replace(phone, '\D', '', 'g')) >= 7);
alter table allergies add constraint allergies_filled check (length(trim(substance)) > 0);
create unique index allergies_once on allergies (patient_id, lower(substance));
alter table thresholds add constraint thresholds_critical_order check (critical_min is null or critical_max is null or critical_min < critical_max);

/* ─── Indexes for the queries the portals run ──────────────────────── */
create index readings_patient_time_idx  on readings (patient_id, taken_at desc);
create index dose_logs_patient_day_idx  on dose_logs (patient_id, day);
create index appointments_when_idx      on appointments (patient_id, preferred_date);
create index messages_unread_idx        on messages (to_id) where not read;
create index notifications_unread_idx   on notifications (user_id) where not read;
create index doctor_requests_patient_idx on doctor_requests (patient_id, requested_at desc);
create index emergency_contacts_patient_idx on emergency_contacts (patient_id);
create index report_requests_patient_idx on report_requests (patient_id, created_at desc);
create index report_requests_doctor_idx  on report_requests (doctor_id) where status = 'pending';
create index support_tickets_user_idx   on support_tickets (user_id, created_at desc);
create index share_links_patient_idx    on share_links (patient_id);
create index audit_log_time_idx         on audit_log (created_at desc);

/* ─── New tables ───────────────────────────────────────────────────── */
-- Every note the treating doctor writes for a patient. patients.doctor_note is always the newest one.
create table clinical_notes (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients (id) on delete cascade,
  author_id  uuid not null references profiles (id),
  content    text not null check (length(trim(content)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index clinical_notes_patient_idx on clinical_notes (patient_id, created_at desc);

-- When a doctor changed a patient's target for a vital, and from what.
create table threshold_changes (
  id         bigint generated always as identity primary key,
  patient_id uuid not null references patients (id) on delete cascade,
  vital_id   text not null references vital_defs (id),
  from_min   numeric,
  from_max   numeric,
  to_min     numeric,     -- null when the personal target was removed
  to_max     numeric,
  changed_by uuid references profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index threshold_changes_patient_idx on threshold_changes (patient_id, vital_id, changed_at desc);

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

/* ─── Helpers ──────────────────────────────────────────────────────── */
create function name_of(person uuid) returns text language sql stable security definer set search_path = public as
$$ select full_name from profiles where id = person $$;
revoke execute on function name_of(uuid) from public, anon, authenticated;

/** True while a database function is making a change the guards would otherwise refuse. Set for one transaction only. */
create function acting(flag text) returns boolean language sql stable as
$$ select coalesce(current_setting('mcare.' || flag, true), '') = '1' $$;

/** Admins, and assistants holding this permission. */
create function notify_staff(perm text, k notif_kind, t text, b text, l text, except_user uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, link)
  select p.id, k, t, b, l from profiles p left join staff s on s.id = p.id
  where p.status = 'active' and p.id is distinct from except_user
    and (p.role = 'admin' or (p.role = 'assistant' and perm = any (s.permissions)))
$$;
revoke execute on function notify_staff(text, notif_kind, text, text, text, uuid) from public, anon, authenticated;

/* ─── Account ──────────────────────────────────────────────────────── */
create or replace function guard_profile() returns trigger language plpgsql as $$
begin
  if new.dob is not null and (new.dob > current_date or new.dob < date '1900-01-01') then
    raise exception 'Enter a valid date of birth' using errcode = '22023';
  end if;
  if new.avatar is not null and length(new.avatar::text) > 400000 then
    raise exception 'That photo is too large' using errcode = '22023';
  end if;
  if auth.uid() is null or is_admin() or acting('account_action') then return new; end if;
  if new.role is distinct from old.role or new.status is distinct from old.status or new.email is distinct from old.email then
    raise exception 'You cannot change role, status or email' using errcode = '42501';
  end if;
  return new;
end $$;

create function profile_status_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Suspending and reactivating only; a doctor's approval is audited by decide_doctor().
  if (new.status = 'suspended') <> (old.status = 'suspended') and auth.uid() is not null and auth.uid() <> new.id then
    insert into audit_log (actor_id, action, detail)
    values (auth.uid(), case when new.status = 'suspended' then 'Suspended user' else 'Reactivated user' end, new.full_name);
  end if;
  return new;
end $$;
create trigger profile_status_audit after update of status on profiles for each row execute function profile_status_audit();

/** Someone suspends their own account. Their record is kept; an admin can reactivate it. */
create function deactivate_my_account() returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); who text;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select full_name into who from profiles where id = me;
  perform set_config('mcare.account_action', '1', true);
  update profiles set status = 'suspended' where id = me;
  perform set_config('mcare.account_action', '', true);
  insert into audit_log (actor_id, action, detail) values (me, 'Deactivated own account', who);
  perform notify_staff('create_users', 'account', 'Account deactivated', who || ' deactivated their account', 'users');
end $$;

/** Records that the caller accepted the Terms and the Privacy Policy now, at the server's time. */
create function accept_terms(doc_version text default '1') returns timestamptz language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or my_role() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  insert into consents (user_id, kind, granted, version) values (me, 'terms', true, doc_version), (me, 'privacy', true, doc_version);
  return now();
end $$;

create trigger consents_append_only before update or delete on consents for each row execute function no_rewrite();

/* ─── Patient record ───────────────────────────────────────────────── */
create or replace function guard_patient() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if new.assigned_doctor_id is distinct from old.assigned_doctor_id then
    if not (staff_can('assign_healthworkers') or acting('assign_action')) then
      raise exception 'Only the care coordination team can assign a doctor' using errcode = '42501';
    end if;
    if new.assigned_doctor_id is not null and not exists (
      select 1 from doctors d join profiles p on p.id = d.id
      where d.id = new.assigned_doctor_id and d.approval_status = 'approved' and p.status = 'active') then
      raise exception 'That doctor is not available' using errcode = '22023';
    end if;
  end if;
  if new.doctor_note is distinct from old.doctor_note and not (treats(old.id) or acting('note_action')) then
    raise exception 'Only the treating doctor can write the doctor''s note' using errcode = '42501';
  end if;
  return new;
end $$;

/** A change of doctor tells everyone involved, closes any open request and is written to the audit trail. */
create function patient_assignment_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := name_of(new.id); doc text := name_of(new.assigned_doctor_id);
begin
  if new.assigned_doctor_id is not distinct from old.assigned_doctor_id then return new; end if;
  if new.assigned_doctor_id is not null then
    perform notify_user(new.assigned_doctor_id, 'assignment', 'New patient assigned', who || ' is now under your care', 'patients');
    if not acting('assign_action') then
      perform notify_user(new.id, 'assignment', 'Care team updated', doc || ' is now your doctor', 'care');
    end if;
    update doctor_requests set status = case when doctor_id = new.assigned_doctor_id then 'approved' else 'rejected' end::request_status,
      response_note = case when doctor_id = new.assigned_doctor_id then response_note else 'You were assigned to ' || doc end,
      decided_by = auth.uid(), decided_at = now()
    where patient_id = new.id and status = 'pending';
  end if;
  if old.assigned_doctor_id is not null then
    perform notify_user(old.assigned_doctor_id, 'assignment', 'Patient reassigned',
      who || case when new.assigned_doctor_id is null then ' is no longer under your care' else ' has moved to another doctor' end, 'patients');
  end if;
  insert into audit_log (actor_id, action, detail)
  values (auth.uid(), case when new.assigned_doctor_id is null then 'Removed doctor assignment' else 'Assigned doctor' end,
          who || coalesce(' → ' || doc, ''));
  return new;
end $$;
create trigger patient_assignment_changed after update of assigned_doctor_id on patients for each row execute function patient_assignment_changed();

/** Saves the health profile in one step: the patient's own facts, allergies and long-term conditions. */
create function save_health_profile(profile jsonb) returns void language plpgsql set search_path = public as $$
declare me uuid := auth.uid();
begin
  if my_role() is distinct from 'patient' then raise exception 'Only a patient can edit their health profile' using errcode = '42501'; end if;
  if jsonb_typeof(profile) <> 'object' then raise exception 'Nothing to save' using errcode = '22023'; end if;
  update patients set
    sex = nullif(profile ->> 'sex', ''),
    blood_type = nullif(profile ->> 'blood_type', ''),
    no_known_allergies = coalesce((profile ->> 'no_known_allergies')::boolean, false)
      and jsonb_array_length(coalesce(profile -> 'allergies', '[]'::jsonb)) = 0,
    no_conditions = coalesce((profile ->> 'no_conditions')::boolean, false)
      and jsonb_array_length(coalesce(profile -> 'conditions', '[]'::jsonb)) = 0,
    other_medicines = nullif(trim(coalesce(profile ->> 'other_medicines', '')), '')
  where id = me;

  delete from allergies where patient_id = me;
  insert into allergies (patient_id, substance, severity, reaction)
  select distinct on (lower(trim(x ->> 'substance')))
    me, trim(x ->> 'substance'), coalesce(nullif(x ->> 'severity', ''), 'mild'), nullif(trim(coalesce(x ->> 'reaction', '')), '')
  from jsonb_array_elements(coalesce(profile -> 'allergies', '[]'::jsonb)) x
  where length(trim(coalesce(x ->> 'substance', ''))) > 0;

  delete from conditions where patient_id = me;
  insert into conditions (patient_id, name)
  select distinct me, trim(v) from jsonb_array_elements_text(coalesce(profile -> 'conditions', '[]'::jsonb)) v
  where length(trim(v)) between 1 and 120;
end $$;

/**
 * Sets which vitals a patient tracks. The row rules decide what may be removed:
 * a patient cannot drop a vital their doctor set a target for.
 */
create function set_tracked_vitals(ids text[], patient uuid default null) returns setof text language plpgsql set search_path = public as $$
declare pt uuid := coalesce(patient, auth.uid());
begin
  delete from tracked_vitals where patient_id = pt and not (vital_id = any (ids));
  insert into tracked_vitals (patient_id, vital_id)
  select pt, v.id from vital_defs v where v.id = any (ids) and v.active
  on conflict do nothing;
  return query select t.vital_id from tracked_vitals t where t.patient_id = pt;
end $$;

/** Adds or changes an emergency contact. Making one the next of kin takes that mark off the previous one in the same step. */
create function save_emergency_contact(contact jsonb) returns uuid language plpgsql set search_path = public as $$
declare
  me uuid := auth.uid();
  cid uuid := nullif(contact ->> 'id', '')::uuid;
  kin boolean := coalesce((contact ->> 'next_of_kin')::boolean, false);
  nm text := trim(coalesce(contact ->> 'name', ''));
  ph text := trim(coalesce(contact ->> 'phone', ''));
  rel text := coalesce(nullif(trim(coalesce(contact ->> 'relationship', '')), ''), 'Contact');
begin
  if my_role() is distinct from 'patient' then raise exception 'Only a patient can edit their emergency contacts' using errcode = '42501'; end if;
  if nm = '' then raise exception 'Enter the contact''s name' using errcode = '22023'; end if;
  if length(regexp_replace(ph, '\D', '', 'g')) < 7 then raise exception 'Enter a valid phone number' using errcode = '22023'; end if;
  if kin then update emergency_contacts set next_of_kin = false where patient_id = me and next_of_kin and id is distinct from cid; end if;
  if cid is not null then
    update emergency_contacts set name = nm, relationship = rel, phone = ph, next_of_kin = kin where id = cid and patient_id = me;
    if not found then raise exception 'Contact not found' using errcode = '42501'; end if;
  else
    if (select count(*) from emergency_contacts where patient_id = me) >= 5 then
      raise exception 'You can keep up to 5 emergency contacts' using errcode = '22023';
    end if;
    insert into emergency_contacts (patient_id, name, relationship, phone, next_of_kin) values (me, nm, rel, ph, kin) returning id into cid;
  end if;
  return cid;
end $$;

/* ─── Readings and alerts ──────────────────────────────────────────────
   The grading stays as it was. What changes:
     • a reading remembers who entered it, and what it said before a correction
     • a reading may be entered by the patient or by their treating doctor
     • the patient is told when a reading reaches their care team
     • an alert keeps the value that raised it; the reading that answers it is linked, not copied over it
     • a critical alert is never closed by a new number alone: a clinician resolves it */
drop policy readings_add on readings;
create policy readings_add on readings for insert to authenticated with check (patient_id = auth.uid() or treats(patient_id));

create or replace function reading_before() returns trigger language plpgsql security definer set search_path = public as $$
declare
  d vital_defs; m text[];
begin
  select * into d from vital_defs where id = new.vital_id;
  if not found then raise exception 'Unknown vital' using errcode = '22023'; end if;
  if tg_op = 'UPDATE' then
    if new.patient_id <> old.patient_id or new.vital_id <> old.vital_id or new.taken_at <> old.taken_at
       or new.recorded_by is distinct from old.recorded_by then
      raise exception 'A reading cannot be moved' using errcode = '42501';
    end if;
    new.corrected_from := old.corrected_from; new.corrected_at := old.corrected_at;
    if trim(new.value) <> old.value then
      -- A typo can be fixed for 15 minutes by whoever entered it. After that the reading stands, or the doctor marks it invalid.
      if auth.uid() is not null and (auth.uid() is distinct from old.recorded_by or now() - old.taken_at > interval '15 minutes') then
        raise exception 'Readings can only be corrected within 15 minutes, by whoever entered them' using errcode = '42501';
      end if;
      new.corrected_from := coalesce(old.corrected_from, old.value);
      new.corrected_at := now();
    end if;
    if (new.invalid <> old.invalid or new.invalid_reason is distinct from old.invalid_reason)
       and auth.uid() is not null and not treats(old.patient_id) then
      raise exception 'Only the treating doctor can mark a reading invalid' using errcode = '42501';
    end if;
    if new.invalid and length(trim(coalesce(new.invalid_reason, ''))) = 0 then
      raise exception 'Say why the reading is invalid' using errcode = '22023';
    end if;
  else
    if not d.active then raise exception '% is not being collected', d.name using errcode = '22023'; end if;
    new.taken_at := now();   -- the server's clock, not the phone's
    new.recorded_by := coalesce(auth.uid(), new.recorded_by, new.patient_id);
    new.corrected_from := null; new.corrected_at := null; new.invalid := false; new.invalid_reason := null;
  end if;

  new.value := trim(new.value);
  new.note := nullif(trim(coalesce(new.note, '')), '');
  if new.vital_id = 'bp' then
    m := regexp_match(new.value, '^(\d{2,3})\s*/\s*(\d{2,3})$');
    if m is null then raise exception 'Use the format 120/80' using errcode = '22023'; end if;
    new.primary_value := m[1]::numeric; new.secondary_value := m[2]::numeric;
    new.value := m[1] || '/' || m[2];
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

/** Opens the alert for an out-of-range reading and tells the care team and the patient. Returns the alert. */
create function raise_vital_alert(r readings) returns uuid language plpgsql security definer set search_path = public as $$
declare d vital_defs; who text := name_of(r.patient_id); aid uuid; label text;
begin
  select id into aid from alerts where reading_id = r.id;
  if aid is not null then return aid; end if;
  select * into d from vital_defs where id = r.vital_id;
  label := d.name || ' ' || r.value || ' ' || d.unit;
  insert into alerts (patient_id, type, severity, vital_id, reading_id, value, unit)
  values (r.patient_id, 'vital', case when r.level = 'critical' then 'danger' else 'warning' end::alert_severity,
          r.vital_id, r.id, r.value, d.unit)
  returning id into aid;
  perform notify_care_team(r.patient_id, 'alert', case when r.level = 'critical' then 'Critical: ' else 'Alert: ' end || who,
    label || case when (select assigned_doctor_id from patients where id = r.patient_id) is null then ' · patient has no doctor' else '' end);
  perform notify_user(r.patient_id, 'alert',
    case when r.level = 'critical' then 'Critical reading: your care team has been alerted' else 'Reading sent to your care team' end,
    label, 'alerts');
  return aid;
end $$;
revoke execute on function raise_vital_alert(readings) from public, anon, authenticated;

create or replace function reading_after_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare
  d vital_defs; who text := name_of(new.patient_id); a alerts; prev vital_level; label text;
begin
  select * into d from vital_defs where id = new.vital_id;
  label := d.name || ' ' || new.value || ' ' || d.unit;

  if new.level = 'normal' then
    -- A clinician asked for a re-check on this vital.
    select * into a from alerts where patient_id = new.patient_id and vital_id = new.vital_id
      and status <> 'resolved' and recheck_requested_at is not null order by created_at desc limit 1;
    if found then
      perform set_config('mcare.alert_action', '1', true);
      if a.severity = 'warning' then
        update alerts set status = 'resolved', resolved_at = now(), resolved_by = new.recorded_by, recheck_reading_id = new.id,
          resolution_reason = 'Re-check back in range',
          resolution_note = 'New reading ' || label || ', asked for by ' || coalesce(name_of(a.recheck_requested_by), 'the care team')
        where id = a.id;
        perform notify_user(new.patient_id, 'alert', 'Alert resolved', d.name || ': your new reading is back in range', 'alerts');
        perform notify_care_team(new.patient_id, 'alert', 'Alert resolved: ' || who, label || ' · re-check back in range');
      else
        update alerts set recheck_reading_id = new.id where id = a.id;
        perform notify_user(new.patient_id, 'alert', 'Re-check received',
          d.name || ': your new reading is in range. Your doctor will review it and close the alert.', 'alerts');
        perform notify_care_team(new.patient_id, 'alert', 'Re-check in range: ' || who, label || ' · review and resolve the alert');
      end if;
      perform set_config('mcare.alert_action', '', true);
      return new;
    end if;
    -- Self-clear: an untouched warning, re-measured in range within 30 minutes. Critical alerts always get a clinician.
    select * into a from alerts where patient_id = new.patient_id and vital_id = new.vital_id and type = 'vital'
      and severity = 'warning' and status = 'open' and created_at > now() - interval '30 minutes'
      order by created_at desc limit 1;
    if found then
      perform set_config('mcare.alert_action', '1', true);
      update alerts set status = 'resolved', resolved_at = now(), resolved_by = new.recorded_by, recheck_reading_id = new.id,
        resolution_reason = 'Re-measured in range by patient', resolution_note = 'New reading ' || label
      where id = a.id;
      perform set_config('mcare.alert_action', '', true);
      perform notify_user(new.patient_id, 'alert', 'Alert cleared', d.name || ': your new reading is back in range', 'alerts');
      perform notify_care_team(new.patient_id, 'alert', 'Alert cleared: ' || who, d.name || ' re-measured at ' || new.value || ' ' || d.unit || ' · back in range');
      insert into audit_log (actor_id, action, detail) values (new.recorded_by, 'Alert self-cleared', who || ' · ' || label);
    end if;
    return new;
  end if;

  if new.level = 'warning' then
    -- Ask the patient to re-measure first: alert only if the previous reading in the last hour was abnormal too.
    select level into prev from readings where patient_id = new.patient_id and vital_id = new.vital_id and not invalid
      and id <> new.id and taken_at > now() - interval '60 minutes' order by taken_at desc limit 1;
    if prev is null or prev = 'normal' then return new; end if;
  end if;

  perform raise_vital_alert(new);
  return new;
end $$;

-- A corrected reading is graded again and its alert follows: back in range resolves it, otherwise the severity follows.
create or replace function reading_after_update() returns trigger language plpgsql security definer set search_path = public as $$
declare who text; d vital_defs; touched int;
begin
  if new.value = old.value then return new; end if;
  who := name_of(new.patient_id);
  select * into d from vital_defs where id = new.vital_id;
  perform set_config('mcare.alert_action', '1', true);
  if new.level = 'normal' then
    update alerts set status = 'resolved', resolved_at = now(), resolved_by = coalesce(auth.uid(), new.recorded_by),
      resolution_reason = case when new.recorded_by = new.patient_id then 'Corrected by patient' else 'Corrected by clinician' end,
      resolution_note = 'Entered as ' || old.value || ', corrected to ' || new.value || ' ' || d.unit
    where reading_id = new.id and status <> 'resolved';
    get diagnostics touched = row_count;
    if touched > 0 then
      perform notify_care_team(new.patient_id, 'alert', 'Reading corrected: ' || who,
        d.name || ' entered as ' || old.value || ', corrected to ' || new.value || ' ' || d.unit || ' · alert closed');
    end if;
  else
    update alerts set value = new.value, severity = case when new.level = 'critical' then 'danger' else 'warning' end::alert_severity
    where reading_id = new.id and status <> 'resolved';
    get diagnostics touched = row_count;
    -- Corrected INTO the critical range with no alert yet: it must still reach a clinician.
    if touched = 0 and new.level = 'critical' and not exists (select 1 from alerts where reading_id = new.id) then
      perform raise_vital_alert(new);
    end if;
  end if;
  perform set_config('mcare.alert_action', '', true);
  insert into audit_log (actor_id, action, detail)
  values (coalesce(auth.uid(), new.recorded_by), 'Corrected reading', who || ' · ' || d.name || ' ' || old.value || ' → ' || new.value);
  return new;
end $$;

create function reading_invalidated() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.invalid and not old.invalid then
    insert into audit_log (actor_id, action, detail)
    values (auth.uid(), 'Marked reading invalid', name_of(new.patient_id) || ' · ' || new.value || ' · ' || coalesce(new.invalid_reason, ''));
  end if;
  return new;
end $$;
create trigger reading_invalidated after update of invalid on readings for each row execute function reading_invalidated();

/** The patient asks for a reading that is out of range to go to the care team now, without waiting for a second one. */
create function send_alert_now(reading uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare r readings;
begin
  if my_role() is distinct from 'patient' then raise exception 'Only a patient can do this' using errcode = '42501'; end if;
  select * into r from readings where id = reading and patient_id = auth.uid() and not invalid;
  if not found then raise exception 'Reading not found' using errcode = '42501'; end if;
  if r.level = 'normal' then raise exception 'That reading is inside your target range' using errcode = '22023'; end if;
  return raise_vital_alert(r);
end $$;

/* ─── What may change on an alert ──────────────────────────────────────
   The care team moves an alert through its steps; the database fills in
   who and when, and refuses anything else. Functions above that act for
   the system (a self-clear, a correction) set `alert_action` first. */
create function alert_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or acting('alert_action') then return new; end if;
  if old.status = 'resolved' then
    raise exception 'A resolved alert cannot be changed' using errcode = '42501';
  end if;
  if (new.patient_id, new.type, new.severity, new.vital_id, new.reading_id, new.value, new.unit, new.created_at)
     is distinct from (old.patient_id, old.type, old.severity, old.vital_id, old.reading_id, old.value, old.unit, old.created_at) then
    raise exception 'The reading on an alert cannot be edited' using errcode = '42501';
  end if;
  -- Names and times are the server's, never the browser's.
  new.acknowledged_at := old.acknowledged_at; new.acknowledged_by := old.acknowledged_by;
  new.escalated_at := old.escalated_at; new.resolved_at := null; new.resolved_by := null;
  new.recheck_reading_id := old.recheck_reading_id; new.recheck_requested_by := old.recheck_requested_by;
  if new.recheck_requested_at is distinct from old.recheck_requested_at then
    new.recheck_requested_at := now(); new.recheck_requested_by := me;
  end if;
  if new.status <> old.status then
    if new.status = 'open' then
      raise exception 'An alert cannot be reopened' using errcode = '42501';
    elsif new.status = 'acknowledged' then
      new.acknowledged_at := now(); new.acknowledged_by := me;
    elsif new.status = 'escalated' then
      new.escalated_at := now();
    else
      if length(trim(coalesce(new.resolution_reason, ''))) = 0 then
        raise exception 'Give a reason for resolving the alert' using errcode = '22023';
      end if;
      new.resolution_reason := trim(new.resolution_reason);
      new.resolution_note := nullif(trim(coalesce(new.resolution_note, '')), '');
      new.resolved_at := now(); new.resolved_by := me;
    end if;
  end if;
  if new.status <> 'resolved' then new.resolution_reason := null; new.resolution_note := null; end if;
  return new;
end $$;
create trigger alert_guard before update on alerts for each row execute function alert_guard();

create function alert_after_update() returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); actor text; who text; what text;
begin
  if me is null or acting('alert_action') then return new; end if;
  actor := coalesce(name_of(me), 'Your care team');
  who := name_of(new.patient_id);
  what := case when new.type = 'sos' then 'SOS' else coalesce((select name from vital_defs where id = new.vital_id), 'reading') end;
  if new.status <> old.status then
    if new.status = 'acknowledged' then
      perform notify_user(new.patient_id, 'alert', 'Your alert is being reviewed', actor || ' is looking at your ' || what || ' alert', 'alerts');
      insert into audit_log (actor_id, action, detail) values (me, 'Acknowledged alert', who || ' · ' || what);
    elsif new.status = 'escalated' then
      perform notify_staff('monitor_patients', 'escalation', 'Escalated by ' || actor,
        who || ' · ' || what || case when new.type = 'sos' then '' else ' ' || new.value || ' ' || new.unit end, 'alerts', me);
      insert into audit_log (actor_id, action, detail) values (me, 'Escalated alert', who || ' · ' || what);
    elsif new.status = 'resolved' then
      perform notify_user(new.patient_id, 'alert', 'Alert resolved', what || ': ' || new.resolution_reason, 'alerts');
      insert into audit_log (actor_id, action, detail)
      values (me, 'Resolved alert', who || ' · ' || what || ' · ' || new.resolution_reason || coalesce(' · ' || new.resolution_note, ''));
    end if;
  end if;
  if new.recheck_requested_at is distinct from old.recheck_requested_at then
    perform notify_user(new.patient_id, 'alert', 'Please log a new reading',
      actor || ' asked you to re-check your ' || case when new.type = 'sos' then 'condition' else what end, 'vitals');
    insert into audit_log (actor_id, action, detail) values (me, 'Requested re-check', who || ' · ' || what);
  end if;
  return new;
end $$;
create trigger alert_after_update after update on alerts for each row execute function alert_after_update();

/** Patient presses SOS. Pressing again while one is open returns the same alert instead of raising another. */
create or replace function raise_sos(message text default '') returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid; who text; body text := left(coalesce(nullif(trim(message), ''), 'Emergency help requested'), 300);
begin
  if my_role() is distinct from 'patient' then raise exception 'Only a patient can raise an SOS' using errcode = '42501'; end if;
  select id into aid from alerts where patient_id = auth.uid() and type = 'sos' and status <> 'resolved' order by created_at desc limit 1;
  if aid is not null then return aid; end if;
  select full_name into who from profiles where id = auth.uid();
  insert into alerts (patient_id, type, severity, value) values (auth.uid(), 'sos', 'danger', body) returning id into aid;
  perform notify_care_team(auth.uid(), 'sos', 'SOS: ' || who, body);
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'SOS raised', who);
  return aid;
end $$;

/** Patient marks themself safe: closes their own open SOS and tells the care team. */
create or replace function cancel_sos(alert uuid) returns void language plpgsql security definer set search_path = public as $$
declare who text := name_of(auth.uid());
begin
  if my_role() is distinct from 'patient' then raise exception 'Only a patient can do this' using errcode = '42501'; end if;
  perform set_config('mcare.alert_action', '1', true);
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_reason = 'Patient marked safe'
  where id = alert and patient_id = auth.uid() and type = 'sos' and status <> 'resolved';
  if not found then raise exception 'Nothing to cancel' using errcode = '42501'; end if;
  perform set_config('mcare.alert_action', '', true);
  perform notify_care_team(auth.uid(), 'sos', 'SOS cancelled: ' || who, who || ' marked themself safe');
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'SOS cancelled', who);
end $$;

/* ─── Targets ──────────────────────────────────────────────────────── */
create function threshold_before() returns trigger language plpgsql as $$
begin
  new.set_by := coalesce(auth.uid(), new.set_by);
  new.updated_at := now();
  return new;
end $$;
create trigger threshold_before before insert or update on thresholds for each row execute function threshold_before();

/** A new or changed target is kept in the history, starts the vital being tracked and is shown to the patient. */
create function threshold_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare d vital_defs;
begin
  if tg_op = 'DELETE' then
    insert into threshold_changes (patient_id, vital_id, from_min, from_max, changed_by)
    values (old.patient_id, old.vital_id, old.target_min, old.target_max, auth.uid());
    return old;
  end if;
  if tg_op = 'UPDATE' and new.target_min = old.target_min and new.target_max = old.target_max then return new; end if;
  select * into d from vital_defs where id = new.vital_id;
  insert into threshold_changes (patient_id, vital_id, from_min, from_max, to_min, to_max, changed_by)
  values (new.patient_id, new.vital_id,
          case when tg_op = 'UPDATE' then old.target_min end, case when tg_op = 'UPDATE' then old.target_max end,
          new.target_min, new.target_max, new.set_by);
  insert into tracked_vitals (patient_id, vital_id) values (new.patient_id, new.vital_id) on conflict do nothing;
  perform notify_user(new.patient_id, 'alert', 'Your target was updated',
    d.name || ': ' || new.target_min || '–' || new.target_max || ' ' || d.unit, 'vitals');
  insert into audit_log (actor_id, action, detail)
  values (new.set_by, 'Set target range', name_of(new.patient_id) || ' · ' || d.name || ' ' || new.target_min || '–' || new.target_max);
  return new;
end $$;
create trigger threshold_changed after insert or update or delete on thresholds for each row execute function threshold_changed();

/* ─── Clinical notes ───────────────────────────────────────────────── */
create function clinical_note_added() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('mcare.note_action', '1', true);
  update patients set doctor_note = new.content where id = new.patient_id;
  perform set_config('mcare.note_action', '', true);
  perform notify_user(new.patient_id, 'message', 'New note from your doctor', left(new.content, 80), 'vitals');
  return new;
end $$;
create trigger clinical_note_added after insert on clinical_notes for each row execute function clinical_note_added();
create trigger clinical_notes_append_only before update or delete on clinical_notes for each row execute function no_rewrite();

/* ─── Medication ───────────────────────────────────────────────────── */
-- Document history: say where a generated document came from (a prescription is not "from the vitals record").
create or replace function document_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_doc_event(new.id, 'upload', case when new.category = 'vitals_report' and new.origin = 'system_generated'
      then 'Generated from the vitals record' end);
  else
    if new.upload_state is distinct from old.upload_state and new.upload_state = 'failed' then perform log_doc_event(new.id, 'upload_failed', new.upload_error); end if;
    if new.visibility <> old.visibility then perform log_doc_event(new.id, 'visibility', new.visibility::text); end if;
    if old.deleted_at is null and new.deleted_at is not null then perform log_doc_event(new.id, 'delete'); end if;
    if old.deleted_at is not null and new.deleted_at is null then perform log_doc_event(new.id, 'restore'); end if;
  end if;
  return new;
end $$;

create function prescription_before() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.medication := trim(new.medication); new.dosage := trim(new.dosage);
    new.frequency := trim(new.frequency); new.purpose := trim(coalesce(new.purpose, ''));
    new.prescribed_at := now(); new.stopped_at := null; new.stopped_by := null;
    return new;
  end if;
  if (new.patient_id, new.doctor_id, new.medication, new.dosage, new.frequency, new.prescribed_at)
     is distinct from (old.patient_id, old.doctor_id, old.medication, old.dosage, old.frequency, old.prescribed_at) then
    raise exception 'A prescription cannot be rewritten: stop it and prescribe again' using errcode = '42501';
  end if;
  if old.active and not new.active then new.stopped_at := now(); new.stopped_by := auth.uid();
  elsif new.active and not old.active then new.stopped_at := null; new.stopped_by := null;
  else new.stopped_at := old.stopped_at; new.stopped_by := old.stopped_by;
  end if;
  return new;
end $$;
create trigger prescription_before before insert or update on prescriptions for each row execute function prescription_before();

/** A new prescription reaches the patient, is filed in their documents as a signed record, and is audited. */
create function prescription_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := name_of(new.patient_id); doc_id uuid := gen_random_uuid();
begin
  if tg_op = 'INSERT' then
    perform notify_user(new.patient_id, 'prescription', 'New prescription', new.medication || ' · ' || new.frequency, 'medicine');
    insert into audit_log (actor_id, action, detail) values (new.doctor_id, 'Prescribed', new.medication || ' for ' || who);
    perform set_config('mcare.doc_action', '1', true);
    insert into documents (id, patient_id, title, category, origin, created_by, body, links, status,
                           signed_by, signed_at, signature_image, released_by, released_at, series_id, visibility)
    values (doc_id, new.patient_id, 'Prescription: ' || new.medication, 'prescription', 'system_generated', new.doctor_id,
            jsonb_build_object('type', 'prescription', 'medication', new.medication, 'dosage', new.dosage,
                               'frequency', new.frequency, 'purpose', new.purpose),
            jsonb_build_array(jsonb_build_object('kind', 'prescription', 'id', new.id, 'label', new.medication || ' · ' || new.frequency)),
            'released', new.doctor_id, now(), (select signature from doctors where id = new.doctor_id), new.doctor_id, now(),
            doc_id, 'care_team');
    perform set_config('mcare.doc_action', '', true);
    perform log_doc_event(doc_id, 'release', 'Filed automatically when prescribed');
  elsif old.active and not new.active then
    perform notify_user(new.patient_id, 'prescription', 'Medication stopped', new.medication || ' has been stopped by your doctor', 'medicine');
    insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Stopped medication', new.medication || ' for ' || who);
  elsif new.active and not old.active then
    perform notify_user(new.patient_id, 'prescription', 'Medication restarted', new.medication || ' · ' || new.frequency, 'medicine');
    insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Restarted medication', new.medication || ' for ' || who);
  end if;
  return new;
end $$;
create trigger prescription_changed after insert or update on prescriptions for each row execute function prescription_changed();

/* ─── Appointments ─────────────────────────────────────────────────── */
drop trigger guard_appointment on appointments;
create or replace function guard_appointment() returns trigger language plpgsql as $$
declare me uuid := auth.uid();
begin
  if me is null then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := me; new.created_at := now();
    new.title := trim(new.title); new.reason := trim(coalesce(new.reason, ''));
    new.location := nullif(trim(coalesce(new.location, '')), '');
    if me = new.patient_id then
      new.approval_note := null; new.rejection_reason := null;
      new.rescheduled_date := null; new.rescheduled_time := null; new.rescheduled_reason := null;
      if new.preferred_date < current_date then
        raise exception 'Choose a date from today onwards' using errcode = '22023';
      end if;
    end if;
    return new;
  end if;

  if new.patient_id <> old.patient_id or new.doctor_id <> old.doctor_id
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'An appointment cannot be moved to someone else' using errcode = '42501';
  end if;
  if old.status in ('cancelled', 'completed', 'rejected') then
    raise exception 'This appointment is closed' using errcode = '42501';
  end if;

  if me = old.patient_id then
    -- A patient can cancel, or accept the new time the doctor proposed. Nothing else.
    if (new.title, new.reason, new.location, new.approval_note, new.rejection_reason,
        new.rescheduled_date, new.rescheduled_time, new.rescheduled_reason)
       is distinct from (old.title, old.reason, old.location, old.approval_note, old.rejection_reason,
        old.rescheduled_date, old.rescheduled_time, old.rescheduled_reason) then
      raise exception 'You cannot change that part of an appointment' using errcode = '42501';
    end if;
    new.preferred_date := old.preferred_date; new.preferred_time := old.preferred_time;
    if new.status = old.status or new.status = 'cancelled' then
      null;
    elsif old.status = 'rescheduled' and new.status = 'approved' then
      new.preferred_date := coalesce(old.rescheduled_date, old.preferred_date);
      new.preferred_time := coalesce(old.rescheduled_time, old.preferred_time);
    else
      raise exception 'Only your doctor can confirm an appointment' using errcode = '42501';
    end if;
  else
    if new.status = 'requested' and old.status <> 'requested' then
      raise exception 'An answered appointment cannot go back to requested' using errcode = '42501';
    end if;
    if new.status = 'rescheduled' and new.rescheduled_date is null then
      raise exception 'Propose a new date' using errcode = '22023';
    end if;
    if new.status = 'rejected' and length(trim(coalesce(new.rejection_reason, ''))) = 0 then
      raise exception 'Give the patient a reason' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger guard_appointment before insert or update on appointments for each row execute function guard_appointment();

-- The treating doctor can book a follow-up directly.
create policy appts_follow_up on appointments for insert to authenticated with check (doctor_id = auth.uid() and treats(patient_id));

create function appointment_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pt text := name_of(new.patient_id); doc text := name_of(new.doctor_id); day text;
begin
  if tg_op = 'INSERT' then
    day := to_char(new.preferred_date, 'Mon FMDD, YYYY');
    if me is distinct from new.doctor_id then
      perform notify_user(new.doctor_id, 'appointment', 'New appointment request', pt || ' · ' || new.title || ' · ' || day, 'appts');
    end if;
    if me is distinct from new.patient_id then
      perform notify_user(new.patient_id, 'appointment', 'Appointment booked', doc || ' · ' || new.title || ' · ' || day, 'appts');
    end if;
    return new;
  end if;
  if new.status = old.status then return new; end if;
  perform notify_user(case when me = new.patient_id then new.doctor_id else new.patient_id end, 'appointment',
    'Appointment ' || new.status,
    new.title || case when new.status = 'rescheduled' then ' → ' || to_char(new.rescheduled_date, 'Mon FMDD, YYYY')
                      when new.status = 'rejected' then ': ' || new.rejection_reason else '' end, 'appts');
  insert into audit_log (actor_id, action, detail) values (me, 'Appointment ' || new.status, pt || ' · ' || new.title);
  return new;
end $$;
create trigger appointment_notify after insert or update on appointments for each row execute function appointment_notify();

/* ─── Messages ─────────────────────────────────────────────────────── */
create function guard_message() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.created_at := now(); new.read := false; new.content := trim(new.content);
    return new;
  end if;
  if (new.from_id, new.to_id, new.content, new.created_at) is distinct from (old.from_id, old.to_id, old.content, old.created_at)
     or (old.read and not new.read) then
    raise exception 'Messages cannot be edited' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_message before insert or update on messages for each row execute function guard_message();

create function message_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform notify_user(new.to_id, 'message', 'New message from ' || coalesce(name_of(new.from_id), 'mCare'), left(new.content, 80),
    case when (select role from profiles where id = new.to_id) = 'patient' then 'messages' else 'patients' end);
  return new;
end $$;
create trigger message_notify after insert on messages for each row execute function message_notify();

/* ─── Care-team decisions ──────────────────────────────────────────── */
/** An approver answers a patient's request for a doctor: approve it, or decline and optionally assign someone else. */
create function decide_doctor_request(request uuid, approve boolean, note text default null, alternative uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare r doctor_requests; target uuid; clean text := nullif(trim(coalesce(note, '')), '');
begin
  if not staff_can('approve_patient_requests') then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into r from doctor_requests where id = request and status = 'pending' for update;
  if not found then raise exception 'That request has already been answered' using errcode = '22023'; end if;
  target := case when approve then r.doctor_id else alternative end;
  update doctor_requests set status = case when approve then 'approved' else 'rejected' end::request_status,
    response_note = clean, decided_by = auth.uid(), decided_at = now() where id = request;
  if target is not null then
    perform set_config('mcare.assign_action', '1', true);
    update patients set assigned_doctor_id = target where id = r.patient_id;
    perform set_config('mcare.assign_action', '', true);
  end if;
  if approve then
    perform notify_user(r.patient_id, 'assignment', 'Doctor request approved', name_of(r.doctor_id) || ' is now your doctor', 'care');
  else
    perform notify_user(r.patient_id, 'assignment', 'Doctor request not approved',
      trim(coalesce(clean, '') || case when target is not null then ' You have been assigned to ' || name_of(target) || '.' else '' end), 'care');
  end if;
  insert into audit_log (actor_id, action, detail)
  values (auth.uid(), case when approve then 'Approved doctor request' else 'Rejected doctor request' end,
          name_of(r.patient_id) || ' → ' || name_of(coalesce(target, r.doctor_id)));
end $$;

/** An approver decides a doctor's application. Approval activates the account. */
create function decide_doctor(doctor uuid, decision approval_status, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare clean text := nullif(trim(coalesce(note, '')), '');
begin
  if not staff_can('approve_doctors') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if decision = 'pending' then raise exception 'Choose approve, send back or reject' using errcode = '22023'; end if;
  update doctors set approval_status = decision, approval_note = clean,
    approved_by = case when decision = 'approved' then auth.uid() end,
    approved_at = case when decision = 'approved' then now() end
  where id = doctor;
  if not found then raise exception 'Doctor not found' using errcode = '22023'; end if;
  perform set_config('mcare.account_action', '1', true);
  update profiles set status = case when decision = 'approved' then 'active' else 'pending_approval' end::account_status where id = doctor;
  perform set_config('mcare.account_action', '', true);
  perform notify_user(doctor, 'account',
    case decision when 'approved' then 'Your application was approved' when 'sent_back' then 'Your application needs changes' else 'Your application was not approved' end,
    coalesce(clean, ''), null);
  insert into audit_log (actor_id, action, detail)
  values (auth.uid(), case decision when 'approved' then 'Approved doctor' when 'sent_back' then 'Sent back doctor application' else 'Rejected doctor' end,
          name_of(doctor) || coalesce(' · ' || clean, ''));
end $$;

create or replace function guard_doctor() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or staff_can('approve_doctors') or acting('doctor_action') then return new; end if;
  if new.approval_status is distinct from old.approval_status or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at or new.approval_note is distinct from old.approval_note then
    raise exception 'Only an approver can change approval' using errcode = '42501';
  end if;
  return new;
end $$;

/** A doctor corrects their details after being sent back, which puts the application in the queue again. */
create function resubmit_doctor_application(new_specialty text, new_license_no text, new_hospital text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  perform set_config('mcare.doctor_action', '1', true);
  if my_role() is distinct from 'doctor' then raise exception 'Only a doctor can do this' using errcode = '42501'; end if;
  update doctors set specialty = trim(new_specialty), license_no = trim(new_license_no), hospital = trim(new_hospital),
    approval_status = 'pending', approval_note = null
  where id = me and approval_status in ('sent_back', 'pending');
  if not found then raise exception 'There is no application to resubmit' using errcode = '42501'; end if;
  perform set_config('mcare.doctor_action', '', true);
  perform notify_staff('approve_doctors', 'account', 'Doctor application resubmitted', name_of(me) || ' updated their details', 'approvals');
end $$;

/** Someone who monitors patients chases the treating doctor about an alert that is still open. */
create function chase_alert(alert uuid) returns void language plpgsql security definer set search_path = public as $$
declare a alerts; doc uuid;
begin
  if not staff_can('monitor_patients') then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into a from alerts where id = alert and status <> 'resolved';
  if not found then raise exception 'That alert is already resolved' using errcode = '22023'; end if;
  select assigned_doctor_id into doc from patients where id = a.patient_id;
  if doc is null then raise exception 'This patient has no doctor to chase' using errcode = '22023'; end if;
  perform notify_user(doc, 'escalation', 'Urgent: ' || name_of(a.patient_id),
    name_of(auth.uid()) || ' asks you to respond to ' || case when a.type = 'sos' then 'an SOS'
      else coalesce((select name from vital_defs where id = a.vital_id), 'a reading') || ' ' || a.value end, 'alerts');
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Chased doctor', name_of(a.patient_id) || ' → ' || name_of(doc));
end $$;

/* ─── Support ──────────────────────────────────────────────────────── */
create function support_ticket_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform notify_staff('handle_support', 'account', 'Support request: ' || coalesce(name_of(new.user_id), 'User'), new.subject, 'support');
  elsif new.status = 'resolved' and old.status <> 'resolved' then
    perform notify_user(new.user_id, 'account', 'Support request resolved',
      coalesce(new.resolution_note, '"' || new.subject || '" has been resolved.'), null);
  end if;
  return new;
end $$;
create trigger support_ticket_notify after insert or update on support_tickets for each row execute function support_ticket_notify();

create function support_ticket_before() returns trigger language plpgsql as $$
begin
  if new.status = 'resolved' and old.status <> 'resolved' then
    new.resolved_at := now(); new.resolved_by := coalesce(auth.uid(), new.resolved_by);
  end if;
  return new;
end $$;
create trigger support_ticket_before before update on support_tickets for each row execute function support_ticket_before();

/* ─── Ratings ──────────────────────────────────────────────────────── */
create function doctor_rating_before() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.comment := nullif(trim(coalesce(new.comment, '')), '');
  return new;
end $$;
create trigger doctor_rating_before before insert or update on doctor_ratings for each row execute function doctor_rating_before();

/** The average and how many patients rated, for the doctor directory. Never who rated or what they wrote. */
create function doctor_rating_summary(doctor uuid) returns table (average numeric, ratings int)
language sql stable security definer set search_path = public as
$$ select round(avg(rating), 1), count(*)::int from doctor_ratings where doctor_id = doctor and auth.uid() is not null $$;

/* ─── Access rules for the new tables ──────────────────────────────── */
alter table clinical_notes    enable row level security;
alter table threshold_changes enable row level security;
alter table consents          enable row level security;
alter table doctor_ratings    enable row level security;

create policy clinical_notes_read on clinical_notes for select to authenticated using (can_see_patient(patient_id));
create policy clinical_notes_add on clinical_notes for insert to authenticated with check (treats(patient_id) and author_id = auth.uid());

create policy threshold_changes_read on threshold_changes for select to authenticated using (can_see_patient(patient_id));

create policy consents_read on consents for select to authenticated using (user_id = auth.uid() or is_admin());

create policy ratings_read on doctor_ratings for select to authenticated using (patient_id = auth.uid() or is_admin());
create policy ratings_write on doctor_ratings for all to authenticated using (patient_id = auth.uid()) with check (
  patient_id = auth.uid() and exists (select 1 from patients p where p.id = auth.uid() and p.assigned_doctor_id = doctor_id));

-- A notification can only be marked read; nothing else about it changes.
create function guard_notification() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.user_id, new.kind, new.title, new.body, new.link, new.created_at) is distinct from
     (old.user_id, old.kind, old.title, old.body, old.link, old.created_at) or (old.read and not new.read) then
    raise exception 'Notifications cannot be edited' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_notification before update on notifications for each row execute function guard_notification();

/* ─── Suspended accounts ───────────────────────────────────────────────
   A suspended person may still hold a valid session. The rules above let
   anyone reach "their own" rows, so without this a suspended patient could
   keep reading and writing their record. These policies are restrictive:
   they are checked in addition to every other rule, on every table.
   A suspended person can still read their own profile (to be told they are
   suspended) and nothing else. New tables must add the same policy. */
create function account_active() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and status <> 'suspended') $$;

do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
    if t in ('profiles', 'doctors', 'staff') then
      execute format('create policy %I on %I as restrictive for update to authenticated using (account_active()) with check (account_active())', t || '_active_only', t);
    else
      execute format('create policy %I on %I as restrictive for all to authenticated using (account_active()) with check (account_active())', t || '_active_only', t);
    end if;
  end loop;
end $$;

/* ─── Who may call the functions ───────────────────────────────────── */
-- Signed-in users only. Each function still checks who is calling.
revoke execute on function deactivate_my_account() from public, anon;
revoke execute on function accept_terms(text) from public, anon;
revoke execute on function save_health_profile(jsonb) from public, anon;
revoke execute on function set_tracked_vitals(text[], uuid) from public, anon;
revoke execute on function save_emergency_contact(jsonb) from public, anon;
revoke execute on function send_alert_now(uuid) from public, anon;
revoke execute on function decide_doctor_request(uuid, boolean, text, uuid) from public, anon;
revoke execute on function decide_doctor(uuid, approval_status, text) from public, anon;
revoke execute on function resubmit_doctor_application(text, text, text) from public, anon;
revoke execute on function doctor_rating_summary(uuid) from public, anon;
revoke execute on function chase_alert(uuid) from public, anon;
grant execute on function deactivate_my_account(), accept_terms(text), save_health_profile(jsonb), set_tracked_vitals(text[], uuid),
  save_emergency_contact(jsonb), send_alert_now(uuid), decide_doctor_request(uuid, boolean, text, uuid),
  decide_doctor(uuid, approval_status, text), resubmit_doctor_application(text, text, text), doctor_rating_summary(uuid),
  chase_alert(uuid) to authenticated;

/* ─── Document files (hosted Supabase only) ────────────────────────────
   Files live in the private `documents` bucket, in a folder named after the
   patient. Whoever may read the document row may read its file: the same
   rule (can_open_document) decides both. Skipped where there is no storage
   schema, e.g. the local test database. */
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('documents', 'documents', false, 20 * 1024 * 1024) on conflict (id) do nothing;
    execute $p$ create policy "documents: read what the record allows" on storage.objects for select to authenticated
      using (bucket_id = 'documents' and exists (select 1 from public.documents d where d.file_path = name)) $p$;
    execute $p$ create policy "documents: add to a record you may write" on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and ((storage.foldername(name))[1] = auth.uid()::text
        or public.treats(((storage.foldername(name))[1])::uuid))) $p$;
  end if;
end $$;

/* ─── Scheduled jobs (hosted Supabase with pg_cron) ────────────────── */
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mcare-escalate-alerts', '* * * * *', 'select public.escalate_stale_alerts()');
    perform cron.schedule('mcare-purge-documents', '15 3 * * *', 'select public.purge_deleted_documents()');
  end if;
end $$;

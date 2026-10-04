-- mCare integrity and audit: a patient's clinical record can no longer be hard-deleted, every audit
-- entry says which session and device it came from and for whom staff acted, profile, health-profile,
-- tracked-vital and doctor-credential changes are audited, and the admin's settings live in one table.


/* ═══ Reading the request ═════════════════════════════════════════════
   PostgREST (and the local backend) put the caller's token claims and the request headers in
   transaction settings. These read them without ever failing a change. */
create function jwt_claim(claim text) returns text language plpgsql stable as $$
begin
  return nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> claim;
exception when others then return null;
end $$;

create function request_header(name text) returns text language plpgsql stable as $$
begin
  return nullif(current_setting('request.headers', true), '')::jsonb ->> lower(name);
exception when others then return null;
end $$;

create function safe_uuid(v text) returns uuid language plpgsql immutable as $$
begin
  return nullif(trim(coalesce(v, '')), '')::uuid;
exception when others then return null;
end $$;


/* ═══ A clinical record is never hard-deleted ═════════════════════════
   Accounts are deactivated, not deleted. Every clinical table hangs off patients with
   `on delete cascade`, so deleting a sign-in account (the Supabase dashboard's "Delete user",
   the admin API, a SQL session) would take the whole record with it. This refuses that for a
   patient who has any clinical history. An empty patient row (just signed up, or turned into
   staff by an invitation) can still be removed. */
create function keep_clinical_record() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if acting('record_erasure') then return old; end if;
  if exists (select 1 from readings where patient_id = old.id)
     or exists (select 1 from prescriptions where patient_id = old.id)
     or exists (select 1 from clinical_notes where patient_id = old.id)
     or exists (select 1 from documents where patient_id = old.id)
     or exists (select 1 from alerts where patient_id = old.id)
     or exists (select 1 from appointments where patient_id = old.id)
     or exists (select 1 from care_plans where patient_id = old.id)
     or exists (select 1 from messages where from_id = old.id or to_id = old.id) then
    raise exception 'This patient has a clinical record, which mCare keeps. Deactivate the account instead.' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger keep_clinical_record before delete on patients for each row execute function keep_clinical_record();


/* ═══ Audit entries say where they came from ══════════════════════════
   session_id and aal come from the caller's token, the address and device from the request,
   on_behalf_of from a staff function acting for someone (set_config('mcare.on_behalf_of', …)). */
alter table audit_log
  add column session_id   uuid,
  add column aal          text,
  add column client_ip    text,
  add column user_agent   text,
  add column on_behalf_of uuid;
create index audit_log_on_behalf_idx on audit_log (on_behalf_of, created_at desc) where on_behalf_of is not null;

create or replace function audit_stamp() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at   := now();
  new.actor_role   := (select role from profiles where id = new.actor_id);
  new.session_id   := coalesce(new.session_id, safe_uuid(jwt_claim('session_id')));
  new.aal          := coalesce(new.aal, jwt_claim('aal'));
  new.client_ip    := coalesce(new.client_ip, left(nullif(trim(split_part(coalesce(request_header('x-forwarded-for'), request_header('x-real-ip'), ''), ',', 1)), ''), 64));
  new.user_agent   := coalesce(new.user_agent, left(request_header('user-agent'), 300));
  new.on_behalf_of := coalesce(new.on_behalf_of, safe_uuid(current_setting('mcare.on_behalf_of', true)));
  return new;
end $$;


/* ═══ When rows last changed ══════════════════════════════════════════ */
alter table profiles           add column updated_at timestamptz not null default now();
alter table patients           add column updated_at timestamptz not null default now();
alter table doctors            add column updated_at timestamptz not null default now();
alter table emergency_contacts add column updated_at timestamptz not null default now();
alter table tracked_vitals     add column updated_at timestamptz not null default now();

create function stamp_updated() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['profiles', 'patients', 'doctors', 'emergency_contacts', 'tracked_vitals'] loop
    execute format('create trigger stamp_updated before update on %I for each row execute function stamp_updated()', t);
  end loop;
end $$;


/* ═══ Profile details are audited; the sign-in email has one source ═══
   Name, phone, date of birth and email changes leave a before/after entry, whoever makes them.
   The email belongs to the sign-in service (auth.users): profiles.email follows it and nobody
   edits it directly, not even an admin, so the two can never disagree. */
create function profile_details_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare was jsonb := jsonb_build_object('name', old.full_name, 'phone', old.phone, 'dob', old.dob, 'email', old.email);
        now_ jsonb := jsonb_build_object('name', new.full_name, 'phone', new.phone, 'dob', new.dob, 'email', new.email);
begin
  -- Support's own function writes the entry for its edit, with the reason.
  if was = now_ or acting('support_edit') or auth.uid() is null and not acting('email_sync') then return new; end if;
  perform audit_event(
    case when acting('email_sync') then 'Changed sign-in email'
         when auth.uid() = new.id then 'Updated own details'
         else 'Updated details' end,
    new.full_name, 'account', new.id::text, case when new.role = 'patient' then new.id end, was, now_);
  return new;
end $$;
create trigger profile_details_audit after update of full_name, phone, dob, email on profiles
  for each row execute function profile_details_audit();

create function guard_profile_email() returns trigger language plpgsql as $$
begin
  if new.email is distinct from old.email and auth.uid() is not null and not acting('email_sync') then
    raise exception 'The email address is the one you sign in with. Change it from your account settings.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_profile_email before update of email on profiles for each row execute function guard_profile_email();

/** The sign-in service changed an account's email (after the person confirmed the new address). */
create function sync_profile_email() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    perform set_config('mcare.email_sync', '1', true);
    update profiles set email = new.email where id = new.id;
    perform set_config('mcare.email_sync', '', true);
  end if;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users for each row execute function sync_profile_email();


/* ═══ Doctor credentials ══════════════════════════════════════════════
   The licence number is what an approver checked. Once a doctor is approved only an approver
   changes it (a doctor sent back corrects it through resubmit_doctor_application). Specialty
   and facility stay the doctor's to edit, and every change to the three is audited. */
create function guard_doctor_licence() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or staff_can('approve_doctors') or acting('doctor_action') then return new; end if;
  if old.approval_status = 'approved' and new.license_no is distinct from old.license_no then
    raise exception 'Your licence number was checked when you were approved. Ask mCare support to change it.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_doctor_licence before update of license_no on doctors for each row execute function guard_doctor_licence();

create function doctor_details_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.specialty, new.license_no, new.hospital) is distinct from (old.specialty, old.license_no, old.hospital) then
    perform audit_event('Changed doctor details', coalesce(name_of(new.id), 'Doctor'), 'doctor', new.id::text, null,
      jsonb_build_object('specialty', old.specialty, 'license_no', old.license_no, 'hospital', old.hospital),
      jsonb_build_object('specialty', new.specialty, 'license_no', new.license_no, 'hospital', new.hospital));
  end if;
  return new;
end $$;
create trigger doctor_details_audit after update of specialty, license_no, hospital on doctors
  for each row execute function doctor_details_audit();


/* ═══ Health profile, contacts and tracked vitals are audited ═════════
   Allergies and conditions are clinical safety facts: who changed them must be answerable.
   save_health_profile now writes one entry for the whole save (it runs as the database, after
   checking the caller is an active patient, and touches only that patient's rows); a direct
   change to one row writes its own entry. */
create function health_row_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare row_ jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end); pid uuid := (row_ ->> 'patient_id')::uuid;
begin
  if auth.uid() is null or acting('self_audited') then return null; end if;
  perform audit_event(
    case tg_table_name
      when 'allergies' then 'Changed allergies'
      when 'conditions' then 'Changed conditions'
      when 'emergency_contacts' then 'Changed emergency contacts'
      else case tg_op when 'INSERT' then 'Started tracking a vital' when 'DELETE' then 'Stopped tracking a vital' else 'Changed a tracked vital' end
    end,
    coalesce(name_of(pid), 'Patient') || coalesce(' · ' || coalesce(row_ ->> 'substance', row_ ->> 'name', row_ ->> 'vital_id'), ''),
    'patient', pid::text, pid,
    case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
do $$
declare t text;
begin
  foreach t in array array['allergies', 'conditions', 'emergency_contacts', 'tracked_vitals'] loop
    execute format('create trigger health_row_audit after insert or update or delete on %I for each row execute function health_row_audit()', t);
  end loop;
end $$;

create or replace function save_health_profile(profile jsonb) returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  snapshot text := $q$
    select jsonb_build_object(
      'sex', p.sex, 'blood_type', p.blood_type, 'no_known_allergies', p.no_known_allergies, 'no_conditions', p.no_conditions,
      'other_medicines', p.other_medicines,
      'allergies', coalesce((select jsonb_agg(jsonb_build_object('substance', a.substance, 'severity', a.severity, 'reaction', a.reaction) order by lower(a.substance))
                             from allergies a where a.patient_id = p.id), '[]'::jsonb),
      'conditions', coalesce((select jsonb_agg(c.name order by c.name) from conditions c where c.patient_id = p.id), '[]'::jsonb))
    from patients p where p.id = $1 $q$;
  was jsonb; became jsonb;
begin
  if not account_active() or my_role() is distinct from 'patient' then
    raise exception 'Only a patient can edit their health profile' using errcode = '42501';
  end if;
  if jsonb_typeof(profile) <> 'object' then raise exception 'Nothing to save' using errcode = '22023'; end if;
  execute snapshot into was using me;
  perform set_config('mcare.self_audited', '1', true);
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
  perform set_config('mcare.self_audited', '', true);

  execute snapshot into became using me;
  if was is distinct from became then
    perform audit_event('Updated health profile', coalesce(name_of(me), 'Patient'), 'patient', me::text, me, was, became);
  end if;
end $$;


/* ═══ Settings ════════════════════════════════════════════════════════
   What an administrator decides for the whole service: who must use two-step sign-in, when an
   idle session signs out, and how long records that may expire are kept. One row per area,
   changed only through save_settings(), audited, and read by everyone signed in. */
create table app_settings (
  key        text primary key check (key in ('security', 'retention')),
  value      jsonb not null check (jsonb_typeof(value) = 'object'),
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into app_settings (key, value) values
  -- Two-step sign-in is each person's choice until an admin requires it for a role.
  -- idle_minutes: 0 = never signs out for being idle.
  ('security',  '{"mfa_required_roles": [], "idle_minutes": {"admin": 15, "assistant": 15, "doctor": 15, "patient": 0}}'),
  -- null = kept for ever. The admin decides; the job apply_retention() follows.
  ('retention', '{"audit_days": null, "deleted_document_days": 30, "read_notification_days": null, "delivery_days": null}');

alter table app_settings enable row level security;
create policy app_settings_read on app_settings for select to authenticated using (true);
create policy app_settings_active_only on app_settings as restrictive for all to authenticated using (account_active()) with check (account_active());
create trigger zz_touch_topic after insert or update or delete on app_settings for each statement execute function touch_topic('settings');

/** One area of the settings. Internal: used by the rules and jobs. */
create function setting(area text) returns jsonb language sql stable security definer set search_path = public as
$$ select coalesce((select value from app_settings where key = area), '{}'::jsonb) $$;

/** A whole number setting within limits, or null when it is not set. */
create function setting_days(v jsonb, lo int, hi int, label text) returns int language plpgsql immutable as $$
declare n int;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'number' then raise exception '% must be a number of days, or empty to keep for ever', label using errcode = '22023'; end if;
  n := (v #>> '{}')::numeric::int;
  if n < lo or n > hi then raise exception '% must be between % and % days, or empty to keep for ever', label, lo, hi using errcode = '22023'; end if;
  return n;
end $$;

/** An admin changes one area of the settings. Validated here, audited with before and after. */
create function save_settings(area text, new_value jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare old_value jsonb; clean jsonb; roles text[]; idle jsonb; r text; m int; me_role user_role;
begin
  if not is_admin() then raise exception 'Only an admin can change the settings' using errcode = '42501'; end if;
  if jsonb_typeof(new_value) is distinct from 'object' then raise exception 'Nothing to save' using errcode = '22023'; end if;
  select value into old_value from app_settings where key = area for update;
  if not found then raise exception 'Unknown settings area' using errcode = '22023'; end if;

  if area = 'security' then
    roles := array(select distinct jsonb_array_elements_text(coalesce(new_value -> 'mfa_required_roles', '[]'::jsonb)) order by 1);
    if not roles <@ array['patient', 'doctor', 'admin', 'assistant'] then raise exception 'Unknown role in two-step sign-in' using errcode = '22023'; end if;
    -- Requiring it for your own role while your own session does not use it would lock you out at once.
    select role into me_role from profiles where id = auth.uid();
    if me_role::text = any (roles) and coalesce(jwt_claim('aal'), 'aal1') <> 'aal2' then
      raise exception 'Turn on two-step sign-in for your own account first (Profile → Two-step sign-in), then require it for %s.', me_role using errcode = '22023';
    end if;
    idle := '{}'::jsonb;
    foreach r in array array['admin', 'assistant', 'doctor', 'patient'] loop
      m := coalesce((new_value -> 'idle_minutes' ->> r)::numeric::int, (old_value -> 'idle_minutes' ->> r)::int, 0);
      if m <> 0 and (m < 5 or m > 720) then raise exception 'Idle sign-out must be between 5 and 720 minutes, or 0 for never' using errcode = '22023'; end if;
      idle := idle || jsonb_build_object(r, m);
    end loop;
    clean := jsonb_build_object('mfa_required_roles', to_jsonb(roles), 'idle_minutes', idle);
  elsif area = 'retention' then
    clean := jsonb_build_object(
      'audit_days',             setting_days(new_value -> 'audit_days', 180, 36500, 'Audit entries'),
      'deleted_document_days',  setting_days(new_value -> 'deleted_document_days', 1, 3650, 'Deleted documents'),
      'read_notification_days', setting_days(new_value -> 'read_notification_days', 7, 3650, 'Read notifications'),
      'delivery_days',          setting_days(new_value -> 'delivery_days', 7, 3650, 'Sent email and text records'));
  end if;

  if clean = old_value then return clean; end if;
  update app_settings set value = clean, updated_by = auth.uid(), updated_at = now() where key = area;
  perform audit_event('Changed settings', case area when 'security' then 'Security' else 'Data retention' end, 'settings', area, null, old_value, clean);
  return clean;
end $$;


/* ═══ Grants ══════════════════════════════════════════════════════════ */
revoke execute on function jwt_claim(text), request_header(text), safe_uuid(text), keep_clinical_record(), stamp_updated(),
  profile_details_audit(), guard_profile_email(), sync_profile_email(), guard_doctor_licence(), doctor_details_audit(),
  health_row_audit(), setting(text), setting_days(jsonb, int, int, text)
from public, anon, authenticated;
revoke execute on function save_settings(text, jsonb) from public, anon;
grant execute on function save_settings(text, jsonb) to authenticated;

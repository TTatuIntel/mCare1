-- mCare care team: other doctors who may read a patient's record.
--
-- A patient still has ONE treating doctor (patients.assigned_doctor_id), and
-- treats() is still the only rule that lets a doctor change anything: prescribe,
-- set targets, write notes, answer alerts, message the patient. Nothing here
-- touches that.
--
-- What is new: the treating doctor, or a care coordinator, can add a consulting
-- doctor (a specialist asked for an opinion, a colleague covering). A consulting
-- doctor READS the same record: readings, alerts, medicines, shared notes, the
-- care plan once started. They do not get internal notes, documents or private
-- messages, and cannot change the record. Every membership is a row with who
-- added it, why, and when it ended.


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

/** The caller is a consulting doctor of this patient: approved, active, and on the patient's care team now. */
create function consults(patient uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from care_team_members m join doctors d on d.id = m.doctor_id join profiles p on p.id = d.id
    where m.patient_id = patient and m.doctor_id = auth.uid() and m.ended_at is null
      and d.approval_status = 'approved' and p.status = 'active') $$;

-- Reading follows the care team; changing still follows treats() alone.
create or replace function can_see_patient(patient uuid) returns boolean language sql stable security definer set search_path = public as
$$ select patient = auth.uid() or treats(patient) or consults(patient) or staff_can('monitor_patients') $$;

create policy profiles_read_consulting on profiles for select to authenticated using (consults(id));

alter table care_team_members enable row level security;
create policy care_team_read on care_team_members for select to authenticated using (
  patient_id = auth.uid() or doctor_id = auth.uid() or treats(patient_id)
  or staff_can('assign_healthworkers') or staff_can('approve_patient_requests') or staff_can('monitor_patients'));
create policy care_team_active_only on care_team_members as restrictive for all to authenticated using (account_active()) with check (account_active());

/** The treating doctor, or a care coordinator, adds a consulting doctor to a patient's care team. */
create function add_consulting_doctor(patient uuid, doctor uuid, reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid; who text := name_of(patient); doc text := name_of(doctor); why text := nullif(trim(coalesce(reason, '')), '');
begin
  if not (treats(patient) or staff_can('assign_healthworkers')) then
    raise exception 'Only the treating doctor or the care coordination team can add a doctor to the care team' using errcode = '42501';
  end if;
  if not exists (select 1 from patients where id = patient) then raise exception 'Patient not found' using errcode = '22023'; end if;
  if not exists (select 1 from doctors d join profiles p on p.id = d.id where d.id = doctor and d.approval_status = 'approved' and p.status = 'active') then
    raise exception 'That doctor is not available' using errcode = '22023';
  end if;
  if exists (select 1 from patients where id = patient and assigned_doctor_id = doctor) then
    raise exception 'That doctor already treats this patient' using errcode = '22023';
  end if;
  if exists (select 1 from care_team_members where patient_id = patient and doctor_id = doctor and ended_at is null) then
    raise exception 'That doctor is already on the care team' using errcode = '22023';
  end if;
  insert into care_team_members (patient_id, doctor_id, reason, added_by) values (patient, doctor, left(why, 300), auth.uid()) returning id into mid;
  perform notify_about(doctor, 'assignment', 'Added to a care team', 'You can now read ' || who || '''s record as a consulting doctor' || coalesce(' · ' || why, ''),
    'patients', 'patient', patient::text);
  perform notify_user(patient, 'assignment', 'Care team updated', doc || ' can now read your record as a consulting doctor', 'care');
  perform audit_event('Added consulting doctor', who || ' ← ' || doc || coalesce(' · ' || why, ''), 'patient', patient::text, patient);
  return mid;
end $$;

/** Ends a consulting doctor's access: by whoever may add one, or by that doctor themself. */
create function remove_consulting_doctor(member uuid) returns void language plpgsql security definer set search_path = public as $$
declare m care_team_members;
begin
  select * into m from care_team_members where id = member and ended_at is null;
  if not found then raise exception 'That doctor is no longer on the care team' using errcode = '22023'; end if;
  if not (treats(m.patient_id) or staff_can('assign_healthworkers') or (m.doctor_id = auth.uid() and account_active())) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update care_team_members set ended_at = now(), ended_by = auth.uid() where id = member;
  if m.doctor_id <> auth.uid() then
    perform notify_user(m.doctor_id, 'assignment', 'Removed from a care team', 'You no longer have access to ' || name_of(m.patient_id) || '''s record', 'patients');
  end if;
  perform notify_user(m.patient_id, 'assignment', 'Care team updated', name_of(m.doctor_id) || ' no longer has access to your record', 'care');
  perform audit_event('Removed consulting doctor', name_of(m.patient_id) || ' ← ' || name_of(m.doctor_id), 'patient', m.patient_id::text, m.patient_id);
end $$;

/** A consulting doctor who becomes the treating doctor is no longer "consulting". */
create function care_team_follow_assignment() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_doctor_id is not null and new.assigned_doctor_id is distinct from old.assigned_doctor_id then
    update care_team_members set ended_at = now(), ended_by = auth.uid()
    where patient_id = new.id and doctor_id = new.assigned_doctor_id and ended_at is null;
  end if;
  return new;
end $$;
create trigger care_team_follow_assignment after update of assigned_doctor_id on patients for each row execute function care_team_follow_assignment();

create trigger zz_touch_patient after insert or update or delete on care_team_members for each row execute function touch_patient('patient_id');

-- A consulting doctor's screen stays current too.
create or replace function my_change_token() returns text language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); r user_role := my_role(); records text;
begin
  if r is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if r = 'patient' then
    select version::text into records from patient_changes where patient_id = me;
  elsif r = 'doctor' then
    select count(*) || ':' || coalesce(sum(c.version), 0) into records from patient_changes c
    where exists (select 1 from patients p where p.id = c.patient_id and p.assigned_doctor_id = me)
       or exists (select 1 from appointments a where a.patient_id = c.patient_id and a.doctor_id = me)
       or exists (select 1 from care_team_members m where m.patient_id = c.patient_id and m.doctor_id = me);
  else
    select count(*) || ':' || coalesce(sum(version), 0) into records from patient_changes;
  end if;
  return md5(concat_ws('|', r, coalesce(records, ''),
    (select string_agg(topic || version, ',' order by topic) from system_changes),
    (select count(*) || ':' || count(*) filter (where not read) || ':' || coalesce(max(created_at)::text, '') from notifications where user_id = me)));
end $$;

revoke execute on function add_consulting_doctor(uuid, uuid, text) from public, anon;
revoke execute on function remove_consulting_doctor(uuid) from public, anon;
grant execute on function add_consulting_doctor(uuid, uuid, text), remove_consulting_doctor(uuid) to authenticated;

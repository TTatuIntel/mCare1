-- mCare relationships and accounts: who treated whom and when, and what became of an account.
--
-- A patient still has one treating doctor, and `patients.assigned_doctor_id` is
-- still the one link every access rule follows (treats()). Nothing here changes
-- who can see what. It adds the history that link never kept:
--   • every assignment is a row with its start, its end, who made it and why,
--     so a doctor can see who they used to treat and staff can see how a patient's care moved
--   • removing a patient's doctor needs a reason
--   • an account's status carries who changed it, when and why; closing your own
--     account is "deactivated", which is not the same thing as being suspended


/* ─── Assignment history ───────────────────────────────────────────────
   Written by the database when patients.assigned_doctor_id changes, in the
   same transaction. At most one open assignment per patient: the same rule
   the single column already guaranteed, now with a past. */
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

insert into care_assignments (patient_id, doctor_id, reason)
select id, assigned_doctor_id, 'Assigned before assignment history was kept' from patients where assigned_doctor_id is not null;

alter table care_assignments enable row level security;
-- The patient reads their own; a doctor the rows that name them; the people who coordinate or monitor care read all.
create policy care_assignments_read on care_assignments for select to authenticated using (
  patient_id = auth.uid() or doctor_id = auth.uid()
  or staff_can('assign_healthworkers') or staff_can('approve_patient_requests') or staff_can('monitor_patients'));
create policy care_assignments_active_only on care_assignments as restrictive for all to authenticated
  using (account_active()) with check (account_active());

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
    -- Leaving a patient with no doctor is a decision someone must be able to explain later.
    if new.assigned_doctor_id is null and length(trim(coalesce(current_setting('mcare.assign_reason', true), ''))) < 5 then
      raise exception 'Say why the doctor is being removed' using errcode = '22023';
    end if;
  end if;
  if new.doctor_note is distinct from old.doctor_note and not (treats(old.id) or acting('note_action')) then
    raise exception 'Only the treating doctor can write the doctor''s note' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function patient_assignment_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text := name_of(new.id); doc text := name_of(new.assigned_doctor_id);
  why text := nullif(trim(coalesce(current_setting('mcare.assign_reason', true), '')), '');
begin
  if new.assigned_doctor_id is not distinct from old.assigned_doctor_id then return new; end if;
  -- decide_doctor_request() makes the assignment as its answer to the patient.
  if why is null and acting('assign_action') then why := 'Answer to the patient''s request for a doctor'; end if;

  update care_assignments set ended_at = now(), ended_by = auth.uid(),
    end_reason = coalesce(why, case when new.assigned_doctor_id is null then null else 'Moved to ' || doc end)
  where patient_id = new.id and ended_at is null;
  if new.assigned_doctor_id is not null then
    insert into care_assignments (patient_id, doctor_id, assigned_by, reason) values (new.id, new.assigned_doctor_id, auth.uid(), why);
  end if;

  if new.assigned_doctor_id is not null then
    perform notify_about(new.assigned_doctor_id, 'assignment', 'New patient assigned', who || ' is now under your care', 'patients', 'patient', new.id::text);
    if not acting('assign_action') then
      perform notify_user(new.id, 'assignment', 'Care team updated', doc || ' is now your doctor', 'care');
    end if;
    update doctor_requests set status = case when doctor_id = new.assigned_doctor_id then 'approved' else 'rejected' end::request_status,
      response_note = case when doctor_id = new.assigned_doctor_id then response_note else 'You were assigned to ' || doc end,
      decided_by = auth.uid(), decided_at = now()
    where patient_id = new.id and status = 'pending';
  else
    perform notify_user(new.id, 'assignment', 'Care team updated', 'You no longer have an assigned doctor. The care team will assign one.', 'care');
  end if;
  if old.assigned_doctor_id is not null then
    perform notify_user(old.assigned_doctor_id, 'assignment', 'Patient reassigned',
      who || case when new.assigned_doctor_id is null then ' is no longer under your care' else ' has moved to another doctor' end, 'patients');
  end if;
  perform audit_event(case when new.assigned_doctor_id is null then 'Removed doctor assignment' else 'Assigned doctor' end,
    who || coalesce(' → ' || doc, '') || coalesce(' · ' || why, ''), 'patient', new.id::text, new.id,
    jsonb_build_object('doctor', old.assigned_doctor_id), jsonb_build_object('doctor', new.assigned_doctor_id));
  return new;
end $$;

/** Assigns a doctor to a patient, moves the patient to another doctor, or (with `doctor` null) removes the doctor. One transaction. */
create function assign_doctor(patient uuid, doctor uuid, reason text default null) returns void language plpgsql set search_path = public as $$
begin
  if not staff_can('assign_healthworkers') then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform set_config('mcare.assign_reason', left(trim(coalesce(reason, '')), 300), true);
  update patients set assigned_doctor_id = doctor where id = patient;
  if not found then raise exception 'Patient not found' using errcode = '22023'; end if;
  perform set_config('mcare.assign_reason', '', true);
end $$;

/** A doctor's former patients: who, and when the care ended. Names only: their records are no longer the doctor's to open. */
create function my_past_patients() returns table (patient_id uuid, full_name text, started_at timestamptz, ended_at timestamptz, end_reason text)
language sql stable security definer set search_path = public as $$
  select a.patient_id, p.full_name, a.started_at, a.ended_at, a.end_reason
  from care_assignments a join profiles p on p.id = a.patient_id
  where a.doctor_id = auth.uid() and a.ended_at is not null and my_role() = 'doctor'
    and not exists (select 1 from patients pt where pt.id = a.patient_id and pt.assigned_doctor_id = auth.uid())
  order by a.ended_at desc
$$;


/* ─── Account status ───────────────────────────────────────────────────
   active        can use mCare
   suspended     stopped by an administrator; a reason is required
   deactivated   closed: by the person themself, or by an administrator when someone has left
   Either way the record and everything the person did are kept, and an
   administrator can make the account active again. (pending_approval is a
   doctor waiting to be approved; "invited" is an open row in
   account_invitations: there is no account yet, so no status to hold.) */
alter table profiles add column status_reason     text check (status_reason is null or length(status_reason) <= 300);
alter table profiles add column status_changed_by uuid references profiles (id) on delete set null;
alter table profiles add column status_changed_at timestamptz;

create or replace function my_role() returns user_role language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and status not in ('suspended', 'deactivated') $$;

create or replace function account_active() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and status not in ('suspended', 'deactivated')) $$;

create or replace function guard_profile() returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); why text := nullif(trim(coalesce(current_setting('mcare.status_reason', true), '')), '');
begin
  if new.dob is not null and (new.dob > current_date or new.dob < date '1900-01-01') then
    raise exception 'Enter a valid date of birth' using errcode = '22023';
  end if;
  if new.avatar is not null and length(new.avatar::text) > 400000 then
    raise exception 'That photo is too large' using errcode = '22023';
  end if;

  -- Who changed the status, when and why are the server's to write.
  if new.status is distinct from old.status then
    new.status_changed_at := now(); new.status_changed_by := me; new.status_reason := why;
  else
    new.status_changed_at := old.status_changed_at; new.status_changed_by := old.status_changed_by; new.status_reason := old.status_reason;
  end if;
  if me is null then return new; end if;   -- the service role

  if old.status = 'active' and new.status <> 'active' then
    if old.role = 'admin' and not exists (select 1 from profiles where role = 'admin' and status = 'active' and id <> old.id) then
      raise exception 'mCare needs at least one active administrator' using errcode = '22023';
    end if;
    if old.role = 'doctor' and exists (select 1 from patients where assigned_doctor_id = old.id) then
      raise exception 'This doctor still has patients. Move them to another doctor first.' using errcode = '22023';
    end if;
  end if;
  if acting('account_action') then return new; end if;

  if not is_admin() then
    if new.role is distinct from old.role or new.status is distinct from old.status or new.email is distinct from old.email then
      raise exception 'You cannot change role, status or email' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role then
    raise exception 'A role cannot be changed. Register the person again with the role they need.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if new.id = me then
      raise exception 'You cannot change the status of your own account' using errcode = '42501';
    end if;
    if new.status in ('unverified', 'pending_approval') then
      raise exception 'An account can be made active, suspended or deactivated' using errcode = '22023';
    end if;
    if new.status in ('suspended', 'deactivated') and coalesce(length(why), 0) < 5 then
      raise exception 'Give a reason for stopping this account' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create or replace function profile_status_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare stopped boolean := new.status in ('suspended', 'deactivated'); was_stopped boolean := old.status in ('suspended', 'deactivated');
begin
  if auth.uid() is null or auth.uid() = new.id then return new; end if;   -- closing your own account is audited by deactivate_my_account()
  if stopped or was_stopped then
    perform audit_event(
      case when new.status = 'suspended' then 'Suspended user' when new.status = 'deactivated' then 'Deactivated user' else 'Reactivated user' end,
      new.full_name || coalesce(' · ' || new.status_reason, ''), 'account', new.id::text,
      case when new.role = 'patient' then new.id end, jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
    if stopped and not was_stopped then
      perform notify_user(new.id, 'account', case when new.status = 'suspended' then 'Your account was suspended' else 'Your account was deactivated' end,
        coalesce(new.status_reason, ''), null);
    elsif was_stopped and new.status = 'active' then
      perform notify_user(new.id, 'account', 'Your account is active again', 'You can use mCare as before.', null);
    end if;
  end if;
  return new;
end $$;

/** An administrator makes an account active, suspends it or deactivates it. Stopping one needs a reason. */
create function set_account_status(person uuid, new_status account_status, reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only an administrator can change an account''s status' using errcode = '42501'; end if;
  perform set_config('mcare.status_reason', left(trim(coalesce(reason, '')), 300), true);
  update profiles set status = new_status where id = person;
  if not found then raise exception 'Account not found' using errcode = '22023'; end if;
  perform set_config('mcare.status_reason', '', true);
  -- On hosted Supabase, an account that was stopped is also signed out everywhere. Row rules already refuse it either way.
  if new_status in ('suspended', 'deactivated') and to_regclass('auth.sessions') is not null then
    begin
      execute 'delete from auth.sessions where user_id = $1' using person;
    exception when others then null;
    end;
  end if;
end $$;

/** Someone closes their own account. Their record is kept; an administrator can make it active again. */
create or replace function deactivate_my_account() returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); who text;
begin
  if me is null or not account_active() then raise exception 'Sign in first' using errcode = '42501'; end if;
  select full_name into who from profiles where id = me;
  perform set_config('mcare.account_action', '1', true);
  perform set_config('mcare.status_reason', 'Closed by the account holder', true);
  update profiles set status = 'deactivated' where id = me;
  perform set_config('mcare.status_reason', '', true);
  perform set_config('mcare.account_action', '', true);
  perform audit_event('Deactivated own account', who, 'account', me::text, null, null, null, me);
  perform notify_staff('create_users', 'account', 'Account deactivated', who || ' closed their account', 'users');
end $$;

revoke execute on function assign_doctor(uuid, uuid, text) from public, anon;
revoke execute on function my_past_patients() from public, anon;
revoke execute on function set_account_status(uuid, account_status, text) from public, anon;
grant execute on function assign_doctor(uuid, uuid, text), my_past_patients(), set_account_status(uuid, account_status, text) to authenticated;

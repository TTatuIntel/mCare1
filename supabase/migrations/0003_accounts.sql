-- mCare accounts and administration: sign-up, invitations, account status,
-- doctor approval, staff permissions, doctor assignment and the care team,
-- the patient's own profile, support requests and the admin reports.


/* ═══ New accounts ════════════════════════════════════════════════════
   Supabase Auth creates auth.users; these create the mCare profile beside it.
   A sign-up can only ever become a patient, or a doctor awaiting approval. An
   invited email gets the invitation's role; staff roles only once the email
   address is confirmed. */
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare
  inv account_invitations;
  invited boolean;
  wants_doctor boolean := coalesce(new.raw_user_meta_data ->> 'role', '') = 'doctor';
begin
  select * into inv from account_invitations
  where email = lower(trim(new.email)) and accepted_at is null and revoked_at is null and expires_at > now();
  invited := found;
  if invited and inv.role = 'doctor' then wants_doctor := true; end if;
  if invited and inv.role = 'patient' then wants_doctor := false; end if;

  insert into profiles (id, role, status, full_name, email, phone, dob)
  values (new.id,
          case when wants_doctor then 'doctor' else 'patient' end::user_role,
          case when wants_doctor then 'pending_approval' else 'active' end::account_status,
          coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), case when invited then inv.full_name end, split_part(new.email, '@', 1)),
          new.email,
          coalesce(nullif(new.raw_user_meta_data ->> 'phone', ''), case when invited then inv.phone end, ''),
          nullif(new.raw_user_meta_data ->> 'dob', '')::date);
  if wants_doctor then
    insert into doctors (id) values (new.id);
  else
    insert into patients (id) values (new.id);
    insert into tracked_vitals (patient_id, vital_id) select new.id, id from vital_defs where id in ('bp', 'hr');
  end if;

  if invited and inv.role in ('patient', 'doctor') then
    update account_invitations set accepted_by = new.id, accepted_at = now() where id = inv.id;
    if inv.invited_by is not null then
      perform notify_user(inv.invited_by, 'account', 'Invitation accepted', inv.full_name || ' joined as ' || inv.role, 'users');
    end if;
  elsif invited and new.email_confirmed_at is not null then
    perform apply_staff_invitation(new.id, new.email);
  end if;
  return new;
end $$;

create function handle_user_confirmed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform apply_staff_invitation(new.id, new.email);
  end if;
  return new;
end $$;

/** Turns a confirmed new account into the staff role it was invited for. Does nothing without an open staff invitation. */
create function apply_staff_invitation(person uuid, address text) returns void
language plpgsql security definer set search_path = public as $$
declare inv account_invitations;
begin
  select * into inv from account_invitations
  where email = lower(trim(address)) and role in ('admin', 'assistant')
    and accepted_at is null and revoked_at is null and expires_at > now() for update;
  if not found then return; end if;
  perform set_config('mcare.account_action', '1', true);
  update profiles set role = inv.role, status = 'active' where id = person;
  perform set_config('mcare.account_action', '', true);
  -- The account is new: the patient or doctor row made at sign-up holds nothing yet.
  delete from patients where id = person;
  delete from doctors where id = person;
  insert into staff (id, is_assistant, permissions) values (person, inv.role = 'assistant', '{}') on conflict (id) do nothing;
  update account_invitations set accepted_by = person, accepted_at = now() where id = inv.id;
  if inv.invited_by is not null then
    perform notify_user(inv.invited_by, 'account', 'Invitation accepted', inv.full_name || ' joined as ' || inv.role, 'users');
  end if;
  insert into audit_log (actor_id, action, detail) values (person, 'Accepted invitation', inv.full_name || ' (' || inv.role || ')');
end $$;

create function invite_account(invite_email text, invite_name text, invite_role user_role, invite_phone text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  addr text := lower(trim(coalesce(invite_email, '')));
  nm text := trim(coalesce(invite_name, ''));
  iid uuid;
begin
  if not staff_can('create_users') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if invite_role in ('admin', 'assistant') and not is_admin() then
    raise exception 'Only an admin can invite staff' using errcode = '42501';
  end if;
  if addr !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address' using errcode = '22023'; end if;
  if nm = '' then raise exception 'Enter their name' using errcode = '22023'; end if;
  if exists (select 1 from profiles p where lower(p.email) = addr) then
    raise exception 'That email is already registered' using errcode = '22023';
  end if;
  -- An invitation that ran out is replaced by the new one.
  update account_invitations set revoked_at = now()
  where email = addr and accepted_at is null and revoked_at is null and expires_at <= now();
  if exists (select 1 from account_invitations where email = addr and accepted_at is null and revoked_at is null) then
    raise exception 'That email has already been invited' using errcode = '22023';
  end if;
  insert into account_invitations (email, full_name, phone, role, invited_by)
  values (addr, nm, left(trim(coalesce(invite_phone, '')), 32), invite_role, auth.uid())
  returning id into iid;
  perform audit_event('Invited user', nm || ' (' || invite_role || ') · ' || addr, 'invitation', iid::text);
  insert into notification_deliveries (channel, to_address, subject, body, link)
  values ('email', addr, 'You have been invited to mCare',
    'Hello ' || nm || ', ' || coalesce(name_of(auth.uid()), 'the mCare team') || ' has registered you on mCare as '
      || case invite_role when 'patient' then 'a patient' when 'doctor' then 'a doctor' when 'admin' then 'an administrator' else 'an mCare assistant' end
      || '. Open mCare and sign up with this email address (' || addr || ') to start. The invitation is valid for 14 days.',
    'signup');
  return iid;
end $$;

create function revoke_invitation(invitation uuid) returns void language plpgsql security definer set search_path = public as $$
declare inv account_invitations;
begin
  if not staff_can('create_users') then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into inv from account_invitations where id = invitation and accepted_at is null and revoked_at is null for update;
  if not found then raise exception 'That invitation is no longer open' using errcode = '22023'; end if;
  if inv.role in ('admin', 'assistant') and not is_admin() then
    raise exception 'Only an admin can withdraw a staff invitation' using errcode = '42501';
  end if;
  update account_invitations set revoked_at = now() where id = invitation;
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Withdrew invitation', inv.full_name || ' (' || inv.role || ') · ' || inv.email);
end $$;


create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users for each row execute function handle_user_confirmed();


/* ═══ Account status ══════════════════════════════════════════════════
   active · suspended (by an administrator, with a reason) · deactivated (closed by
   the person, or by an administrator when someone has left). The record and
   everything the person did are kept; an administrator can make it active again. */
create function guard_profile() returns trigger language plpgsql security definer set search_path = public as $$
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

create function profile_status_audit() returns trigger language plpgsql security definer set search_path = public as $$
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
create function deactivate_my_account() returns void language plpgsql security definer set search_path = public as $$
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


create trigger guard_profile before update on profiles for each row execute function guard_profile();
create trigger profile_status_audit after update of status on profiles for each row execute function profile_status_audit();


/* ═══ Doctors and staff ═══════════════════════════════════════════════ */
create function guard_doctor() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or staff_can('approve_doctors') or acting('doctor_action') then return new; end if;
  if new.approval_status is distinct from old.approval_status or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at or new.approval_note is distinct from old.approval_note then
    raise exception 'Only an approver can change approval' using errcode = '42501';
  end if;
  return new;
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

create function staff_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare was text[] := '{}';
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.permissions = old.permissions then return new; end if;
    was := old.permissions;
  elsif cardinality(new.permissions) = 0 then
    return new;
  end if;
  perform audit_event('Changed assistant permissions',
    coalesce(name_of(new.id), 'Staff') || ': ' || coalesce(nullif(array_to_string(new.permissions, ', '), ''), 'none'),
    'staff', new.id::text, null, to_jsonb(was), to_jsonb(new.permissions));
  perform notify_user(new.id, 'account', 'Your permissions changed',
    'You can now: ' || coalesce(nullif(replace(array_to_string(new.permissions, ', '), '_', ' '), ''), 'nothing yet'), null);
  return new;
end $$;


create trigger guard_doctor before update on doctors for each row execute function guard_doctor();
create trigger staff_audit after insert or update on staff for each row execute function staff_audit();


/* ═══ Assignment and care team ════════════════════════════════════════
   A patient has one treating doctor (patients.assigned_doctor_id), the one link
   treats() follows. Every change is kept in care_assignments. Consulting doctors
   read the record and change nothing. */
create function guard_patient() returns trigger language plpgsql as $$
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

create function patient_assignment_changed() returns trigger language plpgsql security definer set search_path = public as $$
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

create function patient_privacy_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.docs_private_default is distinct from old.docs_private_default then
    perform audit_event('Changed document privacy default',
      case when new.docs_private_default then 'New uploads are private' else 'New uploads are shared with the care team' end,
      'patient', new.id::text, new.id);
  end if;
  return new;
end $$;

/** Staff who monitor patients open one patient's vitals: recorded once per person, patient and quarter hour. */
create function log_patient_view(patient uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not staff_can('monitor_patients') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from patients where id = patient) then raise exception 'Patient not found' using errcode = '22023'; end if;
  if exists (select 1 from audit_log where actor_id = auth.uid() and action = 'Viewed patient vitals'
             and patient_id = patient and created_at > now() - interval '15 minutes') then
    return;
  end if;
  perform audit_event('Viewed patient vitals', name_of(patient), 'patient', patient::text, patient);
end $$;


create trigger guard_patient before update on patients for each row execute function guard_patient();
create trigger patient_assignment_changed after update of assigned_doctor_id on patients for each row execute function patient_assignment_changed();
create trigger care_team_follow_assignment after update of assigned_doctor_id on patients for each row execute function care_team_follow_assignment();
create trigger patient_privacy_audit after update of docs_private_default on patients for each row execute function patient_privacy_audit();


/* ═══ The patient's own profile ═══════════════════════════════════════
   Saves that touch several rows are functions, so each is one transaction. */
/** Records that the caller accepted the Terms and the Privacy Policy now, at the server's time. */
create function accept_terms(doc_version text default '1') returns timestamptz language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or my_role() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  insert into consents (user_id, kind, granted, version) values (me, 'terms', true, doc_version), (me, 'privacy', true, doc_version);
  return now();
end $$;

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

create function doctor_rating_before() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.comment := nullif(trim(coalesce(new.comment, '')), '');
  return new;
end $$;

/** The average and how many patients rated, for the doctor directory. Never who rated or what they wrote. */
create function doctor_rating_summary(doctor uuid) returns table (average numeric, ratings int)
language sql stable security definer set search_path = public as
$$ select round(avg(rating), 1), count(*)::int from doctor_ratings where doctor_id = doctor and auth.uid() is not null $$;


create trigger doctor_rating_before before insert or update on doctor_ratings for each row execute function doctor_rating_before();


/* ═══ Support requests ════════════════════════════════════════════════ */
create function support_ticket_before() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    if old.status = 'resolved' then
      raise exception 'That request has already been answered' using errcode = '22023';
    end if;
    if (new.user_id, new.subject, new.message, new.created_at) is distinct from (old.user_id, old.subject, old.message, old.created_at) then
      raise exception 'A support request cannot be rewritten' using errcode = '42501';
    end if;
  end if;
  new.resolution_note := nullif(trim(coalesce(new.resolution_note, '')), '');
  if new.status = 'resolved' and old.status <> 'resolved' then
    new.resolved_at := now(); new.resolved_by := coalesce(auth.uid(), new.resolved_by);
  end if;
  return new;
end $$;

create function support_ticket_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into notifications (user_id, kind, title, body, link, resource_type, resource_id)
    select p.id, 'support', 'Support request: ' || coalesce(name_of(new.user_id), 'User'), new.subject, 'support', 'support_ticket', new.id::text
    from profiles p left join staff s on s.id = p.id
    where p.status = 'active' and (p.role = 'admin' or (p.role = 'assistant' and 'handle_support' = any (s.permissions)));
  elsif new.status = 'resolved' and old.status <> 'resolved' then
    perform notify_user(new.user_id, 'support', 'Support request answered',
      coalesce(new.resolution_note, '"' || new.subject || '" has been resolved.'), null);
    perform audit_event('Answered support request', coalesce(name_of(new.user_id), 'User') || ' · ' || new.subject, 'support_ticket', new.id::text);
  end if;
  return new;
end $$;


create trigger support_ticket_before before update on support_tickets for each row execute function support_ticket_before();
create trigger support_ticket_notify after insert or update on support_tickets for each row execute function support_ticket_notify();


/* ═══ Reports and the audit search ════════════════════════════════════ */
create function admin_report(from_day date, to_day date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f timestamptz := from_day::timestamptz; t timestamptz := (to_day + 1)::timestamptz;
begin
  if not (is_admin() or staff_can('view_logs')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if from_day is null or to_day is null or from_day > to_day or to_day - from_day > 366 then
    raise exception 'Choose a period of up to a year' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'from', from_day, 'to', to_day,
    'accounts', (select coalesce(jsonb_object_agg(role, n), '{}'::jsonb) from (select role::text, count(*) n from profiles where status = 'active' group by role) x),
    'registered', (select coalesce(jsonb_object_agg(role, n), '{}'::jsonb) from (select role::text, count(*) n from profiles where created_at >= f and created_at < t group by role) x),
    'stopped', (select count(*) from profiles where status in ('suspended', 'deactivated')),
    'waiting', jsonb_build_object(
      'doctor_approvals', (select count(*) from doctors where approval_status in ('pending', 'sent_back')),
      'doctor_requests', (select count(*) from doctor_requests where status = 'pending'),
      'patients_without_doctor', (select count(*) from patients pt join profiles p on p.id = pt.id where p.status = 'active' and pt.assigned_doctor_id is null),
      'invitations', (select count(*) from account_invitations where accepted_at is null and revoked_at is null and expires_at > now()),
      'support_requests', (select count(*) from support_tickets where status = 'open'),
      'open_alerts', (select count(*) from alerts where status <> 'resolved')),
    'appointments', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status::text, count(*) n from appointments where created_at >= f and created_at < t group by status) x),
    'alerts', (select jsonb_build_object(
        'raised', count(*),
        'critical', count(*) filter (where severity = 'danger' and type = 'vital'),
        'sos', count(*) filter (where type = 'sos'),
        'escalated', count(*) filter (where escalated_at is not null),
        'resolved', count(*) filter (where status = 'resolved'),
        'minutes_to_acknowledge', round(avg(extract(epoch from (acknowledged_at - created_at)) / 60) filter (where acknowledged_at is not null)),
        'minutes_to_resolve', round(avg(extract(epoch from (resolved_at - created_at)) / 60) filter (where resolved_at is not null)))
      from alerts where created_at >= f and created_at < t),
    'activity', jsonb_build_object(
      'readings', (select count(*) from readings where taken_at >= f and taken_at < t),
      'patients_recording', (select count(distinct patient_id) from readings where taken_at >= f and taken_at < t),
      'prescriptions', (select count(*) from prescriptions where prescribed_at >= f and prescribed_at < t),
      'documents', (select count(*) from documents where created_at >= f and created_at < t),
      'messages', (select count(*) from messages where created_at >= f and created_at < t)),
    'support', jsonb_build_object(
      'opened', (select count(*) from support_tickets where created_at >= f and created_at < t),
      'answered', (select count(*) from support_tickets where resolved_at >= f and resolved_at < t)),
    'doctors', (select coalesce(jsonb_agg(row order by (row ->> 'patients')::int desc, row ->> 'name'), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', d.id, 'name', p.full_name,
        'patients', (select count(*) from patients pt where pt.assigned_doctor_id = d.id),
        'open_alerts', (select count(*) from alerts a join patients pt on pt.id = a.patient_id where pt.assigned_doctor_id = d.id and a.status <> 'resolved'),
        'visits', (select count(*) from appointments a where a.doctor_id = d.id and a.created_at >= f and a.created_at < t),
        'completed', (select count(*) from appointments a where a.doctor_id = d.id and a.status = 'completed' and a.created_at >= f and a.created_at < t)) as row
      from doctors d join profiles p on p.id = d.id where d.approval_status = 'approved' and p.status = 'active') x));
end $$;

/** The whole audit trail searched in the database: by words in the action or detail, by the
    name of the person who did it, and by the kind of person. One page, newest first; `before` is
    the id of the oldest entry already shown. Runs as the caller, so the row rule on audit_log still
    decides who may read the trail at all ("View audit logs"). */
create function search_audit(q text default null, who text default null, before bigint default null, page_size int default 100)
returns setof audit_log language sql stable set search_path = public as $$
  select a.* from audit_log a
  where (before is null or a.id < before)
    and (coalesce(who, 'all') = 'all'
      or (who = 'system' and a.actor_role is null)
      or (who = 'staff' and a.actor_role in ('admin', 'assistant'))
      or (who in ('patient', 'doctor') and a.actor_role::text = who))
    and (nullif(trim(coalesce(q, '')), '') is null
      or a.action ilike '%' || trim(q) || '%'
      or a.detail ilike '%' || trim(q) || '%'
      or exists (select 1 from profiles p where p.id = a.actor_id and p.full_name ilike '%' || trim(q) || '%'))
  order by a.id desc
  limit greatest(1, least(coalesce(page_size, 100), 300))
$$;

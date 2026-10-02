-- mCare care integration: the places where the doctor, admin and assistant
-- portals touched a patient's record without the database behind them.
--
-- The patient module (0004) made the patient's own actions real. This closes
-- what the other roles still did only in the browser, or could not do at all:
--   • an admin registers someone: an invitation, honoured when that person signs up
--   • the treating doctor sets the meal plan the patient follows; it is validated, announced and audited
--   • a reading the doctor records for a patient is announced to the patient and audited
--   • a follow-up booked from an alert and the alert's resolution are one transaction
--   • changes to a vital's definition are checked and audited
--   • staff who support documents can restore and purge from the registry of metadata they already had
--
-- Nothing here copies a patient's data: every row still hangs off patients.id.


/* ─── Invitations ──────────────────────────────────────────────────────
   Accounts are created by the sign-in service, by the person themself.
   An admin cannot create one for somebody else, but can say in advance
   what that person will be: the invitation is matched by email when they
   sign up. A patient or doctor invitation takes effect at once (it grants
   nothing a sign-up could not ask for). A staff invitation takes effect
   only once the email address has been confirmed, so knowing that someone
   was invited is not enough to take their place. */
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

alter table account_invitations enable row level security;
-- Read by the people who register users. Written only through the functions below.
create policy account_invitations_read on account_invitations for select to authenticated using (staff_can('create_users'));
create policy account_invitations_active_only on account_invitations as restrictive for all to authenticated
  using (account_active()) with check (account_active());

/** Registers someone in advance. Only a full admin may invite staff. */
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
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Invited user', nm || ' (' || invite_role || ') · ' || addr);
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
revoke execute on function apply_staff_invitation(uuid, text) from public, anon, authenticated;

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
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
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users for each row execute function handle_user_confirmed();


/* ─── Nutrition: the plan the treating doctor sets ─────────────────── */
alter table meal_plans add constraint meal_plans_note_length check (dietary_note is null or length(dietary_note) <= 1000);

create function meal_plan_before() returns trigger language plpgsql as $$
declare m jsonb; mid text; seen text[] := '{}';
begin
  if tg_op = 'UPDATE' and new.patient_id <> old.patient_id then
    raise exception 'A meal plan cannot be moved to another patient' using errcode = '42501';
  end if;
  new.updated_at := now();
  new.set_by := coalesce(auth.uid(), new.set_by);   -- the doctor who saved it, never what the browser sent
  new.dietary_note := nullif(trim(coalesce(new.dietary_note, '')), '');
  if jsonb_typeof(new.meals) <> 'array' then raise exception 'Meals must be a list' using errcode = '22023'; end if;
  if jsonb_array_length(new.meals) > 8 then raise exception 'A plan can hold up to 8 meals' using errcode = '22023'; end if;
  for m in select * from jsonb_array_elements(new.meals) loop
    mid := trim(coalesce(m ->> 'id', ''));
    if mid = '' or length(mid) > 40 or mid = any (seen) then
      raise exception 'Each meal needs its own id' using errcode = '22023';
    end if;
    if length(trim(coalesce(m ->> 'name', ''))) not between 1 and 60 then
      raise exception 'Give each meal a name' using errcode = '22023';
    end if;
    if length(coalesce(m ->> 'foods', '')) > 300 then
      raise exception 'Keep what to eat under 300 characters' using errcode = '22023';
    end if;
    if jsonb_typeof(m -> 'at') is distinct from 'number' or (m ->> 'at')::numeric not between 0 and 1439 then
      raise exception 'Give each meal a time' using errcode = '22023';
    end if;
    if jsonb_typeof(m -> 'kcal') is distinct from 'number' or (m ->> 'kcal')::numeric not between 0 and 3000 then
      raise exception 'Energy for a meal must be between 0 and 3000 kcal' using errcode = '22023';
    end if;
    seen := seen || mid;
  end loop;
  return new;
end $$;
create trigger meal_plan_before before insert or update on meal_plans for each row execute function meal_plan_before();

/** The patient is told when their plan changes; the change is audited. */
create function meal_plan_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare pt uuid := coalesce(new.patient_id, old.patient_id); doc text := coalesce(name_of(auth.uid()), 'Your doctor');
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    perform notify_user(pt, 'message', 'Your meal plan was removed', doc || ' put you back on the standard meal plan', 'meals');
    insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Removed meal plan', name_of(pt));
    return old;
  end if;
  perform notify_user(pt, 'message', 'Your meal plan was updated',
    doc || ' set your meals' || coalesce(' · ' || new.target_kcal || ' kcal a day', '') || ' · ' || new.water_goal || ' glasses of water', 'meals');
  insert into audit_log (actor_id, action, detail)
  values (auth.uid(), 'Set meal plan', name_of(pt) || ' · ' || jsonb_array_length(new.meals) || ' meals' || coalesce(' · ' || new.target_kcal || ' kcal', ''));
  return new;
end $$;
create trigger meal_plan_changed after insert or update or delete on meal_plans for each row execute function meal_plan_changed();


/* ─── A reading the care team records for the patient ──────────────── */
create function reading_recorded_for_patient() returns trigger language plpgsql security definer set search_path = public as $$
declare d vital_defs;
begin
  if new.recorded_by is null or new.recorded_by = new.patient_id then return new; end if;
  select * into d from vital_defs where id = new.vital_id;
  perform notify_user(new.patient_id, 'message', 'A reading was added to your record',
    coalesce(name_of(new.recorded_by), 'Your doctor') || ' recorded ' || d.name || ' ' || new.value || ' ' || d.unit, 'vitals');
  insert into audit_log (actor_id, action, detail)
  values (new.recorded_by, 'Recorded reading for patient', name_of(new.patient_id) || ' · ' || d.name || ' ' || new.value || ' ' || d.unit);
  return new;
end $$;
create trigger reading_recorded_for_patient after insert on readings for each row execute function reading_recorded_for_patient();


/* ─── Follow-up from an alert: the visit and the resolution together ── */
create function schedule_follow_up(patient uuid, visit_date date, visit_time time default null, visit_note text default null, alert uuid default null)
returns uuid language plpgsql set search_path = public as $$
declare aid uuid; clean text := nullif(trim(coalesce(visit_note, '')), '');
begin
  if not treats(patient) then raise exception 'Only the treating doctor can book a follow-up' using errcode = '42501'; end if;
  if visit_date is null or visit_date < current_date then raise exception 'Choose a date from today onwards' using errcode = '22023'; end if;
  insert into appointments (patient_id, doctor_id, title, reason, preferred_date, preferred_time, status, approval_note)
  values (patient, auth.uid(), 'Follow-up appointment', coalesce(clean, 'Scheduled from alert review'), visit_date, visit_time, 'approved', clean)
  returning id into aid;
  if alert is not null then
    update alerts set status = 'resolved', resolution_reason = 'Appointment scheduled', resolution_note = clean
    where id = alert and patient_id = patient and status <> 'resolved';
    if not found then raise exception 'That alert is already resolved' using errcode = '22023'; end if;
  end if;
  return aid;
end $$;


/* ─── Vital definitions ────────────────────────────────────────────── */
alter table vital_defs add constraint vital_defs_named check (length(trim(name)) between 1 and 60 and length(trim(unit)) between 1 and 20);
alter table vital_defs add constraint vital_defs_normal_order check (normal_min < normal_max);
alter table vital_defs add constraint vital_defs_plausible_order check (hard_min < hard_max);

create function vital_def_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Added vital type', new.name);
  elsif new.active <> old.active then
    insert into audit_log (actor_id, action, detail)
    values (auth.uid(), case when new.active then 'Activated vital type' else 'Deactivated vital type' end, new.name);
  elsif to_jsonb(new) is distinct from to_jsonb(old) then
    insert into audit_log (actor_id, action, detail)
    values (auth.uid(), 'Updated vital definition', new.name || ': normal ' || new.normal_min || '–' || new.normal_max);
  end if;
  return new;
end $$;
create trigger vital_def_audit after insert or update on vital_defs for each row execute function vital_def_audit();


/* ─── Documents: what staff may do ─────────────────────────────────────
   Staff never read a document's row. document_registry() (0002) tells them
   that a document exists, whose it is, its kind and its state; these two
   functions let them recover and purge from that list. */
/** Support brings back a document deleted in the last 30 days. The patient is told when it is their own upload. */
create function staff_restore_document(doc uuid) returns void language plpgsql security definer set search_path = public as $$
declare d documents;
begin
  if not staff_can('document_support') then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into d from documents where id = doc and deleted_at is not null for update;
  if not found then raise exception 'That document is not deleted' using errcode = '22023'; end if;
  if d.deleted_at < now() - interval '30 days' then raise exception 'This document can no longer be restored' using errcode = '22023'; end if;
  perform set_config('mcare.doc_action', '1', true);
  begin
    update documents set deleted_at = null, deleted_by = null where id = doc;
  exception when unique_violation then
    raise exception 'The same file has been added again since; nothing to restore' using errcode = '22023';
  end;
  perform set_config('mcare.doc_action', '', true);
  if d.origin = 'patient_upload' then
    perform notify_user(d.patient_id, 'document', 'A document was restored', 'One of your documents was recovered by mCare support', 'docs');
  end if;
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Restored document', d.category::text || ' · ' || name_of(d.patient_id));
end $$;

/** A full admin removes, now, what the nightly job would remove: documents deleted more than 30 days ago. */
create function purge_expired_documents() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'Only an admin can purge documents' using errcode = '42501'; end if;
  n := purge_deleted_documents();
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Purged expired documents', n || ' past the 30-day recovery window');
  return n;
end $$;


/* ─── Who may call the functions ───────────────────────────────────── */
revoke execute on function invite_account(text, text, user_role, text) from public, anon;
revoke execute on function revoke_invitation(uuid) from public, anon;
revoke execute on function schedule_follow_up(uuid, date, time, text, uuid) from public, anon;
revoke execute on function staff_restore_document(uuid) from public, anon;
revoke execute on function purge_expired_documents() from public, anon;
grant execute on function invite_account(text, text, user_role, text), revoke_invitation(uuid),
  schedule_follow_up(uuid, date, time, text, uuid), staff_restore_document(uuid),
  purge_expired_documents() to authenticated;

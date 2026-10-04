-- mCare two-step sign-in, account lifecycle and support acting for someone.
--
-- Two-step sign-in (TOTP, Supabase Auth MFA) is enforced by the database, not the sign-in screen:
-- once a person has a verified factor, or an admin requires it for their role, a session that has
-- not passed the second step (token claim aal = 'aal1') reads and changes nothing. Every "who is
-- asking" helper checks it, so row rules and the functions the app calls refuse alike.


/* ═══ Two-step sign-in ════════════════════════════════════════════════ */
/** The caller has a verified second factor. Read from Supabase Auth's own table. */
create function has_verified_factor(person uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if person is null or to_regclass('auth.mfa_factors') is null then return false; end if;
  return exists (select 1 from auth.mfa_factors f where f.user_id = person and f.status::text = 'verified');
end $$;

/** True when this session may act: it passed the second step, or it does not need one. Jobs and the service key always may. */
create function mfa_ok() returns boolean language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); r text;
begin
  if me is null or coalesce(jwt_claim('aal'), '') = 'aal2' then return true; end if;
  if has_verified_factor(me) then return false; end if;
  select role::text into r from profiles where id = me;
  return not coalesce(r = any (array(select jsonb_array_elements_text(coalesce(setting('security') -> 'mfa_required_roles', '[]'::jsonb)))), false);
end $$;

-- The same helpers, now also requiring the second step where it applies. Signatures are unchanged.
create or replace function my_role() returns user_role language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and status not in ('suspended', 'deactivated') and mfa_ok() $$;

create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'admin' from profiles where id = auth.uid() and status = 'active'), false) and mfa_ok() $$;

create or replace function staff_can(perm text) returns boolean language sql stable security definer set search_path = public as
$$ select is_admin() or (exists (
     select 1 from profiles p join staff s on s.id = p.id
     where p.id = auth.uid() and p.status = 'active' and p.role = 'assistant' and perm = any (s.permissions)) and mfa_ok()) $$;

create or replace function treats(patient uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from patients pt join doctors d on d.id = pt.assigned_doctor_id join profiles p on p.id = d.id
     where pt.id = patient and d.id = auth.uid() and d.approval_status = 'approved' and p.status = 'active') and mfa_ok() $$;

create or replace function consults(patient uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from care_team_members m join doctors d on d.id = m.doctor_id join profiles p on p.id = d.id
    where m.patient_id = patient and m.doctor_id = auth.uid() and m.ended_at is null
      and d.approval_status = 'approved' and p.status = 'active') and mfa_ok() $$;

-- The restrictive rule on every table: an active account, and the second step where it applies.
create or replace function account_active() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and status not in ('suspended', 'deactivated')) and mfa_ok() $$;

/**
 * What the app needs to know before it opens a portal: whether this session must pass, or set
 * up, the second step, and when an idle session signs out. Answers even when the second step is
 * still owed (it is how the app learns that it is).
 */
create function my_security() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); r text; required boolean; idle int;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select role::text into r from profiles where id = me;
  required := coalesce(r = any (array(select jsonb_array_elements_text(coalesce(setting('security') -> 'mfa_required_roles', '[]'::jsonb)))), false);
  idle := coalesce((setting('security') -> 'idle_minutes' ->> r)::int, 0);
  return jsonb_build_object('role', r, 'aal', coalesce(jwt_claim('aal'), 'aal1'), 'has_factor', has_verified_factor(me),
                            'mfa_required', required, 'idle_minutes', idle);
end $$;


/* ═══ Account lifecycle ═══════════════════════════════════════════════
   registered → unverified (email not confirmed yet) → active → suspended / deactivated.
   A doctor's sign-up waits for approval instead. An account whose email the sign-in service
   has already confirmed (confirmation off, a provider that verified it, an admin-created
   account) starts active, as before. */
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
          case when wants_doctor then 'pending_approval' when new.email_confirmed_at is null then 'unverified' else 'active' end::account_status,
          -- Google sends full_name and name; Apple sends a name only the first time, sometimes not at all.
          coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
                   case when invited then inv.full_name end, split_part(new.email, '@', 1)),
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

create or replace function handle_user_confirmed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform set_config('mcare.account_action', '1', true);
    update profiles set status = 'active' where id = new.id and status = 'unverified';
    perform set_config('mcare.account_action', '', true);
    perform apply_staff_invitation(new.id, new.email);
  end if;
  return new;
end $$;


/* ═══ Support acting for someone ══════════════════════════════════════
   An admin, or an assistant who handles support, corrects a person's name, phone or date of
   birth. One named function, a written reason, one transaction; the audit entry names the staff
   member as the actor and the person as on_behalf_of, and the person is told. */
create function admin_update_profile(person uuid, changes jsonb, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles; nm text; ph text; birth date; why text := trim(coalesce(reason, ''));
begin
  if not staff_can('handle_support') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if person = auth.uid() then raise exception 'Change your own details from your profile' using errcode = '22023'; end if;
  if length(why) < 5 then raise exception 'Say why you are changing these details' using errcode = '22023'; end if;
  if jsonb_typeof(changes) is distinct from 'object' then raise exception 'Nothing to save' using errcode = '22023'; end if;
  select * into p from profiles where id = person for update;
  if not found then raise exception 'Account not found' using errcode = '22023'; end if;
  if p.role in ('admin', 'assistant') and not is_admin() then raise exception 'Only an admin can change staff details' using errcode = '42501'; end if;

  nm := case when changes ? 'name' then trim(coalesce(changes ->> 'name', '')) else p.full_name end;
  ph := case when changes ? 'phone' then trim(coalesce(changes ->> 'phone', '')) else p.phone end;
  birth := case when changes ? 'dob' then nullif(changes ->> 'dob', '')::date else p.dob end;
  if nm = '' then raise exception 'Enter their name' using errcode = '22023'; end if;
  if (nm, ph, birth) is not distinct from (p.full_name, p.phone, p.dob) then return; end if;

  perform set_config('mcare.on_behalf_of', person::text, true);
  perform set_config('mcare.support_edit', '1', true);
  update profiles set full_name = nm, phone = ph, dob = birth where id = person;
  perform set_config('mcare.support_edit', '', true);
  perform audit_event('Support updated details', nm || ' · ' || left(why, 200), 'account', person::text,
    case when p.role = 'patient' then person end,
    jsonb_build_object('name', p.full_name, 'phone', p.phone, 'dob', p.dob), jsonb_build_object('name', nm, 'phone', ph, 'dob', birth));
  perform set_config('mcare.on_behalf_of', '', true);
  perform notify_user(person, 'account', 'Your details were updated', 'mCare support updated your details: ' || left(why, 200), 'profile');
end $$;


/** A person lost the phone with their authenticator app: an admin removes their second factors, with a reason.
    Their sessions end; they sign in with their password and can set up a new app. Audited; they are told. */
create function reset_two_step(person uuid, reason text) returns void language plpgsql security definer set search_path = public as $$
declare why text := trim(coalesce(reason, '')); who text := name_of(person);
begin
  if not is_admin() then raise exception 'Only an admin can reset two-step sign-in' using errcode = '42501'; end if;
  if person = auth.uid() then raise exception 'Ask another admin to reset your own two-step sign-in' using errcode = '22023'; end if;
  if who is null then raise exception 'Account not found' using errcode = '22023'; end if;
  if length(why) < 5 then raise exception 'Say why two-step sign-in is being reset' using errcode = '22023'; end if;
  if not has_verified_factor(person) then raise exception 'That account does not use two-step sign-in' using errcode = '22023'; end if;
  begin
    execute 'delete from auth.mfa_factors where user_id = $1' using person;
    if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id = $1' using person; end if;
  exception when insufficient_privilege then
    raise exception 'This project does not let the database remove sign-in factors. Remove it in the Supabase dashboard (Authentication → Users), then try again.' using errcode = '42501';
  end;
  perform set_config('mcare.on_behalf_of', person::text, true);
  perform audit_event('Reset two-step sign-in', who || ' · ' || left(why, 200), 'account', person::text);
  perform set_config('mcare.on_behalf_of', '', true);
  perform notify_user(person, 'account', 'Two-step sign-in was reset',
    'An mCare administrator removed your authenticator app: ' || left(why, 200) || '. Sign in with your password and set up a new one.', 'profile');
end $$;


/* ═══ Grants ══════════════════════════════════════════════════════════ */
revoke execute on function has_verified_factor(uuid), mfa_ok() from public, anon, authenticated;
revoke execute on function my_security(), admin_update_profile(uuid, jsonb, text), reset_two_step(uuid, text) from public, anon;
grant execute on function my_security(), admin_update_profile(uuid, jsonb, text), reset_two_step(uuid, text) to authenticated;

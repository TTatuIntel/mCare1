-- mCare helpers: who is asking, the audit trail, notifications and change counters.
--
-- Used by the access rules (0009) and by every domain below. The "who is asking"
-- functions are SECURITY DEFINER so they can look up the caller without being
-- blocked by the very rules they serve.


/* ═══ Who is asking ═══════════════════════════════════════════════════ */
/** True while a database function is making a change the guards would otherwise refuse. Set for one transaction only. */
create function acting(flag text) returns boolean language sql stable as
$$ select coalesce(current_setting('mcare.' || flag, true), '') = '1' $$;

create function my_role() returns user_role language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and status not in ('suspended', 'deactivated') $$;

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

/** The caller is a consulting doctor of this patient: approved, active, and on the patient's care team now. */
create function consults(patient uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from care_team_members m join doctors d on d.id = m.doctor_id join profiles p on p.id = d.id
    where m.patient_id = patient and m.doctor_id = auth.uid() and m.ended_at is null
      and d.approval_status = 'approved' and p.status = 'active') $$;

-- Reading follows the care team; changing still follows treats() alone.
create function can_see_patient(patient uuid) returns boolean language sql stable security definer set search_path = public as
$$ select patient = auth.uid() or treats(patient) or consults(patient) or staff_can('monitor_patients') $$;

create function account_active() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and status not in ('suspended', 'deactivated')) $$;

create function name_of(person uuid) returns text language sql stable security definer set search_path = public as
$$ select full_name from profiles where id = person $$;


/* ═══ Audit trail ═════════════════════════════════════════════════════
   Written by the database only, in the same transaction as the change.
   Nobody can add, edit or delete an entry through the API. */
-- History is append-only.
create function no_rewrite() returns trigger language plpgsql as
$$ begin raise exception 'History cannot be changed' using errcode = '42501'; end $$;

/** Every entry carries the server's time and the role its author held then. */
create function audit_stamp() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  new.actor_role := (select role from profiles where id = new.actor_id);
  return new;
end $$;

/** One audit entry. Internal: called by the triggers and functions that make the change. */
create function audit_event(act text, det text, res_type text default null, res_id text default null, patient uuid default null,
                            was jsonb default null, became jsonb default null, actor uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, action, detail, resource_type, resource_id, patient_id, before_state, after_state)
  values (coalesce(actor, auth.uid()), act, coalesce(det, ''), res_type, res_id, patient, was, became)
$$;


create trigger audit_stamp before insert on audit_log for each row execute function audit_stamp();
create trigger audit_log_append_only before update or delete on audit_log for each row execute function no_rewrite();
create trigger consents_append_only before update or delete on consents for each row execute function no_rewrite();


/* ═══ Notifications ═══════════════════════════════════════════════════
   Every notification is written here, by the database, with the change it
   describes. Each one is also queued for delivery (0008). */
create function notify_user(to_user uuid, k notif_kind, t text, b text, l text default null) returns void
language sql security definer set search_path = public as
$$ insert into notifications (user_id, kind, title, body, link) values (to_user, k, t, b, l) $$;

create function notify_about(to_user uuid, k notif_kind, t text, b text, l text, res_type text, res_id text) returns void
language sql security definer set search_path = public as
$$ insert into notifications (user_id, kind, title, body, link, resource_type, resource_id) values (to_user, k, t, b, l, res_type, res_id) $$;

/** Admins, and assistants holding this permission. */
create function notify_staff(perm text, k notif_kind, t text, b text, l text, except_user uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, link)
  select p.id, k, t, b, l from profiles p left join staff s on s.id = p.id
  where p.status = 'active' and p.id is distinct from except_user
    and (p.role = 'admin' or (p.role = 'assistant' and perm = any (s.permissions)))
$$;

create function notify_care_team(patient uuid, k notif_kind, t text, b text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, kind, title, body, link, resource_type, resource_id)
  select u.id, k, t, b, 'alerts', 'patient', patient::text from (
    select assigned_doctor_id as id from patients where id = patient and assigned_doctor_id is not null
    union
    select p.id from profiles p left join staff s on s.id = p.id
    where p.status = 'active' and (p.role = 'admin' or (p.role = 'assistant' and 'monitor_patients' = any (s.permissions)))
  ) u;
end $$;


/* ═══ Change counters ═════════════════════════════════════════════════
   An open screen asks for my_change_token() and reloads when it differs. The
   counters say only THAT something changed; what is then loaded is still decided
   by each table's row rules. Every table that belongs to a patient carries the
   zz_touch_patient trigger (named to fire last). */
/** Row trigger for every table that belongs to a patient. The argument names the column holding the patient. */
create function touch_patient() returns trigger language plpgsql security definer set search_path = public as $$
declare row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end); pid uuid := nullif(row ->> tg_argv[0], '')::uuid;
begin
  -- Nothing to count once the patient is gone (their rows are being removed with them).
  if pid is not null and exists (select 1 from patients where id = pid) then
    insert into patient_changes (patient_id) values (pid)
    on conflict (patient_id) do update set version = patient_changes.version + 1, changed_at = now();
  end if;
  return null;
end $$;

/** Messages name two people; the patient among them is whose record changed. */
create function touch_message() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into patient_changes (patient_id)
  select p.id from patients p where p.id in (new.from_id, new.to_id)
  on conflict (patient_id) do update set version = patient_changes.version + 1, changed_at = now();
  return null;
end $$;

create function touch_topic() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update system_changes set version = version + 1, changed_at = now() where topic = tg_argv[0];
  return null;
end $$;

-- A consulting doctor's screen stays current too.
create function my_change_token() returns text language plpgsql stable security definer set search_path = public as $$
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


create trigger zz_touch_patient after insert or update on patients for each row execute function touch_patient('id');
create trigger zz_touch_message after insert or update on messages for each row execute function touch_message();

do $$
declare t text;
begin
  foreach t in array array[
    'allergies', 'conditions', 'emergency_contacts', 'doctor_requests', 'care_assignments', 'care_team_members', 'doctor_ratings',
    'tracked_vitals', 'thresholds', 'readings', 'alerts', 'alert_remeasures', 'alert_comments',
    'prescriptions', 'dose_logs', 'meal_plans', 'meal_logs', 'hydration_logs',
    'appointments', 'clinical_notes', 'care_plans', 'care_plan_items', 'documents', 'report_requests'] loop
    execute format('create trigger zz_touch_patient after insert or update or delete on %I for each row execute function touch_patient(%L)', t, 'patient_id');
  end loop;
  foreach t in array array['profiles', 'doctors', 'staff', 'account_invitations', 'support_tickets', 'doctor_hours', 'doctor_time_off'] loop
    execute format('create trigger zz_touch_topic after insert or update or delete on %I for each statement execute function touch_topic(%L)', t, 'people');
  end loop;
  execute 'create trigger zz_touch_topic after insert or update or delete on vital_defs for each statement execute function touch_topic(''settings'')';
end $$;

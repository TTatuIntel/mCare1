-- mCare integrity: the gaps the doctor and admin portals relied on a screen to cover.
--
-- Nothing here adds a feature. It closes what an audit of the first eight
-- migrations found:
--   • the audit trail could be written by any signed-in browser; now only the database writes it,
--     and each entry can say what it is about (the record, the patient, before and after)
--   • a new treating doctor could not stop a medicine the previous doctor prescribed, but could delete it
--   • two functions did not check that the caller's account is still active
--   • suspending the last admin, yourself, or a doctor who still has patients was stopped only by a button
--   • an answered report request could be answered again
--   • a change to a patient's critical range left no history
--   • marking a reading invalid left its alert open
--   • a form sent twice (double tap, retry on a bad connection) saved twice
--   • a notification could not say which patient or appointment it is about


/* ─── Audit trail ──────────────────────────────────────────────────────
   Written by the database only, in the same transaction as the change.
   `action` and `detail` stay as the sentence a person reads; the new
   columns let a screen filter by record or patient and show what changed.
   patient_id has no foreign key on purpose: the trail is append-only, so
   it must not be touched when a patient's record is removed. */
alter table audit_log add column actor_role    user_role;
alter table audit_log add column resource_type text;      -- 'patient' | 'appointment' | 'prescription' | 'staff' | …
alter table audit_log add column resource_id   text;
alter table audit_log add column patient_id    uuid;
alter table audit_log add column before_state  jsonb;
alter table audit_log add column after_state   jsonb;
create index audit_log_patient_idx on audit_log (patient_id, created_at desc) where patient_id is not null;
create index audit_log_actor_idx   on audit_log (actor_id, created_at desc);

alter table audit_log disable trigger audit_log_append_only;
update audit_log a set actor_role = p.role from profiles p where p.id = a.actor_id;
alter table audit_log enable trigger audit_log_append_only;

/** Every entry carries the server's time and the role its author held then. */
create function audit_stamp() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  new.actor_role := (select role from profiles where id = new.actor_id);
  return new;
end $$;
create trigger audit_stamp before insert on audit_log for each row execute function audit_stamp();

/** One audit entry. Internal: called by the triggers and functions that make the change. */
create function audit_event(act text, det text, res_type text default null, res_id text default null, patient uuid default null,
                            was jsonb default null, became jsonb default null, actor uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, action, detail, resource_type, resource_id, patient_id, before_state, after_state)
  values (coalesce(actor, auth.uid()), act, coalesce(det, ''), res_type, res_id, patient, was, became)
$$;
revoke execute on function audit_event(text, text, text, text, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;

-- The browser no longer writes audit entries.
drop policy audit_add on audit_log;

/* What the browser used to write, now written where it happens. */
alter table staff add constraint staff_permissions_known check (permissions <@ array[
  'approve_doctors', 'create_users', 'view_logs', 'assign_healthworkers', 'approve_patient_requests',
  'handle_support', 'monitor_patients', 'document_support']::text[]);

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
create trigger staff_audit after insert or update on staff for each row execute function staff_audit();

create function patient_privacy_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.docs_private_default is distinct from old.docs_private_default then
    perform audit_event('Changed document privacy default',
      case when new.docs_private_default then 'New uploads are private' else 'New uploads are shared with the care team' end,
      'patient', new.id::text, new.id);
  end if;
  return new;
end $$;
create trigger patient_privacy_audit after update of docs_private_default on patients for each row execute function patient_privacy_audit();

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
revoke execute on function log_patient_view(uuid) from public, anon;
grant execute on function log_patient_view(uuid) to authenticated;


/* ─── Notifications: what they are about ───────────────────────────────
   `link` names a screen. These say which record on it, so a tap opens
   that patient or appointment rather than a list. */
alter table notifications add column read_at       timestamptz;
alter table notifications add column resource_type text;
alter table notifications add column resource_id   text;

create or replace function guard_notification() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.user_id, new.kind, new.title, new.body, new.link, new.created_at, new.resource_type, new.resource_id) is distinct from
     (old.user_id, old.kind, old.title, old.body, old.link, old.created_at, old.resource_type, old.resource_id)
     or (old.read and not new.read) then
    raise exception 'Notifications cannot be edited' using errcode = '42501';
  end if;
  new.read_at := case when new.read and not old.read then now() else old.read_at end;
  return new;
end $$;

create function notify_about(to_user uuid, k notif_kind, t text, b text, l text, res_type text, res_id text) returns void
language sql security definer set search_path = public as
$$ insert into notifications (user_id, kind, title, body, link, resource_type, resource_id) values (to_user, k, t, b, l, res_type, res_id) $$;
revoke execute on function notify_about(uuid, notif_kind, text, text, text, text, text) from public, anon, authenticated;

create or replace function notify_care_team(patient uuid, k notif_kind, t text, b text) returns void
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

create or replace function message_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare to_patient boolean := (select role from profiles where id = new.to_id) = 'patient';
begin
  perform notify_about(new.to_id, 'message', 'New message from ' || coalesce(name_of(new.from_id), 'mCare'), left(new.content, 80),
    case when to_patient then 'messages' else 'patients' end,
    case when to_patient then null else 'patient' end, case when to_patient then null else new.from_id::text end);
  return new;
end $$;


/* ─── Prescriptions ────────────────────────────────────────────────────
   Whoever treats the patient now can stop or restart a medicine, whoever
   prescribed it (the row itself still cannot be rewritten). A prescription
   is never deleted: stopping it is the record. */
drop policy rx_write on prescriptions;
create policy rx_add on prescriptions for insert to authenticated with check (treats(patient_id) and doctor_id = auth.uid());
create policy rx_change on prescriptions for update to authenticated using (treats(patient_id)) with check (treats(patient_id));


/* ─── Accounts that are no longer active ───────────────────────────── */
create or replace function create_share_link(docs uuid[], recipient text, ttl_hours int default 24, one_time boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); n int; doc uuid;
begin
  if not account_active() then raise exception 'Your account is not active' using errcode = '42501'; end if;
  if ttl_hours not between 1 and 24 * 30 then raise exception 'Links last between 1 hour and 30 days' using errcode = '22023'; end if;
  select count(*) into n from documents d where d.id = any (docs) and d.patient_id = auth.uid() and d.deleted_at is null
    and can_open_document(d) and (d.upload_state is null or d.upload_state = 'ready');
  if n = 0 or n <> cardinality(docs) then raise exception 'Document not found or you do not have access' using errcode = '42501'; end if;
  insert into share_links (token_hash, patient_id, document_ids, recipient, one_time, expires_at)
  values (hash_token(token), auth.uid(), docs, trim(recipient), one_time, now() + make_interval(hours => ttl_hours));
  foreach doc in array docs loop perform log_doc_event(doc, 'share', trim(recipient) || ' · ' || ttl_hours || ' h' || case when one_time then ' · one-time' else '' end); end loop;
  return token;
end $$;

create or replace function record_document_access(doc uuid, act text default 'view') returns void language plpgsql security definer set search_path = public as $$
declare d documents;
begin
  if act not in ('view', 'download') then raise exception 'Unknown action' using errcode = '22023'; end if;
  select * into d from documents where id = doc;
  if not found or not account_active() or not can_open_document(d) or (d.deleted_at is not null) then
    raise exception 'Document not found or you do not have access' using errcode = '42501';
  end if;
  perform log_doc_event(doc, act);
  if act = 'view' and d.patient_id = auth.uid() and not d.seen_by_patient then
    update documents set seen_by_patient = true where id = doc;
  end if;
end $$;

create policy appointment_events_active_only on appointment_events as restrictive for all to authenticated
  using (account_active()) with check (account_active());


/* ─── Who may change an account's status ───────────────────────────────
   These held only because a button was greyed out. An account that stops
   being active must not leave mCare without an administrator, or patients
   with a doctor who can no longer open their record. */
create or replace function guard_profile() returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if new.dob is not null and (new.dob > current_date or new.dob < date '1900-01-01') then
    raise exception 'Enter a valid date of birth' using errcode = '22023';
  end if;
  if new.avatar is not null and length(new.avatar::text) > 400000 then
    raise exception 'That photo is too large' using errcode = '22023';
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
  if new.status is distinct from old.status and new.id = me then
    raise exception 'You cannot change the status of your own account' using errcode = '42501';
  end if;
  return new;
end $$;


/* ─── Report requests: answered once ───────────────────────────────── */
create or replace function report_request_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := name_of(new.patient_id);
begin
  if tg_op = 'INSERT' then
    perform notify_about(new.doctor_id, 'document', 'Report request: ' || who,
      'Vitals report for the last ' || new.period_days || ' days', 'patients', 'patient', new.patient_id::text);
    return new;
  end if;
  if (new.patient_id, new.doctor_id, new.period_days, new.reason, new.created_at)
     is distinct from (old.patient_id, old.doctor_id, old.period_days, old.reason, old.created_at) then
    raise exception 'A report request cannot be rewritten' using errcode = '42501';
  end if;
  if new.status <> old.status then
    if old.status <> 'pending' then
      raise exception 'That request has already been answered' using errcode = '22023';
    end if;
    if new.status = 'fulfilled' and new.document_id is null then
      raise exception 'Attach the report to the request' using errcode = '22023';
    end if;
    new.handled_at := now();
    perform notify_user(new.patient_id, 'document',
      case when new.status = 'declined' then 'Report request declined' else 'Your report is being prepared' end,
      coalesce(new.decline_reason, 'You''ll get it once it''s signed.'), 'docs');
  end if;
  return new;
end $$;


/* ─── Targets: the critical range has a history too ────────────────── */
alter table threshold_changes add column from_critical_min numeric;
alter table threshold_changes add column from_critical_max numeric;
alter table threshold_changes add column to_critical_min   numeric;
alter table threshold_changes add column to_critical_max   numeric;

create or replace function threshold_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare d vital_defs; target_same boolean; critical_same boolean;
begin
  if tg_op = 'DELETE' then
    insert into threshold_changes (patient_id, vital_id, from_min, from_max, from_critical_min, from_critical_max, changed_by)
    values (old.patient_id, old.vital_id, old.target_min, old.target_max, old.critical_min, old.critical_max, auth.uid());
    return old;
  end if;
  target_same := tg_op = 'UPDATE' and new.target_min = old.target_min and new.target_max = old.target_max;
  critical_same := case when tg_op = 'UPDATE'
    then (new.critical_min, new.critical_max) is not distinct from (old.critical_min, old.critical_max)
    else new.critical_min is null and new.critical_max is null end;
  if target_same and critical_same then return new; end if;

  select * into d from vital_defs where id = new.vital_id;
  insert into threshold_changes (patient_id, vital_id, from_min, from_max, to_min, to_max,
                                 from_critical_min, from_critical_max, to_critical_min, to_critical_max, changed_by)
  values (new.patient_id, new.vital_id,
          case when tg_op = 'UPDATE' then old.target_min end, case when tg_op = 'UPDATE' then old.target_max end,
          new.target_min, new.target_max,
          case when tg_op = 'UPDATE' then old.critical_min end, case when tg_op = 'UPDATE' then old.critical_max end,
          new.critical_min, new.critical_max, new.set_by);
  insert into tracked_vitals (patient_id, vital_id) values (new.patient_id, new.vital_id) on conflict do nothing;
  if not target_same then
    perform notify_user(new.patient_id, 'alert', 'Your target was updated',
      d.name || ': ' || new.target_min || '–' || new.target_max || ' ' || d.unit, 'vitals');
    perform audit_event('Set target range', name_of(new.patient_id) || ' · ' || d.name || ' ' || new.target_min || '–' || new.target_max,
      'threshold', new.vital_id, new.patient_id,
      case when tg_op = 'UPDATE' then jsonb_build_object('min', old.target_min, 'max', old.target_max) end,
      jsonb_build_object('min', new.target_min, 'max', new.target_max), new.set_by);
  end if;
  if not critical_same then
    perform audit_event('Set critical range',
      name_of(new.patient_id) || ' · ' || d.name || ' ' || coalesce(new.critical_min || '–' || new.critical_max, 'back to the standard range'),
      'threshold', new.vital_id, new.patient_id,
      case when tg_op = 'UPDATE' then jsonb_build_object('min', old.critical_min, 'max', old.critical_max) end,
      jsonb_build_object('min', new.critical_min, 'max', new.critical_max), new.set_by);
  end if;
  return new;
end $$;


/* ─── A reading marked invalid ─────────────────────────────────────────
   Who marked it and when are kept on the reading, and the alert it raised
   is closed with that as the reason: the clinician has judged the number
   wrong, so there is nothing left to respond to. */
alter table readings add column invalidated_by uuid references profiles (id) on delete set null;
alter table readings add column invalidated_at timestamptz;

create function reading_invalid_stamp() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or not new.invalid then
    new.invalidated_by := null; new.invalidated_at := null;
  elsif not old.invalid then
    new.invalidated_by := auth.uid(); new.invalidated_at := now();
  else
    new.invalidated_by := old.invalidated_by; new.invalidated_at := old.invalidated_at;
  end if;
  return new;
end $$;
create trigger reading_invalid_stamp before insert or update on readings for each row execute function reading_invalid_stamp();

create or replace function reading_invalidated() returns trigger language plpgsql security definer set search_path = public as $$
declare closed int; what text;
begin
  if not (new.invalid and not old.invalid) then return new; end if;
  what := coalesce((select name from vital_defs where id = new.vital_id), 'Reading');
  perform audit_event('Marked reading invalid', name_of(new.patient_id) || ' · ' || new.value || ' · ' || coalesce(new.invalid_reason, ''),
    'reading', new.id::text, new.patient_id);
  perform set_config('mcare.alert_action', '1', true);
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
    resolution_reason = 'Reading marked invalid', resolution_note = new.invalid_reason
  where reading_id = new.id and status <> 'resolved';
  get diagnostics closed = row_count;
  perform set_config('mcare.alert_action', '', true);
  if closed > 0 then
    perform notify_user(new.patient_id, 'alert', 'Alert closed', what || ': your doctor marked the reading as not valid', 'alerts');
    perform audit_event('Resolved alert', name_of(new.patient_id) || ' · ' || what || ' · Reading marked invalid', 'reading', new.id::text, new.patient_id);
  end if;
  return new;
end $$;


/* ─── The same form sent twice is one record ───────────────────────────
   The app gives each form a reference when it opens and sends it with the
   save. A second save with the same reference (a double tap, a retry after
   a dropped connection) is refused here, and the app shows the first one. */
alter table readings       add column client_ref uuid;
alter table prescriptions  add column client_ref uuid;
alter table clinical_notes add column client_ref uuid;
alter table appointments   add column client_ref uuid;
alter table messages       add column client_ref uuid;
create unique index readings_client_ref_key       on readings (client_ref)       where client_ref is not null;
create unique index prescriptions_client_ref_key  on prescriptions (client_ref)  where client_ref is not null;
create unique index clinical_notes_client_ref_key on clinical_notes (client_ref) where client_ref is not null;
create unique index appointments_client_ref_key   on appointments (client_ref)   where client_ref is not null;
create unique index messages_client_ref_key       on messages (client_ref)       where client_ref is not null;

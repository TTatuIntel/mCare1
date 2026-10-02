-- mCare administration: what the people who run the service do, on the same records.
--
--   • support staff can move or cancel an appointment for a patient or doctor who asks:
--     it is the same appointment row, both of them are told, and it is in the history and the audit trail
--   • a support request is answered once, and the answer is kept
--   • the figures an administrator reports on are counted by the database from the
--     records themselves; no clinical detail leaves it


/* ─── Appointments: support acts on the one record ─────────────────── */
/**
 * Someone who handles support moves an appointment to another time, or cancels it.
 * The reason is required: it is what the patient and the doctor are told.
 * A moved visit is still checked against the doctor's hours and against other confirmed visits.
 */
create function admin_update_appointment(appt uuid, action text, new_date date default null, new_time time default null, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  a appointments; me uuid := auth.uid(); why text := trim(coalesce(reason, ''));
  was text; becomes text; pt text; doc text;
begin
  if not staff_can('handle_support') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if action not in ('move', 'cancel') then raise exception 'Choose to move or cancel the appointment' using errcode = '22023'; end if;
  if length(why) < 5 then raise exception 'Give the reason the patient and the doctor will read' using errcode = '22023'; end if;
  select * into a from appointments where id = appt for update;
  if not found then raise exception 'Appointment not found' using errcode = '22023'; end if;
  if a.status not in ('requested', 'approved', 'rescheduled') then raise exception 'This appointment is closed' using errcode = '22023'; end if;
  pt := name_of(a.patient_id); doc := name_of(a.doctor_id);

  if action = 'cancel' then
    -- The appointment's own triggers write the history line, tell the patient and audit it.
    update appointments set status = 'cancelled', rejection_reason = left(why, 300) where id = appt;
    perform notify_about(a.doctor_id, 'appointment', 'Appointment cancelled by mCare support',
      a.title || ' · ' || pt || ' · ' || why, 'appts', 'appointment', a.id::text);
    return;
  end if;

  if a.status = 'rescheduled' then
    raise exception 'The doctor has proposed a new time. The patient can accept it, or the appointment can be cancelled.' using errcode = '22023';
  end if;
  if new_date is null or new_date < current_date then raise exception 'Choose a date from today onwards' using errcode = '22023'; end if;
  if (new_date, new_time) is not distinct from (a.preferred_date, a.preferred_time) then
    raise exception 'That is the time it already has' using errcode = '22023';
  end if;
  was := to_char(a.preferred_date, 'Mon FMDD, YYYY') || coalesce(' · ' || to_char(a.preferred_time, 'FMHH12:MI AM'), '');
  becomes := to_char(new_date, 'Mon FMDD, YYYY') || coalesce(' · ' || to_char(new_time, 'FMHH12:MI AM'), '');
  update appointments set preferred_date = new_date, preferred_time = new_time where id = appt;
  insert into appointment_events (appointment_id, actor_id, action, detail) values (appt, me, 'moved', was || ' → ' || becomes || ' · ' || why);
  perform notify_about(a.patient_id, 'appointment', 'Appointment moved by mCare support', a.title || ' → ' || becomes || ' · ' || why, 'appts', 'appointment', a.id::text);
  perform notify_about(a.doctor_id, 'appointment', 'Appointment moved by mCare support', a.title || ' · ' || pt || ' → ' || becomes || ' · ' || why, 'appts', 'appointment', a.id::text);
  perform audit_event('Moved appointment', pt || ' · ' || a.title || ' · ' || was || ' → ' || becomes || ' · ' || why, 'appointment', a.id::text, a.patient_id,
    jsonb_build_object('date', a.preferred_date, 'time', a.preferred_time), jsonb_build_object('date', new_date, 'time', new_time));
end $$;


/* ─── Support requests ─────────────────────────────────────────────── */
create or replace function support_ticket_notify() returns trigger language plpgsql security definer set search_path = public as $$
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

create or replace function support_ticket_before() returns trigger language plpgsql as $$
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


/* ─── Operational report ───────────────────────────────────────────────
   Counts only, for the days asked for. An administrator, or an assistant
   who may read the audit log. */
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

revoke execute on function admin_update_appointment(uuid, text, date, time, text) from public, anon;
revoke execute on function admin_report(date, date) from public, anon;
grant execute on function admin_update_appointment(uuid, text, date, time, text), admin_report(date, date) to authenticated;

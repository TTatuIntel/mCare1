-- mCare appointments and availability.
--
-- One appointment is one row from request to outcome, with a reference and its
-- history. The patient asks, the doctor answers, support may move or cancel it
-- for either of them. A request is checked against the doctor's working hours
-- and days away; confirmed bookings for one doctor are taken one at a time.
-- A follow-up booked from an alert and the alert's resolution are one transaction.


/* ═══ Appointments ════════════════════════════════════════════════════ */
create function guard_appointment() returns trigger language plpgsql as $$
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

create function guard_appointment_slot() returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); d date; t time; slot int; doc text;
begin
  -- One confirmed booking at a time per doctor, so two cannot take the same slot in the same instant.
  if new.status = 'approved' then perform pg_advisory_xact_lock(hashtext('mcare.appointment.' || new.doctor_id::text)); end if;
  -- The service role, and the doctor arranging their own day, are not held to the timetable.
  if me is null or me = new.doctor_id then return new; end if;
  if new.status not in ('requested', 'approved') then return new; end if;
  d := new.preferred_date; t := new.preferred_time;
  if tg_op = 'UPDATE' then
    -- Accepting the time the doctor proposed, or a change that does not move the visit.
    if old.status = 'rescheduled' or (d, t) is not distinct from (old.preferred_date, old.preferred_time) then return new; end if;
  end if;

  doc := coalesce(name_of(new.doctor_id), 'The doctor');
  if exists (select 1 from doctor_time_off o where o.doctor_id = new.doctor_id and d between o.from_date and o.to_date) then
    raise exception '% is away on that day. Choose another day.', doc using errcode = '22023';
  end if;
  if not exists (select 1 from doctor_hours h where h.doctor_id = new.doctor_id) then return new; end if;   -- no timetable kept
  if not exists (select 1 from doctor_hours h where h.doctor_id = new.doctor_id and h.weekday = extract(dow from d)::int) then
    raise exception '% does not see patients on that day. Choose another day.', doc using errcode = '22023';
  end if;
  if t is not null then
    select slot_minutes into slot from doctors where id = new.doctor_id;
    if not exists (select 1 from doctor_hours h where h.doctor_id = new.doctor_id and h.weekday = extract(dow from d)::int
                   and t >= h.start_time and t + make_interval(mins => slot) <= h.end_time) then
      raise exception 'That time is outside the hours % sees patients. Choose one of the open times.', doc using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create function appointment_links() returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.number := 'APT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('appointment_number_seq')::text, 5, '0');
    if not acting('follow_up') then new.alert_id := null; end if;
    if new.preferred_date < current_date then
      raise exception 'Choose a date from today onwards' using errcode = '22023';
    end if;
    return new;
  end if;
  new.number := old.number;
  new.alert_id := old.alert_id;
  if old.status = 'no_show' then
    raise exception 'This appointment is closed' using errcode = '42501';
  end if;
  if new.status = 'no_show' then
    if auth.uid() <> old.doctor_id or old.status <> 'approved' then
      raise exception 'Only the doctor can record a missed visit, and only for a confirmed one' using errcode = '42501';
    end if;
    if old.preferred_date > current_date then
      raise exception 'A visit still ahead cannot be recorded as missed' using errcode = '22023';
    end if;
  end if;
  if new.rescheduled_date is distinct from old.rescheduled_date and new.rescheduled_date < current_date then
    raise exception 'Choose a date from today onwards' using errcode = '22023';
  end if;
  return new;
end $$;

create function appointment_clash() returns trigger language plpgsql security definer set search_path = public as $$
declare other appointments;
begin
  if auth.uid() is null or new.status <> 'approved' or new.preferred_time is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'approved'
     and (old.preferred_date, old.preferred_time) is not distinct from (new.preferred_date, new.preferred_time) then
    return new;
  end if;
  select * into other from appointments a
  where a.id <> new.id and a.status = 'approved' and a.preferred_date = new.preferred_date and a.preferred_time is not null
    and abs(extract(epoch from (a.preferred_time - new.preferred_time))) < 30 * 60
    and (a.doctor_id = new.doctor_id or a.patient_id = new.patient_id)
  limit 1;
  if found then
    raise exception '%', case when other.doctor_id = new.doctor_id
      then 'The doctor already has a visit at that time. Choose another time.'
      else 'The patient already has a visit at that time. Choose another time.' end using errcode = '22023';
  end if;
  return new;
end $$;

create function appointment_history() returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  slot text := to_char(new.preferred_date, 'Mon FMDD, YYYY') || coalesce(' · ' || to_char(new.preferred_time, 'FMHH12:MI AM'), '');
begin
  if tg_op = 'INSERT' then
    insert into appointment_events (appointment_id, actor_id, action, detail)
    values (new.id, coalesce(me, new.created_by), case when new.status = 'requested' then 'requested' else 'booked' end, slot);
    return new;
  end if;
  if new.status = old.status and (new.status <> 'rescheduled'
     or (new.rescheduled_date, new.rescheduled_time) is not distinct from (old.rescheduled_date, old.rescheduled_time)) then
    return new;
  end if;
  insert into appointment_events (appointment_id, actor_id, action, detail)
  values (new.id, me, new.status::text, case
    when new.status = 'rescheduled' then
      to_char(old.preferred_date, 'Mon FMDD, YYYY') || coalesce(' · ' || to_char(old.preferred_time, 'FMHH12:MI AM'), '') || ' → '
      || to_char(new.rescheduled_date, 'Mon FMDD, YYYY') || coalesce(' · ' || to_char(new.rescheduled_time, 'FMHH12:MI AM'), '')
      || coalesce(' · ' || new.rescheduled_reason, '')
    when new.status = 'approved' and old.status = 'rescheduled' then 'New time accepted · ' || slot
    when new.status in ('approved', 'completed') then new.approval_note
    else new.rejection_reason end);
  return new;
end $$;

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


create trigger guard_appointment before insert or update on appointments for each row execute function guard_appointment();
create trigger guard_appointment_slot before insert or update on appointments for each row execute function guard_appointment_slot();
create trigger appointment_links before insert or update on appointments for each row execute function appointment_links();
create trigger appointment_clash after insert or update on appointments for each row execute function appointment_clash();
create trigger appointment_history after insert or update on appointments for each row execute function appointment_history();
create trigger appointment_notify after insert or update on appointments for each row execute function appointment_notify();


/* ═══ Follow-up from an alert ═════════════════════════════════════════ */
create function schedule_follow_up(patient uuid, visit_date date, visit_time time default null, visit_note text default null, alert uuid default null)
returns uuid language plpgsql set search_path = public as $$
declare aid uuid; clean text := nullif(trim(coalesce(visit_note, '')), '');
begin
  if not treats(patient) then raise exception 'Only the treating doctor can book a follow-up' using errcode = '42501'; end if;
  if visit_date is null or visit_date < current_date then raise exception 'Choose a date from today onwards' using errcode = '22023'; end if;
  perform set_config('mcare.follow_up', '1', true);
  insert into appointments (patient_id, doctor_id, title, reason, preferred_date, preferred_time, status, approval_note, alert_id)
  values (patient, auth.uid(), 'Follow-up appointment', coalesce(clean, 'Scheduled from alert review'), visit_date, visit_time, 'approved', clean, alert)
  returning id into aid;
  if alert is not null then
    update alerts set status = 'resolved', resolution_reason = 'Appointment scheduled', resolution_note = clean
    where id = alert and patient_id = patient and status <> 'resolved';
    if not found then raise exception 'That alert is already resolved' using errcode = '22023'; end if;
  end if;
  perform set_config('mcare.follow_up', '', true);
  return aid;
end $$;

create function alert_follow_up_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'resolved' and old.status <> 'resolved'
     and lower(trim(coalesce(new.resolution_reason, ''))) = 'appointment scheduled'
     and not acting('follow_up') then
    raise exception 'Book the follow-up appointment to resolve with this reason' using errcode = '22023';
  end if;
  return new;
end $$;


create trigger alert_follow_up_guard before update on alerts for each row execute function alert_follow_up_guard();


/* ═══ Availability ════════════════════════════════════════════════════ */
/**
 * Replaces the caller's working week in one step.
 *   hours = [{ weekday: 1, start: "09:00", end: "13:00" }, { weekday: 1, start: "14:00", end: "17:00" }, …]
 * An empty list means "no set hours": bookings are then not checked against a timetable.
 */
create function set_doctor_hours(hours jsonb, visit_minutes int default null) returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); h jsonb; d int; s time; e time;
begin
  if my_role() is distinct from 'doctor' then raise exception 'Only a doctor sets working hours' using errcode = '42501'; end if;
  if jsonb_typeof(hours) <> 'array' or jsonb_array_length(hours) > 28 then raise exception 'Up to four blocks of hours a day' using errcode = '22023'; end if;
  delete from doctor_hours where doctor_id = me;
  for h in select * from jsonb_array_elements(hours) loop
    d := (h ->> 'weekday')::int; s := (h ->> 'start')::time; e := (h ->> 'end')::time;
    if d is null or d not between 0 and 6 or s is null or e is null or s >= e then
      raise exception 'Each block needs a day, a start and a later end' using errcode = '22023';
    end if;
    if exists (select 1 from doctor_hours x where x.doctor_id = me and x.weekday = d and x.start_time < e and s < x.end_time) then
      raise exception 'Two blocks on the same day overlap' using errcode = '22023';
    end if;
    insert into doctor_hours (doctor_id, weekday, start_time, end_time) values (me, d, s, e);
  end loop;
  if visit_minutes is not null then update doctors set slot_minutes = visit_minutes where id = me; end if;
  perform audit_event('Set working hours', coalesce(name_of(me), '') || ' · ' || jsonb_array_length(hours) || ' block' || case when jsonb_array_length(hours) = 1 then '' else 's' end,
    'doctor', me::text);
end $$;

/**
 * What a booking screen needs for one doctor and one day:
 *   managed       the doctor keeps a timetable, so only `slots` can be asked for
 *   away          the doctor is away that day
 *   slot_minutes  how long a visit lasts
 *   slots         the start times still free, as "HH:MM"
 * Never who else is booked, or why the doctor is away.
 */
create function doctor_availability(doctor uuid, day date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare slot int; managed boolean; away boolean; free jsonb;
begin
  if not account_active() then raise exception 'Sign in first' using errcode = '42501'; end if;
  select d.slot_minutes into slot from doctors d join profiles p on p.id = d.id
    where d.id = doctor and d.approval_status = 'approved' and p.status = 'active';
  if slot is null then raise exception 'That doctor is not available' using errcode = '22023'; end if;
  managed := exists (select 1 from doctor_hours h where h.doctor_id = doctor);
  away := exists (select 1 from doctor_time_off o where o.doctor_id = doctor and day between o.from_date and o.to_date);
  select coalesce(jsonb_agg(to_char(t, 'HH24:MI') order by t), '[]'::jsonb) into free
  from doctor_hours h,
       generate_series(day + h.start_time, day + h.end_time - make_interval(mins => slot), make_interval(mins => slot)) t
  where h.doctor_id = doctor and h.weekday = extract(dow from day)::int and not away
    and not exists (
      select 1 from appointments a
      where a.doctor_id = doctor and a.status = 'approved' and a.preferred_date = day and a.preferred_time is not null
        and abs(extract(epoch from (a.preferred_time - t::time))) < 30 * 60);
  return jsonb_build_object('managed', managed, 'away', away, 'slot_minutes', slot, 'slots', free);
end $$;

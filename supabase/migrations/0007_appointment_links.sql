/* ─── What an appointment is connected to ────────────────────────────
   A follow-up remembers the alert it was booked from, so the alert can
   show its visit and the visit can show why it exists. Only
   schedule_follow_up makes that link, and an alert has one follow-up.
   A visit is never booked for, or moved to, a day already gone. */

alter table appointments add column alert_id uuid references alerts (id) on delete set null;
create unique index appointments_alert_idx on appointments (alert_id) where alert_id is not null;

create function appointment_links() returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if not acting('follow_up') then new.alert_id := null; end if;
    if new.preferred_date < current_date then
      raise exception 'Choose a date from today onwards' using errcode = '22023';
    end if;
    return new;
  end if;
  new.alert_id := old.alert_id;
  if new.rescheduled_date is distinct from old.rescheduled_date and new.rescheduled_date < current_date then
    raise exception 'Choose a date from today onwards' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger appointment_links before insert or update on appointments for each row execute function appointment_links();

create or replace function schedule_follow_up(patient uuid, visit_date date, visit_time time default null, visit_note text default null, alert uuid default null)
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

/* ─── "Appointment scheduled" means an appointment was scheduled ─────
   An alert may be resolved with that reason only by schedule_follow_up,
   which books the visit in the same transaction. Chosen on its own, the
   reason would close the alert with no visit behind it. */

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

create or replace function schedule_follow_up(patient uuid, visit_date date, visit_time time default null, visit_note text default null, alert uuid default null)
returns uuid language plpgsql set search_path = public as $$
declare aid uuid; clean text := nullif(trim(coalesce(visit_note, '')), '');
begin
  if not treats(patient) then raise exception 'Only the treating doctor can book a follow-up' using errcode = '42501'; end if;
  if visit_date is null or visit_date < current_date then raise exception 'Choose a date from today onwards' using errcode = '22023'; end if;
  insert into appointments (patient_id, doctor_id, title, reason, preferred_date, preferred_time, status, approval_note)
  values (patient, auth.uid(), 'Follow-up appointment', coalesce(clean, 'Scheduled from alert review'), visit_date, visit_time, 'approved', clean)
  returning id into aid;
  if alert is not null then
    perform set_config('mcare.follow_up', '1', true);
    update alerts set status = 'resolved', resolution_reason = 'Appointment scheduled', resolution_note = clean
    where id = alert and patient_id = patient and status <> 'resolved';
    if not found then raise exception 'That alert is already resolved' using errcode = '22023'; end if;
    perform set_config('mcare.follow_up', '', true);
  end if;
  return aid;
end $$;

/* ─── One appointment, one record ────────────────────────────────────
   What support and accountability need from an appointment, and no more:
     · a reference a person can quote (APT-2026-00042)
     · its history: who did what, when, and the time it was moved from
     · "no-show" as an outcome, recorded by the doctor
     · no two confirmed visits at the same time for a doctor or a patient
     · staff who help patients can find it (read only) */

alter type appointment_status add value 'no_show';

/* ─── Reference ─── */
create sequence appointment_number_seq;
alter table appointments add column number text unique;
update appointments set number = 'APT-' || to_char(created_at, 'YYYY') || '-' || lpad(nextval('appointment_number_seq')::text, 5, '0');
alter table appointments alter column number set default 'APT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('appointment_number_seq')::text, 5, '0');
alter table appointments alter column number set not null;

/* ─── What the browser cannot set, and what a missed visit needs ─── */
create or replace function appointment_links() returns trigger language plpgsql set search_path = public as $$
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

/* ─── No two confirmed visits at the same time ─── */
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
create trigger appointment_clash after insert or update on appointments for each row execute function appointment_clash();

/* ─── History ─── */
create table appointment_events (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments (id) on delete cascade,
  actor_id       uuid references profiles (id),
  action         text not null,   -- requested | booked | approved | rescheduled | rejected | cancelled | completed | no_show
  detail         text,
  created_at     timestamptz not null default now()
);
create index appointment_events_idx on appointment_events (appointment_id, created_at);
alter table appointment_events enable row level security;
-- Whoever may read the appointment may read its history. Only the database writes it.
create policy appt_events_read on appointment_events for select to authenticated
  using (exists (select 1 from appointments a where a.id = appointment_id));

insert into appointment_events (appointment_id, actor_id, action, created_at)
select id, created_by, case when created_by = doctor_id then 'booked' else 'requested' end, created_at from appointments;

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
create trigger appointment_history after insert or update on appointments for each row execute function appointment_history();

/* ─── Staff who help patients can find an appointment ─── */
create policy appts_staff_read on appointments for select to authenticated
  using (staff_can('monitor_patients') or staff_can('handle_support'));

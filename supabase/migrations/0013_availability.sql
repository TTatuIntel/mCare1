-- mCare availability: when a doctor sees patients.
--
-- Availability is its own record, separate from appointments:
--   • the hours a doctor works on each day of the week (two blocks in a day leave a break between them)
--   • days away (leave, a conference), as date ranges
--   • how long one visit lasts
-- Booking is then checked against it by the database, so a time outside those
-- hours, or on a day away, cannot be requested whichever screen asks.
--
-- A doctor who has set no hours is not restricted, as before. The doctor can
-- always place a visit in their own day themself: the check is for everyone else.
-- Dates and times are the clinic's local ones, as on appointments.


alter table doctors add column slot_minutes int not null default 30 check (slot_minutes in (10, 15, 20, 30, 45, 60));

create table doctor_hours (
  id         uuid primary key default gen_random_uuid(),
  doctor_id  uuid not null references doctors (id) on delete cascade,
  weekday    int  not null check (weekday between 0 and 6),   -- 0 = Sunday … 6 = Saturday
  start_time time not null,
  end_time   time not null,
  check (start_time < end_time),
  unique (doctor_id, weekday, start_time)
);
create index doctor_hours_idx on doctor_hours (doctor_id, weekday);

create table doctor_time_off (
  id         uuid primary key default gen_random_uuid(),
  doctor_id  uuid not null references doctors (id) on delete cascade,
  from_date  date not null,
  to_date    date not null,
  reason     text check (reason is null or length(reason) <= 200),
  created_at timestamptz not null default now(),
  check (from_date <= to_date)
);
create index doctor_time_off_idx on doctor_time_off (doctor_id, from_date);

alter table doctor_hours    enable row level security;
alter table doctor_time_off enable row level security;

-- Working hours are part of the doctor directory. Why a doctor is away is theirs and the staff's; patients learn only that they are.
create policy doctor_hours_read on doctor_hours for select to authenticated using (true);
create policy doctor_hours_write on doctor_hours for all to authenticated
  using (doctor_id = auth.uid() and my_role() = 'doctor') with check (doctor_id = auth.uid() and my_role() = 'doctor');
create policy doctor_time_off_read on doctor_time_off for select to authenticated using (doctor_id = auth.uid() or my_role() in ('admin', 'assistant'));
create policy doctor_time_off_write on doctor_time_off for all to authenticated
  using (doctor_id = auth.uid() and my_role() = 'doctor') with check (doctor_id = auth.uid() and my_role() = 'doctor');
create policy doctor_hours_active_only on doctor_hours as restrictive for all to authenticated using (account_active()) with check (account_active());
create policy doctor_time_off_active_only on doctor_time_off as restrictive for all to authenticated using (account_active()) with check (account_active());

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

/* ─── Booking is checked against availability ──────────────────────────
   Runs after the other appointment guards (trigger names sort that way),
   so it sees the date and time the appointment will really have. */
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
create trigger guard_appointment_slot before insert or update on appointments for each row execute function guard_appointment_slot();

revoke execute on function set_doctor_hours(jsonb, int) from public, anon;
revoke execute on function doctor_availability(uuid, date) from public, anon;
grant execute on function set_doctor_hours(jsonb, int), doctor_availability(uuid, date) to authenticated;

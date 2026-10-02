-- mCare synchronisation: how an open screen learns that something changed.
--
-- Until now the app asked "is there a new notification for me?" That misses
-- every change that writes none: a dose the patient ticked, a new sign-up, an
-- edit by another administrator. Now the database itself keeps count:
--   • patient_changes   one row per patient, bumped whenever anything in that patient's record changes
--   • system_changes    one row per shared topic (people, settings), bumped the same way
-- An app asks for one short token made from the rows it may see
-- (my_change_token); when the token differs, it reloads. On hosted Supabase the
-- two tables are also published for Realtime, so the app is told at once
-- instead of asking.
--
-- These rows say only THAT something changed, never what. What a person then
-- loads is still decided by the row rules on each table.


create table patient_changes (
  patient_id uuid primary key references patients (id) on delete cascade,
  version    bigint not null default 1,
  changed_at timestamptz not null default now()
);
create table system_changes (
  topic      text primary key,
  version    bigint not null default 1,
  changed_at timestamptz not null default now()
);
insert into patient_changes (patient_id) select id from patients;
insert into system_changes (topic) values ('people'), ('settings');

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

do $$
declare t text;
begin
  foreach t in array array['readings', 'alerts', 'prescriptions', 'dose_logs', 'meal_logs', 'hydration_logs', 'meal_plans', 'thresholds',
    'tracked_vitals', 'allergies', 'conditions', 'emergency_contacts', 'appointments', 'clinical_notes', 'documents', 'report_requests',
    'doctor_requests', 'doctor_ratings', 'care_plans', 'care_plan_items', 'care_assignments'] loop
    execute format('create trigger zz_touch_patient after insert or update or delete on %I for each row execute function touch_patient(%L)', t, 'patient_id');
  end loop;
  execute 'create trigger zz_touch_patient after insert or update on patients for each row execute function touch_patient(''id'')';
  execute 'create trigger zz_touch_message after insert or update on messages for each row execute function touch_message()';
  foreach t in array array['profiles', 'doctors', 'staff', 'account_invitations', 'support_tickets', 'doctor_hours', 'doctor_time_off'] loop
    execute format('create trigger zz_touch_topic after insert or update or delete on %I for each statement execute function touch_topic(%L)', t, 'people');
  end loop;
  execute 'create trigger zz_touch_topic after insert or update or delete on vital_defs for each statement execute function touch_topic(''settings'')';
end $$;

alter table patient_changes enable row level security;
alter table system_changes  enable row level security;
-- Whoever may see a patient may know their record changed; a doctor also for patients who have a visit with them.
create policy patient_changes_read on patient_changes for select to authenticated using (
  can_see_patient(patient_id) or staff_can('assign_healthworkers') or staff_can('approve_patient_requests')
  or exists (select 1 from appointments a where a.patient_id = patient_changes.patient_id and a.doctor_id = auth.uid()));
create policy system_changes_read on system_changes for select to authenticated using (true);
create policy patient_changes_active_only on patient_changes as restrictive for all to authenticated using (account_active()) with check (account_active());
create policy system_changes_active_only on system_changes as restrictive for all to authenticated using (account_active()) with check (account_active());

/**
 * One short value that changes whenever anything this person may see has changed:
 * their patients' records, the shared lists, or their own notifications.
 */
create function my_change_token() returns text language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); r user_role := my_role(); records text;
begin
  if r is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if r = 'patient' then
    select version::text into records from patient_changes where patient_id = me;
  elsif r = 'doctor' then
    select count(*) || ':' || coalesce(sum(c.version), 0) into records from patient_changes c
    where exists (select 1 from patients p where p.id = c.patient_id and p.assigned_doctor_id = me)
       or exists (select 1 from appointments a where a.patient_id = c.patient_id and a.doctor_id = me);
  else
    select count(*) || ':' || coalesce(sum(version), 0) into records from patient_changes;
  end if;
  return md5(concat_ws('|', r, coalesce(records, ''),
    (select string_agg(topic || version, ',' order by topic) from system_changes),
    (select count(*) || ':' || count(*) filter (where not read) || ':' || coalesce(max(created_at)::text, '') from notifications where user_id = me)));
end $$;
revoke execute on function my_change_token() from public, anon;
grant execute on function my_change_token() to authenticated;

/* ─── Realtime (hosted Supabase) ───────────────────────────────────────
   Published so the app is told of a change instead of asking for it.
   Skipped where there is no Realtime publication, e.g. the local backend. */
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.patient_changes, public.system_changes, public.notifications';
  end if;
end $$;

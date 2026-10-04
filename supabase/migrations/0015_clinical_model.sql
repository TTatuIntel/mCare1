-- mCare clinical relationships: a conditions catalogue (and which vitals each calls for), the
-- treating doctor's monitoring plan per vital (how often, why, who asked), a record of each time
-- the doctor reviewed a patient's readings, and one read model of a patient's care team.


/* ═══ Conditions catalogue ════════════════════════════════════════════
   patient → conditions (patient_id, name) → condition_defs. A condition the catalogue knows is
   linked by its code; a rare one typed by the patient keeps its name only. */
create table condition_defs (
  code     text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name     text not null check (length(trim(name)) between 1 and 120),
  icon     text not null default '🩺' check (length(icon) <= 16),
  icd10    text check (icd10 is null or icd10 ~ '^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$'),
  active   boolean not null default true,
  position int not null default 0
);
create unique index condition_defs_name_key on condition_defs (lower(name));

-- Which vitals are worth tracking for a condition.
create table condition_vitals (
  condition_code text not null references condition_defs (code) on update cascade on delete cascade,
  vital_id       text not null references vital_defs (id),
  position       int  not null default 0,
  primary key (condition_code, vital_id)
);
create index condition_vitals_vital_idx on condition_vitals (vital_id);

insert into condition_defs (code, name, icon, icd10, position) values
  ('hypertension',      'High blood pressure',    '🫀', 'I10',   1),
  ('diabetes_t2',       'Type 2 diabetes',        '🩸', 'E11',   2),
  ('diabetes_t1',       'Type 1 diabetes',        '🩸', 'E10',   3),
  ('heart_disease',     'Heart disease',          '❤️', 'I25',   4),
  ('heart_failure',     'Heart failure',          '💔', 'I50',   5),
  ('asthma',            'Asthma',                 '🫁', 'J45',   6),
  ('copd',              'COPD',                   '🌬️', 'J44',   7),
  ('ckd',               'Chronic kidney disease', '🧫', 'N18',   8),
  ('high_cholesterol',  'High cholesterol',       '🧪', 'E78',   9),
  ('stroke_past',       'Stroke (past)',          '🧠', 'Z86.73', 10),
  ('hiv',               'HIV',                    '🎗️', 'B20',  11),
  ('sickle_cell',       'Sickle cell disease',    '🔴', 'D57',  12),
  ('thyroid',           'Thyroid disorder',       '🦋', 'E07.9', 13),
  ('epilepsy',          'Epilepsy',               '⚡', 'G40',  14),
  ('arthritis',         'Arthritis',              '🦴', 'M19.9', 15),
  ('depression_anxiety','Depression or anxiety',  '🌧️', 'F41.8', 16);
insert into condition_vitals (condition_code, vital_id, position) values
  ('hypertension', 'bp', 1), ('hypertension', 'hr', 2),
  ('diabetes_t2', 'gluc', 1), ('diabetes_t2', 'wt', 2),
  ('diabetes_t1', 'gluc', 1),
  ('heart_disease', 'bp', 1), ('heart_disease', 'hr', 2), ('heart_disease', 'wt', 3),
  ('heart_failure', 'wt', 1), ('heart_failure', 'bp', 2), ('heart_failure', 'hr', 3), ('heart_failure', 'spo2', 4),
  ('asthma', 'spo2', 1), ('asthma', 'rr', 2),
  ('copd', 'spo2', 1), ('copd', 'rr', 2),
  ('ckd', 'bp', 1), ('ckd', 'wt', 2),
  ('high_cholesterol', 'chol', 1),
  ('stroke_past', 'bp', 1), ('stroke_past', 'hr', 2),
  ('hiv', 'wt', 1), ('hiv', 'temp', 2),
  ('sickle_cell', 'temp', 1), ('sickle_cell', 'spo2', 2),
  ('thyroid', 'wt', 1), ('thyroid', 'hr', 2);

alter table condition_defs enable row level security;
alter table condition_vitals enable row level security;
create policy condition_defs_read on condition_defs for select to authenticated using (true);
create policy condition_defs_write on condition_defs for all to authenticated using (is_admin()) with check (is_admin());
create policy condition_vitals_read on condition_vitals for select to authenticated using (true);
create policy condition_vitals_write on condition_vitals for all to authenticated using (is_admin()) with check (is_admin());
create policy condition_defs_active_only on condition_defs as restrictive for all to authenticated using (account_active()) with check (account_active());
create policy condition_vitals_active_only on condition_vitals as restrictive for all to authenticated using (account_active()) with check (account_active());
create trigger zz_touch_topic after insert or update or delete on condition_defs for each statement execute function touch_topic('settings');
create trigger zz_touch_topic after insert or update or delete on condition_vitals for each statement execute function touch_topic('settings');

create function condition_def_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  perform audit_event(case when tg_op = 'INSERT' then 'Added condition' when tg_op = 'DELETE' then 'Removed condition'
                           when new.active is distinct from old.active then case when new.active then 'Activated condition' else 'Deactivated condition' end
                           else 'Updated condition' end,
    coalesce(new.name, old.name), 'settings', coalesce(new.code, old.code), null,
    case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
create trigger condition_def_audit after insert or update or delete on condition_defs for each row execute function condition_def_audit();

/** An admin adds or changes a condition and the vitals it calls for, in one step. */
create function save_condition_def(def jsonb) returns text language plpgsql security definer set search_path = public as $$
declare c text := lower(trim(coalesce(def ->> 'code', ''))); nm text := trim(coalesce(def ->> 'name', ''));
begin
  if not is_admin() then raise exception 'Only an admin can change the conditions list' using errcode = '42501'; end if;
  if c = '' then c := trim(both '_' from regexp_replace(lower(nm), '[^a-z0-9]+', '_', 'g')); end if;
  if nm = '' or c !~ '^[a-z0-9_]{2,40}$' then raise exception 'Give the condition a name' using errcode = '22023'; end if;
  insert into condition_defs (code, name, icon, icd10, active, position)
  values (c, nm, coalesce(nullif(def ->> 'icon', ''), '🩺'), nullif(upper(trim(coalesce(def ->> 'icd10', ''))), ''),
          coalesce((def ->> 'active')::boolean, true), coalesce((select max(position) + 1 from condition_defs), 1))
  on conflict (code) do update set name = excluded.name, icon = excluded.icon, icd10 = excluded.icd10, active = excluded.active;
  delete from condition_vitals where condition_code = c;
  insert into condition_vitals (condition_code, vital_id, position)
  select c, v.value, v.ordinality from jsonb_array_elements_text(coalesce(def -> 'vitals', '[]'::jsonb)) with ordinality v
  where exists (select 1 from vital_defs d where d.id = v.value);
  return c;
end $$;

-- A patient's condition links to the catalogue when the name matches; free text stays allowed.
alter table conditions add column condition_code text references condition_defs (code) on update cascade on delete set null;
create index conditions_code_idx on conditions (condition_code) where condition_code is not null;
update conditions c set condition_code = d.code from condition_defs d where lower(trim(c.name)) = lower(d.name);

create function condition_link() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.name := trim(new.name);
  new.condition_code := (select code from condition_defs where lower(name) = lower(new.name));
  return new;
end $$;
create trigger condition_link before insert or update of name on conditions for each row execute function condition_link();


/* ═══ Monitoring plan ═════════════════════════════════════════════════
   tracked_vitals is a patient's vital assignment. The treating doctor may add how often to
   measure it and why (and the condition it is for); the patient's schedule follows it. */
alter table tracked_vitals
  add column frequency      text check (frequency is null or frequency in ('as_needed', 'weekly', 'daily', 'twice_daily', 'three_times_daily')),
  add column reason         text check (reason is null or length(reason) <= 300),
  add column condition_code text references condition_defs (code) on update cascade on delete set null,
  add column assigned_by    uuid references profiles (id) on delete set null,
  add column assigned_at    timestamptz;
create index tracked_vitals_condition_idx on tracked_vitals (condition_code) where condition_code is not null;

create function frequency_label(f text) returns text language sql immutable as $$
  select case f when 'as_needed' then 'when needed' when 'weekly' then 'once a week' when 'daily' then 'once a day'
                when 'twice_daily' then 'twice a day' when 'three_times_daily' then 'three times a day' else 'as usual' end $$;

/** The treating doctor sets how often a patient measures one vital (null frequency = the usual schedule). Tracks it if it was not. */
create function set_vital_plan(patient uuid, vital text, frequency text default null, reason text default null, condition text default null)
returns void language plpgsql security definer set search_path = public as $$
declare d vital_defs; was tracked_vitals; why text := nullif(trim(coalesce(reason, '')), '');
begin
  if not treats(patient) then raise exception 'Only the patient''s treating doctor can set their monitoring plan' using errcode = '42501'; end if;
  select * into d from vital_defs where id = vital and active;
  if not found then raise exception 'That vital is not collected' using errcode = '22023'; end if;
  if frequency is not null and frequency not in ('as_needed', 'weekly', 'daily', 'twice_daily', 'three_times_daily') then
    raise exception 'Choose how often to measure it' using errcode = '22023';
  end if;
  if condition is not null and not exists (select 1 from condition_defs where code = condition) then
    raise exception 'Unknown condition' using errcode = '22023';
  end if;
  select * into was from tracked_vitals where patient_id = patient and vital_id = vital;
  perform set_config('mcare.self_audited', '1', true);
  insert into tracked_vitals (patient_id, vital_id, frequency, reason, condition_code, assigned_by, assigned_at)
  values (patient, vital, frequency, left(why, 300), condition, auth.uid(), now())
  on conflict (patient_id, vital_id) do update
    set frequency = excluded.frequency, reason = excluded.reason, condition_code = excluded.condition_code,
        assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at;
  perform set_config('mcare.self_audited', '', true);
  if was.frequency is not distinct from frequency and was.reason is not distinct from left(why, 300) and was.patient_id is not null then return; end if;
  perform audit_event('Set monitoring plan', name_of(patient) || ' · ' || d.name || ' · ' || frequency_label(frequency), 'patient', patient::text, patient,
    case when was.patient_id is not null then jsonb_build_object('frequency', was.frequency, 'reason', was.reason) end,
    jsonb_build_object('frequency', frequency, 'reason', why));
  perform notify_about(patient, 'care_plan', 'Measuring ' || d.name,
    coalesce(name_of(auth.uid()), 'Your doctor') || case when frequency is null then ' set ' || d.name || ' back to the usual schedule'
      else ' asked you to measure ' || d.name || ' ' || frequency_label(frequency) end || coalesce(' · ' || why, ''),
    'vitals', 'vital', vital);
end $$;


/* ═══ Reviews of readings ═════════════════════════════════════════════
   Abnormal readings have the alert trail. A review records that the treating doctor looked at
   everything up to a moment, with an optional note the patient reads. Never edited. */
create table vital_reviews (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references patients (id) on delete cascade,
  reviewer_id      uuid not null references profiles (id),
  reviewed_through timestamptz not null default now(),
  note             text check (note is null or length(note) <= 1000),
  readings         int not null default 0 check (readings >= 0),   -- how many readings it covered since the review before
  created_at       timestamptz not null default now(),
  client_ref       uuid
);
create index vital_reviews_patient_idx on vital_reviews (patient_id, reviewed_through desc);
create index vital_reviews_reviewer_idx on vital_reviews (reviewer_id);
create unique index vital_reviews_client_ref_key on vital_reviews (client_ref) where client_ref is not null;

alter table vital_reviews enable row level security;
create policy vital_reviews_read on vital_reviews for select to authenticated using (can_see_patient(patient_id));
create policy vital_reviews_active_only on vital_reviews as restrictive for all to authenticated using (account_active()) with check (account_active());
create trigger zz_touch_patient after insert or update or delete on vital_reviews for each row execute function touch_patient('patient_id');
create trigger vital_reviews_append_only before update or delete on vital_reviews for each row execute function no_rewrite();

/** The treating doctor marks a patient's readings reviewed up to now. Resolves with the review's id. */
create function review_vitals(patient uuid, note text default null, ref uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; last_at timestamptz; n int; clean text := nullif(trim(coalesce(note, '')), '');
begin
  if not treats(patient) then raise exception 'Only the patient''s treating doctor can review their readings' using errcode = '42501'; end if;
  if ref is not null then
    select id into rid from vital_reviews where client_ref = ref;
    if found then return rid; end if;
  end if;
  select max(reviewed_through) into last_at from vital_reviews where patient_id = patient;
  select count(*) into n from readings where patient_id = patient and not invalid and (last_at is null or taken_at > last_at);
  insert into vital_reviews (patient_id, reviewer_id, note, readings, client_ref)
  values (patient, auth.uid(), left(clean, 1000), n, ref) returning id into rid;
  perform audit_event('Reviewed readings', name_of(patient) || ' · ' || n || ' reading' || case when n = 1 then '' else 's' end || coalesce(' · ' || left(clean, 120), ''),
    'patient', patient::text, patient);
  perform notify_about(patient, 'care_plan', 'Your doctor reviewed your readings',
    coalesce(name_of(auth.uid()), 'Your doctor') || ' looked at your readings' || coalesce(': ' || left(clean, 200), '.'), 'vitals', 'patient', patient::text);
  return rid;
end $$;


/* ═══ The care team, as one list ══════════════════════════════════════
   The treating doctor (patients.assigned_doctor_id) and each current consulting doctor
   (care_team_members), with their role on the team. A view with the caller's rights: the row
   rules of the two tables decide who sees which rows. */
create view patient_care_team with (security_invoker = true) as
  select p.id as patient_id, p.assigned_doctor_id as member_id, 'treating'::text as member_role, true as is_primary,
         a.started_at, a.assigned_by as added_by, a.reason
  from patients p left join care_assignments a on a.patient_id = p.id and a.ended_at is null
  where p.assigned_doctor_id is not null
  union all
  select m.patient_id, m.doctor_id, 'consulting', false, m.started_at, m.added_by, m.reason
  from care_team_members m where m.ended_at is null;
revoke all on patient_care_team from anon;
grant select on patient_care_team to authenticated;


/* ═══ Grants ══════════════════════════════════════════════════════════ */
revoke execute on function condition_def_audit(), condition_link(), frequency_label(text) from public, anon, authenticated;
revoke execute on function set_vital_plan(uuid, text, text, text, text), review_vitals(uuid, text, uuid), save_condition_def(jsonb) from public, anon;
grant execute on function set_vital_plan(uuid, text, text, text, text), review_vitals(uuid, text, uuid), save_condition_def(jsonb) to authenticated;

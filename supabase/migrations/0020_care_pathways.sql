-- P1 care pathways: each condition in the catalogue carries a starting plan (how often to measure each vital and a
-- target, a daily fluid limit, a diet note, starter care-plan goals), and the treating doctor applies a reviewed bundle in one step.
-- The defaults are suggestions for the doctor, seeded unreviewed; an admin marks a condition clinically reviewed.

/* ── The pathway on the catalogue ─────────────────────────────────────── */
alter table condition_vitals
  add column frequency  text check (frequency is null or frequency in ('as_needed', 'weekly', 'daily', 'twice_daily', 'three_times_daily')),
  add column target_min numeric,
  add column target_max numeric,
  add constraint condition_vitals_target_order check (target_min is null or target_max is null or target_min < target_max);

alter table condition_defs
  add column fluid_limit_glasses int check (fluid_limit_glasses is null or fluid_limit_glasses between 1 and 30),
  add column diet_note   text check (diet_note is null or length(diet_note) <= 500),
  add column reviewed_by uuid references profiles (id) on delete set null,
  add column reviewed_at timestamptz;

create table condition_goals (
  id             uuid primary key default gen_random_uuid(),
  condition_code text not null references condition_defs (code) on update cascade on delete cascade,
  text           text not null check (length(trim(text)) between 1 and 300),
  vital_id       text references vital_defs (id),
  position       int  not null default 0
);
create index condition_goals_code_idx on condition_goals (condition_code, position);
alter table condition_goals enable row level security;
create policy condition_goals_read on condition_goals for select to authenticated using (true);
create policy condition_goals_write on condition_goals for all to authenticated using (is_admin()) with check (is_admin());
create policy condition_goals_active_only on condition_goals as restrictive for all to authenticated
  using ((select account_active())) with check ((select account_active()));
create trigger zz_touch_topic after insert or update or delete on condition_goals for each statement execute function touch_topic('settings');

/* ── Starting values (to be clinically reviewed; units are the vitals' base units) ── */
update condition_vitals set frequency = 'daily', target_min = 90, target_max = 130 where condition_code = 'hypertension' and vital_id = 'bp';
update condition_vitals set frequency = 'twice_daily', target_min = 80, target_max = 130 where condition_code in ('diabetes_t2', 'diabetes_t1') and vital_id = 'gluc';
update condition_vitals set frequency = 'weekly' where condition_code = 'diabetes_t2' and vital_id = 'wt';
update condition_vitals set frequency = 'daily' where condition_code = 'heart_failure' and vital_id in ('wt', 'bp');
update condition_vitals set frequency = 'daily', target_min = 90, target_max = 130 where condition_code = 'ckd' and vital_id = 'bp';
update condition_vitals set frequency = 'weekly' where condition_code = 'ckd' and vital_id = 'wt';
update condition_vitals set frequency = 'daily' where condition_code in ('asthma', 'copd') and vital_id = 'spo2';
update condition_vitals set frequency = 'daily' where condition_code in ('heart_disease', 'stroke_past') and vital_id = 'bp';

update condition_defs set fluid_limit_glasses = 6, diet_note = 'Low salt (under 5 g a day). All drinks count towards the daily fluid limit.' where code = 'heart_failure';
update condition_defs set diet_note = 'Low salt (under 5 g a day): plenty of vegetables, fruit and whole grains.' where code = 'hypertension';
update condition_defs set diet_note = 'Regular meals; limit sugar, sweet drinks and refined starch.' where code in ('diabetes_t2', 'diabetes_t1');
update condition_defs set diet_note = 'Low salt; potassium, phosphate and protein as the doctor advises.' where code = 'ckd';
update condition_defs set diet_note = 'Limit saturated fat and fried food; more fibre.' where code = 'high_cholesterol';

insert into condition_goals (condition_code, text, vital_id, position) values
  ('hypertension',  'Home blood pressure on target most days', 'bp', 1),
  ('diabetes_t2',   'Glucose before meals on target most days', 'gluc', 1),
  ('diabetes_t1',   'Glucose before meals on target most days', 'gluc', 1),
  ('heart_failure', 'Weigh every morning; tell the doctor of a gain of 2 kg in 3 days', 'wt', 1),
  ('heart_failure', 'Stay within the daily fluid limit', null, 2),
  ('ckd',           'Blood pressure on target most days', 'bp', 1),
  ('copd',          'Know the oxygen level that means calling the doctor', 'spo2', 1),
  ('asthma',        'Know the oxygen level that means calling the doctor', 'spo2', 1);

/* ── Admin: the catalogue entry with its pathway, in one transaction ──── */
-- Replaces 0015's version: also the per-vital frequency and target, fluid limit, diet note, goals and clinical review.
-- A change to the clinical content clears the review unless the same save marks it reviewed.
create or replace function save_condition_def(def jsonb) returns text language plpgsql security definer set search_path = public as $$
declare c text := lower(trim(coalesce(def ->> 'code', ''))); nm text := trim(coalesce(def ->> 'name', ''));
        before jsonb; after jsonb; v jsonb; g jsonb; pos int := 0;
begin
  if not is_admin() then raise exception 'Only an admin can change the conditions list' using errcode = '42501'; end if;
  if c = '' then c := trim(both '_' from regexp_replace(lower(nm), '[^a-z0-9]+', '_', 'g')); end if;
  if nm = '' or c !~ '^[a-z0-9_]{2,40}$' then raise exception 'Give the condition a name' using errcode = '22023'; end if;
  before := pathway_of(c);
  insert into condition_defs (code, name, icon, icd10, active, position, fluid_limit_glasses, diet_note)
  values (c, nm, coalesce(nullif(def ->> 'icon', ''), '🩺'), nullif(upper(trim(coalesce(def ->> 'icd10', ''))), ''),
          coalesce((def ->> 'active')::boolean, true), coalesce((select max(position) + 1 from condition_defs), 1),
          nullif(def ->> 'fluid_limit_glasses', '')::int, nullif(trim(coalesce(def ->> 'diet_note', '')), ''))
  on conflict (code) do update set name = excluded.name, icon = excluded.icon, icd10 = excluded.icd10, active = excluded.active,
    fluid_limit_glasses = excluded.fluid_limit_glasses, diet_note = excluded.diet_note;
  delete from condition_vitals where condition_code = c;
  -- `vitals` is either ["bp", …] (the 0015 shape) or [{ "vital_id": "bp", "frequency": "daily", "target_min": 90, "target_max": 130 }, …]
  for v in select * from jsonb_array_elements(coalesce(def -> 'vitals', '[]'::jsonb)) loop
    pos := pos + 1;
    if jsonb_typeof(v) = 'string' then v := jsonb_build_object('vital_id', v #>> '{}'); end if;
    if not exists (select 1 from vital_defs d where d.id = v ->> 'vital_id') then continue; end if;
    insert into condition_vitals (condition_code, vital_id, position, frequency, target_min, target_max)
    values (c, v ->> 'vital_id', pos, nullif(v ->> 'frequency', ''), nullif(v ->> 'target_min', '')::numeric, nullif(v ->> 'target_max', '')::numeric);
  end loop;
  if def ? 'goals' then
    delete from condition_goals where condition_code = c;
    pos := 0;
    for g in select * from jsonb_array_elements(coalesce(def -> 'goals', '[]'::jsonb)) loop
      if length(trim(coalesce(g ->> 'text', ''))) = 0 then continue; end if;
      pos := pos + 1;
      insert into condition_goals (condition_code, text, vital_id, position)
      values (c, trim(g ->> 'text'), nullif(g ->> 'vital_id', ''), pos);
    end loop;
  end if;
  after := pathway_of(c);
  if coalesce((def ->> 'reviewed')::boolean, false) then
    update condition_defs set reviewed_by = auth.uid(), reviewed_at = now() where code = c;
    perform audit_event('Reviewed condition pathway', nm, 'condition', c, null, before, after);
  elsif before is distinct from after then
    update condition_defs set reviewed_by = null, reviewed_at = null where code = c;
  end if;
  return c;
end $$;

/** The clinical content of a condition's pathway, for audit and review comparisons. */
create function pathway_of(c text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'fluid_limit_glasses', d.fluid_limit_glasses, 'diet_note', d.diet_note,
    'vitals', coalesce((select jsonb_agg(jsonb_build_object('vital_id', v.vital_id, 'frequency', v.frequency, 'target_min', v.target_min, 'target_max', v.target_max) order by v.position)
                        from condition_vitals v where v.condition_code = c), '[]'),
    'goals', coalesce((select jsonb_agg(jsonb_build_object('text', g.text, 'vital_id', g.vital_id) order by g.position)
                       from condition_goals g where g.condition_code = c), '[]'))
  from condition_defs d where d.code = c
$$;

/* ── The treating doctor applies a reviewed bundle ────────────────────── */
-- plan = {
--   conditions: ["hypertension", …]                      (what it was built from: for the audit and the patient's message)
--   vitals: [{ vital_id, frequency|null, reason|null, condition_code|null, target_min|null, target_max|null }]
--   fluid_limit_glasses: int|null,  diet_note: text|null
--   goals: [{ text, vital_id|null }],  care_plan_title: text|null
-- }
-- One transaction: monitoring plan, targets, fluid limit and diet note on the meal plan, and a DRAFT care plan with the
-- goals (the doctor starts it when ready). Audited once with the whole bundle; the patient is told once.
create function apply_pathway(patient uuid, plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb; g jsonb; d vital_defs; freq text; tmin numeric; tmax numeric; cp uuid; n_vitals int := 0; n_targets int := 0;
  fluid int := nullif(plan ->> 'fluid_limit_glasses', '')::int; diet text := nullif(trim(coalesce(plan ->> 'diet_note', '')), '');
  names text;
begin
  if not treats(patient) then raise exception 'Only the patient''s treating doctor can set up their care' using errcode = '42501'; end if;
  if jsonb_typeof(plan) is distinct from 'object' then raise exception 'Nothing to apply' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(plan -> 'vitals', '[]')) > 20 or jsonb_array_length(coalesce(plan -> 'goals', '[]')) > 20 then
    raise exception 'That is too much to apply at once' using errcode = '22023';
  end if;
  if fluid is not null and fluid not between 1 and 30 then raise exception 'A fluid limit must be between 1 and 30 glasses' using errcode = '22023'; end if;
  if diet is not null and length(diet) > 1000 then raise exception 'Keep the diet note under 1000 characters' using errcode = '22023'; end if;

  perform set_config('mcare.self_audited', '1', true);
  for v in select * from jsonb_array_elements(coalesce(plan -> 'vitals', '[]')) loop
    select * into d from vital_defs where id = v ->> 'vital_id' and active;
    if not found then raise exception 'That vital is not collected: %', v ->> 'vital_id' using errcode = '22023'; end if;
    freq := nullif(v ->> 'frequency', '');
    if freq is not null and freq not in ('as_needed', 'weekly', 'daily', 'twice_daily', 'three_times_daily') then
      raise exception 'Choose how often to measure %', d.name using errcode = '22023';
    end if;
    if nullif(v ->> 'condition_code', '') is not null and not exists (select 1 from condition_defs where code = v ->> 'condition_code') then
      raise exception 'Unknown condition' using errcode = '22023';
    end if;
    insert into tracked_vitals (patient_id, vital_id, frequency, reason, condition_code, assigned_by, assigned_at)
    values (patient, d.id, freq, left(nullif(trim(coalesce(v ->> 'reason', '')), ''), 300), nullif(v ->> 'condition_code', ''), auth.uid(), now())
    on conflict (patient_id, vital_id) do update
      set frequency = excluded.frequency, reason = excluded.reason, condition_code = excluded.condition_code,
          assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at;
    n_vitals := n_vitals + 1;
    tmin := nullif(v ->> 'target_min', '')::numeric; tmax := nullif(v ->> 'target_max', '')::numeric;
    if tmin is not null and tmax is not null then
      if not (tmin < tmax) or tmin < d.hard_min or tmax > d.hard_max then
        raise exception 'The target for % must be a low value below a high one, within % to % %', d.name, d.hard_min, d.hard_max, d.unit using errcode = '22023';
      end if;
      insert into thresholds (patient_id, vital_id, target_min, target_max)
      values (patient, d.id, tmin, tmax)
      on conflict (patient_id, vital_id) do update set target_min = excluded.target_min, target_max = excluded.target_max;
      n_targets := n_targets + 1;
    end if;
  end loop;
  perform set_config('mcare.self_audited', '', true);

  if fluid is not null or diet is not null then
    insert into meal_plans (patient_id, fluid_mode, water_goal, dietary_note, set_by)
    values (patient, case when fluid is not null then 'limit' else 'goal' end, coalesce(fluid, 8), diet, auth.uid())
    on conflict (patient_id) do update set
      fluid_mode   = case when fluid is not null then 'limit' else meal_plans.fluid_mode end,
      water_goal   = coalesce(fluid, meal_plans.water_goal),
      dietary_note = coalesce(meal_plans.dietary_note, diet),
      set_by       = auth.uid();
  end if;

  if jsonb_array_length(coalesce(plan -> 'goals', '[]')) > 0 then
    insert into care_plans (patient_id, doctor_id, title, status, start_date)
    values (patient, auth.uid(), left(coalesce(nullif(trim(plan ->> 'care_plan_title'), ''), 'Care plan'), 120), 'draft', current_date)
    returning id into cp;
    for g in select * from jsonb_array_elements(plan -> 'goals') loop
      if length(trim(coalesce(g ->> 'text', ''))) = 0 then continue; end if;
      insert into care_plan_items (plan_id, patient_id, kind, text, vital_id)
      values (cp, patient, 'goal', left(trim(g ->> 'text'), 500), nullif(g ->> 'vital_id', ''));
    end loop;
  end if;

  select string_agg(name, ', ' order by position) into names from condition_defs
  where code in (select jsonb_array_elements_text(coalesce(plan -> 'conditions', '[]')));
  perform audit_event('Applied care pathway', name_of(patient) || coalesce(' · ' || names, '') || ' · ' || n_vitals || ' vitals, ' || n_targets || ' targets'
      || case when fluid is not null then ', fluid limit ' || fluid || ' glasses' else '' end || case when cp is not null then ', draft care plan' else '' end,
    'patient', patient::text, patient, null, plan);
  perform notify_about(patient, 'care_plan', 'Your care was set up',
    coalesce(name_of(auth.uid()), 'Your doctor') || ' set up your monitoring' || coalesce(' for ' || names, '')
      || case when fluid is not null then ' · fluid limit ' || fluid || ' glasses a day' else '' end, 'vitals', 'patient', patient::text);
  return jsonb_build_object('vitals', n_vitals, 'targets', n_targets, 'fluid_limit', fluid, 'care_plan_id', cp);
end $$;

revoke execute on function pathway_of(text) from public, anon, authenticated;
revoke execute on function apply_pathway(uuid, jsonb) from public, anon;
grant execute on function apply_pathway(uuid, jsonb) to authenticated;

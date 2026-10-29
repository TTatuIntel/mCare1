-- 0024: the vital model. From the review of the vital structure (items 4, 5, 8, 9, 10, 12, 15, 16):
-- personal diastolic ranges, "no critical edge" without sentinel numbers, vitals that are recorded but not graded (height),
-- grouping, check-in rhythm and decimals kept on the definition, ranges per measurement context (glucose fasting / after a
-- meal), where a reading came from, the range each reading was graded against, admin changes to a definition with a
-- reason, before/after and the doctors told,.
-- (Item 5, vitals a condition suggests that are not collected, is handled in the app: lib/health.ts suggests only collected vitals.)
-- Additive: new columns with defaults matching today's behaviour; seeds adjusted only where they used sentinel values.
-- Rollback: re-run the 0004 bodies of grade_reading, reading_before, threshold_changed, vital_def_audit;
-- drop the columns added here; drop functions grading_range, save_vital_def, vital_def_impact.


/* ═══ Definitions ═════════════════════════════════════════════════════ */
alter table vital_defs
  add column graded           boolean not null default true,    -- false: recorded only (height); never an alert
  add column critical_fallback boolean not null default true,   -- an empty critical edge means normal ± 25 % (true) or no edge (false)
  add column group_id         text check (group_id is null or group_id in ('cardiac', 'respiratory', 'metabolic', 'body')),
  add column checkin_hours    int  check (checkin_hours is null or checkin_hours between 1 and 8760),
  add column decimals         int  not null default 0 check (decimals between 0 and 3),
  add column context_ranges   jsonb not null default '{}' check (jsonb_typeof(context_ranges) = 'object');

update vital_defs set group_id = g.grp, checkin_hours = g.hrs, decimals = g.dec from (values
  ('bp', 'cardiac', 12, 0), ('hr', 'cardiac', 12, 0), ('spo2', 'respiratory', 24, 0), ('rr', 'respiratory', 24, 0),
  ('gluc', 'metabolic', 12, 0), ('chol', 'metabolic', 720, 0), ('temp', 'metabolic', 24, 1),
  ('wt', 'body', 168, 1), ('ht', 'body', 2160, 0)
) g(id, grp, hrs, dec) where vital_defs.id = g.id;
-- Sentinels out: SpO2 had critical_max 101 and cholesterol critical_min -1 to mean "never".
update vital_defs set critical_max = null, critical_fallback = false where id = 'spo2' and critical_max = 101;
update vital_defs set critical_min = null, critical_fallback = false where id = 'chol' and critical_min = -1;
update vital_defs set graded = false where id = 'ht';
-- Glucose depends on when it was measured (starting values, not clinically reviewed; a doctor's personal target wins).
update vital_defs set context_ranges = '{"fasting": {"normal_min": 70, "normal_max": 100}, "before_meal": {"normal_min": 70, "normal_max": 130},
  "after_meal": {"normal_min": 70, "normal_max": 180}, "bedtime": {"normal_min": 90, "normal_max": 150}}'
where id = 'gluc' and context_ranges = '{}';


/* ═══ Personal diastolic ranges (item 4) ══════════════════════════════ */
alter table thresholds
  add column dia_target_min   numeric, add column dia_target_max   numeric,
  add column dia_critical_min numeric, add column dia_critical_max numeric,
  add constraint thresholds_dia_target_pair check ((dia_target_min is null) = (dia_target_max is null) and (dia_target_min is null or dia_target_min < dia_target_max)),
  add constraint thresholds_dia_critical_order check (dia_critical_min is null or dia_critical_max is null or dia_critical_min < dia_critical_max);
alter table threshold_changes add column from_dia jsonb, add column to_dia jsonb;


/* ═══ Readings: context, source, the range used (items 12, 15, 16) ═══ */
alter table readings
  add column context text check (context is null or context in ('fasting', 'before_meal', 'after_meal', 'bedtime', 'resting', 'after_exercise')),
  add column source  text not null default 'manual' check (source in ('manual', 'clinic', 'device')),
  add column graded_range jsonb;
update readings set source = 'clinic' where recorded_by is not null and recorded_by <> patient_id and source = 'manual';


/* ═══ Grading ═════════════════════════════════════════════════════════ */
/** The ranges a reading of this vital is graded against for this patient (and context). Null edges mean "no edge".
    { target: [min, max], critical: [min, max], dia_target: [..], dia_critical: [..], graded, context, personal } */
create function grading_range(patient uuid, vital text, ctx text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d vital_defs; t thresholds; span numeric; tmin numeric; tmax numeric; cmin numeric; cmax numeric; c jsonb;
begin
  select * into d from vital_defs where id = vital;
  if not found then return null; end if;
  select * into t from thresholds where patient_id = patient and vital_id = vital;
  c := case when ctx is not null then d.context_ranges -> ctx end;
  tmin := coalesce(t.target_min, (c ->> 'normal_min')::numeric, d.normal_min);
  tmax := coalesce(t.target_max, (c ->> 'normal_max')::numeric, d.normal_max);
  span := d.normal_max - d.normal_min;
  cmin := coalesce(t.critical_min, d.critical_min, case when d.critical_fallback then d.normal_min - span * 0.25 end);
  cmax := coalesce(t.critical_max, d.critical_max, case when d.critical_fallback then d.normal_max + span * 0.25 end);
  -- A critical edge always lies outside the target: a standard edge inside a personal target (COPD: target 88–92 %, standard
  -- critical ≤ 90 %) moves out by a quarter of the target's width, so an in-target reading is never critical.
  if cmin is not null and cmin >= tmin then cmin := tmin - (tmax - tmin) * 0.25; end if;
  if cmax is not null and cmax <= tmax then cmax := tmax + (tmax - tmin) * 0.25; end if;
  return jsonb_build_object(
    'graded', d.graded, 'context', ctx, 'personal', t.patient_id is not null,
    'target', jsonb_build_array(tmin, tmax),
    'critical', jsonb_build_array(cmin, cmax),
    'dia_target', case when vital = 'bp' then jsonb_build_array(coalesce(t.dia_target_min, d.dia_normal_min, 60), coalesce(t.dia_target_max, d.dia_normal_max, 90)) end,
    'dia_critical', case when vital = 'bp' then jsonb_build_array(coalesce(t.dia_critical_min, d.dia_critical_min, 40), coalesce(t.dia_critical_max, d.dia_critical_max, 120)) end);
end $$;

-- A null edge never matches (SQL: n <= null is not true), so "no edge" needs no sentinel.
create function grade_by(n numeric, g jsonb, part text) returns vital_level language sql immutable as $$
  select grade(n, (g -> (part || 'target') ->> 0)::numeric, (g -> (part || 'target') ->> 1)::numeric,
                  (g -> (part || 'critical') ->> 0)::numeric, (g -> (part || 'critical') ->> 1)::numeric) $$;

create function grade_reading(patient uuid, vital text, prim numeric, sec numeric, ctx text) returns vital_level
language plpgsql stable security definer set search_path = public as $$
declare g jsonb := grading_range(patient, vital, ctx); lvl vital_level; dia vital_level;
begin
  if g is null or not (g ->> 'graded')::boolean then return 'normal'; end if;
  lvl := coalesce(grade_by(prim, g, ''), 'normal');
  if vital = 'bp' and sec is not null then
    dia := coalesce(grade_by(sec, g, 'dia_'), 'normal');
    if dia > lvl then lvl := dia; end if;   -- enum order: normal < warning < critical
  end if;
  return lvl;
end $$;

create or replace function grade_reading(patient uuid, vital text, prim numeric, sec numeric) returns vital_level
language sql stable security definer set search_path = public as $$ select grade_reading(patient, vital, prim, sec, null) $$;

-- 0004's reading_before, grading with the context, keeping the context and source fixed after the first save, and stamping the range used.
create or replace function reading_before() returns trigger language plpgsql security definer set search_path = public as $$
declare
  d vital_defs; m text[];
begin
  select * into d from vital_defs where id = new.vital_id;
  if not found then raise exception 'Unknown vital' using errcode = '22023'; end if;
  if tg_op = 'UPDATE' then
    if new.patient_id <> old.patient_id or new.vital_id <> old.vital_id or new.taken_at <> old.taken_at
       or new.recorded_by is distinct from old.recorded_by then
      raise exception 'A reading cannot be moved' using errcode = '42501';
    end if;
    new.context := old.context; new.source := old.source;
    new.corrected_from := old.corrected_from; new.corrected_at := old.corrected_at;
    if trim(new.value) <> old.value then
      if auth.uid() is not null and (auth.uid() is distinct from old.recorded_by or now() - old.taken_at > interval '15 minutes') then
        raise exception 'Readings can only be corrected within 15 minutes, by whoever entered them' using errcode = '42501';
      end if;
      new.corrected_from := coalesce(old.corrected_from, old.value);
      new.corrected_at := now();
    end if;
    if (new.invalid <> old.invalid or new.invalid_reason is distinct from old.invalid_reason)
       and auth.uid() is not null and not treats(old.patient_id) then
      raise exception 'Only the treating doctor can mark a reading invalid' using errcode = '42501';
    end if;
    if new.invalid and length(trim(coalesce(new.invalid_reason, ''))) = 0 then
      raise exception 'Say why the reading is invalid' using errcode = '22023';
    end if;
  else
    if not d.active then raise exception '% is not being collected', d.name using errcode = '22023'; end if;
    new.taken_at := now();   -- the server's clock, not the phone's
    new.recorded_by := coalesce(auth.uid(), new.recorded_by, new.patient_id);
    -- Entered by someone other than the patient = a clinic reading; a device reading is said so by the app.
    new.source := case when new.recorded_by <> new.patient_id then 'clinic' when new.source = 'device' then 'device' else 'manual' end;
    new.corrected_from := null; new.corrected_at := null; new.invalid := false; new.invalid_reason := null;
  end if;

  new.value := trim(new.value);
  new.note := nullif(trim(coalesce(new.note, '')), '');
  if new.vital_id = 'bp' then
    m := regexp_match(new.value, '^(\d{2,3})\s*/\s*(\d{2,3})$');
    if m is null then raise exception 'Use the format 120/80' using errcode = '22023'; end if;
    new.primary_value := m[1]::numeric; new.secondary_value := m[2]::numeric;
    new.value := m[1] || '/' || m[2];
    if new.secondary_value < 30 or new.secondary_value > 150 or new.secondary_value >= new.primary_value then
      raise exception 'That blood pressure does not look right' using errcode = '22023';
    end if;
  else
    if new.value !~ '^-?\d+(\.\d+)?$' then raise exception 'Enter a number' using errcode = '22023'; end if;
    new.primary_value := new.value::numeric; new.secondary_value := null;
  end if;
  if new.primary_value < d.hard_min or new.primary_value > d.hard_max then
    raise exception '% is usually between % and % %', d.name, d.hard_min, d.hard_max, d.unit using errcode = '22023';
  end if;
  new.graded_range := grading_range(new.patient_id, new.vital_id, new.context);
  new.level := grade_reading(new.patient_id, new.vital_id, new.primary_value, new.secondary_value, new.context);
  return new;
end $$;


/* ═══ Target history and audit, with the diastolic ranges ═════════════ */
create or replace function threshold_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare d vital_defs; target_same boolean; critical_same boolean; dia_same boolean; old_dia jsonb; new_dia jsonb;
begin
  if tg_op = 'DELETE' then
    insert into threshold_changes (patient_id, vital_id, from_min, from_max, from_critical_min, from_critical_max, from_dia, changed_by)
    values (old.patient_id, old.vital_id, old.target_min, old.target_max, old.critical_min, old.critical_max,
            nullif(jsonb_strip_nulls(jsonb_build_object('target_min', old.dia_target_min, 'target_max', old.dia_target_max,
              'critical_min', old.dia_critical_min, 'critical_max', old.dia_critical_max)), '{}'), auth.uid());
    return old;
  end if;
  new_dia := nullif(jsonb_strip_nulls(jsonb_build_object('target_min', new.dia_target_min, 'target_max', new.dia_target_max,
    'critical_min', new.dia_critical_min, 'critical_max', new.dia_critical_max)), '{}');
  old_dia := case when tg_op = 'UPDATE' then nullif(jsonb_strip_nulls(jsonb_build_object('target_min', old.dia_target_min, 'target_max', old.dia_target_max,
    'critical_min', old.dia_critical_min, 'critical_max', old.dia_critical_max)), '{}') end;
  target_same := tg_op = 'UPDATE' and new.target_min = old.target_min and new.target_max = old.target_max;
  critical_same := case when tg_op = 'UPDATE'
    then (new.critical_min, new.critical_max) is not distinct from (old.critical_min, old.critical_max)
    else new.critical_min is null and new.critical_max is null end;
  dia_same := old_dia is not distinct from new_dia;
  if target_same and critical_same and dia_same then return new; end if;

  select * into d from vital_defs where id = new.vital_id;
  insert into threshold_changes (patient_id, vital_id, from_min, from_max, to_min, to_max,
                                 from_critical_min, from_critical_max, to_critical_min, to_critical_max, from_dia, to_dia, changed_by)
  values (new.patient_id, new.vital_id,
          case when tg_op = 'UPDATE' then old.target_min end, case when tg_op = 'UPDATE' then old.target_max end,
          new.target_min, new.target_max,
          case when tg_op = 'UPDATE' then old.critical_min end, case when tg_op = 'UPDATE' then old.critical_max end,
          new.critical_min, new.critical_max, old_dia, new_dia, new.set_by);
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
  if not dia_same then
    if (old_dia -> 'target_min', old_dia -> 'target_max') is distinct from (new_dia -> 'target_min', new_dia -> 'target_max') then
      perform notify_user(new.patient_id, 'alert', 'Your target was updated',
        d.name || ' (lower number): ' || coalesce(new.dia_target_min || '–' || new.dia_target_max, 'back to the standard range') || ' ' || d.unit, 'vitals');
    end if;
    perform audit_event('Set diastolic range', name_of(new.patient_id) || ' · ' || d.name || ' ' || coalesce(new_dia::text, 'back to the standard range'),
      'threshold', new.vital_id, new.patient_id, old_dia, new_dia, new.set_by);
  end if;
  return new;
end $$;


/* ═══ Changing a definition (item 9) ══════════════════════════════════ */
-- Direct admin edits stay possible (and are audited with before and after); the app uses save_vital_def, which needs a reason
-- for a change to how readings are graded, and tells the treating doctors whose patients it affects.
create or replace function vital_def_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or acting('self_audited') then return new; end if;
  if tg_op = 'INSERT' then
    perform audit_event('Added vital type', new.name, 'vital_def', new.id, null, null, to_jsonb(new));
  elsif new.active <> old.active then
    perform audit_event(case when new.active then 'Activated vital type' else 'Deactivated vital type' end, new.name, 'vital_def', new.id, null,
      jsonb_build_object('active', old.active), jsonb_build_object('active', new.active));
  elsif to_jsonb(new) is distinct from to_jsonb(old) then
    perform audit_event('Updated vital definition', new.name || ': normal ' || new.normal_min || '–' || new.normal_max, 'vital_def', new.id, null, to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end $$;

/** How many patients are graded by this definition's standard range (they track it and have no personal target). Admin only. */
create function vital_def_impact(vital text) returns int language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only an admin can do this' using errcode = '42501'; end if;
  return (select count(*)::int from tracked_vitals t join profiles p on p.id = t.patient_id and p.status = 'active'
          where t.vital_id = vital and not exists (select 1 from thresholds h where h.patient_id = t.patient_id and h.vital_id = vital));
end $$;

/** An admin adds or changes a vital definition. A change to how readings are graded needs a reason; it is audited with before
    and after and the reason, and each treating doctor of an affected patient is told once. Returns the id. */
create function save_vital_def(def jsonb, reason text default null) returns text language plpgsql security definer set search_path = public as $$
declare was vital_defs; now_def vital_defs; vid text := trim(coalesce(def ->> 'id', '')); why text := nullif(trim(coalesce(reason, '')), '');
  grading_changed boolean; doc record;
begin
  if not is_admin() then raise exception 'Only an admin can change vital definitions' using errcode = '42501'; end if;
  if vid !~ '^[a-z0-9_]{1,60}$' then raise exception 'That vital needs an id' using errcode = '22023'; end if;
  select * into was from vital_defs where id = vid;
  perform set_config('mcare.self_audited', '1', true);
  insert into vital_defs (id, name, unit, icon, active, normal_min, normal_max, critical_min, critical_max, hard_min, hard_max,
                          dia_normal_min, dia_normal_max, dia_critical_min, dia_critical_max, unit_options,
                          graded, critical_fallback, group_id, checkin_hours, decimals, context_ranges)
  select vid, trim(x.name), trim(x.unit), coalesce(x.icon, ''), coalesce(x.active, true), x.normal_min, x.normal_max, x.critical_min, x.critical_max,
         x.hard_min, x.hard_max, x.dia_normal_min, x.dia_normal_max, x.dia_critical_min, x.dia_critical_max, x.unit_options,
         coalesce(x.graded, true), coalesce(x.critical_fallback, true), x.group_id, x.checkin_hours, coalesce(x.decimals, 0), coalesce(x.context_ranges, '{}')
  from jsonb_populate_record(null::vital_defs, def) x
  on conflict (id) do update set name = excluded.name, unit = excluded.unit, icon = excluded.icon, active = excluded.active,
    normal_min = excluded.normal_min, normal_max = excluded.normal_max, critical_min = excluded.critical_min, critical_max = excluded.critical_max,
    hard_min = excluded.hard_min, hard_max = excluded.hard_max, dia_normal_min = excluded.dia_normal_min, dia_normal_max = excluded.dia_normal_max,
    dia_critical_min = excluded.dia_critical_min, dia_critical_max = excluded.dia_critical_max, unit_options = excluded.unit_options,
    graded = excluded.graded, critical_fallback = excluded.critical_fallback, group_id = excluded.group_id, checkin_hours = excluded.checkin_hours,
    decimals = excluded.decimals, context_ranges = excluded.context_ranges;
  perform set_config('mcare.self_audited', '', true);
  select * into now_def from vital_defs where id = vid;

  grading_changed := was.id is not null and (
    (was.normal_min, was.normal_max, was.critical_min, was.critical_max, was.dia_normal_min, was.dia_normal_max, was.dia_critical_min,
     was.dia_critical_max, was.graded, was.critical_fallback, was.context_ranges)
    is distinct from
    (now_def.normal_min, now_def.normal_max, now_def.critical_min, now_def.critical_max, now_def.dia_normal_min, now_def.dia_normal_max,
     now_def.dia_critical_min, now_def.dia_critical_max, now_def.graded, now_def.critical_fallback, now_def.context_ranges));
  if grading_changed and why is null then
    raise exception 'Say why the standard range is changing: it changes how readings are graded for patients without a personal target' using errcode = '22023';
  end if;

  perform audit_event(case when was.id is null then 'Added vital type' when was.active <> now_def.active
                             then case when now_def.active then 'Activated vital type' else 'Deactivated vital type' end
                           else 'Updated vital definition' end,
    now_def.name || coalesce(' · ' || why, ''), 'vital_def', vid, null, case when was.id is not null then to_jsonb(was) end, to_jsonb(now_def));

  if grading_changed then
    for doc in select distinct pt.assigned_doctor_id id from tracked_vitals t join patients pt on pt.id = t.patient_id
               where t.vital_id = vid and pt.assigned_doctor_id is not null
                 and not exists (select 1 from thresholds h where h.patient_id = t.patient_id and h.vital_id = vid) loop
      perform notify_user(doc.id, 'alert', 'Standard range changed: ' || now_def.name,
        'Normal ' || now_def.normal_min || '–' || now_def.normal_max || ' ' || now_def.unit || ' now applies to your patients without a personal target · ' || why, 'patients');
    end loop;
  end if;
  return vid;
end $$;


/* ═══ A target template: COPD (item 12) ═══════════════════════════════
   COPD patients often live at 88–92 % oxygen; the standard 95–100 % would warn every day. A starting value for the
   doctor's pathway, not clinically reviewed (the pathway's review mark is cleared, so the admin is asked to review it). */
update condition_vitals set target_min = 88, target_max = 92
where condition_code = 'copd' and vital_id = 'spo2' and target_min is null and target_max is null;
update condition_defs set reviewed_at = null, reviewed_by = null where code = 'copd';


/* ═══ Grants ══════════════════════════════════════════════════════════ */
-- Grading for any patient is internal: callable by the app it would reveal another patient's targets.
revoke execute on function grade_reading(uuid, text, numeric, numeric), grade_reading(uuid, text, numeric, numeric, text),
  grading_range(uuid, text, text), grade_by(numeric, jsonb, text)
from public, anon, authenticated;
revoke execute on function save_vital_def(jsonb, text), vital_def_impact(text) from public, anon;
grant execute on function save_vital_def(jsonb, text), vital_def_impact(text) to authenticated;

-- 0022: other words patients use for a catalogue condition ("high bp", "prediabetes"), kept by an admin in Settings → Conditions.
-- A condition typed by a patient that contains one is matched to that condition's vitals (lib/health.ts vitalsForCondition). Additive only.
-- First written as 0019 on branch vitals-insights; renumbered after the care pathways (0020), whose save_condition_def it extends.
-- Safe to run on a local database that already applied the old 0019 (if not exists / or replace / only where empty).
-- Rollback: restore save_condition_def from 0020, then `alter table condition_defs drop column keywords; drop function clean_keywords(jsonb);`.

alter table condition_defs add column if not exists keywords text[] not null default '{}'
  check (cardinality(keywords) <= 30 and array_position(keywords, '') is null);

/** Lower-case, trimmed, each 2–40 characters, no repeats, at most 30. */
create or replace function clean_keywords(words jsonb) returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(w order by first), '{}') from (
    select w, min(n) first from (
      select lower(regexp_replace(trim(v.value), '\s+', ' ', 'g')) w, v.ordinality n
      from jsonb_array_elements_text(case when jsonb_typeof(words) = 'array' then words else '[]'::jsonb end) with ordinality v
    ) x where length(w) between 2 and 40 group by w order by min(n) limit 30
  ) y
$$;
revoke execute on function clean_keywords(jsonb) from public, anon, authenticated;

/** 0020's save_condition_def (pathway: plans per vital, fluid limit, diet note, goals, review), now also saving `keywords`
    (a save without `keywords` keeps them). Keywords are not clinical content, so they do not clear a pathway review. */
create or replace function save_condition_def(def jsonb) returns text language plpgsql security definer set search_path = public as $$
declare c text := lower(trim(coalesce(def ->> 'code', ''))); nm text := trim(coalesce(def ->> 'name', ''));
        before jsonb; after jsonb; v jsonb; g jsonb; pos int := 0;
begin
  if not is_admin() then raise exception 'Only an admin can change the conditions list' using errcode = '42501'; end if;
  if c = '' then c := trim(both '_' from regexp_replace(lower(nm), '[^a-z0-9]+', '_', 'g')); end if;
  if nm = '' or c !~ '^[a-z0-9_]{2,40}$' then raise exception 'Give the condition a name' using errcode = '22023'; end if;
  before := pathway_of(c);
  insert into condition_defs (code, name, icon, icd10, active, position, fluid_limit_glasses, diet_note, keywords)
  values (c, nm, coalesce(nullif(def ->> 'icon', ''), '🩺'), nullif(upper(trim(coalesce(def ->> 'icd10', ''))), ''),
          coalesce((def ->> 'active')::boolean, true), coalesce((select max(position) + 1 from condition_defs), 1),
          nullif(def ->> 'fluid_limit_glasses', '')::int, nullif(trim(coalesce(def ->> 'diet_note', '')), ''),
          clean_keywords(def -> 'keywords'))
  on conflict (code) do update set name = excluded.name, icon = excluded.icon, icd10 = excluded.icd10, active = excluded.active,
    fluid_limit_glasses = excluded.fluid_limit_glasses, diet_note = excluded.diet_note,
    keywords = case when def ? 'keywords' then excluded.keywords else condition_defs.keywords end;
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

-- The same words the built-in list uses (COMMON_CONDITIONS), only where an admin has not set any.
update condition_defs d set keywords = k.words from (values
  ('hypertension',     array['high bp', 'hbp', 'htn']),
  ('diabetes_t2',      array['prediabetes', 'pre-diabetes', 'borderline diabetes', 'sugar']),
  ('heart_failure',    array['chf', 'weak heart']),
  ('copd',             array['emphysema', 'chronic bronchitis']),
  ('ckd',              array['kidney disease', 'kidney failure', 'ckd']),
  ('high_cholesterol', array['ldl', 'lipids', 'hyperlipid']),
  ('stroke_past',      array['tia', 'mini stroke']),
  ('sickle_cell',      array['sickle', 'scd']),
  ('thyroid',          array['hypothyroid', 'hyperthyroid', 'goitre', 'goiter', 'graves', 'hashimoto'])
) k(code, words) where d.code = k.code and d.keywords = '{}';

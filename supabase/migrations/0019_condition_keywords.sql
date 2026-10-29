-- 0019: other words patients use for a catalogue condition ("high bp", "prediabetes"), kept by an admin in Settings → Conditions.
-- A condition typed by a patient that contains one is matched to that condition's vitals (lib/health.ts vitalsForCondition). Additive only.

alter table condition_defs add column keywords text[] not null default '{}'
  check (cardinality(keywords) <= 30 and array_position(keywords, '') is null);

/** Lower-case, trimmed, each 2–40 characters, no repeats, at most 30. */
create function clean_keywords(words jsonb) returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(w order by first), '{}') from (
    select w, min(n) first from (
      select lower(regexp_replace(trim(v.value), '\s+', ' ', 'g')) w, v.ordinality n
      from jsonb_array_elements_text(case when jsonb_typeof(words) = 'array' then words else '[]'::jsonb end) with ordinality v
    ) x where length(w) between 2 and 40 group by w order by min(n) limit 30
  ) y
$$;
revoke execute on function clean_keywords(jsonb) from public, anon, authenticated;

create or replace function save_condition_def(def jsonb) returns text language plpgsql security definer set search_path = public as $$
declare c text := lower(trim(coalesce(def ->> 'code', ''))); nm text := trim(coalesce(def ->> 'name', ''));
begin
  if not is_admin() then raise exception 'Only an admin can change the conditions list' using errcode = '42501'; end if;
  if c = '' then c := trim(both '_' from regexp_replace(lower(nm), '[^a-z0-9]+', '_', 'g')); end if;
  if nm = '' or c !~ '^[a-z0-9_]{2,40}$' then raise exception 'Give the condition a name' using errcode = '22023'; end if;
  insert into condition_defs (code, name, icon, icd10, active, position, keywords)
  values (c, nm, coalesce(nullif(def ->> 'icon', ''), '🩺'), nullif(upper(trim(coalesce(def ->> 'icd10', ''))), ''),
          coalesce((def ->> 'active')::boolean, true), coalesce((select max(position) + 1 from condition_defs), 1),
          clean_keywords(def -> 'keywords'))
  on conflict (code) do update set name = excluded.name, icon = excluded.icon, icd10 = excluded.icd10, active = excluded.active,
    keywords = case when def ? 'keywords' then excluded.keywords else condition_defs.keywords end;
  delete from condition_vitals where condition_code = c;
  insert into condition_vitals (condition_code, vital_id, position)
  select c, v.value, v.ordinality from jsonb_array_elements_text(coalesce(def -> 'vitals', '[]'::jsonb)) with ordinality v
  where exists (select 1 from vital_defs d where d.id = v.value);
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

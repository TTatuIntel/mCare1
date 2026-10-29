-- P2 structured medicines: a medicine catalogue (class, usual doses, the vitals it needs watching, a default
-- "hold if" rule, how it goes with meals), and prescriptions with real dose times, a meal link, a hold rule and
-- the condition it treats. Prescribing a catalogue medicine starts tracking the vitals it needs. Free text still works.

/* ── The catalogue (admin-managed reference data) ─────────────────────── */
create table medication_defs (
  code           text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name           text not null check (length(trim(name)) between 1 and 80),
  drug_class     text not null default '' check (length(drug_class) <= 80),
  forms          text[] not null default '{}',
  usual_doses    text[] not null default '{}',
  route          text check (route is null or route in ('oral', 'topical', 'inhaled', 'injection', 'sublingual', 'eye', 'ear', 'nasal', 'rectal', 'other')),
  with_meal      text check (with_meal is null or with_meal in ('before', 'with', 'after', 'any')),
  monitor_vitals text[] not null default '{}',     -- vital ids to watch while taking it (furosemide → weight)
  hold_if        jsonb check (hold_if is null or jsonb_typeof(hold_if) = 'object'),  -- the default hold rule
  note           text check (note is null or length(note) <= 300),
  active         boolean not null default true
);
create unique index medication_defs_name_key on medication_defs (lower(name));

alter table medication_defs enable row level security;
create policy medication_defs_read on medication_defs for select to authenticated using (true);
create policy medication_defs_write on medication_defs for all to authenticated using (is_admin()) with check (is_admin());
create policy medication_defs_active_only on medication_defs as restrictive for all to authenticated
  using ((select account_active())) with check ((select account_active()));
create trigger zz_touch_topic after insert or update or delete on medication_defs for each statement execute function touch_topic('settings');

-- Common long-term medicines (to be clinically reviewed). Hold rules are the usual "check before taking" thresholds.
insert into medication_defs (code, name, drug_class, forms, usual_doses, route, with_meal, monitor_vitals, hold_if, note) values
  ('amlodipine',         'Amlodipine',         'Calcium-channel blocker', '{tablet}', '{2.5 mg,5 mg,10 mg}',      'oral', 'any',    '{bp}',      '{"vital_id":"bp","below":100}', 'Ankle swelling is common.'),
  ('lisinopril',         'Lisinopril',         'ACE inhibitor',           '{tablet}', '{5 mg,10 mg,20 mg}',       'oral', 'any',    '{bp}',      '{"vital_id":"bp","below":100}', 'A dry cough can be a side effect.'),
  ('enalapril',          'Enalapril',          'ACE inhibitor',           '{tablet}', '{5 mg,10 mg,20 mg}',       'oral', 'any',    '{bp}',      '{"vital_id":"bp","below":100}', null),
  ('losartan',           'Losartan',           'Angiotensin receptor blocker', '{tablet}', '{25 mg,50 mg,100 mg}', 'oral', 'any',   '{bp}',      '{"vital_id":"bp","below":100}', null),
  ('hydrochlorothiazide','Hydrochlorothiazide','Thiazide diuretic',       '{tablet}', '{12.5 mg,25 mg}',          'oral', 'with',   '{bp,wt}',   '{"vital_id":"bp","below":100}', 'Take in the morning.'),
  ('furosemide',         'Furosemide',         'Loop diuretic',           '{tablet}', '{20 mg,40 mg,80 mg}',      'oral', 'any',    '{wt,bp}',   '{"vital_id":"bp","below":95}',  'Take in the morning; weigh daily.'),
  ('spironolactone',     'Spironolactone',     'Potassium-sparing diuretic', '{tablet}', '{25 mg,50 mg}',         'oral', 'with',   '{bp,wt}',   null, null),
  ('bisoprolol',         'Bisoprolol',         'Beta blocker',            '{tablet}', '{1.25 mg,2.5 mg,5 mg,10 mg}', 'oral', 'any', '{hr,bp}',   '{"vital_id":"hr","below":55}',  'Do not stop suddenly.'),
  ('atenolol',           'Atenolol',           'Beta blocker',            '{tablet}', '{25 mg,50 mg,100 mg}',     'oral', 'any',    '{hr,bp}',   '{"vital_id":"hr","below":55}',  'Do not stop suddenly.'),
  ('metformin',          'Metformin',          'Biguanide',               '{tablet}', '{500 mg,850 mg,1000 mg}',  'oral', 'with',   '{gluc}',    null, 'Take with food to ease the stomach.'),
  ('glibenclamide',      'Glibenclamide',      'Sulfonylurea',            '{tablet}', '{2.5 mg,5 mg}',            'oral', 'before', '{gluc}',    '{"vital_id":"gluc","below":70}', 'Can cause low sugar: do not skip the meal.'),
  ('insulin_glargine',   'Insulin glargine',   'Long-acting insulin',     '{injection pen}', '{per units prescribed}', 'injection', 'any', '{gluc}', '{"vital_id":"gluc","below":70}', null),
  ('atorvastatin',       'Atorvastatin',       'Statin',                  '{tablet}', '{10 mg,20 mg,40 mg,80 mg}', 'oral', 'any',   '{}',        null, null),
  ('simvastatin',        'Simvastatin',        'Statin',                  '{tablet}', '{10 mg,20 mg,40 mg}',      'oral', 'any',    '{}',        null, 'Usually taken at night.'),
  ('aspirin_low',        'Aspirin (low dose)', 'Antiplatelet',            '{tablet}', '{75 mg,81 mg}',            'oral', 'after',  '{}',        null, null),
  ('salbutamol',         'Salbutamol inhaler', 'Short-acting bronchodilator', '{inhaler}', '{100 mcg per puff}',  'inhaled', 'any', '{spo2}',    null, 'For breathlessness, as needed.'),
  ('beclomethasone',     'Beclomethasone inhaler', 'Inhaled corticosteroid', '{inhaler}', '{100 mcg per puff,200 mcg per puff}', 'inhaled', 'any', '{spo2}', null, 'Rinse the mouth after use.'),
  ('levothyroxine',      'Levothyroxine',      'Thyroid hormone',         '{tablet}', '{25 mcg,50 mcg,100 mcg}',  'oral', 'before', '{hr,wt}',   null, 'Take on an empty stomach.'),
  ('omeprazole',         'Omeprazole',         'Proton-pump inhibitor',   '{capsule}', '{20 mg,40 mg}',           'oral', 'before', '{}',        null, null),
  ('paracetamol',        'Paracetamol',        'Analgesic',               '{tablet}', '{500 mg,1 g}',             'oral', 'any',    '{}',        null, 'No more than 4 g a day.');

/* ── Structured prescriptions ─────────────────────────────────────────── */
alter table prescriptions
  add column medication_code text references medication_defs (code) on update cascade on delete set null,
  add column times          int[],    -- dose times, minutes after midnight; null: the frequency's usual times
  add column with_meal      text check (with_meal is null or with_meal in ('before', 'with', 'after', 'any')),
  add column hold_if        jsonb,    -- { "vital_id": "bp", "below": 100 } and/or "above": n — check that vital before each dose
  add column condition_code text references condition_defs (code) on update cascade on delete set null;

/** Checks a new prescription's structure; none of it can be rewritten afterwards (stop and prescribe again). */
create function prescription_structure() returns trigger language plpgsql as $$
declare v vital_defs; t int; below numeric; above numeric;
begin
  if tg_op = 'UPDATE' then
    if (new.medication_code, new.times, new.with_meal, new.hold_if, new.condition_code)
       is distinct from (old.medication_code, old.times, old.with_meal, old.hold_if, old.condition_code) then
      raise exception 'A prescription cannot be rewritten: stop it and prescribe again' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.times is not null then
    if cardinality(new.times) = 0 then new.times := null;
    else
      if cardinality(new.times) > 6 then raise exception 'A medicine can have up to 6 dose times a day' using errcode = '22023'; end if;
      foreach t in array new.times loop
        if t is null or t not between 0 and 1439 then raise exception 'Each dose time must be a time of day' using errcode = '22023'; end if;
      end loop;
      if (select count(distinct x) from unnest(new.times) x) <> cardinality(new.times) then
        raise exception 'Two doses cannot be at the same time' using errcode = '22023';
      end if;
      new.times := (select array_agg(x order by x) from unnest(new.times) x);
    end if;
  end if;
  if new.hold_if is not null then
    if jsonb_typeof(new.hold_if) <> 'object' then raise exception 'A hold rule names a vital and a limit' using errcode = '22023'; end if;
    select * into v from vital_defs where id = new.hold_if ->> 'vital_id';
    if not found then raise exception 'A hold rule needs a vital that is collected' using errcode = '22023'; end if;
    below := nullif(new.hold_if ->> 'below', '')::numeric; above := nullif(new.hold_if ->> 'above', '')::numeric;
    if below is null and above is null then raise exception 'A hold rule needs a low or a high limit' using errcode = '22023'; end if;
    if (below is not null and below not between v.hard_min and v.hard_max) or (above is not null and above not between v.hard_min and v.hard_max)
       or (below is not null and above is not null and below >= above) then
      raise exception 'The hold limits for % must be within % to % %', v.name, v.hard_min, v.hard_max, v.unit using errcode = '22023';
    end if;
    new.hold_if := jsonb_strip_nulls(jsonb_build_object('vital_id', v.id, 'below', below, 'above', above));
  end if;
  return new;
end $$;
create trigger prescription_structure before insert or update on prescriptions for each row execute function prescription_structure();

/** A catalogue medicine starts tracking the vitals it needs (weight for a diuretic, glucose for insulin). */
create function prescription_monitoring() returns trigger language plpgsql security definer set search_path = public as $$
declare added text;
begin
  if new.medication_code is null then return new; end if;
  with wanted as (
    select unnest(d.monitor_vitals) vital_id from medication_defs d where d.code = new.medication_code
  ), ins as (
    insert into tracked_vitals (patient_id, vital_id)
    select new.patient_id, w.vital_id from wanted w join vital_defs v on v.id = w.vital_id and v.active
    on conflict do nothing
    returning vital_id
  )
  select string_agg(v.name, ', ') into added from ins join vital_defs v on v.id = ins.vital_id;
  if added is not null then
    perform notify_user(new.patient_id, 'prescription', 'New vitals to track',
      'With ' || new.medication || ', please also log: ' || added, 'vitals');
  end if;
  return new;
end $$;
create trigger prescription_monitoring after insert on prescriptions for each row execute function prescription_monitoring();

revoke execute on function prescription_structure(), prescription_monitoring() from public, anon, authenticated;

-- P0 clinical safety: a meal plan's water can be a daily LIMIT (heart failure, kidney disease) instead of a goal,
-- and a prescription that matches an allergy on record is refused unless the doctor gives a reason (kept and audited).
-- (0018 is left for the auth-upgrade branch's password-change notice; the runner tracks files by name.)

/* ── Fluid: goal or limit ─────────────────────────────────────────────── */
alter table meal_plans add column fluid_mode text not null default 'goal' check (fluid_mode in ('goal', 'limit'));
comment on column meal_plans.fluid_mode is 'goal: drink at least water_goal glasses; limit: drink at most water_goal glasses (fluid restriction).';

/** The patient is told when their plan changes; the change is audited. Now says "at most" for a fluid limit. */
create or replace function meal_plan_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare pt uuid := coalesce(new.patient_id, old.patient_id); doc text := coalesce(name_of(auth.uid()), 'Your doctor');
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    perform notify_user(pt, 'message', 'Your meal plan was removed', doc || ' put you back on the standard meal plan', 'meals');
    insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Removed meal plan', name_of(pt));
    return old;
  end if;
  perform notify_user(pt, 'message', 'Your meal plan was updated',
    doc || ' set your meals' || coalesce(' · ' || new.target_kcal || ' kcal a day', '') || ' · '
      || case when new.fluid_mode = 'limit' then 'at most ' || new.water_goal || ' glasses of fluid a day'
              else new.water_goal || ' glasses of water' end, 'meals');
  insert into audit_log (actor_id, action, detail)
  values (auth.uid(), 'Set meal plan', name_of(pt) || ' · ' || jsonb_array_length(new.meals) || ' meals'
    || coalesce(' · ' || new.target_kcal || ' kcal', '')
    || case when new.fluid_mode = 'limit' then ' · fluid limit ' || new.water_goal || ' glasses' else '' end);
  return new;
end $$;

/* ── Allergy check on prescribing ─────────────────────────────────────── */
-- Which medicine names belong to an allergy group (lower-case fragments). Reference data, admin-managed.
-- The app keeps the same list in src/shared/lib/medicines.ts (ALLERGY_DRUG_TERMS) for its warning and demo mode.
create table allergy_drug_terms (
  allergy_term text not null check (allergy_term ~ '^[a-z][a-z /-]{1,39}$'),
  drug_term    text not null check (drug_term ~ '^[a-z][a-z-]{2,39}$'),
  primary key (allergy_term, drug_term)
);
insert into allergy_drug_terms (allergy_term, drug_term) values
  ('penicillin', 'penicillin'), ('penicillin', 'amoxicillin'), ('penicillin', 'ampicillin'), ('penicillin', 'flucloxacillin'),
  ('penicillin', 'cloxacillin'), ('penicillin', 'piperacillin'), ('penicillin', 'augmentin'), ('penicillin', 'co-amoxiclav'),
  ('penicillin', 'cef'), ('penicillin', 'ceph'),
  ('sulfa', 'sulfamethoxazole'), ('sulfa', 'co-trimoxazole'), ('sulfa', 'cotrimoxazole'), ('sulfa', 'septrin'),
  ('sulfa', 'bactrim'), ('sulfa', 'sulfasalazine'), ('sulfa', 'sulfadiazine'),
  ('nsaid', 'aspirin'), ('nsaid', 'ibuprofen'), ('nsaid', 'diclofenac'), ('nsaid', 'naproxen'), ('nsaid', 'indomethacin'),
  ('nsaid', 'ketoprofen'), ('nsaid', 'meloxicam'), ('nsaid', 'piroxicam'), ('nsaid', 'celecoxib'), ('nsaid', 'mefenamic'),
  ('aspirin', 'aspirin'),
  ('codeine', 'codeine'), ('codeine', 'co-codamol'), ('codeine', 'dihydrocodeine');

alter table allergy_drug_terms enable row level security;
create policy allergy_drug_terms_read on allergy_drug_terms for select to authenticated using (true);
create policy allergy_drug_terms_write on allergy_drug_terms for all to authenticated using (is_admin()) with check (is_admin());
create policy allergy_drug_terms_active_only on allergy_drug_terms as restrictive for all to authenticated
  using ((select account_active())) with check ((select account_active()));
create trigger zz_touch_topic after insert or update or delete on allergy_drug_terms for each statement execute function touch_topic('settings');

-- Why the doctor prescribed despite a recorded allergy. Set once, at prescribing; never rewritten.
alter table prescriptions add column allergy_override text check (allergy_override is null or length(allergy_override) between 3 and 300);

/** The patient's recorded allergies a medicine name matches, as "Penicillin (severe), …"; null when none. */
create function medication_allergy_conflict(pt uuid, med text) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(distinct a.substance || ' (' || a.severity || ')', ', ')
  from allergies a
  where a.patient_id = pt
    and (
      (length(trim(a.substance)) >= 3 and position(lower(trim(a.substance)) in lower(med)) > 0)
      or exists (select 1 from allergy_drug_terms t
                 where position(t.allergy_term in lower(a.substance)) > 0 and position(t.drug_term in lower(med)) > 0)
    )
$$;

create function prescription_allergy_check() returns trigger language plpgsql security definer set search_path = public as $$
declare hit text;
begin
  if tg_op = 'UPDATE' then
    if new.allergy_override is distinct from old.allergy_override then
      raise exception 'A prescription cannot be rewritten: stop it and prescribe again' using errcode = '42501';
    end if;
    return new;
  end if;
  new.allergy_override := nullif(trim(coalesce(new.allergy_override, '')), '');
  hit := medication_allergy_conflict(new.patient_id, new.medication);
  if hit is null then new.allergy_override := null; return new; end if;
  if new.allergy_override is null or length(new.allergy_override) < 3 then
    raise exception '% matches an allergy on record: %. To prescribe it anyway, give your reason.', trim(new.medication), hit
      using errcode = '22023';
  end if;
  perform audit_event('Prescribed despite allergy', trim(new.medication) || ' · allergy: ' || hit || ' · reason: ' || new.allergy_override,
    'prescription', new.id::text, new.patient_id);
  return new;
end $$;
create trigger prescription_allergy_check before insert or update on prescriptions for each row execute function prescription_allergy_check();

revoke execute on function prescription_allergy_check() from public, anon, authenticated;
-- Internal only: called by the trigger. Granting it would let anyone ask about any patient's allergies.
revoke execute on function medication_allergy_conflict(uuid, text) from public, anon, authenticated;

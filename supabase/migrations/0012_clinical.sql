-- mCare clinical record: what the treating doctor writes, with its history.
--
--   • a clinical note says who may read it (the care team only, or the patient too),
--     what kind of note it is, and which visit it belongs to; a note is still never
--     rewritten: a correction is a new note that replaces the one it amends
--   • a prescription carries how it is taken, from when to when, and a status with
--     the reason it was stopped; every step is kept as a row of history
--   • a care plan: goals and interventions for one patient, moved through defined
--     steps (draft → active → on hold → completed or cancelled), with its own history
--
-- Every row still hangs off patients.id, and the patient portal reads these same rows.


/* ─── Clinical notes ───────────────────────────────────────────────── */
alter table clinical_notes add column visibility     text not null default 'shared'   check (visibility in ('internal', 'shared'));
alter table clinical_notes add column note_type      text not null default 'progress' check (note_type in ('progress', 'assessment', 'plan', 'instruction', 'other'));
alter table clinical_notes add column appointment_id uuid references appointments (id);
alter table clinical_notes add column amends         uuid references clinical_notes (id);
-- A note is corrected once; a further correction amends the correction, so the versions form one line.
create unique index clinical_notes_one_amendment on clinical_notes (amends) where amends is not null;

-- An internal note is the treating doctor's working note: not the patient's, and not the staff's who monitor patients.
drop policy clinical_notes_read on clinical_notes;
create policy clinical_notes_read on clinical_notes for select to authenticated using (
  treats(patient_id) or (visibility = 'shared' and can_see_patient(patient_id)));

create function clinical_note_before() returns trigger language plpgsql security definer set search_path = public as $$
declare prior clinical_notes;
begin
  new.created_at := now();
  new.content := trim(new.content);
  if new.amends is not null then
    select * into prior from clinical_notes where id = new.amends;
    if not found or prior.patient_id <> new.patient_id then
      raise exception 'That note cannot be amended' using errcode = '22023';
    end if;
    if exists (select 1 from clinical_notes where amends = new.amends) then
      raise exception 'That note has already been corrected. Amend the latest version.' using errcode = '22023';
    end if;
  end if;
  if new.appointment_id is not null and not exists (
    select 1 from appointments a where a.id = new.appointment_id and a.patient_id = new.patient_id) then
    raise exception 'That visit is not this patient''s' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger clinical_note_before before insert on clinical_notes for each row execute function clinical_note_before();

/** The patient's "note from your doctor" is always the newest shared note that has not been replaced. */
create or replace function clinical_note_added() returns trigger language plpgsql security definer set search_path = public as $$
declare latest text;
begin
  select n.content into latest from clinical_notes n
  where n.patient_id = new.patient_id and n.visibility = 'shared'
    and not exists (select 1 from clinical_notes c where c.amends = n.id)
  order by n.created_at desc limit 1;
  perform set_config('mcare.note_action', '1', true);
  update patients set doctor_note = latest where id = new.patient_id and doctor_note is distinct from latest;
  perform set_config('mcare.note_action', '', true);
  if new.visibility = 'shared' then
    perform notify_user(new.patient_id, 'message',
      case when new.amends is null then 'New note from your doctor' else 'Your doctor corrected a note' end, left(new.content, 80), 'vitals');
  end if;
  perform audit_event(case when new.amends is null then 'Added clinical note' else 'Amended clinical note' end,
    name_of(new.patient_id) || ' · ' || new.note_type || case when new.visibility = 'internal' then ' · internal' else ' · shared with patient' end,
    'clinical_note', new.id::text, new.patient_id, null, null, new.author_id);
  return new;
end $$;


/* ─── Prescriptions ────────────────────────────────────────────────── */
alter table prescriptions add column route        text check (route is null or route in ('oral', 'topical', 'inhaled', 'injection', 'sublingual', 'eye', 'ear', 'nasal', 'rectal', 'other'));
alter table prescriptions add column instructions text check (instructions is null or length(instructions) <= 500);
alter table prescriptions add column start_date   date;
alter table prescriptions add column end_date     date;
alter table prescriptions add column status       text not null default 'active';
alter table prescriptions add column stop_reason  text check (stop_reason is null or length(stop_reason) <= 300);

alter table prescriptions disable trigger user;
update prescriptions set start_date = prescribed_at::date, status = case when active then 'active' else 'discontinued' end;
alter table prescriptions enable trigger user;

alter table prescriptions alter column start_date set not null;
alter table prescriptions alter column start_date set default current_date;
alter table prescriptions add constraint prescriptions_status check (status in ('active', 'completed', 'discontinued'));
alter table prescriptions add constraint prescriptions_status_matches check ((status = 'active') = active);
alter table prescriptions add constraint prescriptions_dates check (end_date is null or end_date >= start_date);

-- What happened to a prescription, in order. Written by the database only.
create table prescription_events (
  id              bigint generated always as identity primary key,
  prescription_id uuid not null references prescriptions (id) on delete cascade,
  patient_id      uuid not null references patients (id) on delete cascade,
  actor_id        uuid references profiles (id) on delete set null,
  action          text not null check (action in ('prescribed', 'stopped', 'completed', 'restarted')),
  detail          text,
  created_at      timestamptz not null default now()
);
create index prescription_events_idx on prescription_events (prescription_id, created_at);
insert into prescription_events (prescription_id, patient_id, actor_id, action, created_at)
select id, patient_id, doctor_id, 'prescribed', prescribed_at from prescriptions;
insert into prescription_events (prescription_id, patient_id, actor_id, action, created_at)
select id, patient_id, stopped_by, 'stopped', coalesce(stopped_at, now()) from prescriptions where not active;

alter table prescription_events enable row level security;
create policy prescription_events_read on prescription_events for select to authenticated using (can_see_patient(patient_id));
create policy prescription_events_active_only on prescription_events as restrictive for all to authenticated
  using (account_active()) with check (account_active());

create or replace function prescription_before() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.medication := trim(new.medication); new.dosage := trim(new.dosage);
    new.frequency := trim(new.frequency); new.purpose := trim(coalesce(new.purpose, ''));
    new.instructions := nullif(trim(coalesce(new.instructions, '')), '');
    new.prescribed_at := now(); new.stopped_at := null; new.stopped_by := null; new.stop_reason := null;
    new.active := true; new.status := 'active';
    new.start_date := coalesce(new.start_date, current_date);
    if new.end_date is not null and new.end_date < new.start_date then
      raise exception 'The end date cannot be before the start date' using errcode = '22023';
    end if;
    return new;
  end if;
  if (new.patient_id, new.doctor_id, new.medication, new.dosage, new.frequency, new.prescribed_at, new.route, new.instructions, new.start_date, new.end_date)
     is distinct from (old.patient_id, old.doctor_id, old.medication, old.dosage, old.frequency, old.prescribed_at, old.route, old.instructions, old.start_date, old.end_date) then
    raise exception 'A prescription cannot be rewritten: stop it and prescribe again' using errcode = '42501';
  end if;
  -- Two ways to say the same thing: the status, or the on/off switch the first version had.
  if new.status <> old.status then new.active := new.status = 'active';
  elsif new.active <> old.active then new.status := case when new.active then 'active' else 'discontinued' end;
  end if;
  if old.active and not new.active then
    new.stopped_at := now(); new.stopped_by := auth.uid();
    new.stop_reason := nullif(trim(coalesce(new.stop_reason, '')), '');
  elsif new.active and not old.active then
    new.stopped_at := null; new.stopped_by := null; new.stop_reason := null;
  else
    new.status := old.status; new.stopped_at := old.stopped_at; new.stopped_by := old.stopped_by; new.stop_reason := old.stop_reason;
  end if;
  return new;
end $$;

create or replace function prescription_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := name_of(new.patient_id); doc_id uuid := gen_random_uuid(); what text;
begin
  if tg_op = 'INSERT' then
    insert into prescription_events (prescription_id, patient_id, actor_id, action, detail)
    values (new.id, new.patient_id, new.doctor_id, 'prescribed', new.dosage || ' · ' || new.frequency);
    perform notify_user(new.patient_id, 'prescription', 'New prescription', new.medication || ' · ' || new.frequency, 'medicine');
    perform audit_event('Prescribed', new.medication || ' for ' || who, 'prescription', new.id::text, new.patient_id, null,
      jsonb_build_object('medication', new.medication, 'dosage', new.dosage, 'frequency', new.frequency), new.doctor_id);
    perform set_config('mcare.doc_action', '1', true);
    insert into documents (id, patient_id, title, category, origin, created_by, body, links, status,
                           signed_by, signed_at, signature_image, released_by, released_at, series_id, visibility)
    values (doc_id, new.patient_id, 'Prescription: ' || new.medication, 'prescription', 'system_generated', new.doctor_id,
            jsonb_build_object('type', 'prescription', 'medication', new.medication, 'dosage', new.dosage,
                               'frequency', new.frequency, 'purpose', new.purpose),
            jsonb_build_array(jsonb_build_object('kind', 'prescription', 'id', new.id, 'label', new.medication || ' · ' || new.frequency)),
            'released', new.doctor_id, now(), (select signature from doctors where id = new.doctor_id), new.doctor_id, now(),
            doc_id, 'care_team');
    perform set_config('mcare.doc_action', '', true);
    perform log_doc_event(doc_id, 'release', 'Filed automatically when prescribed');
  elsif old.active and not new.active then
    what := case when new.status = 'completed' then 'completed' else 'stopped' end;
    insert into prescription_events (prescription_id, patient_id, actor_id, action, detail)
    values (new.id, new.patient_id, auth.uid(), what, new.stop_reason);
    perform notify_user(new.patient_id, 'prescription',
      case when what = 'completed' then 'Course finished' else 'Medication stopped' end,
      new.medication || case when what = 'completed' then ': you have finished this course' else ' has been stopped by your doctor' end
        || case when what = 'stopped' and new.stop_reason is not null then ' · ' || new.stop_reason else '' end, 'medicine');
    perform audit_event(case when what = 'completed' then 'Completed medication' else 'Stopped medication' end,
      new.medication || ' for ' || who || coalesce(' · ' || new.stop_reason, ''), 'prescription', new.id::text, new.patient_id,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  elsif new.active and not old.active then
    insert into prescription_events (prescription_id, patient_id, actor_id, action) values (new.id, new.patient_id, auth.uid(), 'restarted');
    perform notify_user(new.patient_id, 'prescription', 'Medication restarted', new.medication || ' · ' || new.frequency, 'medicine');
    perform audit_event('Restarted medication', new.medication || ' for ' || who, 'prescription', new.id::text, new.patient_id,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return new;
end $$;

/** Runs on a schedule: a course whose last day has passed is marked completed, and the patient is told. */
create function complete_ended_prescriptions() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update prescriptions set status = 'completed', stop_reason = 'Course finished'
  where active and end_date is not null and end_date < current_date;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function complete_ended_prescriptions() from public, anon, authenticated;


/* ─── Care plans ───────────────────────────────────────────────────────
   A patient may have several plans over time and one active plan at a time.
   The patient sees a plan once it leaves draft. A plan that is completed or
   cancelled is closed: it stays as it was. */
create table care_plans (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients (id) on delete cascade,
  doctor_id   uuid not null references doctors (id),            -- who wrote it
  title       text not null check (length(trim(title)) between 1 and 120),
  summary     text check (summary is null or length(summary) <= 2000),
  status      text not null default 'draft' check (status in ('draft', 'active', 'on_hold', 'completed', 'cancelled')),
  start_date  date,
  review_date date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles (id) on delete set null,
  closed_at   timestamptz,
  close_note  text check (close_note is null or length(close_note) <= 500),
  check ((status in ('completed', 'cancelled')) = (closed_at is not null))
);
create unique index care_plans_one_active on care_plans (patient_id) where status = 'active';
create index care_plans_patient_idx on care_plans (patient_id, created_at desc);

create table care_plan_items (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references care_plans (id) on delete cascade,
  patient_id    uuid not null references patients (id) on delete cascade,
  kind          text not null check (kind in ('goal', 'intervention')),
  text          text not null check (length(trim(text)) between 1 and 500),
  vital_id      text references vital_defs (id),     -- the vital a goal is measured by, when it is
  target_date   date,
  status        text not null default 'open' check (status in ('open', 'achieved', 'dropped')),
  progress_note text check (progress_note is null or length(progress_note) <= 1000),
  position      int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index care_plan_items_plan_idx on care_plan_items (plan_id, position);

create table care_plan_events (
  id         bigint generated always as identity primary key,
  plan_id    uuid not null references care_plans (id) on delete cascade,
  patient_id uuid not null references patients (id) on delete cascade,
  actor_id   uuid references profiles (id) on delete set null,
  action     text not null,   -- created | edited | active | on_hold | completed | cancelled | item_achieved | item_dropped | item_reopened
  detail     text,
  created_at timestamptz not null default now()
);
create index care_plan_events_idx on care_plan_events (plan_id, created_at);

create function care_plan_before() returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  new.title := trim(new.title);
  new.summary := nullif(trim(coalesce(new.summary, '')), '');
  new.updated_at := now();
  new.updated_by := coalesce(me, new.updated_by);
  if tg_op = 'INSERT' then
    new.created_at := now();
    if me is not null then new.doctor_id := me; new.status := 'draft'; end if;
    new.closed_at := case when new.status in ('completed', 'cancelled') then now() end;
    return new;
  end if;
  if (new.patient_id, new.doctor_id, new.created_at) is distinct from (old.patient_id, old.doctor_id, old.created_at) then
    raise exception 'A care plan cannot be moved to someone else' using errcode = '42501';
  end if;
  if old.status in ('completed', 'cancelled') then
    raise exception 'This care plan is closed. Start a new one.' using errcode = '42501';
  end if;
  if new.status <> old.status then
    if new.status = 'draft' then
      raise exception 'A care plan that has started cannot go back to draft' using errcode = '22023';
    end if;
    if old.status = 'draft' and new.status not in ('active', 'cancelled') then
      raise exception 'Start the care plan first' using errcode = '22023';
    end if;
    if new.status = 'active' and exists (select 1 from care_plans p where p.patient_id = new.patient_id and p.status = 'active' and p.id <> new.id) then
      raise exception 'This patient already has an active care plan. Complete it or put it on hold first.' using errcode = '22023';
    end if;
    if new.status = 'active' and not exists (select 1 from care_plan_items i where i.plan_id = new.id and i.kind = 'goal') then
      raise exception 'Add at least one goal before starting the plan' using errcode = '22023';
    end if;
    if new.status = 'active' and new.start_date is null then new.start_date := current_date; end if;
  end if;
  new.close_note := nullif(trim(coalesce(new.close_note, '')), '');
  new.closed_at := case when new.status in ('completed', 'cancelled') then now() end;
  return new;
end $$;
create trigger care_plan_before before insert or update on care_plans for each row execute function care_plan_before();

create function care_plan_after() returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); who text := name_of(new.patient_id); doc text := coalesce(name_of(me), 'Your doctor'); act text; title text; body text;
begin
  if tg_op = 'INSERT' then
    insert into care_plan_events (plan_id, patient_id, actor_id, action, detail) values (new.id, new.patient_id, coalesce(me, new.doctor_id), 'created', new.title);
    perform audit_event('Drafted care plan', who || ' · ' || new.title, 'care_plan', new.id::text, new.patient_id, null, null, coalesce(me, new.doctor_id));
    return new;
  end if;
  if new.status <> old.status then
    insert into care_plan_events (plan_id, patient_id, actor_id, action, detail) values (new.id, new.patient_id, me, new.status, new.close_note);
    title := case new.status
      when 'active' then case when old.status = 'on_hold' then 'Your care plan has resumed' else 'Your care plan is ready' end
      when 'on_hold' then 'Your care plan is on hold'
      when 'completed' then 'Care plan completed'
      else 'Your care plan was cancelled' end;
    body := new.title || case when new.status = 'active' then ' · set by ' || doc else coalesce(' · ' || new.close_note, '') end;
    -- A draft that is dropped was never shown to the patient.
    if not (old.status = 'draft' and new.status = 'cancelled') then
      perform notify_about(new.patient_id, 'care_plan', title, body, 'care', 'care_plan', new.id::text);
    end if;
    act := case new.status when 'active' then case when old.status = 'on_hold' then 'Resumed care plan' else 'Started care plan' end
      when 'on_hold' then 'Put care plan on hold' when 'completed' then 'Completed care plan' else 'Cancelled care plan' end;
    perform audit_event(act, who || ' · ' || new.title || coalesce(' · ' || new.close_note, ''), 'care_plan', new.id::text, new.patient_id,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  else
    insert into care_plan_events (plan_id, patient_id, actor_id, action, detail)
    values (new.id, new.patient_id, me, 'edited',
      (select count(*) filter (where kind = 'goal') || ' goals · ' || count(*) filter (where kind = 'intervention') || ' interventions'
       from care_plan_items where plan_id = new.id));
    if new.status = 'active' then
      perform notify_about(new.patient_id, 'care_plan', 'Your care plan was updated', new.title, 'care', 'care_plan', new.id::text);
    end if;
    perform audit_event('Edited care plan', who || ' · ' || new.title, 'care_plan', new.id::text, new.patient_id);
  end if;
  return new;
end $$;
create trigger care_plan_after after insert or update on care_plans for each row execute function care_plan_after();

create function care_plan_item_before() returns trigger language plpgsql security definer set search_path = public as $$
declare p care_plans; row care_plan_items := case when tg_op = 'DELETE' then old else new end;
begin
  select * into p from care_plans where id = row.plan_id;
  if not found then
    if tg_op = 'DELETE' then return old; end if;   -- the plan itself is being removed
    raise exception 'Care plan not found' using errcode = '22023';
  end if;
  if p.status in ('completed', 'cancelled') and auth.uid() is not null then
    raise exception 'This care plan is closed. Start a new one.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.patient_id := p.patient_id;
  new.text := trim(new.text);
  new.progress_note := nullif(trim(coalesce(new.progress_note, '')), '');
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now(); new.status := 'open';
  elsif new.plan_id <> old.plan_id then
    raise exception 'A goal cannot be moved to another plan' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger care_plan_item_before before insert or update or delete on care_plan_items for each row execute function care_plan_item_before();

create function care_plan_item_after() returns trigger language plpgsql security definer set search_path = public as $$
declare p care_plans;
begin
  if new.status = old.status then return new; end if;
  select * into p from care_plans where id = new.plan_id;
  insert into care_plan_events (plan_id, patient_id, actor_id, action, detail)
  values (new.plan_id, new.patient_id, auth.uid(), 'item_' || case new.status when 'open' then 'reopened' else new.status end,
          left(new.text, 120) || coalesce(' · ' || new.progress_note, ''));
  if p.status = 'active' and new.status = 'achieved' and new.kind = 'goal' then
    perform notify_about(new.patient_id, 'care_plan', 'Goal reached', left(new.text, 120), 'care', 'care_plan', new.plan_id::text);
  end if;
  return new;
end $$;
create trigger care_plan_item_after after update on care_plan_items for each row execute function care_plan_item_after();

/**
 * Saves a care plan and its goals and interventions together: all of it, or none.
 *   plan = { id?, patient_id, title, summary?, start_date?, review_date?,
 *            items: [{ id?, kind, text, vital_id?, target_date? }] }
 * Without an id a new draft is made. Items left out are removed; items kept keep their progress.
 */
create function save_care_plan(plan jsonb) returns uuid language plpgsql set search_path = public as $$
declare
  pid uuid := nullif(plan ->> 'id', '')::uuid;
  pt uuid := nullif(plan ->> 'patient_id', '')::uuid;
  item jsonb; iid uuid; pos int := 0; kept uuid[] := '{}'; is_new boolean := false;
begin
  if jsonb_typeof(plan) <> 'object' then raise exception 'Nothing to save' using errcode = '22023'; end if;
  if length(trim(coalesce(plan ->> 'title', ''))) = 0 then raise exception 'Give the care plan a title' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(plan -> 'items', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(plan -> 'items', '[]'::jsonb)) > 30 then
    raise exception 'A care plan can hold up to 30 goals and interventions' using errcode = '22023';
  end if;
  if pid is null then
    if pt is null or not treats(pt) then raise exception 'Only the treating doctor can write a care plan' using errcode = '42501'; end if;
    insert into care_plans (patient_id, doctor_id, title, summary, start_date, review_date)
    values (pt, auth.uid(), plan ->> 'title', plan ->> 'summary', nullif(plan ->> 'start_date', '')::date, nullif(plan ->> 'review_date', '')::date)
    returning id into pid;
    is_new := true;
  else
    select patient_id into pt from care_plans where id = pid;
    if pt is null or not treats(pt) then raise exception 'Care plan not found or you do not have access' using errcode = '42501'; end if;
  end if;

  for item in select * from jsonb_array_elements(coalesce(plan -> 'items', '[]'::jsonb)) loop
    iid := nullif(item ->> 'id', '')::uuid;
    if length(trim(coalesce(item ->> 'text', ''))) = 0 then raise exception 'Describe each goal and intervention' using errcode = '22023'; end if;
    if iid is not null and exists (select 1 from care_plan_items where id = iid and plan_id = pid) then
      update care_plan_items set kind = item ->> 'kind', text = item ->> 'text', vital_id = nullif(item ->> 'vital_id', ''),
        target_date = nullif(item ->> 'target_date', '')::date, position = pos where id = iid;
    else
      insert into care_plan_items (plan_id, patient_id, kind, text, vital_id, target_date, position)
      values (pid, pt, item ->> 'kind', item ->> 'text', nullif(item ->> 'vital_id', ''), nullif(item ->> 'target_date', '')::date, pos)
      returning id into iid;
    end if;
    kept := kept || iid; pos := pos + 1;
  end loop;
  delete from care_plan_items where plan_id = pid and not (id = any (kept));

  -- An existing plan: saved last, so its history line counts the goals as they now stand. A new one already has its "created" line.
  if not is_new then
    update care_plans set title = plan ->> 'title', summary = plan ->> 'summary',
      start_date = nullif(plan ->> 'start_date', '')::date, review_date = nullif(plan ->> 'review_date', '')::date
    where id = pid;
  end if;
  return pid;
end $$;

/** Moves a care plan to its next step: start it, put it on hold, resume it, complete it or cancel it. */
create function set_care_plan_status(plan uuid, new_status text, note text default null) returns void language plpgsql set search_path = public as $$
begin
  update care_plans set status = new_status, close_note = case when new_status in ('completed', 'cancelled', 'on_hold') then note else close_note end
  where id = plan and treats(patient_id);
  if not found then raise exception 'Care plan not found or you do not have access' using errcode = '42501'; end if;
end $$;

alter table care_plans       enable row level security;
alter table care_plan_items  enable row level security;
alter table care_plan_events enable row level security;

-- The treating doctor reads and writes; the patient and the staff who monitor patients read a plan once it has left draft.
create policy care_plans_read on care_plans for select to authenticated using (
  treats(patient_id) or (status <> 'draft' and can_see_patient(patient_id)));
create policy care_plans_add on care_plans for insert to authenticated with check (treats(patient_id) and doctor_id = auth.uid());
create policy care_plans_change on care_plans for update to authenticated using (treats(patient_id)) with check (treats(patient_id));
create policy care_plans_drop_draft on care_plans for delete to authenticated using (treats(patient_id) and status = 'draft');

create policy care_plan_items_read on care_plan_items for select to authenticated using (
  treats(patient_id) or (can_see_patient(patient_id) and exists (select 1 from care_plans p where p.id = plan_id and p.status <> 'draft')));
create policy care_plan_items_write on care_plan_items for all to authenticated using (treats(patient_id)) with check (treats(patient_id));

create policy care_plan_events_read on care_plan_events for select to authenticated using (
  treats(patient_id) or (can_see_patient(patient_id) and exists (select 1 from care_plans p where p.id = plan_id and p.status <> 'draft')));

create policy care_plans_active_only on care_plans as restrictive for all to authenticated using (account_active()) with check (account_active());
create policy care_plan_items_active_only on care_plan_items as restrictive for all to authenticated using (account_active()) with check (account_active());
create policy care_plan_events_active_only on care_plan_events as restrictive for all to authenticated using (account_active()) with check (account_active());

revoke execute on function save_care_plan(jsonb) from public, anon;
revoke execute on function set_care_plan_status(uuid, text, text) from public, anon;
grant execute on function save_care_plan(jsonb), set_care_plan_status(uuid, text, text) to authenticated;

/* ─── Scheduled jobs (hosted Supabase with pg_cron) ────────────────── */
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mcare-complete-prescriptions', '10 0 * * *', 'select public.complete_ended_prescriptions()');
  end if;
end $$;

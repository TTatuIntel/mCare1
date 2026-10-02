-- mCare vital resolution: an abnormal reading, its re-measurements and how it ended, as one story.
--
-- Until now an alert remembered one "re-check reading" and a free-text reason.
-- That loses every re-measurement but the last, cannot say whether a number or
-- a clinician closed the alert, and gives the doctor nowhere to write what was
-- done short of resolving it. Now:
--   • alert_remeasures   every reading logged for that vital while its alert was open,
--                        linked to the alert (the reading itself is never copied)
--   • alert_comments     what the care team said or did about the alert, in order,
--                        without having to resolve it; never rewritten
--   • alerts.resolved_how  remeasure | doctor | invalid | corrected | patient
--   • a warning closes by itself on an in-range re-measurement at any time, not only
--     in the first 30 minutes or after a doctor asked. A critical alert is still
--     never closed by a number alone: the reading goes back to the clinician.
--   • a re-measurement that is still out of range stays on the same alert instead
--     of raising a second one; the patient is told what to do next.


/* ─── How an alert ended ───────────────────────────────────────────── */
alter table alerts add column resolved_how text check (resolved_how in ('remeasure', 'doctor', 'invalid', 'corrected', 'patient'));

create function alert_how(reason text) returns text language sql immutable as $$
  select case
    when reason in ('Re-check back in range', 'Re-measured in range by patient') then 'remeasure'
    when reason = 'Reading marked invalid' then 'invalid'
    when reason like 'Corrected by %' then 'corrected'
    when reason = 'Patient marked safe' then 'patient'
    else 'doctor' end $$;

alter table alerts disable trigger user;
update alerts set resolved_how = alert_how(resolution_reason) where status = 'resolved';
alter table alerts enable trigger user;

-- Runs after alert_guard (triggers fire in name order). A person resolving an alert is always
-- 'doctor' (the care team); the system's own closures are named by what they were.
create function alert_resolved_how() returns trigger language plpgsql as $$
begin
  if new.status <> 'resolved' then
    new.resolved_how := null;
  elsif old.status <> 'resolved' then
    new.resolved_how := case when auth.uid() is not null and not acting('alert_action') then 'doctor' else alert_how(new.resolution_reason) end;
  else
    new.resolved_how := old.resolved_how;
  end if;
  return new;
end $$;
create trigger alert_resolved_how before update on alerts for each row execute function alert_resolved_how();


/* ─── Re-measurements ──────────────────────────────────────────────── */
create table alert_remeasures (
  reading_id uuid primary key references readings (id) on delete cascade,
  alert_id   uuid not null references alerts (id) on delete cascade,
  patient_id uuid not null references patients (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index alert_remeasures_alert_idx on alert_remeasures (alert_id, created_at);

-- The one re-check reading kept so far.
insert into alert_remeasures (reading_id, alert_id, patient_id, created_at)
select a.recheck_reading_id, a.id, a.patient_id, r.taken_at
from alerts a join readings r on r.id = a.recheck_reading_id
on conflict do nothing;

alter table alert_remeasures enable row level security;
-- Written by the database only.
create policy alert_remeasures_read on alert_remeasures for select to authenticated using (can_see_patient(patient_id));
create policy alert_remeasures_active_only on alert_remeasures as restrictive for all to authenticated using (account_active()) with check (account_active());
create trigger zz_touch_patient after insert or update or delete on alert_remeasures for each row execute function touch_patient('patient_id');


/* ─── What the care team said or did ───────────────────────────────── */
create table alert_comments (
  id         uuid primary key default gen_random_uuid(),
  alert_id   uuid not null references alerts (id) on delete cascade,
  patient_id uuid not null references patients (id) on delete cascade,
  author_id  uuid not null references profiles (id),
  kind       text not null default 'comment' check (kind in ('comment', 'action', 'instruction')),
  body       text not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  client_ref uuid
);
create index alert_comments_alert_idx on alert_comments (alert_id, created_at);
create unique index alert_comments_client_ref_key on alert_comments (client_ref) where client_ref is not null;

create function alert_comment_before() returns trigger language plpgsql security definer set search_path = public as $$
declare a alerts;
begin
  select * into a from alerts where id = new.alert_id;
  if not found then raise exception 'Alert not found' using errcode = '22023'; end if;
  -- The patient, the author and the time are the server's.
  new.patient_id := a.patient_id;
  new.author_id := coalesce(auth.uid(), new.author_id);
  new.created_at := now();
  new.body := trim(new.body);
  return new;
end $$;
create trigger alert_comment_before before insert on alert_comments for each row execute function alert_comment_before();

create function alert_comment_after() returns trigger language plpgsql security definer set search_path = public as $$
declare a alerts; what text; actor text := coalesce(name_of(new.author_id), 'Your care team');
begin
  select * into a from alerts where id = new.alert_id;
  what := case when a.type = 'sos' then 'SOS' else coalesce((select name from vital_defs where id = a.vital_id), 'reading') end;
  perform notify_user(new.patient_id, 'alert',
    case new.kind when 'instruction' then 'Instruction from ' || actor when 'action' then actor || ' acted on your alert' else actor || ' commented on your alert' end,
    what || ': ' || left(new.body, 120), 'alerts');
  perform audit_event('Commented on alert', name_of(new.patient_id) || ' · ' || what || ' · ' || new.kind || ' · ' || left(new.body, 120),
    'alert', new.alert_id::text, new.patient_id, null, null, new.author_id);
  return new;
end $$;
create trigger alert_comment_after after insert on alert_comments for each row execute function alert_comment_after();
create trigger zz_touch_patient after insert or update or delete on alert_comments for each row execute function touch_patient('patient_id');

alter table alert_comments enable row level security;
create policy alert_comments_read on alert_comments for select to authenticated using (can_see_patient(patient_id));
-- Whoever may work the alert may comment on it. A comment is never edited or removed: a correction is a new comment.
create policy alert_comments_add on alert_comments for insert to authenticated with check (
  author_id = auth.uid() and exists (
    select 1 from alerts a where a.id = alert_id and (treats(a.patient_id) or staff_can('monitor_patients'))));
create policy alert_comments_active_only on alert_comments as restrictive for all to authenticated using (account_active()) with check (account_active());


/* ─── A reading is saved ───────────────────────────────────────────── */
create or replace function reading_after_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare
  d vital_defs; who text := name_of(new.patient_id); a alerts; prev vital_level; label text; asked text;
begin
  select * into d from vital_defs where id = new.vital_id;
  label := d.name || ' ' || new.value || ' ' || d.unit;

  -- The alert still open on this vital: this reading is a re-measurement of it.
  select * into a from alerts where patient_id = new.patient_id and vital_id = new.vital_id and type = 'vital'
    and status <> 'resolved' order by created_at desc limit 1;
  if found then
    insert into alert_remeasures (reading_id, alert_id, patient_id) values (new.id, a.id, new.patient_id) on conflict do nothing;
    asked := case when a.recheck_requested_at is not null then ', asked for by ' || coalesce(name_of(a.recheck_requested_by), 'the care team') else '' end;
    perform set_config('mcare.alert_action', '1', true);

    if new.level = 'normal' and a.severity = 'warning' then
      update alerts set status = 'resolved', resolved_at = now(), resolved_by = new.recorded_by, recheck_reading_id = new.id,
        resolution_reason = case when a.recheck_requested_at is not null then 'Re-check back in range' else 'Re-measured in range by patient' end,
        resolution_note = 'New reading ' || label || asked
      where id = a.id;
      perform notify_user(new.patient_id, 'alert', 'Alert cleared', d.name || ': your new reading is back in range', 'alerts');
      perform notify_care_team(new.patient_id, 'alert', 'Alert cleared: ' || who, label || ' · re-measured back in range');
      perform audit_event('Alert self-cleared', who || ' · ' || label, 'alert', a.id::text, new.patient_id, null, null, new.recorded_by);

    elsif new.level = 'normal' then
      -- A critical alert is never closed by a number alone.
      update alerts set recheck_reading_id = new.id where id = a.id;
      perform notify_user(new.patient_id, 'alert', 'Re-check received',
        d.name || ': your new reading is in range. Your doctor will review it and close the alert.', 'alerts');
      perform notify_care_team(new.patient_id, 'alert', 'Re-check in range: ' || who, label || ' · review and resolve the alert');

    else
      -- Still out of range: the same alert carries on, at the worse of the two severities.
      update alerts set recheck_reading_id = new.id,
        severity = case when new.level = 'critical' then 'danger' else severity end
      where id = a.id;
      perform notify_user(new.patient_id, 'alert',
        case when new.level = 'critical' then 'Still critical: contact your doctor' else 'Still outside your range' end,
        label || case when new.level = 'critical'
          then ' · your care team has been told. If you feel unwell, use SOS or call 999.'
          else ' · your doctor has been told. Message them if you feel unwell.' end, 'alerts');
      perform notify_care_team(new.patient_id, 'alert',
        case when new.level = 'critical' then 'Critical: ' else 'Still out of range: ' end || who, label || ' · re-measurement');
    end if;

    perform set_config('mcare.alert_action', '', true);
    return new;
  end if;

  if new.level = 'normal' then return new; end if;

  if new.level = 'warning' then
    -- Ask the patient to re-measure first: alert only if the previous reading in the last hour was abnormal too.
    select level into prev from readings where patient_id = new.patient_id and vital_id = new.vital_id and not invalid
      and id <> new.id and taken_at > now() - interval '60 minutes' order by taken_at desc limit 1;
    if prev is null or prev = 'normal' then return new; end if;
  end if;

  perform raise_vital_alert(new);
  return new;
end $$;

-- mCare vitals and alerts: grading, alerts, re-measurements and SOS.
--
-- Runs in the database on every saved reading, so it works even if the app is
-- closed and cannot be skipped by a modified client:
--   • a reading is validated, timed by the server and graded against the patient's targets
--   • a critical reading raises an alert at once; an out-of-range one after a second abnormal reading
--   • a reading logged while an alert is open on that vital is a re-measurement of it:
--     in range it clears a warning (a critical alert goes back to the clinician);
--     out of range it stays on the same alert
--   • alerts move only through defined steps, and a resolved alert is never edited


/* ═══ Targets and tracked vitals ══════════════════════════════════════ */
/**
 * Sets which vitals a patient tracks. The row rules decide what may be removed:
 * a patient cannot drop a vital their doctor set a target for.
 */
create function set_tracked_vitals(ids text[], patient uuid default null) returns setof text language plpgsql set search_path = public as $$
declare pt uuid := coalesce(patient, auth.uid());
begin
  delete from tracked_vitals where patient_id = pt and not (vital_id = any (ids));
  insert into tracked_vitals (patient_id, vital_id)
  select pt, v.id from vital_defs v where v.id = any (ids) and v.active
  on conflict do nothing;
  return query select t.vital_id from tracked_vitals t where t.patient_id = pt;
end $$;

create function threshold_before() returns trigger language plpgsql as $$
begin
  new.set_by := coalesce(auth.uid(), new.set_by);
  new.updated_at := now();
  return new;
end $$;

create function threshold_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare d vital_defs; target_same boolean; critical_same boolean;
begin
  if tg_op = 'DELETE' then
    insert into threshold_changes (patient_id, vital_id, from_min, from_max, from_critical_min, from_critical_max, changed_by)
    values (old.patient_id, old.vital_id, old.target_min, old.target_max, old.critical_min, old.critical_max, auth.uid());
    return old;
  end if;
  target_same := tg_op = 'UPDATE' and new.target_min = old.target_min and new.target_max = old.target_max;
  critical_same := case when tg_op = 'UPDATE'
    then (new.critical_min, new.critical_max) is not distinct from (old.critical_min, old.critical_max)
    else new.critical_min is null and new.critical_max is null end;
  if target_same and critical_same then return new; end if;

  select * into d from vital_defs where id = new.vital_id;
  insert into threshold_changes (patient_id, vital_id, from_min, from_max, to_min, to_max,
                                 from_critical_min, from_critical_max, to_critical_min, to_critical_max, changed_by)
  values (new.patient_id, new.vital_id,
          case when tg_op = 'UPDATE' then old.target_min end, case when tg_op = 'UPDATE' then old.target_max end,
          new.target_min, new.target_max,
          case when tg_op = 'UPDATE' then old.critical_min end, case when tg_op = 'UPDATE' then old.critical_max end,
          new.critical_min, new.critical_max, new.set_by);
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
  return new;
end $$;

create function vital_def_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Added vital type', new.name);
  elsif new.active <> old.active then
    insert into audit_log (actor_id, action, detail)
    values (auth.uid(), case when new.active then 'Activated vital type' else 'Deactivated vital type' end, new.name);
  elsif to_jsonb(new) is distinct from to_jsonb(old) then
    insert into audit_log (actor_id, action, detail)
    values (auth.uid(), 'Updated vital definition', new.name || ': normal ' || new.normal_min || '–' || new.normal_max);
  end if;
  return new;
end $$;


create trigger threshold_before before insert or update on thresholds for each row execute function threshold_before();
create trigger threshold_changed after insert or update or delete on thresholds for each row execute function threshold_changed();
create trigger vital_def_audit after insert or update on vital_defs for each row execute function vital_def_audit();


/* ═══ Readings ════════════════════════════════════════════════════════ */
create function grade(n numeric, tmin numeric, tmax numeric, cmin numeric, cmax numeric) returns vital_level
language sql immutable as
$$ select case when n <= cmin or n >= cmax then 'critical' when n < tmin or n > tmax then 'warning' else 'normal' end::vital_level $$;

create function grade_reading(patient uuid, vital text, prim numeric, sec numeric) returns vital_level
language plpgsql stable security definer set search_path = public as $$
declare
  d vital_defs; t thresholds; span numeric; lvl vital_level; dia vital_level;
begin
  select * into d from vital_defs where id = vital;
  select * into t from thresholds where patient_id = patient and vital_id = vital;
  span := d.normal_max - d.normal_min;
  lvl := grade(prim,
    coalesce(t.target_min, d.normal_min), coalesce(t.target_max, d.normal_max),
    coalesce(t.critical_min, d.critical_min, d.normal_min - span * 0.25),
    coalesce(t.critical_max, d.critical_max, d.normal_max + span * 0.25));
  if vital = 'bp' and sec is not null then
    dia := grade(sec, coalesce(d.dia_normal_min, 60), coalesce(d.dia_normal_max, 90),
                      coalesce(d.dia_critical_min, 40), coalesce(d.dia_critical_max, 120));
    if dia > lvl then lvl := dia; end if;   -- enum order: normal < warning < critical
  end if;
  return lvl;
end $$;

create function reading_before() returns trigger language plpgsql security definer set search_path = public as $$
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
    new.corrected_from := old.corrected_from; new.corrected_at := old.corrected_at;
    if trim(new.value) <> old.value then
      -- A typo can be fixed for 15 minutes by whoever entered it. After that the reading stands, or the doctor marks it invalid.
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
  new.level := grade_reading(new.patient_id, new.vital_id, new.primary_value, new.secondary_value);
  return new;
end $$;

/** Opens the alert for an out-of-range reading and tells the care team and the patient. Returns the alert. */
create function raise_vital_alert(r readings) returns uuid language plpgsql security definer set search_path = public as $$
declare d vital_defs; who text := name_of(r.patient_id); aid uuid; label text;
begin
  select id into aid from alerts where reading_id = r.id;
  if aid is not null then return aid; end if;
  select * into d from vital_defs where id = r.vital_id;
  label := d.name || ' ' || r.value || ' ' || d.unit;
  insert into alerts (patient_id, type, severity, vital_id, reading_id, value, unit)
  values (r.patient_id, 'vital', case when r.level = 'critical' then 'danger' else 'warning' end::alert_severity,
          r.vital_id, r.id, r.value, d.unit)
  returning id into aid;
  perform notify_care_team(r.patient_id, 'alert', case when r.level = 'critical' then 'Critical: ' else 'Alert: ' end || who,
    label || case when (select assigned_doctor_id from patients where id = r.patient_id) is null then ' · patient has no doctor' else '' end);
  perform notify_user(r.patient_id, 'alert',
    case when r.level = 'critical' then 'Critical reading: your care team has been alerted' else 'Reading sent to your care team' end,
    label, 'alerts');
  return aid;
end $$;

create function reading_after_insert() returns trigger language plpgsql security definer set search_path = public as $$
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

-- A corrected reading is graded again and its alert follows: back in range resolves it, otherwise the severity follows.
create function reading_after_update() returns trigger language plpgsql security definer set search_path = public as $$
declare who text; d vital_defs; touched int;
begin
  if new.value = old.value then return new; end if;
  who := name_of(new.patient_id);
  select * into d from vital_defs where id = new.vital_id;
  perform set_config('mcare.alert_action', '1', true);
  if new.level = 'normal' then
    update alerts set status = 'resolved', resolved_at = now(), resolved_by = coalesce(auth.uid(), new.recorded_by),
      resolution_reason = case when new.recorded_by = new.patient_id then 'Corrected by patient' else 'Corrected by clinician' end,
      resolution_note = 'Entered as ' || old.value || ', corrected to ' || new.value || ' ' || d.unit
    where reading_id = new.id and status <> 'resolved';
    get diagnostics touched = row_count;
    if touched > 0 then
      perform notify_care_team(new.patient_id, 'alert', 'Reading corrected: ' || who,
        d.name || ' entered as ' || old.value || ', corrected to ' || new.value || ' ' || d.unit || ' · alert closed');
    end if;
  else
    update alerts set value = new.value, severity = case when new.level = 'critical' then 'danger' else 'warning' end::alert_severity
    where reading_id = new.id and status <> 'resolved';
    get diagnostics touched = row_count;
    -- Corrected INTO the critical range with no alert yet: it must still reach a clinician.
    if touched = 0 and new.level = 'critical' and not exists (select 1 from alerts where reading_id = new.id) then
      perform raise_vital_alert(new);
    end if;
  end if;
  perform set_config('mcare.alert_action', '', true);
  insert into audit_log (actor_id, action, detail)
  values (coalesce(auth.uid(), new.recorded_by), 'Corrected reading', who || ' · ' || d.name || ' ' || old.value || ' → ' || new.value);
  return new;
end $$;

create function reading_invalid_stamp() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or not new.invalid then
    new.invalidated_by := null; new.invalidated_at := null;
  elsif not old.invalid then
    new.invalidated_by := auth.uid(); new.invalidated_at := now();
  else
    new.invalidated_by := old.invalidated_by; new.invalidated_at := old.invalidated_at;
  end if;
  return new;
end $$;

create function reading_invalidated() returns trigger language plpgsql security definer set search_path = public as $$
declare closed int; what text;
begin
  if not (new.invalid and not old.invalid) then return new; end if;
  what := coalesce((select name from vital_defs where id = new.vital_id), 'Reading');
  perform audit_event('Marked reading invalid', name_of(new.patient_id) || ' · ' || new.value || ' · ' || coalesce(new.invalid_reason, ''),
    'reading', new.id::text, new.patient_id);
  perform set_config('mcare.alert_action', '1', true);
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
    resolution_reason = 'Reading marked invalid', resolution_note = new.invalid_reason
  where reading_id = new.id and status <> 'resolved';
  get diagnostics closed = row_count;
  perform set_config('mcare.alert_action', '', true);
  if closed > 0 then
    perform notify_user(new.patient_id, 'alert', 'Alert closed', what || ': your doctor marked the reading as not valid', 'alerts');
    perform audit_event('Resolved alert', name_of(new.patient_id) || ' · ' || what || ' · Reading marked invalid', 'reading', new.id::text, new.patient_id);
  end if;
  return new;
end $$;

create function reading_recorded_for_patient() returns trigger language plpgsql security definer set search_path = public as $$
declare d vital_defs;
begin
  if new.recorded_by is null or new.recorded_by = new.patient_id then return new; end if;
  select * into d from vital_defs where id = new.vital_id;
  perform notify_user(new.patient_id, 'message', 'A reading was added to your record',
    coalesce(name_of(new.recorded_by), 'Your doctor') || ' recorded ' || d.name || ' ' || new.value || ' ' || d.unit, 'vitals');
  insert into audit_log (actor_id, action, detail)
  values (new.recorded_by, 'Recorded reading for patient', name_of(new.patient_id) || ' · ' || d.name || ' ' || new.value || ' ' || d.unit);
  return new;
end $$;

/** The patient asks for a reading that is out of range to go to the care team now, without waiting for a second one. */
create function send_alert_now(reading uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare r readings;
begin
  if my_role() is distinct from 'patient' then raise exception 'Only a patient can do this' using errcode = '42501'; end if;
  select * into r from readings where id = reading and patient_id = auth.uid() and not invalid;
  if not found then raise exception 'Reading not found' using errcode = '42501'; end if;
  if r.level = 'normal' then raise exception 'That reading is inside your target range' using errcode = '22023'; end if;
  return raise_vital_alert(r);
end $$;


create trigger reading_before before insert or update on readings for each row execute function reading_before();
create trigger reading_invalid_stamp before insert or update on readings for each row execute function reading_invalid_stamp();
create trigger reading_after_insert after insert on readings for each row execute function reading_after_insert();
create trigger reading_after_update after update on readings for each row execute function reading_after_update();
create trigger reading_invalidated after update of invalid on readings for each row execute function reading_invalidated();
create trigger reading_recorded_for_patient after insert on readings for each row execute function reading_recorded_for_patient();


/* ═══ Alerts ══════════════════════════════════════════════════════════
   The care team moves an alert through its steps; the database fills in who and
   when, records how it ended, and refuses anything else. Functions that act for
   the system (a re-measurement, a correction) set `alert_action` first. */
create function alert_how(reason text) returns text language sql immutable as $$
  select case
    when reason in ('Re-check back in range', 'Re-measured in range by patient') then 'remeasure'
    when reason = 'Reading marked invalid' then 'invalid'
    when reason like 'Corrected by %' then 'corrected'
    when reason = 'Patient marked safe' then 'patient'
    else 'doctor' end $$;

create function alert_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or acting('alert_action') then return new; end if;
  if old.status = 'resolved' then
    raise exception 'A resolved alert cannot be changed' using errcode = '42501';
  end if;
  if (new.patient_id, new.type, new.severity, new.vital_id, new.reading_id, new.value, new.unit, new.created_at)
     is distinct from (old.patient_id, old.type, old.severity, old.vital_id, old.reading_id, old.value, old.unit, old.created_at) then
    raise exception 'The reading on an alert cannot be edited' using errcode = '42501';
  end if;
  -- Names and times are the server's, never the browser's.
  new.acknowledged_at := old.acknowledged_at; new.acknowledged_by := old.acknowledged_by;
  new.escalated_at := old.escalated_at; new.resolved_at := null; new.resolved_by := null;
  new.recheck_reading_id := old.recheck_reading_id; new.recheck_requested_by := old.recheck_requested_by;
  if new.recheck_requested_at is distinct from old.recheck_requested_at then
    new.recheck_requested_at := now(); new.recheck_requested_by := me;
  end if;
  if new.status <> old.status then
    if new.status = 'open' then
      raise exception 'An alert cannot be reopened' using errcode = '42501';
    elsif new.status = 'acknowledged' then
      new.acknowledged_at := now(); new.acknowledged_by := me;
    elsif new.status = 'escalated' then
      new.escalated_at := now();
    else
      if length(trim(coalesce(new.resolution_reason, ''))) = 0 then
        raise exception 'Give a reason for resolving the alert' using errcode = '22023';
      end if;
      new.resolution_reason := trim(new.resolution_reason);
      new.resolution_note := nullif(trim(coalesce(new.resolution_note, '')), '');
      new.resolved_at := now(); new.resolved_by := me;
    end if;
  end if;
  if new.status <> 'resolved' then new.resolution_reason := null; new.resolution_note := null; end if;
  return new;
end $$;

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

create function alert_after_update() returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); actor text; who text; what text;
begin
  if me is null or acting('alert_action') then return new; end if;
  actor := coalesce(name_of(me), 'Your care team');
  who := name_of(new.patient_id);
  what := case when new.type = 'sos' then 'SOS' else coalesce((select name from vital_defs where id = new.vital_id), 'reading') end;
  if new.status <> old.status then
    if new.status = 'acknowledged' then
      perform notify_user(new.patient_id, 'alert', 'Your alert is being reviewed', actor || ' is looking at your ' || what || ' alert', 'alerts');
      insert into audit_log (actor_id, action, detail) values (me, 'Acknowledged alert', who || ' · ' || what);
    elsif new.status = 'escalated' then
      perform notify_staff('monitor_patients', 'escalation', 'Escalated by ' || actor,
        who || ' · ' || what || case when new.type = 'sos' then '' else ' ' || new.value || ' ' || new.unit end, 'alerts', me);
      insert into audit_log (actor_id, action, detail) values (me, 'Escalated alert', who || ' · ' || what);
    elsif new.status = 'resolved' then
      perform notify_user(new.patient_id, 'alert', 'Alert resolved', what || ': ' || new.resolution_reason, 'alerts');
      insert into audit_log (actor_id, action, detail)
      values (me, 'Resolved alert', who || ' · ' || what || ' · ' || new.resolution_reason || coalesce(' · ' || new.resolution_note, ''));
    end if;
  end if;
  if new.recheck_requested_at is distinct from old.recheck_requested_at then
    perform notify_user(new.patient_id, 'alert', 'Please log a new reading',
      actor || ' asked you to re-check your ' || case when new.type = 'sos' then 'condition' else what end, 'vitals');
    insert into audit_log (actor_id, action, detail) values (me, 'Requested re-check', who || ' · ' || what);
  end if;
  return new;
end $$;

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

/** Someone who monitors patients chases the treating doctor about an alert that is still open. */
create function chase_alert(alert uuid) returns void language plpgsql security definer set search_path = public as $$
declare a alerts; doc uuid;
begin
  if not staff_can('monitor_patients') then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into a from alerts where id = alert and status <> 'resolved';
  if not found then raise exception 'That alert is already resolved' using errcode = '22023'; end if;
  select assigned_doctor_id into doc from patients where id = a.patient_id;
  if doc is null then raise exception 'This patient has no doctor to chase' using errcode = '22023'; end if;
  perform notify_user(doc, 'escalation', 'Urgent: ' || name_of(a.patient_id),
    name_of(auth.uid()) || ' asks you to respond to ' || case when a.type = 'sos' then 'an SOS'
      else coalesce((select name from vital_defs where id = a.vital_id), 'a reading') || ' ' || a.value end, 'alerts');
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Chased doctor', name_of(a.patient_id) || ' → ' || name_of(doc));
end $$;

/** Runs on a schedule (pg_cron, every minute): critical alerts nobody acknowledged in 10 minutes go up to the care team. */
create function escalate_stale_alerts() returns int language plpgsql security definer set search_path = public as $$
declare a record; n int := 0;
begin
  for a in update alerts set status = 'escalated', escalated_at = now()
           where status = 'open' and severity = 'danger' and created_at < now() - interval '10 minutes'
           returning id, patient_id, type, value, unit, vital_id loop
    insert into notifications (user_id, kind, title, body, link)
    select p.id, 'escalation', 'Escalated: ' || (select full_name from profiles where id = a.patient_id),
           case when a.type = 'sos' then 'SOS' else coalesce((select name from vital_defs where id = a.vital_id), '') || ' ' || a.value || ' ' || a.unit end
             || ' not acknowledged within 10 min', 'alerts'
    from profiles p left join staff s on s.id = p.id
    where p.status = 'active' and (p.role = 'admin' or (p.role = 'assistant' and 'monitor_patients' = any (s.permissions)));
    n := n + 1;
  end loop;
  return n;
end $$;


create trigger alert_guard before update on alerts for each row execute function alert_guard();
create trigger alert_resolved_how before update on alerts for each row execute function alert_resolved_how();
create trigger alert_after_update after update on alerts for each row execute function alert_after_update();
create trigger alert_comment_before before insert on alert_comments for each row execute function alert_comment_before();
create trigger alert_comment_after after insert on alert_comments for each row execute function alert_comment_after();


/* ═══ SOS ═════════════════════════════════════════════════════════════ */
/** Patient presses SOS. Pressing again while one is open returns the same alert instead of raising another. */
create function raise_sos(message text default '') returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid; who text; body text := left(coalesce(nullif(trim(message), ''), 'Emergency help requested'), 300);
begin
  if my_role() is distinct from 'patient' then raise exception 'Only a patient can raise an SOS' using errcode = '42501'; end if;
  select id into aid from alerts where patient_id = auth.uid() and type = 'sos' and status <> 'resolved' order by created_at desc limit 1;
  if aid is not null then return aid; end if;
  select full_name into who from profiles where id = auth.uid();
  insert into alerts (patient_id, type, severity, value) values (auth.uid(), 'sos', 'danger', body) returning id into aid;
  perform notify_care_team(auth.uid(), 'sos', 'SOS: ' || who, body);
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'SOS raised', who);
  return aid;
end $$;

/** Patient marks themself safe: closes their own open SOS and tells the care team. */
create function cancel_sos(alert uuid) returns void language plpgsql security definer set search_path = public as $$
declare who text := name_of(auth.uid());
begin
  if my_role() is distinct from 'patient' then raise exception 'Only a patient can do this' using errcode = '42501'; end if;
  perform set_config('mcare.alert_action', '1', true);
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_reason = 'Patient marked safe'
  where id = alert and patient_id = auth.uid() and type = 'sos' and status <> 'resolved';
  if not found then raise exception 'Nothing to cancel' using errcode = '42501'; end if;
  perform set_config('mcare.alert_action', '', true);
  perform notify_care_team(auth.uid(), 'sos', 'SOS cancelled: ' || who, who || ' marked themself safe');
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'SOS cancelled', who);
end $$;

-- 0023: alert safety. Closes the gaps found in the review of the vital structure (items 1, 2, 3, 6, 11, 13, 14):
-- tiered escalation and reminders, an alert for repeated warnings and for weight gain, nudges for re-measuring and for
-- missed check-ins, consulting doctors told of critical alerts and SOS, a time limit on re-measurements, urgency carried on
-- the notification (not read from its title), and the emergency number and timings as admin settings (area 'clinical').
-- Additive: new columns, a new table, new settings; functions replaced with their earlier behaviour kept.
-- Rollback: re-run the function bodies of 0002/0004/0008/0012, drop table vital_nudges, drop the columns added here,
-- delete from app_settings where key = 'clinical'.


/* ═══ Settings: area 'clinical' ═══════════════════════════════════════ */
alter table app_settings drop constraint if exists app_settings_key_check;
alter table app_settings add constraint app_settings_key_check check (key in ('security', 'retention', 'clinical'));
insert into app_settings (key, value) values ('clinical', jsonb_build_object(
  'emergency_number', '999',
  'escalate_minutes', 10,            -- a critical alert nobody acknowledged goes to admins and monitors
  'critical_reminder_minutes', 60,   -- an acknowledged critical alert still unresolved: remind again
  'warning_reminder_hours', 24,      -- a warning alert still unresolved: remind the doctor
  'max_reminders', 3,
  'repeat_warnings', 3,              -- this many out-of-range readings of one vital ...
  'repeat_warning_days', 7,          -- ... within this many days raise an alert
  'remeasure_window_hours', 24,      -- a reading links to an open alert only within this time of its last activity
  'remeasure_nudge_minutes', 15,     -- a single out-of-range reading not re-measured: remind the patient
  'missed_patient_factor', 1.25,     -- overdue by this share of the plan's interval: remind the patient
  'missed_doctor_factor', 3,         -- ... by this many intervals: tell the treating doctor
  'weight_gain_kg', 2, 'weight_gain_days', 3))
on conflict (key) do nothing;

/** A number from the clinical settings, or the default when it is not set. Internal. */
create function clinical_num(k text, dflt numeric) returns numeric language sql stable security definer set search_path = public as
$$ select coalesce(nullif(setting('clinical') ->> k, '')::numeric, dflt) $$;

/** The emergency number patients are told to call. */
create function emergency_number() returns text language sql stable security definer set search_path = public as
$$ select coalesce(nullif(trim(setting('clinical') ->> 'emergency_number'), ''), '999') $$;

/** 0012's save_settings, with the 'clinical' area added. */
create or replace function save_settings(area text, new_value jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare old_value jsonb; clean jsonb; roles text[]; idle jsonb; r text; m int; me_role user_role; num numeric; k text; phone text;
  limits constant jsonb := '{"escalate_minutes":[2,120],"critical_reminder_minutes":[15,1440],"warning_reminder_hours":[1,168],
    "max_reminders":[0,10],"repeat_warnings":[2,20],"repeat_warning_days":[1,30],"remeasure_window_hours":[1,168],
    "remeasure_nudge_minutes":[5,240],"missed_patient_factor":[1,10],"missed_doctor_factor":[1.5,30],
    "weight_gain_kg":[0.5,10],"weight_gain_days":[1,14]}';
begin
  if not is_admin() then raise exception 'Only an admin can change the settings' using errcode = '42501'; end if;
  if jsonb_typeof(new_value) is distinct from 'object' then raise exception 'Nothing to save' using errcode = '22023'; end if;
  select value into old_value from app_settings where key = area for update;
  if not found then raise exception 'Unknown settings area' using errcode = '22023'; end if;

  if area = 'security' then
    roles := array(select distinct jsonb_array_elements_text(coalesce(new_value -> 'mfa_required_roles', '[]'::jsonb)) order by 1);
    if not roles <@ array['patient', 'doctor', 'admin', 'assistant'] then raise exception 'Unknown role in two-step sign-in' using errcode = '22023'; end if;
    select role into me_role from profiles where id = auth.uid();
    if me_role::text = any (roles) and coalesce(jwt_claim('aal'), 'aal1') <> 'aal2' then
      raise exception 'Turn on two-step sign-in for your own account first (Profile → Two-step sign-in), then require it for %s.', me_role using errcode = '22023';
    end if;
    idle := '{}'::jsonb;
    foreach r in array array['admin', 'assistant', 'doctor', 'patient'] loop
      m := coalesce((new_value -> 'idle_minutes' ->> r)::numeric::int, (old_value -> 'idle_minutes' ->> r)::int, 0);
      if m <> 0 and (m < 5 or m > 720) then raise exception 'Idle sign-out must be between 5 and 720 minutes, or 0 for never' using errcode = '22023'; end if;
      idle := idle || jsonb_build_object(r, m);
    end loop;
    clean := jsonb_build_object('mfa_required_roles', to_jsonb(roles), 'idle_minutes', idle);
  elsif area = 'retention' then
    clean := jsonb_build_object(
      'audit_days',             setting_days(new_value -> 'audit_days', 180, 36500, 'Audit entries'),
      'deleted_document_days',  setting_days(new_value -> 'deleted_document_days', 1, 3650, 'Deleted documents'),
      'read_notification_days', setting_days(new_value -> 'read_notification_days', 7, 3650, 'Read notifications'),
      'delivery_days',          setting_days(new_value -> 'delivery_days', 7, 3650, 'Sent email and text records'));
  else
    phone := trim(coalesce(new_value ->> 'emergency_number', old_value ->> 'emergency_number', '999'));
    if phone !~ '^\+?[0-9 ]{2,15}$' then raise exception 'The emergency number must be 2 to 15 digits' using errcode = '22023'; end if;
    clean := jsonb_build_object('emergency_number', phone);
    for k in select jsonb_object_keys(limits) loop
      begin
        num := coalesce(nullif(new_value ->> k, '')::numeric, (old_value ->> k)::numeric);
      exception when others then
        raise exception 'Enter a number for %', replace(k, '_', ' ') using errcode = '22023';
      end;
      if num is null or num < (limits -> k ->> 0)::numeric or num > (limits -> k ->> 1)::numeric then
        raise exception '% must be between % and %', initcap(replace(k, '_', ' ')), limits -> k ->> 0, limits -> k ->> 1 using errcode = '22023';
      end if;
      clean := clean || jsonb_build_object(k, num);
    end loop;
  end if;

  if clean = old_value then return clean; end if;
  update app_settings set value = clean, updated_by = auth.uid(), updated_at = now() where key = area;
  perform audit_event('Changed settings', case area when 'security' then 'Security' when 'retention' then 'Data retention' else 'Clinical safety' end,
    'settings', area, null, old_value, clean);
  return clean;
end $$;


/* ═══ Urgency travels with the notification (item 13) ═════════════════
   Before: SMS went out when a title started with "Critical". Now the function that writes a notification says it is urgent. */
alter table notifications add column urgent boolean not null default false;

create function notify_user(to_user uuid, k notif_kind, t text, b text, l text, urgent boolean) returns void
language sql security definer set search_path = public as
$$ insert into notifications (user_id, kind, title, body, link, urgent) values (to_user, k, t, b, l, urgent) $$;

/** The care team of a patient: the treating doctor, admins and monitoring assistants, and, for an urgent
    notification (a critical alert, an SOS), each current consulting doctor too (item 6). */
create function notify_care_team(patient uuid, k notif_kind, t text, b text, urgent boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, kind, title, body, link, resource_type, resource_id, urgent)
  select u.id, k, t, b, 'alerts', 'patient', patient::text, urgent from (
    select assigned_doctor_id as id from patients where id = patient and assigned_doctor_id is not null
    union
    select p.id from profiles p left join staff s on s.id = p.id
    where p.status = 'active' and (p.role = 'admin' or (p.role = 'assistant' and 'monitor_patients' = any (s.permissions)))
    union
    select m.doctor_id from care_team_members m join profiles p on p.id = m.doctor_id
    where urgent and m.patient_id = patient and m.ended_at is null and p.status = 'active'
  ) u;
end $$;

-- The four-argument form stays for every existing caller; an SOS is urgent.
create or replace function notify_care_team(patient uuid, k notif_kind, t text, b text) returns void
language sql security definer set search_path = public as
$$ select notify_care_team(patient, k, t, b, k = 'sos') $$;

-- Kept for anything that still asks; urgency now comes from notifications.urgent.
create or replace function sms_worthy(k notif_kind, title text) returns boolean language sql immutable as
$$ select k in ('sos', 'escalation') $$;

create or replace function queue_notification_delivery() returns trigger language plpgsql security definer set search_path = public as $$
declare p profiles; urgent boolean := new.urgent or new.kind in ('sos', 'escalation', 'alert'); texted boolean := new.urgent or new.kind in ('sos', 'escalation');
begin
  select * into p from profiles where id = new.user_id;
  if not found or p.status in ('suspended', 'deactivated') then return new; end if;
  if p.notify_email and p.email is not null then
    insert into notification_deliveries (notification_id, user_id, channel, to_address, subject, body, urgent, link)
    values (new.id, new.user_id, 'email', p.email, new.title, new.body, urgent, new.link);
  end if;
  if p.notify_sms and texted and sms_number(p.phone) is not null then
    insert into notification_deliveries (notification_id, user_id, channel, to_address, subject, body, urgent, link)
    values (new.id, new.user_id, 'sms', sms_number(p.phone), new.title, left(new.body, 300), true, new.link);
  end if;
  if p.notify_push then
    insert into notification_deliveries (notification_id, user_id, channel, to_address, subject, body, urgent, link, subscription_id)
    select new.id, new.user_id, 'push', s.endpoint, new.title, new.body, urgent, new.link, s.id
    from push_subscriptions s where s.user_id = new.user_id;
  end if;
  return new;
end $$;


/* ═══ Alerts: what raised them, and reminders ═════════════════════════ */
alter table alerts
  add column rule text check (rule is null or rule in ('repeat_warning', 'weight_gain')),   -- a pattern, not one reading's range
  add column reminders int not null default 0 check (reminders >= 0),
  add column last_reminded_at timestamptz;

-- Only the database sets these.
create function alert_system_fields() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not acting('alert_action') then
    new.rule := old.rule; new.reminders := old.reminders; new.last_reminded_at := old.last_reminded_at;
  end if;
  return new;
end $$;
create trigger alert_system_fields before update on alerts for each row execute function alert_system_fields();

/** Opens the alert for a reading and tells the care team and the patient. `why` names a pattern rule; `detail` explains it. */
create function raise_vital_alert(r readings, why text, detail text) returns uuid language plpgsql security definer set search_path = public as $$
declare d vital_defs; who text := name_of(r.patient_id); aid uuid; label text; crit boolean := r.level = 'critical';
begin
  select id into aid from alerts where reading_id = r.id;
  if aid is not null then return aid; end if;
  select * into d from vital_defs where id = r.vital_id;
  label := d.name || ' ' || r.value || ' ' || d.unit || coalesce(' · ' || detail, '');
  insert into alerts (patient_id, type, severity, vital_id, reading_id, value, unit, rule)
  values (r.patient_id, 'vital', case when crit then 'danger' else 'warning' end::alert_severity, r.vital_id, r.id, r.value, d.unit, why)
  returning id into aid;
  perform notify_care_team(r.patient_id, 'alert',
    case when crit then 'Critical: ' when why = 'repeat_warning' then 'Repeatedly out of range: ' when why = 'weight_gain' then 'Weight gain: ' else 'Alert: ' end || who,
    label || case when (select assigned_doctor_id from patients where id = r.patient_id) is null then ' · patient has no doctor' else '' end, crit);
  perform notify_user(r.patient_id, 'alert',
    case when crit then 'Critical reading: your care team has been alerted'
         when why = 'repeat_warning' then 'Your readings were sent to your care team'
         when why = 'weight_gain' then 'Your weight gain was sent to your care team'
         else 'Reading sent to your care team' end,
    label || case when crit then ' · If you feel unwell, use SOS or call ' || emergency_number() || '.' else '' end, 'alerts', crit);
  return aid;
end $$;

create or replace function raise_vital_alert(r readings) returns uuid language sql security definer set search_path = public as
$$ select raise_vital_alert(r, null, null) $$;

/** The open alert a new reading of this vital re-measures: only within the window since the alert's last activity (item 11). */
create function open_alert_for(patient uuid, vital text) returns alerts language sql stable security definer set search_path = public as $$
  select a.* from alerts a
  where a.patient_id = patient and a.vital_id = vital and a.type = 'vital' and a.status <> 'resolved'
    and greatest(a.created_at, coalesce(a.recheck_requested_at, a.created_at),
                 coalesce((select max(m.created_at) from alert_remeasures m where m.alert_id = a.id), a.created_at))
        > now() - make_interval(hours => clinical_num('remeasure_window_hours', 24)::int)
  order by a.created_at desc limit 1
$$;

/** A heart-failure patient's weight up by the set amount within the set days: the gain in kg, else null. */
create function weight_gain(r readings) returns numeric language plpgsql stable security definer set search_path = public as $$
declare lowest numeric;
begin
  if r.vital_id <> 'wt' or not exists (
    select 1 from conditions c where c.patient_id = r.patient_id and (c.condition_code = 'heart_failure' or c.name ilike '%heart failure%')) then
    return null;
  end if;
  select min(primary_value) into lowest from readings
  where patient_id = r.patient_id and vital_id = 'wt' and not invalid and id <> r.id
    and taken_at > now() - make_interval(days => clinical_num('weight_gain_days', 3)::int);
  if lowest is null or r.primary_value - lowest < clinical_num('weight_gain_kg', 2) then return null; end if;
  return round(r.primary_value - lowest, 1);
end $$;

-- 0004's rules, with: a time limit on re-measurements, pattern alerts closed only by the clinician, repeated warnings
-- and weight gain raising an alert, urgency set where it is decided, and the emergency number from the settings.
create or replace function reading_after_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare
  d vital_defs; who text := name_of(new.patient_id); a alerts; prev vital_level; label text; asked text;
  since timestamptz; n int; gain numeric;
begin
  select * into d from vital_defs where id = new.vital_id;
  label := d.name || ' ' || new.value || ' ' || d.unit;

  -- The alert still open on this vital (and still recent): this reading is a re-measurement of it.
  a := open_alert_for(new.patient_id, new.vital_id);
  if a.id is not null then
    insert into alert_remeasures (reading_id, alert_id, patient_id) values (new.id, a.id, new.patient_id) on conflict do nothing;
    asked := case when a.recheck_requested_at is not null then ', asked for by ' || coalesce(name_of(a.recheck_requested_by), 'the care team') else '' end;
    perform set_config('mcare.alert_action', '1', true);

    if new.level = 'normal' and a.severity = 'warning' and a.rule is null then
      update alerts set status = 'resolved', resolved_at = now(), resolved_by = new.recorded_by, recheck_reading_id = new.id,
        resolution_reason = case when a.recheck_requested_at is not null then 'Re-check back in range' else 'Re-measured in range by patient' end,
        resolution_note = 'New reading ' || label || asked
      where id = a.id;
      perform notify_user(new.patient_id, 'alert', 'Alert cleared', d.name || ': your new reading is back in range', 'alerts');
      perform notify_care_team(new.patient_id, 'alert', 'Alert cleared: ' || who, label || ' · re-measured back in range');
      perform audit_event('Alert self-cleared', who || ' · ' || label, 'alert', a.id::text, new.patient_id, null, null, new.recorded_by);

    elsif new.level = 'normal' then
      -- A critical alert, or one raised by a pattern, is never closed by a number alone.
      update alerts set recheck_reading_id = new.id where id = a.id;
      perform notify_user(new.patient_id, 'alert', 'Re-check received',
        d.name || ': your new reading is in range. Your doctor will review it and close the alert.', 'alerts');
      perform notify_care_team(new.patient_id, 'alert', 'Re-check in range: ' || who, label || ' · review and resolve the alert');

    else
      update alerts set recheck_reading_id = new.id,
        severity = case when new.level = 'critical' then 'danger' else severity end
      where id = a.id;
      perform notify_user(new.patient_id, 'alert',
        case when new.level = 'critical' then 'Still critical: contact your doctor' else 'Still outside your range' end,
        label || case when new.level = 'critical'
          then ' · your care team has been told. If you feel unwell, use SOS or call ' || emergency_number() || '.'
          else ' · your doctor has been told. Message them if you feel unwell.' end, 'alerts', new.level = 'critical');
      perform notify_care_team(new.patient_id, 'alert',
        case when new.level = 'critical' then 'Critical: ' else 'Still out of range: ' end || who, label || ' · re-measurement', new.level = 'critical');
    end if;

    perform set_config('mcare.alert_action', '', true);
    return new;
  end if;

  if new.level = 'critical' then perform raise_vital_alert(new, null, null); return new; end if;

  if new.level = 'warning' then
    -- Ask the patient to re-measure first: alert if the previous reading in the last hour was abnormal too ...
    select level into prev from readings where patient_id = new.patient_id and vital_id = new.vital_id and not invalid
      and id <> new.id and taken_at > now() - interval '60 minutes' order by taken_at desc limit 1;
    if prev is not null and prev <> 'normal' then perform raise_vital_alert(new, null, null); return new; end if;
    -- ... or if this vital has been out of range repeatedly lately (item 2). Counting restarts after the last alert on it.
    since := greatest(now() - make_interval(days => clinical_num('repeat_warning_days', 7)::int),
                      coalesce((select max(greatest(created_at, coalesce(resolved_at, created_at))) from alerts
                                where patient_id = new.patient_id and vital_id = new.vital_id), '-infinity'));
    select count(*) into n from readings where patient_id = new.patient_id and vital_id = new.vital_id and not invalid
      and level <> 'normal' and taken_at > since;
    if n >= clinical_num('repeat_warnings', 3) then
      perform raise_vital_alert(new, 'repeat_warning', n || ' readings out of range in ' || clinical_num('repeat_warning_days', 7) || ' days');
      return new;
    end if;
  end if;

  -- Heart failure: a quick weight gain is a warning whatever the range says.
  gain := weight_gain(new);
  if gain is not null then
    perform raise_vital_alert(new, 'weight_gain', 'up ' || gain || ' kg in ' || clinical_num('weight_gain_days', 3) || ' days');
  end if;
  return new;
end $$;


/* ═══ Escalation in tiers (item 1) ════════════════════════════════════ */
/** Runs every minute. Tier 1: a critical alert nobody acknowledged goes to admins and monitors (and the doctor and patient
    are told). Tier 2: an acknowledged critical alert still unresolved is reminded. Tier 3: a warning alert waiting too long
    is reminded to the doctor (or to monitors when there is none). Each audited. Returns how many alerts it acted on. */
create or replace function escalate_stale_alerts() returns int language plpgsql security definer set search_path = public as $$
declare a record; n int := 0; what text; who text; doc uuid; mins int;
begin
  perform set_config('mcare.alert_action', '1', true);
  for a in update alerts set status = 'escalated', escalated_at = now()
           where status = 'open' and severity = 'danger' and created_at < now() - make_interval(mins => clinical_num('escalate_minutes', 10)::int)
           returning id, patient_id, type, value, unit, vital_id loop
    what := case when a.type = 'sos' then 'SOS' else coalesce((select name from vital_defs where id = a.vital_id), '') || ' ' || a.value || ' ' || a.unit end;
    who := name_of(a.patient_id);
    insert into notifications (user_id, kind, title, body, link, urgent)
    select p.id, 'escalation', 'Escalated: ' || who, what || ' not acknowledged within ' || clinical_num('escalate_minutes', 10) || ' min', 'alerts', true
    from profiles p left join staff s on s.id = p.id
    where p.status = 'active' and (p.role = 'admin' or (p.role = 'assistant' and 'monitor_patients' = any (s.permissions)));
    select assigned_doctor_id into doc from patients where id = a.patient_id;
    if doc is not null then
      perform notify_user(doc, 'escalation', 'Not acknowledged: ' || who, what || ' · passed to the monitoring team', 'alerts', true);
    end if;
    perform notify_user(a.patient_id, 'alert', 'Your alert was passed to the wider care team',
      'Nobody had answered yet, so more of the team has been told. If you feel unwell, use SOS or call ' || emergency_number() || '.', 'alerts', false);
    perform audit_event('Escalated alert (automatic)', who || ' · ' || what, 'alert', a.id::text, a.patient_id);
    n := n + 1;
  end loop;

  mins := clinical_num('critical_reminder_minutes', 60)::int;
  for a in update alerts set reminders = reminders + 1, last_reminded_at = now()
           where severity = 'danger' and status in ('acknowledged', 'escalated') and reminders < clinical_num('max_reminders', 3)
             and coalesce(last_reminded_at, acknowledged_at, escalated_at, created_at) < now() - make_interval(mins => mins)
           returning id, patient_id, type, value, unit, vital_id, created_at loop
    what := case when a.type = 'sos' then 'SOS' else coalesce((select name from vital_defs where id = a.vital_id), '') || ' ' || a.value || ' ' || a.unit end;
    who := name_of(a.patient_id);
    select assigned_doctor_id into doc from patients where id = a.patient_id;
    if doc is not null then
      perform notify_user(doc, 'escalation', 'Still unresolved: ' || who, what || ' · critical, open ' || round(extract(epoch from now() - a.created_at) / 60) || ' min', 'alerts', true);
    end if;
    perform notify_staff('monitor_patients', 'escalation', 'Still unresolved: ' || who, what || ' · critical alert not yet resolved', 'alerts');
    perform audit_event('Reminded about alert', who || ' · ' || what || ' · critical', 'alert', a.id::text, a.patient_id);
    n := n + 1;
  end loop;

  mins := (clinical_num('warning_reminder_hours', 24) * 60)::int;
  for a in update alerts set reminders = reminders + 1, last_reminded_at = now()
           where severity = 'warning' and status <> 'resolved' and reminders < clinical_num('max_reminders', 3)
             and coalesce(last_reminded_at, created_at) < now() - make_interval(mins => mins)
           returning id, patient_id, value, unit, vital_id loop
    what := coalesce((select name from vital_defs where id = a.vital_id), '') || ' ' || a.value || ' ' || a.unit;
    who := name_of(a.patient_id);
    select assigned_doctor_id into doc from patients where id = a.patient_id;
    if doc is not null then
      perform notify_user(doc, 'alert', 'Alert waiting: ' || who, what || ' · out of range, not yet resolved', 'alerts', false);
    else
      perform notify_staff('monitor_patients', 'alert', 'Alert waiting: ' || who, what || ' · patient has no doctor', 'alerts');
    end if;
    perform audit_event('Reminded about alert', who || ' · ' || what || ' · warning', 'alert', a.id::text, a.patient_id);
    n := n + 1;
  end loop;
  perform set_config('mcare.alert_action', '', true);
  return n;
end $$;


/* ═══ Nudges: re-measure, missed check-ins (items 2 and 3) ════════════ */
-- One row per reminder sent, so each is sent once.
create table vital_nudges (
  key        text primary key,
  patient_id uuid not null references patients (id) on delete cascade,
  vital_id   text not null references vital_defs (id),
  kind       text not null check (kind in ('remeasure', 'missed_patient', 'missed_doctor')),
  sent_at    timestamptz not null default now()
);
create index vital_nudges_patient_idx on vital_nudges (patient_id, sent_at desc);
alter table vital_nudges enable row level security;
create policy vital_nudges_read on vital_nudges for select to authenticated using (can_see_patient(patient_id));
create policy vital_nudges_active_only on vital_nudges as restrictive for all to authenticated using ((select account_active())) with check ((select account_active()));
create trigger zz_touch_patient after insert or update or delete on vital_nudges for each row execute function touch_patient('patient_id');

/** Hours between measurements for a monitoring-plan frequency; null when there is no rhythm. */
create function frequency_hours(f text) returns int language sql immutable as $$
  select case f when 'weekly' then 168 when 'daily' then 24 when 'twice_daily' then 12 when 'three_times_daily' then 8 end $$;

/** Runs every five minutes. Reminds a patient to re-measure a single out-of-range reading, reminds a patient who missed a
    planned measurement, and tells the treating doctor when it has been missed for several intervals. Returns how many it sent. */
create function nudge_vitals() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; k text; hrs int; late interval;
begin
  -- A warning reading nobody followed up: not re-measured, no alert.
  for r in
    select x.id, x.patient_id, x.vital_id, d.name from readings x join vital_defs d on d.id = x.vital_id
    join profiles p on p.id = x.patient_id and p.status = 'active'
    where x.level = 'warning' and not x.invalid
      and x.taken_at < now() - make_interval(mins => clinical_num('remeasure_nudge_minutes', 15)::int)
      and x.taken_at > now() - interval '6 hours'
      and not exists (select 1 from readings y where y.patient_id = x.patient_id and y.vital_id = x.vital_id and y.taken_at > x.taken_at)
      and not exists (select 1 from alerts a where a.patient_id = x.patient_id and a.vital_id = x.vital_id and a.status <> 'resolved')
  loop
    insert into vital_nudges (key, patient_id, vital_id, kind) values ('remeasure:' || r.id, r.patient_id, r.vital_id, 'remeasure')
    on conflict do nothing;
    if found then
      perform notify_about(r.patient_id, 'alert', 'Please measure your ' || r.name || ' again',
        'Your last reading was outside your range. Rest for 5 minutes and measure again, so your doctor sees the right number.', 'vitals', 'vital', r.vital_id);
      n := n + 1;
    end if;
  end loop;

  -- Missed planned measurements (patients with a treating doctor and a rhythm set by them).
  for r in
    select t.patient_id, t.vital_id, t.frequency, d.name, pt.assigned_doctor_id as doc,
           coalesce((select max(x.taken_at) from readings x where x.patient_id = t.patient_id and x.vital_id = t.vital_id and not x.invalid), t.assigned_at) as last_at
    from tracked_vitals t join vital_defs d on d.id = t.vital_id and d.active
    join patients pt on pt.id = t.patient_id and pt.assigned_doctor_id is not null
    join profiles p on p.id = t.patient_id and p.status = 'active'
    where frequency_hours(t.frequency) is not null
  loop
    continue when r.last_at is null;
    hrs := frequency_hours(r.frequency);
    late := now() - r.last_at;
    if late > make_interval(mins => (hrs * 60 * clinical_num('missed_doctor_factor', 3))::int) then
      k := 'missed_doctor:' || r.patient_id || ':' || r.vital_id || ':' || extract(epoch from r.last_at)::bigint;
      insert into vital_nudges (key, patient_id, vital_id, kind) values (k, r.patient_id, r.vital_id, 'missed_doctor') on conflict do nothing;
      if found then
        perform notify_about(r.doc, 'alert', 'Missed check-ins: ' || name_of(r.patient_id),
          r.name || ' not measured for ' || round(extract(epoch from late) / 3600) || ' h (plan: ' || frequency_label(r.frequency) || ')',
          'patients', 'patient', r.patient_id::text);
        n := n + 1;
      end if;
    end if;
    if late > make_interval(mins => (hrs * 60 * clinical_num('missed_patient_factor', 1.25))::int) then
      k := 'missed_patient:' || r.patient_id || ':' || r.vital_id || ':' || extract(epoch from r.last_at)::bigint;
      insert into vital_nudges (key, patient_id, vital_id, kind) values (k, r.patient_id, r.vital_id, 'missed_patient') on conflict do nothing;
      if found then
        perform notify_about(r.patient_id, 'care_plan', 'Time to measure your ' || r.name,
          'Your doctor asked you to measure it ' || frequency_label(r.frequency) || '. Your last reading was ' || round(extract(epoch from late) / 3600) || ' h ago.',
          'vitals', 'vital', r.vital_id);
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mcare-nudge-vitals', '*/5 * * * *', 'select public.nudge_vitals()');
  end if;
end $$;


/* ═══ Grants ══════════════════════════════════════════════════════════ */
revoke execute on function clinical_num(text, numeric), notify_user(uuid, notif_kind, text, text, text, boolean),
  notify_care_team(uuid, notif_kind, text, text, boolean), alert_system_fields(), raise_vital_alert(readings, text, text),
  open_alert_for(uuid, text), weight_gain(readings), nudge_vitals(), frequency_hours(text)
from public, anon, authenticated;
revoke execute on function emergency_number() from public, anon;
grant execute on function emergency_number() to authenticated;

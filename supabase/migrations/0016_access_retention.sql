-- mCare access log, message read times, write limits, the patient's own copy of their record,
-- retention as the admin sets it, and the restrictive "active accounts only" rule evaluated once
-- per query instead of once per row.


/* ═══ Message read time ═══════════════════════════════════════════════ */
alter table messages add column read_at timestamptz;
update messages set read_at = created_at where read;

create function message_read_stamp() returns trigger language plpgsql as $$
begin
  new.read_at := case when new.read and not old.read then now() else old.read_at end;
  return new;
end $$;
create trigger message_read_stamp before update on messages for each row execute function message_read_stamp();


/* ═══ Write limits ════════════════════════════════════════════════════
   A person can create these only so fast: far above what anyone types, low enough that a script
   cannot flood a doctor's inbox or the support queue. Arguments: the column naming the person,
   how many, per how many seconds. */
create function rate_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare person uuid := (to_jsonb(new) ->> tg_argv[0])::uuid; n int;
begin
  if auth.uid() is null or person is null then return new; end if;
  execute format('select count(*) from %I where %I = $1 and created_at > now() - make_interval(secs => $2)', tg_table_name, tg_argv[0])
    into n using person, tg_argv[2]::int;
  if n >= tg_argv[1]::int then
    raise exception 'You are doing that too quickly. Wait a minute and try again.';
  end if;
  return new;
end $$;
create trigger rate_limit before insert on messages        for each row execute function rate_limit('from_id', '30', '60');
create trigger rate_limit before insert on support_tickets for each row execute function rate_limit('user_id', '5', '600');
create trigger rate_limit before insert on appointments    for each row execute function rate_limit('created_by', '20', '600');
create trigger rate_limit before insert on share_links     for each row execute function rate_limit('patient_id', '20', '600');
create trigger rate_limit before insert on report_requests for each row execute function rate_limit('patient_id', '10', '600');


/* ═══ Who opened a record ═════════════════════════════════════════════
   Each time someone other than the patient opens their record: who, as what, which part, when.
   At most one line per person, patient and part every 30 minutes. The patient reads their own
   list; staff who view logs read all. Written by the database only. */
create table record_views (
  id          bigint generated always as identity primary key,
  patient_id  uuid not null references patients (id) on delete cascade,
  viewer_id   uuid references profiles (id) on delete set null,
  viewer_role user_role,
  context     text not null default 'record' check (context in ('record', 'vitals', 'consult', 'assignment', 'alerts', 'documents')),
  created_at  timestamptz not null default now()
);
create index record_views_patient_idx on record_views (patient_id, created_at desc);
create index record_views_viewer_idx on record_views (viewer_id, created_at desc);

alter table record_views enable row level security;
create policy record_views_read on record_views for select to authenticated using (patient_id = auth.uid() or staff_can('view_logs'));
create policy record_views_active_only on record_views as restrictive for all to authenticated using (account_active()) with check (account_active());
create trigger record_views_append_only before update on record_views for each row execute function no_rewrite();

/** The caller opened part of a patient's record. Refused for a record they may not see. */
create function log_record_view(patient uuid, context text default 'record') returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); part text := coalesce(nullif(context, ''), 'record');
begin
  if me is null or me = patient then return; end if;
  if not (can_see_patient(patient) or staff_can('assign_healthworkers') or staff_can('approve_patient_requests')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if part not in ('record', 'vitals', 'consult', 'assignment', 'alerts', 'documents') then part := 'record'; end if;
  if exists (select 1 from record_views v where v.viewer_id = me and v.patient_id = patient and v.context = part
             and v.created_at > now() - interval '30 minutes') then
    return;
  end if;
  insert into record_views (patient_id, viewer_id, viewer_role, context) values (patient, me, my_role(), part);
end $$;

-- An admin opening a patient's vitals: the audit entry as before, and now the patient's access log too.
create or replace function log_patient_view(patient uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not staff_can('monitor_patients') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from patients where id = patient) then raise exception 'Patient not found' using errcode = '22023'; end if;
  perform log_record_view(patient, 'vitals');
  if exists (select 1 from audit_log where actor_id = auth.uid() and action = 'Viewed patient vitals'
             and patient_id = patient and created_at > now() - interval '15 minutes') then
    return;
  end if;
  perform audit_event('Viewed patient vitals', name_of(patient), 'patient', patient::text, patient);
end $$;


/* ═══ The patient's own copy ══════════════════════════════════════════
   Everything mCare holds about the signed-in patient that they may see, in one JSON document
   (right of access). Internal notes and other people's details are not in it. */
create function export_my_record() returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); out_ jsonb;
begin
  if not account_active() or my_role() is distinct from 'patient' then
    raise exception 'Only a patient can download their own record' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'format', 'mCare patient record, version 1',
    'exported_at', now(),
    'profile', (select jsonb_build_object('name', full_name, 'email', email, 'phone', phone, 'date_of_birth', dob, 'member_since', created_at)
                from profiles where id = me),
    'health', (select jsonb_build_object('sex', sex, 'blood_type', blood_type, 'no_known_allergies', no_known_allergies,
                 'no_conditions', no_conditions, 'other_medicines', other_medicines, 'treating_doctor', name_of(assigned_doctor_id))
               from patients where id = me),
    'allergies', coalesce((select jsonb_agg(jsonb_build_object('substance', substance, 'severity', severity, 'reaction', reaction) order by substance)
                           from allergies where patient_id = me), '[]'::jsonb),
    'conditions', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'icd10', d.icd10) order by c.name)
                            from conditions c left join condition_defs d on d.code = c.condition_code where c.patient_id = me), '[]'::jsonb),
    'emergency_contacts', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'relationship', relationship, 'phone', phone, 'next_of_kin', next_of_kin))
                                    from emergency_contacts where patient_id = me), '[]'::jsonb),
    'monitoring', coalesce((select jsonb_agg(jsonb_build_object('vital', v.name, 'frequency', t.frequency, 'reason', t.reason,
                              'target', case when th.patient_id is not null then jsonb_build_object('min', th.target_min, 'max', th.target_max) end,
                              'critical', case when th.critical_min is not null then jsonb_build_object('min', th.critical_min, 'max', th.critical_max) end))
                            from tracked_vitals t join vital_defs v on v.id = t.vital_id
                            left join thresholds th on th.patient_id = t.patient_id and th.vital_id = t.vital_id
                            where t.patient_id = me), '[]'::jsonb),
    'readings', coalesce((select jsonb_agg(jsonb_build_object('vital', r.vital_id, 'value', r.value, 'unit', v.unit, 'level', r.level,
                            'taken_at', r.taken_at, 'note', r.note, 'invalid', r.invalid, 'invalid_reason', r.invalid_reason,
                            'first_entered_as', r.corrected_from, 'recorded_by', name_of(r.recorded_by)) order by r.taken_at)
                          from readings r join vital_defs v on v.id = r.vital_id where r.patient_id = me), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('reviewed_by', name_of(reviewer_id), 'reviewed_through', reviewed_through, 'note', note) order by reviewed_through)
                         from vital_reviews where patient_id = me), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'severity', severity, 'status', status, 'vital', vital_id, 'value', value,
                          'unit', unit, 'raised_at', created_at, 'resolved_at', resolved_at, 'resolution', resolution_reason, 'resolution_note', resolution_note) order by created_at)
                        from alerts where patient_id = me), '[]'::jsonb),
    'prescriptions', coalesce((select jsonb_agg(jsonb_build_object('medication', medication, 'dosage', dosage, 'frequency', frequency, 'purpose', purpose,
                                 'route', route, 'instructions', instructions, 'start_date', start_date, 'end_date', end_date, 'status', status,
                                 'prescribed_by', name_of(doctor_id), 'prescribed_at', prescribed_at, 'stopped_at', stopped_at, 'stop_reason', stop_reason)
                                 order by prescribed_at)
                               from prescriptions where patient_id = me), '[]'::jsonb),
    'doses_taken', coalesce((select jsonb_agg(jsonb_build_object('prescription_id', prescription_id, 'day', day, 'taken_at', taken_at) order by day)
                             from dose_logs where patient_id = me), '[]'::jsonb),
    'notes_from_your_doctor', coalesce((select jsonb_agg(jsonb_build_object('written_by', name_of(author_id), 'kind', note_type, 'note', content,
                                          'corrects_earlier_note', amends is not null, 'written_at', created_at) order by created_at)
                                        from clinical_notes where patient_id = me and visibility = 'shared'), '[]'::jsonb),
    'care_plans', coalesce((select jsonb_agg(jsonb_build_object('title', p.title, 'summary', p.summary, 'status', p.status, 'start_date', p.start_date,
                              'review_date', p.review_date, 'written_by', name_of(p.doctor_id),
                              'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'text', i.text, 'status', i.status, 'target_date', i.target_date) order by i.position)
                                                 from care_plan_items i where i.plan_id = p.id), '[]'::jsonb)) order by p.created_at)
                            from care_plans p where p.patient_id = me and p.status <> 'draft'), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(jsonb_build_object('number', number, 'title', title, 'reason', reason, 'with', name_of(doctor_id),
                                'date', coalesce(rescheduled_date, preferred_date), 'time', coalesce(rescheduled_time, preferred_time), 'status', status) order by preferred_date)
                              from appointments where patient_id = me), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'category', category, 'date', document_date, 'origin', origin, 'status', status,
                             'file', file_name) order by document_date)
                           from documents where patient_id = me and deleted_at is null and (origin = 'patient_upload' or status = 'released')), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('from', name_of(from_id), 'to', name_of(to_id), 'message', content, 'sent_at', created_at, 'read_at', read_at)
                            order by created_at)
                          from messages where from_id = me or to_id = me), '[]'::jsonb),
    'who_opened_your_record', coalesce((select jsonb_agg(jsonb_build_object('who', name_of(viewer_id), 'as', viewer_role, 'part', context, 'at', created_at) order by created_at)
                                        from record_views where patient_id = me), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'granted', granted, 'version', version, 'at', created_at) order by created_at)
                          from consents where user_id = me), '[]'::jsonb)
  ) into out_;
  perform audit_event('Downloaded own record', coalesce(name_of(me), 'Patient'), 'patient', me::text, me);
  return out_;
end $$;


/* ═══ Retention, as the admin sets it ═════════════════════════════════
   app_settings 'retention' says how many days to keep audit entries, deleted documents, read
   notifications and sent email / text records (empty = for ever). Clinical records are never
   removed by a job. */
create or replace function purge_deleted_documents() returns int language plpgsql security definer set search_path = public as $$
declare n int; keep int := (setting('retention') ->> 'deleted_document_days')::int;
begin
  if keep is null then return 0; end if;
  delete from documents where deleted_at < now() - make_interval(days => keep) and (origin = 'patient_upload' or status <> 'released');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function purge_expired_documents() returns int language plpgsql security definer set search_path = public as $$
declare n int; keep int := (setting('retention') ->> 'deleted_document_days')::int;
begin
  if not is_admin() then raise exception 'Only an admin can purge documents' using errcode = '42501'; end if;
  n := purge_deleted_documents();
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Purged expired documents',
    n || case when keep is null then ' (deleted documents are kept for ever)' else ' past the ' || keep || '-day recovery window' end);
  return n;
end $$;

-- The audit trail stays append-only; only the retention job, under its own flag, removes entries past the admin's period.
create function audit_log_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and acting('retention_purge') then return old; end if;
  raise exception 'History cannot be changed' using errcode = '42501';
end $$;
drop trigger audit_log_append_only on audit_log;
create trigger audit_log_append_only before update or delete on audit_log for each row execute function audit_log_guard();

/** The nightly job: removes what the retention settings say has expired, and writes one audit entry saying what. */
create function apply_retention() returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb := setting('retention'); docs int; aud int := 0; notes int := 0; sent int := 0;
begin
  docs := purge_deleted_documents();
  if (r ->> 'audit_days') is not null then
    perform set_config('mcare.retention_purge', '1', true);
    delete from audit_log where created_at < now() - make_interval(days => (r ->> 'audit_days')::int);
    get diagnostics aud = row_count;
    perform set_config('mcare.retention_purge', '', true);
  end if;
  if (r ->> 'read_notification_days') is not null then
    delete from notifications where read and created_at < now() - make_interval(days => (r ->> 'read_notification_days')::int);
    get diagnostics notes = row_count;
  end if;
  if (r ->> 'delivery_days') is not null then
    delete from notification_deliveries where status in ('sent', 'failed') and created_at < now() - make_interval(days => (r ->> 'delivery_days')::int);
    get diagnostics sent = row_count;
  end if;
  if docs + aud + notes + sent > 0 then
    insert into audit_log (actor_id, action, detail, resource_type) values (auth.uid(), 'Applied retention',
      format('%s deleted document(s), %s audit entr%s, %s read notification(s), %s sent message record(s)',
             docs, aud, case when aud = 1 then 'y' else 'ies' end, notes, sent), 'settings');
  end if;
  return jsonb_build_object('documents', docs, 'audit', aud, 'notifications', notes, 'deliveries', sent);
end $$;

/** An admin applies the retention settings now instead of waiting for the night. */
create function run_retention_now() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only an admin can apply retention' using errcode = '42501'; end if;
  return apply_retention();
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mcare-retention', '30 3 * * *', 'select public.apply_retention()');
  end if;
end $$;


/* ═══ Document files (hosted Supabase) ════════════════════════════════
   Adding a file now also needs an active account (and the second step where it applies), as every
   table does, and the bucket accepts only the file types the app accepts (fileFormats.ts). */
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $p$ drop policy if exists "documents: add to a record you may write" on storage.objects $p$;
    execute $p$ create policy "documents: add to a record you may write" on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and public.account_active() and ((storage.foldername(name))[1] = auth.uid()::text
        or public.treats(((storage.foldername(name))[1])::uuid))) $p$;
    update storage.buckets set allowed_mime_types = array[
      'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/bmp', 'image/tiff',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'application/vnd.oasis.opendocument.text',
      'application/rtf', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
      'application/vnd.oasis.opendocument.spreadsheet', 'text/csv', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint', 'application/vnd.oasis.opendocument.presentation', 'application/dicom']
    where id = 'documents';
  end if;
end $$;


/* ═══ "Active accounts only", once per query ══════════════════════════
   The restrictive rule on every table (0009) called account_active() for each row. Wrapped in a
   sub-select it is worked out once per query: the same rule, much less work on long lists. The
   loop also gives the tables added since 0009 the same rule. */
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity order by 1 loop
    execute format('drop policy if exists %I on %I', t || '_active_only', t);
    if t in ('profiles', 'doctors', 'staff') then
      execute format('create policy %I on %I as restrictive for update to authenticated using ((select account_active())) with check ((select account_active()))', t || '_active_only', t);
    else
      execute format('create policy %I on %I as restrictive for all to authenticated using ((select account_active())) with check ((select account_active()))', t || '_active_only', t);
    end if;
  end loop;
end $$;


/* ═══ Grants ══════════════════════════════════════════════════════════ */
revoke execute on function message_read_stamp(), rate_limit(), audit_log_guard(), apply_retention() from public, anon, authenticated;
revoke execute on function log_record_view(uuid, text), export_my_record(), run_retention_now() from public, anon;
grant execute on function log_record_view(uuid, text), export_my_record(), run_retention_now() to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function apply_retention() to service_role;
  end if;
end $$;

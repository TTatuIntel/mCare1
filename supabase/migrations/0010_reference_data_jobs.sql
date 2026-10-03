-- mCare reference data, file storage, scheduled jobs and Realtime.
--
-- The storage, pg_cron and Realtime blocks run only where those features exist
-- (hosted Supabase); the local backend and the tests skip them.


/* ═══ Vital definitions ═══════════════════════════════════════════════ */
insert into vital_defs (id, name, unit, icon, active, normal_min, normal_max, critical_min, critical_max, hard_min, hard_max,
                        dia_normal_min, dia_normal_max, dia_critical_min, dia_critical_max, unit_options) values
  ('bp',   'Blood Pressure',   'mmHg',  '🫀', true,  90, 130, 80, 180, 50, 260, 60, 90, 40, 120, null),
  ('hr',   'Heart Rate',       'bpm',   '💓', true,  60, 100, 40, 130, 20, 250, null, null, null, null, null),
  ('gluc', 'Blood Glucose',    'mg/dL', '🩸', true,  70, 140, 54, 250, 20, 600, null, null, null, null, '{mg/dL,mmol/L}'),
  ('temp', 'Temperature',      '°F',    '🌡️', true,  97, 99,  95, 103, 86, 110, null, null, null, null, '{°F,°C}'),
  ('spo2', 'SpO₂',             '%',     '🫁', true,  95, 100, 90, 101, 50, 100, null, null, null, null, null),
  ('wt',   'Weight',           'kg',    '⚖️', true,  40, 150, 30, 200, 2,  350, null, null, null, null, '{kg,lb}'),
  ('ht',   'Height',           'cm',    '📏', false, 50, 250, 30, 280, 20, 300, null, null, null, null, '{cm,in}'),
  ('rr',   'Respiratory Rate', '/min',  '🌬️', false, 12, 20,  8,  30,  4,  60,  null, null, null, null, null),
  ('chol', 'Cholesterol',      'mg/dL', '🧪', false, 0,  200, -1, 300, 50, 600, null, null, null, null, null);

-- The shared lists an open screen watches (my_change_token).
insert into system_changes (topic) values ('people'), ('settings');


/* ═══ Document files (hosted Supabase) ════════════════════════════════
   Files live in the private `documents` bucket, in a folder named after the
   patient. Whoever may read the document row may read its file: the same rule
   (can_open_document) decides both. */
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('documents', 'documents', false, 20 * 1024 * 1024) on conflict (id) do nothing;
    execute $p$ create policy "documents: read what the record allows" on storage.objects for select to authenticated
      using (bucket_id = 'documents' and exists (select 1 from public.documents d where d.file_path = name)) $p$;
    execute $p$ create policy "documents: add to a record you may write" on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and ((storage.foldername(name))[1] = auth.uid()::text
        or public.treats(((storage.foldername(name))[1])::uuid))) $p$;
  end if;
end $$;


/* ═══ Scheduled jobs (hosted Supabase with pg_cron) ═══════════════════
   Enable pg_cron before running this file, or schedule these functions yourself.
   Sending email, SMS and push is scheduled separately: see AGENTS.md, "Notifications and delivery". */
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mcare-escalate-alerts', '* * * * *', 'select public.escalate_stale_alerts()');           -- critical alerts nobody acknowledged in 10 minutes
    perform cron.schedule('mcare-purge-documents', '15 3 * * *', 'select public.purge_deleted_documents()');        -- deleted documents past their keeping time
    perform cron.schedule('mcare-complete-prescriptions', '10 0 * * *', 'select public.complete_ended_prescriptions()');   -- courses past their last day
  end if;
end $$;


/* ═══ Realtime (hosted Supabase) ══════════════════════════════════════
   Published so an open app is told of a change instead of asking for it. */
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.patient_changes, public.system_changes, public.notifications';
  end if;
end $$;

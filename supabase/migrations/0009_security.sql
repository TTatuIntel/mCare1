-- mCare security: row-level security, access rules and function grants.
--
-- Every table has row-level security. The app sends requests as the signed-in
-- person; these rules decide which rows they may read or change, so changing an
-- id in a request, or calling the API directly, returns nothing or is refused.
--   • patient: their own rows (patient_id = auth.uid())
--   • treating doctor: patients assigned to them, while approved and active (treats())
--   • consulting doctor: reads a patient they consult on (consults()), changes nothing
--   • admin: everything administrative; clinical content as "Monitor patients" gives
--   • assistant: only what staff.permissions holds (staff_can())
--   • suspended or deactivated: nothing (the restrictive policies at the end)
-- Column-level protection (who may change which field of a row they can reach)
-- is in the guard_* triggers of each domain.


alter table profiles                enable row level security;
alter table doctors                 enable row level security;
alter table staff                   enable row level security;
alter table patients                enable row level security;
alter table allergies               enable row level security;
alter table conditions              enable row level security;
alter table emergency_contacts      enable row level security;
alter table consents                enable row level security;
alter table account_invitations     enable row level security;
alter table doctor_requests         enable row level security;
alter table care_assignments        enable row level security;
alter table care_team_members       enable row level security;
alter table doctor_ratings          enable row level security;
alter table vital_defs              enable row level security;
alter table tracked_vitals          enable row level security;
alter table thresholds              enable row level security;
alter table threshold_changes       enable row level security;
alter table readings                enable row level security;
alter table alerts                  enable row level security;
alter table alert_remeasures        enable row level security;
alter table alert_comments          enable row level security;
alter table prescriptions           enable row level security;
alter table prescription_events     enable row level security;
alter table dose_logs               enable row level security;
alter table meal_plans              enable row level security;
alter table meal_logs               enable row level security;
alter table hydration_logs          enable row level security;
alter table appointments            enable row level security;
alter table appointment_events      enable row level security;
alter table doctor_hours            enable row level security;
alter table doctor_time_off         enable row level security;
alter table clinical_notes          enable row level security;
alter table care_plans              enable row level security;
alter table care_plan_items         enable row level security;
alter table care_plan_events        enable row level security;
alter table documents               enable row level security;
alter table document_events         enable row level security;
alter table share_links             enable row level security;
alter table support_grants          enable row level security;
alter table report_requests         enable row level security;
alter table messages                enable row level security;
alter table notifications           enable row level security;
alter table push_subscriptions      enable row level security;
alter table notification_deliveries enable row level security;   -- no rule: only the sender, with the service key
alter table support_tickets         enable row level security;
alter table audit_log               enable row level security;
alter table patient_changes         enable row level security;
alter table system_changes          enable row level security;


/* ═══ People ══════════════════════════════════════════════════════════ */
-- profiles: yourself; your patients; your own doctor and the approved-doctor directory; staff see all.
create policy profiles_read on profiles for select to authenticated using (
  id = auth.uid()
  or treats(id)
  or (role = 'doctor' and status = 'active' and exists (select 1 from doctors d where d.id = profiles.id and d.approval_status = 'approved'))
  or my_role() in ('admin', 'assistant'));
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());
create policy profiles_read_consulting on profiles for select to authenticated using (consults(id));
-- doctors: the approved directory is visible to signed-in users; a doctor sees their own row; approvers see all.
create policy doctors_read on doctors for select to authenticated using (
  approval_status = 'approved' or id = auth.uid() or staff_can('approve_doctors') or my_role() = 'admin');
create policy doctors_update on doctors for update to authenticated
  using (id = auth.uid() or staff_can('approve_doctors')) with check (id = auth.uid() or staff_can('approve_doctors'));
create policy staff_read on staff for select to authenticated using (id = auth.uid() or is_admin());
create policy staff_write on staff for all to authenticated using (is_admin()) with check (is_admin());
-- patients and everything hanging off a patient.
create policy patients_read on patients for select to authenticated using (
  can_see_patient(id) or staff_can('assign_healthworkers') or staff_can('approve_patient_requests'));
create policy patients_update on patients for update to authenticated
  using (id = auth.uid() or treats(id) or staff_can('assign_healthworkers'))
  with check (id = auth.uid() or treats(id) or staff_can('assign_healthworkers'));
create policy allergies_read on allergies for select to authenticated using (can_see_patient(patient_id));
create policy allergies_write on allergies for all to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());
create policy conditions_read on conditions for select to authenticated using (can_see_patient(patient_id));
create policy conditions_write on conditions for all to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());
create policy contacts_read on emergency_contacts for select to authenticated using (can_see_patient(patient_id));
create policy contacts_write on emergency_contacts for all to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());
create policy consents_read on consents for select to authenticated using (user_id = auth.uid() or is_admin());
-- Read by the people who register users. Written only through the functions below.
create policy account_invitations_read on account_invitations for select to authenticated using (staff_can('create_users'));


/* ═══ Care relationships ══════════════════════════════════════════════ */
-- Requests are created through request_doctor(); approvers decide them.
create policy doctor_requests_read on doctor_requests for select to authenticated using (
  patient_id = auth.uid() or staff_can('approve_patient_requests'));
create policy doctor_requests_decide on doctor_requests for update to authenticated
  using (staff_can('approve_patient_requests')) with check (staff_can('approve_patient_requests'));
-- The patient reads their own; a doctor the rows that name them; the people who coordinate or monitor care read all.
create policy care_assignments_read on care_assignments for select to authenticated using (
  patient_id = auth.uid() or doctor_id = auth.uid()
  or staff_can('assign_healthworkers') or staff_can('approve_patient_requests') or staff_can('monitor_patients'));
create policy care_team_read on care_team_members for select to authenticated using (
  patient_id = auth.uid() or doctor_id = auth.uid() or treats(patient_id)
  or staff_can('assign_healthworkers') or staff_can('approve_patient_requests') or staff_can('monitor_patients'));
create policy ratings_read on doctor_ratings for select to authenticated using (patient_id = auth.uid() or is_admin());
create policy ratings_write on doctor_ratings for all to authenticated using (patient_id = auth.uid()) with check (
  patient_id = auth.uid() and exists (select 1 from patients p where p.id = auth.uid() and p.assigned_doctor_id = doctor_id));


/* ═══ Vitals and alerts ═══════════════════════════════════════════════ */
create policy vital_defs_read on vital_defs for select to authenticated using (true);
create policy vital_defs_write on vital_defs for all to authenticated using (is_admin()) with check (is_admin());
create policy tracked_read on tracked_vitals for select to authenticated using (can_see_patient(patient_id));
create policy tracked_add on tracked_vitals for insert to authenticated with check (patient_id = auth.uid() or treats(patient_id));
-- A patient cannot drop a vital their doctor set targets for; with a doctor assigned, only the doctor removes vitals.
create policy tracked_remove on tracked_vitals for delete to authenticated using (
  treats(patient_id)
  or (patient_id = auth.uid()
      and not exists (select 1 from thresholds t where t.patient_id = tracked_vitals.patient_id and t.vital_id = tracked_vitals.vital_id)
      and not exists (select 1 from patients p where p.id = tracked_vitals.patient_id and p.assigned_doctor_id is not null)));
create policy thresholds_read on thresholds for select to authenticated using (can_see_patient(patient_id));
create policy thresholds_write on thresholds for all to authenticated using (treats(patient_id)) with check (treats(patient_id));
create policy threshold_changes_read on threshold_changes for select to authenticated using (can_see_patient(patient_id));
create policy readings_read on readings for select to authenticated using (can_see_patient(patient_id));
create policy readings_update on readings for update to authenticated
  using (patient_id = auth.uid() or treats(patient_id)) with check (patient_id = auth.uid() or treats(patient_id));
create policy readings_add on readings for insert to authenticated with check (patient_id = auth.uid() or treats(patient_id));
-- Alerts are created only by the database (reading trigger, raise_sos). The care team works them.
create policy alerts_read on alerts for select to authenticated using (can_see_patient(patient_id));
create policy alerts_work on alerts for update to authenticated
  using (treats(patient_id) or staff_can('monitor_patients')) with check (treats(patient_id) or staff_can('monitor_patients'));
-- Written by the database only.
create policy alert_remeasures_read on alert_remeasures for select to authenticated using (can_see_patient(patient_id));
create policy alert_comments_read on alert_comments for select to authenticated using (can_see_patient(patient_id));
-- Whoever may work the alert may comment on it. A comment is never edited or removed: a correction is a new comment.
create policy alert_comments_add on alert_comments for insert to authenticated with check (
  author_id = auth.uid() and exists (
    select 1 from alerts a where a.id = alert_id and (treats(a.patient_id) or staff_can('monitor_patients'))));


/* ═══ Medication and nutrition ════════════════════════════════════════ */
create policy rx_read on prescriptions for select to authenticated using (can_see_patient(patient_id));
create policy rx_add on prescriptions for insert to authenticated with check (treats(patient_id) and doctor_id = auth.uid());
create policy rx_change on prescriptions for update to authenticated using (treats(patient_id)) with check (treats(patient_id));
create policy prescription_events_read on prescription_events for select to authenticated using (can_see_patient(patient_id));
create policy doses_read on dose_logs for select to authenticated using (can_see_patient(patient_id));
create policy doses_write on dose_logs for all to authenticated using (patient_id = auth.uid()) with check (
  patient_id = auth.uid() and exists (select 1 from prescriptions rx where rx.id = prescription_id and rx.patient_id = auth.uid()));
create policy meal_plans_read on meal_plans for select to authenticated using (can_see_patient(patient_id));
create policy meal_plans_write on meal_plans for all to authenticated using (treats(patient_id)) with check (treats(patient_id) and set_by = auth.uid());
create policy meals_read on meal_logs for select to authenticated using (can_see_patient(patient_id));
create policy meals_write on meal_logs for all to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());
create policy hydration_read on hydration_logs for select to authenticated using (can_see_patient(patient_id));
create policy hydration_write on hydration_logs for all to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());


/* ═══ Appointments and availability ═══════════════════════════════════ */
-- Appointments: the patient asks; the doctor it is with answers.
create policy appts_read on appointments for select to authenticated using (
  patient_id = auth.uid() or doctor_id = auth.uid() or my_role() = 'admin');
create policy appts_request on appointments for insert to authenticated with check (
  patient_id = auth.uid() and status = 'requested'
  and exists (select 1 from doctors d join profiles p on p.id = d.id where d.id = doctor_id and d.approval_status = 'approved' and p.status = 'active'));
create policy appts_update on appointments for update to authenticated
  using (patient_id = auth.uid() or doctor_id = auth.uid()) with check (patient_id = auth.uid() or doctor_id = auth.uid());
-- The treating doctor can book a follow-up directly.
create policy appts_follow_up on appointments for insert to authenticated with check (doctor_id = auth.uid() and treats(patient_id));
create policy appts_staff_read on appointments for select to authenticated
  using (staff_can('monitor_patients') or staff_can('handle_support'));
-- Whoever may read the appointment may read its history. Only the database writes it.
create policy appt_events_read on appointment_events for select to authenticated
  using (exists (select 1 from appointments a where a.id = appointment_id));
-- Working hours are part of the doctor directory. Why a doctor is away is theirs and the staff's; patients learn only that they are.
create policy doctor_hours_read on doctor_hours for select to authenticated using (true);
create policy doctor_hours_write on doctor_hours for all to authenticated
  using (doctor_id = auth.uid() and my_role() = 'doctor') with check (doctor_id = auth.uid() and my_role() = 'doctor');
create policy doctor_time_off_read on doctor_time_off for select to authenticated using (doctor_id = auth.uid() or my_role() in ('admin', 'assistant'));
create policy doctor_time_off_write on doctor_time_off for all to authenticated
  using (doctor_id = auth.uid() and my_role() = 'doctor') with check (doctor_id = auth.uid() and my_role() = 'doctor');


/* ═══ Clinical record ═════════════════════════════════════════════════ */
create policy clinical_notes_add on clinical_notes for insert to authenticated with check (treats(patient_id) and author_id = auth.uid());
create policy clinical_notes_read on clinical_notes for select to authenticated using (
  treats(patient_id) or (visibility = 'shared' and can_see_patient(patient_id)));
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


/* ═══ Documents ═══════════════════════════════════════════════════════ */
create policy documents_read on documents for select to authenticated using (can_open_document(documents));
create policy documents_add on documents for insert to authenticated with check (
  (origin = 'patient_upload' and patient_id = auth.uid()) or (origin <> 'patient_upload' and treats(patient_id)));
create policy documents_change on documents for update to authenticated
  using (patient_id = auth.uid() or treats(patient_id)) with check (patient_id = auth.uid() or treats(patient_id));
-- No delete rule: documents are only ever soft-deleted, then purged on schedule.
create policy document_events_read on document_events for select to authenticated using (
  patient_id = auth.uid() or treats(patient_id) or staff_can('view_logs'));
create policy share_links_read on share_links for select to authenticated using (patient_id = auth.uid());
create policy share_links_revoke on share_links for update to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());
create policy support_grants_read on support_grants for select to authenticated using (admin_id = auth.uid() or is_admin());
create policy report_requests_read on report_requests for select to authenticated using (patient_id = auth.uid() or doctor_id = auth.uid());
create policy report_requests_ask on report_requests for insert to authenticated with check (
  patient_id = auth.uid() and status = 'pending'
  and exists (select 1 from patients p where p.id = auth.uid() and p.assigned_doctor_id = doctor_id));
create policy report_requests_handle on report_requests for update to authenticated
  using (doctor_id = auth.uid() and treats(patient_id)) with check (doctor_id = auth.uid());


/* ═══ Messages, notifications, support, audit, sync ═══════════════════ */
-- Messages: only between a patient and their treating doctor, and only the two of them can read them.
create policy messages_read on messages for select to authenticated using (from_id = auth.uid() or to_id = auth.uid());
create policy messages_send on messages for insert to authenticated with check (
  from_id = auth.uid() and (treats(to_id) or exists (select 1 from patients p where p.id = auth.uid() and p.assigned_doctor_id = to_id)));
create policy messages_mark_read on messages for update to authenticated using (to_id = auth.uid()) with check (to_id = auth.uid());
create policy notifications_read on notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- A device belongs to the person who allowed it, and nobody else reads it.
create policy push_own_read   on push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_own_add    on push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy push_own_remove on push_subscriptions for delete to authenticated using (user_id = auth.uid());
create policy tickets_read on support_tickets for select to authenticated using (user_id = auth.uid() or staff_can('handle_support'));
create policy tickets_open on support_tickets for insert to authenticated with check (user_id = auth.uid() and status = 'open');
create policy tickets_resolve on support_tickets for update to authenticated using (staff_can('handle_support')) with check (staff_can('handle_support'));
create policy audit_read on audit_log for select to authenticated using (staff_can('view_logs'));
-- Whoever may see a patient may know their record changed; a doctor also for patients who have a visit with them.
create policy patient_changes_read on patient_changes for select to authenticated using (
  can_see_patient(patient_id) or staff_can('assign_healthworkers') or staff_can('approve_patient_requests')
  or exists (select 1 from appointments a where a.patient_id = patient_changes.patient_id and a.doctor_id = auth.uid()));
create policy system_changes_read on system_changes for select to authenticated using (true);


/* ═══ Suspended and deactivated accounts ══════════════════════════════
   A restrictive policy on every table, on top of all the rules above: an account
   that is not active is refused at once, on the session it already holds. It may
   still read its own profile row (to be told why), so on the three people tables
   the restriction covers changes only. */
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity order by 1 loop
    if t in ('profiles', 'doctors', 'staff') then
      execute format('create policy %I on %I as restrictive for update to authenticated using (account_active()) with check (account_active())', t || '_active_only', t);
    else
      execute format('create policy %I on %I as restrictive for all to authenticated using (account_active()) with check (account_active())', t || '_active_only', t);
    end if;
  end loop;
end $$;


/* ═══ Function grants ═════════════════════════════════════════════════
   Supabase grants every new function to the API roles. Internal functions are
   taken back from everyone; the actions the app calls are for signed-in people
   only; the sender's functions are for the service key only. */

-- Internal: called by triggers and other functions, never by the app.
revoke execute on function name_of(uuid) from public, anon, authenticated;
revoke execute on function audit_event(text, text, text, text, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke execute on function notify_user(uuid, notif_kind, text, text, text) from public, anon, authenticated;
revoke execute on function notify_about(uuid, notif_kind, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function notify_staff(text, notif_kind, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function notify_care_team(uuid, notif_kind, text, text) from public, anon, authenticated;
revoke execute on function apply_staff_invitation(uuid, text) from public, anon, authenticated;
revoke execute on function raise_vital_alert(readings) from public, anon, authenticated;
revoke execute on function escalate_stale_alerts() from public, anon, authenticated;
revoke execute on function complete_ended_prescriptions() from public, anon, authenticated;
revoke execute on function log_doc_event(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function purge_deleted_documents() from public, anon, authenticated;
revoke execute on function claim_deliveries(int) from public, anon, authenticated;
revoke execute on function claim_deliveries_for(int, text[]) from public, anon, authenticated;
revoke execute on function finish_delivery(bigint, boolean, text) from public, anon, authenticated;
revoke execute on function forget_push_subscription(uuid) from public, anon, authenticated;

-- Actions the app calls: signed-in people only (each checks who is asking itself).
revoke execute on function
  deactivate_my_account(), accept_terms(text), save_health_profile(jsonb), set_tracked_vitals(text[], uuid),
  save_emergency_contact(jsonb), send_alert_now(uuid), decide_doctor_request(uuid, boolean, text, uuid),
  decide_doctor(uuid, approval_status, text), resubmit_doctor_application(text, text, text), doctor_rating_summary(uuid),
  chase_alert(uuid), invite_account(text, text, user_role, text), revoke_invitation(uuid),
  schedule_follow_up(uuid, date, time, text, uuid), staff_restore_document(uuid), purge_expired_documents(),
  log_patient_view(uuid), assign_doctor(uuid, uuid, text), my_past_patients(), set_account_status(uuid, account_status, text),
  save_care_plan(jsonb), set_care_plan_status(uuid, text, text), set_doctor_hours(jsonb, int), doctor_availability(uuid, date),
  admin_update_appointment(uuid, text, date, time, text), admin_report(date, date), my_change_token(),
  add_consulting_doctor(uuid, uuid, text), remove_consulting_doctor(uuid), search_audit(text, text, bigint, int),
  delivery_report(date, date)
from public, anon;
grant execute on function
  deactivate_my_account(), accept_terms(text), save_health_profile(jsonb), set_tracked_vitals(text[], uuid),
  save_emergency_contact(jsonb), send_alert_now(uuid), decide_doctor_request(uuid, boolean, text, uuid),
  decide_doctor(uuid, approval_status, text), resubmit_doctor_application(text, text, text), doctor_rating_summary(uuid),
  chase_alert(uuid), invite_account(text, text, user_role, text), revoke_invitation(uuid),
  schedule_follow_up(uuid, date, time, text, uuid), staff_restore_document(uuid), purge_expired_documents(),
  log_patient_view(uuid), assign_doctor(uuid, uuid, text), my_past_patients(), set_account_status(uuid, account_status, text),
  save_care_plan(jsonb), set_care_plan_status(uuid, text, text), set_doctor_hours(jsonb, int), doctor_availability(uuid, date),
  admin_update_appointment(uuid, text, date, time, text), admin_report(date, date), my_change_token(),
  add_consulting_doctor(uuid, uuid, text), remove_consulting_doctor(uuid), search_audit(text, text, bigint, int),
  delivery_report(date, date)
to authenticated;

-- A share link is opened by someone without an account.
grant execute on function open_share_link(text) to anon;

-- The sender signs in with the service key. (The role exists on hosted Supabase; the local backend runs the sender as the owner.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_deliveries(int), claim_deliveries_for(int, text[]), finish_delivery(bigint, boolean, text),
      forget_push_subscription(uuid) to service_role;
  end if;
end $$;

-- Patient report requests were present in the UI but missing from the live schema.
create type report_request_status as enum ('pending', 'fulfilled', 'declined');

create table report_requests (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patients (id) on delete cascade,
  doctor_id      uuid not null references doctors (id),
  period_days    integer not null check (period_days between 1 and 365),
  reason         text not null default '',
  status         report_request_status not null default 'pending',
  document_id    uuid references medical_documents (id) on delete set null,
  decline_reason text,
  created_at     timestamptz not null default now(),
  handled_at     timestamptz
);
create index report_requests_patient_idx on report_requests (patient_id, created_at desc);
create index report_requests_doctor_idx on report_requests (doctor_id, created_at desc);

alter table report_requests enable row level security;
create policy report_requests_read on report_requests for select to authenticated using (
  patient_id = auth.uid() or doctor_id = auth.uid() or my_role() = 'admin');
create policy report_requests_create on report_requests for insert to authenticated with check (
  patient_id = auth.uid() and status = 'pending'
  and exists (select 1 from patients p where p.id = auth.uid() and p.assigned_doctor_id = doctor_id));
create policy report_requests_handle on report_requests for update to authenticated
  using (doctor_id = auth.uid()) with check (doctor_id = auth.uid());

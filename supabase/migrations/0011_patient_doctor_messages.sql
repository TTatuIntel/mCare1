-- Let a patient message each current treating or consulting doctor in a separate private thread.
-- Existing conversations remain readable to their two participants; only current relationships may send.
drop policy messages_send on messages;
create policy messages_send on messages for insert to authenticated with check (
  from_id = auth.uid() and (
    treats(to_id)
    or consults(to_id)
    or exists (
      select 1 from patients p
      where p.id = auth.uid() and (
        p.assigned_doctor_id = to_id
        or exists (
          select 1 from care_team_members m
          where m.patient_id = p.id and m.doctor_id = to_id and m.ended_at is null
        )
      )
    )
  )
);
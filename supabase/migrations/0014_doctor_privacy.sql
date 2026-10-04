-- mCare doctor privacy: a doctor's handwritten signature is readable by that doctor alone (it is
-- still stamped onto what they sign), and a patient sees the full profile (email, phone, date of
-- birth) only of doctors they actually deal with. Everyone else finds doctors through a
-- directory that carries public details only.


/* ═══ Signatures ══════════════════════════════════════════════════════
   The signature used to sit on the doctors row, which every signed-in account can read (the
   doctor directory). It now has its own table. Signing still stamps it onto the document. */
create table doctor_signatures (
  doctor_id  uuid primary key references doctors (id) on delete cascade,
  image      text not null check (image like 'data:image/%' and length(image) <= 1000000),
  updated_at timestamptz not null default now()
);
alter table doctor_signatures enable row level security;
create policy doctor_signatures_own on doctor_signatures for all to authenticated
  using (doctor_id = auth.uid() and my_role() = 'doctor') with check (doctor_id = auth.uid() and my_role() = 'doctor');
create policy doctor_signatures_active_only on doctor_signatures as restrictive for all to authenticated
  using (account_active()) with check (account_active());
create trigger stamp_updated before update on doctor_signatures for each row execute function stamp_updated();

create function signature_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  perform audit_event(case tg_op when 'DELETE' then 'Removed signature' else 'Saved signature' end,
    coalesce(name_of(coalesce(new.doctor_id, old.doctor_id)), 'Doctor'), 'doctor', coalesce(new.doctor_id, old.doctor_id)::text);
  return null;
end $$;
create trigger signature_audit after insert or update or delete on doctor_signatures for each row execute function signature_audit();

insert into doctor_signatures (doctor_id, image) select id, signature from doctors where signature like 'data:image/%';
update doctors set signature = null where signature is not null;

/** An older app that still writes doctors.signature: the signature goes to its own table instead. */
create function keep_signature_private() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.signature is not null then
    if new.signature like 'data:image/%' then
      insert into doctor_signatures (doctor_id, image) values (new.id, new.signature)
      on conflict (doctor_id) do update set image = excluded.image;
    end if;
    new.signature := null;
  end if;
  return new;
end $$;
create trigger keep_signature_private before insert or update of signature on doctors for each row execute function keep_signature_private();

/** Signing (sign_document, release_document, a filed prescription) stamps the signer's signature as it is now. */
create function stamp_signature() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.signed_by is not null and new.signature_image is null and (tg_op = 'INSERT' or old.signed_by is distinct from new.signed_by) then
    new.signature_image := (select image from doctor_signatures where doctor_id = new.signed_by);
  end if;
  return new;
end $$;
create trigger stamp_signature before insert or update on documents for each row execute function stamp_signature();


/* ═══ The doctor directory ════════════════════════════════════════════
   Approved, active doctors with what a patient needs to choose one: name, photo, specialty,
   facility, licence number, visit length. Never email, phone or date of birth. */
create function doctor_directory() returns table (
  id uuid, full_name text, avatar jsonb, specialty text, hospital text, license_no text, slot_minutes int
) language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.avatar, d.specialty, d.hospital, d.license_no, d.slot_minutes
  from profiles p join doctors d on d.id = p.id
  where p.role = 'doctor' and p.status = 'active' and d.approval_status = 'approved' and account_active()
  order by p.full_name
$$;

/** An approved, active doctor (with the second step where it applies). */
create function is_clinician() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from doctors d join profiles p on p.id = d.id
                 where d.id = auth.uid() and d.approval_status = 'approved' and p.status = 'active') and mfa_ok() $$;

/** The calling patient deals with this doctor: treated by them now or before, on their care team, has asked for them, has a visit or a conversation with them. */
create function patient_knows_doctor(doc uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from patients where id = auth.uid() and assigned_doctor_id = doc)
      or exists (select 1 from care_team_members where patient_id = auth.uid() and doctor_id = doc)
      or exists (select 1 from care_assignments where patient_id = auth.uid() and doctor_id = doc)
      or exists (select 1 from doctor_requests where patient_id = auth.uid() and doctor_id = doc)
      or exists (select 1 from appointments where patient_id = auth.uid() and doctor_id = doc)
      or exists (select 1 from messages where (from_id = auth.uid() and to_id = doc) or (from_id = doc and to_id = auth.uid())) $$;

-- profiles: yourself; your patients; doctors you deal with; colleagues (approved doctors see the
-- approved directory in full); staff see everyone. Consulting doctors keep profiles_read_consulting.
drop policy profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated using (
  id = auth.uid()
  or treats(id)
  or (role = 'doctor' and patient_knows_doctor(id))
  or (role = 'doctor' and status = 'active' and is_clinician()
      and exists (select 1 from doctors d where d.id = profiles.id and d.approval_status = 'approved'))
  or my_role() in ('admin', 'assistant'));


/* ═══ Grants ══════════════════════════════════════════════════════════ */
revoke execute on function signature_audit(), keep_signature_private(), stamp_signature() from public, anon, authenticated;
revoke execute on function doctor_directory(), is_clinician(), patient_knows_doctor(uuid) from public, anon;
grant execute on function doctor_directory(), is_clinician(), patient_knows_doctor(uuid) to authenticated;

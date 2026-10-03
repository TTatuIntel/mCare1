-- mCare documents: uploads, official reports, share links, support access and report requests.
--
--   • a patient opens their own uploads, and official documents only once released
--   • the treating doctor opens official documents and uploads the patient shared, never private ones
--   • admins and assistants see that a document exists (the registry) but not its title or content;
--     an admin may open one document for 15 minutes after stating a reason, and the patient is told
--   • only the treating doctor signs, releases and corrects; released documents are never edited or deleted
--   • every sign, release, share, deletion and support access is written to an append-only history


/* ═══ Access and history ══════════════════════════════════════════════ */
create function has_grant(doc uuid) returns boolean language sql stable security definer set search_path = public as
$$ select is_admin() and exists (select 1 from support_grants g where g.admin_id = auth.uid() and g.document_id = doc and g.expires_at > now()) $$;

create function log_doc_event(doc uuid, act text, det text default null, label text default null) returns void
language sql security definer set search_path = public as
$$ insert into document_events (document_id, patient_id, actor_id, actor_label, action, detail)
   select d.id, d.patient_id, auth.uid(), label, act, det from documents d where d.id = doc $$;

/** May the caller open this document's content right now? The single rule every read goes through. */
create function can_open_document(d documents) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when d.patient_id = auth.uid() then
      case when d.origin = 'patient_upload' then true                      -- own uploads, including recently deleted (to restore)
           else d.status = 'released' and d.deleted_at is null end         -- official: only once released
    when treats(d.patient_id) then
      case when d.origin = 'patient_upload'
           then d.visibility = 'care_team' and d.upload_state = 'ready' and d.deleted_at is null
           else true end                                                   -- official documents in every state
    else d.deleted_at is null and has_grant(d.id)                          -- admin with a live, reasoned grant
  end $$;

create function doc_for_doctor(doc uuid) returns documents language plpgsql stable security definer set search_path = public as $$
declare d documents;
begin
  select * into d from documents where id = doc;
  -- One answer for "does not exist" and "not yours", so ids cannot be probed.
  if not found or d.origin = 'patient_upload' or d.deleted_at is not null or not treats(d.patient_id) then
    raise exception 'Document not found or you do not have access' using errcode = '42501';
  end if;
  if d.upload_state is not null and d.upload_state <> 'ready' then raise exception 'The file is still uploading' using errcode = '22023'; end if;
  return d;
end $$;

create function guard_document() returns trigger language plpgsql security definer set search_path = public as $$
declare
  via_action boolean := coalesce(current_setting('mcare.doc_action', true), '') = '1';
  me uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.created_by := coalesce(me, new.created_by);
    new.series_id := coalesce(new.series_id, new.id);
    if me is null then return new; end if;
    if new.origin = 'patient_upload' then
      if new.patient_id <> me then raise exception 'You can only add documents to your own record' using errcode = '42501'; end if;
      new.signed_by := null; new.signed_at := null; new.signature_image := null; new.released_by := null; new.released_at := null;
      new.version := 1; new.supersedes := null;
    else
      if not treats(new.patient_id) then raise exception 'Only the treating doctor can add official documents' using errcode = '42501'; end if;
      if not via_action then
        new.status := 'draft'; new.signed_by := null; new.signed_at := null; new.signature_image := null;
        new.released_by := null; new.released_at := null; new.version := 1; new.supersedes := null;
      end if;
    end if;
    new.superseded_by := null; new.deleted_at := null; new.deleted_by := null; new.seen_by_patient := false;
    return new;
  end if;

  if me is null or via_action then return new; end if;

  -- Identity and lifecycle never change by a plain update.
  if (new.patient_id, new.origin, new.created_by, new.series_id, new.version) is distinct from
     (old.patient_id, old.origin, old.created_by, old.series_id, old.version)
     or new.status is distinct from old.status or new.signed_by is distinct from old.signed_by
     or new.signed_at is distinct from old.signed_at or new.signature_image is distinct from old.signature_image
     or new.released_by is distinct from old.released_by or new.released_at is distinct from old.released_at
     or new.supersedes is distinct from old.supersedes or new.superseded_by is distinct from old.superseded_by then
    raise exception 'Use sign, release or correct to change a document''s status' using errcode = '42501';
  end if;

  if me = old.patient_id then
    if old.origin <> 'patient_upload' then
      -- On an official document a patient may only mark it seen.
      if to_jsonb(new) - 'seen_by_patient' is distinct from to_jsonb(old) - 'seen_by_patient' then
        raise exception 'Official documents can only be changed by your doctor' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.deleted_at is distinct from old.deleted_at then
      if new.deleted_at is null and old.deleted_at < now() - interval '30 days' then
        raise exception 'This document can no longer be restored' using errcode = '42501';
      end if;
      new.deleted_at := case when new.deleted_at is null then null else now() end;
      new.deleted_by := case when new.deleted_at is null then null else me end;
    end if;
    return new;
  end if;

  -- Treating doctor.
  if old.origin = 'patient_upload' then raise exception 'A patient''s upload can only be changed by the patient' using errcode = '42501'; end if;
  if old.status = 'released' then raise exception 'Released documents cannot be edited — issue a correction' using errcode = '42501'; end if;
  if new.deleted_at is distinct from old.deleted_at then
    new.deleted_at := case when new.deleted_at is null then null else now() end;
    new.deleted_by := case when new.deleted_at is null then null else me end;
  end if;
  -- Changing the words after signing voids the signature.
  if old.status = 'signed' and (new.body is distinct from old.body or new.title <> old.title or new.file_sha256 is distinct from old.file_sha256) then
    new.status := 'draft'; new.signed_by := null; new.signed_at := null; new.signature_image := null;
  end if;
  return new;
end $$;

create function document_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_doc_event(new.id, 'upload', case when new.category = 'vitals_report' and new.origin = 'system_generated'
      then 'Generated from the vitals record' end);
  else
    if new.upload_state is distinct from old.upload_state and new.upload_state = 'failed' then perform log_doc_event(new.id, 'upload_failed', new.upload_error); end if;
    if new.visibility <> old.visibility then perform log_doc_event(new.id, 'visibility', new.visibility::text); end if;
    if old.deleted_at is null and new.deleted_at is not null then perform log_doc_event(new.id, 'delete'); end if;
    if old.deleted_at is not null and new.deleted_at is null then perform log_doc_event(new.id, 'restore'); end if;
  end if;
  return new;
end $$;

create function record_document_access(doc uuid, act text default 'view') returns void language plpgsql security definer set search_path = public as $$
declare d documents;
begin
  if act not in ('view', 'download') then raise exception 'Unknown action' using errcode = '22023'; end if;
  select * into d from documents where id = doc;
  if not found or not account_active() or not can_open_document(d) or (d.deleted_at is not null) then
    raise exception 'Document not found or you do not have access' using errcode = '42501';
  end if;
  perform log_doc_event(doc, act);
  if act = 'view' and d.patient_id = auth.uid() and not d.seen_by_patient then
    update documents set seen_by_patient = true where id = doc;
  end if;
end $$;


create trigger guard_document before insert or update on documents for each row execute function guard_document();
create trigger document_history after insert or update on documents for each row execute function document_history();
create trigger document_events_append_only before update or delete on document_events for each row execute function no_rewrite();


/* ═══ Official documents ══════════════════════════════════════════════ */
create function sign_document(doc uuid) returns void language plpgsql security definer set search_path = public as $$
declare d documents := doc_for_doctor(doc);
begin
  if d.status <> 'draft' then raise exception 'Only a draft can be signed' using errcode = '22023'; end if;
  perform set_config('mcare.doc_action', '1', true);
  update documents set status = 'signed', signed_by = auth.uid(), signed_at = now(),
    signature_image = (select signature from doctors where id = auth.uid()) where id = doc;
  perform set_config('mcare.doc_action', '', true);
  perform log_doc_event(doc, 'sign');
end $$;

/** Release to the patient. Signs first if still a draft, and retires the version it corrects. */
create function release_document(doc uuid) returns void language plpgsql security definer set search_path = public as $$
declare d documents := doc_for_doctor(doc);
begin
  if d.status = 'released' then raise exception 'Already released' using errcode = '22023'; end if;
  perform set_config('mcare.doc_action', '1', true);
  update documents set status = 'released',
    signed_by = coalesce(signed_by, auth.uid()), signed_at = coalesce(signed_at, now()),
    signature_image = case when signed_by is null then (select signature from doctors where id = auth.uid()) else signature_image end,
    released_by = auth.uid(), released_at = now(), seen_by_patient = false, release_on_ready = false
  where id = doc;
  if d.supersedes is not null then update documents set superseded_by = doc where id = d.supersedes; end if;
  perform set_config('mcare.doc_action', '', true);
  if d.status = 'draft' then perform log_doc_event(doc, 'sign', 'Signed on release'); end if;
  perform log_doc_event(doc, 'release', case when d.supersedes is not null then 'Version ' || d.version || ' replaces version ' || (d.version - 1) end);
  perform notify_user(d.patient_id, 'document',
    case when d.supersedes is not null then 'Corrected report available' else 'New report from your doctor' end, d.title, 'docs');
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Released document', d.category::text || ' v' || d.version);
end $$;

/** Start a corrected version of a released document. The original stays current until the correction is released. */
create function correct_document(doc uuid, reason text) returns uuid language plpgsql security definer set search_path = public as $$
declare d documents := doc_for_doctor(doc); nid uuid := gen_random_uuid();
begin
  if length(trim(coalesce(reason, ''))) < 5 then raise exception 'Give a reason for the correction' using errcode = '22023'; end if;
  if d.status <> 'released' or d.superseded_by is not null then raise exception 'Only the current released version can be corrected' using errcode = '22023'; end if;
  if d.category = 'prescription' then raise exception 'Change prescriptions from Medications' using errcode = '22023'; end if;
  if exists (select 1 from documents where supersedes = doc and deleted_at is null) then raise exception 'A correction is already in progress' using errcode = '22023'; end if;
  perform set_config('mcare.doc_action', '1', true);
  insert into documents (id, patient_id, title, category, origin, description, document_date, created_by, body, links,
                         status, series_id, version, supersedes, correction_reason)
  values (nid, d.patient_id, d.title, d.category, d.origin, d.description, current_date, auth.uid(), d.body, d.links,
          'draft', d.series_id, d.version + 1, d.id, trim(reason));
  perform set_config('mcare.doc_action', '', true);
  perform log_doc_event(doc, 'correct', trim(reason));
  return nid;
end $$;


/* ═══ Support access and recovery ═════════════════════════════════════ */
/** Staff view: that documents exist, never what they say. Titles can reveal a diagnosis, so they are left out. */
create function document_registry() returns table (
  id uuid, patient_id uuid, category doc_category, origin doc_origin, document_date date, created_at timestamptz,
  status doc_status, version int, upload_state upload_state, file_mime text, file_size bigint, visibility doc_visibility,
  deleted_at timestamptz, has_grant boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or staff_can('document_support')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query select d.id, d.patient_id, d.category, d.origin, d.document_date, d.created_at, d.status, d.version,
    d.upload_state, d.file_mime, d.file_size, d.visibility, d.deleted_at, has_grant(d.id) from documents d;
end $$;

/** An admin (never an assistant) opens one document for 15 minutes, with a stated reason. The patient is told. */
create function request_support_access(doc uuid, reason text) returns timestamptz language plpgsql security definer set search_path = public as $$
declare d documents; until timestamptz := now() + interval '15 minutes';
begin
  if not is_admin() then raise exception 'Only an administrator can open a document for support' using errcode = '42501'; end if;
  if length(trim(coalesce(reason, ''))) < 10 then raise exception 'State the reason (at least 10 characters)' using errcode = '22023'; end if;
  select * into d from documents where id = doc and deleted_at is null;
  if not found then raise exception 'Document not found or you do not have access' using errcode = '42501'; end if;
  insert into support_grants (admin_id, document_id, reason, expires_at) values (auth.uid(), doc, trim(reason), until);
  perform log_doc_event(doc, 'support_access', trim(reason));
  perform notify_user(d.patient_id, 'document', 'mCare support opened a document',
    'An administrator opened one of your documents for 15 minutes. Reason: ' || trim(reason), 'docs');
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Support access to document', trim(reason));
  return until;
end $$;

create function staff_restore_document(doc uuid) returns void language plpgsql security definer set search_path = public as $$
declare d documents;
begin
  if not staff_can('document_support') then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into d from documents where id = doc and deleted_at is not null for update;
  if not found then raise exception 'That document is not deleted' using errcode = '22023'; end if;
  if d.deleted_at < now() - interval '30 days' then raise exception 'This document can no longer be restored' using errcode = '22023'; end if;
  perform set_config('mcare.doc_action', '1', true);
  begin
    update documents set deleted_at = null, deleted_by = null where id = doc;
  exception when unique_violation then
    raise exception 'The same file has been added again since; nothing to restore' using errcode = '22023';
  end;
  perform set_config('mcare.doc_action', '', true);
  if d.origin = 'patient_upload' then
    perform notify_user(d.patient_id, 'document', 'A document was restored', 'One of your documents was recovered by mCare support', 'docs');
  end if;
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Restored document', d.category::text || ' · ' || name_of(d.patient_id));
end $$;

/** Runs on a schedule: deleted documents are removed for good after 30 days. */
create function purge_deleted_documents() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from documents where deleted_at < now() - interval '30 days' and (origin = 'patient_upload' or status <> 'released');
  get diagnostics n = row_count;
  return n;
end $$;

/** A full admin removes, now, what the nightly job would remove: documents deleted more than 30 days ago. */
create function purge_expired_documents() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'Only an admin can purge documents' using errcode = '42501'; end if;
  n := purge_deleted_documents();
  insert into audit_log (actor_id, action, detail) values (auth.uid(), 'Purged expired documents', n || ' past the 30-day recovery window');
  return n;
end $$;


/* ═══ Share links ═════════════════════════════════════════════════════ */
create function hash_token(token text) returns text language sql immutable as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex') $$;

create function create_share_link(docs uuid[], recipient text, ttl_hours int default 24, one_time boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); n int; doc uuid;
begin
  if not account_active() then raise exception 'Your account is not active' using errcode = '42501'; end if;
  if ttl_hours not between 1 and 24 * 30 then raise exception 'Links last between 1 hour and 30 days' using errcode = '22023'; end if;
  select count(*) into n from documents d where d.id = any (docs) and d.patient_id = auth.uid() and d.deleted_at is null
    and can_open_document(d) and (d.upload_state is null or d.upload_state = 'ready');
  if n = 0 or n <> cardinality(docs) then raise exception 'Document not found or you do not have access' using errcode = '42501'; end if;
  insert into share_links (token_hash, patient_id, document_ids, recipient, one_time, expires_at)
  values (hash_token(token), auth.uid(), docs, trim(recipient), one_time, now() + make_interval(hours => ttl_hours));
  foreach doc in array docs loop perform log_doc_event(doc, 'share', trim(recipient) || ' · ' || ttl_hours || ' h' || case when one_time then ' · one-time' else '' end); end loop;
  return token;
end $$;

/** What the outside clinician's browser calls. No account: the token is the credential. */
create function open_share_link(token text) returns table (
  id uuid, title text, category doc_category, document_date date, body jsonb, file_path text, file_name text, file_mime text, recipient text
) language plpgsql security definer set search_path = public as $$
declare s share_links; doc uuid;
begin
  select * into s from share_links where token_hash = hash_token(token) for update;
  if not found or s.revoked_at is not null or s.expires_at < now() or (s.one_time and s.opened_count > 0) then
    raise exception 'This link is no longer valid' using errcode = '42501';
  end if;
  update share_links set opened_count = opened_count + 1 where share_links.id = s.id;
  foreach doc in array s.document_ids loop perform log_doc_event(doc, 'share_open', null, s.recipient); end loop;
  perform notify_user(s.patient_id, 'document', 'Your shared link was opened', s.recipient || ' viewed your documents', 'docs');
  -- Only what the patient could still open themself: a document withdrawn since sharing is not shown.
  return query select d.id, d.title, d.category, d.document_date, d.body, d.file_path, d.file_name, d.file_mime, s.recipient
    from documents d where d.id = any (s.document_ids) and d.deleted_at is null
      and (d.origin = 'patient_upload' or d.status = 'released');
end $$;


/* ═══ Report requests ═════════════════════════════════════════════════ */
create function report_request_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := name_of(new.patient_id);
begin
  if tg_op = 'INSERT' then
    perform notify_about(new.doctor_id, 'document', 'Report request: ' || who,
      'Vitals report for the last ' || new.period_days || ' days', 'patients', 'patient', new.patient_id::text);
    return new;
  end if;
  if (new.patient_id, new.doctor_id, new.period_days, new.reason, new.created_at)
     is distinct from (old.patient_id, old.doctor_id, old.period_days, old.reason, old.created_at) then
    raise exception 'A report request cannot be rewritten' using errcode = '42501';
  end if;
  if new.status <> old.status then
    if old.status <> 'pending' then
      raise exception 'That request has already been answered' using errcode = '22023';
    end if;
    if new.status = 'fulfilled' and new.document_id is null then
      raise exception 'Attach the report to the request' using errcode = '22023';
    end if;
    new.handled_at := now();
    perform notify_user(new.patient_id, 'document',
      case when new.status = 'declined' then 'Report request declined' else 'Your report is being prepared' end,
      coalesce(new.decline_reason, 'You''ll get it once it''s signed.'), 'docs');
  end if;
  return new;
end $$;


create trigger report_request_notify before insert or update on report_requests for each row execute function report_request_notify();

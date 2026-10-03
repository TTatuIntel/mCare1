-- mCare messages and delivery: conversations, notifications and the send queue.
--
-- Every notification appears in the app and is also queued for the channels the
-- person allows: email for all of them, a text message only for what cannot wait
-- (an SOS, an escalation, a critical reading), push on each device they allowed.
-- A sender outside the database (supabase/functions/deliver, or the local
-- backend, which prints instead of sending) claims a batch and reports back.
-- A channel with no provider configured waits in the queue.


/* ═══ Messages ════════════════════════════════════════════════════════ */
create function guard_message() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.created_at := now(); new.read := false; new.content := trim(new.content);
    return new;
  end if;
  if (new.from_id, new.to_id, new.content, new.created_at) is distinct from (old.from_id, old.to_id, old.content, old.created_at)
     or (old.read and not new.read) then
    raise exception 'Messages cannot be edited' using errcode = '42501';
  end if;
  return new;
end $$;

/** A new message tells the recipient, and the notification names the conversation, so a tap opens the thread. */
create function message_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform notify_about(new.to_id, 'message', 'New message from ' || coalesce(name_of(new.from_id), 'mCare'), left(new.content, 80),
    'messages', 'conversation', new.from_id::text);
  return new;
end $$;


create trigger guard_message before insert or update on messages for each row execute function guard_message();
create trigger message_notify after insert on messages for each row execute function message_notify();


/* ═══ Notifications and the queue ═════════════════════════════════════ */
create function guard_notification() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.user_id, new.kind, new.title, new.body, new.link, new.created_at, new.resource_type, new.resource_id) is distinct from
     (old.user_id, old.kind, old.title, old.body, old.link, old.created_at, old.resource_type, old.resource_id)
     or (old.read and not new.read) then
    raise exception 'Notifications cannot be edited' using errcode = '42501';
  end if;
  new.read_at := case when new.read and not old.read then now() else old.read_at end;
  return new;
end $$;

/** What cannot wait gets a text message too: an SOS, an escalation, a critical reading. */
create function sms_worthy(k notif_kind, title text) returns boolean language sql immutable as
$$ select k in ('sos', 'escalation') or (k = 'alert' and title like 'Critical%') $$;

/** A phone number as the SMS provider wants it: digits, with a leading +. Null when it cannot be one. */
create function sms_number(phone text) returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) between 9 and 15
    then case when trim(phone) like '+%' then '+' else '' end || regexp_replace(phone, '[^0-9]', '', 'g') end $$;

create function queue_notification_delivery() returns trigger language plpgsql security definer set search_path = public as $$
declare p profiles; urgent boolean := new.kind in ('sos', 'escalation', 'alert');
begin
  select * into p from profiles where id = new.user_id;
  if not found or p.status in ('suspended', 'deactivated') then return new; end if;
  if p.notify_email and p.email is not null then
    insert into notification_deliveries (notification_id, user_id, channel, to_address, subject, body, urgent, link)
    values (new.id, new.user_id, 'email', p.email, new.title, new.body, urgent, new.link);
  end if;
  if p.notify_sms and sms_worthy(new.kind, new.title) and sms_number(p.phone) is not null then
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


create trigger guard_notification before update on notifications for each row execute function guard_notification();
create trigger zz_queue_delivery after insert on notifications for each row execute function queue_notification_delivery();


/* ═══ The sender (service key only) ═══════════════════════════════════ */
/**
 * The sender takes up to `batch` emails to send now, urgent ones first. One taken more than
 * five minutes ago and never finished is offered again (the sender died part-way).
 */
create function claim_deliveries(batch int default 20) returns setof notification_deliveries
language plpgsql security definer set search_path = public as $$
begin
  return query
  update notification_deliveries d set status = 'sending', attempts = d.attempts + 1, claimed_at = now()
  where d.id in (
    select id from notification_deliveries
    where status = 'queued' or (status = 'sending' and claimed_at < now() - interval '5 minutes')
    order by urgent desc, created_at
    limit greatest(1, least(batch, 100))
    for update skip locked)
  returning d.*;
end $$;

create function claim_deliveries_for(batch int, channels text[]) returns setof notification_deliveries
language plpgsql security definer set search_path = public as $$
begin
  return query
  update notification_deliveries d set status = 'sending', attempts = d.attempts + 1, claimed_at = now()
  where d.id in (
    select id from notification_deliveries
    where channel = any (channels)
      and (status = 'queued' or (status = 'sending' and claimed_at < now() - interval '5 minutes'))
    order by urgent desc, created_at
    limit greatest(1, least(batch, 100))
    for update skip locked)
  returning d.*;
end $$;

/** The sender reports how one email went. A failure is retried, up to five attempts in all. */
create function finish_delivery(delivery bigint, ok boolean, problem text default null) returns void
language sql security definer set search_path = public as $$
  update notification_deliveries set
    status = case when ok then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
    sent_at = case when ok then now() end,
    error = case when ok then null else left(coalesce(problem, 'Unknown error'), 500) end
  where id = delivery and status = 'sending'
$$;

/** The sender marks a push device that the browser has withdrawn, so it is not tried again. */
create function forget_push_subscription(subscription uuid) returns void language sql security definer set search_path = public as
$$ delete from push_subscriptions where id = subscription $$;

create function delivery_report(from_day date, to_day date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f timestamptz := from_day::timestamptz; t timestamptz := (to_day + 1)::timestamptz;
begin
  if not (is_admin() or staff_can('view_logs')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if from_day is null or to_day is null or from_day > to_day or to_day - from_day > 366 then
    raise exception 'Choose a period of up to a year' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'channels', (select coalesce(jsonb_object_agg(channel, counts), '{}'::jsonb) from (
      select channel, jsonb_build_object(
        'sent', count(*) filter (where status = 'sent'), 'failed', count(*) filter (where status = 'failed'),
        'waiting', count(*) filter (where status in ('queued', 'sending'))) counts
      from notification_deliveries where created_at >= f and created_at < t group by channel) x),
    -- What went wrong, not who it was for: no address, no message.
    'failures', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'error', error, 'at', created_at) order by created_at desc), '[]'::jsonb) from (
      select channel, error, created_at from notification_deliveries
      where status = 'failed' and created_at >= f and created_at < t order by created_at desc limit 10) y));
end $$;

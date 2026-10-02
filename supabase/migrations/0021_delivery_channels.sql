-- mCare delivery channels: email, text message and push, each chosen by the person.
--
-- 0019 queued every notification as an email. This adds:
--   • the person's choice: email, text message and push can each be switched off
--   • text messages (SMS), only for what cannot wait: an SOS, an escalation, a critical reading
--   • push to each device the person has allowed (`push_subscriptions`)
--   • the invitation email: someone registered in advance is told to sign up
--   • `delivery_report()`: how many went out, by channel, and how many failed
--
-- The providers (mail, SMS, push keys) are configured on the sender, not here:
-- see AGENTS.md, "Notifications and delivery". Until they are, the local backend prints what it would send,
-- and on a hosted project the queue simply waits.


/* ─── The person's choice ──────────────────────────────────────────── */
alter table profiles add column notify_email boolean not null default true;
alter table profiles add column notify_sms   boolean not null default true;
alter table profiles add column notify_push  boolean not null default true;


/* ─── Devices that accept push ─────────────────────────────────────── */
create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references profiles (id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://'),
  p256dh       text not null,
  auth         text not null,
  user_agent   text check (user_agent is null or length(user_agent) <= 300),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
-- A device belongs to the person who allowed it, and nobody else reads it.
create policy push_own_read   on push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_own_add    on push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy push_own_remove on push_subscriptions for delete to authenticated using (user_id = auth.uid());
create policy push_active_only on push_subscriptions as restrictive for all to authenticated using (account_active()) with check (account_active());


/* ─── The queue, for every channel ─────────────────────────────────── */
alter table notification_deliveries alter column notification_id drop not null;
alter table notification_deliveries alter column user_id drop not null;
alter table notification_deliveries drop constraint notification_deliveries_channel_check;
alter table notification_deliveries add constraint notification_deliveries_channel_check check (channel in ('email', 'sms', 'push'));
alter table notification_deliveries add column subscription_id uuid references push_subscriptions (id) on delete cascade;
alter table notification_deliveries add column link text;
alter table notification_deliveries add constraint notification_deliveries_push_target check ((channel = 'push') = (subscription_id is not null));
create index notification_deliveries_report_idx on notification_deliveries (created_at, channel, status);

/** What cannot wait gets a text message too: an SOS, an escalation, a critical reading. */
create function sms_worthy(k notif_kind, title text) returns boolean language sql immutable as
$$ select k in ('sos', 'escalation') or (k = 'alert' and title like 'Critical%') $$;

/** A phone number as the SMS provider wants it: digits, with a leading +. Null when it cannot be one. */
create function sms_number(phone text) returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) between 9 and 15
    then case when trim(phone) like '+%' then '+' else '' end || regexp_replace(phone, '[^0-9]', '', 'g') end $$;

create or replace function queue_notification_delivery() returns trigger language plpgsql security definer set search_path = public as $$
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

/** The sender marks a push device that the browser has withdrawn, so it is not tried again. */
create function forget_push_subscription(subscription uuid) returns void language sql security definer set search_path = public as
$$ delete from push_subscriptions where id = subscription $$;
revoke execute on function forget_push_subscription(uuid) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function forget_push_subscription(uuid) to service_role;
  end if;
end $$;


/* ─── The invitation email ─────────────────────────────────────────── */
create or replace function invite_account(invite_email text, invite_name text, invite_role user_role, invite_phone text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  addr text := lower(trim(coalesce(invite_email, '')));
  nm text := trim(coalesce(invite_name, ''));
  iid uuid;
begin
  if not staff_can('create_users') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if invite_role in ('admin', 'assistant') and not is_admin() then
    raise exception 'Only an admin can invite staff' using errcode = '42501';
  end if;
  if addr !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address' using errcode = '22023'; end if;
  if nm = '' then raise exception 'Enter their name' using errcode = '22023'; end if;
  if exists (select 1 from profiles p where lower(p.email) = addr) then
    raise exception 'That email is already registered' using errcode = '22023';
  end if;
  -- An invitation that ran out is replaced by the new one.
  update account_invitations set revoked_at = now()
  where email = addr and accepted_at is null and revoked_at is null and expires_at <= now();
  if exists (select 1 from account_invitations where email = addr and accepted_at is null and revoked_at is null) then
    raise exception 'That email has already been invited' using errcode = '22023';
  end if;
  insert into account_invitations (email, full_name, phone, role, invited_by)
  values (addr, nm, left(trim(coalesce(invite_phone, '')), 32), invite_role, auth.uid())
  returning id into iid;
  perform audit_event('Invited user', nm || ' (' || invite_role || ') · ' || addr, 'invitation', iid::text);
  insert into notification_deliveries (channel, to_address, subject, body, link)
  values ('email', addr, 'You have been invited to mCare',
    'Hello ' || nm || ', ' || coalesce(name_of(auth.uid()), 'the mCare team') || ' has registered you on mCare as '
      || case invite_role when 'patient' then 'a patient' when 'doctor' then 'a doctor' when 'admin' then 'an administrator' else 'an mCare assistant' end
      || '. Open mCare and sign up with this email address (' || addr || ') to start. The invitation is valid for 14 days.',
    'signup');
  return iid;
end $$;


/* ─── How delivery is going ────────────────────────────────────────── */
/** For an administrator, or an assistant who may read the audit log: counts by channel and outcome, and the latest failures. */
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
revoke execute on function delivery_report(date, date) from public, anon;
grant execute on function delivery_report(date, date) to authenticated;


/* ─── The sender takes only the channels it can send ───────────────── */
/**
 * As claim_deliveries(), for the listed channels only. A sender with no SMS provider yet
 * leaves text messages waiting in the queue instead of failing them.
 */
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
revoke execute on function claim_deliveries_for(int, text[]) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_deliveries_for(int, text[]) to service_role;
  end if;
end $$;

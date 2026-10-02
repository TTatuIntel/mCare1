-- mCare delivery: every notification is also queued as an email.
--
-- A notification is written by the database with the change that caused it.
-- This adds the step after: a row in `notification_deliveries` for each one,
-- which a sender (outside the database) picks up, sends and marks. The queue
-- is what makes delivery honest: a message is `queued`, `sent` or `failed`
-- with the reason, and is retried a few times; nothing is assumed delivered.
--
-- The sender is the only thing that needs a mail provider. The local backend
-- prints each email instead of sending it. On hosted Supabase the Edge Function
-- in supabase/functions/deliver sends through the provider whose key it is given.
-- Text messages (SMS) are not queued: no SMS provider is configured.


create table notification_deliveries (
  id              bigint generated always as identity primary key,
  notification_id uuid not null references notifications (id) on delete cascade,
  user_id         uuid not null references profiles (id) on delete cascade,
  channel         text not null default 'email' check (channel in ('email')),
  to_address      text not null,
  subject         text not null,
  body            text not null,
  urgent          boolean not null default false,
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts        int not null default 0,
  error           text,
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  sent_at         timestamptz
);
create index notification_deliveries_queue_idx on notification_deliveries (created_at) where status in ('queued', 'sending');

/** Queues the email twin of a notification, for an account that can still use mCare. */
create function queue_notification_delivery() returns trigger language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  select * into p from profiles where id = new.user_id;
  if p.email is null or p.status in ('suspended', 'deactivated') then return new; end if;
  insert into notification_deliveries (notification_id, user_id, to_address, subject, body, urgent)
  values (new.id, new.user_id, p.email, new.title, new.body, new.kind in ('sos', 'escalation', 'alert'));
  return new;
end $$;
create trigger zz_queue_delivery after insert on notifications for each row execute function queue_notification_delivery();

-- Nobody reads or writes the queue through the app: only the sender, with the service key.
alter table notification_deliveries enable row level security;

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

/** The sender reports how one email went. A failure is retried, up to five attempts in all. */
create function finish_delivery(delivery bigint, ok boolean, problem text default null) returns void
language sql security definer set search_path = public as $$
  update notification_deliveries set
    status = case when ok then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
    sent_at = case when ok then now() end,
    error = case when ok then null else left(coalesce(problem, 'Unknown error'), 500) end
  where id = delivery and status = 'sending'
$$;

revoke execute on function claim_deliveries(int) from public, anon, authenticated;
revoke execute on function finish_delivery(bigint, boolean, text) from public, anon, authenticated;

-- The sender signs in with the service key. (The role exists on hosted Supabase; the local backend runs the sender as the owner.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_deliveries(int), finish_delivery(bigint, boolean, text) to service_role;
  end if;
end $$;

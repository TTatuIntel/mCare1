-- mCare messaging: a message notification opens the conversation it belongs to.
--
-- Every portal now has the same Messages screen. The notification of a new
-- message therefore points at that screen ('messages') for a doctor as it
-- already did for a patient, and says whose conversation it is, so a tap
-- lands in the thread rather than on a list.
--
-- Who may write to whom is unchanged: a patient and the doctor who treats
-- them, and nobody else can read what they say.

create or replace function message_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform notify_about(new.to_id, 'message', 'New message from ' || coalesce(name_of(new.from_id), 'mCare'), left(new.content, 80),
    'messages', 'conversation', new.from_id::text);
  return new;
end $$;

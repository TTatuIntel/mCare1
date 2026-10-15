-- Let each person delete their own notifications once they have read them; unread ones stay until read.
-- What was sent by email, SMS or push stays in the delivery record (it keeps its own copy), only unlinked.
alter table notification_deliveries drop constraint notification_deliveries_notification_id_fkey;
alter table notification_deliveries add constraint notification_deliveries_notification_id_fkey
  foreign key (notification_id) references notifications (id) on delete set null;

create policy notifications_clear on notifications for delete to authenticated using (user_id = auth.uid() and read);

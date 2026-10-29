-- 0018: a changed password is audited and the person is told (in the app and by email, through the delivery queue),
-- whether they changed it in Profile or by a reset link or code; "if this was not you" points them to a reset.

create function password_changed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password and exists (select 1 from profiles where id = new.id) then
    perform audit_event('Password changed', 'A new password was set for this account', 'account', new.id::text, null, null, null, new.id);
    perform notify_user(new.id, 'account', 'Your password was changed',
      'Your mCare password was just changed. If this was not you, reset it now from the sign-in page (Forgot password?) and contact mCare support.',
      'profile');
  end if;
  return new;
end $$;
revoke execute on function password_changed() from public, anon, authenticated;

create trigger on_auth_password_changed after update of encrypted_password on auth.users
  for each row execute function password_changed();

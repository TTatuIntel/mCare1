-- A new patient may skip the first-run health-profile setup and finish it later.
-- 'skipped' lets them into the portal, which keeps reminding them until it is 'done'.
alter table patients drop constraint patients_profile_setup_check;
alter table patients add constraint patients_profile_setup_check
  check (profile_setup in ('pending', 'skipped', 'done'));

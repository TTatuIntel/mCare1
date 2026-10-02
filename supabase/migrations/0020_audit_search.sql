-- mCare audit search: find an entry anywhere in the trail, not only in what a screen has loaded.
--
-- The audit screen used to filter the newest few hundred entries in the browser,
-- so an older entry could not be found by searching. This searches the whole
-- trail in the database: by words in the action or detail, by the name of the
-- person who did it, and by the kind of person. It returns one page, newest
-- first; `before` is the id of the oldest entry already shown.
--
-- It runs as the caller, so the row rule on audit_log still decides who may
-- read the trail at all ("View audit logs").

create function search_audit(q text default null, who text default null, before bigint default null, page_size int default 100)
returns setof audit_log language sql stable set search_path = public as $$
  select a.* from audit_log a
  where (before is null or a.id < before)
    and (coalesce(who, 'all') = 'all'
      or (who = 'system' and a.actor_role is null)
      or (who = 'staff' and a.actor_role in ('admin', 'assistant'))
      or (who in ('patient', 'doctor') and a.actor_role::text = who))
    and (nullif(trim(coalesce(q, '')), '') is null
      or a.action ilike '%' || trim(q) || '%'
      or a.detail ilike '%' || trim(q) || '%'
      or exists (select 1 from profiles p where p.id = a.actor_id and p.full_name ilike '%' || trim(q) || '%'))
  order by a.id desc
  limit greatest(1, least(coalesce(page_size, 100), 300))
$$;
revoke execute on function search_audit(text, text, bigint, int) from public, anon;
grant execute on function search_audit(text, text, bigint, int) to authenticated;

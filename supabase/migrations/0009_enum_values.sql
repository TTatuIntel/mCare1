/* ─── New values for existing types ──────────────────────────────────
   Postgres cannot use a new enum value in the transaction that adds it,
   so the values the next migrations need are added here, on their own. */

alter type account_status add value if not exists 'deactivated';   -- the person closed their own account (0011)
alter type notif_kind     add value if not exists 'care_plan';     -- a care plan was started or changed (0012)
alter type notif_kind     add value if not exists 'support';       -- a support request, for the people who handle them (0014)

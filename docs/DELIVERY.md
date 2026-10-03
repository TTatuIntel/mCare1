# Notifications and delivery

Every notification appears in the app. mCare can also send it by email, text message and push. Code: `0008_messages_delivery.sql` (queue), `supabase/functions/deliver/index.ts` (hosted sender), `supabase/dev/server.mjs` `deliverQueued()` (local sender), `src/shared/lib/push.ts` + `public/sw.js` (push on the device), `src/shared/profile/NotificationsSheet.tsx` (the person's choices).

## How it works

1. The database writes the notification in the same transaction as the change that caused it (`notify_user`, `notify_about`, `notify_care_team`, `notify_staff` in `0002_helpers.sql`).
2. A trigger (`zz_queue_delivery` → `queue_notification_delivery()`) queues one row per channel in `notification_deliveries`:
   - **Email**: every notification.
   - **Text message**: only what cannot wait (`sms_worthy()`): an SOS, an escalation, a critical reading.
   - **Push**: every notification, once for each device the person allowed (`push_subscriptions`).
   - Nothing is queued for a channel the person switched off (Profile → Notifications: `profiles.notify_email`, `notify_sms`, `notify_push`), or for a suspended or deactivated account.
   - Someone registered in advance gets an invitation email telling them to sign up.
3. A **sender** outside the database takes a batch (`claim_deliveries_for()`, service key only), sends each one and reports back (`finish_delivery()`). A failure goes back in the queue and is marked `failed` with the reason after five attempts. A push device the browser has withdrawn is forgotten (`forget_push_subscription()`).
4. Admins see the counts and the latest failures (never an address or a message) in Reports → *Messages sent outside the app* (`delivery_report()`).

A channel whose provider is not configured is **left waiting in the queue**, untouched. Nothing is lost while providers are being chosen; once one is configured, what was waiting goes out, urgent first.

| Where | Sender | What it does |
| --- | --- | --- |
| Local backend (`npm run backend`) | built into `supabase/dev/server.mjs`, every 10 s | Prints every email, text and push in its terminal. Nothing is sent. |
| Hosted Supabase | Edge Function `supabase/functions/deliver` | Sends through the providers below. |

Never send from a screen. In-app email previews (`src/shared/email/Mailbox.tsx`, demo mode) are built only by `src/shared/email/emailTemplate.ts`.

## Configuring the hosted sender

Set the secrets for the providers you have, deploy, and call the function every minute.

```sh
supabase secrets set MCARE_APP_URL=https://your-mcare-address
# Email (Resend)
supabase secrets set MCARE_EMAIL_PROVIDER=resend RESEND_API_KEY=… MCARE_MAIL_FROM="mCare <no-reply@your-domain>"
# Text messages: Africa's Talking …
supabase secrets set MCARE_SMS_PROVIDER=africastalking AT_USERNAME=… AT_API_KEY=… AT_SENDER_ID=…   # sender id optional
# … or Twilio
supabase secrets set MCARE_SMS_PROVIDER=twilio TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… TWILIO_FROM=+1…
# Push (Web Push): generate a key pair once with  npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:support@your-domain

supabase functions deploy deliver --no-verify-jwt
```

Run it every minute with the service key (it refuses any other caller), for example from the database with `pg_cron` and `pg_net`:

```sql
select cron.schedule('mcare-deliver', '* * * * *', $$
  select net.http_post(url := 'https://<project>.supabase.co/functions/v1/deliver',
                       headers := jsonb_build_object('Authorization', 'Bearer <service role key>'))
$$);
```

For push, the app also needs the **public** key in its build environment: `VITE_VAPID_PUBLIC_KEY=<the same VAPID_PUBLIC_KEY>`. Push needs the app on an https address (or `localhost`). Without the key, Profile → Notifications says push is not set up yet and offers nothing to switch on.

## Another provider

Each channel's provider is one small function in `supabase/functions/deliver/index.ts` (`emailSender`, `smsSender`, `pushSender`). To use another mail or SMS service, add a branch there that sends one message and returns `{ problem: null }` when it was accepted, or `{ problem: '<why>' }` when it was not. Nothing else changes.

## Adding a notification

Notifications are written by the database, never by a screen in live mode. In the trigger or function that makes the change, call `notify_user(<person>, '<kind>', '<title>', '<body>', '<screen link>')` (or `notify_about(...)` with a resource type and id so a tap opens that record). `<kind>` is one of `NotifKind` in `src/shared/lib/types.ts` (`alert`, `sos`, `message`, `appointment`, `assignment`, `prescription`, `account`, `escalation`, `document`, `care_plan`, `support`); a new kind needs adding there and to the database enum in a new migration (`alter type notif_kind add value '<kind>';`). To make it text-message-worthy, change `sms_worthy()` in a new migration. Demo mode mirrors the same notification with `notify(...)` inside the `AppContext` action.

## Not yet verified

The queue, the choices, the invitation email and the delivery report are tested (`npm test`), and the local sender is exercised by the browser tests. The calls to Resend, Africa's Talking, Twilio and Web Push are written to their published APIs and **have not been run**: no provider keys or hosted project were available. Try one message per channel after configuring.

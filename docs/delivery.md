# Email, text messages and push: how mCare reaches people outside the app

Every notification appears in the app. mCare can also send it by email, by text message and as a push notification. This page says how that works and what to configure when the providers are chosen.

## How it works

1. The database writes the notification, in the same transaction as the change that caused it.
2. A trigger queues one row per channel in `notification_deliveries` (migrations `0019`, `0021`):
   - **Email**: every notification.
   - **Text message**: only what cannot wait: an SOS, an escalation, a critical reading.
   - **Push**: every notification, once for each device the person allowed (`push_subscriptions`).
   - Nothing is queued for a channel the person switched off (Profile → Notifications), or for a suspended or deactivated account.
   - Someone registered in advance gets an invitation email telling them to sign up.
3. A **sender** outside the database takes a batch (`claim_deliveries_for`), sends each one and reports back (`finish_delivery`). A failure goes back in the queue and is marked `failed` with the reason after five attempts. A push device the browser has withdrawn is forgotten.
4. Admins see the counts, and the latest failures (never an address or a message), in Reports → *Messages sent outside the app*.

A channel whose provider is not configured is **left waiting in the queue**, untouched. Nothing is lost while providers are being chosen; once one is configured, what was waiting goes out (urgent first).

## The two senders

| Where | Sender | What it does |
| --- | --- | --- |
| Local backend (`npm run backend`) | built into `supabase/dev/server.mjs`, every 10 s | Prints every email, text and push in its terminal. Nothing is sent. |
| Hosted Supabase | Edge Function `supabase/functions/deliver` | Sends through the providers below. |

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

For push, the app also needs the **public** key, in the build environment:

```
VITE_VAPID_PUBLIC_KEY=<the same VAPID_PUBLIC_KEY>
```

Push needs the app on an https address (or `localhost`). Without the key, Profile → Notifications says push is not set up yet and offers nothing to switch on.

## Another provider

Each channel's provider is one small function in `supabase/functions/deliver/index.ts` (`emailSender`, `smsSender`, `pushSender`). To use another mail or SMS service, add a branch there that sends one message and returns `{ problem: null }` when it was accepted, or `{ problem: '<why>' }` when it was not. Nothing else changes.

## Not yet verified

The queue, the choices, the invitation email and the delivery report are tested (`npm test`), and the local sender is exercised by the browser tests. The calls to Resend, Africa's Talking, Twilio and Web Push were written to their published APIs and **have not been run**: no provider keys or hosted project were available. Try one message per channel after configuring.

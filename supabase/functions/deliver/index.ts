/**
 * mCare sender (Supabase Edge Function, hosted projects).
 *
 * Takes what is waiting in `notification_deliveries` (supabase/migrations/0008_messages_delivery.sql),
 * sends each one through the provider configured for its channel, and reports
 * to the database how it went. The queue does the bookkeeping: a failure goes
 * back to be retried, and is marked failed after five attempts.
 *
 * A channel whose provider is not configured is left waiting in the queue,
 * untouched, so nothing is lost while a provider is being chosen.
 *
 * NOT YET RUN AGAINST A HOSTED PROJECT OR A REAL PROVIDER. The queue it works is
 * tested; the calls to the providers are written to their published APIs and
 * must be tried once the keys exist. Setup: docs/DELIVERY.md.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const env = (k: string) => Deno.env.get(k)?.trim() ?? ''
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const APP_URL = env('MCARE_APP_URL')

type Delivery = {
  id: number; channel: 'email' | 'sms' | 'push'; to_address: string; subject: string; body: string
  urgent: boolean; link: string | null; subscription_id: string | null
}
/** What a provider says about one message: nothing (sent), or why not. `gone` means the address will never work again. */
type Result = { problem: string | null; gone?: boolean }
type Sender = (d: Delivery) => Promise<Result>

const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const failed = async (res: Response): Promise<Result> => (res.ok ? { problem: null } : { problem: `${res.status} ${(await res.text()).slice(0, 300)}` })

/* ─── Email ───────────────────────────────────────────────────────────
   MCARE_EMAIL_PROVIDER = resend (RESEND_API_KEY)
   MCARE_MAIL_FROM      = "mCare <no-reply@your-domain>" */
function html(d: Delivery) {
  const accent = d.urgent ? '#dc2626' : '#0f766e'
  const url = APP_URL && (d.link === 'signup' ? `${APP_URL}` : APP_URL)
  return `<div style="font-family:system-ui,sans-serif;max-width:32rem;margin:auto;padding:1.5rem;color:#111827">
  <p style="font-weight:800;color:${accent};margin:0 0 1rem">mCare</p>
  <h1 style="font-size:1.125rem;margin:0 0 .5rem">${escape(d.subject)}</h1>
  ${d.body ? `<p style="font-size:.9375rem;line-height:1.5;margin:0 0 1rem">${escape(d.body)}</p>` : ''}
  ${url ? `<p><a href="${escape(url)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:700;padding:.625rem 1rem;border-radius:.75rem">${d.link === 'signup' ? 'Sign up to mCare' : 'Open mCare'}</a></p>` : ''}
  <p style="font-size:.75rem;color:#6b7280;margin-top:1.5rem">You are receiving this because of your mCare account. You can choose which messages you get in mCare, under Profile → Notifications. In an emergency, call your local emergency number.</p>
</div>`
}
function emailSender(): Sender | null {
  const from = env('MCARE_MAIL_FROM')
  if (env('MCARE_EMAIL_PROVIDER') === 'resend' && env('RESEND_API_KEY') && from) {
    return async d => failed(await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [d.to_address], subject: d.subject, html: html(d), text: `${d.subject}\n\n${d.body}${APP_URL ? `\n\n${APP_URL}` : ''}` }),
    }))
  }
  return null
}

/* ─── Text messages ───────────────────────────────────────────────────
   MCARE_SMS_PROVIDER = africastalking (AT_USERNAME, AT_API_KEY, optional AT_SENDER_ID)
                      | twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)
   Only what cannot wait is queued as SMS (an SOS, an escalation, a critical reading). */
const smsText = (d: Delivery) => `mCare: ${d.subject}${d.body ? `. ${d.body}` : ''}`.slice(0, 300)
function smsSender(): Sender | null {
  const provider = env('MCARE_SMS_PROVIDER')
  if (provider === 'africastalking' && env('AT_USERNAME') && env('AT_API_KEY')) {
    return async d => {
      const form = new URLSearchParams({ username: env('AT_USERNAME'), to: d.to_address, message: smsText(d) })
      if (env('AT_SENDER_ID')) form.set('from', env('AT_SENDER_ID'))
      const res = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST', headers: { apiKey: env('AT_API_KEY'), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
      })
      if (!res.ok) return failed(res)
      // A 200 can still carry a refusal for the number.
      const status = (await res.json())?.SMSMessageData?.Recipients?.[0]?.status
      return status === 'Success' ? { problem: null } : { problem: `Africa's Talking: ${status ?? 'no recipient in the answer'}` }
    }
  }
  if (provider === 'twilio' && env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM')) {
    const sid = env('TWILIO_ACCOUNT_SID')
    return async d => failed(await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${sid}:${env('TWILIO_AUTH_TOKEN')}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: d.to_address, From: env('TWILIO_FROM'), Body: smsText(d) }),
    }))
  }
  return null
}

/* ─── Push ────────────────────────────────────────────────────────────
   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:… or https://…).
   The same public key goes to the app as VITE_VAPID_PUBLIC_KEY. */
function pushSender(db: ReturnType<typeof createClient>): Sender | null {
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY') || !env('VAPID_SUBJECT')) return null
  webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'))
  return async d => {
    const { data: s } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').eq('id', d.subscription_id).maybeSingle()
    if (!s) return { problem: 'The device no longer accepts notifications', gone: true }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: d.subject, body: d.body, link: d.link, urgent: d.urgent }), { TTL: d.urgent ? 3600 : 86400, urgency: d.urgent ? 'high' : 'normal' })
      await db.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', d.subscription_id)
      return { problem: null }
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      // 404 and 410: the browser withdrew this subscription for good.
      return { problem: `Push ${status ?? ''} ${String((e as Error)?.message ?? e).slice(0, 200)}`.trim(), gone: status === 404 || status === 410 }
    }
  }
}

Deno.serve(async req => {
  if (!SERVICE_KEY || req.headers.get('Authorization') !== `Bearer ${SERVICE_KEY}`) return new Response('Forbidden', { status: 403 })
  const db = createClient(env('SUPABASE_URL'), SERVICE_KEY, { auth: { persistSession: false } })
  const senders: Partial<Record<Delivery['channel'], Sender>> = {}
  const email = emailSender(), sms = smsSender(), push = pushSender(db)
  if (email) senders.email = email
  if (sms) senders.sms = sms
  if (push) senders.push = push
  const channels = Object.keys(senders)
  if (!channels.length) return Response.json({ sent: 0, failed: 0, waiting: 'No provider is configured yet: everything stays in the queue.' })

  const { data: batch, error } = await db.rpc('claim_deliveries_for', { batch: 50, channels })
  if (error) return new Response(error.message, { status: 500 })

  let sent = 0, bad = 0
  for (const d of (batch ?? []) as Delivery[]) {
    let r: Result
    try { r = await senders[d.channel]!(d) } catch (e) { r = { problem: String((e as Error)?.message ?? e) } }
    if (r.gone && d.subscription_id) await db.rpc('forget_push_subscription', { subscription: d.subscription_id })
    await db.rpc('finish_delivery', { delivery: d.id, ok: r.problem === null, problem: r.problem })
    r.problem === null ? sent++ : bad++
  }
  return Response.json({ sent, failed: bad, channels })
})

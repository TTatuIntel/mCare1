/**
 * mCare email sender (Supabase Edge Function, hosted projects).
 *
 * Takes what is waiting in `notification_deliveries` (migration 0019), sends
 * each email through Resend, and reports to the database how each one went.
 * The queue does the bookkeeping: a failure goes back to be retried, and is
 * marked failed after five attempts.
 *
 * NOT YET RUN AGAINST A HOSTED PROJECT: it was written without one to test on.
 * The queue it works (claim_deliveries / finish_delivery) is tested; the call
 * to the mail provider is not.
 *
 * Setup:
 *   supabase secrets set RESEND_API_KEY=…  MCARE_MAIL_FROM="mCare <no-reply@your-domain>"  MCARE_APP_URL=https://your-app
 *   supabase functions deploy deliver --no-verify-jwt
 *   then call it every minute (pg_cron + pg_net, or the dashboard's scheduler), with the header
 *   Authorization: Bearer <service role key>. Any other caller is refused.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM = Deno.env.get('MCARE_MAIL_FROM') ?? ''
const APP_URL = Deno.env.get('MCARE_APP_URL') ?? ''

const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** A plain, readable email. The body never carries clinical detail beyond what the in-app notification shows. */
function html(subject: string, body: string, urgent: boolean) {
  const accent = urgent ? '#dc2626' : '#0f766e'
  return `<div style="font-family:system-ui,sans-serif;max-width:32rem;margin:auto;padding:1.5rem;color:#111827">
  <p style="font-weight:800;color:${accent};margin:0 0 1rem">mCare</p>
  <h1 style="font-size:1.125rem;margin:0 0 .5rem">${escape(subject)}</h1>
  ${body ? `<p style="font-size:.9375rem;line-height:1.5;margin:0 0 1rem">${escape(body)}</p>` : ''}
  ${APP_URL ? `<p><a href="${escape(APP_URL)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:700;padding:.625rem 1rem;border-radius:.75rem">Open mCare</a></p>` : ''}
  <p style="font-size:.75rem;color:#6b7280;margin-top:1.5rem">You are receiving this because of activity on your mCare account. In an emergency, call your local emergency number.</p>
</div>`
}

Deno.serve(async req => {
  if (!SERVICE_KEY || req.headers.get('Authorization') !== `Bearer ${SERVICE_KEY}`) return new Response('Forbidden', { status: 403 })
  if (!RESEND_KEY || !FROM) return new Response('RESEND_API_KEY and MCARE_MAIL_FROM must be set', { status: 500 })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: batch, error } = await db.rpc('claim_deliveries', { batch: 20 })
  if (error) return new Response(error.message, { status: 500 })

  let sent = 0, failed = 0
  for (const d of batch ?? []) {
    let problem: string | null = null
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [d.to_address], subject: d.subject, html: html(d.subject, d.body, d.urgent) }),
      })
      if (!res.ok) problem = `${res.status} ${(await res.text()).slice(0, 300)}`
    } catch (e) { problem = String((e as Error)?.message ?? e) }
    await db.rpc('finish_delivery', { delivery: d.id, ok: problem === null, problem })
    problem === null ? sent++ : failed++
  }
  return Response.json({ sent, failed })
})

/**
 * mCare messages — the one design every outgoing email uses, plus the text
 * messages sent to phones.
 *
 *   Email → the link and the one-time code together, so either works.
 *   SMS   → the one-time code only (no links in texts: they are a phishing risk).
 *
 * Emails are written for real inboxes: table layout, inline styles, no
 * scripts, the logo as a hosted image (mail apps strip inline SVG). Type uses
 * the reader's own device font, and the design follows their light/dark mode.
 *
 * Everything here is pure. When the mail/SMS backend arrives it calls the
 * same builders and sends `html` + `text` (email) or the string (SMS).
 */
import type { EmailContent, NotifKind } from '@/shared/lib/types'
import { RESET_TTL_MIN } from '@/shared/lib/types'
import { BRAND_TEAL, BRAND_VIOLET } from '@/shared/layout/brand'

/** The logo file in /public, rendered from the app's own mark (Fraunces wordmark + ECG trace). */
export const EMAIL_LOGO_PATH = 'brand/mcare-logo.png'
const LOGO_W = 104, LOGO_H = 58
export const EMAIL_FROM = 'mCare <no-reply@mcare.app>'
export const SMS_FROM = 'mCare'

/** Where the app is served — used for the logo and for links back into mCare. */
export function appBaseUrl(): string {
  if (typeof window === 'undefined') return 'https://mcare.app/'
  return new URL(import.meta.env?.BASE_URL ?? '/', window.location.origin).href
}

/** Token behind the "verify my email" link. Tied to the current code, so a resend retires the old link. */
export function activationToken(userId: string, code: string): string {
  let a = 0x811c9dc5, b = 0x01000193
  for (const ch of `${userId}:${code}:mcare-activate`) {
    a = Math.imul(a ^ ch.charCodeAt(0), 0x01000193) >>> 0
    b = Math.imul(b + ch.charCodeAt(0), 0x85ebca6b) >>> 0
  }
  return a.toString(36) + b.toString(36)
}
export const activationLink = (userId: string, code: string, baseUrl = appBaseUrl()) =>
  `${baseUrl}?verify=${encodeURIComponent(userId)}.${activationToken(userId, code)}`

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
/** The reader's own device font: San Francisco on Apple, Segoe UI on Windows, Roboto on Android. */
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`
const MONO = `ui-monospace,SFMono-Regular,'SF Mono','Cascadia Mono','Roboto Mono',Menlo,Consolas,monospace`

/** Dark mode and small screens, for mail apps that honour <style>. Inline styles are the light default. */
const STYLE = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
  .bg{background:#0b1215!important}.card{background:#141d21!important;border-color:#24323a!important}
  .h{color:#f1f5f9!important}.t{color:#cbd5e1!important}.m{color:#8fa1ad!important}
  .panel{background:#0f171b!important;border-color:#24323a!important}
  .d{background:#141d21!important;border-color:#2b3b44!important;color:#f1f5f9!important}
  .tag{background:#10302d!important;color:#5eead4!important}.tag-u{background:#3a1616!important;color:#fca5a5!important}
  .logo{background:#f8fafb!important;border-radius:16px!important;padding:8px 16px!important}.rule{border-color:#24323a!important}.btn{background:#14b8a6!important}.btn a{color:#04201d!important}.lnk{color:#5eead4!important}
}
@media (max-width:480px){.pad{padding-left:20px!important;padding-right:20px!important}.panel{padding:16px 10px!important}.dc{padding:0 2px!important}.d{width:38px!important;height:48px!important;font-size:22px!important;line-height:48px!important}.h{font-size:23px!important}}`

/** The small label over the heading: what kind of email this is, at a glance. */
const TAG: Record<EmailContent['kind'], string> = {
  verification: 'Confirm your email',
  invitation: 'Invitation',
  password_reset: 'Account security',
  password_changed: 'Account security',
  welcome: 'Welcome',
  notification: 'Notification',
}
const URGENT_RED = '#dc2626'

export interface RenderedEmail { subject: string; html: string; text: string }

export function renderEmail(c: EmailContent, opts: { baseUrl?: string } = {}): RenderedEmail {
  const base = opts.baseUrl ?? appBaseUrl()
  const logo = `${base}${EMAIL_LOGO_PATH}`
  const urgent = c.tone === 'urgent'
  const p = (t: string) => `<p class="t" style="margin:0 0 12px;font:400 16px/1.6 ${FONT};color:#475569">${esc(t)}</p>`

  // The strip across the top of the card: the brand colours, or red when it can't wait.
  const strip = urgent
    ? `<td bgcolor="${URGENT_RED}" style="background:${URGENT_RED};height:6px;font-size:0;line-height:0">&nbsp;</td>`
    : `<td bgcolor="${BRAND_TEAL}" style="background:${BRAND_TEAL};background:linear-gradient(90deg,${BRAND_TEAL},#14b8a6 45%,${BRAND_VIOLET});height:6px;font-size:0;line-height:0">&nbsp;</td>`

  const tag = `<span class="${urgent ? 'tag-u' : 'tag'}" style="display:inline-block;padding:6px 12px;border-radius:999px;background:${urgent ? '#fef2f2' : '#f0fdfa'};font:700 11px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${urgent ? '#b91c1c' : BRAND_TEAL}">${esc(urgent ? 'Urgent' : TAG[c.kind])}</span>`

  // A pill like the buttons in the app: as wide as its label, centred.
  const action = c.action ? `
<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto 0"><tr><td class="btn" align="center" bgcolor="${BRAND_TEAL}" style="background:${BRAND_TEAL};border-radius:999px">
  <a href="${esc(c.action.url)}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 30px;font:700 16px/1.2 ${FONT};color:#ffffff;text-decoration:none;border-radius:999px">${esc(c.action.label)}&nbsp;&nbsp;&rarr;</a>
</td></tr></table>` : ''

  // Each digit in its own tile, easy to read and to type across.
  const code = c.code ? `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0"><tr><td class="panel" align="center" style="background:#f6f9f9;border:1px solid #e5eaee;border-radius:18px;padding:18px 16px">
  <div class="m" style="font:600 12px/1 ${FONT};letter-spacing:.04em;text-transform:uppercase;color:#64748b;margin:0 0 12px">${esc(c.code.label)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" align="center" aria-label="${esc(c.code.value)}"><tr>
    ${[...c.code.value].map(ch => `<td class="dc" style="padding:0 3px"><div class="d" style="width:44px;height:54px;border:1px solid #dbe3e8;border-radius:12px;background:#ffffff;font:700 26px/54px ${MONO};color:#0f172a;text-align:center">${esc(ch)}</div></td>`).join('')}
  </tr></table>
  ${c.code.expires ? `<div class="m" style="font:400 13px/1.4 ${FONT};color:#64748b;margin-top:12px">${esc(c.code.expires)}</div>` : ''}
</td></tr></table>` : ''

  // For mail apps that drop the button: the same link, spelled out.
  const fallback = c.action && c.code ? `
<p class="m" style="margin:18px 0 0;font:400 12px/1.6 ${FONT};color:#94a3b8;text-align:center">Button not working? Paste this link into your browser:<br>
<a class="lnk" href="${esc(c.action.url)}" target="_blank" rel="noopener" style="color:${BRAND_TEAL};word-break:break-all">${esc(c.action.url)}</a></p>` : ''

  const security = c.security ? `
  <tr><td class="pad" style="padding:0 32px 28px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="panel m" style="background:#f6f9f9;border:1px solid #e5eaee;border-left:3px solid ${urgent ? URGENT_RED : BRAND_TEAL};border-radius:12px;padding:12px 14px;font:400 13px/1.5 ${FONT};color:#64748b">${esc(c.security)}</td>
    </tr></table>
  </td></tr>` : ''

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(c.subject)}</title><style>${STYLE}</style></head>
<body class="bg" style="margin:0;padding:0;background:#eef3f3;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(c.preheader ?? c.lines[0] ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" bgcolor="#eef3f3" style="background:#eef3f3"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" bgcolor="#ffffff" style="max-width:480px;background:#ffffff;border:1px solid #e5eaee;border-radius:24px;border-collapse:separate;overflow:hidden">
  <tr>${strip}</tr>
  <tr><td class="pad" align="center" style="padding:28px 32px 0">
    <img src="${esc(logo)}" width="${LOGO_W}" height="${LOGO_H}" alt="mCare" class="logo" style="display:block;margin:0 auto;border:0;outline:none;font:700 28px/1 ${FONT};color:${BRAND_VIOLET}">
  </td></tr>
  <tr><td class="pad" align="center" style="padding:20px 32px 28px;text-align:center">
    ${tag}
    <h1 class="h" style="margin:14px 0 10px;font:800 26px/1.2 ${FONT};letter-spacing:-.02em;color:#0f172a">${esc(c.heading)}</h1>
    ${c.lines.map(p).join('')}
    ${action}${code}${fallback}
    ${(c.after ?? []).map(l => `<p class="t" style="margin:18px 0 0;font:400 14px/1.5 ${FONT};color:#475569">${esc(l)}</p>`).join('')}
  </td></tr>${security}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
  <tr><td align="center" class="m" style="padding:20px 16px 0;font:400 12px/1.7 ${FONT};color:#94a3b8">
    <span style="font-weight:700;font-size:14px"><span style="color:${BRAND_TEAL}">m</span><span style="color:${BRAND_VIOLET}">Care</span></span> · Your health, our priority<br>
    Sent to ${esc(c.to)}. This is an automated message, so replies aren’t read.<br>
    &copy; ${new Date().getFullYear()} mCare
  </td></tr>
</table>
</td></tr></table>
</body></html>`

  const text = [
    c.heading, '', ...c.lines, '',
    ...(c.action ? [`${c.action.label}: ${c.action.url}`, ''] : []),
    ...(c.code ? [`${c.code.label}: ${c.code.value}${c.code.expires ? ` (${c.code.expires})` : ''}`, ''] : []),
    ...(c.after ?? []), ...(c.security ? [c.security] : []),
    '', `mCare · Sent to ${c.to}`,
  ].join('\n')

  return { subject: c.subject, html, text }
}

/* ─── Email catalogue: every email mCare sends ─────────────────────── */
type To = { name: string; email: string }
const first = (u: To) => u.name.split(' ')[0]
const NOT_YOU = 'Didn’t ask for this? Ignore this email. Never share your code.'

export const emails = {
  /** New account, or "resend": the activation link and the code together. */
  verification: (u: To, code: string, link: string): EmailContent => ({
    to: u.email, kind: 'verification', subject: 'Verify your mCare email',
    preheader: `Tap the link or enter ${code}.`,
    heading: 'Verify your email', lines: [`Hi ${first(u)}, tap the button to activate your account.`],
    action: { label: 'Verify my email', url: link },
    code: { label: 'or enter this code', value: code },
    security: NOT_YOU,
  }),

  /** An admin created the account on the person's behalf. */
  invitation: (u: To, code: string, link: string): EmailContent => ({
    to: u.email, kind: 'invitation', subject: 'You’re invited to mCare',
    preheader: 'Activate your account to get started.',
    heading: 'You’re invited to mCare', lines: [`Hi ${first(u)}, your account is ready. Activate it to get started.`],
    action: { label: 'Activate my account', url: link },
    code: { label: 'or sign in with this code', value: code },
    after: ['The code is also your temporary password.'],
    security: 'Not expecting this? Ignore this email.',
  }),

  /** Forgot password, or the extra check before changing a password in the app. */
  passwordReset: (u: To, code: string, link: string): EmailContent => ({
    to: u.email, kind: 'password_reset', subject: 'Reset your mCare password',
    preheader: `Tap the link or enter ${code}. Expires in ${RESET_TTL_MIN} minutes.`,
    heading: 'Reset your password', lines: [`Hi ${first(u)}, tap the button to choose a new password.`],
    action: { label: 'Reset password', url: link },
    code: { label: 'or enter this code', value: code, expires: `Expires in ${RESET_TTL_MIN} minutes` },
    security: NOT_YOU,
  }),

  passwordChanged: (u: To): EmailContent => ({
    to: u.email, kind: 'password_changed', subject: 'Your mCare password was changed',
    heading: 'Password changed', lines: [`Hi ${first(u)}, your password was just updated.`],
    security: 'Wasn’t you? Reset your password now and contact support.',
  }),

  welcome: (u: To, baseUrl = appBaseUrl()): EmailContent => ({
    to: u.email, kind: 'welcome', subject: 'Welcome to mCare',
    heading: `Welcome, ${first(u)}`, lines: ['Your account is active.'],
    action: { label: 'Open mCare', url: baseUrl },
  }),

  /**
   * The email twin of an in-app notification. Clinical details stay inside
   * mCare: for anything about health, the email only says something is waiting.
   */
  notification: (u: To, kind: NotifKind, title: string, body: string, baseUrl = appBaseUrl()): EmailContent => {
    const PRIVATE: Partial<Record<NotifKind, [string, string]>> = {
      alert: ['New vital-sign alert', 'An alert needs your attention.'],
      sos: ['Urgent: SOS raised', 'An emergency needs your attention now.'],
      escalation: ['Alert escalated to you', 'An alert wasn’t acknowledged in time.'],
      message: ['New message', 'You have a new secure message.'],
      prescription: ['Prescription updated', 'Your medication has been updated.'],
      document: ['New document', 'A document is waiting in your library.'],
    }
    const priv = PRIVATE[kind]
    return {
      to: u.email, kind: 'notification', subject: priv ? `${priv[0]} · mCare` : title,
      tone: kind === 'sos' || kind === 'escalation' ? 'urgent' : undefined,
      heading: priv ? priv[0] : title, lines: [priv ? priv[1] : body],
      action: { label: 'Open mCare', url: baseUrl },
      security: priv ? 'For your privacy, details are only shown in the app.' : undefined,
    }
  },
}

/* ─── Text messages: the one-time code only ────────────────────────── */
export const sms = {
  verification: (code: string) => `${code} is your mCare verification code. Don't share it.`,
  passwordReset: (code: string) => `${code} is your mCare password reset code. Expires in ${RESET_TTL_MIN} min. Don't share it.`,
}

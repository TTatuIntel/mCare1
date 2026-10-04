/**
 * mCare clinical report template.
 *
 * One responsive design used everywhere a report is shown or exported:
 *   • print / Save as PDF — A4 page, repeating confidentiality footer, no browser headers
 *   • downloaded web page — the same page on a soft background
 *   • in-app reader        — `embedded`: reflows to phone width, no page chrome
 *
 * Every value is escaped; charts are inline SVG generated from the stored
 * series, so the file is self-contained and prints identically offline.
 */
import type { AppUser, DoctorUser, MedicalDocument, PatientUser, VitalsReportRow, DocBody, VitalsReportInclude } from '@/shared/lib/types'
import { calcAge } from '@/shared/lib/vitals'
import { EKG_PATH, BRAND_TEAL, BRAND_VIOLET } from '@/shared/layout/brand'
import { DOC_CATEGORIES, DEFAULT_REPORT_INCLUDE, fnv1a, isOfficial } from './documents'

export interface ReportContext {
  patient?: PatientUser
  author?: AppUser
  signer?: AppUser
  releaser?: AppUser
  /** The patient's current treating doctor, when different from the signer. */
  careDoctor?: AppUser
}
export interface RenderOptions {
  /** In-app reader: reflow to the container, drop page chrome. */
  embedded?: boolean
  zoom?: number
}

type VitalsBody = Extract<DocBody, { type: 'vitals' }>

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const fmtDay = (ms: number) => { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
const fmtShort = (ms: number) => { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]}` }
const ymd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : s }

/** Short, human-checkable code tying the signature to this exact document version. */
export function verificationCode(doc: MedicalDocument): string {
  const h = (fnv1a(`${doc.id}|${doc.signedBy}|${doc.signedAt}|${doc.version}`) + fnv1a(`${doc.version}|${doc.id}`)).toUpperCase()
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`
}
export const patientRef = (p?: PatientUser) => p ? `MC-${fnv1a(p.id).slice(0, 6).toUpperCase()}` : '—'
export const reportNo = (doc: MedicalDocument) => `RPT-${doc.id.replace(/^doc_/, '').slice(0, 8).toUpperCase()}`
const fmtTime = (ms: number) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
const SEX = { female: 'Female', male: 'Male', intersex: 'Intersex', undisclosed: 'Not stated' } as const
/** Only a PNG/JPEG data URL is ever placed in an image tag. */
const safeImg = (s?: string) => s && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : undefined

/** The mCare wordmark exactly as in the app — "m" in pulse teal, "Care" in brand violet, ECG trace beneath. */
const LOGO = `<div class="logo"><div class="word"><span style="color:${BRAND_TEAL}">m</span><span style="color:${BRAND_VIOLET}">Care</span></div>
<svg viewBox="0 0 200 40" class="trace" aria-hidden="true"><path d="${EKG_PATH}" fill="none" stroke="${BRAND_TEAL}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`

/* ─── Charts ───────────────────────────────────────────────────────── */
const LEVEL_COLOR = { normal: '#0a6e6e', warning: '#d97706', critical: '#dc2626' } as const

function sparkline(row: VitalsReportRow, periodStart?: number, periodEnd?: number): string {
  const pts = row.points ?? []
  if (pts.length < 2) return `<div class="nochart">${pts.length ? 'One reading — no trend yet' : 'No readings in period'}</div>`
  const W = 300, H = 70, L = 30, R = 8, T = 6, B = 15
  const tMin = row.targetMin ?? Math.min(...pts.map(p => p.v)), tMax = row.targetMax ?? Math.max(...pts.map(p => p.v))
  const all = [...pts.map(p => p.v), ...pts.flatMap(p => p.v2 !== undefined ? [p.v2] : []), tMin, tMax]
  const pad = (Math.max(...all) - Math.min(...all)) * 0.12 || 1
  const lo = Math.min(...all) - pad, hi = Math.max(...all) + pad
  const t0 = periodStart ?? pts[0].at, t1 = periodEnd ?? pts[pts.length - 1].at
  const x = (at: number) => L + ((at - t0) / Math.max(1, t1 - t0)) * (W - L - R)
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const line = (sel: (p: typeof pts[number]) => number | undefined) =>
    pts.filter(p => sel(p) !== undefined).map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(sel(p)!).toFixed(1)}`).join(' ')
  const n = (v: number) => Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10
  const hasDia = pts.some(p => p.v2 !== undefined)
  const last = pts[pts.length - 1]
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(row.name)} trend">
  <rect x="${L}" y="${y(tMax).toFixed(1)}" width="${W - L - R}" height="${Math.max(1, y(tMin) - y(tMax)).toFixed(1)}" fill="#10b981" opacity=".10"/>
  <line x1="${L}" x2="${W - R}" y1="${y(tMax).toFixed(1)}" y2="${y(tMax).toFixed(1)}" stroke="#10b981" stroke-dasharray="3 3" stroke-width=".8"/>
  <line x1="${L}" x2="${W - R}" y1="${y(tMin).toFixed(1)}" y2="${y(tMin).toFixed(1)}" stroke="#10b981" stroke-dasharray="3 3" stroke-width=".8"/>
  <text x="${L - 4}" y="${(y(tMax) + 3).toFixed(1)}" class="ax" text-anchor="end">${n(tMax)}</text>
  <text x="${L - 4}" y="${(y(tMin) + 3).toFixed(1)}" class="ax" text-anchor="end">${n(tMin)}</text>
  ${hasDia ? `<path d="${line(p => p.v2)}" fill="none" stroke="#6b93d6" stroke-width="1.4" stroke-linejoin="round"/>` : ''}
  <path d="${line(p => p.v)}" fill="none" stroke="#0a6e6e" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
  ${pts.map(p => p.level === 'normal' ? '' : `<circle cx="${x(p.at).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.4" fill="${LEVEL_COLOR[p.level]}"/>`).join('')}
  <circle cx="${x(last.at).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="3.4" fill="#fff" stroke="${LEVEL_COLOR[last.level]}" stroke-width="2"/>
  <text x="${L}" y="${H - 4}" class="ax">${fmtShort(t0)}</text>
  <text x="${W - R}" y="${H - 4}" class="ax" text-anchor="end">${fmtShort(t1)}</text>
</svg>${hasDia ? '<div class="legend"><i class="k sys"></i>Systolic <i class="k dia"></i>Diastolic <i class="k band"></i>Target</div>' : '<div class="legend"><i class="k sys"></i>Reading <i class="k band"></i>Target range</div>'}`
}

/* ─── Pieces ───────────────────────────────────────────────────────── */
const FLAG = {
  normal: ['ok', 'Within target'], warning: ['warn', 'Outside target'], critical: ['crit', 'Critical'], none: ['na', 'No data'],
} as const

function trendText(r: VitalsReportRow): string {
  if (!r.total) return 'No readings recorded in this period.'
  const dir = r.direction === 'rising' ? `Trending up (${r.change! > 0 ? '+' : ''}${r.change} ${r.unit})`
    : r.direction === 'falling' ? `Trending down (${r.change} ${r.unit})`
    : r.direction === 'steady' ? 'Stable over the period' : 'Too few readings to establish a trend'
  return `${dir} across ${r.total} reading${r.total === 1 ? '' : 's'}; ${Math.round((r.inRange / r.total) * 100)}% within target.`
}

function vitalCard(r: VitalsReportRow, b: VitalsBody): string {
  const [cls, label] = FLAG[r.level]
  const arrow = r.direction === 'rising' ? '↗' : r.direction === 'falling' ? '↘' : r.direction === 'steady' ? '→' : '·'
  return `<div class="vital">
  <div class="vhead"><span class="vname">${esc(r.name)}</span><span class="flag ${cls}">${label}</span></div>
  <div class="vbody">
    <div class="metrics">
      <div class="big"><span class="val ${cls}">${esc(r.latest)}</span> <span class="unit">${esc(r.unit)}</span><div class="when">Latest · ${esc(r.latestAt)}</div></div>
      <table class="kv">
        <tr><th>Average</th><td>${r.total ? esc(r.averageText ?? r.average) : '—'}</td></tr>
        <tr><th>Range</th><td>${r.total ? esc(r.rangeText ?? `${r.min}–${r.max}`) : '—'}</td></tr>
        <tr><th>Target</th><td>${esc(r.target)}</td></tr>
        <tr><th>In target</th><td>${r.total ? `${r.inRange}/${r.total} (${Math.round((r.inRange / r.total) * 100)}%)` : '—'}</td></tr>
        <tr><th>Trend</th><td>${arrow} ${r.direction === 'unknown' || !r.direction ? '—' : r.direction}</td></tr>
      </table>
    </div>
    <div class="spark">${sparkline(r, b.periodStart, b.periodEnd)}</div>
  </div>
  <p class="tnote">${esc(trendText(r))}</p>
</div>`
}

function signatureBlock(doc: MedicalDocument, rc: ReportContext, heading: string): string {
  const signer = (rc.signer ?? rc.author) as DoctorUser | undefined
  const signed = isOfficial(doc) && doc.status !== 'draft' && !!doc.signedBy
  const released = doc.status === 'released'
  const creds = signer?.role === 'doctor' ? [signer.specialty, signer.hospital].filter(Boolean).join(' · ') : ''
  return `<section class="signoff">
  <div class="sig">
    <div class="h">${esc(heading)}</div>
    ${signed
      ? `${safeImg(doc.signatureImage)
          ? `<div class="sigbox"><img class="sigimg" src="${safeImg(doc.signatureImage)}" alt="Signature of ${esc(signer?.name ?? '')}"></div>`
          : `<div class="script">${esc((signer?.name ?? '').replace(/^Dr\.?\s*/i, ''))}</div>`}
         <div class="sigline"></div>
         <div class="who">${esc(signer?.name ?? '—')}</div>
         ${creds ? `<div class="cred">${esc(creds)}</div>` : ''}
         ${signer?.role === 'doctor' && signer.licenseNo ? `<div class="cred">Licence No. ${esc(signer.licenseNo)}</div>` : ''}
         <div class="when">Electronically signed · ${esc(doc.signedAt ?? '')}</div>`
      : `<div class="unsigned">Awaiting clinician signature</div><div class="sigline"></div><div class="cred">This draft is not valid for clinical use.</div>`}
  </div>
  <div class="verify ${signed ? '' : 'muted'}">
    <svg viewBox="0 0 48 48" class="seal" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="${signed ? '0' : '4 3'}"/><circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="1"/>${signed ? '<path d="M16 24.5l5.5 5.5L32.5 19" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' : '<text x="24" y="28" text-anchor="middle" font-size="10" fill="currentColor" font-weight="700">?</text>'}</svg>
    <div>
      <div class="vlabel">${signed ? 'Verification code' : 'Status'}</div>
      <div class="vcode">${signed ? verificationCode(doc) : doc.status === 'signed' ? 'SIGNED · NOT RELEASED' : 'DRAFT'}</div>
      <div class="vmeta">${reportNo(doc)} · Version ${doc.version}${released && doc.releasedAt ? `<br>Released ${esc(doc.releasedAt)}` : ''}</div>
    </div>
  </div>
</section>`
}

/* ─── Bodies ───────────────────────────────────────────────────────── */
/** Compact results table — used when the doctor leaves trends out. */
function vitalsTable(b: VitalsBody): string {
  return `<div class="tscroll"><table class="grid vt"><thead><tr><th>Vital sign</th><th class="r">Latest</th><th>Taken</th><th class="r">Average</th><th class="r">Range</th><th>Target</th><th class="r">In target</th><th>Status</th></tr></thead><tbody>
${b.rows.map(r => {
  const [cls, label] = FLAG[r.level]
  return `<tr class="${r.level === 'critical' || r.level === 'warning' ? 'abn' : ''}"><td><b>${esc(r.name)}</b></td><td class="r nowrap"><b class="val-${cls}">${esc(r.latest)}</b> <span class="unit">${esc(r.unit)}</span></td><td class="nowrap sm">${esc(r.latestAt)}</td>
<td class="r nowrap">${r.total ? esc(r.averageText ?? r.average) : '—'}</td><td class="r nowrap">${r.total ? esc(r.rangeText ?? `${r.min}–${r.max}`) : '—'}</td><td class="nowrap">${esc(r.target)}</td>
<td class="r nowrap">${r.total ? `${r.inRange}/${r.total}` : '—'}</td><td><span class="flag ${cls}">${label}</span></td></tr>`
}).join('')}
</tbody></table></div>`
}

/** Appendix: every reading in the period, newest first, one table per vital. */
function readingsLog(b: VitalsBody): string {
  const withData = b.rows.filter(r => r.points?.length)
  if (!withData.length) return ''
  return `<section class="block appendix">
  <h2>Appendix · Readings log</h2>
  <div class="logs">${withData.map(r => `<div class="log"><div class="logh">${esc(r.name)} <span>(${esc(r.unit)})</span></div>
  <table class="grid tight"><thead><tr><th>Date</th><th>Time</th><th class="r">Reading</th><th>Status</th></tr></thead><tbody>
  ${[...r.points!].reverse().map(p => `<tr><td class="nowrap">${fmtDay(p.at)}</td><td>${fmtTime(p.at)}</td><td class="r"><b>${p.v2 !== undefined ? `${Math.round(p.v)}/${Math.round(p.v2)}` : Math.round(p.v * 10) / 10}</b></td><td>${p.level === 'normal' ? '<span class="dot ok"></span>In target' : p.level === 'critical' ? '<span class="dot crit"></span>Critical' : '<span class="dot warn"></span>Outside'}</td></tr>`).join('')}
  </tbody></table></div>`).join('')}</div>
  <p class="note">Up to the 60 most recent valid readings per vital. Readings marked invalid by the care team are excluded.</p>
</section>`
}

/** Sex, blood type, allergies and long-term conditions, as the patient recorded them. */
function healthStrip(p: PatientUser | undefined, allergiesOnly = false): string {
  const h = p?.health
  if (!h) return ''
  const allergies = h.allergies.length
    ? h.allergies.map(a => `<span class="chip ${a.severity === 'severe' ? 'crit' : a.severity === 'moderate' ? 'warn' : ''}">${esc(a.substance)}${a.severity !== 'mild' ? ` · ${a.severity}` : ''}${a.reaction ? ` (${esc(a.reaction)})` : ''}</span>`).join(' ')
    : h.noKnownAllergies ? 'No known allergies' : '<span class="muted">Not recorded</span>'
  const cells: [string, string][] = allergiesOnly ? [['Allergies', allergies]] : [
    ['Blood type', esc(h.bloodType ?? 'Unknown')],
    ['Allergies', allergies],
    ['Long-term conditions', h.conditions.length ? esc(h.conditions.join(', ')) : h.noConditions ? 'None' : '<span class="muted">Not recorded</span>'],
    ...(h.otherMedicines ? [['Other medicines', esc(h.otherMedicines)] as [string, string]] : []),
  ]
  return `<section class="health">${cells.map(([k, v]) => `<div><div class="hk">${k}</div><div class="hv">${v}</div></div>`).join('')}</section>`
}

function vitalsSections(doc: MedicalDocument, b: VitalsBody): { main: string; closing: string; appendix: string } {
  const inc: VitalsReportInclude = { ...DEFAULT_REPORT_INCLUDE, ...b.include }
  const tracked = b.rows.length
  const outOf = b.rows.filter(r => r.level === 'warning' || r.level === 'critical').length
  const critical = b.rows.some(r => r.level === 'critical') || b.alerts.some(a => a.status !== 'resolved' && a.severity === 'danger')
  const openAlerts = b.alerts.filter(a => a.status !== 'resolved').length
  const status = critical ? ['crit', 'Urgent review'] : outOf || openAlerts ? ['warn', 'Needs review'] : ['ok', 'Stable']
  const withData = b.rows.filter(r => r.total > 0).length
  const findings = b.findings?.length ? b.findings : [b.summary]
  const notes = b.notes?.length ? `<section class="block">
  <h2>Clinical notes</h2>
  ${b.notes.map(n => `<div class="cnote"><div class="cmeta">${esc(n.at)} · ${esc(n.author)}</div>${n.content.split('\n').map(l => `<p>${esc(l)}</p>`).join('')}</div>`).join('')}
</section>` : ''
  const closing = `<section class="block">
  <h2>Clinician's interpretation &amp; plan</h2>
  ${b.interpretation
    ? `<div class="interp">${b.interpretation.split('\n').map(l => `<p>${esc(l)}</p>`).join('')}</div>`
    : `<div class="interp empty">${doc.status === 'released' ? 'No additional interpretation was recorded. Findings above are generated from home-monitoring data.' : 'To be completed by the signing clinician before release.'}</div>`}
</section>`
  const main = `
<section class="kpis ${inc.alerts ? '' : 'three'}">
  <div class="kpi ${status[0]}"><div class="kl">Overall status</div><div class="kv2">${status[1]}</div><div class="ks">${outOf} of ${tracked} vitals outside target</div></div>
  <div class="kpi"><div class="kl">Readings</div><div class="kv2">${b.readingsCount}</div><div class="ks">over ${b.periodDays} days · ${withData}/${tracked} vitals logged</div></div>
  <div class="kpi"><div class="kl">Within target</div><div class="kv2">${tracked - outOf}/${tracked}</div><div class="ks">at latest reading</div></div>
  ${inc.alerts ? `<div class="kpi ${openAlerts ? 'warn' : ''}"><div class="kl">Alerts</div><div class="kv2">${b.alerts.length}</div><div class="ks">${openAlerts} open · ${b.alerts.length - openAlerts} resolved</div></div>` : ''}
</section>

${inc.findings ? `<section class="block">
  <h2>Summary of findings</h2>
  <ul class="findings">${findings.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
</section>` : ''}

<section class="block">
  <h2>${inc.trends ? 'Vital signs &amp; trends' : 'Vital signs'}</h2>
  ${inc.trends ? `<div class="vitals">${b.rows.map(r => vitalCard(r, b)).join('')}</div>` : vitalsTable(b)}
</section>

${inc.alerts && b.alerts.length ? `<section class="block">
  <h2>Alerts &amp; events</h2>
  <table class="grid"><thead><tr><th>Date &amp; time</th><th>Event</th><th>Severity</th><th>Status / outcome</th></tr></thead><tbody>
  ${b.alerts.map(a => `<tr><td class="nowrap">${esc(a.at)}</td><td>${esc(a.label)}</td><td><span class="flag ${a.severity === 'danger' ? 'crit' : 'warn'}">${a.severity === 'danger' ? 'Critical' : 'Warning'}</span></td><td><span class="flag ${a.status === 'resolved' ? 'ok' : 'crit'}">${a.status === 'resolved' ? 'Resolved' : 'Unresolved'}</span> ${esc(a.status === 'resolved' ? a.outcome ?? '' : a.status)}${a.resolution ? ` — ${esc(a.resolution)}` : ''}${a.steps?.length
    ? `<ol class="steps">${a.steps.map(st => `<li><span class="when">${esc(st.when)}</span> ${esc(st.text)}${st.by ? ` <span class="when">· ${esc(st.by)}</span>` : ''}</li>`).join('')}</ol>` : ''}</td></tr>`).join('')}
  </tbody></table>
</section>` : ''}

${inc.medications && b.medications?.length ? `<section class="block">
  <h2>Current medications</h2>
  <table class="grid"><thead><tr><th>Medication</th><th>Dose</th><th>Frequency</th><th>Indication</th></tr></thead><tbody>
  ${b.medications.map(m => `<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.dose)}</td><td>${esc(m.frequency)}</td><td>${esc(m.purpose || '—')}</td></tr>`).join('')}
  </tbody></table>
</section>` : ''}
${notes}`
  return { main, closing, appendix: inc.readingsLog ? readingsLog(b) : '' }
}

function labSections(b: Extract<DocBody, { type: 'lab' }>): string {
  const abnormal = b.rows.filter(r => r.flag).length
  return `<section class="kpis two">
  <div class="kpi ${abnormal ? 'warn' : 'ok'}"><div class="kl">Result summary</div><div class="kv2">${abnormal ? `${abnormal} abnormal` : 'All within range'}</div><div class="ks">${b.rows.length} tests</div></div>
  <div class="kpi"><div class="kl">Laboratory</div><div class="kv2 sm">${esc(b.lab)}</div></div>
</section>
<section class="block"><h2>Results</h2>
<table class="grid"><thead><tr><th>Test</th><th class="r">Result</th><th>Unit</th><th>Reference range</th><th>Flag</th></tr></thead><tbody>
${b.rows.map(r => `<tr class="${r.flag ? 'abn' : ''}"><td>${esc(r.test)}</td><td class="r"><b>${esc(r.value)}</b></td><td>${esc(r.unit)}</td><td>${esc(r.ref)}</td><td>${r.flag ? `<span class="flag ${r.flag === 'H' ? 'crit' : 'info'}">${r.flag === 'H' ? 'High' : 'Low'}</span>` : ''}</td></tr>`).join('')}
</tbody></table></section>
${b.comment ? `<section class="block"><h2>Comment</h2><div class="interp"><p>${esc(b.comment)}</p></div></section>` : ''}`
}

function rxSections(b: Extract<DocBody, { type: 'prescription' }>): string {
  return `<section class="block"><h2><span class="rx">℞</span> Prescription</h2>
<table class="grid kvgrid"><tbody>
<tr><th>Medication</th><td><b>${esc(b.medication)}</b></td></tr>
<tr><th>Dose</th><td>${esc(b.dosage)}</td></tr>
<tr><th>Frequency</th><td>${esc(b.frequency)}</td></tr>
<tr><th>Indication</th><td>${esc(b.purpose || '—')}</td></tr>
</tbody></table></section>`
}

/* ─── Page ─────────────────────────────────────────────────────────── */
const TITLES: Partial<Record<MedicalDocument['category'], string>> = {
  vitals_report: 'Vital Signs Monitoring Report', lab: 'Laboratory Report', prescription: 'Prescription',
  visit_summary: 'Visit Summary', discharge: 'Discharge Summary', referral: 'Referral Letter',
}

export function renderReportHtml(doc: MedicalDocument, rc: ReportContext, opts: RenderOptions = {}): string {
  const b = doc.body
  const official = isOfficial(doc)
  const draft = official && doc.status !== 'released'
  const p = rc.patient
  const age = p?.dob ? calcAge(p.dob) : null
  const clinician = (rc.signer ?? rc.author ?? rc.careDoctor) as DoctorUser | undefined
  const facility = clinician?.role === 'doctor' && clinician.hospital ? clinician.hospital : 'mCare Remote Care'
  const heading = official ? (TITLES[doc.category] ?? DOC_CATEGORIES[doc.category].label) : 'Personal Document'
  const period = b?.type === 'vitals' && b.periodStart && b.periodEnd
    ? `${fmtDay(b.periodStart)} – ${fmtDay(b.periodEnd)}` : ymd(doc.documentDate)
  const stamp = !official ? ['na', 'PERSONAL'] : doc.supersededBy ? ['na', 'SUPERSEDED'] : doc.status === 'released' ? ['ok', 'FINAL'] : doc.status === 'signed' ? ['info', 'SIGNED'] : ['crit', 'DRAFT']
  const watermark = draft ? 'DRAFT · NOT SIGNED' : doc.supersededBy ? 'SUPERSEDED' : ''

  let main = '', closing = '', appendix = ''
  if (b?.type === 'vitals') ({ main, closing, appendix } = vitalsSections(doc, b))
  else if (b?.type === 'lab') main = labSections(b)
  else if (b?.type === 'prescription') main = rxSections(b)
  else if (b?.type === 'text') main = `<section class="block"><div class="interp">${b.text.split('\n').map(l => `<p>${esc(l)}</p>`).join('')}</div></section>`

  const infoRows = (rows: [string, string][]) => rows.map(([k, v]) => `<div class="row"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.title)} — ${esc(p?.name ?? '')}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700;9..40,800&family=Fraunces:opsz,wght@9..144,600;9..144,700&family=DM+Mono:wght@500&display=swap">
<style>${CSS}${opts.embedded ? EMBED_CSS : ''}${opts.zoom && opts.zoom !== 1 ? `html{zoom:${opts.zoom}}` : ''}</style></head>
<body${opts.embedded ? ' class="embedded"' : ''}>
${watermark ? `<div class="wm">${watermark}</div>` : ''}
<div class="page">
<table class="pp"><thead><tr><td><div class="ph"></div></td></tr></thead><tfoot><tr><td><div class="pf"></div></td></tr></tfoot><tbody><tr><td>
<header class="lh">
  <div class="brand">${LOGO}<div class="bt">Remote Patient<br>Monitoring</div></div>
  <div class="fac"><b>${esc(facility)}</b>${clinician?.role === 'doctor' && clinician.specialty ? `<br>Department of ${esc(clinician.specialty)}` : ''}<br>${esc(clinician?.email ?? 'care@mcare.app')}${clinician?.phone ? ` · ${esc(clinician.phone)}` : ''}</div>
</header>

<div class="titlebar">
  <div>
    <div class="eyebrow">${official ? 'Clinical report' : 'Patient-uploaded document'}</div>
    <h1>${esc(heading)}</h1>
    <div class="sub">${esc(doc.title)}${b?.type === 'vitals' ? ` · ${b.periodDays}-day period` : ''}</div>
  </div>
  <div class="stamp ${stamp[0]}">${stamp[1]}</div>
</div>

${doc.correctionReason ? `<div class="notice"><b>Corrected report — version ${doc.version}.</b> Replaces version ${doc.version - 1}. Reason: ${esc(doc.correctionReason)}</div>` : ''}
${doc.supersededBy ? `<div class="notice grey"><b>This version has been superseded</b> by a corrected report. Do not use it for clinical decisions.</div>` : ''}
${draft ? `<div class="notice red"><b>Draft — not signed.</b> Not valid for clinical use until reviewed and signed by the treating clinician.</div>` : ''}

<section class="info">
  <div class="box"><h3>Patient</h3><dl>${infoRows([
    ['Name', `<b>${esc(p?.name ?? '—')}</b>`],
    ['Patient ID', esc(patientRef(p))],
    ['Date of birth', p?.dob ? `${esc(ymd(p.dob))}${age !== null ? ` · ${age} years` : ''}` : '—'],
    ['Sex', esc(p?.health?.sex ? SEX[p.health.sex] : '—')],
    ['Phone', esc(p?.phone || '—')],
  ])}</dl></div>
  <div class="box"><h3>Report</h3><dl>${infoRows([
    ['Report no.', esc(reportNo(doc))],
    [b?.type === 'vitals' ? 'Period' : 'Date', esc(period)],
    ['Prepared', esc(b?.type === 'vitals' ? b.generatedAt : doc.createdAt)],
    [official ? 'Clinician' : 'Uploaded by', esc(clinician?.name ?? rc.author?.name ?? '—')],
    ['Status', official ? (doc.supersededBy ? 'Superseded' : doc.status === 'released' ? `Final · v${doc.version}` : doc.status === 'signed' ? 'Signed, not released' : 'Draft') : 'Personal'],
  ])}</dl></div>
</section>
${b?.type === 'vitals' && { ...DEFAULT_REPORT_INCLUDE, ...b.include }.healthProfile ? healthStrip(p) : b?.type === 'prescription' ? healthStrip(p, true) : ''}

${doc.description ? `<p class="desc">${esc(doc.description)}</p>` : ''}
${main}

${official || closing ? `<div class="closing">${closing}${official ? signatureBlock(doc, rc, doc.category === 'lab' ? 'Reviewed & released by' : doc.category === 'prescription' ? 'Prescriber' : 'Reported & signed by') : ''}</div>` : ''}
${appendix}
</td></tr></tbody></table>

<footer class="foot">
  <span><b>Confidential</b> — contains personal health information. ${b?.type === 'vitals' ? 'Based on patient-recorded home monitoring; not a substitute for clinical examination.' : ''}</span>
  <span class="nowrap">${esc(reportNo(doc))} · v${doc.version} · ${esc(doc.id)}</span>
</footer>
</div>
</body></html>`
}

/* ─── Styles ───────────────────────────────────────────────────────── */
const CSS = `
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#e9eeee;color:#1f2933;font:13px/1.45 "DM Sans","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.page{width:210mm;min-height:297mm;margin:24px auto;background:#fff;padding:13mm 14mm 20mm;box-shadow:0 8px 30px rgba(15,40,40,.12);position:relative}
h1{font:700 25px/1.15 Fraunces,Georgia,"Times New Roman",serif;margin:2px 0 3px;color:#0b2a2a}
h2{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#0a6e6e;margin:0 0 8px;padding-bottom:5px;border-bottom:1.5px solid #d6e7e5}
h3{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#6b7c85;margin:0 0 6px}
b{color:#0f1f24}
.nowrap{white-space:nowrap}
.pp{width:100%;border-collapse:collapse;table-layout:fixed}.pp>thead>tr>td,.pp>tfoot>tr>td,.pp>tbody>tr>td{padding:0}.ph,.pf{height:0}
.lh{display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:3px solid #0a6e6e}
.brand{display:flex;align-items:center;gap:14px}
.logo{display:flex;flex-direction:column;align-items:center;gap:1px}
.word{font:700 30px/1 Fraunces,Georgia,serif;letter-spacing:-.025em}
.trace{width:66px;height:13px;display:block;overflow:visible}
.bt{font-size:9.5px;line-height:1.35;letter-spacing:.16em;text-transform:uppercase;color:#6b7c85;font-weight:700;padding-left:14px;border-left:1.5px solid #d6e7e5}
.fac{text-align:right;font-size:11px;color:#556}
.titlebar{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:16px 0 12px}
.eyebrow{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#0d9e82;font-weight:700}
.sub{color:#556;font-size:12px}
.stamp{border:2px solid;border-radius:6px;padding:5px 10px;font-weight:800;letter-spacing:.16em;font-size:11px;transform:rotate(-3deg);white-space:nowrap}
.stamp.ok{color:#047857;border-color:#047857}.stamp.crit{color:#dc2626;border-color:#dc2626}.stamp.info{color:#1d4ed8;border-color:#1d4ed8}.stamp.na{color:#6b7280;border-color:#9ca3af}
.notice{background:#eef6ff;border-left:4px solid #1d4ed8;padding:8px 12px;margin:0 0 12px;font-size:12px;border-radius:0 6px 6px 0}
.notice.red{background:#fef2f2;border-color:#dc2626}.notice.grey{background:#f3f4f6;border-color:#6b7280}
.info{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
.box{border:1px solid #dfe8e7;border-radius:10px;padding:10px 12px;background:#fbfdfd}
dl{margin:0}.row{display:flex;gap:8px;padding:2px 0}dt{width:92px;flex-shrink:0;color:#6b7c85;font-size:11.5px}dd{margin:0;font-size:12px}
.desc{color:#445;margin:0 0 12px}
.health{display:grid;grid-template-columns:auto 1.4fr 1.4fr auto;gap:0;border:1px solid #dfe8e7;border-radius:10px;margin:-4px 0 14px;overflow:hidden}
.health>div{padding:7px 12px;border-left:1px solid #eef3f2}.health>div:first-child{border-left:0}
.hk{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:#6b7c85;font-weight:700;margin-bottom:2px}.hv{font-size:12px}
.chip{display:inline-block;background:#f3f4f6;border-radius:99px;padding:0 7px;font-size:11px;margin:1px 0}
.chip.warn{background:#fef3c7;color:#92400e}.chip.crit{background:#fee2e2;color:#991b1b;font-weight:700}
.muted{color:#9aa8ae;font-style:italic}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}.kpis.two{grid-template-columns:1fr 1fr}.kpis.three{grid-template-columns:repeat(3,1fr)}
.kpi{border:1px solid #dfe8e7;border-radius:10px;padding:9px 11px;background:#fff}
.kpi.ok{background:#ecfdf5;border-color:#a7f3d0}.kpi.warn{background:#fffbeb;border-color:#fde68a}.kpi.crit{background:#fef2f2;border-color:#fecaca}
.kl{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:#6b7c85;font-weight:700}
.kv2{font-size:19px;font-weight:800;color:#0f1f24;margin-top:2px}.kv2.sm{font-size:13px}
.kpi.ok .kv2{color:#047857}.kpi.warn .kv2{color:#b45309}.kpi.crit .kv2{color:#dc2626}
.ks{font-size:10.5px;color:#6b7c85}
.block{margin-bottom:14px}.closing{break-inside:avoid;page-break-inside:avoid}
.findings{margin:0;padding-left:18px}.findings li{margin:3px 0}
.vitals{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.vital{border:1px solid #dfe8e7;border-radius:10px;padding:9px 11px;break-inside:avoid;page-break-inside:avoid}
.vhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}.vname{font-weight:800;color:#0f1f24}
.vbody{display:flex;flex-direction:column;gap:6px}
.metrics{display:flex;gap:10px;align-items:flex-start}
.big{min-width:96px}.val{font:800 21px/1.1 "Segoe UI",Roboto,Arial,sans-serif}.val.ok{color:#0f1f24}.val.warn{color:#b45309}.val.crit{color:#dc2626}.val.na{color:#9ca3af}
.unit{font-size:11px;color:#6b7c85}.when{font-size:10px;color:#8a9aa3;margin-top:2px}
.kv{border-collapse:collapse;font-size:11px;flex:1}.kv th{text-align:left;font-weight:600;color:#6b7c85;padding:1px 8px 1px 0;white-space:nowrap}.kv td{padding:1px 0;color:#1f2933}
.chart{width:100%;height:auto;display:block}.chart .ax{font-size:8px;fill:#8a9aa3}
.legend{font-size:9px;color:#8a9aa3;display:flex;gap:8px;align-items:center}.k{display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:-4px}
.k.sys{background:#0a6e6e}.k.dia{background:#6b93d6}.k.band{background:#10b981;opacity:.35;height:7px}
.nochart{font-size:11px;color:#8a9aa3;background:#f7f9f9;border-radius:6px;padding:14px;text-align:center}
.tnote{margin:6px 0 0;font-size:11px;color:#445;border-top:1px dashed #e3eceb;padding-top:5px}
.flag{display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:.04em;padding:2px 7px;border-radius:99px;white-space:nowrap}
.steps{margin:5px 0 0;padding-left:16px;font-size:10px;color:#374151}.steps li{margin:1px 0}.steps .when{color:#6b7280}
.flag.ok{background:#d1fae5;color:#065f46}.flag.warn{background:#fef3c7;color:#92400e}.flag.crit{background:#fee2e2;color:#991b1b}.flag.na{background:#f3f4f6;color:#6b7280}.flag.info{background:#dbeafe;color:#1e40af}
table.grid{width:100%;border-collapse:collapse;font-size:12px}
table.grid th{background:#f1f7f6;color:#44565f;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;text-align:left;padding:6px 8px;border-bottom:1.5px solid #d6e7e5}
table.grid td{padding:6px 8px;border-bottom:1px solid #eef3f2;vertical-align:top}
table.grid .r{text-align:right}table.grid tr.abn td{background:#fff7f7}table.grid .sm{font-size:10.5px;color:#6b7c85}
table.grid.vt th,table.grid.vt td{white-space:nowrap;padding-left:6px;padding-right:6px}table.grid.vt th{letter-spacing:.03em}
.val-warn{color:#b45309}.val-crit{color:#dc2626}.val-na{color:#9ca3af}
table.grid.tight{font-size:10.5px}table.grid.tight th{font-size:9px;padding:4px 6px}table.grid.tight td{padding:3px 6px}
.appendix{margin-top:18px}.logs{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;align-items:start}
.log{border:1px solid #eef3f2;border-radius:8px;overflow:hidden}.logh{font-weight:800;font-size:11.5px;padding:5px 8px;background:#fbfdfd;border-bottom:1px solid #eef3f2}.logh span{font-weight:500;color:#6b7c85}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;vertical-align:1px}.dot.ok{background:#10b981}.dot.warn{background:#d97706}.dot.crit{background:#dc2626}
.note{font-size:10px;color:#8a9aa3;margin:6px 0 0}.tscroll{overflow-x:auto}
.kvgrid th{width:140px;text-transform:none;font-size:12px;letter-spacing:0}
.rx{font:700 18px Georgia,serif;color:#0a6e6e;margin-right:4px}
.interp{border-left:3px solid #0a6e6e;background:#f6fbfa;padding:8px 12px;border-radius:0 8px 8px 0}.interp p{margin:3px 0}
.interp p:empty{height:6px}
.cnote{border:1px solid #dfe8e7;border-radius:8px;padding:7px 11px;margin-bottom:6px;break-inside:avoid;page-break-inside:avoid}.cnote p{margin:2px 0}
.cmeta{font-size:10px;color:#6b7c85;font-weight:700;letter-spacing:.04em}
.interp.empty{color:#8a9aa3;font-style:italic;border-color:#cbd5d4;background:#fafbfb}
.signoff{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-top:12px;padding-top:12px;border-top:1.5px solid #d6e7e5;break-inside:avoid;page-break-inside:avoid}
.sig .h{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#6b7c85;font-weight:700}
.script{font:38px/1.1 "Segoe Script","Lucida Handwriting","Brush Script MT","Snell Roundhand",cursive;color:#12356b;margin:6px 0 -6px 6px;transform:rotate(-4deg);transform-origin:left bottom;white-space:nowrap}
.sigbox{height:58px;display:flex;align-items:flex-end;margin:4px 0 -8px 4px}.sigimg{max-height:64px;max-width:240px;object-fit:contain;object-position:left bottom}
.sigline{border-bottom:1.5px solid #1f2933;margin:4px 0 6px;width:85%}
.unsigned{height:44px;display:flex;align-items:flex-end;color:#dc2626;font-weight:700;font-size:12px;letter-spacing:.06em}
.who{font-weight:800;color:#0f1f24}.cred{font-size:11px;color:#556}.sig .when{font-size:10.5px;color:#047857;font-weight:600;margin-top:3px}
.verify{display:flex;gap:10px;align-items:center;border:1px solid #d6e7e5;border-radius:10px;padding:10px 12px;color:#047857;background:#f6fbfa;align-self:end}
.verify.muted{color:#9ca3af;background:#fafafa}.seal{width:46px;height:46px;flex-shrink:0}
.vlabel{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:#6b7c85;font-weight:700}
.vcode{font:500 14px/1.3 "DM Mono",Consolas,"SFMono-Regular",Menlo,monospace;color:#0f1f24;letter-spacing:.06em}
.vmeta{font-size:10px;color:#6b7c85}
.foot{position:absolute;left:14mm;right:14mm;bottom:8mm;display:flex;justify-content:space-between;gap:12px;font-size:9.5px;color:#8a9aa3;border-top:1px solid #e3eceb;padding-top:5px}
.wm{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:5;font:900 70px/1 "Segoe UI",Arial,sans-serif;letter-spacing:.08em;color:rgba(220,38,38,.10);transform:rotate(-28deg);white-space:nowrap}
@page{size:A4;margin:0}
@media print{
  body{background:#fff}
  .page{margin:0;box-shadow:none;width:auto;min-height:auto;padding:0 14mm}
  .ph{height:11mm}.pf{height:15mm}
  .foot{position:fixed;bottom:6mm;left:14mm;right:14mm;background:#fff}
  thead{display:table-header-group}tfoot{display:table-footer-group}
  table.grid tr{break-inside:avoid}
  h2{break-after:avoid}
  .appendix{break-before:page;margin-top:0}
  .log{break-inside:avoid}
}
@media screen and (max-width:760px){
  .page{width:auto;min-height:0;margin:0;padding:18px 16px 60px;box-shadow:none}
  .info,.vitals,.signoff,.logs,.health{grid-template-columns:1fr}
  .health>div{border-left:0;border-top:1px solid #eef3f2}.health>div:first-child{border-top:0}
  .kpis.three{grid-template-columns:1fr 1fr}
  .kpis{grid-template-columns:1fr 1fr}
  .lh{flex-direction:column;align-items:flex-start;gap:8px}.fac{text-align:left}
  h1{font-size:21px}
  table.grid{font-size:11px}table.grid th,table.grid td{padding:5px 6px}
  .foot{position:static;margin-top:18px;flex-direction:column}
}`

/** In-app reader: the report reflows into the phone and scrolls inside the frame. */
const EMBED_CSS = `
body.embedded{background:#f3f5f5}
body.embedded .page{width:auto;min-height:0;margin:0;padding:16px 14px 28px;box-shadow:none}
body.embedded .info,body.embedded .vitals,body.embedded .signoff,body.embedded .logs,body.embedded .health{grid-template-columns:1fr}
body.embedded .health>div{border-left:0;border-top:1px solid #eef3f2}body.embedded .health>div:first-child{border-top:0}
body.embedded .kpis,body.embedded .kpis.three{grid-template-columns:1fr 1fr}body.embedded .lh{flex-direction:column;align-items:flex-start;gap:8px}body.embedded .fac{text-align:left}
body.embedded h1{font-size:21px}
body.embedded .foot{position:static;margin-top:18px;flex-direction:column}
body.embedded .wm{font-size:44px}`

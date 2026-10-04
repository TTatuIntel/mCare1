/**
 * Documents: single source of truth for categories, upload validation,
 * the access policy, report generation and export.
 *
 * The access policy here plays the role of the server. The document store
 * in AppContext passes every read and write through it, and screens only
 * ever receive what it allows — no screen filters for privacy on its own.
 * When the Laravel API arrives, these same rules move into Policies there.
 */
import type {
  AppUser, AdminUser, DoctorUser, PatientUser, VitalDef, AppAlert,
  MedicalDocument, DocCategory, DocBody, DocSourceLink, SupportGrant, VitalsReportRow, VitalsReportInclude, ReportNote,
} from '@/shared/lib/types'
import { evaluate, latestValid, targetRange, vitalTrend, stamp, parseValue, alertIsFor, alertStory, resolvedHowLabel } from '@/shared/lib/vitals'
import { SUPPORTED_SUMMARY, formatByExt, extOf, verifyContent, FORMATS } from './fileFormats'

/* ─── Categories ─────────────────────────────────────────────────────── */
export const DOC_CATEGORIES: Record<DocCategory, { label: string; icon: string; color: string }> = {
  vitals_report: { label: 'Vitals Report',  icon: '📊', color: 'teal' },
  lab:           { label: 'Lab Result',     icon: '🧪', color: 'blue' },
  imaging:       { label: 'Imaging',        icon: '🩻', color: 'purple' },
  prescription:  { label: 'Prescription',   icon: '💊', color: 'amber' },
  visit_summary: { label: 'Visit Summary',  icon: '🩺', color: 'teal' },
  discharge:     { label: 'Discharge',      icon: '🏥', color: 'blue' },
  referral:      { label: 'Referral',       icon: '📨', color: 'purple' },
  insurance:     { label: 'Insurance',      icon: '🪪', color: 'gray' },
  personal:      { label: 'Personal',       icon: '📁', color: 'gray' },
  other:         { label: 'Other',          icon: '📄', color: 'gray' },
}
/** Categories a patient may choose when uploading their own file. */
export const PATIENT_UPLOAD_CATEGORIES: DocCategory[] = ['lab', 'imaging', 'discharge', 'referral', 'insurance', 'personal', 'other']
/** Categories a clinician may choose when attaching a file. */
export const CLINICIAN_UPLOAD_CATEGORIES: DocCategory[] = ['lab', 'imaging', 'visit_summary', 'discharge', 'referral', 'other']

export const isOfficial = (d: MedicalDocument) => d.origin !== 'patient_upload'

/* ─── Limits ─────────────────────────────────────────────────────────── */
export const MAX_UPLOAD_MB = 20
/** Soft-deleted documents can be restored for this many days. */
export const DOC_RETENTION_DAYS = 30
/** Minutes an admin support grant stays open. */
export const SUPPORT_ACCESS_MIN = 15
export const SHARE_TTL_HOURS = [1, 24, 72] as const

const DAY_MS = 86_400_000

/* ─── Upload validation ──────────────────────────────────────────────── */
// The format allow-list, content signatures and macro/script checks live in fileFormats.ts.
export { ACCEPT_ATTR } from './fileFormats'
export const ALLOWED_LABEL = `${SUPPORTED_SUMMARY} · max ${MAX_UPLOAD_MB} MB`

/** Never accepted, whatever else the name says — catches "report.pdf.exe" and active web content. */
const DANGEROUS_EXT = /\.(exe|msi|bat|cmd|com|scr|js|mjs|vbs|ps1|sh|jar|apk|html?|svg|xml|php|dll|docm|dotm|xlsm|xltm|xlam|pptm|potm|ppsm|lnk|iso)(\.|$)/i

/** Strip path parts and control characters; keep a readable, safe name. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file'
  const clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim()
  return (clean || 'file').slice(0, 120)
}

/** Name-level checks. Returns a reason, or null when the name is acceptable. */
export function checkFileName(name: string): string | null {
  if (DANGEROUS_EXT.test(name)) return 'This file type is not allowed for security reasons.'
  if (!formatByExt(extOf(name))) return `Unsupported file type. Supported: ${SUPPORTED_SUMMARY}.`
  return null
}

export type FileCheck =
  | { ok: true; name: string; mime: string }
  | { ok: false; reason: string }

/** Full validation: name, size, emptiness, real content type and active content (macros, PDF scripts). */
export async function inspectFile(file: File): Promise<FileCheck> {
  const name = sanitizeFileName(file.name)
  const nameIssue = checkFileName(name)
  if (nameIssue) return { ok: false, reason: nameIssue }
  if (file.size === 0) return { ok: false, reason: 'The file is empty.' }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return { ok: false, reason: `The file is too large (max ${MAX_UPLOAD_MB} MB).` }
  const fmt = formatByExt(extOf(name))!
  const issue = verifyContent(fmt, new Uint8Array(await file.arrayBuffer()))
  if (issue) return { ok: false, reason: issue }
  return { ok: true, name, mime: fmt.mime }
}

/**
 * SHA-256 hex digest of a file. The browser's own implementation is used where it exists; on a plain-http
 * address (a phone opening the laptop's dev server) it does not, so the same digest is computed here.
 * Either way a file has one hash on every device, which is what duplicate detection relies on.
 */
export async function hashBuffer(buf: ArrayBuffer): Promise<string> {
  try {
    if (globalThis.crypto?.subtle) {
      const d = await crypto.subtle.digest('SHA-256', buf)
      return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('')
    }
  } catch { /* fall through */ }
  return sha256Hex(new Uint8Array(buf))
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** SHA-256 (FIPS 180-4) for browsers without WebCrypto. Same output as `crypto.subtle.digest('SHA-256', …)`. */
export function sha256Hex(bytes: Uint8Array): string {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  // Pad: the message, a 1 bit, zeros, then its length in bits as 64 bits.
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000))
  view.setUint32(padded.length - 4, (bytes.length << 3) >>> 0)
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, k] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k
  }
  return [...h].map(x => x.toString(16).padStart(8, '0')).join('')
}

/** Small, synchronous, deterministic checksum — used for backups and seeded files. */
export function fnv1a(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Opaque, unguessable identifier (random, not sequential). */
export function opaqueId(prefix: string): string {
  const bytes = new Uint8Array(12)
  if (typeof globalThis.crypto?.getRandomValues === 'function') crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return `${prefix}_${[...bytes].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20)}`
}

/* ─── Access policy ──────────────────────────────────────────────────── */
export type AccessLevel = 'none' | 'metadata' | 'content'
export interface Access { level: AccessLevel; reason: string }
export interface PolicyCtx { users: AppUser[]; grants: SupportGrant[]; now: number }

const none = (reason: string): Access => ({ level: 'none', reason })
const meta = (reason: string): Access => ({ level: 'metadata', reason })
const full = (reason: string): Access => ({ level: 'content', reason })

const isStaff = (u: AppUser): u is AdminUser => u.role === 'admin' || u.role === 'assistant'

/**
 * Is this doctor currently responsible for this patient? Always judged on the
 * live records (never a possibly stale session copy), and both sides of the
 * link must agree.
 */
export function isTreatingDoctor(doctor: AppUser, patientId: string, users: AppUser[]): boolean {
  const d = users.find(u => u.id === doctor.id) as DoctorUser | undefined
  if (!d || d.role !== 'doctor' || d.status !== 'active' || d.approvalStatus !== 'approved') return false
  const pt = users.find(u => u.id === patientId) as PatientUser | undefined
  return !!pt && pt.assignedDoctorId === d.id && d.assignedPatientIds.includes(patientId)
}

export function activeGrant(user: AppUser, docId: string, ctx: PolicyCtx): SupportGrant | undefined {
  return ctx.grants.find(g => g.adminId === user.id && g.docId === docId && g.expiresAt > ctx.now)
}

/**
 * The one rule book for who may see a document, and how much of it.
 *   content  — may open, download and act on it
 *   metadata — may see that it exists (category, date, size, status), never the content
 *   none     — does not exist as far as this user is concerned
 */
export function docAccess(session: AppUser | null | undefined, doc: MedicalDocument, ctx: PolicyCtx): Access {
  if (!session) return none('Not signed in')
  // Judge the live account, not the session copy: suspensions, reassignments and permission changes apply at once.
  const user = ctx.users.find(u => u.id === session.id)
  if (!user) return none('Unknown account')
  if (user.status !== 'active') return none('Account is not active')
  const deleted = !!doc.deletedAt

  if (user.role === 'patient') {
    if (doc.patientId !== user.id) return none('Not your record')
    if (isOfficial(doc) && doc.status !== 'released') return none('Not yet released by your doctor')
    if (deleted) return doc.origin === 'patient_upload' ? meta('Recently deleted — restore to open') : none('Removed')
    return full('Your own record')
  }

  if (user.role === 'doctor') {
    if (!isTreatingDoctor(user, doc.patientId, ctx.users)) return none('Not an assigned patient')
    if (doc.origin === 'patient_upload') {
      if (doc.visibility === 'private') return none('The patient kept this upload private')
      if (doc.upload && doc.upload.state !== 'ready') return none('Upload not complete')
      if (deleted) return none('Removed by the patient')
    }
    if (deleted) return meta('Deleted — restore to open')
    return full('Assigned doctor')
  }

  if (isStaff(user)) {
    if (user.isAssistant) {
      return user.permissions.includes('document_support')
        ? meta('Document support: metadata only')
        : none('No document permission')
    }
    if (!deleted && activeGrant(user, doc.id, ctx)) return full('Time-limited support access')
    return meta('Admin: metadata only')
  }
  return none('Unknown role')
}

export const canView = (u: AppUser | null | undefined, d: MedicalDocument, ctx: PolicyCtx) => docAccess(u, d, ctx).level === 'content'

/** One response for "doesn't exist" and "not yours", so IDs cannot be probed. */
export const NOT_FOUND = 'Document not found or you do not have access.'

export function resolveDoc(user: AppUser | null | undefined, id: string, docs: MedicalDocument[], ctx: PolicyCtx):
  { ok: true; doc: MedicalDocument } | { ok: false; error: string; existed: boolean } {
  const doc = docs.find(d => d.id === id)
  if (!doc || !canView(user, doc, ctx)) return { ok: false, error: NOT_FOUND, existed: !!doc }
  return { ok: true, doc }
}

/** Title as this viewer may see it. Staff working from metadata never see titles, which can reveal diagnoses. */
export function titleFor(user: AppUser | null | undefined, doc: MedicalDocument, level: AccessLevel): string {
  if (level === 'metadata' && user && isStaff(user)) return `${DOC_CATEGORIES[doc.category].label} (title hidden)`
  return doc.title
}

export function canUploadFor(user: AppUser | null | undefined, patientId: string, users: AppUser[]): boolean {
  if (!user || user.status !== 'active') return false
  if (user.role === 'patient') return user.id === patientId
  return isTreatingDoctor(user, patientId, users)
}

/** Clinical approval belongs to the treating doctor only — never to admins or assistants, whatever their permissions. */
export function canSign(user: AppUser | null | undefined, doc: MedicalDocument, ctx: PolicyCtx): boolean {
  return !!user && user.role === 'doctor' && isOfficial(doc) && doc.status === 'draft' && !doc.deletedAt
    && canView(user, doc, ctx) && (!doc.upload || doc.upload.state === 'ready')
}
export function canRelease(user: AppUser | null | undefined, doc: MedicalDocument, ctx: PolicyCtx): boolean {
  return !!user && user.role === 'doctor' && isOfficial(doc) && (doc.status === 'draft' || doc.status === 'signed')
    && !doc.deletedAt && canView(user, doc, ctx) && (!doc.upload || doc.upload.state === 'ready')
}
export function canCorrect(user: AppUser | null | undefined, doc: MedicalDocument, all: MedicalDocument[], ctx: PolicyCtx): boolean {
  if (!user || user.role !== 'doctor' || !isOfficial(doc) || doc.status !== 'released' || doc.supersededBy) return false
  // Prescriptions mirror the medication record — change them from Meds (stop / re-prescribe), not here.
  if (doc.category === 'prescription') return false
  if (!canView(user, doc, ctx)) return false
  return !all.some(d => d.supersedes === doc.id && !d.deletedAt)
}
/** Released clinical documents are part of the record and can only be corrected, never deleted. */
export function canDelete(user: AppUser | null | undefined, doc: MedicalDocument, ctx: PolicyCtx): boolean {
  if (!user || doc.deletedAt || !canView(user, doc, ctx)) return false
  if (user.role === 'patient') return doc.origin === 'patient_upload' && doc.patientId === user.id
  if (user.role === 'doctor') return isOfficial(doc) && doc.status !== 'released'
  return false
}
export function canRestore(user: AppUser | null | undefined, doc: MedicalDocument, ctx: PolicyCtx): boolean {
  if (!user || !doc.deletedAt || ctx.now - doc.deletedAt > DOC_RETENTION_DAYS * DAY_MS) return false
  const lvl = docAccess(user, doc, ctx).level
  if (user.role === 'patient') return lvl !== 'none' && doc.origin === 'patient_upload'
  if (user.role === 'doctor') return lvl !== 'none' && isOfficial(doc)
  if (isStaff(user)) return !user.isAssistant || user.permissions.includes('document_support')
  return false
}
export function canShare(user: AppUser | null | undefined, doc: MedicalDocument, ctx: PolicyCtx): boolean {
  return !!user && user.role === 'patient' && doc.patientId === user.id && canView(user, doc, ctx)
    && (!doc.upload || doc.upload.state === 'ready')
}

/** Everyone who could open this document right now — shown to admins and patients for transparency. */
export function whoCanOpen(doc: MedicalDocument, ctx: PolicyCtx): { user: AppUser; access: Access }[] {
  return ctx.users
    .map(user => ({ user, access: docAccess(user, doc, ctx) }))
    .filter(x => x.access.level !== 'none')
}

/* ─── Report generation ─────────────────────────────────────────────── */

/**
 * Build a vitals report from the patient's record. Descriptive only — it
 * summarises the numbers, flags what is outside target and links back to
 * every reading and alert it used, so the report can always be traced to its
 * source. Interpretation and plan are left to the signing clinician.
 */
export const DEFAULT_REPORT_INCLUDE: VitalsReportInclude = {
  trends: true, findings: true, alerts: true, medications: true, healthProfile: true, readingsLog: false,
}

export function buildVitalsReport(
  patient: PatientUser, defs: VitalDef[], alerts: AppAlert[], days: number, now = Date.now(), interpretation?: string,
  include: VitalsReportInclude = DEFAULT_REPORT_INCLUDE,
  /** Clinical notes the doctor chose to attach. */
  notes: ReportNote[] = [],
  /** Names for the people in an alert's history. */
  personName: (id: string) => string | undefined = () => undefined,
): { body: DocBody; links: DocSourceLink[] } {
  const cutoff = now - days * DAY_MS
  const allTracked = defs.filter(d => patient.trackedVitalIds.includes(d.id))
  const picked = include.vitalIds?.length ? allTracked.filter(d => include.vitalIds!.includes(d.id)) : []
  // Nothing (or nothing still tracked) selected → report on every tracked vital rather than an empty page.
  const tracked = picked.length ? picked : allTracked
  const round = (n: number) => Math.round(n * 10) / 10
  const findings: string[] = []

  const rows: VitalsReportRow[] = tracked.map(def => {
    const t = vitalTrend(patient, def, days, now)
    const latest = latestValid(patient, def.id)
    const thr = targetRange(patient, def)
    const vals = t.points.map(p => p.value)
    const series = patient.readings
      .filter(r => r.vitalId === def.id && !r.invalid && typeof r.at === 'number' && r.at >= cutoff)
      .map(r => ({ r, p: parseValue(def, r.value) }))
      .filter((x): x is { r: typeof x.r; p: NonNullable<typeof x.p> } => !!x.p)
      .sort((a, b) => a.r.at! - b.r.at!)
    const points = series.slice(-60).map(({ r, p }) => ({ at: r.at!, v: p.primary, v2: p.secondary, level: evaluate(patient, def, r.value) }))
    const level = latest ? evaluate(patient, def, latest.value) : 'none'
    const isBp = def.id === 'bp' && series.some(x => x.p.secondary !== undefined)
    const dia = series.map(x => x.p.secondary).filter((x): x is number => x !== undefined)
    const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0

    // Clinician-voice findings: only what the data supports.
    const lp = latest ? parseValue(def, latest.value) : null
    if (!series.length) findings.push(`No ${def.name.toLowerCase()} readings recorded in this period.`)
    else if (level === 'critical') findings.push(`${def.name} latest reading ${latest!.value} ${def.unit} is in the critical range.`)
    else if (level === 'warning' && lp) findings.push(`${def.name} latest reading ${latest!.value} ${def.unit} is ${lp.primary > thr.max ? 'above' : lp.primary < thr.min ? 'below' : 'outside'} the target of ${thr.min}–${thr.max} ${def.unit}.`)
    if (series.length >= 3 && t.inRange / Math.max(1, t.points.length) < 0.6)
      findings.push(`${def.name} was within target for only ${Math.round((t.inRange / t.points.length) * 100)}% of readings.`)
    if (include.trends && series.length >= 3 && t.direction !== 'steady' && t.direction !== 'unknown' && level !== 'normal')
      findings.push(`${def.name} is ${t.direction === 'rising' ? 'trending up' : 'trending down'} (${t.change > 0 ? '+' : ''}${t.change} ${def.unit} over the period).`)

    return {
      vitalId: def.id, name: def.name, unit: def.unit, icon: def.icon,
      latest: latest?.value ?? '—', latestAt: latest?.loggedAt ?? '—',
      average: t.average, min: vals.length ? Math.min(...vals) : 0, max: vals.length ? Math.max(...vals) : 0,
      target: `${thr.min}–${thr.max} ${def.unit}`, targetMin: thr.min, targetMax: thr.max,
      inRange: t.inRange, total: t.points.length, level,
      points, direction: t.direction, change: round(t.change),
      averageText: isBp && vals.length ? `${avg(vals)}/${avg(dia)}` : undefined,
      rangeText: isBp && vals.length ? `${Math.min(...vals)}–${Math.max(...vals)} / ${Math.min(...dia)}–${Math.max(...dia)}` : undefined,
    }
  })

  const used = patient.readings.filter(r => !r.invalid && r.at && r.at >= cutoff && tracked.some(d => d.id === r.vitalId))
  // Alerts for the vitals in this report, plus SOS calls (they concern the patient, not one vital).
  const names = new Set(tracked.map(d => d.name))
  const inPeriod = include.alerts
    ? alerts.filter(a => a.patientId === patient.id && a.at >= cutoff && (a.type === 'sos' || names.has(a.vitalName)))
    : []
  const open = inPeriod.filter(a => a.status !== 'resolved')
  if (inPeriod.length) findings.push(`${inPeriod.length} alert${inPeriod.length === 1 ? '' : 's'} raised in the period; ${open.length ? `${open.length} still open` : 'all resolved'}.`)
  const auto = inPeriod.filter(a => a.resolvedHow === 'remeasure').length
  if (auto) findings.push(`${auto} alert${auto === 1 ? '' : 's'} cleared by an in-range re-measurement; ${inPeriod.length - open.length - auto} closed by the care team.`)
  if (!rows.some(r => r.level === 'warning' || r.level === 'critical') && rows.some(r => r.total > 0))
    findings.unshift(`All ${picked.length ? 'reported' : 'tracked'} vitals were within target at the latest reading.`)

  const out = rows.filter(r => r.level === 'warning' || r.level === 'critical')
  const summary = [
    `${used.length} valid reading${used.length === 1 ? '' : 's'} across ${rows.filter(r => r.total > 0).length} of ${rows.length} ${picked.length ? 'reported' : 'tracked'} vitals in the last ${days} days.`,
    out.length ? `Latest reading outside target for: ${out.map(r => r.name).join(', ')}.` : 'All latest readings are inside target.',
    include.alerts ? `${inPeriod.length} alert${inPeriod.length === 1 ? '' : 's'} raised, ${open.length} still open.` : '',
  ].filter(Boolean).join(' ')

  const nameOf = (id: string) => defs.find(d => d.id === id)?.name ?? id
  const links: DocSourceLink[] = [
    ...used.map(r => ({ kind: 'reading' as const, id: r.id, label: `${nameOf(r.vitalId)} ${r.value} · ${r.loggedAt}` })),
    ...inPeriod.map(a => ({ kind: 'alert' as const, id: a.id, label: `${a.type === 'sos' ? 'SOS' : `${a.vitalName} ${a.value} ${a.unit}`} · ${a.loggedAt}` })),
    ...notes.map(n => ({ kind: 'note' as const, id: n.id, label: `Clinical note · ${n.at}` })),
  ]
  return {
    body: {
      type: 'vitals', periodDays: days, generatedAt: stamp(new Date(now)), rows,
      alerts: inPeriod.map(a => ({
        id: a.id, label: a.type === 'sos' ? `SOS · ${a.value}` : `${a.vitalName} ${a.value} ${a.unit}`, status: a.status, at: a.loggedAt,
        severity: a.severity, resolution: a.resolutionReason ? `${a.resolutionReason}${a.resolutionNote ? ` — ${a.resolutionNote}` : ''}` : undefined,
        outcome: a.status === 'resolved' ? resolvedHowLabel(a) : 'Unresolved',
        // The first step is the reading itself, which the row already shows.
        steps: alertStory(a, patient, defs.find(d => alertIsFor(a, d))).slice(1)
          .map(st => ({ when: st.when, text: st.detail ? `${st.title}: ${st.detail}` : st.title, by: st.by ? personName(st.by) : undefined })),
      })),
      readingsCount: used.length, summary, findings,
      periodStart: cutoff, periodEnd: now,
      medications: include.medications
        ? patient.prescriptions.filter(rx => rx.active).map(rx => ({ name: rx.medication, dose: rx.dosage, frequency: rx.frequency, purpose: rx.purpose }))
        : [],
      interpretation: interpretation?.trim() || undefined,
      notes: notes.length ? notes : undefined,
      include: { ...include, vitalIds: picked.length ? picked.map(d => d.id) : undefined },
    },
    links,
  }
}

/* ─── Policy self-check ─────────────────────────────────────────────── */

export interface SelfTest { name: string; pass: boolean }

/**
 * Runs the policy against a synthetic cast so admins can confirm the rules
 * hold in this build. Uses its own users and documents — never live data.
 */
export function runPolicySelfTests(now = Date.now()): SelfTest[] {
  const base = { email: '', phone: '', createdAt: '', verificationCode: '', password: '' }
  const pt: PatientUser = { ...base, id: 't_pt', name: 'Test Patient', role: 'patient', status: 'active', assignedDoctorId: 't_doc', trackedVitalIds: [], thresholds: {}, prescriptions: [], readings: [] }
  const other: PatientUser = { ...pt, id: 't_pt2', assignedDoctorId: 't_doc2' }
  const doc: DoctorUser = { ...base, id: 't_doc', name: 'Dr Test', role: 'doctor', status: 'active', specialty: '', licenseNo: '', hospital: '', approvalStatus: 'approved', assignedPatientIds: ['t_pt'] }
  const doc2: DoctorUser = { ...doc, id: 't_doc2', assignedPatientIds: ['t_pt2'] }
  const admin: AdminUser = { ...base, id: 't_adm', name: 'Admin', role: 'admin', status: 'active', isAssistant: false, permissions: [] }
  const asst: AdminUser = { ...base, id: 't_ast', name: 'Assistant', role: 'assistant', status: 'active', isAssistant: true, permissions: ['approve_doctors', 'create_users', 'view_logs', 'assign_healthworkers', 'approve_patient_requests', 'handle_support', 'monitor_patients', 'document_support'] }
  const users: AppUser[] = [pt, other, doc, doc2, admin, asst]

  const mk = (id: string, patch: Partial<MedicalDocument>): MedicalDocument => ({
    id, patientId: 't_pt', title: 'T', category: 'vitals_report', origin: 'system_generated', documentDate: '2026-09-01',
    createdAt: '', at: now, createdBy: 't_doc', seriesId: id, version: 1, links: [], visibility: 'care_team', status: 'released', ...patch,
  })
  const released = mk('t_rel', {})
  const draft = mk('t_draft', { status: 'draft' })
  const priv = mk('t_priv', { origin: 'patient_upload', status: undefined, visibility: 'private', createdBy: 't_pt', upload: { state: 'ready', progress: 100, attempts: 1, idempotencyKey: 'k1' } })
  const shared = mk('t_shared', { origin: 'patient_upload', status: undefined, createdBy: 't_pt', upload: { state: 'ready', progress: 100, attempts: 1, idempotencyKey: 'k2' } })
  const deleted = { ...shared, id: 't_del', deletedAt: now - 1000 }
  const docs = [released, draft, priv, shared, deleted]
  const grants: SupportGrant[] = [
    { id: 'g1', adminId: 't_adm', docId: 't_rel', reason: 'test', at: now, expiresAt: now + 60_000 },
    { id: 'g2', adminId: 't_adm', docId: 't_draft', reason: 'test', at: now - 3_600_000, expiresAt: now - 1 },
  ]
  const ctx: PolicyCtx = { users, grants, now }
  const lvl = (u: AppUser, d: MedicalDocument, c = ctx) => docAccess(u, d, c).level

  const reassigned: PolicyCtx = {
    ...ctx,
    users: users.map(u => u.id === 't_pt' ? { ...pt, assignedDoctorId: 't_doc2' } : u.id === 't_doc' ? { ...doc, assignedPatientIds: [] } : u.id === 't_doc2' ? { ...doc2, assignedPatientIds: ['t_pt2', 't_pt'] } : u),
  }
  const suspended: PolicyCtx = { ...ctx, users: users.map(u => u.id === 't_doc' ? { ...doc, status: 'suspended' as const } : u) }
  const probe = resolveDoc(other, 't_rel', docs, ctx)
  const missing = resolveDoc(other, 'doc_doesnotexist', docs, ctx)

  return [
    { name: 'Patient can open their own released report', pass: lvl(pt, released) === 'content' },
    { name: 'Draft report is invisible to the patient', pass: lvl(pt, draft) === 'none' },
    { name: 'Another patient cannot see the report', pass: lvl(other, released) === 'none' },
    { name: 'Assigned doctor can open the report', pass: lvl(doc, released) === 'content' },
    { name: 'Unassigned doctor is denied', pass: lvl(doc2, released) === 'none' },
    { name: 'Doctor loses access after reassignment', pass: lvl(doc, released, reassigned) === 'none' && lvl(doc2, released, reassigned) === 'content' },
    { name: 'Suspended doctor is denied', pass: suspended.users.find(u => u.id === 't_doc')!.status === 'suspended' && lvl(suspended.users.find(u => u.id === 't_doc')!, released, suspended) === 'none' },
    { name: 'Private upload is hidden from the doctor', pass: lvl(doc, priv) === 'none' && lvl(pt, priv) === 'content' },
    { name: 'Shared upload is visible to the doctor', pass: lvl(doc, shared) === 'content' },
    { name: 'Assistant with every permission sees metadata only', pass: lvl(asst, released) === 'metadata' && lvl(asst, priv) === 'metadata' },
    { name: 'Assistant and admin can never sign or release', pass: !canSign(asst, draft, ctx) && !canRelease(asst, draft, ctx) && !canSign(admin, draft, ctx) && !canRelease(admin, draft, ctx) },
    { name: 'Admin without a support grant sees metadata only', pass: lvl(admin, shared) === 'metadata' },
    { name: 'Admin support grant opens content for that document only', pass: lvl(admin, released) === 'content' && lvl(admin, shared) === 'metadata' },
    { name: 'Expired support grant no longer opens content', pass: lvl(admin, draft) === 'metadata' },
    { name: 'Staff never see titles from metadata', pass: titleFor(asst, released, 'metadata') !== released.title },
    { name: 'Deleted upload cannot be opened until restored', pass: lvl(pt, deleted) === 'metadata' && lvl(doc, deleted) === 'none' },
    { name: 'Unknown and forbidden IDs return the same response', pass: !probe.ok && !missing.ok && probe.error === missing.error },
    { name: 'Released clinical documents cannot be deleted', pass: !canDelete(doc, released, ctx) && canDelete(doc, draft, ctx) },
    { name: 'Disguised executables are rejected by name', pass: checkFileName('report.pdf.exe') !== null && checkFileName('scan.svg') !== null && checkFileName('lab.pdf') === null },
    { name: 'File content must match its extension', pass: verifyContent(FORMATS.find(f => f.id === 'pdf')!, new Uint8Array([0x4d, 0x5a, 0, 0])) !== null && verifyContent(FORMATS.find(f => f.id === 'pdf')!, new TextEncoder().encode('%PDF-1.7')) === null },
    { name: 'Office files with macros are rejected', pass: checkFileName('results.docm') !== null && checkFileName('results.docx') === null && checkFileName('labs.xlsx') === null },
    { name: 'PDFs with embedded scripts are rejected', pass: verifyContent(FORMATS.find(f => f.id === 'pdf')!, new TextEncoder().encode('%PDF-1.4 /OpenAction << /S /JavaScript >>')) !== null },
  ]
}

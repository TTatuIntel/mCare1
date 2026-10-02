/**
 * Single source of truth for evaluating vital readings.
 * Used by the alert engine (AppContext) and every screen that colours a value.
 */
import type { AppAlert, PatientUser, VitalDef, VitalReading } from './types'

export type VitalLevel = 'normal' | 'warning' | 'critical'

export interface Range { min: number; max: number }

/** Doctor's personal target overrides the admin default. */
export function targetRange(patient: PatientUser, def: VitalDef): Range {
  return patient.thresholds[def.id] ?? { min: def.normalMin, max: def.normalMax }
}

/** Admin default, unless the doctor has set a personal critical band for this patient. */
function criticalRange(def: VitalDef, patient?: PatientUser): Range {
  const override = patient?.criticalThresholds?.[def.id]
  if (override) return override
  const span = def.normalMax - def.normalMin
  return {
    min: def.criticalMin ?? def.normalMin - span * 0.25,
    max: def.criticalMax ?? def.normalMax + span * 0.25,
  }
}

export function parseValue(def: VitalDef, raw: string): { primary: number; secondary?: number } | null {
  const v = raw.trim()
  if (def.id === 'bp') {
    const m = v.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/)
    if (!m) return null
    return { primary: Number(m[1]), secondary: Number(m[2]) }
  }
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null
  return { primary: Number(v) }
}

/** Returns an error message, or null when the input is a plausible reading. */
export function validateReading(def: VitalDef, raw: string, unit = def.unit): string | null {
  if (!raw.trim()) return 'Enter a value.'
  const p = parseValue(def, raw)
  if (!p) return def.id === 'bp' ? 'Use the format 120/80.' : 'Enter a number, e.g. 72.'
  // `raw` is always in the canonical unit; `unit` only words the limits the way the patient typed them.
  if (p.primary < def.hardMin || p.primary > def.hardMax)
    return `That looks wrong — ${def.name} is usually between ${toDisplayUnit(def.hardMin, def.unit, unit)} and ${toDisplayUnit(def.hardMax, def.unit, unit)} ${unit}.`
  if (def.id === 'bp' && p.secondary !== undefined) {
    if (p.secondary < 30 || p.secondary > 150) return 'Diastolic (lower number) should be between 30 and 150.'
    if (p.secondary >= p.primary) return 'The first number (systolic) must be higher than the second.'
  }
  return null
}

function level(n: number, target: Range, crit: Range): VitalLevel {
  if (n <= crit.min || n >= crit.max) return 'critical'
  if (n < target.min || n > target.max) return 'warning'
  return 'normal'
}

const worse = (a: VitalLevel, b: VitalLevel): VitalLevel =>
  a === 'critical' || b === 'critical' ? 'critical' : a === 'warning' || b === 'warning' ? 'warning' : 'normal'

/** Evaluate a raw value for a patient. Unparseable values count as normal (they are rejected at input). */
export function evaluate(patient: PatientUser, def: VitalDef, raw: string): VitalLevel {
  const p = parseValue(def, raw)
  if (!p) return 'normal'
  let result = level(p.primary, targetRange(patient, def), criticalRange(def, patient))
  if (def.id === 'bp' && p.secondary !== undefined) {
    const dTarget = { min: def.diaNormalMin ?? 60, max: def.diaNormalMax ?? 90 }
    const dCrit = { min: def.diaCriticalMin ?? 40, max: def.diaCriticalMax ?? 120 }
    result = worse(result, level(p.secondary, dTarget, dCrit))
  }
  return result
}

/** Exposed so screens can show the effective critical band (doctor override or admin default). */
export function effectiveCriticalRange(def: VitalDef, patient?: PatientUser): Range {
  return criticalRange(def, patient)
}

/** Whether an alert is about this vital — by id, falling back to the name on alerts that carry no id. */
export function alertIsFor(a: AppAlert, def: VitalDef): boolean {
  return a.vitalId ? a.vitalId === def.id : a.vitalName === def.name
}

export function latestValid(patient: PatientUser, vitalId: string): VitalReading | undefined {
  return patient.readings.find(r => r.vitalId === vitalId && !r.invalid)
}

/**
 * Risk score 0–100 used to sort the doctor's patient board.
 * Open critical alerts weigh most, then out-of-range latest readings, then stale data.
 */
export function riskScore(
  patient: PatientUser,
  defs: VitalDef[],
  openAlerts: { severity: 'danger' | 'warning'; type: 'vital' | 'sos' }[],
  now = Date.now(),
): number {
  let score = 0
  openAlerts.forEach(a => { score += a.type === 'sos' ? 50 : a.severity === 'danger' ? 30 : 12 })
  patient.trackedVitalIds.forEach(id => {
    const def = defs.find(d => d.id === id)
    const r = latestValid(patient, id)
    if (!def || !r) return
    const l = evaluate(patient, def, r.value)
    score += l === 'critical' ? 15 : l === 'warning' ? 6 : 0
  })
  const last = patient.readings.find(r => r.at)?.at
  if (!last || now - last > 24 * 3600_000) score += 10
  return Math.min(100, score)
}

export function riskBand(score: number): { label: string; color: 'red' | 'amber' | 'green' } {
  if (score >= 45) return { label: 'Critical', color: 'red' }
  if (score >= 15) return { label: 'Watch', color: 'amber' }
  return { label: 'Stable', color: 'green' }
}

/** Health score shown to the patient: share of tracked vitals currently in range. */
export function healthScore(patient: PatientUser, defs: VitalDef[]): number | null {
  const evals = patient.trackedVitalIds
    .map(id => {
      const def = defs.find(d => d.id === id)
      const r = latestValid(patient, id)
      return def && r ? evaluate(patient, def, r.value) : null
    })
    .filter((x): x is VitalLevel => x !== null)
  if (evals.length === 0) return null
  const pts = evals.reduce((s, l) => s + (l === 'normal' ? 100 : l === 'warning' ? 55 : 15), 0)
  return Math.round(pts / evals.length)
}

/* ─── time helpers ─── */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function stamp(d = new Date()): string {
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${MONTHS[d.getMonth()]} ${d.getDate()} · ${t}`
}
export function dateLabel(d = new Date()): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}
/** The calendar day where the person is (YYYY-MM-DD), not the UTC day: at 1 a.m. in Nairobi it is already "today". */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'Just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr${h > 1 ? 's' : ''} ago`
  const d = Math.round(h / 24)
  return `${d} day${d > 1 ? 's' : ''} ago`
}
export function greeting(d = new Date()): string {
  const h = d.getHours()
  return h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,'
}

/** Minutes a critical alert may stay unacknowledged before it escalates to admin. */
export const ESCALATE_AFTER_MIN = 10
/** Patients may correct their own reading within this window. */
export const CORRECTION_WINDOW_MIN = 15
/**
 * Minutes a patient has to clear a warning-level alert themselves by logging a
 * fresh in-range reading. After this window only the care team can clear it.
 * Critical alerts are never self-clearing — a clinician always reviews those.
 */
export const SELF_CLEAR_WINDOW_MIN = 30

/** Age in whole years from a YYYY-MM-DD date of birth, as of `now`. */
export function calcAge(dob: string, now = new Date()): number | null {
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  let age = now.getFullYear() - d.getFullYear()
  const monthDiff = now.getMonth() - d.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) age--
  return age >= 0 ? age : null
}

/* ─── Units: device-dependent display/input, canonical storage ─────────
   Every reading, threshold and hard limit is stored in the vital's
   canonical unit (VitalDef.unit). Conversion only ever happens at the
   display boundary (toDisplayUnit) or the input boundary
   (fromDisplayUnit) — never in between. */

type Converter = { toCanonical: (v: number) => number; fromCanonical: (v: number) => number }

const UNIT_CONVERTERS: Record<string, Converter> = {
  '°F→°C': { toCanonical: c => c * 9 / 5 + 32, fromCanonical: f => (f - 32) * 5 / 9 },
  'kg→lb': { toCanonical: lb => lb / 2.20462, fromCanonical: kg => kg * 2.20462 },
  'mg/dL→mmol/L': { toCanonical: mmol => mmol * 18.0182, fromCanonical: mgdl => mgdl / 18.0182 },
  'cm→in': { toCanonical: inch => inch * 2.54, fromCanonical: cm => cm / 2.54 },
}

function converterFor(canonicalUnit: string, displayUnit: string): Converter | null {
  if (canonicalUnit === displayUnit) return null
  const key = `${canonicalUnit}→${displayUnit}`
  return UNIT_CONVERTERS[key] ?? null
}

const ROUND_DECIMALS: Record<string, number> = { '°C': 1, 'lb': 1, 'mmol/L': 1, 'in': 1 }

function roundForUnit(v: number, unit: string): number {
  const d = ROUND_DECIMALS[unit] ?? 0
  const f = 10 ** d
  return Math.round(v * f) / f
}

/** Convert a canonical-unit number to the patient's preferred display unit. */
export function toDisplayUnit(value: number, canonicalUnit: string, displayUnit: string): number {
  const c = converterFor(canonicalUnit, displayUnit)
  if (!c) return value
  return roundForUnit(c.fromCanonical(value), displayUnit)
}

/** Convert a number entered in the display unit back to the canonical unit for storage. */
export function fromDisplayUnit(value: number, canonicalUnit: string, displayUnit: string): number {
  const c = converterFor(canonicalUnit, displayUnit)
  if (!c) return value
  return c.toCanonical(value)
}

/** The unit a patient sees/enters this vital in — their preference, or the vital's canonical unit. */
export function displayUnitFor(def: VitalDef, patient?: PatientUser): string {
  const pref = patient?.unitPrefs?.[def.id]
  return pref && def.unitOptions?.includes(pref) ? pref : def.unit
}

/** Format a stored (canonical-unit) reading value for display, converting BP's two numbers independently. */
export function formatReadingValue(def: VitalDef, raw: string, displayUnit: string): string {
  const p = parseValue(def, raw)
  if (!p) return raw
  const primary = toDisplayUnit(p.primary, def.unit, displayUnit)
  if (p.secondary === undefined) return String(primary)
  return `${primary}/${toDisplayUnit(p.secondary, def.unit, displayUnit)}`
}

/**
 * Everything a patient-facing screen needs to show and accept one vital in
 * the patient's own unit. Storage, targets and alerts stay canonical; a
 * screen converts on the way out (`value`, `num`, `range`, `delta`) and on
 * the way in (`toCanonical`) — nowhere else.
 */
export function unitView(def: VitalDef, patient?: PatientUser) {
  const unit = displayUnitFor(def, patient)
  const num = (n: number) => toDisplayUnit(n, def.unit, unit)
  return {
    unit,
    /** Units this vital can be shown in; fewer than two means there is no choice to offer. */
    options: def.unitOptions ?? [],
    num,
    value: (raw: string) => formatReadingValue(def, raw, unit),
    range: (r: Range): Range => ({ min: num(r.min), max: num(r.max) }),
    /** Change between two canonical numbers, in the display unit. */
    delta: (from: number, to: number) => Math.round((num(to) - num(from)) * 10) / 10,
    /** First-to-last change across trend points (oldest → newest), in the display unit. */
    change: (pts: { value: number }[]) => (pts.length > 1
      ? Math.round((num(pts[pts.length - 1].value) - num(pts[0].value)) * 10) / 10 : 0),
    /** What the patient typed, as the canonical string that gets validated and stored. */
    toCanonical: (raw: string) => {
      const v = raw.trim().replace(/\s+/g, '')
      if (unit === def.unit || !/^-?\d+(\.\d+)?$/.test(v)) return v
      return String(Math.round(fromDisplayUnit(Number(v), def.unit, unit) * 10) / 10)
    },
  }
}

/* ─── Trends & auto-generated summaries ────────────────────────────────
   Everything below is read-only analysis over a patient's own readings.
   It never mutates state and never invents data: when there is too little
   history to say something honest, it says so instead of guessing. */

export type TrendDirection = 'rising' | 'falling' | 'steady' | 'unknown'

/** A span of time in epoch ms. An absent bound is open-ended. */
export interface TimeWindow { from?: number; to?: number }

/** One plotted reading. `secondary` is the diastolic number for blood pressure. */
export interface TrendPoint { id: string; at: number; value: number; secondary?: number; level: VitalLevel }

/** Best-effort epoch for a reading — falls back to parsing the display string. */
export function readingTime(r: VitalReading): number | null {
  if (typeof r.at === 'number') return r.at
  const t = Date.parse(r.loggedAt)
  return Number.isNaN(t) ? null : t
}

export interface VitalTrend {
  vitalId: string
  /** Readings used, oldest → newest. Invalid and unparseable ones are dropped. */
  points: TrendPoint[]
  direction: TrendDirection
  /** Signed change from the first to the last point, in canonical units. */
  change: number
  /** Change as a percentage of the first point. 0 when the first point is 0. */
  changePct: number
  /** Mean of the points, rounded to one decimal. */
  average: number
  /** How many of the points sat inside the patient's target band. */
  inRange: number
  /** Consecutive in-range readings counting back from the newest. */
  streak: number
  /** Latest value mapped to 0–1 across the target band, for the unified chart. */
  normalized: number | null
}

/** Smallest change worth calling a direction, as a share of the target band. */
const TREND_EPSILON = 0.08

/**
 * Build the trend for one vital over the last `span` days (0 = all history),
 * or over an explicit time window.
 * For blood pressure the systolic number carries the trend.
 */
export function vitalTrend(
  patient: PatientUser,
  def: VitalDef,
  span: number | TimeWindow = 30,
  now = Date.now(),
  /** Optional extra filter, e.g. only morning readings. */
  keep?: (r: VitalReading) => boolean,
): VitalTrend {
  const w: TimeWindow = typeof span === 'number' ? { from: span > 0 ? now - span * 86_400_000 : undefined } : span
  const points = patient.readings
    .filter(r => r.vitalId === def.id && !r.invalid && typeof r.at === 'number'
      && (w.from === undefined || r.at >= w.from) && (w.to === undefined || r.at <= w.to)
      && (!keep || keep(r)))
    .map((r): TrendPoint | null => {
      const p = parseValue(def, r.value)
      return p ? { id: r.id, at: r.at as number, value: p.primary, secondary: p.secondary, level: evaluate(patient, def, r.value) } : null
    })
    .filter((p): p is TrendPoint => p !== null)
    .sort((a, b) => a.at - b.at)

  const target = targetRange(patient, def)
  const band = Math.max(1, target.max - target.min)
  const empty: VitalTrend = {
    vitalId: def.id, points, direction: 'unknown', change: 0, changePct: 0,
    average: 0, inRange: 0, streak: 0, normalized: null,
  }
  if (points.length === 0) return empty

  const values = points.map(p => p.value)
  const first = values[0]
  const last = values[values.length - 1]
  const change = last - first
  const average = Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10
  const inRange = points.filter(p => p.level === 'normal').length

  let streak = 0
  for (let i = points.length - 1; i >= 0 && points[i].level === 'normal'; i--) streak++

  const normalized = Math.max(0, Math.min(1, (last - target.min) / band))

  if (points.length < 2) return { ...empty, average, inRange, streak, normalized }

  const direction: TrendDirection =
    Math.abs(change) < band * TREND_EPSILON ? 'steady' : change > 0 ? 'rising' : 'falling'

  return {
    vitalId: def.id, points, direction, change: Math.round(change * 10) / 10,
    changePct: first === 0 ? 0 : Math.round((change / first) * 1000) / 10,
    average, inRange, streak, normalized,
  }
}

export type InsightTone = 'good' | 'watch' | 'bad' | 'info'

export interface VitalInsight {
  id: string
  /** Vital this is about; absent for whole-plan observations. */
  vitalId?: string
  tone: InsightTone
  text: string
  /** A practical next step — about logging and measuring, never treatment. */
  next?: string
}

/** Human phrasing for a direction, given whether rising is bad for this vital. */
function directionWord(d: TrendDirection): string {
  return d === 'rising' ? 'trending up' : d === 'falling' ? 'trending down' : 'holding steady'
}

/**
 * Plain-language notes generated from the patient's own numbers.
 * Deliberately descriptive, never prescriptive — it reports what the data
 * shows and defers any advice to the doctor's own note.
 */
export function generateInsights(
  patient: PatientUser,
  defs: VitalDef[],
  days = 30,
  now = Date.now(),
): VitalInsight[] {
  const out: VitalInsight[] = []
  const tracked = defs.filter(d => patient.trackedVitalIds.includes(d.id) && d.active)

  tracked.forEach(def => {
    const t = vitalTrend(patient, def, days, now)
    if (t.points.length === 0) {
      out.push({ id: `${def.id}-none`, vitalId: def.id, tone: 'info', text: `No ${def.name.toLowerCase()} readings logged ${days > 0 ? `in the last ${days} days` : 'yet'}.`, next: 'Log a reading to start your trend.' })
      return
    }
    if (t.points.length === 1) {
      out.push({ id: `${def.id}-one`, vitalId: def.id, tone: 'info', text: `Only one ${def.name.toLowerCase()} reading so far — log a few more to see a trend.` })
      return
    }

    // Notes are read by the patient, so they speak in the patient's unit.
    const u = unitView(def, patient)
    const target = targetRange(patient, def)
    const shownTarget = u.range(target)
    const change = u.change(t.points)
    const average = u.num(t.average)
    const latest = t.points[t.points.length - 1]
    const pctInRange = Math.round((t.inRange / t.points.length) * 100)
    const remeasure = latest.level === 'normal' ? undefined
      : 'Rest for 5 minutes and measure again. Your care team can see this reading.'

    // Direction, but only when it actually crosses out of the target band or moves toward it.
    if (t.direction !== 'steady') {
      const towardRange =
        (t.direction === 'rising' && latest.value <= target.max) ||
        (t.direction === 'falling' && latest.value >= target.min)
      out.push({
        id: `${def.id}-dir`,
        vitalId: def.id,
        tone: latest.level === 'normal' ? (towardRange ? 'good' : 'watch') : 'bad',
        text: `${def.name} is ${directionWord(t.direction)} — ${change > 0 ? '+' : ''}${change} ${u.unit} across your last ${t.points.length} readings (avg ${average}).`,
        next: remeasure,
      })
    } else {
      out.push({
        id: `${def.id}-dir`,
        vitalId: def.id,
        tone: latest.level === 'normal' ? 'good' : 'watch',
        text: `${def.name} is holding steady around ${average} ${u.unit} over your last ${t.points.length} readings.`,
        next: remeasure,
      })
    }

    if (t.streak >= 3) {
      out.push({ id: `${def.id}-streak`, vitalId: def.id, tone: 'good', text: `${t.streak} ${def.name.toLowerCase()} readings in a row inside your target of ${shownTarget.min}–${shownTarget.max} ${u.unit}.` })
    } else if (pctInRange < 50) {
      out.push({ id: `${def.id}-range`, vitalId: def.id, tone: 'bad', text: `Only ${pctInRange}% of your ${def.name.toLowerCase()} readings were inside target — your doctor may want to review this.` })
    }
  })

  // Whole-plan observations
  const logged = tracked.filter(d => vitalTrend(patient, d, days, now).points.length > 0)
  if (tracked.length > 0 && logged.length < tracked.length) {
    const missing = tracked.filter(d => !logged.includes(d)).map(d => d.name).join(', ')
    out.push({ id: 'plan-gaps', tone: 'info', text: `Not logged recently: ${missing}. Regular readings give your doctor a clearer picture.`, next: 'Use “Log All Vitals” to catch up in one go.' })
  }
  const score = healthScore(patient, defs)
  if (score !== null) {
    out.push({
      id: 'plan-score',
      tone: score >= 80 ? 'good' : score >= 55 ? 'watch' : 'bad',
      text: `Overall, ${score}% of your latest readings sit inside the targets your doctor set.`,
    })
  }
  return out
}

/* ─── Check-in cadence ─────────────────────────────────────────────────
   How often each vital is expected to be logged. Drives the "fresh / due
   soon / overdue" state on the home card so a stale number never looks
   as current as one logged ten minutes ago. */

const CHECKIN_HOURS: Record<string, number> = {
  bp: 12, hr: 12, gluc: 12,
  temp: 24, spo2: 24, rr: 24,
  wt: 168, ht: 24 * 90, chol: 24 * 30,
}

export type CheckInState = 'fresh' | 'due-soon' | 'overdue' | 'none'

export interface CheckIn {
  state: CheckInState
  /** Share of the interval already elapsed, clamped 0–1. */
  elapsed: number
  /** Epoch ms the next reading is due; absent when nothing has been logged. */
  dueAt?: number
  intervalHours: number
}

/** Past this share of the interval a reading counts as "due soon". */
const DUE_SOON_AT = 0.8

export function checkInStatus(vitalId: string, lastAt: number | undefined, now = Date.now()): CheckIn {
  const intervalHours = CHECKIN_HOURS[vitalId] ?? 24
  if (lastAt === undefined) return { state: 'none', elapsed: 1, intervalHours }
  const span = intervalHours * 3600_000
  const ratio = (now - lastAt) / span
  return {
    state: ratio >= 1 ? 'overdue' : ratio >= DUE_SOON_AT ? 'due-soon' : 'fresh',
    elapsed: Math.max(0, Math.min(1, ratio)),
    dueAt: lastAt + span,
    intervalHours,
  }
}

/** Compact duration, e.g. "45m", "3h", "2d". */
export function shortDuration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/** Coarse grouping used to organise the bulk-log sheet. */
export type VitalGroup = 'cardiac' | 'metabolic' | 'respiratory' | 'body'

export const VITAL_GROUPS: { id: VitalGroup; label: string; icon: string; hint: string }[] = [
  { id: 'cardiac',     label: 'Heart & Circulation', icon: '🫀', hint: 'Sit and rest for 5 minutes first' },
  { id: 'respiratory', label: 'Breathing',           icon: '🫁', hint: 'Warm hands give a better reading' },
  { id: 'metabolic',   label: 'Metabolic',           icon: '🩸', hint: 'Note whether you had eaten' },
  { id: 'body',        label: 'Body Measurements',   icon: '⚖️', hint: 'Same time of day is most comparable' },
]

const GROUP_OF: Record<string, VitalGroup> = {
  bp: 'cardiac', hr: 'cardiac',
  spo2: 'respiratory', rr: 'respiratory',
  gluc: 'metabolic', chol: 'metabolic', temp: 'metabolic',
  wt: 'body', ht: 'body',
}

/** Which group a vital belongs to. Unknown vitals fall into body measurements. */
export function groupOf(vitalId: string): VitalGroup {
  return GROUP_OF[vitalId] ?? 'body'
}

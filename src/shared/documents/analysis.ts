/**
 * Suggested analysis for a vitals report.
 *
 * Reads the report's own figures (the same rows the patient will see) and
 * drafts an assessment and a plan in plain clinical language. It is a
 * starting point only: it lands in the interpretation box for the doctor to
 * edit, and nothing is on the report until the doctor signs it. It names no
 * drug doses and makes no diagnosis.
 */
import type { DocBody, PatientUser, VitalsReportRow } from '@/shared/lib/types'

type VitalsBody = Extract<DocBody, { type: 'vitals' }>

const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
const pct = (r: VitalsReportRow) => Math.round((r.inRange / Math.max(1, r.total)) * 100)

/** One sentence on a vital that is outside its target. */
function describe(r: VitalsReportRow): string {
  const last = r.points?.[r.points.length - 1]?.v
  const side = last === undefined || r.targetMin === undefined || r.targetMax === undefined ? 'outside'
    : last > r.targetMax ? 'above' : last < r.targetMin ? 'below' : 'outside'
  const parts = [`${r.name}: latest ${r.latest} ${r.unit} is ${r.level === 'critical' ? 'in the critical range' : `${side} target`} (target ${r.target})`]
  if (r.total > 1) parts.push(`average ${r.averageText ?? r.average}, ${pct(r)}% of ${r.total} readings in target`)
  if (r.total >= 3 && (r.direction === 'rising' || r.direction === 'falling'))
    parts.push(`trending ${r.direction === 'rising' ? 'up' : 'down'} (${(r.change ?? 0) > 0 ? '+' : ''}${r.change} ${r.unit})`)
  return `${parts.join('; ')}.`
}

export function suggestInterpretation(body: VitalsBody, patient?: PatientUser): string {
  const critical = body.rows.filter(r => r.level === 'critical')
  const warning = body.rows.filter(r => r.level === 'warning')
  const normal = body.rows.filter(r => r.level === 'normal' && r.total > 0)
  const silent = body.rows.filter(r => r.total === 0)
  // In target today, but out of it for much of the period.
  const unsettled = normal.filter(r => r.total >= 3 && pct(r) < 60)
  const openAlerts = body.alerts.filter(a => a.status !== 'resolved')
  const urgent = critical.length > 0 || openAlerts.some(a => a.severity === 'danger')
  const meds = body.medications ?? []
  const conditions = patient?.health?.conditions ?? []
  const first = patient?.name.split(' ')[0] ?? 'The patient'

  const assessment: string[] = []
  if (!body.readingsCount) {
    assessment.push(`No valid home readings were recorded in the last ${body.periodDays} days, so control cannot be assessed from this report.`)
  } else {
    assessment.push(urgent ? `Home monitoring over ${body.periodDays} days shows findings that need prompt review.`
      : warning.length ? `Home monitoring over ${body.periodDays} days shows ${warning.length === 1 ? 'one vital' : `${warning.length} vitals`} outside target.`
      : `Home monitoring over ${body.periodDays} days is reassuring: every vital with readings is within target at the latest reading.`)
    for (const r of [...critical, ...warning]) assessment.push(describe(r))
    for (const r of unsettled) assessment.push(`${r.name} is within target now but was in target for only ${pct(r)}% of ${r.total} readings.`)
    const steady = normal.filter(r => !unsettled.includes(r))
    if (steady.length && (critical.length || warning.length || unsettled.length)) assessment.push(`Within target: ${list(steady.map(r => r.name))}.`)
  }
  if (silent.length && body.readingsCount) assessment.push(`No readings in this period for ${list(silent.map(r => r.name))}.`)
  if (body.alerts.length) assessment.push(`${body.alerts.length} alert${body.alerts.length === 1 ? '' : 's'} raised in the period; ${openAlerts.length ? `${openAlerts.length} still open` : 'all resolved'}.`)
  if (conditions.length) assessment.push(`Known conditions: ${list(conditions)}.`)

  const plan: string[] = []
  if (urgent) plan.push(`Contact ${first} today to confirm the readings and check for symptoms; arrange an in-person assessment if they are confirmed.`)
  if (openAlerts.length) plan.push(`Review and close the ${openAlerts.length} open alert${openAlerts.length === 1 ? '' : 's'}.`)
  const off = [...critical, ...warning, ...unsettled]
  if (off.length) {
    plan.push(meds.length
      ? `Confirm ${first} is taking ${list(meds.map(m => m.name))} as prescribed, then review the management of ${list(off.map(r => r.name))}.`
      : `Review the management of ${list(off.map(r => r.name))}; no active prescriptions are recorded.`)
    plan.push(`Check measurement technique and timing, and re-check ${list(off.map(r => r.name))} ${urgent ? 'daily until settled' : 'over the next 1–2 weeks'}.`)
  }
  if (silent.length || !body.readingsCount) plan.push(`Ask ${first} to log ${silent.length && body.readingsCount ? list(silent.map(r => r.name)) : 'their vitals'} regularly so the next review has enough data.`)
  if (!off.length && !urgent && body.readingsCount) plan.push('Continue the current plan and home monitoring; routine review at the next appointment.')

  return `Assessment\n${assessment.join('\n')}\n\nPlan\n${plan.map(p => `• ${p}`).join('\n')}`
}

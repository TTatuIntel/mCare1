/**
 * Care pathways: from a patient's conditions to one proposed plan the treating doctor reviews.
 *
 * The catalogue (condition_defs and friends, migration 0020) suggests, per condition, how often to measure
 * each vital and a target, a daily fluid limit, a diet note and starter goals. A patient often has several
 * conditions; they merge by fixed rules, and anything that cannot merge is shown, never settled silently:
 *
 *   vitals      every vital any condition calls for
 *   frequency   the most frequent wins
 *   target      the strictest: the highest low end and the lowest high end; if those cross, it is a conflict
 *   fluid       the smallest limit
 *   diet, goals all of them, without repeats
 *
 * This is a suggestion for a clinician. Nothing here is applied: `apply_pathway` saves what the doctor confirms,
 * and the database checks it (who may, plausible values) whatever the screen sends.
 */
import type { ConditionDef, PatientUser, PathwayPlan, VitalDef, VitalFrequency } from './types'

const RANK: Record<VitalFrequency, number> = { as_needed: 0, weekly: 1, daily: 2, twice_daily: 3, three_times_daily: 4 }

export interface ProposedVital {
  vitalId: string
  name: string
  unit: string
  frequency?: VitalFrequency
  targetMin?: number
  targetMax?: number
  /** The conditions that call for it, by name. */
  from: string[]
  /** The condition the frequency came from (kept on the monitoring plan). */
  conditionCode?: string
  /** What the patient has now, to show what changes. */
  current: { tracked: boolean; frequency?: VitalFrequency; targetMin?: number; targetMax?: number }
  conflict?: string
}

export interface Proposal {
  /** The patient's conditions the catalogue knows, and those it does not (typed freely). */
  conditions: ConditionDef[]
  unknown: string[]
  vitals: ProposedVital[]
  fluidLimitGlasses?: number
  fluidFrom?: string
  dietNotes: string[]
  goals: { text: string; vitalId?: string; from: string }[]
  /** Conditions whose pathway an admin has not marked clinically reviewed. */
  unreviewed: string[]
  conflicts: string[]
}

/** The proposal for this patient from the catalogue. Empty when no condition is in the catalogue. */
export function proposePathway(patient: PatientUser, catalogue: ConditionDef[], vitalDefs: VitalDef[]): Proposal {
  const names = patient.health?.conditions ?? []
  const byName = (n: string) => catalogue.find(c => c.active && c.name.toLowerCase() === n.trim().toLowerCase())
  const conditions = names.map(byName).filter((c): c is ConditionDef => !!c)
  const unknown = names.filter(n => !byName(n))
  const conflicts: string[] = []
  const vitals = new Map<string, ProposedVital>()

  for (const c of conditions) {
    for (const id of c.vitals) {
      const def = vitalDefs.find(v => v.id === id && v.active)
      if (!def) continue
      const plan = c.vitalPlans?.[id] ?? {}
      const cur = vitals.get(id) ?? {
        vitalId: id, name: def.name, unit: def.unit, from: [],
        current: {
          tracked: patient.trackedVitalIds.includes(id), frequency: patient.vitalPlans?.[id]?.frequency,
          targetMin: patient.thresholds[id]?.min, targetMax: patient.thresholds[id]?.max,
        },
      } satisfies ProposedVital
      cur.from.push(c.name)
      if (plan.frequency && (!cur.frequency || RANK[plan.frequency] > RANK[cur.frequency])) { cur.frequency = plan.frequency; cur.conditionCode = c.code }
      if (!cur.conditionCode) cur.conditionCode = c.code
      if (plan.targetMin !== undefined) cur.targetMin = cur.targetMin === undefined ? plan.targetMin : Math.max(cur.targetMin, plan.targetMin)
      if (plan.targetMax !== undefined) cur.targetMax = cur.targetMax === undefined ? plan.targetMax : Math.min(cur.targetMax, plan.targetMax)
      vitals.set(id, cur)
    }
  }
  for (const v of vitals.values()) {
    if (v.targetMin !== undefined && v.targetMax !== undefined && v.targetMin >= v.targetMax) {
      v.conflict = `The targets for ${v.name} from ${v.from.join(' and ')} do not overlap: set it yourself.`
      conflicts.push(v.conflict)
      v.targetMin = undefined; v.targetMax = undefined
    }
  }

  let fluidLimitGlasses: number | undefined, fluidFrom: string | undefined
  for (const c of conditions) {
    if (c.fluidLimitGlasses && (fluidLimitGlasses === undefined || c.fluidLimitGlasses < fluidLimitGlasses)) { fluidLimitGlasses = c.fluidLimitGlasses; fluidFrom = c.name }
  }
  const dietNotes = [...new Set(conditions.map(c => c.dietNote?.trim()).filter((n): n is string => !!n))]
  const seen = new Set<string>()
  const goals = conditions.flatMap(c => (c.goals ?? []).map(g => ({ ...g, from: c.name })))
    .filter(g => { const k = g.text.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })

  return {
    conditions, unknown, vitals: [...vitals.values()], fluidLimitGlasses, fluidFrom, dietNotes, goals,
    unreviewed: conditions.filter(c => !c.reviewedAt).map(c => c.name), conflicts,
  }
}

/** The plan to apply from a proposal, as the doctor left it in the form. */
export function planFrom(p: Proposal, picks: {
  vitals: Record<string, { on: boolean; frequency?: VitalFrequency; targetMin?: string; targetMax?: string }>
  fluid: { on: boolean; glasses: string }
  diet: { on: boolean; text: string }
  goals: Record<number, boolean>
}): PathwayPlan {
  const n = (s?: string) => (s === undefined || s.trim() === '' ? undefined : Number(s))
  return {
    conditions: p.conditions.map(c => c.code),
    carePlanTitle: p.conditions.map(c => c.name).join(' · ').slice(0, 120) || undefined,
    vitals: p.vitals.filter(v => picks.vitals[v.vitalId]?.on).map(v => {
      const pick = picks.vitals[v.vitalId]
      return { vitalId: v.vitalId, frequency: pick.frequency, conditionCode: v.conditionCode, reason: v.from.join(', '),
        targetMin: n(pick.targetMin), targetMax: n(pick.targetMax) }
    }),
    fluidLimitGlasses: picks.fluid.on ? n(picks.fluid.glasses) : undefined,
    dietNote: picks.diet.on ? picks.diet.text.trim() || undefined : undefined,
    goals: p.goals.filter((_, i) => picks.goals[i]).map(g => ({ text: g.text, vitalId: g.vitalId })),
  }
}

/** What would stop the form being saved, in the doctor's words; null when it can go. */
export function planIssue(plan: PathwayPlan, vitalDefs: VitalDef[]): string | null {
  if (!plan.vitals.length && !plan.fluidLimitGlasses && !plan.dietNote && !plan.goals.length) return 'Choose at least one thing to set up.'
  for (const v of plan.vitals) {
    const def = vitalDefs.find(d => d.id === v.vitalId)
    if ((v.targetMin === undefined) !== (v.targetMax === undefined)) return `Give both ends of the target for ${def?.name ?? v.vitalId}, or neither.`
    if (v.targetMin !== undefined && v.targetMax !== undefined) {
      if (!Number.isFinite(v.targetMin) || !Number.isFinite(v.targetMax) || v.targetMin >= v.targetMax) return `The target for ${def?.name ?? v.vitalId} needs a low value below the high one.`
      if (def && (v.targetMin < def.hardMin || v.targetMax > def.hardMax)) return `The target for ${def.name} must be within ${def.hardMin} to ${def.hardMax} ${def.unit}.`
    }
  }
  if (plan.fluidLimitGlasses !== undefined && (!Number.isInteger(plan.fluidLimitGlasses) || plan.fluidLimitGlasses < 1 || plan.fluidLimitGlasses > 30))
    return 'A fluid limit must be between 1 and 30 glasses.'
  return null
}

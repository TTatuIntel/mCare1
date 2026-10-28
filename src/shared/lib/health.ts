/**
 * Health-profile vocabulary and helpers: the conditions and allergies offered
 * at setup, which vitals each condition calls for, and how complete a
 * patient's profile is.
 */
import type { AllergySeverity, BiologicalSex, BloodType, HealthProfile, PatientUser } from './types'
import { calcAge } from './vitals'

export type HealthSection = 'about' | 'conditions' | 'allergies'

export const EMPTY_HEALTH: HealthProfile = { allergies: [], conditions: [] }

/** The patient's health profile, with empty lists when nothing is recorded yet. */
export const healthOf = (p: PatientUser): HealthProfile => ({ ...EMPTY_HEALTH, ...p.health })

export const SEX_OPTIONS: { id: BiologicalSex; label: string }[] = [
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
  { id: 'intersex', label: 'Intersex' },
  { id: 'undisclosed', label: 'Prefer not to say' },
]
export const sexLabel = (s?: BiologicalSex) => SEX_OPTIONS.find(o => o.id === s)?.label

export const BLOOD_TYPES: BloodType[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

/**
 * Common long-term conditions, each with the vitals worth tracking for it
 * (ids from INITIAL_VITAL_DEFS). Picking a condition at setup pre-selects them.
 * Conditions not listed here are matched by body area (CONDITION_AREAS).
 */
export const COMMON_CONDITIONS: { name: string; icon: string; vitals: string[] }[] = [
  { name: 'High blood pressure',    icon: '🫀', vitals: ['bp', 'hr'] },
  { name: 'Type 2 diabetes',        icon: '🩸', vitals: ['gluc', 'wt'] },
  { name: 'Type 1 diabetes',        icon: '🩸', vitals: ['gluc'] },
  { name: 'Heart disease',          icon: '❤️', vitals: ['bp', 'hr', 'wt'] },
  { name: 'Heart failure',          icon: '💔', vitals: ['wt', 'bp', 'hr', 'spo2'] },
  { name: 'Asthma',                 icon: '🫁', vitals: ['spo2', 'rr'] },
  { name: 'COPD',                   icon: '🌬️', vitals: ['spo2', 'rr'] },
  { name: 'Chronic kidney disease', icon: '🧫', vitals: ['bp', 'wt'] },
  { name: 'High cholesterol',       icon: '🧪', vitals: ['chol'] },
  { name: 'Stroke (past)',          icon: '🧠', vitals: ['bp', 'hr'] },
  { name: 'HIV',                    icon: '🎗️', vitals: ['wt', 'temp'] },
  { name: 'Sickle cell disease',    icon: '🔴', vitals: ['temp', 'spo2'] },
  { name: 'Thyroid disorder',       icon: '🦋', vitals: ['wt', 'hr'] },
  { name: 'Epilepsy',               icon: '⚡', vitals: [] },
  { name: 'Arthritis',              icon: '🦴', vitals: [] },
  { name: 'Depression or anxiety',  icon: '🌧️', vitals: [] },
]

export const COMMON_ALLERGIES = [
  'Penicillin', 'Sulfa drugs', 'Aspirin / NSAIDs', 'Codeine',
  'Peanuts', 'Tree nuts', 'Shellfish', 'Eggs', 'Milk', 'Latex', 'Bee stings', 'Dust / pollen',
]

export const SEVERITIES: { id: AllergySeverity; label: string }[] = [
  { id: 'mild', label: 'Mild' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'severe', label: 'Severe' },
]

export const RELATIONSHIPS = ['Spouse', 'Partner', 'Parent', 'Child', 'Sibling', 'Guardian', 'Friend', 'Other']

/** A condition as the forms list it: from the live catalogue (condition_defs), or COMMON_CONDITIONS in demo mode. */
export type CatalogueCondition = { name: string; icon: string; vitals: string[] }

/**
 * Body areas, for conditions the catalogue does not list by name (typed in by
 * the patient, or worded differently: "high BP", "pre-diabetes", "lung
 * disease"). Each area is the vitals that watch that part of the body. A
 * match is only ever a suggestion the patient confirms; the catalogue's own
 * list always wins for a name it knows.
 */
export const CONDITION_AREAS: { area: string; match: RegExp; vitals: string[] }[] = [
  { area: 'Heart and circulation', vitals: ['bp', 'hr'],
    match: /blood pressure|hypertens|\bb\.?p\b|heart|cardi|coronary|angina|arrhythm|atrial|palpitat|stroke|vascular|aneurysm|circulat/ },
  { area: 'Fluid balance', vitals: ['wt', 'spo2'], match: /heart failure|o?edema|swelling|fluid/ },
  { area: 'Blood sugar', vitals: ['gluc', 'wt'], match: /diabet|sugar|glucose|insulin|glyc|gestational/ },
  { area: 'Breathing', vitals: ['spo2', 'rr'],
    match: /asthma|copd|lung|pulmon|bronch|emphysema|breath|respir|pneumon|tubercul|\btb\b|covid|apn(o)?ea|wheez/ },
  { area: 'Kidneys', vitals: ['bp', 'wt'], match: /kidney (disease|failure|problem)|renal|\bckd\b|nephr|dialysis/ },
  { area: 'Weight and metabolism', vitals: ['wt'], match: /obes|overweight|underweight|weight|malnutri|eating disorder|metabolic/ },
  { area: 'Thyroid', vitals: ['wt', 'hr'], match: /thyroid/ },
  { area: 'Cholesterol', vitals: ['chol'], match: /cholesterol|lipid|triglycer/ },
  { area: 'Infection and fever', vitals: ['temp'], match: /fever|infect|hiv|malaria|sepsis|cancer|chemo|lupus|immun/ },
  { area: 'Blood and oxygen', vitals: ['spo2', 'hr'], match: /an(a)?emi|sickle|thalass/ },
  { area: 'Pregnancy', vitals: ['bp', 'wt'], match: /pregnan|pre-?eclamp/ },
]

/**
 * The vitals one condition calls for: the catalogue's list for a name it
 * knows, otherwise every vital of each body area the name falls under.
 * `areas` names the areas matched (empty for a catalogue match, or no match).
 */
export function vitalsForCondition(name: string, catalogue: CatalogueCondition[] = COMMON_CONDITIONS): { vitals: string[]; areas: string[] } {
  const key = name.trim().toLowerCase()
  const known = catalogue.find(c => c.name.toLowerCase() === key)
  if (known) return { vitals: known.vitals, areas: [] }
  const hits = CONDITION_AREAS.filter(a => a.match.test(key))
  return { vitals: [...new Set(hits.flatMap(a => a.vitals))], areas: hits.map(a => a.area) }
}

/** Vitals suggested by the patient's conditions, in the order of the conditions, with the first condition that suggested each. */
export function suggestedVitals(conditions: string[], catalogue: CatalogueCondition[] = COMMON_CONDITIONS): Map<string, string> {
  const out = new Map<string, string>()
  for (const name of conditions) {
    for (const v of vitalsForCondition(name, catalogue).vitals) if (!out.has(v)) out.set(v, name)
  }
  return out
}

/** Each vital the patient's conditions call for, with every condition that calls for it (for "For High blood pressure · Heart disease"). */
export function conditionsByVital(conditions: string[], catalogue: CatalogueCondition[] = COMMON_CONDITIONS): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const name of conditions) {
    for (const v of vitalsForCondition(name, catalogue).vitals) out.set(v, [...(out.get(v) ?? []), name])
  }
  return out
}

/** What still needs filling in, in the patient's words. Empty when the profile is complete. */
export function healthGaps(p: PatientUser): string[] {
  const h = healthOf(p)
  const gaps: string[] = []
  if (!p.dob || calcAge(p.dob) === null) gaps.push('Date of birth')
  if (!h.sex) gaps.push('Sex')
  if (!h.noConditions && h.conditions.length === 0) gaps.push('Health conditions')
  if (!h.noKnownAllergies && h.allergies.length === 0) gaps.push('Allergies')
  if (!(p.emergencyContacts ?? []).length) gaps.push('Next of kin')
  return gaps
}

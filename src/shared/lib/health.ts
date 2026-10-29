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

/** Vitals suggested by the patient's conditions, most-called-for first, with the condition that suggested each. */
export function suggestedVitals(conditions: string[], catalogue: CatalogueCondition[] = COMMON_CONDITIONS): Map<string, string> {
  const out = new Map<string, string>()
  const chosen = new Set(conditions.map(c => c.toLowerCase()))
  for (const c of catalogue) {
    if (!chosen.has(c.name.toLowerCase())) continue
    for (const v of c.vitals) if (!out.has(v)) out.set(v, c.name)
  }
  return out
}

/** Which specialties look after which conditions (lower-case keywords matched against both). */
const SPECIALTY_FOR: [conditionWord: string, specialtyWord: string][] = [
  ['blood pressure', 'cardio'], ['heart', 'cardio'], ['cholesterol', 'cardio'], ['stroke', 'neuro'],
  ['diabetes', 'endocrin'], ['thyroid', 'endocrin'], ['asthma', 'pulmon'], ['copd', 'pulmon'],
  ['asthma', 'respir'], ['copd', 'respir'], ['kidney', 'nephro'], ['epilep', 'neuro'], ['arthritis', 'rheumat'],
  ['hiv', 'infect'], ['sickle', 'haemat'], ['sickle', 'hemat'], ['depress', 'psych'], ['anxiety', 'psych'],
]
const GENERALIST = ['internal', 'general', 'family']

/**
 * How well a doctor's specialty fits the patient's conditions: 2 a specialist for one of them (with that
 * condition), 1 a generalist, 0 no fit. Only a hint for ordering the doctor list; the care team decides.
 */
export function specialtyFit(specialty: string | undefined, conditions: string[]): { score: number; condition?: string } {
  const s = (specialty ?? '').toLowerCase()
  for (const c of conditions) {
    const name = c.toLowerCase()
    if (SPECIALTY_FOR.some(([cw, sw]) => name.includes(cw) && s.includes(sw))) return { score: 2, condition: c }
  }
  return { score: GENERALIST.some(g => s.includes(g)) ? 1 : 0 }
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

/**
 * Health-profile vocabulary and helpers: the conditions and allergies offered
 * at setup, which vitals each condition calls for, and how complete a
 * patient's profile is.
 */
import type { ConditionDef, AllergySeverity, BiologicalSex, BloodType, HealthProfile, PatientUser } from './types'
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

/**
 * Demo mode's copy of the care-pathway starting values the database seeds (migration 0020), by condition name.
 * Live mode reads them from the catalogue. Suggestions for the doctor, not yet clinically reviewed.
 */
export const DEMO_PATHWAYS: Record<string, Pick<ConditionDef, 'vitalPlans' | 'fluidLimitGlasses' | 'dietNote' | 'goals'>> = {
  'High blood pressure': { vitalPlans: { bp: { frequency: 'daily', targetMin: 90, targetMax: 130 } }, dietNote: 'Low salt (under 5 g a day): plenty of vegetables, fruit and whole grains.',
    goals: [{ text: 'Home blood pressure on target most days', vitalId: 'bp' }] },
  'Type 2 diabetes': { vitalPlans: { gluc: { frequency: 'twice_daily', targetMin: 80, targetMax: 130 }, wt: { frequency: 'weekly' } },
    dietNote: 'Regular meals; limit sugar, sweet drinks and refined starch.', goals: [{ text: 'Glucose before meals on target most days', vitalId: 'gluc' }] },
  'Type 1 diabetes': { vitalPlans: { gluc: { frequency: 'twice_daily', targetMin: 80, targetMax: 130 } },
    dietNote: 'Regular meals; limit sugar, sweet drinks and refined starch.', goals: [{ text: 'Glucose before meals on target most days', vitalId: 'gluc' }] },
  'Heart failure': { vitalPlans: { wt: { frequency: 'daily' }, bp: { frequency: 'daily' } }, fluidLimitGlasses: 6,
    dietNote: 'Low salt (under 5 g a day). All drinks count towards the daily fluid limit.',
    goals: [{ text: 'Weigh every morning; tell the doctor of a gain of 2 kg in 3 days', vitalId: 'wt' }, { text: 'Stay within the daily fluid limit' }] },
  'Chronic kidney disease': { vitalPlans: { bp: { frequency: 'daily', targetMin: 90, targetMax: 130 }, wt: { frequency: 'weekly' } },
    dietNote: 'Low salt; potassium, phosphate and protein as the doctor advises.', goals: [{ text: 'Blood pressure on target most days', vitalId: 'bp' }] },
  'Asthma': { vitalPlans: { spo2: { frequency: 'daily' } }, goals: [{ text: 'Know the oxygen level that means calling the doctor', vitalId: 'spo2' }] },
  'COPD': { vitalPlans: { spo2: { frequency: 'daily' } }, goals: [{ text: 'Know the oxygen level that means calling the doctor', vitalId: 'spo2' }] },
  'Heart disease': { vitalPlans: { bp: { frequency: 'daily' } } },
  'Stroke (past)': { vitalPlans: { bp: { frequency: 'daily' } } },
  'High cholesterol': { dietNote: 'Limit saturated fat and fried food; more fibre.' },
}

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

/**
 * Conditions where too much fluid is harmful (heart failure, kidney disease): the doctor sets a daily
 * fluid LIMIT, and the app never tells the patient to "drink 8 glasses". Returns the condition, or undefined.
 */
export function fluidRestrictionFor(conditions: string[]): string | undefined {
  return conditions.find(c => /heart failure|kidney|renal|dialysis/i.test(c))
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

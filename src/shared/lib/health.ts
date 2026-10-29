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
 * `keywords` are other words for it; a typed condition containing one is matched to it.
 * Conditions matching neither are matched by body area (CONDITION_AREAS).
 * The live catalogue (condition_defs, migration 0019 for keywords) seeds the same words.
 */
export const COMMON_CONDITIONS: CatalogueCondition[] = [
  { name: 'High blood pressure',    icon: '🫀', vitals: ['bp', 'hr'], keywords: ['high bp', 'hbp', 'htn'] },
  { name: 'Type 2 diabetes',        icon: '🩸', vitals: ['gluc', 'wt'], keywords: ['prediabetes', 'pre-diabetes', 'borderline diabetes', 'sugar'] },
  { name: 'Type 1 diabetes',        icon: '🩸', vitals: ['gluc'] },
  { name: 'Heart disease',          icon: '❤️', vitals: ['bp', 'hr', 'wt'] },
  { name: 'Heart failure',          icon: '💔', vitals: ['wt', 'bp', 'hr', 'spo2'], keywords: ['chf', 'weak heart'] },
  { name: 'Asthma',                 icon: '🫁', vitals: ['spo2', 'rr'] },
  { name: 'COPD',                   icon: '🌬️', vitals: ['spo2', 'rr'], keywords: ['emphysema', 'chronic bronchitis'] },
  { name: 'Chronic kidney disease', icon: '🧫', vitals: ['bp', 'wt'], keywords: ['kidney disease', 'kidney failure', 'ckd'] },
  { name: 'High cholesterol',       icon: '🧪', vitals: ['chol'], keywords: ['ldl', 'lipids', 'hyperlipid'] },
  { name: 'Stroke (past)',          icon: '🧠', vitals: ['bp', 'hr'], keywords: ['tia', 'mini stroke'] },
  { name: 'HIV',                    icon: '🎗️', vitals: ['wt', 'temp'] },
  { name: 'Sickle cell disease',    icon: '🔴', vitals: ['temp', 'spo2'], keywords: ['sickle', 'scd'] },
  { name: 'Thyroid disorder',       icon: '🦋', vitals: ['wt', 'hr'], keywords: ['hypothyroid', 'hyperthyroid', 'goitre', 'goiter', 'graves', 'hashimoto'] },
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
export type CatalogueCondition = {
  name: string; icon: string; vitals: string[]
  /** Other words patients use for it ("high bp", "sugar"); an admin keeps them in Settings → Conditions. */
  keywords?: string[]
}

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
 * The vitals one condition calls for, and how it was matched:
 * 1. the catalogue's list for a name it knows;
 * 2. else each catalogue condition whose keywords the name contains (`like`);
 * 3. else every vital of each body area the name falls under (`areas`).
 * `like` and `areas` are empty for an exact catalogue match, and both are empty with no match.
 */
export function vitalsForCondition(name: string, catalogue: CatalogueCondition[] = COMMON_CONDITIONS): { vitals: string[]; areas: string[]; like: string[] } {
  const key = name.trim().toLowerCase()
  if (!key) return { vitals: [], areas: [], like: [] }
  const known = catalogue.find(c => c.name.toLowerCase() === key)
  if (known) return { vitals: known.vitals, areas: [], like: [] }
  const alike = catalogue.filter(c => c.keywords?.some(k => k.trim().length > 1 && hasWords(key, k.trim().toLowerCase())))
  if (alike.length) return { vitals: [...new Set(alike.flatMap(c => c.vitals))], areas: [], like: alike.map(c => c.name) }
  const hits = CONDITION_AREAS.filter(a => a.match.test(key))
  return { vitals: [...new Set(hits.flatMap(a => a.vitals))], areas: hits.map(a => a.area), like: [] }
}

/**
 * A keyword starts at a word: "high bp" is in "my high bp", "tia" is not in "dementia".
 * A short one (3 letters or fewer) must also end at a word ("bp" is not in "bpd");
 * a longer one may run on ("hypothyroid" is in "hypothyroidism").
 */
function hasWords(text: string, words: string): boolean {
  const esc = words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${esc}${words.length <= 3 ? '($|[^a-z0-9])' : ''}`).test(text)
}

/** In words, how a typed condition was matched: "like Hypertension", "heart and circulation", or null for an exact name or no match. */
export function matchNote(name: string, catalogue: CatalogueCondition[] = COMMON_CONDITIONS): string | null {
  const { like, areas } = vitalsForCondition(name, catalogue)
  if (like.length) return `like ${like.join(', ')}`
  if (areas.length) return areas.join(', ').toLowerCase()
  return null
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

/** The patient's conditions that call for each vital. The catalogue an admin keeps is used once loaded, the built-in list until then. */
export function patientConditionsByVital(p: PatientUser, catalogue: CatalogueCondition[]): Map<string, string[]> {
  return conditionsByVital(healthOf(p).conditions, catalogue.length ? catalogue : undefined)
}

/**
 * Vitals the patient's conditions call for that they do not record yet ("High blood pressure recorded,
 * blood pressure not tracked"), for the doctor. Only vitals that are collected (`activeVitalIds`).
 */
export function conditionGaps(p: PatientUser, activeVitalIds: string[], catalogue: CatalogueCondition[]): { vitalId: string; conditions: string[] }[] {
  return [...patientConditionsByVital(p, catalogue)]
    .filter(([id]) => activeVitalIds.includes(id) && !p.trackedVitalIds.includes(id))
    .map(([vitalId, conditions]) => ({ vitalId, conditions }))
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

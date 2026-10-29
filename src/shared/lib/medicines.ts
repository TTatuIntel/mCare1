/**
 * Medicines: the checks a doctor sees while prescribing.
 *
 * The database is the rule (migration 0019: `prescription_allergy_check` refuses a medicine that matches a
 * recorded allergy unless the doctor gives a reason). This file mirrors it for the warning in the form and
 * for demo mode. Keep ALLERGY_DRUG_TERMS the same as the `allergy_drug_terms` rows.
 */
import type { Allergy, HoldRule, MealLink, MedicationDef, Prescription, RxRoute, VitalDef } from './types'

/** Allergy group (a fragment of how the allergy is written) → medicine-name fragments that belong to it. */
export const ALLERGY_DRUG_TERMS: Record<string, string[]> = {
  penicillin: ['penicillin', 'amoxicillin', 'ampicillin', 'flucloxacillin', 'cloxacillin', 'piperacillin', 'augmentin', 'co-amoxiclav', 'cef', 'ceph'],
  sulfa: ['sulfamethoxazole', 'co-trimoxazole', 'cotrimoxazole', 'septrin', 'bactrim', 'sulfasalazine', 'sulfadiazine'],
  nsaid: ['aspirin', 'ibuprofen', 'diclofenac', 'naproxen', 'indomethacin', 'ketoprofen', 'meloxicam', 'piroxicam', 'celecoxib', 'mefenamic'],
  aspirin: ['aspirin'],
  codeine: ['codeine', 'co-codamol', 'dihydrocodeine'],
}

/** The recorded allergies a medicine name matches (same test as `medication_allergy_conflict` in SQL). */
export function allergyConflicts(medication: string, allergies: Allergy[]): Allergy[] {
  const med = medication.trim().toLowerCase()
  if (med.length < 3) return []
  return allergies.filter(a => {
    const sub = a.substance.trim().toLowerCase()
    if (sub.length >= 3 && med.includes(sub)) return true
    return Object.entries(ALLERGY_DRUG_TERMS).some(([group, drugs]) => sub.includes(group) && drugs.some(d => med.includes(d)))
  })
}

/** "Penicillin (severe), …" — the wording the database uses in its refusal. */
export const conflictLabel = (hits: Allergy[]) => [...new Set(hits.map(a => `${a.substance} (${a.severity})`))].join(', ')

/** An active prescription for the same medicine (first word of the name), so the doctor does not prescribe it twice by mistake. */
export function alreadyTaking(medication: string, prescriptions: Prescription[]): Prescription | undefined {
  const word = medication.trim().toLowerCase().split(/\s+/)[0]
  if (!word || word.length < 3) return undefined
  return prescriptions.find(rx => rx.active && rx.medication.trim().toLowerCase().split(/\s+/)[0] === word)
}

/* ─── The catalogue (demo mode's copy of the 0021 seed rows; live mode loads medication_defs) ─── */
type Seed = [code: string, name: string, drugClass: string, doses: string, route: RxRoute, withMeal: MealLink, monitor: string, hold: HoldRule | undefined, note?: string]
const SEED: Seed[] = [
  ['amlodipine', 'Amlodipine', 'Calcium-channel blocker', '2.5 mg,5 mg,10 mg', 'oral', 'any', 'bp', { vitalId: 'bp', below: 100 }, 'Ankle swelling is common.'],
  ['lisinopril', 'Lisinopril', 'ACE inhibitor', '5 mg,10 mg,20 mg', 'oral', 'any', 'bp', { vitalId: 'bp', below: 100 }, 'A dry cough can be a side effect.'],
  ['enalapril', 'Enalapril', 'ACE inhibitor', '5 mg,10 mg,20 mg', 'oral', 'any', 'bp', { vitalId: 'bp', below: 100 }],
  ['losartan', 'Losartan', 'Angiotensin receptor blocker', '25 mg,50 mg,100 mg', 'oral', 'any', 'bp', { vitalId: 'bp', below: 100 }],
  ['hydrochlorothiazide', 'Hydrochlorothiazide', 'Thiazide diuretic', '12.5 mg,25 mg', 'oral', 'with', 'bp,wt', { vitalId: 'bp', below: 100 }, 'Take in the morning.'],
  ['furosemide', 'Furosemide', 'Loop diuretic', '20 mg,40 mg,80 mg', 'oral', 'any', 'wt,bp', { vitalId: 'bp', below: 95 }, 'Take in the morning; weigh daily.'],
  ['spironolactone', 'Spironolactone', 'Potassium-sparing diuretic', '25 mg,50 mg', 'oral', 'with', 'bp,wt', undefined],
  ['bisoprolol', 'Bisoprolol', 'Beta blocker', '1.25 mg,2.5 mg,5 mg,10 mg', 'oral', 'any', 'hr,bp', { vitalId: 'hr', below: 55 }, 'Do not stop suddenly.'],
  ['atenolol', 'Atenolol', 'Beta blocker', '25 mg,50 mg,100 mg', 'oral', 'any', 'hr,bp', { vitalId: 'hr', below: 55 }, 'Do not stop suddenly.'],
  ['metformin', 'Metformin', 'Biguanide', '500 mg,850 mg,1000 mg', 'oral', 'with', 'gluc', undefined, 'Take with food to ease the stomach.'],
  ['glibenclamide', 'Glibenclamide', 'Sulfonylurea', '2.5 mg,5 mg', 'oral', 'before', 'gluc', { vitalId: 'gluc', below: 70 }, 'Can cause low sugar: do not skip the meal.'],
  ['insulin_glargine', 'Insulin glargine', 'Long-acting insulin', 'per units prescribed', 'injection', 'any', 'gluc', { vitalId: 'gluc', below: 70 }],
  ['atorvastatin', 'Atorvastatin', 'Statin', '10 mg,20 mg,40 mg,80 mg', 'oral', 'any', '', undefined],
  ['simvastatin', 'Simvastatin', 'Statin', '10 mg,20 mg,40 mg', 'oral', 'any', '', undefined, 'Usually taken at night.'],
  ['aspirin_low', 'Aspirin (low dose)', 'Antiplatelet', '75 mg,81 mg', 'oral', 'after', '', undefined],
  ['salbutamol', 'Salbutamol inhaler', 'Short-acting bronchodilator', '100 mcg per puff', 'inhaled', 'any', 'spo2', undefined, 'For breathlessness, as needed.'],
  ['beclomethasone', 'Beclomethasone inhaler', 'Inhaled corticosteroid', '100 mcg per puff,200 mcg per puff', 'inhaled', 'any', 'spo2', undefined, 'Rinse the mouth after use.'],
  ['levothyroxine', 'Levothyroxine', 'Thyroid hormone', '25 mcg,50 mcg,100 mcg', 'oral', 'before', 'hr,wt', undefined, 'Take on an empty stomach.'],
  ['omeprazole', 'Omeprazole', 'Proton-pump inhibitor', '20 mg,40 mg', 'oral', 'before', '', undefined],
  ['paracetamol', 'Paracetamol', 'Analgesic', '500 mg,1 g', 'oral', 'any', '', undefined, 'No more than 4 g a day.'],
]
export const DEMO_MEDICATIONS: MedicationDef[] = SEED.map(([code, name, drugClass, doses, route, withMeal, monitor, hold, note]) => ({
  code, name, drugClass, forms: [], usualDoses: doses.split(','), route, withMeal, monitorVitals: monitor ? monitor.split(',') : [], holdIf: hold, note, active: true,
}))

/** The catalogue medicine a typed name begins with ("Amlodipine 5 mg" → Amlodipine); the longest name wins. */
export const catalogueMatch = (medication: string, catalogue: MedicationDef[]) => {
  const t = medication.trim().toLowerCase()
  if (t.length < 3) return undefined
  return catalogue.filter(m => m.active && t.startsWith(m.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0]
}

/** "Check Blood Pressure first: do not take it below 100 mmHg." */
export const holdLabel = (h: HoldRule, defs: VitalDef[]) => {
  const d = defs.find(v => v.id === h.vitalId)
  const limits = [h.below !== undefined ? `below ${h.below}` : '', h.above !== undefined ? `above ${h.above}` : ''].filter(Boolean).join(' or ')
  return `Check ${d?.name ?? h.vitalId} first: do not take it ${limits}${d ? ` ${d.unit}` : ''}`
}

/** Same checks as the database (prescription_structure) for demo mode and the form. Null when fine. */
export function structureIssue(rx: Pick<Prescription, 'times' | 'holdIf'>, defs: VitalDef[]): string | null {
  const t = rx.times ?? []
  if (t.length > 6) return 'A medicine can have up to 6 dose times a day.'
  if (t.some(x => !Number.isInteger(x) || x < 0 || x > 1439)) return 'Each dose time must be a time of day.'
  if (new Set(t).size !== t.length) return 'Two doses cannot be at the same time.'
  const h = rx.holdIf
  if (h) {
    const d = defs.find(v => v.id === h.vitalId)
    if (!d) return 'A hold rule needs a vital that is collected.'
    if (h.below === undefined && h.above === undefined) return 'A hold rule needs a low or a high limit.'
    const out = (n?: number) => n !== undefined && (!Number.isFinite(n) || n < d.hardMin || n > d.hardMax)
    if (out(h.below) || out(h.above) || (h.below !== undefined && h.above !== undefined && h.below >= h.above))
      return `The hold limits for ${d.name} must be within ${d.hardMin} to ${d.hardMax} ${d.unit}.`
  }
  return null
}

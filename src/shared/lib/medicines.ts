/**
 * Medicines: the checks a doctor sees while prescribing.
 *
 * The database is the rule (migration 0019: `prescription_allergy_check` refuses a medicine that matches a
 * recorded allergy unless the doctor gives a reason). This file mirrors it for the warning in the form and
 * for demo mode. Keep ALLERGY_DRUG_TERMS the same as the `allergy_drug_terms` rows.
 */
import type { Allergy, Prescription } from './types'

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

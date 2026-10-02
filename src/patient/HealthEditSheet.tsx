import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, SaveError, useSave } from '@/shared'
import type { HealthProfile } from '@/shared/lib/types'
import { usePatient } from './usePatient'
import { healthOf, suggestedVitals, type HealthSection } from '@/shared/lib/health'
import { AboutFields, AllergiesFields, ConditionsFields } from './healthForms'

const TITLES: Record<HealthSection, { title: string; subtitle: string }> = {
  about: { title: 'About you', subtitle: 'Date of birth and photo are in Edit Profile.' },
  conditions: { title: 'Long-term conditions', subtitle: 'Your care team sees these.' },
  allergies: { title: 'Allergies', subtitle: 'Your doctor sees these before prescribing.' },
}

/** Edits one section of the patient's health profile. Mount with a `key` per section so the draft starts fresh. */
export function HealthEditSheet({ section, onClose }: { section: HealthSection; onClose: () => void }) {
  const { vitalDefs } = useApp()
  const { patient, saveHealth } = usePatient()
  const saved = healthOf(patient)
  const [draft, setDraft] = useState<HealthProfile>(saved)
  const saving = useSave()

  const valid = section === 'conditions' ? !!draft.noConditions || draft.conditions.length > 0
    : section === 'allergies' ? !!draft.noKnownAllergies || draft.allergies.length > 0
    : true

  // Newly added conditions start tracking the vitals they call for; say so before saving.
  const added = draft.conditions.filter(c => !saved.conditions.includes(c))
  const newVitals = [...suggestedVitals(added).keys()]
    .filter(v => !patient.trackedVitalIds.includes(v))
    .map(v => vitalDefs.find(d => d.id === v && d.active))
    .filter(d => !!d)

  const save = async () => {
    if ((await saving.run(() => saveHealth(draft, newVitals.map(d => d.id)))).ok) onClose()
  }

  return (
    <BottomSheet open onClose={onClose} title={TITLES[section].title} subtitle={TITLES[section].subtitle}
      footer={<><SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton><SheetButton disabled={!valid || saving.busy} onClick={save}>{saving.busy ? 'Saving…' : 'Save'}</SheetButton></>}>
      {section === 'about' && (
        <AboutFields sex={draft.sex} bloodType={draft.bloodType} onChange={v => setDraft(d => ({ ...d, ...v }))} />
      )}
      {section === 'conditions' && (
        <>
          <ConditionsFields value={draft} onChange={v => setDraft(d => ({ ...d, ...v }))} />
          {newVitals.length > 0 && (
            <p className="text-[11px] text-teal-800 bg-teal-50 rounded-xl px-3 py-2">
              Saving will also start tracking {newVitals.map(d => d.name).join(', ')}.
            </p>
          )}
        </>
      )}
      {section === 'allergies' && (
        <AllergiesFields value={draft} onChange={v => setDraft(d => ({ ...d, ...v }))} />
      )}
      <SaveError message={saving.error} className="mt-3" />
    </BottomSheet>
  )
}

/**
 * Health-profile form sections. Controlled components shared by the
 * first-run setup (HealthSetup) and the Profile edit sheets, so each
 * question is asked the same way everywhere.
 */
import { useState } from 'react'
import { Field, inputCls } from '@/shared'
import type { Allergy, AllergySeverity, BiologicalSex, BloodType } from '@/shared/lib/types'
import { BLOOD_TYPES, COMMON_ALLERGIES, COMMON_CONDITIONS, RELATIONSHIPS, SEVERITIES, SEX_OPTIONS, type CatalogueCondition } from '@/shared/lib/health'
import { usePatient } from './usePatient'

/** Toggle chip: teal when selected (teal is the action colour). */
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`px-3 py-2 rounded-full text-xs font-semibold border transition-colors ${on ? 'bg-teal-700 border-teal-700 text-white' : 'bg-white border-gray-200 text-gray-700 active:bg-gray-50'}`}>
      {children}
    </button>
  )
}

/** Large either/or answer card, for questions that need an explicit answer. */
function ChoiceCard({ on, onClick, icon, title, body }: { on: boolean; onClick: () => void; icon: string; title: string; body: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`flex-1 rounded-2xl border-2 p-3 text-left transition-colors ${on ? 'border-teal-600 bg-teal-50' : 'border-gray-200 bg-white'}`}>
      <span className="text-xl">{icon}</span>
      <p className="text-sm font-bold text-gray-900 mt-1">{title}</p>
      <p className="text-[11px] text-gray-500 leading-snug">{body}</p>
    </button>
  )
}

/** Free-text "add your own" row used by conditions and allergies. */
function AddOwn({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState('')
  const add = () => { if (v.trim()) { onAdd(v.trim()); setV('') } }
  return (
    <div className="flex gap-2">
      <input value={v} onChange={e => setV(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
        placeholder={placeholder} className={inputCls} />
      <button type="button" onClick={add} disabled={!v.trim()}
        className={`px-4 rounded-xl text-sm font-bold flex-shrink-0 ${v.trim() ? 'bg-teal-700 text-white' : 'bg-gray-200 text-gray-400'}`}>
        Add
      </button>
    </div>
  )
}

/* ─── About you: sex + blood type ───────────────────────────────────── */
export function AboutFields({ sex, bloodType, onChange }: {
  sex?: BiologicalSex
  bloodType?: BloodType
  onChange: (v: { sex?: BiologicalSex; bloodType?: BloodType }) => void
}) {
  return (
    <>
      <Field label="Sex *">
        <div className="grid grid-cols-2 gap-2">
          {SEX_OPTIONS.map(o => (
            <Chip key={o.id} on={sex === o.id} onClick={() => onChange({ sex: o.id, bloodType })}>{o.label}</Chip>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">Some healthy ranges differ by sex, so this helps your doctor read your numbers.</p>
      </Field>
      <Field label="Blood type">
        <div className="grid grid-cols-4 gap-2">
          {BLOOD_TYPES.map(b => (
            <Chip key={b} on={bloodType === b} onClick={() => onChange({ sex, bloodType: b })}>{b}</Chip>
          ))}
        </div>
        <button type="button" onClick={() => onChange({ sex, bloodType: undefined })}
          className={`mt-2 w-full py-2 rounded-full text-xs font-semibold border ${bloodType === undefined ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-200 text-gray-500'}`}>
          I don't know
        </button>
      </Field>
    </>
  )
}

/* ─── Long-term conditions ──────────────────────────────────────────── */
export interface ConditionsValue { conditions: string[]; noConditions?: boolean; otherMedicines?: string }

export function ConditionsFields({ value, onChange }: { value: ConditionsValue; onChange: (v: ConditionsValue) => void }) {
  const { conditions, noConditions } = value
  // The catalogue an admin keeps (Settings → Conditions); the built-in list until it has loaded.
  const { conditionDefs } = usePatient()
  const catalogue: CatalogueCondition[] = conditionDefs.length ? conditionDefs : COMMON_CONDITIONS
  const toggle = (name: string) => onChange({
    ...value,
    noConditions: false,
    conditions: conditions.includes(name) ? conditions.filter(c => c !== name) : [...conditions, name],
  })
  const custom = conditions.filter(c => !catalogue.some(x => x.name.toLowerCase() === c.toLowerCase()))
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {catalogue.map(c => (
          <Chip key={c.name} on={conditions.includes(c.name)} onClick={() => toggle(c.name)}>{c.icon} {c.name}</Chip>
        ))}
        {custom.map(c => <Chip key={c} on onClick={() => toggle(c)}>🩺 {c} ✕</Chip>)}
      </div>
      <div className="mt-3">
        <AddOwn placeholder="Something else? Type it here" onAdd={c => !conditions.includes(c) && toggle(c)} />
      </div>
      <button type="button" onClick={() => onChange({ ...value, conditions: [], noConditions: !noConditions })} aria-pressed={!!noConditions}
        className={`mt-3 w-full py-3 rounded-2xl text-sm font-semibold border-2 transition-colors ${noConditions ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-200 text-gray-600'}`}>
        {noConditions ? '✓ ' : ''}I don't have any long-term conditions
      </button>
      <div className="mt-4">
        <Field label="Other medicines or supplements (optional)">
          <textarea value={value.otherMedicines ?? ''} rows={2}
            onChange={e => onChange({ ...value, otherMedicines: e.target.value })}
            placeholder="e.g. Vitamin D, herbal remedies, inhaler from another clinic"
            className={`${inputCls} resize-none`} />
        </Field>
      </div>
    </>
  )
}

/* ─── Allergies ─────────────────────────────────────────────────────── */
export interface AllergiesValue { allergies: Allergy[]; noKnownAllergies?: boolean }

export function AllergiesFields({ value, onChange }: { value: AllergiesValue; onChange: (v: AllergiesValue) => void }) {
  const { allergies, noKnownAllergies } = value
  // "Yes" with nothing added yet still needs to show the picker.
  const [saysYes, setSaysYes] = useState(allergies.length > 0)
  const hasSome = saysYes || allergies.length > 0

  const add = (substance: string) => {
    if (allergies.some(a => a.substance.toLowerCase() === substance.toLowerCase())) return
    onChange({ noKnownAllergies: false, allergies: [...allergies, { id: `al_${Date.now()}_${allergies.length}`, substance, severity: 'moderate' }] })
  }
  const patch = (id: string, p: Partial<Allergy>) => onChange({ ...value, allergies: allergies.map(a => a.id === id ? { ...a, ...p } : a) })
  const remove = (id: string) => onChange({ ...value, allergies: allergies.filter(a => a.id !== id) })

  return (
    <>
      <div className="flex gap-2">
        <ChoiceCard on={!!noKnownAllergies} icon="✅" title="No known allergies" body="Not allergic to any medicine or food I know of"
          onClick={() => { setSaysYes(false); onChange({ allergies: [], noKnownAllergies: true }) }} />
        <ChoiceCard on={hasSome && !noKnownAllergies} icon="⚠️" title="I have allergies" body="Medicines, foods or anything else"
          onClick={() => { setSaysYes(true); onChange({ ...value, noKnownAllergies: false }) }} />
      </div>

      {hasSome && !noKnownAllergies && (
        <div className="mt-4 sheet-fade">
          {allergies.length > 0 && (
            <div className="flex flex-col gap-2 mb-4">
              {allergies.map(a => (
                <div key={a.id} className="rounded-2xl border border-gray-200 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold text-gray-900">{a.substance}</p>
                    <button type="button" onClick={() => remove(a.id)} className="text-[11px] text-red-500 font-bold">Remove</button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    {SEVERITIES.map(s => (
                      <button key={s.id} type="button" onClick={() => patch(a.id, { severity: s.id as AllergySeverity })} aria-pressed={a.severity === s.id}
                        className={`py-1.5 rounded-lg text-[11px] font-bold border ${a.severity === s.id
                          ? s.id === 'severe' ? 'bg-red-600 border-red-600 text-white' : 'bg-teal-700 border-teal-700 text-white'
                          : 'bg-white border-gray-200 text-gray-500'}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <input value={a.reaction ?? ''} onChange={e => patch(a.id, { reaction: e.target.value })}
                    placeholder="Reaction, e.g. rash, swelling, trouble breathing" className={inputCls} />
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Tap to add</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {COMMON_ALLERGIES.filter(s => !allergies.some(a => a.substance === s)).map(s => (
              <Chip key={s} on={false} onClick={() => add(s)}>+ {s}</Chip>
            ))}
          </div>
          <AddOwn placeholder="Something else? Type it here" onAdd={add} />
        </div>
      )}
    </>
  )
}

/* ─── Next of kin ───────────────────────────────────────────────────── */
export interface KinValue { name: string; relationship: string; phone: string }

export const kinComplete = (k: KinValue) => !!k.name.trim() && k.phone.replace(/\D/g, '').length >= 9

export function NextOfKinFields({ value, onChange }: { value: KinValue; onChange: (v: KinValue) => void }) {
  return (
    <>
      <Field label="Full name *">
        <input value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} placeholder="e.g. Mary Wanjiku" className={inputCls} />
      </Field>
      <Field label="Relationship">
        <div className="flex flex-wrap gap-2">
          {RELATIONSHIPS.map(r => (
            <Chip key={r} on={value.relationship === r} onClick={() => onChange({ ...value, relationship: r })}>{r}</Chip>
          ))}
        </div>
      </Field>
      <Field label="Phone number *">
        <input type="tel" value={value.phone} onChange={e => onChange({ ...value, phone: e.target.value })} placeholder="+254 7XX XXX XXX" className={inputCls} />
      </Field>
    </>
  )
}

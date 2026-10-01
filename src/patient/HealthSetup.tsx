import { useRef, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Avatar, Field, Toggle, inputCls } from '@/shared'
import type { BiologicalSex, BloodType } from '@/shared/lib/types'
import { calcAge } from '@/shared/lib/vitals'
import { healthOf, suggestedVitals } from '@/shared/lib/health'
import { readSquarePhoto } from '@/shared/lib/photo'
import { usePatient } from './usePatient'
import {
  AboutFields, AllergiesFields, ConditionsFields, NextOfKinFields, kinComplete,
  type AllergiesValue, type ConditionsValue, type KinValue,
} from './healthForms'

type StepId = 'about' | 'conditions' | 'allergies' | 'kin' | 'tracking'

const STEPS: { id: StepId; icon: string; title: string; sub: string; optional?: boolean }[] = [
  { id: 'about', icon: '👤', title: 'About you', sub: 'The basics your care team needs to know you.' },
  { id: 'conditions', icon: '🩺', title: 'Any long-term conditions?', sub: "Pick any you've been diagnosed with. This shapes what mCare helps you track." },
  { id: 'allergies', icon: '⚠️', title: 'Any allergies?', sub: 'Your doctor sees this before prescribing anything.' },
  { id: 'kin', icon: '🤝', title: 'Your next of kin', sub: "Who should we call first in an emergency? They'll also be your first SOS contact.", optional: true },
  { id: 'tracking', icon: '📈', title: 'What should we track?', sub: "We've picked vitals based on your conditions. You can change these any time." },
]

const today = () => new Date().toISOString().slice(0, 10)

/**
 * First-run health-profile setup for new patients (profileSetup === 'pending').
 * Each step is saved as the patient moves on, so nothing is lost if they
 * leave half-way; the router sends them back here until they finish.
 */
export default function HealthSetup() {
  const { vitalDefs } = useApp()
  const { patient, saveHealth: saveHealthProfile, saveAbout, saveEmergencyContact, setTrackedVitals, completeSetup, signOut } = usePatient()
  const h = healthOf(patient)
  const contacts = patient.emergencyContacts ?? []
  const existingKin = contacts.find(c => c.nextOfKin) ?? contacts[0]

  const [step, setStep] = useState(0)
  const [finished, setFinished] = useState(false)

  const [dob, setDob] = useState(patient.dob ?? '')
  const [photo, setPhoto] = useState(patient.avatar?.photo)
  const [photoError, setPhotoError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [about, setAbout] = useState<{ sex?: BiologicalSex; bloodType?: BloodType }>({ sex: h.sex, bloodType: h.bloodType })
  const [cond, setCond] = useState<ConditionsValue>({ conditions: h.conditions, noConditions: h.noConditions, otherMedicines: h.otherMedicines })
  const [allergy, setAllergy] = useState<AllergiesValue>({ allergies: h.allergies, noKnownAllergies: h.noKnownAllergies })
  const [kin, setKin] = useState<KinValue>({ name: existingKin?.name ?? '', relationship: existingKin?.relationship ?? '', phone: existingKin?.phone ?? '' })
  const [kinSkipped, setKinSkipped] = useState(false)
  const [tracked, setTracked] = useState<string[]>(patient.trackedVitalIds)
  // Suggestions already applied, so going back and forth doesn't re-add ones the patient turned off.
  const applied = useRef(new Set<string>())

  const activeVitals = vitalDefs.filter(v => v.active)
  const suggestions = suggestedVitals(cond.conditions)
  const age = dob ? calcAge(dob) : null
  const current = STEPS[step]

  const valid: Record<StepId, boolean> = {
    about: age !== null && age <= 120 && !!about.sex,
    conditions: !!cond.noConditions || cond.conditions.length > 0,
    allergies: !!allergy.noKnownAllergies || allergy.allergies.length > 0,
    kin: kinComplete(kin),
    tracking: tracked.length > 0,
  }

  const saveHealth = () => saveHealthProfile({ ...about, ...cond, ...allergy })

  const save = (id: StepId) => {
    if (id === 'about') {
      saveAbout(dob, { gradient: patient.avatar?.gradient ?? 'teal', emoji: patient.avatar?.emoji ?? '', photo })
      saveHealth()
    }
    if (id === 'conditions') {
      saveHealth()
      const fresh = [...suggestions.keys()].filter(v => !applied.current.has(v) && activeVitals.some(d => d.id === v))
      fresh.forEach(v => applied.current.add(v))
      if (fresh.length) setTracked(t => [...new Set([...t, ...fresh])])
    }
    if (id === 'allergies') saveHealth()
    if (id === 'kin') {
      // Next of kin goes first, so the SOS sheet offers to call them.
      saveEmergencyContact({
        id: existingKin?.id, name: kin.name.trim(),
        relationship: kin.relationship || 'Next of kin', phone: kin.phone.trim(), nextOfKin: true,
      })
    }
    if (id === 'tracking') setTrackedVitals(tracked)
  }

  const next = () => {
    if (!valid[current.id]) return
    save(current.id)
    if (current.id === 'kin') setKinSkipped(false)
    if (step === STEPS.length - 1) setFinished(true)
    else setStep(step + 1)
  }
  const skip = () => { setKinSkipped(true); setStep(step + 1) }

  const pickPhoto = (file?: File) => {
    if (!file) return
    setPhotoError('')
    readSquarePhoto(file).then(setPhoto, (e: Error) => setPhotoError(e.message))
  }

  /* ─── Finished ─── */
  if (finished) {
    const rows = [
      { l: 'About you', v: [age !== null ? `${age} yrs` : '', about.bloodType ?? ''].filter(Boolean).join(' · ') || 'Saved' },
      { l: 'Conditions', v: cond.noConditions ? 'None' : `${cond.conditions.length} recorded` },
      { l: 'Allergies', v: allergy.noKnownAllergies ? 'None known' : `${allergy.allergies.length} recorded` },
      { l: 'Next of kin', v: kinSkipped ? 'Add later in Profile' : kin.name.trim(), warn: kinSkipped },
      { l: 'Tracking', v: `${tracked.length} vital${tracked.length === 1 ? '' : 's'}` },
    ]
    return (
      <div className="min-h-full flex flex-col px-6 pt-10 pb-6 bg-white screen-in">
        <div className="text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-3xl mx-auto">✓</div>
          <h2 className="text-2xl font-black text-gray-900 font-display mt-4">You're all set, {patient.name.split(' ')[0]}!</h2>
          <p className="text-sm text-gray-500 mt-1.5">Your care team can now see your health profile. Update it any time from Profile.</p>
        </div>
        <div className="mt-6 bg-gray-50 rounded-2xl px-4 py-1">
          {rows.map(r => (
            <div key={r.l} className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
              <p className="text-xs font-semibold text-gray-500">{r.l}</p>
              <p className={`text-xs font-bold ${r.warn ? 'text-amber-700' : 'text-gray-900'}`}>{r.v}</p>
            </div>
          ))}
        </div>
        <div className="flex-1 min-h-6" />
        <button onClick={completeSetup}
          className="w-full py-3.5 rounded-2xl bg-teal-700 text-white text-sm font-bold shadow-lg shadow-teal-700/25 active:scale-[.98] transition-transform">
          Go to my dashboard
        </button>
      </div>
    )
  }

  /* ─── Steps ─── */
  return (
    <div className="min-h-full flex flex-col bg-white">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur px-5 pt-3 pb-3">
        <div className="flex items-center justify-between h-7">
          {step > 0
            ? <button onClick={() => setStep(step - 1)} className="flex items-center gap-1 text-teal-700 text-sm font-semibold">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
                Back
              </button>
            : <span />}
          <p className="text-[11px] font-semibold text-gray-400">Step {step + 1} of {STEPS.length}</p>
          <button onClick={signOut} className="text-[11px] font-semibold text-gray-400">Sign out</button>
        </div>
        <div className="mt-2 flex gap-1" aria-hidden>
          {STEPS.map((s, i) => (
            <div key={s.id} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= step ? 'bg-teal-600' : 'bg-gray-200'}`} />
          ))}
        </div>
      </header>

      <main key={current.id} className="flex-1 px-5 pt-3 pb-4 screen-in">
        <div className="w-11 h-11 rounded-2xl bg-teal-50 flex items-center justify-center text-xl">{current.icon}</div>
        <h2 className="text-2xl font-black text-gray-900 font-display mt-3 leading-tight">{current.title}</h2>
        <p className="text-sm text-gray-500 mt-1 mb-5">{current.sub}</p>

        {current.id === 'about' && (
          <>
            <div className="flex items-center gap-4 mb-5">
              <Avatar name={patient.name} avatar={{ gradient: patient.avatar?.gradient ?? 'teal', emoji: patient.avatar?.emoji ?? '', photo }} size="lg" />
              <div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
                <button onClick={() => fileRef.current?.click()}
                  className="px-3 py-1.5 rounded-full bg-teal-50 border border-teal-100 text-[11px] font-bold text-teal-700">
                  📷 {photo ? 'Change photo' : 'Add a photo'}
                </button>
                {photo && <button onClick={() => setPhoto(undefined)} className="ml-2 text-[11px] font-bold text-red-500">Remove</button>}
                <p className="text-[10px] text-gray-400 mt-1.5">{photoError || 'Optional. Helps your care team recognise you.'}</p>
              </div>
            </div>
            <Field label="Date of birth *">
              <input type="date" value={dob} max={today()} onChange={e => setDob(e.target.value)} className={inputCls} />
              {age !== null && <p className="text-[11px] text-teal-700 font-semibold mt-1">Age: {age} years</p>}
            </Field>
            <AboutFields sex={about.sex} bloodType={about.bloodType} onChange={setAbout} />
          </>
        )}

        {current.id === 'conditions' && <ConditionsFields value={cond} onChange={setCond} />}

        {current.id === 'allergies' && <AllergiesFields value={allergy} onChange={setAllergy} />}

        {current.id === 'kin' && <NextOfKinFields value={kin} onChange={setKin} />}

        {current.id === 'tracking' && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {activeVitals.map((v, i) => {
              const why = suggestions.get(v.id)
              const on = tracked.includes(v.id)
              return (
                <div key={v.id} className={`flex items-center gap-3 px-3 py-2.5 ${i < activeVitals.length - 1 ? 'border-b border-gray-50' : ''}`}>
                  <span className="text-base w-6 text-center">{v.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{v.name}</p>
                    <p className={`text-[10px] ${why ? 'text-teal-700 font-semibold' : 'text-gray-400'}`}>{why ? `Suggested for ${why.toLowerCase()}` : v.unit}</p>
                  </div>
                  <Toggle on={on} onChange={() => setTracked(t => on ? t.filter(x => x !== v.id) : [...t, v.id])} />
                </div>
              )
            })}
          </div>
        )}
      </main>

      <footer className="sticky bottom-0 bg-white/95 backdrop-blur px-5 pt-3 pb-6 border-t border-gray-100 flex flex-col gap-2">
        <button onClick={next} disabled={!valid[current.id]}
          className={`w-full py-3.5 rounded-2xl text-sm font-bold transition-colors ${valid[current.id] ? 'bg-teal-700 text-white shadow-lg shadow-teal-700/25' : 'bg-gray-200 text-gray-400'}`}>
          {step === STEPS.length - 1 ? 'Finish' : 'Continue'}
        </button>
        {current.optional && (
          <button onClick={skip} className="text-xs font-semibold text-gray-500 py-1">Skip for now</button>
        )}
      </footer>
    </div>
  )
}

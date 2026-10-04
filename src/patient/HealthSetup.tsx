import { useRef, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Avatar, Field, Toggle, inputCls, SaveError, useSave } from '@/shared'
import type { BiologicalSex, BloodType, Outcome } from '@/shared/lib/types'
import { calcAge } from '@/shared/lib/vitals'
import { healthOf, sexLabel, suggestedVitals } from '@/shared/lib/health'
import { readSquarePhoto } from '@/shared/lib/photo'
import { AuthButton, AuthSkip } from '@/shared/auth/authKit'
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
 * Nothing is forced: any step can be skipped, and "Finish later" leaves for
 * the dashboard, where Home keeps a reminder to come back.
 */
export default function HealthSetup() {
  const { vitalDefs } = useApp()
  const { patient, saveHealth: saveHealthProfile, saveAbout, saveEmergencyContact, setTrackedVitals, completeSetup, skipSetup, signOut, conditionDefs } = usePatient()
  const h = healthOf(patient)
  const contacts = patient.emergencyContacts ?? []
  const existingKin = contacts.find(c => c.nextOfKin) ?? contacts[0]

  const [step, setStep] = useState(0)
  const [finished, setFinished] = useState(false)
  const saving = useSave()

  const [dob, setDob] = useState(patient.dob ?? '')
  const [photo, setPhoto] = useState(patient.avatar?.photo)
  const [photoError, setPhotoError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [about, setAbout] = useState<{ sex?: BiologicalSex; bloodType?: BloodType }>({ sex: h.sex, bloodType: h.bloodType })
  const [cond, setCond] = useState<ConditionsValue>({ conditions: h.conditions, noConditions: h.noConditions, otherMedicines: h.otherMedicines })
  const [allergy, setAllergy] = useState<AllergiesValue>({ allergies: h.allergies, noKnownAllergies: h.noKnownAllergies })
  const [kin, setKin] = useState<KinValue>({ name: existingKin?.name ?? '', relationship: existingKin?.relationship ?? '', phone: existingKin?.phone ?? '' })
  /** Steps passed over with "Skip this step": nothing was saved for them, and the summary says so. */
  const [skipped, setSkipped] = useState<StepId[]>([])
  const [tracked, setTracked] = useState<string[]>(patient.trackedVitalIds)
  // Suggestions already applied, so going back and forth doesn't re-add ones the patient turned off.
  const applied = useRef(new Set<string>())

  const activeVitals = vitalDefs.filter(v => v.active)
  const suggestions = suggestedVitals(cond.conditions, conditionDefs.length ? conditionDefs : undefined)
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

  /** Saves one step. The patient moves on only once it is saved, so nothing they typed is lost unnoticed. */
  const save = async (id: StepId): Promise<Outcome> => {
    if (id === 'about') {
      const about = await saveAbout(dob, { gradient: patient.avatar?.gradient ?? 'teal', emoji: patient.avatar?.emoji ?? '', photo })
      return about.ok ? saveHealth() : about
    }
    if (id === 'conditions') {
      const saved = await saveHealth()
      if (!saved.ok) return saved
      const fresh = [...suggestions.keys()].filter(v => !applied.current.has(v) && activeVitals.some(d => d.id === v))
      fresh.forEach(v => applied.current.add(v))
      if (fresh.length) setTracked(t => [...new Set([...t, ...fresh])])
      return saved
    }
    if (id === 'allergies') return saveHealth()
    if (id === 'kin') {
      // Next of kin goes first, so the SOS sheet offers to call them.
      return saveEmergencyContact({
        id: existingKin?.id, name: kin.name.trim(),
        relationship: kin.relationship || 'Next of kin', phone: kin.phone.trim(), nextOfKin: true,
      })
    }
    return setTrackedVitals(tracked)
  }

  const next = async () => {
    if (!valid[current.id]) return
    if (!(await saving.run(() => save(current.id))).ok) return
    setSkipped(s => s.filter(id => id !== current.id))
    advance()
  }
  const advance = () => {
    if (step === STEPS.length - 1) setFinished(true)
    else setStep(step + 1)
  }
  /** Moves on without saving this step. Tracking has nothing to leave blank: it keeps the vitals already chosen. */
  const skip = () => {
    saving.clear()
    if (current.id !== 'tracking') setSkipped(s => [...new Set([...s, current.id])])
    advance()
  }

  const pickPhoto = (file?: File) => {
    if (!file) return
    setPhotoError('')
    readSquarePhoto(file).then(setPhoto, (e: Error) => setPhotoError(e.message))
  }

  /* ─── Finished ─── */
  if (finished) {
    const chip = 'rounded-full bg-white border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-800'
    const none = (text: string) => <p className="text-xs text-gray-500">{text}</p>
    const notAdded = <p className="text-xs font-semibold text-amber-700">Not added yet. You can add it later in Profile.</p>
    const trackedDefs = activeVitals.filter(v => tracked.includes(v.id))
    const born = dob ? new Date(`${dob}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
    const facts = [
      { l: 'Date of birth', v: born },
      { l: 'Age', v: age !== null ? `${age} years` : '' },
      { l: 'Sex', v: sexLabel(about.sex) ?? '' },
      { l: 'Blood type', v: about.bloodType ?? 'Not sure' },
    ]
    /** Everything the patient entered, step by step; Edit reopens that step. */
    const sections: { id: StepId; body: React.ReactNode }[] = [
      { id: 'about', body: (
        <>
          <div className="flex items-center gap-3">
            <Avatar name={patient.name} avatar={{ gradient: patient.avatar?.gradient ?? 'teal', emoji: patient.avatar?.emoji ?? '', photo }} size="md" />
            <p className="text-sm font-bold text-gray-900 truncate">{patient.name}</p>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            {facts.map(f => (
              <div key={f.l}>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{f.l}</dt>
                <dd className="text-xs font-bold text-gray-900">{f.v || '—'}</dd>
              </div>
            ))}
          </dl>
        </>
      ) },
      { id: 'conditions', body: (
        <>
          {cond.conditions.length
            ? <div className="flex flex-wrap gap-1.5">{cond.conditions.map(c => <span key={c} className={chip}>{c}</span>)}</div>
            : none('No long-term conditions.')}
          {cond.otherMedicines?.trim() && (
            <p className="mt-2 text-xs text-gray-600"><span className="font-semibold text-gray-500">Other medicines: </span>{cond.otherMedicines.trim()}</p>
          )}
        </>
      ) },
      { id: 'allergies', body: allergy.allergies.length ? (
        <ul className="flex flex-col gap-1.5">
          {allergy.allergies.map(a => (
            <li key={a.id} className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-gray-900 truncate">{a.substance}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${a.severity === 'severe' ? 'bg-red-50 text-red-700' : a.severity === 'moderate' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{a.severity}</span>
            </li>
          ))}
        </ul>
      ) : none('No known allergies.') },
      { id: 'kin', body: !kinComplete(kin)
        ? notAdded
        : (
          <>
            <p className="text-xs font-bold text-gray-900">{kin.name.trim()}{kin.relationship && <span className="font-semibold text-gray-500"> · {kin.relationship}</span>}</p>
            <p className="mt-0.5 font-mono text-xs text-gray-600">{kin.phone.trim()}</p>
          </>
        ) },
      { id: 'tracking', body: (
        <div className="flex flex-wrap gap-1.5">
          {trackedDefs.map(v => <span key={v.id} className={chip}>{v.icon} {v.name}</span>)}
        </div>
      ) },
    ]
    const HEADINGS: Record<StepId, string> = { about: 'About you', conditions: 'Conditions', allergies: 'Allergies', kin: 'Next of kin', tracking: 'Tracking' }
    return (
      <div className="min-h-full flex flex-col bg-white screen-in">
        <div className="flex-1 w-full max-w-2xl mx-auto px-5 pt-8 pb-4">
          <div className="text-center">
            <div className="auth-pop w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-2xl mx-auto">✓</div>
            <h2 className="text-2xl font-black text-gray-900 font-display mt-3">You're all set, {patient.name.split(' ')[0]}!</h2>
            <p className="text-sm text-gray-500 mt-1.5">Here is what you told us. Your care team can now see it, and you can update it any time from Profile.</p>
          </div>
          <div className="mt-5 grid gap-3 @2xl:grid-cols-2">
            {sections.map(s => {
              const i = STEPS.findIndex(x => x.id === s.id)
              return (
                <section key={s.id} className={`rounded-2xl bg-gray-50 px-4 py-3 ${s.id === 'about' ? '@2xl:col-span-2' : ''}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                      <span aria-hidden>{STEPS[i].icon}</span>{HEADINGS[s.id]}
                    </h3>
                    <button onClick={() => { setFinished(false); setStep(i) }} aria-label={`Edit ${HEADINGS[s.id]}`}
                      className="text-[11px] font-bold text-teal-700 underline-offset-4 hover:underline">Edit</button>
                  </div>
                  {skipped.includes(s.id) ? notAdded : s.body}
                </section>
              )
            })}
          </div>
        </div>
        <footer className="sticky bottom-0 bg-white/95 backdrop-blur px-5 pt-3 pb-6 border-t border-gray-100 flex flex-col gap-2">
          <SaveError message={saving.error} />
          <AuthButton onClick={() => saving.run(completeSetup)} disabled={saving.busy}>{saving.busy ? 'Opening…' : 'Go to my dashboard'}</AuthButton>
        </footer>
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
            : <button onClick={signOut} className="text-[11px] font-semibold text-gray-400">Sign out</button>}
          <p className="text-[11px] font-semibold text-gray-400">Step <span className="font-mono">{step + 1}</span> of <span className="font-mono">{STEPS.length}</span></p>
          {/* Leaves the whole setup for the dashboard; what was entered so far is already saved. */}
          <button onClick={() => saving.run(skipSetup)} disabled={saving.busy}
            className="group flex items-center gap-1 rounded-full bg-teal-50 py-1 pl-2.5 pr-2 text-[11px] font-bold text-teal-700 transition-all hover:bg-teal-100 active:scale-95 disabled:opacity-50">
            Finish later
            <svg className="w-3 h-3 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
          </button>
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
        <SaveError message={saving.error} />
        <AuthButton onClick={next} disabled={!valid[current.id] || saving.busy}>{saving.busy ? 'Saving…' : step === STEPS.length - 1 ? 'Finish' : 'Continue'}</AuthButton>
        <AuthSkip onClick={skip}>Skip this step</AuthSkip>
      </footer>
    </div>
  )
}

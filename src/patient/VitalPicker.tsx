import { useApp } from '@/shared/state/AppContext'
import { Toggle, SaveError, useSave } from '@/shared'
import type { PatientUser, VitalDef } from '@/shared/lib/types'
import { unitView } from '@/shared/lib/vitals'
import { conditionsByVital, healthOf, vitalsForCondition, COMMON_CONDITIONS } from '@/shared/lib/health'
import { usePatient } from './usePatient'

/**
 * The patient chooses the vitals they track, matched to their health
 * conditions: the vitals their conditions call for come first, each saying
 * which condition it is for, and the ones not tracked yet can be switched on
 * one by one or all at once. A vital the doctor set (or any tracked vital
 * once a doctor is assigned) is locked: only the doctor removes it, and the
 * database keeps it whatever is sent (`set_tracked_vitals`).
 *
 * Used by the Vitals tab ("My Vitals") and Profile ("Vitals I Track").
 */
export function VitalPicker({ grid = false, onEditConditions }: {
  /** Tablet and web: cards flow into columns (the Vitals tab). The Profile sheet keeps one column. */
  grid?: boolean
  /** Opens the health profile's conditions, for a patient who has none recorded yet. */
  onEditConditions?: () => void
}) {
  const { vitalDefs } = useApp()
  const { patient, setTrackedVitals, canStopTracking, conditionDefs } = usePatient()
  const save = useSave()
  const catalogue = conditionDefs.length ? conditionDefs : undefined

  const conditions = healthOf(patient).conditions
  const forVital = conditionsByVital(conditions, catalogue)
  const active = vitalDefs.filter(v => v.active)
  const isOn = (id: string) => patient.trackedVitalIds.includes(id)
  const locked = (id: string) => isOn(id) && !canStopTracking(id)

  const matched = active.filter(v => forVital.has(v.id))
  const others = active.filter(v => !forVital.has(v.id))
  const missing = matched.filter(v => !isOn(v.id))

  // One save at a time, each from the list as saved: two quick taps never undo each other.
  const commit = (ids: string[]) => { void save.run(() => setTrackedVitals(ids)) }
  const toggle = (id: string) => {
    if (locked(id) || save.busy) return
    commit(isOn(id) ? patient.trackedVitalIds.filter(v => v !== id) : [...patient.trackedVitalIds, id])
  }
  const trackAllMatched = () => { if (!save.busy) commit([...patient.trackedVitalIds, ...missing.map(v => v.id)]) }

  const listCls = grid ? 'flex flex-col gap-2 @2xl:grid @2xl:grid-cols-2 @2xl:gap-3 @5xl:grid-cols-3' : 'flex flex-col gap-2'

  return (
    <div className="flex flex-col gap-3">
      <ConditionsMatch conditions={conditions} catalogue={catalogue}
        missing={missing} matchedCount={matched.length} busy={save.busy} onTrackAll={trackAllMatched} onEditConditions={onEditConditions} />
      <SaveError message={save.error} />

      {matched.length > 0 && (
        <section aria-labelledby="vp-matched">
          <SectionRule id="vp-matched" label="For your conditions" note={`${matched.length - missing.length}/${matched.length} on`} />
          <div className={`stagger-in ${listCls}`}>
            {matched.map(v => (
              <VitalChoice key={v.id} def={v} patient={patient} on={isOn(v.id)} locked={locked(v.id)}
                why={forVital.get(v.id)} onToggle={() => toggle(v.id)} />
            ))}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section aria-labelledby="vp-others">
          <SectionRule id="vp-others" label={matched.length ? 'Other vitals' : 'Vitals you can track'}
            note={`${others.filter(v => isOn(v.id)).length}/${others.length} on`} />
          <div className={`stagger-in ${listCls}`}>
            {others.map(v => (
              <VitalChoice key={v.id} def={v} patient={patient} on={isOn(v.id)} locked={locked(v.id)}
                onToggle={() => toggle(v.id)} />
            ))}
          </div>
        </section>
      )}

      <p className="text-[11px] text-gray-400 px-1">
        {patient.assignedDoctorId
          ? 'Once you track a vital, only your doctor can stop it.'
          : 'Vitals your doctor sets are locked; the rest are yours to switch on and off.'}
      </p>
    </div>
  )
}

/** Labels a group of vitals: name on the left, how many are on at the right. */
function SectionRule({ id, label, note }: { id: string; label: string; note: string }) {
  return (
    <div className="flex items-center gap-2 mb-2 px-1">
      <h3 id={id} className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</h3>
      <div className="flex-1 h-px bg-gray-100" />
      <span className="text-[10px] text-gray-400 font-mono">{note}</span>
    </div>
  )
}

/**
 * The patient's conditions and what they call for: "3 of your conditions call
 * for 4 vitals · 1 not tracked yet [Track it]". With no conditions recorded, a
 * way to add them.
 */
function ConditionsMatch({ conditions, catalogue, missing, matchedCount, busy, onTrackAll, onEditConditions }: {
  conditions: string[]
  catalogue?: { name: string; icon: string; vitals: string[] }[]
  missing: VitalDef[]
  matchedCount: number
  busy: boolean
  onTrackAll: () => void
  onEditConditions?: () => void
}) {
  if (!conditions.length) {
    return (
      <div className="rounded-2xl bg-teal-50/70 ring-1 ring-teal-100 px-3.5 py-3 flex items-center gap-3">
        <span className="text-xl" aria-hidden="true">🩺</span>
        <p className="flex-1 text-xs text-teal-900 leading-relaxed">
          Add your health conditions and mCare will suggest the vitals that watch them.
        </p>
        {onEditConditions && (
          <button type="button" onClick={onEditConditions}
            className="flex-shrink-0 rounded-full bg-teal-700 px-3 py-1.5 text-[11px] font-bold text-white transition-transform active:scale-95">
            Add
          </button>
        )}
      </div>
    )
  }
  const list = catalogue ?? COMMON_CONDITIONS
  return (
    <div className="rounded-2xl bg-white shadow-sm px-3.5 py-3">
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Your conditions</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {conditions.map((c, i) => {
          const known = list.find(d => d.name.toLowerCase() === c.toLowerCase())
          const { vitals, areas } = vitalsForCondition(c, catalogue)
          return (
            <li key={c} style={{ animationDelay: `${i * 50}ms` }}
              title={areas.length ? `Matched by area: ${areas.join(', ')}` : undefined}
              className="chip-in inline-flex items-center gap-1 rounded-full bg-gray-50 ring-1 ring-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-700">
              <span aria-hidden="true">{known?.icon ?? '🩺'}</span>{c}
              {vitals.length === 0 && <span className="font-normal text-gray-400">· no vitals</span>}
            </li>
          )
        })}
      </ul>
      <div className="mt-2.5 flex items-center gap-2">
        <p className="flex-1 text-xs text-gray-600 leading-snug">
          {matchedCount === 0 ? 'None of them calls for a vital mCare measures.'
            : missing.length === 0 ? <>Every vital they call for is tracked. <span aria-hidden="true">✓</span></>
            : <>{missing.length === 1 ? `${missing[0].name} is` : `${missing.length} vitals are`} suggested but not tracked yet.</>}
        </p>
        {missing.length > 0 && (
          <button type="button" onClick={onTrackAll} disabled={busy}
            className="flex-shrink-0 rounded-full bg-teal-700 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm shadow-teal-700/30 transition-all hover:bg-teal-800 active:scale-95 disabled:opacity-50">
            {missing.length === 1 ? 'Track it' : `Track all ${missing.length}`}
          </button>
        )}
      </div>
    </div>
  )
}

/** One vital: its range, why the patient's conditions call for it, and the switch (or the doctor's lock). */
function VitalChoice({ def, patient, on, locked, why, onToggle }: {
  def: VitalDef; patient: PatientUser; on: boolean; locked: boolean
  /** The patient's conditions that call for this vital. */
  why?: string[]
  onToggle: () => void
}) {
  const thr = patient.thresholds[def.id]
  const u = unitView(def, patient)
  const shown = u.range(thr ?? { min: def.normalMin, max: def.normalMax })
  const suggested = !!why?.length && !on
  return (
    <div data-on={on}
      className={`vital-choice bg-white rounded-2xl flex items-center gap-3 px-3.5 py-3 shadow-sm ring-1 transition-[box-shadow,background-color] duration-300 ${
        locked ? 'ring-blue-100' : on ? 'ring-teal-200' : suggested ? 'ring-amber-200 bg-amber-50/40' : 'ring-transparent'}`}>
      <div className={`vital-choice-icon w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 transition-colors duration-300 ${
        locked ? 'bg-blue-50' : on ? 'bg-teal-50' : 'bg-gray-50'}`} aria-hidden="true">
        {def.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{def.name}</p>
        <p className="text-[11px] text-gray-400 truncate">
          {thr
            ? <span className="text-blue-500 font-semibold">🔒 Doctor range: {shown.min}–{shown.max} {u.unit}</span>
            : `Usual range: ${shown.min}–${shown.max} ${u.unit}`}
        </p>
        {!!why?.length && (
          <p className={`mt-1 text-[10px] font-semibold truncate ${on ? 'text-teal-700' : 'text-amber-700'}`}>
            {on ? 'For ' : 'Suggested for '}{why.join(' · ')}
          </p>
        )}
      </div>
      {locked ? (
        <div className="flex items-center gap-1 bg-blue-100 px-2 py-0.5 rounded-full flex-shrink-0">
          <span className="text-[9px]" aria-hidden="true">🔒</span>
          <span className="text-[10px] font-bold text-blue-600">Locked</span>
        </div>
      ) : (
        <Toggle on={on} onChange={onToggle} label={`Track ${def.name}`} />
      )}
    </div>
  )
}

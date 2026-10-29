import { useState } from 'react'
import { BottomSheet, SheetButton, Field, inputCls, Pill, useSave, SaveError, useToast } from '@/shared'
import { FREQUENCY_LABELS } from '@/shared/lib/types'
import type { PatientUser, VitalFrequency } from '@/shared/lib/types'
import { planFrom, planIssue, type Proposal } from '@/shared/lib/pathways'
import { useDoctor } from './useDoctor'

const FREQS = Object.keys(FREQUENCY_LABELS) as VitalFrequency[]
type Picks = Parameters<typeof planFrom>[1]

const picksFor = (p: Proposal): Picks => ({
  vitals: Object.fromEntries(p.vitals.map(v => [v.vitalId, {
    on: true, frequency: v.frequency ?? v.current.frequency,
    targetMin: v.targetMin !== undefined ? String(v.targetMin) : v.current.targetMin !== undefined ? String(v.current.targetMin) : '',
    targetMax: v.targetMax !== undefined ? String(v.targetMax) : v.current.targetMax !== undefined ? String(v.current.targetMax) : '',
  }])),
  fluid: { on: p.fluidLimitGlasses !== undefined, glasses: String(p.fluidLimitGlasses ?? '') },
  diet: { on: p.dietNotes.length > 0, text: p.dietNotes.join(' ') },
  goals: Object.fromEntries(p.goals.map((_, i) => [i, true])),
})

/* ─── Care from conditions ────────────────────────────────────────────
   The patient's conditions suggest a starting plan (how often to measure each
   vital and a target, a fluid limit, a diet note, care-plan goals). The doctor
   reviews and edits it here and applies it in one step; nothing is applied
   without them. Several conditions are merged: the most frequent measuring,
   the strictest target, the smallest fluid limit; a clash is shown, not hidden. */
export function PathwayCard({ patient }: { patient: PatientUser }) {
  const { proposalFor, vitalDefs, applyPathway } = useDoctor()
  const proposal = proposalFor(patient)
  const [picks, setPicks] = useState<Picks | null>(null)
  const save = useSave()
  const toast = useToast()
  const names = patient.health?.conditions ?? []
  const plan = picks ? planFrom(proposal, picks) : null
  const issue = plan ? planIssue(plan, vitalDefs) : null
  const setVital = (id: string, patch: Partial<Picks['vitals'][string]>) => setPicks(p => p && { ...p, vitals: { ...p.vitals, [id]: { ...p.vitals[id], ...patch } } })

  const apply = async () => {
    if (!plan || issue) return
    if (!(await save.run(() => applyPathway(patient.id, plan))).ok) return
    setPicks(null)
    toast.show(`Care set up${plan.goals.length ? ' · draft care plan ready to start' : ''} · patient told`)
  }

  return (
    <section className="bg-white rounded-2xl p-4 shadow-sm" aria-label="Care from conditions">
      {toast.node && <div className="mb-2">{toast.node}</div>}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-gray-900">Care from conditions</p>
        {proposal.unreviewed.length > 0 && proposal.conditions.length > 0 && <Pill color="amber">Check values</Pill>}
      </div>
      {names.length === 0 ? (
        <p className="text-xs text-gray-400 mt-1">No conditions recorded yet. Once the patient's conditions are in their health profile, mCare suggests a starting plan here.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {proposal.conditions.map(c => <span key={c.code} className="text-[11px] font-semibold bg-teal-50 text-teal-800 rounded-full px-2.5 py-1">{c.icon} {c.name}</span>)}
            {proposal.unknown.map(n => <span key={n} className="text-[11px] bg-gray-100 text-gray-500 rounded-full px-2.5 py-1" title="Not in the conditions catalogue">{n}</span>)}
          </div>
          <p className="text-[11px] text-gray-500 mt-2 leading-snug">
            {proposal.conditions.length
              ? `Suggests: ${proposal.vitals.length} vital${proposal.vitals.length === 1 ? '' : 's'} to monitor${proposal.fluidLimitGlasses ? `, a fluid limit of ${proposal.fluidLimitGlasses} glasses` : ''}${proposal.goals.length ? `, ${proposal.goals.length} care-plan goal${proposal.goals.length === 1 ? '' : 's'}` : ''}. You review everything before it is applied.`
              : 'None of these conditions is in the catalogue yet, so there is nothing to suggest.'}
          </p>
          {proposal.conditions.length > 0 && (
            <button onClick={() => { save.clear(); setPicks(picksFor(proposal)) }} className="w-full mt-3 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-bold">Review and set up</button>
          )}
        </>
      )}

      <BottomSheet open={!!picks} onClose={() => setPicks(null)} title="Set up care from conditions" subtitle={`For ${patient.name} · ${proposal.conditions.map(c => c.name).join(', ')}`}
        footer={<><SheetButton tone="ghost" onClick={() => setPicks(null)}>Cancel</SheetButton>
          <SheetButton disabled={!!issue || save.busy} onClick={apply}>{save.busy ? 'Applying…' : 'Apply'}</SheetButton></>}>
        {picks && (
          <>
            {proposal.unreviewed.length > 0 && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-3 leading-snug">
                ⚠ The starting values for {proposal.unreviewed.join(', ')} have not been clinically reviewed yet. Check each one for this patient.
              </p>
            )}
            {proposal.conflicts.map(c => <p key={c} className="text-[11px] text-red-700 bg-red-50 rounded-xl px-3 py-2 mb-2">{c}</p>)}

            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Monitoring</p>
            {proposal.vitals.map(v => {
              const pick = picks.vitals[v.vitalId]
              return (
                <div key={v.vitalId} className={`border rounded-xl p-3 mb-2 ${pick.on ? 'border-teal-200' : 'border-gray-100 opacity-60'}`}>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={pick.on} onChange={e => setVital(v.vitalId, { on: e.target.checked })} className="mt-0.5 accent-teal-700" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">{v.name}</span>
                      <span className="block text-[11px] text-gray-400">For {v.from.join(', ')}{v.current.tracked ? ` · now: ${v.current.frequency ? FREQUENCY_LABELS[v.current.frequency].toLowerCase() : 'usual schedule'}${v.current.targetMin !== undefined ? ` · target ${v.current.targetMin}–${v.current.targetMax}` : ''}` : ' · not tracked yet'}</span>
                    </span>
                  </label>
                  {pick.on && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <select value={pick.frequency ?? ''} onChange={e => setVital(v.vitalId, { frequency: (e.target.value || undefined) as VitalFrequency | undefined })}
                        className={inputCls} aria-label={`How often to measure ${v.name}`}>
                        <option value="">Usual schedule</option>
                        {FREQS.map(f => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
                      </select>
                      <input value={pick.targetMin} inputMode="decimal" placeholder="Target low" aria-label={`${v.name} target low (${v.unit})`}
                        onChange={e => setVital(v.vitalId, { targetMin: e.target.value })} className={inputCls} />
                      <input value={pick.targetMax} inputMode="decimal" placeholder={`High (${v.unit})`} aria-label={`${v.name} target high (${v.unit})`}
                        onChange={e => setVital(v.vitalId, { targetMax: e.target.value })} className={inputCls} />
                    </div>
                  )}
                </div>
              )
            })}

            {(proposal.fluidLimitGlasses !== undefined || proposal.dietNotes.length > 0) && (
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-3 mb-2">Meals and fluids</p>
            )}
            {proposal.fluidLimitGlasses !== undefined && (
              <div className="border border-gray-100 rounded-xl p-3 mb-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={picks.fluid.on} onChange={e => setPicks({ ...picks, fluid: { ...picks.fluid, on: e.target.checked } })} className="accent-teal-700" />
                  <span className="text-sm font-semibold text-gray-900 flex-1">Daily fluid limit <span className="text-[11px] font-normal text-gray-400">· for {proposal.fluidFrom}</span></span>
                </label>
                {picks.fluid.on && (
                  <Field label="At most (glasses a day; 1 glass ≈ 250 ml)">
                    <input value={picks.fluid.glasses} inputMode="numeric" onChange={e => setPicks({ ...picks, fluid: { ...picks.fluid, glasses: e.target.value } })} className={inputCls} />
                  </Field>
                )}
              </div>
            )}
            {proposal.dietNotes.length > 0 && (
              <div className="border border-gray-100 rounded-xl p-3 mb-2">
                <label className="flex items-center gap-2 mb-2">
                  <input type="checkbox" checked={picks.diet.on} onChange={e => setPicks({ ...picks, diet: { ...picks.diet, on: e.target.checked } })} className="accent-teal-700" />
                  <span className="text-sm font-semibold text-gray-900">Diet note <span className="text-[11px] font-normal text-gray-400">· added when the meal plan has none</span></span>
                </label>
                {picks.diet.on && (
                  <textarea value={picks.diet.text} rows={2} maxLength={1000} aria-label="Diet note"
                    onChange={e => setPicks({ ...picks, diet: { ...picks.diet, text: e.target.value } })} className={`${inputCls} resize-none`} />
                )}
              </div>
            )}

            {proposal.goals.length > 0 && (
              <>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-3 mb-1">Care-plan goals</p>
                <p className="text-[10px] text-gray-400 mb-2">Saved as a draft care plan: you add interventions and start it when ready. The patient sees it once started.</p>
                {proposal.goals.map((g, i) => (
                  <label key={g.text} className="flex items-start gap-2 py-1.5">
                    <input type="checkbox" checked={!!picks.goals[i]} onChange={e => setPicks({ ...picks, goals: { ...picks.goals, [i]: e.target.checked } })} className="mt-0.5 accent-teal-700" />
                    <span className="text-xs text-gray-800">{g.text} <span className="text-gray-400">· {g.from}</span></span>
                  </label>
                ))}
              </>
            )}
            {issue && <p className="text-xs text-red-500 mt-2">{issue}</p>}
            <SaveError message={save.error} className="mt-2" />
          </>
        )}
      </BottomSheet>
    </section>
  )
}

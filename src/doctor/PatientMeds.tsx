import { useState } from 'react'
import { BottomSheet, SheetButton, Field, inputCls, Pill, AllergyBanner, EmptyState, useSave, SaveError, useToast } from '@/shared'
import { MEAL_LINK_LABELS, RX_ROUTE_LABELS } from '@/shared/lib/types'
import type { MealLink, PatientUser, Prescription, RxRoute } from '@/shared/lib/types'
import { dayKey } from '@/shared/lib/vitals'
import { buildDaySchedule, clock, DOSE_TIMES, TONE_PILL } from '@/shared/lib/schedule'
import { allergyConflicts, alreadyTaking, catalogueMatch, conflictLabel, holdLabel, structureIssue } from '@/shared/lib/medicines'
import { useDoctor } from './useDoctor'

const FREQUENCIES = ['Once daily', 'Twice daily', 'Three times daily', 'Once at night', 'As needed', 'Weekly']
const ROUTES = Object.keys(RX_ROUTE_LABELS) as RxRoute[]
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const fromHHMM = (t: string) => { const [h, m] = t.split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN }
const MEAL_LINKS = Object.keys(MEAL_LINK_LABELS) as MealLink[]
const emptyRx = () => ({ medication: '', dosage: '', frequency: 'Once daily', purpose: '', route: 'oral' as RxRoute, instructions: '', startDate: dayKey(), endDate: '', allergyOverride: '',
  medicationCode: '', times: (DOSE_TIMES['Once daily'] ?? []).map(toHHMM), withMeal: 'any' as MealLink,
  hold: { on: false, vitalId: 'bp', below: '', above: '' } })
const EVENT_LABEL: Record<string, string> = { prescribed: 'Prescribed', stopped: 'Stopped', completed: 'Course finished', restarted: 'Restarted' }
const day = (iso?: string) => (iso ? new Date(`${iso}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')

/* ─── A patient's medicines, as the treating doctor works with them ───
   The same prescriptions the patient ticks off on their Meds tab. A
   prescription is never rewritten or deleted: to change one, stop it (with
   the reason) and prescribe again, so the record shows what the patient
   was told to take, from when to when, and why it ended. */
export function PatientMeds({ patient }: { patient: PatientUser }) {
  const { doses, mealsDone, mealPlanOf, nameOf, now, prescribe, stopMedicine, restartMedicine, medicationDefs, vitalDefs } = useDoctor()
  const toast = useToast()
  const active = patient.prescriptions.filter(x => x.active)
  const ended = patient.prescriptions.filter(x => !x.active)
  // Same schedule the patient ticks off on their Home / Meds tabs
  const planMeals = mealPlanOf(patient.id)?.meals
  const today = buildDaySchedule(patient, doses, mealsDone, now, [], planMeals?.length ? planMeals : undefined)

  /* a new prescription */
  const [rx, setRx] = useState<ReturnType<typeof emptyRx> | null>(null)
  const rxSave = useSave()
  // The database refuses a medicine that matches a recorded allergy unless the doctor gives a reason (0019); the form says so first.
  const allergyHits = rx ? allergyConflicts(rx.medication, patient.health?.allergies ?? []) : []
  const needsReason = allergyHits.length > 0 && rx!.allergyOverride.trim().length < 3
  const duplicate = rx ? alreadyTaking(rx.medication, active) : undefined
  // The catalogue medicine the name begins with, and the structure the database checks again (0021).
  const catalogue = rx?.medicationCode ? medicationDefs.find(m => m.code === rx.medicationCode) : undefined
  const n = (s: string) => (s.trim() === '' ? undefined : Number(s))
  const structured = rx ? {
    times: rx.times.map(fromHHMM),
    holdIf: rx.hold.on ? { vitalId: rx.hold.vitalId, below: n(rx.hold.below), above: n(rx.hold.above) } : undefined,
  } : undefined
  const newlyTracked = (catalogue?.monitorVitals ?? []).filter(id => !patient.trackedVitalIds.includes(id) && vitalDefs.some(v => v.id === id && v.active))
  const rxIssue = !rx ? null : rx.endDate && rx.endDate < rx.startDate ? 'The last day cannot be before the first day.' : structureIssue(structured!, vitalDefs)
  const setMedication = (value: string) => {
    if (!rx) return
    const m = catalogueMatch(value, medicationDefs)
    if (m?.code === rx.medicationCode || (!m && !rx.medicationCode)) { setRx({ ...rx, medication: value, medicationCode: m?.code ?? '' }); return }
    // A catalogue medicine was just chosen (or left): take its usual route, meal link and hold rule as a starting point.
    setRx({ ...rx, medication: value, medicationCode: m?.code ?? '',
      ...(m ? {
        route: m.route ?? rx.route, withMeal: m.withMeal ?? 'any', purpose: rx.purpose || m.drugClass,
        hold: m.holdIf ? { on: true, vitalId: m.holdIf.vitalId, below: m.holdIf.below !== undefined ? String(m.holdIf.below) : '', above: m.holdIf.above !== undefined ? String(m.holdIf.above) : '' } : { ...rx.hold, on: false },
      } : {}) })
  }
  const send = async () => {
    if (!rx || !rx.medication.trim() || !rx.dosage.trim() || rxIssue || needsReason) return
    // The sheet stays open, with the reason, if the prescription could not be saved.
    if (!(await rxSave.run(() => prescribe(patient.id, { ...rx, endDate: rx.endDate || undefined, allergyOverride: allergyHits.length ? rx.allergyOverride : undefined,
      medicationCode: rx.medicationCode || undefined, times: structured!.times, withMeal: rx.withMeal, holdIf: structured!.holdIf, ref: rxSave.ref }))).ok) return
    setRx(null)
    toast.show('Prescription sent to patient')
  }

  /* stopping or restarting one */
  const [change, setChange] = useState<{ rx: Prescription; to: 'stop' | 'restart' } | null>(null)
  const [reason, setReason] = useState('')
  const changeSave = useSave()
  const confirm = async () => {
    if (!change || (change.to === 'stop' && reason.trim().length < 3)) return
    const { rx: x, to } = change
    if (!(await changeSave.run(() => (to === 'stop' ? stopMedicine(patient.id, x.id, reason.trim()) : restartMedicine(patient.id, x.id)))).ok) return
    setChange(null)
    toast.show(`${x.medication} ${to === 'stop' ? 'stopped' : 'restarted'} · patient told`)
  }

  const details = (x: Prescription) => [
    x.route && x.route !== 'oral' ? RX_ROUTE_LABELS[x.route] : null,
    x.instructions,
    x.endDate ? `${day(x.startDate)} to ${day(x.endDate)}` : x.startDate ? `From ${day(x.startDate)}` : `Since ${x.prescribedAt}`,
  ].filter(Boolean).join(' · ')
  const history = (x: Prescription) => (x.history?.length ?? 0) > 1 && (
    <details className="mt-1 text-[10px] text-gray-500">
      <summary className="cursor-pointer select-none text-gray-400">History ({x.history!.length})</summary>
      <ol className="mt-1 flex flex-col gap-1 border-l-2 border-gray-100 pl-2.5">
        {x.history!.map(e => (
          <li key={e.id}><span className="font-semibold text-gray-700">{EVENT_LABEL[e.action] ?? e.action}</span> · {nameOf(e.actorId, 'mCare')} · {e.createdAt}{e.detail ? ` · ${e.detail}` : ''}</li>
        ))}
      </ol>
    </details>
  )

  return (
    <>
      {toast.node && <div className="span-all">{toast.node}</div>}
      <button onClick={() => { rxSave.clear(); setRx(emptyRx()) }} className="w-full py-3 rounded-2xl bg-teal-700 text-white text-sm font-bold shadow span-all">+ New Prescription</button>

      {patient.prescriptions.length === 0 && (
        <div className="span-all"><EmptyState icon="💊" title="No medicines prescribed" text="A prescription you write appears on the patient's Meds tab straight away." /></div>
      )}

      {active.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-900 mb-2">Active ({active.length})</p>
          {active.map(x => {
            const slots = today.items.filter(s => s.kind === 'med' && s.refId === x.id)
            return (
              <div key={x.id} className="py-2.5 border-b border-gray-50 last:border-0">
                <div className="flex items-start gap-2">
                  <span className="text-sm" aria-hidden="true">💊</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900">{x.medication} <span className="font-normal text-gray-500">· {x.dosage} · {x.frequency}</span></p>
                    <p className="text-[11px] text-gray-500">{x.purpose ? `${x.purpose} · ` : ''}{details(x)}</p>
                    <p className="text-[10px] text-gray-400">Prescribed by {nameOf(x.doctorId, 'a previous doctor')}</p>
                    {x.allergyOverride && <p className="text-[10px] text-red-600 font-semibold">⚠ Prescribed despite an allergy: {x.allergyOverride}</p>}
                    {(x.withMeal && x.withMeal !== 'any') || x.holdIf ? <p className="text-[10px] text-amber-800">{[x.withMeal && x.withMeal !== 'any' ? MEAL_LINK_LABELS[x.withMeal] : '', x.holdIf ? holdLabel(x.holdIf, vitalDefs) : ''].filter(Boolean).join(' · ')}</p> : null}
                    {slots.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {slots.map(s => <Pill key={s.key} color={TONE_PILL[s.tone]}>{s.done ? '✓ ' : ''}{clock(s.slot)}{s.tone === 'late' ? ' missed' : ''}</Pill>)}
                      </div>
                    )}
                    {history(x)}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <Pill color={slots.length && slots.every(s => s.done) ? 'green' : 'amber'}>{slots.filter(s => s.done).length}/{slots.length || '—'} today</Pill>
                    <button onClick={() => { changeSave.clear(); setReason(''); setChange({ rx: x, to: 'stop' }) }} className="text-[10px] text-red-600 font-bold">Stop</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {ended.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-500 mb-2">Ended ({ended.length})</p>
          {ended.map(x => (
            <div key={x.id} className="py-2 border-b border-gray-50 last:border-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-gray-600"><span className="line-through">{x.medication} · {x.dosage}</span> <Pill color={x.status === 'completed' ? 'teal' : 'gray'}>{x.status === 'completed' ? 'Course finished' : 'Stopped'}</Pill></p>
                  <p className="text-[10px] text-gray-400">{x.frequency} · {details(x)}</p>
                  {x.stopReason && x.status !== 'completed' && <p className="text-[10px] text-gray-500">Reason: {x.stopReason}{x.stoppedBy ? ` · ${nameOf(x.stoppedBy, 'a previous doctor')}` : ''}{x.stoppedAt ? ` · ${x.stoppedAt}` : ''}</p>}
                  {history(x)}
                </div>
                <button onClick={() => { changeSave.clear(); setChange({ rx: x, to: 'restart' }) }} className="text-[10px] text-teal-700 font-bold flex-shrink-0">Restart</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <BottomSheet open={!!rx} onClose={() => setRx(null)} title="New Prescription" subtitle={`For ${patient.name}`}
        footer={<><SheetButton tone="ghost" onClick={() => setRx(null)}>Cancel</SheetButton><SheetButton disabled={!rx?.medication.trim() || !rx?.dosage.trim() || !!rxIssue || needsReason || rxSave.busy} onClick={send}>{rxSave.busy ? 'Saving…' : allergyHits.length ? 'Prescribe anyway' : 'Prescribe'}</SheetButton></>}>
        {rx && (
          <>
            <AllergyBanner patient={patient} />
            <Field label="Medication *"><input value={rx.medication} list="medication-catalogue" onChange={e => setMedication(e.target.value)} placeholder="e.g. Amlodipine 5mg" className={inputCls} /></Field>
            <datalist id="medication-catalogue">{medicationDefs.map(m => <option key={m.code} value={m.name}>{m.drugClass}</option>)}</datalist>
            {catalogue && (
              <div className="bg-teal-50 rounded-xl px-3 py-2 mb-3 -mt-1">
                <p className="text-[11px] text-teal-800"><span className="font-bold">{catalogue.name}</span> · {catalogue.drugClass}{catalogue.note ? ` · ${catalogue.note}` : ''}</p>
                {catalogue.usualDoses.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5" role="group" aria-label="Usual doses">
                    {catalogue.usualDoses.map(d => (
                      <button key={d} type="button" onClick={() => setRx({ ...rx, dosage: d })}
                        className={`text-[11px] px-2.5 py-1 rounded-full border ${rx.dosage === d ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-teal-800 border-teal-200'}`}>{d}</button>
                    ))}
                  </div>
                )}
                {newlyTracked.length > 0 && <p className="text-[10px] text-teal-700 mt-1.5">Prescribing it also starts tracking {newlyTracked.map(id => vitalDefs.find(v => v.id === id)?.name ?? id).join(', ')}; the patient is told.</p>}
              </div>
            )}
            {allergyHits.length > 0 && (
              <div role="alert" className="bg-red-50 border-2 border-red-200 rounded-xl p-3 mb-3 -mt-1">
                <p className="text-xs font-bold text-red-700">⚠ Allergy: {conflictLabel(allergyHits)}</p>
                <p className="text-[11px] text-red-700/80 mt-0.5 leading-snug">{rx.medication.trim()} matches an allergy on this patient's record. Choose another medicine, or give your reason to prescribe it anyway: it is kept with the prescription and audited.</p>
                <Field label="Reason to prescribe anyway *">
                  <input value={rx.allergyOverride} maxLength={300} onChange={e => setRx({ ...rx, allergyOverride: e.target.value })}
                    placeholder="e.g. Tolerated it in 2024; allergy was a mild rash" className={inputCls} />
                </Field>
              </div>
            )}
            {duplicate && (
              <p className="text-[11px] text-amber-800 bg-amber-50 rounded-xl px-3 py-2 mb-3 -mt-1">Already taking {duplicate.medication} · {duplicate.dosage} · {duplicate.frequency}. Stop that one first if this replaces it.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Dose *"><input value={rx.dosage} onChange={e => setRx({ ...rx, dosage: e.target.value })} placeholder="e.g. 5mg" className={inputCls} /></Field>
              <Field label="How it is taken">
                <select value={rx.route} onChange={e => setRx({ ...rx, route: e.target.value as RxRoute })} className={inputCls} aria-label="How it is taken">
                  {ROUTES.map(r => <option key={r} value={r}>{RX_ROUTE_LABELS[r]}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Frequency">
              <div className="grid grid-cols-2 gap-2">
                {FREQUENCIES.map(f => (
                  <button key={f} onClick={() => setRx({ ...rx, frequency: f, times: (DOSE_TIMES[f] ?? []).map(toHHMM) })}
                    className={`py-2 rounded-xl text-xs font-semibold border-2 ${rx.frequency === f ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-100 bg-gray-50 text-gray-600'}`}>{f}</button>
                ))}
              </div>
            </Field>
            {rx.times.length > 0 && (
              <Field label="Dose times">
                <div className="flex flex-wrap gap-2">
                  {rx.times.map((t, i) => (
                    <input key={i} type="time" value={t} aria-label={`Dose ${i + 1} time`} className={`${inputCls} w-28`}
                      onChange={e => setRx({ ...rx, times: rx.times.map((x, j) => j === i ? e.target.value : x) })} />
                  ))}
                </div>
              </Field>
            )}
            <Field label="With meals">
              <select value={rx.withMeal} onChange={e => setRx({ ...rx, withMeal: e.target.value as MealLink })} className={inputCls} aria-label="With meals">
                {MEAL_LINKS.map(l => <option key={l} value={l}>{MEAL_LINK_LABELS[l]}</option>)}
              </select>
            </Field>
            <div className={`rounded-xl border p-3 mb-3 ${rx.hold.on ? 'border-amber-200 bg-amber-50/50' : 'border-gray-100'}`}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={rx.hold.on} onChange={e => setRx({ ...rx, hold: { ...rx.hold, on: e.target.checked } })} className="accent-teal-700" />
                <span className="text-xs font-semibold text-gray-800">Check a vital before each dose</span>
              </label>
              {rx.hold.on && (
                <>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <select value={rx.hold.vitalId} onChange={e => setRx({ ...rx, hold: { ...rx.hold, vitalId: e.target.value } })} className={inputCls} aria-label="Vital to check">
                      {vitalDefs.filter(v => v.active).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                    <input value={rx.hold.below} inputMode="decimal" placeholder="Hold below" aria-label="Hold below" onChange={e => setRx({ ...rx, hold: { ...rx.hold, below: e.target.value } })} className={inputCls} />
                    <input value={rx.hold.above} inputMode="decimal" placeholder="Hold above" aria-label="Hold above" onChange={e => setRx({ ...rx, hold: { ...rx.hold, above: e.target.value } })} className={inputCls} />
                  </div>
                  {structured?.holdIf && (structured.holdIf.below !== undefined || structured.holdIf.above !== undefined) && (
                    <p className="text-[10px] text-amber-800 mt-1.5">The patient sees: "{holdLabel(structured.holdIf, vitalDefs)}". A reading from the last 12 hours past the limit tells them to hold the dose and contact you.</p>
                  )}
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="First day"><input type="date" value={rx.startDate} onChange={e => setRx({ ...rx, startDate: e.target.value })} className={inputCls} /></Field>
              <Field label="Last day (optional)"><input type="date" min={rx.startDate} value={rx.endDate} onChange={e => setRx({ ...rx, endDate: e.target.value })} className={inputCls} /></Field>
            </div>
            <p className="text-[10px] text-gray-400 -mt-2 mb-3">Leave the last day empty for a medicine taken until you stop it. A course with a last day ends by itself, and the patient is told.</p>
            <Field label="Instructions for the patient"><input value={rx.instructions} maxLength={500} onChange={e => setRx({ ...rx, instructions: e.target.value })} placeholder="e.g. With breakfast; avoid grapefruit" className={inputCls} /></Field>
            <Field label="Purpose"><input value={rx.purpose} onChange={e => setRx({ ...rx, purpose: e.target.value })} placeholder="e.g. Blood pressure" className={inputCls} /></Field>
            {rxIssue && <p className="text-xs text-red-500 mb-2">{rxIssue}</p>}
            <SaveError message={rxSave.error} />
          </>
        )}
      </BottomSheet>

      <BottomSheet open={!!change} onClose={() => setChange(null)} title={change?.to === 'stop' ? 'Stop this medicine?' : 'Restart this medicine?'}
        subtitle={change ? `${change.rx.medication} · ${change.rx.dosage} · ${change.rx.frequency}` : ''}
        footer={<><SheetButton tone="ghost" onClick={() => setChange(null)}>Cancel</SheetButton>
          <SheetButton tone={change?.to === 'stop' ? 'danger' : 'primary'} disabled={changeSave.busy || (change?.to === 'stop' && reason.trim().length < 3)} onClick={confirm}>
            {changeSave.busy ? 'Saving…' : change?.to === 'stop' ? 'Stop medicine' : 'Restart medicine'}</SheetButton></>}>
        {change?.to === 'stop' && (
          <Field label="Reason *">
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={300} className={`${inputCls} resize-none`}
              placeholder="e.g. Persistent dry cough; switching to another medicine." />
          </Field>
        )}
        <p className="text-xs text-gray-600 leading-relaxed">
          {change?.to === 'stop'
            ? `${patient.name} is told, with the reason, and it leaves their daily schedule. It stays in their record as stopped.`
            : `${patient.name} is told, and it returns to their daily schedule.`}
        </p>
        <SaveError message={changeSave.error} className="mt-3" />
      </BottomSheet>
    </>
  )
}

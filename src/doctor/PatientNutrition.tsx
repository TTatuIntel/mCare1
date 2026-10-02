import { useState } from 'react'
import { useDoctor } from './useDoctor'
import { Pill, BottomSheet, SheetButton, Field, inputCls, useToast, useSave, SaveError, EmptyState } from '@/shared'
import type { PatientUser, PlannedMeal } from '@/shared/lib/types'
import { dayKey } from '@/shared/lib/vitals'
import { DAILY_MEALS, clock } from '@/shared/lib/schedule'

/* ─── Nutrition (doctor) ──────────────────────────────────────────────
   The plan the patient follows on their Meals tab, and what they logged
   against it. The plan is one record per patient: saving it here is what
   the patient sees. Until a doctor sets one, the patient follows the
   standard meals. */
const MAX_MEALS = 8
const DAYS_SHOWN = 7

type MealRow = { id: string; name: string; time: string; kcal: string; foods: string }
type Form = { targetKcal: string; waterGoal: string; dietaryNote: string; meals: MealRow[] }

const toTime = (at: number) => `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`
const toMinutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m }
const iconFor = (at: number) => (at < 630 ? '🌅' : at < 900 ? '☀️' : at < 1050 ? '🍎' : '🌙')
const toRow = (m: PlannedMeal): MealRow => ({ id: m.id, name: m.name, time: toTime(m.at), kcal: String(m.kcal), foods: m.foods })

let seq = 0
const newMealId = () => `meal_${Date.now().toString(36)}${(seq++).toString(36)}`

export function PatientNutrition({ patient }: { patient: PatientUser }) {
  const { mealPlanOf, mealsDone, hydration, setMealPlan, clearMealPlan } = useDoctor()
  const plan = mealPlanOf(patient.id)
  const personal = !!plan?.meals.length
  const meals = personal ? plan!.meals : DAILY_MEALS
  const waterGoal = plan?.waterGoal ?? 8
  const today = dayKey()
  const [form, setForm] = useState<Form | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const saving = useSave()
  const toast = useToast()

  const eatenOn = (day: string) => mealsDone.filter(m => m.patientId === patient.id && m.day === day)
  const waterOn = (day: string) => hydration.find(h => h.patientId === patient.id && h.day === day)?.glasses ?? 0
  const eatenToday = eatenOn(today)
  const kcalToday = meals.filter(m => eatenToday.some(e => e.mealId === m.id)).reduce((sum, m) => sum + m.kcal, 0)
  const recent = Array.from({ length: DAYS_SHOWN }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - i)
    const day = dayKey(d)
    return { day, label: i === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), eaten: eatenOn(day).length, water: waterOn(day) }
  })
  const anyLogged = recent.some(r => r.eaten > 0 || r.water > 0)

  const openForm = () => {
    saving.clear()
    setForm({
      targetKcal: plan?.targetKcal ? String(plan.targetKcal) : '', waterGoal: String(waterGoal),
      dietaryNote: plan?.dietaryNote ?? '', meals: meals.map(toRow),
    })
  }
  const setMeal = (id: string, patch: Partial<MealRow>) => setForm(f => f && { ...f, meals: f.meals.map(m => m.id === id ? { ...m, ...patch } : m) })

  const issue = (() => {
    if (!form) return null
    const kcal = form.targetKcal.trim() === '' ? null : Number(form.targetKcal)
    if (kcal !== null && (!Number.isInteger(kcal) || kcal < 500 || kcal > 6000)) return 'Daily energy target must be between 500 and 6000 kcal.'
    const water = Number(form.waterGoal)
    if (!Number.isInteger(water) || water < 1 || water > 30) return 'Water goal must be between 1 and 30 glasses.'
    for (const m of form.meals) {
      if (!m.name.trim()) return 'Give each meal a name.'
      if (!/^\d{2}:\d{2}$/.test(m.time)) return `Set a time for ${m.name.trim()}.`
      const k = Number(m.kcal)
      if (m.kcal.trim() === '' || !Number.isFinite(k) || k < 0 || k > 3000) return `Energy for ${m.name.trim()} must be between 0 and 3000 kcal.`
    }
    return null
  })()

  const save = async () => {
    if (!form || issue) return
    const planned: PlannedMeal[] = form.meals
      .map(m => { const at = toMinutes(m.time); return { id: m.id, name: m.name.trim(), at, foods: m.foods.trim(), kcal: Math.round(Number(m.kcal)), icon: iconFor(at) } })
      .sort((a, b) => a.at - b.at)
    const saved = await saving.run(() => setMealPlan({
      patientId: patient.id, meals: planned,
      targetKcal: form.targetKcal.trim() ? Number(form.targetKcal) : undefined,
      waterGoal: Number(form.waterGoal), dietaryNote: form.dietaryNote.trim() || undefined,
    }))
    if (!saved.ok) return
    setForm(null)
    toast.show('Meal plan saved and shared with patient')
  }

  const backToStandard = async () => {
    const cleared = await saving.run(() => clearMealPlan(patient.id))
    if (!cleared.ok) return
    setConfirmClear(false)
    toast.show('Patient is back on the standard plan')
  }

  return (
    <>
      {toast.node && <div className="span-all">{toast.node}</div>}

      {/* the plan the patient follows */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm font-bold text-gray-900">Meal plan</p>
          <Pill color={plan ? 'teal' : 'gray'}>{personal ? 'Personal plan' : plan ? 'Standard meals, your targets' : 'Standard plan'}</Pill>
        </div>
        <p className="text-[11px] text-gray-400 mb-3">
          {plan ? 'Set by the treating doctor. The patient sees exactly this on their Meals tab.' : 'No plan set yet: the patient follows the standard meals.'}
        </p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-gray-50 rounded-xl px-3 py-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Energy target</p>
            <p className="text-sm font-bold text-gray-900 font-mono">{plan?.targetKcal ? `${plan.targetKcal} kcal` : '—'}</p>
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Water goal</p>
            <p className="text-sm font-bold text-gray-900 font-mono">{waterGoal} glasses</p>
          </div>
        </div>
        {meals.map(m => (
          <div key={m.id} className="flex items-start gap-2 py-2 border-b border-gray-50 last:border-0">
            <span className="text-base" aria-hidden="true">{m.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900">{m.name} <span className="text-gray-400 font-normal">· {clock(m.at)}</span></p>
              {m.foods && <p className="text-[11px] text-gray-500 leading-snug">{m.foods}</p>}
            </div>
            <span className="text-[11px] font-bold text-teal-700 font-mono flex-shrink-0">{m.kcal} kcal</span>
          </div>
        ))}
        {plan?.dietaryNote && (
          <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 mt-3">
            <p className="text-[10px] font-semibold text-teal-600 uppercase tracking-wider mb-0.5">Dietary note</p>
            <p className="text-xs text-gray-700 leading-relaxed">{plan.dietaryNote}</p>
          </div>
        )}
        <div className="flex gap-2 mt-3">
          <button onClick={openForm} className="flex-1 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-bold">{plan ? 'Edit plan' : 'Set a plan'}</button>
          {plan && <button onClick={() => { saving.clear(); setConfirmClear(true) }} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm font-bold">Use standard</button>}
        </div>
      </div>

      {/* what the patient logged against it */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-sm font-bold text-gray-900 mb-2">Today</p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { v: `${eatenToday.filter(e => meals.some(m => m.id === e.mealId)).length}/${meals.length}`, l: 'Meals logged' },
            { v: `${kcalToday}`, l: plan?.targetKcal ? `of ${plan.targetKcal} kcal` : 'kcal' },
            { v: `${waterOn(today)}/${waterGoal}`, l: 'Glasses of water' },
          ].map(x => (
            <div key={x.l} className="bg-gray-50 rounded-xl py-2.5 text-center">
              <p className="text-base font-black text-teal-700 font-mono">{x.v}</p>
              <p className="text-[10px] text-gray-400 leading-tight">{x.l}</p>
            </div>
          ))}
        </div>
        {meals.map(m => {
          const log = eatenToday.find(e => e.mealId === m.id)
          return (
            <div key={m.id} className="flex items-center gap-2 py-1.5 text-xs">
              <span className={log ? 'text-emerald-600 font-bold' : 'text-gray-300'} aria-hidden="true">{log ? '✓' : '○'}</span>
              <span className="flex-1 min-w-0 text-gray-700 truncate">{m.name}{log?.note ? <span className="text-gray-400"> · ate: {log.note}</span> : null}</span>
              <span className="text-[10px] text-gray-400 flex-shrink-0">{log ? log.takenAt : 'Not logged'}</span>
            </div>
          )
        })}
      </div>

      {anyLogged ? (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-900 mb-2">Last {DAYS_SHOWN} days</p>
          {recent.map(r => (
            <div key={r.day} className="flex items-center gap-2 py-1.5 text-xs border-b border-gray-50 last:border-0">
              <span className="flex-1 text-gray-700">{r.label}</span>
              <span className="text-gray-500 font-mono">{r.eaten} meal{r.eaten === 1 ? '' : 's'}</span>
              <span className="text-teal-700 font-mono w-20 text-right">{r.water} glass{r.water === 1 ? '' : 'es'}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon="🍽️" title="Nothing logged yet" text="Meals and water the patient logs will appear here." />
      )}

      <BottomSheet open={!!form} onClose={() => setForm(null)} title="Meal plan" subtitle={`For ${patient.name}`}
        footer={<><SheetButton tone="ghost" onClick={() => setForm(null)}>Cancel</SheetButton><SheetButton disabled={!!issue || saving.busy} onClick={save}>{saving.busy ? 'Saving…' : 'Save plan'}</SheetButton></>}>
        {form && (
          <>
            <div className="grid grid-cols-2 gap-x-3">
              <Field label="Energy target (kcal a day)">
                <input value={form.targetKcal} inputMode="numeric" placeholder="e.g. 1800" onChange={e => setForm({ ...form, targetKcal: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Water goal (glasses) *">
                <input value={form.waterGoal} inputMode="numeric" onChange={e => setForm({ ...form, waterGoal: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <Field label="Dietary note for the patient">
              <textarea value={form.dietaryNote} rows={2} maxLength={1000} placeholder="e.g. Keep salt low; no grapefruit with your medication."
                onChange={e => setForm({ ...form, dietaryNote: e.target.value })} className={`${inputCls} resize-none`} />
            </Field>

            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Meals ({form.meals.length})</p>
            {form.meals.length === 0 && <p className="text-xs text-gray-400 mb-3">No meals listed: the patient keeps the standard meals with the targets above.</p>}
            {form.meals.map(m => (
              <div key={m.id} className="border border-gray-100 rounded-xl p-3 mb-2">
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
                  <input value={m.name} maxLength={60} placeholder="Meal name" aria-label="Meal name" onChange={e => setMeal(m.id, { name: e.target.value })} className={inputCls} />
                  <input type="time" value={m.time} aria-label={`Time of ${m.name || 'meal'}`} onChange={e => setMeal(m.id, { time: e.target.value })} className={inputCls} />
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2 mt-2">
                  <input value={m.foods} maxLength={300} placeholder="What to eat" aria-label={`What to eat for ${m.name || 'meal'}`} onChange={e => setMeal(m.id, { foods: e.target.value })} className={inputCls} />
                  <input value={m.kcal} inputMode="numeric" placeholder="kcal" aria-label={`Energy of ${m.name || 'meal'} in kcal`} onChange={e => setMeal(m.id, { kcal: e.target.value })} className={inputCls} />
                </div>
                <button onClick={() => setForm({ ...form, meals: form.meals.filter(x => x.id !== m.id) })} className="text-[11px] text-red-500 font-bold mt-2">Remove meal</button>
              </div>
            ))}
            {form.meals.length < MAX_MEALS && (
              <button onClick={() => setForm({ ...form, meals: [...form.meals, { id: newMealId(), name: '', time: '12:00', kcal: '', foods: '' }] })}
                className="w-full py-2 rounded-xl border-2 border-dashed border-gray-200 text-xs font-bold text-teal-700">+ Add meal</button>
            )}
            {issue && <p className="text-xs text-red-500 mt-2">{issue}</p>}
            <SaveError message={saving.error} className="mt-2" />
          </>
        )}
      </BottomSheet>

      <BottomSheet open={confirmClear} onClose={() => setConfirmClear(false)} title="Use the standard plan?"
        subtitle={`${patient.name} goes back to the standard meals and the default water goal. What they already logged is kept.`}
        footer={<><SheetButton tone="ghost" onClick={() => setConfirmClear(false)}>Keep plan</SheetButton><SheetButton tone="danger" disabled={saving.busy} onClick={backToStandard}>{saving.busy ? 'Removing…' : 'Remove plan'}</SheetButton></>}>
        <SaveError message={saving.error} />
      </BottomSheet>
    </>
  )
}

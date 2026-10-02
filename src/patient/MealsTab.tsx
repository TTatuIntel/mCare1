import { useApp } from '@/shared/state/AppContext'
import { Page, Pill } from '@/shared'
import { usePatient } from './usePatient'
import { dayKey } from '@/shared/lib/vitals'
import { clock, countdown, TONE_PILL } from '@/shared/lib/schedule'
import { useDaySchedule } from './useDaySchedule'

/** Daily energy the ring is measured against when the doctor has not set a target. */
const DEFAULT_KCAL = 2000

/* ─── Meals ───────────────────────────────────────────────────────────
   Today's meals from the plan the doctor set for this patient (or the
   standard plan until they do), what has been eaten, water, and the
   doctor's dietary note. Everything shown is the patient's own record:
   nothing here is a sample figure. */
export function MealsTab() {
  const { mealsDone } = useApp()
  const { patient, doctor, todaysMeals, waterToday, setWater, status, error, reload } = usePatient()
  const day = useDaySchedule()
  const ateNote = (mealId: string) => mealsDone.find(m => m.patientId === patient.id && m.mealId === mealId && m.day === dayKey())?.note
  const mealItems = day.items.filter(x => x.kind === 'meal')
  const meal = (id: string) => todaysMeals.meals.find(m => m.id === id)
  const dueMeals = mealItems.filter(x => !x.done)
  const loggedMeals = mealItems.filter(x => x.done)
  const totalKcal = day.meals.kcal
  const targetKcal = todaysMeals.targetKcal ?? DEFAULT_KCAL
  const eaten = todaysMeals.meals.filter(m => loggedMeals.some(x => x.refId === m.id))
  // Protein, carbs and fat are shown only when the plan gives them for what was eaten.
  const macro = (key: 'protein' | 'carbs' | 'fat') => eaten.every(m => typeof m[key] === 'number') && eaten.length > 0
    ? eaten.reduce((sum, m) => sum + (m[key] ?? 0), 0) : null
  const macros = [
    { label: 'Protein', value: macro('protein'), cls: 'text-blue-600' },
    { label: 'Carbs', value: macro('carbs'), cls: 'text-amber-500' },
    { label: 'Fat', value: macro('fat'), cls: 'text-rose-500' },
  ].filter(m => m.value !== null)
  const goal = todaysMeals.waterGoal
  const left = Math.max(0, goal - waterToday)

  return (
    <Page title="Meals" status={status} error={error} onRetry={reload}>

      {/* Energy today against the target */}
      <div className="bg-white rounded-2xl p-5 shadow-sm flex items-center gap-5">
        <div className="relative w-20 h-20 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90" role="img" aria-label={`${totalKcal} of ${targetKcal} kilocalories`}>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f3f4f6" strokeWidth="3" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#0a6e6e" strokeWidth="3"
              strokeDasharray={`${Math.min(100, (totalKcal / targetKcal) * 100)} 100`}
              strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs font-bold text-gray-900 leading-tight font-mono">{totalKcal}</span>
            <span className="text-[9px] text-gray-400 leading-tight">kcal</span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900">Today's Intake</p>
          <p className="text-xs text-gray-500 mt-0.5"><span className="font-mono">{totalKcal}</span> of <span className="font-mono">{targetKcal}</span> kcal {todaysMeals.targetKcal ? 'target set by your doctor' : 'target'}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{day.meals.logged} of {day.meals.total} meals logged · {todaysMeals.personal ? 'your personal plan' : 'standard plan'}</p>
          {macros.length > 0 && (
            <div className="flex gap-3 mt-2">
              {macros.map(m => (
                <div key={m.label} className="text-center">
                  <p className={`text-xs font-bold font-mono ${m.cls}`}>{m.value}g</p>
                  <p className="text-[9px] text-gray-400">{m.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Due meals — tap to mark eaten, disappears once logged */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Up next</p>
        {dueMeals.length === 0 ? (
          <div className="bg-emerald-50 rounded-xl px-3.5 py-3 flex items-center gap-2">
            <span className="text-base">✅</span>
            <p className="text-xs text-emerald-700 font-medium">All meals logged for today.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {dueMeals.map(x => {
              const m = meal(x.refId)
              if (!m) return null
              return (
                <div key={x.key} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                  <button onClick={() => day.toggle(x)} aria-label={`Mark ${m.name} eaten`}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-sm transition-all flex-shrink-0 border-2 border-gray-200 bg-white active:bg-emerald-500 active:text-white active:border-emerald-500">
                  </button>
                  <span className="text-xl" aria-hidden="true">{m.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{m.name} · {clock(m.at)} · {m.kcal} kcal</p>
                    <p className="text-sm text-gray-800 mt-0.5 leading-snug">{m.foods}</p>
                  </div>
                  <Pill color={TONE_PILL[x.tone]}>{countdown(x.inMin)}</Pill>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Logged meals */}
      {loggedMeals.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Logged today</p>
          <div className="flex flex-col gap-0">
            {loggedMeals.map(x => {
              const m = meal(x.refId)
              if (!m) return null
              return (
                <div key={x.key} className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
                  <button onClick={() => day.toggle(x)} aria-label={`Undo ${m.name}`} className="text-xl mt-0.5">✅</button>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{m.name} · {clock(m.at)}</p>
                    {ateNote(m.id)
                      ? <p className="text-sm text-gray-700 mt-0.5 leading-snug">Ate: {ateNote(m.id)} <span className="text-gray-400 line-through">{m.foods}</span></p>
                      : <p className="text-sm text-gray-500 mt-0.5 leading-snug line-through">{m.foods}</p>}
                  </div>
                  <span className="text-xs font-bold text-teal-700 flex-shrink-0 mt-1 font-mono">{m.kcal} kcal</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Hydration: tap a glass to set today's count */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-gray-900">💧 Hydration</p>
          <span className="text-xs text-teal-700 font-bold"><span className="font-mono">{waterToday}</span> / <span className="font-mono">{goal}</span> glasses</span>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Glasses of water today">
          {Array.from({ length: goal }).map((_, i) => (
            <button key={i} onClick={() => setWater(waterToday === i + 1 ? i : i + 1)} aria-label={`${i + 1} glass${i ? 'es' : ''}`} aria-pressed={i < waterToday}
              className={`flex-1 h-9 rounded-lg transition-colors active:scale-95 ${i < waterToday ? 'bg-teal-500' : 'bg-gray-100 hover:bg-gray-200'}`} />
          ))}
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-gray-400">
            {waterToday === 0 ? 'Tap a glass each time you drink one.' : left ? `${left} more glass${left > 1 ? 'es' : ''} to reach today's goal` : 'Goal reached for today.'}
          </p>
          {waterToday >= goal && (
            <button onClick={() => setWater(waterToday + 1)} className="text-[11px] font-bold text-teal-700">+ 1 more</button>
          )}
        </div>
      </div>

      {/* Doctor's dietary note, when there is one */}
      {todaysMeals.dietaryNote && (
        <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4">
          <p className="text-[10px] font-semibold text-teal-600 uppercase tracking-wider mb-1">Dietary note from {doctor?.name ?? 'your doctor'}</p>
          <p className="text-xs text-gray-700 leading-relaxed">{todaysMeals.dietaryNote}</p>
        </div>
      )}
    </Page>
  )
}

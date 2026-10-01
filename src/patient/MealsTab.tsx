import { useApp } from '@/shared/state/AppContext'
import { Page, Pill } from '@/shared'
import { usePatient } from './usePatient'
import { dayKey } from '@/shared/lib/vitals'
import { DAILY_MEALS, clock, countdown, TONE_PILL } from '@/shared/lib/schedule'
import { useDaySchedule } from './useDaySchedule'

/* ─── Meals ─────────────────────────────────────────────────────────── */
export function MealsTab() {
  const { mealsDone } = useApp()
  const { patient, status, error, reload } = usePatient()
  const day = useDaySchedule()
  const ateNote = (mealId: string) => mealsDone.find(m => m.patientId === patient.id && m.mealId === mealId && m.day === dayKey())?.note
  const mealItems = day.items.filter(x => x.kind === 'meal')
  const meal = (id: string) => DAILY_MEALS.find(m => m.id === id)!
  const dueMeals = mealItems.filter(x => !x.done)
  const loggedMeals = mealItems.filter(x => x.done)
  const totalKcal = day.meals.kcal
  const targetKcal = 2000

  return (
    <Page title="Meals" status={status} error={error} onRetry={reload}>

      {/* Calorie summary ring */}
      <div className="bg-white rounded-2xl p-5 shadow-sm flex items-center gap-5">
        <div className="relative w-20 h-20 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f3f4f6" strokeWidth="3" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#0a6e6e" strokeWidth="3"
              strokeDasharray={`${(totalKcal / targetKcal) * 100} 100`}
              strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[11px] font-bold text-gray-900 leading-tight">{totalKcal}</span>
            <span className="text-[8px] text-gray-400 leading-tight">kcal</span>
          </div>
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900">Today's Intake</p>
          <p className="text-xs text-gray-500 mt-0.5">{totalKcal} of {targetKcal} kcal target</p>
          <div className="flex gap-3 mt-2">
            <div className="text-center">
              <p className="text-xs font-bold text-blue-600">65g</p>
              <p className="text-[9px] text-gray-400">Protein</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-bold text-amber-500">180g</p>
              <p className="text-[9px] text-gray-400">Carbs</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-bold text-rose-500">42g</p>
              <p className="text-[9px] text-gray-400">Fat</p>
            </div>
          </div>
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
              return (
                <div key={x.key} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                  <button onClick={() => day.toggle(x)} aria-label={`Mark ${m.name} eaten`}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-sm transition-all flex-shrink-0 border-2 border-gray-200 bg-white active:bg-emerald-500 active:text-white active:border-emerald-500">
                  </button>
                  <span className="text-xl">{m.icon}</span>
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
              return (
                <div key={x.key} className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
                  <button onClick={() => day.toggle(x)} aria-label={`Undo ${m.name}`} className="text-xl mt-0.5">✅</button>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{m.name} · {clock(m.at)}</p>
                    {ateNote(m.id)
                      ? <p className="text-sm text-gray-700 mt-0.5 leading-snug">Ate: {ateNote(m.id)} <span className="text-gray-400 line-through">{m.foods}</span></p>
                      : <p className="text-sm text-gray-500 mt-0.5 leading-snug line-through">{m.foods}</p>}
                  </div>
                  <span className="text-xs font-bold text-teal-700 flex-shrink-0 mt-1">{m.kcal} kcal</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Hydration */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-gray-900">💧 Hydration</p>
          <span className="text-xs text-teal-700 font-bold">6 / 8 glasses</span>
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`flex-1 h-8 rounded-lg ${i < 6 ? 'bg-teal-500' : 'bg-gray-100'}`} />
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-2 text-center">2 more glasses to reach your daily goal</p>
      </div>

      {/* Doctor's dietary note */}
      <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4">
        <p className="text-[10px] font-semibold text-teal-600 uppercase tracking-wider mb-1">Doctor's Dietary Note</p>
        <p className="text-xs text-gray-700 leading-relaxed">
          Limit sodium intake. Prefer grilled or steamed foods over fried. Aim for 5 servings of vegetables daily.
        </p>
      </div>
    </Page>
  )
}

import { useApp } from '@/shared/state/AppContext'
import { buildDaySchedule, type ScheduleItem } from '@/shared/lib/schedule'
import { usePatient } from './usePatient'

/* Today's schedule for the signed-in patient, plus one `toggle` that ticks a
   dose or meal off no matter which screen it's done from. */
export function useDaySchedule() {
  const { doses, mealsDone, now, toggleDose, toggleMeal, appointments } = useApp()
  const { patient, todaysMeals } = usePatient()
  const schedule = buildDaySchedule(patient, doses, mealsDone, now, appointments, todaysMeals.meals)
  /** Ticks a dose or a meal on or off. Resolves with how the save went. */
  const toggle = (item: ScheduleItem) =>
    item.kind === 'med' ? toggleDose(patient.id, item.refId, item.slot)
    : item.kind === 'meal' ? toggleMeal(patient.id, item.refId)
    : Promise.resolve({ ok: true as const, value: undefined })
  // Live lookup by key, so an open detail sheet reflects ticks made elsewhere
  const find = (key: string) => [...schedule.items, ...schedule.due].find(x => x.key === key)
  return { ...schedule, toggle, find }
}

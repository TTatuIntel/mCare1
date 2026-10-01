import { useApp } from '@/shared/state/AppContext'
import type { PatientUser } from '@/shared/lib/types'
import { buildDaySchedule, type ScheduleItem } from '@/shared/lib/schedule'

/* Today's schedule for the signed-in patient, plus one `toggle` that ticks a
   dose or meal off no matter which screen it's done from. */
export function useDaySchedule() {
  const { currentUser, doses, mealsDone, now, toggleDose, toggleMeal, appointments } = useApp()
  const patient = currentUser as PatientUser
  const schedule = buildDaySchedule(patient, doses, mealsDone, now, appointments)
  const toggle = (item: ScheduleItem) => {
    if (item.kind === 'med') toggleDose(patient.id, item.refId, item.slot)
    else if (item.kind === 'meal') toggleMeal(patient.id, item.refId)
  }
  // Live lookup by key, so an open detail sheet reflects ticks made elsewhere
  const find = (key: string) => [...schedule.items, ...schedule.due].find(x => x.key === key)
  return { ...schedule, toggle, find }
}

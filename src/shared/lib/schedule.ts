/**
 * Daily care schedule — the single source of truth for "what is due when".
 * Home reminders, the Meds / Meals / Vitals tabs, nav badges and the doctor's
 * patient view all derive from buildDaySchedule(), so a tick in one place
 * shows up everywhere.
 */
import type { PatientUser, Prescription, MedDose, MealDone, Appointment } from './types'
import { dayKey, latestValid, checkInStatus } from './vitals'

/* ─── Schedule data ─────────────────────────────────────────────────── */
// `at` = minutes after midnight
export const DAILY_MEALS = [
  { id: 'breakfast', name: 'Breakfast', at: 7 * 60 + 30,  foods: 'Oatmeal with banana, black coffee', kcal: 320, icon: '🌅' },
  { id: 'lunch',     name: 'Lunch',     at: 12 * 60 + 45, foods: 'Grilled chicken salad, water',       kcal: 480, icon: '☀️' },
  { id: 'snack',     name: 'Snack',     at: 15 * 60 + 15, foods: 'Greek yogurt, mixed nuts',           kcal: 210, icon: '🍎' },
  { id: 'dinner',    name: 'Dinner',    at: 19 * 60,      foods: 'Brown rice, steamed veggies, fish',  kcal: 560, icon: '🌙' },
]
export type Meal = typeof DAILY_MEALS[number]

// Default dose times per prescription frequency. Frequencies not listed here
// ('As needed', 'Weekly') have no daily slots and are logged on demand.
export const DOSE_TIMES: Record<string, number[]> = {
  'Once daily': [8 * 60],
  'Twice daily': [8 * 60, 20 * 60],
  'Three times daily': [8 * 60, 14 * 60, 20 * 60],
  'Once at night': [21 * 60],
}
export const ANYTIME_SLOT = -1

export const SOON_MIN = 30
export const APPT_LOOKAHEAD_DAYS = 7

/* ─── Formatting ────────────────────────────────────────────────────── */
export const clock = (m: number) => {
  const h = Math.floor(m / 60) % 24, mm = m % 60
  return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
export const countdown = (m: number) => {
  const a = Math.abs(m)
  if (m < 0) return `${a < 60 ? `${a} min` : `${Math.floor(a / 60)}h`} late`
  if (m < 1) return 'Now'
  if (m < 60) return `in ${m} min`
  if (m >= 24 * 60) { const d = Math.round(m / (24 * 60)); return d === 1 ? 'Tomorrow' : `in ${d} days` }
  return `in ${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}
export type Tone = 'done' | 'late' | 'soon' | 'upcoming'
export const toneOf = (inMin: number | null, done = false): Tone =>
  done || inMin === null ? 'done' : inMin < 0 ? 'late' : inMin <= SOON_MIN ? 'soon' : 'upcoming'
export const TONE_PILL: Record<Tone, string> = { done: 'green', late: 'red', soon: 'amber', upcoming: 'gray' }

/* ─── Derivation ────────────────────────────────────────────────────── */
export const doseSlots = (rx: Prescription) => DOSE_TIMES[rx.frequency] ?? []
export const minuteOfDay = (now: number) => { const d = new Date(now); return d.getHours() * 60 + d.getMinutes() }

/** Effective date/time of an appointment (the new slot when rescheduled). */
export const apptWhen = (a: Appointment) => {
  const date = a.status === 'rescheduled' ? a.rescheduledTo ?? a.preferredDate : a.preferredDate
  const time = a.status === 'rescheduled' ? a.rescheduledTime ?? a.preferredTime : a.preferredTime
  const at = new Date(`${date} ${time || '9:00 AM'}`).getTime()
  return { date, time, at: Number.isNaN(at) ? null : at }
}

export type ScheduleItem = {
  key: string
  kind: 'med' | 'meal' | 'vitals' | 'appt'
  refId: string          // rx id / meal id / 'vitals' / appointment id
  slot: number           // dose slot or meal time (minutes after midnight)
  icon: string
  title: string
  sub: string
  inMin: number
  done: boolean
  tone: Tone
}

export type DaySchedule = {
  items: ScheduleItem[]            // every timed dose + meal today, in time order
  due: ScheduleItem[]              // not yet done (+ vitals check when due), soonest first
  doses: { taken: number; total: number }
  meals: { logged: number; total: number; kcal: number }
  nextMed?: ScheduleItem
  nextMeal?: ScheduleItem
  nextAppt?: ScheduleItem
  vitals: { lastAt: number; dueIn: number; item?: ScheduleItem }
  dueNowCount: (kind: ScheduleItem['kind']) => number
}

export const isDoseTaken = (doses: MedDose[], patientId: string, rxId: string, slot: number, day = dayKey()) =>
  doses.some(d => d.patientId === patientId && d.rxId === rxId && d.day === day && d.slot === slot)

// Picks the upcoming item if there is one, else the most overdue.
const pickNext = (xs: ScheduleItem[]) => xs.find(x => x.inMin >= 0) ?? xs[0]

export function buildDaySchedule(patient: PatientUser, doses: MedDose[], mealsDone: MealDone[], now: number, appointments: Appointment[] = []): DaySchedule {
  const day = dayKey()
  const nowMin = minuteOfDay(now)
  const mk = (x: Omit<ScheduleItem, 'inMin' | 'tone'>): ScheduleItem => {
    const inMin = x.slot - nowMin
    return { ...x, inMin, tone: toneOf(inMin, x.done) }
  }

  const medItems = patient.prescriptions.filter(rx => rx.active).flatMap(rx => {
    const slots = doseSlots(rx)
    return slots.map((slot, i) => mk({
      key: `${rx.id}@${slot}`, kind: 'med', refId: rx.id, slot, icon: '💊', title: rx.medication,
      sub: `${clock(slot)}${slots.length > 1 ? ` · dose ${i + 1} of ${slots.length}` : ''} · ${rx.purpose}`,
      done: isDoseTaken(doses, patient.id, rx.id, slot, day),
    }))
  })
  const logged = new Set(mealsDone.filter(m => m.patientId === patient.id && m.day === day).map(m => m.mealId))
  const mealItems = DAILY_MEALS.map(m => mk({
    key: m.id, kind: 'meal', refId: m.id, slot: m.at, icon: m.icon, title: m.name,
    sub: `${clock(m.at)} · ${m.foods}`, done: logged.has(m.id),
  }))

  // The vitals check follows each vital's own cadence (blood pressure twice a day, weight
  // weekly…): it is due when the first tracked vital is, so it agrees with every vital's page.
  const lastAt = patient.readings.reduce((t, r) => Math.max(t, r.at ?? 0), 0)
  const checks = patient.trackedVitalIds.map(id => {
    const dueAt = checkInStatus(id, latestValid(patient, id)?.at, now).dueAt
    return dueAt === undefined ? 0 : Math.round((dueAt - now) / 60_000)
  })
  const dueIn = checks.length ? Math.min(...checks) : 0
  const dueCount = checks.filter(m => m <= 0).length
  const vitalsItem: ScheduleItem | undefined = checks.length && dueIn <= 120
    ? { key: 'vitals', kind: 'vitals', refId: 'vitals', slot: nowMin + Math.max(dueIn, 0), icon: '🩺', title: 'Log your vitals',
        sub: !lastAt ? 'No readings yet' : dueCount ? `${dueCount} vital${dueCount > 1 ? 's' : ''} due` : 'Next check coming up',
        inMin: Math.max(dueIn, 0), done: false, tone: toneOf(Math.max(dueIn, 0)) }
    : undefined

  // Confirmed (or doctor-rescheduled) visits coming up in the next week
  const apptItems: ScheduleItem[] = appointments
    .filter(a => a.patientId === patient.id && (a.status === 'approved' || a.status === 'rescheduled'))
    .flatMap(a => {
      const w = apptWhen(a)
      if (w.at === null) return []
      const inMin = Math.round((w.at - now) / 60_000)
      if (inMin < -60 || inMin > APPT_LOOKAHEAD_DAYS * 24 * 60) return []
      return [{
        key: `appt:${a.id}`, kind: 'appt' as const, refId: a.id, slot: nowMin + inMin, icon: '📅', title: a.title,
        sub: `${w.date} · ${w.time}${a.status === 'rescheduled' ? ' · new time proposed' : a.location ? ` · ${a.location}` : ''}`,
        inMin, done: false, tone: a.status === 'rescheduled' ? 'soon' as const : toneOf(inMin),
      }]
    })

  const byTime = (a: ScheduleItem, b: ScheduleItem) => a.inMin - b.inMin
  const items = [...medItems, ...mealItems].sort(byTime)
  const due = [...items.filter(x => !x.done), ...(vitalsItem ? [vitalsItem] : []), ...apptItems].sort(byTime)
  const dueMeds = due.filter(x => x.kind === 'med')
  const dueMeals = due.filter(x => x.kind === 'meal')

  return {
    items, due,
    doses: { taken: medItems.filter(x => x.done).length, total: medItems.length },
    meals: { logged: logged.size, total: DAILY_MEALS.length, kcal: DAILY_MEALS.filter(m => logged.has(m.id)).reduce((s, m) => s + m.kcal, 0) },
    nextMed: pickNext(dueMeds),
    nextMeal: pickNext(dueMeals),
    nextAppt: apptItems.sort(byTime)[0],
    vitals: { lastAt, dueIn, item: vitalsItem },
    // "needs doing now": late or within the next SOON_MIN minutes
    dueNowCount: kind => due.filter(x => x.kind === kind && x.inMin <= SOON_MIN).length,
  }
}

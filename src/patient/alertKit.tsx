/**
 * How the patient portal shows an alert: what it is about, how it compares to
 * the target, what is happening to it and what to do in the meantime. Home and
 * My Alerts both read alerts through `useAlertView`, so they say the same thing.
 */
import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { CloseButton } from '@/shared'
import type { AppAlert, VitalDef } from '@/shared/lib/types'
import { parseValue, targetRange, unitView, SELF_CLEAR_WINDOW_MIN } from '@/shared/lib/vitals'
import { usePatient } from './usePatient'
import { useSelfClear } from './VitalLogSheets'

export interface AlertView {
  def?: VitalDef
  icon: string
  name: string
  /** The reading in the patient's own unit. */
  value: string
  unit: string
  /** e.g. "Target 60–100". */
  target?: string
  direction: 'high' | 'low' | null
  danger: boolean
  /** Where the alert is with the care team, in the patient's words. */
  statusLine: string
  /** A fresh reading would help: the self-clear window is open, or the doctor asked for one. */
  remeasure: { reason: string } | null
  /** What to do while waiting, most useful first. */
  tips: string[]
}

const EMERGENCY_TIP = 'Chest pain, trouble breathing, confusion or fainting? Use SOS or call 999.'

/** General self-care while the care team reviews a reading. Not a diagnosis; the doctor's advice always wins. */
function tipsFor(vitalId: string | undefined, direction: 'high' | 'low' | null, danger: boolean): string[] {
  const rest = 'Sit quietly for 5 minutes, then measure again.'
  const byVital: Record<string, { high: string[]; low: string[] }> = {
    bp: {
      high: [rest, 'Skip caffeine, smoking and exercise for 30 minutes before you re-measure.', 'Take your medicine as prescribed. Don’t take an extra dose.'],
      low: ['Sit or lie down and drink some water.', 'Stand up slowly, then measure again.'],
    },
    gluc: {
      high: ['Drink water and note when you last ate and took your medicine.', 'Don’t take extra medicine unless your doctor has told you to.', 'Check again in about an hour.'],
      low: ['Have fast-acting sugar now, such as juice or glucose tablets.', 'Check again in 15 minutes.'],
    },
    hr: {
      high: ['Rest and breathe slowly for 5 minutes, then measure again.', 'Avoid caffeine for now.'],
      low: ['Sit down and rest, then measure again.', 'Note any dizziness or faintness to tell your doctor.'],
    },
    temp: {
      high: ['Rest and drink plenty of fluids.', 'Measure again in an hour.'],
      low: ['Warm up with a blanket and a warm drink.', 'Measure again in 30 minutes.'],
    },
    spo2: {
      high: [rest],
      low: ['Sit upright and breathe slowly and deeply.', 'Check the sensor is on a warm, still finger, then measure again.'],
    },
  }
  const own = (vitalId && direction && byVital[vitalId]?.[direction]) || [rest]
  // When it is critical, the emergency line comes first.
  return danger ? [EMERGENCY_TIP, ...own] : [...own, EMERGENCY_TIP]
}

export function useAlertView() {
  const { vitalDefs } = useApp()
  const { patient } = usePatient()
  const selfClear = useSelfClear()

  return (a: AppAlert): AlertView => {
    const danger = a.severity === 'danger'
    const statusLine = a.status === 'acknowledged' ? 'Your doctor is reviewing this'
      : a.status === 'escalated' ? 'Your care team has been notified'
      : a.status === 'resolved' ? 'Resolved'
      : 'Sent to your doctor'

    if (a.type === 'sos') {
      return {
        icon: '🚨', name: 'SOS', value: a.value, unit: '', direction: null, danger: true, statusLine, remeasure: null,
        tips: ['Stay where you are if it is safe, and keep your phone close.', 'If you can, call 999 or your emergency contact now.'],
      }
    }

    // The vital an alert is about: its stored id, else via its reading, else by name.
    const id = a.vitalId ?? patient.readings.find(r => r.id === a.readingId)?.vitalId
    const def = vitalDefs.find(d => (id ? d.id === id : d.name === a.vitalName))
    if (!def) {
      return { icon: '⚠️', name: a.vitalName, value: a.value, unit: a.unit, direction: null, danger, statusLine, remeasure: null, tips: tipsFor(undefined, null, danger) }
    }

    const u = unitView(def, patient)
    const range = targetRange(patient, def)
    const shown = u.range(range)
    const p = parseValue(def, a.value)
    const diaMin = def.diaNormalMin ?? 60, diaMax = def.diaNormalMax ?? 90
    const direction = !p ? null
      : p.primary > range.max || (p.secondary !== undefined && p.secondary > diaMax) ? 'high'
      : p.primary < range.min || (p.secondary !== undefined && p.secondary < diaMin) ? 'low'
      : null

    const sc = a.status === 'open' && !danger ? selfClear(def) : null
    const remeasure = a.recheckRequestedAt ? { reason: 'Your doctor asked for a fresh reading' }
      : sc && !sc.expired ? { reason: `Re-measure within ${sc.minLeft} min. An in-range reading clears this alert` }
      : null

    return {
      def, icon: def.icon, name: def.name, value: u.value(a.value), unit: u.unit, direction, danger, statusLine, remeasure,
      target: def.id === 'bp' ? `Target ${shown.min}–${shown.max} / ${diaMin}–${diaMax}` : `Target ${shown.min}–${shown.max}`,
      tips: tipsFor(def.id, direction, danger),
    }
  }
}

/** How long a patient has to clear a warning by re-measuring; shown in the empty state. */
export const SELF_CLEAR_NOTE = `A warning clears by itself if you re-measure in range within ${SELF_CLEAR_WINDOW_MIN} minutes.`

/* ─── Home: the alerts that are open right now ──────────────────────── */

/** Alerts the patient has closed on Home, kept for this browser session. */
const DISMISSED_KEY = 'mcare-home-alerts-closed'
function readDismissed(): string[] {
  try { return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? '[]') } catch { return [] }
}

/**
 * The alerts popup on Home. One calm white card instead of a red wall: each
 * reading shows its number, where it is with the doctor, and a Re-measure
 * button when a fresh reading would help.
 *
 * The patient can close it with the x. Closing only hides the card: the alerts
 * stay open with the care team and under My Alerts (the Alerts tile keeps its
 * count). It comes back when a new alert arrives, and on the next visit.
 */
export function AlertSummaryCard({ alerts, onOpenAll, onLog }: {
  alerts: AppAlert[]
  onOpenAll: () => void
  /** Opens the log sheet for one vital. */
  onLog: (vitalId: string) => void
}) {
  const view = useAlertView()
  const [dismissed, setDismissed] = useState(readDismissed)
  // Closed means every alert on show was there when the patient closed it.
  if (alerts.length === 0 || alerts.every(a => dismissed.includes(a.id))) return null
  const close = () => {
    const ids = alerts.map(a => a.id)
    setDismissed(ids)
    try { sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(ids)) } catch { /* private mode: closed until the screen is reopened */ }
  }
  const anyDanger = alerts.some(a => a.severity === 'danger')
  const shown = alerts.slice(0, 3)
  const more = alerts.length - shown.length

  return (
    <section aria-label="Active alerts" className={`alert-pop bg-white rounded-2xl shadow-sm overflow-hidden border ${anyDanger ? 'border-red-200' : 'border-amber-200'}`}>
      <div className="flex items-center gap-2 pr-3">
      <button onClick={onOpenAll} className="flex-1 min-w-0 flex items-center gap-3 pl-3.5 py-3 text-left">
        <span className={`relative w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${anyDanger ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" />
          </svg>
          <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white animate-pulse ${anyDanger ? 'bg-red-500' : 'bg-amber-500'}`} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-gray-900">
            <span className="font-mono">{alerts.length}</span> {alerts.length === 1 ? 'reading needs' : 'readings need'} attention
          </span>
          <span className="block text-[11px] text-gray-500 truncate">Your care team can see {alerts.length === 1 ? 'it' : 'them'}. Here is what to do.</span>
        </span>
        <span className="text-[11px] font-bold text-teal-700 flex-shrink-0">View all ›</span>
      </button>
      <CloseButton onClick={close} label="Close alerts" />
      </div>

      <div className="border-t border-gray-100 divide-y divide-gray-100">
        {shown.map(a => {
          const v = view(a)
          const tone = v.danger ? { bar: 'bg-red-500', value: 'text-red-600' } : { bar: 'bg-amber-400', value: 'text-amber-600' }
          return (
            <div key={a.id}>
              <button onClick={onOpenAll} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left">
                <span className={`w-1 self-stretch rounded-full flex-shrink-0 ${tone.bar}`} />
                <span className="text-lg flex-shrink-0" aria-hidden="true">{v.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold text-gray-900 truncate">
                    {v.name}{v.direction && <span className="font-normal text-gray-500"> · {v.direction === 'high' ? 'above' : 'below'} target</span>}
                  </span>
                  <span className="block text-[11px] text-gray-500 truncate">{v.statusLine}</span>
                </span>
                <span className="text-right flex-shrink-0">
                  <span className={`block text-base font-black leading-tight font-mono ${tone.value}`}>{v.value}</span>
                  {v.unit && <span className="block text-[10px] text-gray-400">{v.unit}</span>}
                </span>
              </button>
              {v.remeasure && v.def && (
                <div className="flex items-center gap-2 pl-7.5 pr-3.5 pb-2.5">
                  <p className="flex-1 min-w-0 text-[11px] text-gray-600 leading-snug">{v.remeasure.reason}.</p>
                  <button onClick={() => onLog(v.def!.id)} className="flex-shrink-0 rounded-full bg-teal-700 px-3 py-1.5 text-[11px] font-bold text-white active:scale-95 transition-transform">
                    Re-measure
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {more > 0 && (
        <button onClick={onOpenAll} className="w-full border-t border-gray-100 py-2 text-[11px] font-bold text-teal-700">
          +<span className="font-mono">{more}</span> more
        </button>
      )}
    </section>
  )
}

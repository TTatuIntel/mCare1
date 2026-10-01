import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, levelStyle } from '@/shared'
import { evaluate, latestValid, unitView, ago, readingTime } from '@/shared/lib/vitals'
import { usePatient } from './usePatient'
import { useSelfClear } from './VitalLogSheets'

/**
 * The floating "Log vitals" button. One tap lists the vitals this patient
 * tracks (the ones they chose or their doctor assigned); a second tap opens
 * the log sheet for that vital. Vitals waiting on a re-measure come first.
 */
export function QuickLogFab({ onLogOne, onLogAll, due = false }: {
  onLogOne: (vitalId: string) => void
  onLogAll: () => void
  /** A vitals check is due now: shows a dot on the button. */
  due?: boolean
}) {
  const { vitalDefs, now } = useApp()
  const { patient } = usePatient()
  const selfClear = useSelfClear()
  const [open, setOpen] = useState(false)

  const tracked = vitalDefs.filter(v => v.active && patient.trackedVitalIds.includes(v.id))
  if (tracked.length === 0) return null

  const tiles = tracked.map(def => {
    const sc = selfClear(def)
    return { def, last: latestValid(patient, def.id), remeasure: !!sc && !sc.expired }
  }).sort((a, b) => Number(b.remeasure) - Number(a.remeasure))

  const pick = (run: () => void) => { setOpen(false); run() }

  return (
    <>
      <button type="button" onClick={() => (tracked.length === 1 ? onLogOne(tracked[0].id) : setOpen(true))}
        className="relative flex h-12 items-center gap-2 rounded-full bg-teal-700 pl-2 pr-4 text-sm font-bold text-white shadow-lg shadow-teal-700/35 ring-1 ring-inset ring-white/20 transition-all hover:bg-teal-800 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/40">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 ring-1 ring-inset ring-white/25">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14" /><path d="M5 12h14" />
          </svg>
        </span>
        Log vitals
        {due && <span aria-label="A vitals check is due" className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-amber-400" />}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Log a vital" subtitle="Tap the one you just measured"
        footer={<SheetButton tone="ghost" onClick={() => pick(onLogAll)}>Log several at once</SheetButton>}>
        <div className="grid grid-cols-2 gap-2">
          {tiles.map(({ def, last, remeasure }) => {
            const u = unitView(def, patient)
            const at = last ? readingTime(last) : null
            const lvl = last ? evaluate(patient, def, last.value) : null
            return (
              <button key={def.id} type="button" onClick={() => pick(() => onLogOne(def.id))}
                className={`relative flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition-all active:scale-[.97] hover:border-teal-300 ${remeasure ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
                <span className="flex w-full items-center justify-between">
                  <span className="text-xl" aria-hidden="true">{def.icon}</span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-white text-sm font-bold leading-none">+</span>
                </span>
                <span className="text-xs font-bold text-gray-900 truncate max-w-full">{def.name}</span>
                {remeasure ? (
                  <span className="text-[10px] font-semibold text-amber-700">Re-measure to clear alert</span>
                ) : last ? (
                  <span className="text-[10px] text-gray-500 truncate max-w-full">
                    Last <span className={`font-bold font-mono ${levelStyle(lvl).value}`}>{u.value(last.value)}</span>{at ? ` · ${ago(at, now)}` : ''}
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-400">No readings yet</span>
                )}
              </button>
            )
          })}
        </div>
      </BottomSheet>
    </>
  )
}

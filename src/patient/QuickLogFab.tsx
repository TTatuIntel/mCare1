import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, levelStyle } from '@/shared'
import { evaluate, latestValid, unitView, ago, readingTime, groupOf, VITAL_GROUPS } from '@/shared/lib/vitals'
import { usePatient } from './usePatient'
import { useSelfClear } from './VitalLogSheets'

/**
 * The floating "Log vitals" button. One tap lists the vitals this patient
 * tracks (the ones they chose or their doctor assigned), laid out in their
 * groups the way the Vitals tab has them. From there the patient logs one
 * vital, one group together, or everything at once. Groups with a vital
 * waiting on a re-measure come first.
 *
 * The button floats: it bobs gently, a glow breathes under it, and it rings
 * while a vitals check is due. `PortalShell` shrinks it to its icon while the
 * screen scrolls down (`data-compact` on the `group/fab` wrapper) and opens it
 * again on the way back up.
 */
export function QuickLogFab({ onLogOne, onLogGroup, onLogAll, due = false }: {
  onLogOne: (vitalId: string) => void
  onLogGroup: (groupId: string) => void
  onLogAll: () => void
  /** A vitals check is due now: the button rings and shows a dot. */
  due?: boolean
}) {
  const { vitalDefs, now } = useApp()
  const { patient } = usePatient()
  const selfClear = useSelfClear()
  const [open, setOpen] = useState(false)

  const tracked = vitalDefs.filter(v => v.active && patient.trackedVitalIds.includes(v.id))
  if (tracked.length === 0) return null

  const groups = VITAL_GROUPS
    .map(g => ({
      ...g,
      tiles: tracked.filter(v => groupOf(v.id) === g.id).map(def => {
        const sc = selfClear(def)
        return { def, last: latestValid(patient, def.id), remeasure: !!sc, clears: !!sc?.clears }
      }),
    }))
    .filter(g => g.tiles.length > 0)
    .sort((a, b) => Number(b.tiles.some(t => t.remeasure)) - Number(a.tiles.some(t => t.remeasure)))

  const pick = (run: () => void) => { setOpen(false); run() }

  return (
    <>
      <div className="fab-in">
        <div className="fab-float relative">
          <span aria-hidden className="auth-glow absolute inset-x-3 -bottom-1.5 h-7 rounded-full bg-teal-500/60 blur-xl" />
          {due && <span aria-hidden className="auth-cta-ring pointer-events-none absolute inset-0 rounded-full ring-2 ring-amber-400/70" />}
          <button type="button" aria-label="Log vitals" onClick={() => (tracked.length === 1 ? onLogOne(tracked[0].id) : setOpen(true))}
            className="group/btn relative flex h-12 items-center gap-2 overflow-hidden rounded-full bg-teal-700 pl-2 pr-4 text-sm font-bold text-white shadow-lg shadow-teal-700/35 ring-1 ring-inset ring-white/20 transition-all duration-300 hover:bg-teal-800 hover:shadow-xl active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/40 group-data-[compact=true]/fab:gap-0 group-data-[compact=true]/fab:pr-2">
            <span aria-hidden className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent" />
            <span aria-hidden className="auth-sheen absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-inset ring-white/25 transition-colors group-hover/btn:bg-white group-hover/btn:text-teal-700">
              <svg className="h-4 w-4 transition-transform duration-300 group-hover/btn:rotate-90 group-active/btn:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14" /><path d="M5 12h14" />
              </svg>
            </span>
            {/* The label folds away while the screen scrolls down. */}
            <span aria-hidden className="relative max-w-24 overflow-hidden whitespace-nowrap transition-all duration-300 group-data-[compact=true]/fab:max-w-0 group-data-[compact=true]/fab:opacity-0">Log vitals</span>
          </button>
          {due && (
            <span aria-label="A vitals check is due" className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
              <span aria-hidden className="absolute inset-0 rounded-full bg-amber-400 motion-safe:animate-ping" />
              <span className="relative h-3 w-3 rounded-full border-2 border-white bg-amber-400" />
            </span>
          )}
        </div>
      </div>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Log vitals" subtitle="Pick one vital, a whole group, or everything"
        footer={<SheetButton onClick={() => pick(onLogAll)}>Log all <span className="font-mono">{tracked.length}</span> at once</SheetButton>}>
        <div className="flex flex-col gap-4">
          {groups.map(g => (
            <section key={g.id} aria-label={g.label}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-base" aria-hidden="true">{g.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-gray-900">{g.label}</p>
                  <p className="truncate text-[10px] text-gray-400">{g.hint}</p>
                </div>
                {g.tiles.length > 1 && (
                  <button type="button" onClick={() => pick(() => onLogGroup(g.id))}
                    className="shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-700 transition-all hover:bg-teal-100 active:scale-95">
                    Log group
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {g.tiles.map(({ def, last, remeasure, clears }) => {
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
                        <span className="text-[10px] font-semibold text-amber-700">{clears ? 'Re-measure to clear alert' : 'Re-measure for your doctor'}</span>
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
            </section>
          ))}
        </div>
      </BottomSheet>
    </>
  )
}

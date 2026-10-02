/** Small controls every portal uses to switch a view, filter a list or act on a row. */
import type { Outcome } from '@/shared/lib/types'
import { SaveError, useSave, useToast } from './BottomSheet'

/* ─── Segmented: two or three views of one screen ─── */
export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  /** What a screen reader announces for the group. */
  label?: string
}) {
  return (
    <div className="flex bg-gray-100 rounded-xl p-1 gap-0.5" role="tablist" aria-label={label}>
      {options.map(o => (
        <button key={o.id} role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}
          className={`flex-1 text-[11px] px-2 py-1.5 rounded-lg font-semibold transition-all ${value === o.id ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-400'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ─── ChipFilter: a row of choices that scrolls sideways when it does not fit ─── */
export function ChipFilter<T extends string>({ options, value, onChange, tone = 'white', label }: {
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  /** The colour of an unselected chip: white on a grey page, grey on a white card. */
  tone?: 'white' | 'gray'
  label?: string
}) {
  const idle = tone === 'white' ? 'bg-white text-gray-500 shadow-sm' : 'bg-gray-100 text-gray-500'
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5 span-all" style={{ scrollbarWidth: 'none' }} role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={value === o.id}
          className={`flex-shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full transition-colors ${value === o.id ? 'bg-teal-700 text-white' : idle}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ─── StatTiles: a row of figures ─── */
export function StatTiles({ items }: { items: { value: React.ReactNode; label: string; tone?: 'teal' | 'red' | 'amber' | 'green' | 'gray' }[] }) {
  const tones = { teal: 'text-teal-700', red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-600', gray: 'text-gray-700' }
  // Static class names, so Tailwind keeps them.
  const cols = items.length === 2 ? 'grid-cols-2' : items.length === 4 ? 'grid-cols-4' : 'grid-cols-3'
  return (
    <div className={`grid ${cols} gap-2`}>
      {items.map(x => (
        <div key={x.label} className="bg-white rounded-2xl py-3 px-1 text-center shadow-sm">
          <p className={`text-lg font-black font-mono ${tones[x.tone ?? 'teal']}`}>{x.value}</p>
          <p className="text-[10px] text-gray-400 leading-tight">{x.label}</p>
        </div>
      ))}
    </div>
  )
}

/* ─── A button that saves on its own ───
   For a row action with no form around it (Acknowledge, Stop, Withdraw…).
   `node` is the one result line for the screen: what was done once it is
   saved, or why it was not. Nothing is announced before the save comes back.

     const act = useAct()
     <button disabled={act.busy} onClick={() => act.run(() => stopMedicine(id), 'Medicine stopped')}>Stop</button>
     {act.node}
*/
export function useAct() {
  const save = useSave()
  const toast = useToast()
  const run = async <T,>(job: () => Promise<Outcome<T>>, done?: string | ((value: T) => string)): Promise<Outcome<T>> => {
    const result = await save.run(job)
    if (result.ok && done) toast.show(typeof done === 'function' ? done(result.value) : done)
    return result
  }
  const node = save.error ? <SaveError message={save.error} /> : toast.node
  /** Announces something that was saved elsewhere on the screen (a form's own save). */
  const say = (message: string) => { save.clear(); toast.show(message) }
  return { run, busy: save.busy, error: save.error, ref: save.ref, node, say, clear: save.clear }
}

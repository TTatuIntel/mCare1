import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { PatientUser, VitalDef, VitalReading } from '@/shared/lib/types'
import { evaluate, parseValue, readingTime, dateLabel, formatReadingValue, toDisplayUnit, type VitalLevel } from '@/shared/lib/vitals'
import { levelStyle } from './vitals'

/* ─── A vital's history ───────────────────────────────────────────────
   Every reading handed in, narrowed by filter chips and ordered by time
   or value. The list scrolls inside its own card, with the month pinned
   at the top, so a long history never pushes the rest of the page away.
   Shared by the patient's vital page and the doctor's patient view; each
   passes its own per-row `action` (Correct / Mark invalid). */

export type ReadingFilter = 'all' | 'out' | 'critical' | 'normal' | 'morning' | 'evening' | 'notes' | 'invalid'
type Filter = ReadingFilter
type Sort = 'newest' | 'oldest' | 'highest' | 'lowest'

const SORTS: { key: Sort; label: string }[] = [
  { key: 'newest',  label: 'Newest first' },
  { key: 'oldest',  label: 'Oldest first' },
  { key: 'highest', label: 'Highest first' },
  { key: 'lowest',  label: 'Lowest first' },
]

interface Row {
  r: VitalReading
  t: number | null
  level: VitalLevel | null
  /** Primary number, for sorting by value. */
  n: number | null
  /** Change from the previous valid reading. */
  delta: number | null
}

/** The part of a row the filters look at. */
type Facts = Pick<Row, 'r' | 't' | 'level'>
const hourOf = (x: Facts) => (x.t === null ? null : new Date(x.t).getHours())

const MATCH: Record<Filter, (x: Facts) => boolean> = {
  all:      () => true,
  out:      x => x.level === 'warning' || x.level === 'critical',
  critical: x => x.level === 'critical',
  normal:   x => x.level === 'normal',
  morning:  x => { const h = hourOf(x); return h !== null && h < 12 },
  evening:  x => { const h = hourOf(x); return h !== null && h >= 17 },
  notes:    x => !!x.r.note,
  invalid:  x => !!x.r.invalid,
}
const FILTERS: { key: Filter; label: string; dot?: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'out',      label: 'Out of range', dot: 'bg-amber-400' },
  { key: 'critical', label: 'Critical',     dot: 'bg-red-500' },
  { key: 'normal',   label: 'Normal',       dot: 'bg-emerald-400' },
  { key: 'morning',  label: '🌅 Morning' },
  { key: 'evening',  label: '🌙 Evening' },
  { key: 'notes',    label: 'With notes' },
  { key: 'invalid',  label: 'Invalid',      dot: 'bg-gray-300' },
]

const factsOf = (patient: PatientUser, def: VitalDef, r: VitalReading): Facts =>
  ({ r, t: readingTime(r), level: r.invalid ? null : evaluate(patient, def, r.value) })

/** Whether a reading passes a filter — the same rule the chips, the list and a chart beside them all use. */
export const readingMatches = (filter: ReadingFilter, patient: PatientUser, def: VitalDef, r: VitalReading) =>
  MATCH[filter](factsOf(patient, def, r))

/** The filter chips, each with how many of `rows` it would show. A chip only appears when it would show something. */
export function ReadingFilterChips({ patient, def, rows, filter, onFilter, className = '' }: {
  patient: PatientUser
  def: VitalDef
  rows: VitalReading[]
  filter: ReadingFilter
  onFilter: (f: ReadingFilter) => void
  className?: string
}) {
  const facts = rows.map(r => factsOf(patient, def, r))
  const count = (f: Filter) => facts.filter(MATCH[f]).length
  // The active chip always stays, so it can be turned off.
  const chips = FILTERS.filter(f => f.key === 'all' || f.key === filter || count(f.key) > 0)
  return (
    <div className={`flex gap-1.5 overflow-x-auto scrollbar-hide ${className}`} style={{ scrollbarWidth: 'none' }} role="group" aria-label="Filter readings">
      {chips.map(f => {
        const on = filter === f.key
        return (
          <button key={f.key} onClick={() => onFilter(on ? 'all' : f.key)} aria-pressed={on}
            className={`flex-shrink-0 flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-full border transition-colors ${
              on ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-gray-500 border-gray-200'}`}>
            {f.dot && <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />}
            {f.label}
            <span className={`font-mono text-[9px] px-1 rounded-full ${on ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>{count(f.key)}</span>
          </button>
        )
      })}
    </div>
  )
}

const DAY = 86_400_000
const clockOf = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const round1 = (n: number) => Math.round(n * 10) / 10

export function VitalHistory({
  patient, def, unit = def.unit, rows, total, latestId, focusId, caption, action, onShowAll, filter: outerFilter, onFilter, embedded,
  className = 'bg-white rounded-2xl shadow-sm', listClassName = 'max-h-[22rem] @5xl:max-h-[34rem]',
}: {
  patient: PatientUser
  def: VitalDef
  /** Unit to show values in; defaults to the vital's own. Clinicians see the stored unit, patients their preference. */
  unit?: string
  /** This vital's readings to list (already limited to the page's period, if it has one), in any order. */
  rows: VitalReading[]
  /** How many readings this vital has in all, across every period. */
  total: number
  latestId?: string
  /** Reading to bring into view and highlight, e.g. the chart point just tapped. */
  focusId?: string | null
  /** Per-row control under the status chip, e.g. "Correct" or "Mark invalid". */
  action?: (r: VitalReading) => React.ReactNode
  /** Widen the page's period to all history. */
  onShowAll?: () => void
  /** Small line under the title saying which readings these are, e.g. "From the last 30 days". */
  caption?: string
  /** Give both to control the filter from outside (e.g. shared with a chart); the chips are then drawn by the owner. */
  filter?: ReadingFilter
  onFilter?: (f: ReadingFilter) => void
  /** Sits inside another card that already has the title: no heading, just the count and sort. */
  embedded?: boolean
  /** Card chrome and list height, so the history can sit inside another card. */
  className?: string
  listClassName?: string
}) {
  const { now } = useApp()
  const [ownFilter, setOwnFilter] = useState<Filter>('all')
  const filter = outerFilter ?? ownFilter
  const setFilter = onFilter ?? setOwnFilter
  const [sort, setSort] = useState<Sort>('newest')
  const cardRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Bring a focused reading into view: scroll the page to this card and the list to the row.
  useEffect(() => {
    if (!focusId) return
    const raf = requestAnimationFrame(() => {
      const card = cardRef.current, list = listRef.current
      const row = list?.querySelector<HTMLElement>(`[data-reading="${focusId}"]`)
      if (!card || !list || !row) return
      list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - 32
      const page = card.parentElement?.closest<HTMLElement>('.overflow-y-auto')
      if (page) page.scrollTop += card.getBoundingClientRect().top - page.getBoundingClientRect().top - 8
    })
    return () => cancelAnimationFrame(raf)
  }, [focusId])

  // Change against the reading before it, worked out over the whole history so the
  // first row of a period still compares with the one just outside it.
  const deltas = new Map<string, number>()
  patient.readings
    .filter(r => r.vitalId === def.id && !r.invalid)
    .map(r => ({ id: r.id, t: readingTime(r), n: parseValue(def, r.value)?.primary }))
    .filter((x): x is { id: string; t: number; n: number } => x.t !== null && x.n !== undefined)
    .sort((a, b) => a.t - b.t)
    .forEach((x, i, arr) => { if (i > 0) deltas.set(x.id, round1(toDisplayUnit(x.n, def.unit, unit) - toDisplayUnit(arr[i - 1].n, def.unit, unit))) })

  const items: Row[] = rows.map(r => ({
    r,
    t: readingTime(r),
    level: r.invalid ? null : evaluate(patient, def, r.value),
    n: parseValue(def, r.value)?.primary ?? null,
    delta: deltas.get(r.id) ?? null,
  }))

  const byTime = sort === 'newest' || sort === 'oldest'
  const dir = sort === 'newest' || sort === 'highest' ? -1 : 1
  // Undated readings and unreadable values sink to the bottom whichever way the list runs.
  const key = (x: Row) => (byTime ? x.t : x.n)
  const shown = items.filter(MATCH[filter]).sort((a, b) => {
    const ka = key(a), kb = key(b)
    if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1
    return (ka - kb) * dir
  })

  const today = new Date(now).toDateString()
  const yesterday = new Date(now - DAY).toDateString()
  /** "Today", "Yesterday" or "Sep 27" — with the year only when it isn't this one. */
  const dayOf = (t: number) => {
    const d = new Date(t), s = d.toDateString()
    if (s === today) return 'Today'
    if (s === yesterday) return 'Yesterday'
    return d.getFullYear() === new Date(now).getFullYear() ? dateLabel(d).split(',')[0] : dateLabel(d)
  }
  const monthOf = (t: number | null) =>
    (t === null ? 'Undated' : new Date(t).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))
  // Month sections only make sense in time order; by value the list is one flat ranking.
  const groups: { label: string | null; rows: Row[] }[] = []
  shown.forEach(x => {
    const label = byTime ? monthOf(x.t) : null
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.rows.push(x)
    else groups.push({ label, rows: [x] })
  })

  return (
    <div ref={cardRef} className={`overflow-hidden ${className}`}>
      <div className={embedded ? 'pb-2' : 'px-3.5 pt-3.5 pb-2.5'}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            {!embedded && <p className="text-sm font-bold text-gray-900">History</p>}
            <p className="text-[10px] text-gray-400 mt-0.5 truncate">
              {shown.length} reading{shown.length === 1 ? '' : 's'}{caption ? ` · ${caption.charAt(0).toLowerCase()}${caption.slice(1)}` : shown.length === total ? '' : ` of ${total}`}
            </p>
          </div>
          <label className="relative flex-shrink-0">
            <span className="sr-only">Sort readings</span>
            <select value={sort} onChange={e => setSort(e.target.value as Sort)}
              className="appearance-none text-[10px] font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-full pl-2.5 pr-6 py-1.5 outline-none focus:border-teal-400">
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[8px] text-gray-400 pointer-events-none" aria-hidden="true">▼</span>
          </label>
        </div>

        {/* filters: status, time of day, notes — unless the owner draws them */}
        {!outerFilter && rows.length > 0 && (
          <ReadingFilterChips patient={patient} def={def} rows={rows} filter={filter} onFilter={setFilter} className="-mx-3.5 px-3.5 mt-2.5" />
        )}
      </div>

      {shown.length === 0 ? (
        <div className="px-3.5 pb-6 pt-4 text-center border-t border-gray-50">
          <p className="text-sm text-gray-400">
            {total === 0 ? 'No readings logged yet.' : rows.length === 0 ? 'No readings in this period.' : 'No readings match this filter.'}
          </p>
          {total > 0 && rows.length === 0 && onShowAll && (
            <button onClick={onShowAll} className="text-[11px] font-bold text-teal-700 mt-1">Show all history</button>
          )}
          {rows.length > 0 && (
            <button onClick={() => setFilter('all')} className="text-[11px] font-bold text-teal-700 mt-1">Clear filter</button>
          )}
        </div>
      ) : (
        <div ref={listRef} className={`overflow-y-auto overscroll-contain border-t border-gray-50 ${listClassName}`} style={{ scrollbarWidth: 'thin' }}
          tabIndex={0} role="region" aria-label={`${def.name} readings`}>
          {groups.map((g, gi) => (
            <div key={g.label ?? gi}>
              {g.label && (
                <div className="sticky top-0 z-10 flex items-center justify-between px-3.5 py-1 bg-gray-50/95 backdrop-blur-sm">
                  <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">{g.label}</p>
                  <p className="text-[9px] text-gray-400 font-mono">{g.rows.length} reading{g.rows.length === 1 ? '' : 's'}</p>
                </div>
              )}
              {g.rows.map(({ r, t, level, delta }) => {
                const s = levelStyle(level)
                return (
                  <div key={r.id} data-reading={r.id}
                    className={`flex items-stretch border-b border-gray-50 last:border-0 transition-colors ${r.id === focusId ? 'bg-teal-50' : ''}`}>
                    {/* status rail */}
                    <div className="w-[3px] flex-shrink-0" style={{ background: s.accent }} />
                    <div className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="flex items-baseline gap-1 min-w-0">
                          <span className={`text-base font-black leading-tight font-mono ${r.invalid ? 'line-through text-gray-400' : s.value}`}>{formatReadingValue(def, r.value, unit)}</span>
                          <span className="text-[9px] text-gray-400">{unit}</span>
                          {!r.invalid && delta !== null && delta !== 0 && (
                            <span className="text-[9px] font-bold text-gray-400 font-mono ml-0.5">{delta > 0 ? '▲' : '▼'}{Math.abs(delta)}</span>
                          )}
                          {r.id === latestId && <span className="text-[8px] bg-teal-100 text-teal-700 font-bold px-1.5 py-px rounded-full ml-1 self-center">Latest</span>}
                        </p>
                        <p className="text-[10px] text-gray-400 truncate">
                          {t !== null ? `${dayOf(t)} · ${clockOf(t)}` : r.loggedAt}
                          {r.note ? ` · “${r.note}”` : ''}
                        </p>
                        {r.invalid && r.invalidReason && <p className="text-[10px] text-gray-400 truncate">Marked invalid — {r.invalidReason}</p>}
                        {/* A corrected reading says so, and keeps what was first entered. */}
                        {r.correctedFrom && <p className="text-[10px] text-gray-400 truncate">Corrected · first entered as <span className="font-mono">{formatReadingValue(def, r.correctedFrom, unit)}</span></p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        {level === 'normal'
                          ? <span className="text-[10px] font-semibold text-emerald-600">✓ In target</span>
                          : <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${s.chip}`}>{r.invalid ? 'Invalid' : s.label}</span>}
                        {action?.(r)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

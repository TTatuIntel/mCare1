import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject, type CSSProperties } from 'react'
import type { PatientUser, VitalDef } from '@/shared/lib/types'
import {
  evaluate, latestValid, targetRange, parseValue, displayUnitFor, formatReadingValue, toDisplayUnit,
  checkInStatus, shortDuration, type VitalLevel, type CheckIn,
} from '@/shared/lib/vitals'

/* ─── Home-card vitals strip ──────────────────────────────────────────
   One cell per headline vital: the latest value in the patient's own
   units, how long ago it was logged, and a thin bar that fills toward
   the next expected check-in. Hovering (or tapping, on touch) a cell
   brings up a compact 7- or 30-day trend that fades in from a blur and
   fades back out when the pointer leaves. Clicking a cell — or "Open"
   in the popover — goes to that vital's own page. */

const DAY = 86_400_000
const POP_W = 228
const SHORT: Record<string, string> = { bp: 'BP', hr: 'HR', temp: 'Temp', spo2: 'SpO₂', gluc: 'Glucose', wt: 'Weight' }
const shortName = (d: VitalDef) => SHORT[d.id] ?? d.name
const unitSuffix = (u: string) => (u === '%' ? '%' : u.startsWith('°') ? '°' : '')

type Span = 7 | 30
interface Point { at: number; hi: number; lo?: number; level: VitalLevel }
/** Which side of its anchor the popover sits on. */
type Side = 'bottom' | 'top' | 'right' | 'left'
/**
 * Popover placement, in px relative to the strip. `caret` runs along the
 * edge facing the anchor: an x offset for top/bottom, a y offset for left/right.
 */
interface PopPos { left: number; top: number; side: Side; caret: number }
const isVertical = (s: Side) => s === 'top' || s === 'bottom'

/** Where the popover grows from: the caret tip on the edge facing the anchor. */
const CARET_ORIGIN: Record<Side, (c: number) => string> = {
  bottom: c => `${c}px 0%`,
  top: c => `${c}px 100%`,
  right: c => `0% ${c}px`,
  left: c => `100% ${c}px`,
}
/** A 12×6 triangle sitting just outside the edge that faces the anchor. */
const CARET_STYLE: Record<Side, (c: number) => CSSProperties> = {
  bottom: c => ({ top: -6, left: c - 6, width: 12, height: 6, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' }),
  top: c => ({ bottom: -6, left: c - 6, width: 12, height: 6, clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }),
  right: c => ({ left: -6, top: c - 6, width: 6, height: 12, clipPath: 'polygon(100% 0, 100% 100%, 0 50%)' }),
  left: c => ({ right: -6, top: c - 6, width: 6, height: 12, clipPath: 'polygon(0 0, 100% 50%, 0 100%)' }),
}
/** Gap to the row edge when anchored to a cell (touch / keyboard). */
const GAP = 8
/** Gap to the cursor when following the mouse — clears the cursor glyph without feeling detached. */
const CURSOR_GAP = 14

/** The part of the screen actually visible around `el`: the viewport, cut down by every clipping ancestor (e.g. the phone's scroll area). */
function visibleBounds(el: HTMLElement): { top: number; bottom: number; left: number; right: number } {
  const b = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth }
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (/(auto|scroll|hidden|clip)/.test(s.overflowY + s.overflowX)) {
      const r = p.getBoundingClientRect()
      b.top = Math.max(b.top, r.top); b.left = Math.max(b.left, r.left)
      b.bottom = Math.min(b.bottom, r.bottom); b.right = Math.min(b.right, r.right)
    }
  }
  return b
}

function seriesFor(patient: PatientUser, def: VitalDef, unit: string, days: Span, now: number): Point[] {
  const cutoff = now - days * DAY
  return patient.readings
    .filter(r => r.vitalId === def.id && !r.invalid && typeof r.at === 'number' && r.at >= cutoff)
    .flatMap((r): Point[] => {
      const p = parseValue(def, r.value)
      if (!p) return []
      return [{
        at: r.at as number,
        hi: toDisplayUnit(p.primary, def.unit, unit),
        lo: p.secondary === undefined ? undefined : toDisplayUnit(p.secondary, def.unit, unit),
        level: evaluate(patient, def, r.value),
      }]
    })
    .sort((a, b) => a.at - b.at)
}

const round1 = (n: number) => Math.round(n * 10) / 10
const fmtPt = (p: { hi: number; lo?: number }) => (p.lo === undefined ? String(round1(p.hi)) : `${Math.round(p.hi)}/${Math.round(p.lo)}`)

function cadenceLabel(h: number): string {
  if (h < 24) return `every ${h}h`
  if (h === 24) return 'daily'
  if (h === 168) return 'weekly'
  return `every ${Math.round(h / 24)}d`
}

const CHECKIN_TONE: Record<CheckIn['state'], { text: string; dot: string; bar: string }> = {
  fresh:      { text: 'text-teal-200',  dot: 'bg-emerald-300',             bar: 'bg-teal-200/70' },
  'due-soon': { text: 'text-amber-200', dot: 'bg-amber-300',               bar: 'bg-amber-300' },
  overdue:    { text: 'text-red-300',   dot: 'bg-red-400 animate-pulse',   bar: 'bg-red-400' },
  none:       { text: 'text-white/40',  dot: 'bg-white/30',                bar: 'bg-white/20' },
}

function checkInLabel(c: CheckIn, lastAt: number | undefined, now: number): string {
  if (c.state === 'none' || lastAt === undefined) return 'No reading'
  if (c.state === 'overdue') return 'Overdue'
  if (c.state === 'due-soon') return `Due in ${shortDuration(c.dueAt! - now)}`
  return `${shortDuration(now - lastAt)} ago`
}

export function VitalsStrip({ patient, defs, ids, now, onOpen }: {
  patient: PatientUser
  defs: VitalDef[]
  ids: string[]
  now: number
  /** Open the given vital's page. */
  onOpen: (vitalId: string) => void
}) {
  const [active, setActive] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [span, setSpan] = useState<Span>(7)
  const [pos, setPos] = useState<PopPos>({ left: 0, top: 0, side: 'bottom', caret: POP_W / 2 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const lastPointer = useRef<string>('mouse')
  const openedBy = useRef<'mouse' | 'touch' | 'key'>('mouse')
  // What the popover is anchored to: the cell, plus the cursor position when following the mouse.
  const anchor = useRef<{ cell: HTMLElement; x?: number; y?: number } | null>(null)
  const frame = useRef(0)

  /** Side used last while open — kept unless another side is clearly better, so it doesn't flicker. */
  const lastSide = useRef<Side | null>(null)

  /**
   * Smart placement on all four sides, with no fixed order. Each side is
   * scored by (a) whether the popover fits there on the visible screen and
   * (b) how much it points toward the open middle of the screen from where
   * the anchor is. So near the top it drops below, near the bottom it rises
   * above, over an edge cell it opens beside toward the centre — whatever
   * the position calls for. If nothing fits, the side showing the most wins.
   * With a mouse the anchor is the cursor itself, so the popover trails it
   * in both directions; with touch/keyboard (or after a scroll) it hugs the
   * row for above/below and the cell for left/right. The result is clamped
   * inside the visible area and the caret points at the anchor.
   */
  const place = () => {
    const wrap = wrapRef.current, a = anchor.current
    if (!wrap || !a) return
    const wr = wrap.getBoundingClientRect()
    const cr = a.cell.getBoundingClientRect()
    const b = visibleBounds(wrap)
    const w = POP_W
    const h = popRef.current?.offsetHeight || 240
    const following = a.x !== undefined && a.y !== undefined
    const g = following ? CURSOR_GAP : GAP
    // Anchor point, and the box the popover must keep clear of.
    const ax = a.x ?? cr.left + cr.width / 2
    const ay = a.y ?? cr.top + cr.height / 2
    const box = following
      ? { top: ay, bottom: ay, left: ax, right: ax }
      : { top: wr.top, bottom: wr.bottom, left: cr.left, right: cr.right }

    const room: Record<Side, number> = {
      bottom: b.bottom - box.bottom - g,
      top: box.top - g - b.top,
      right: b.right - box.right - g,
      left: box.left - g - b.left,
    }
    const need = (s: Side) => (isVertical(s) ? h : w) + 4
    // Where the anchor sits on the visible screen, 0–1 on each axis.
    const nx = (ax - b.left) / Math.max(1, b.right - b.left)
    const ny = (ay - b.top) / Math.max(1, b.bottom - b.top)
    // Positive when the side points toward the middle, strongest near an edge.
    const toward: Record<Side, number> = { bottom: 0.5 - ny, top: ny - 0.5, right: 0.5 - nx, left: nx - 0.5 }
    const score = (s: Side) => {
      const ratio = room[s] / need(s)
      return (ratio >= 1 ? 1 : ratio - 1) + toward[s] * 0.8 // not fitting costs far more than direction
    }
    const sides: Side[] = ['bottom', 'top', 'right', 'left']
    let side = sides.reduce((best, s) => (score(s) > score(best) ? s : best))
    const prev = lastSide.current
    if (prev && prev !== side && room[prev] >= need(prev) && score(side) - score(prev) < 0.15) side = prev
    lastSide.current = side

    let L: number, T: number
    if (isVertical(side)) {
      L = ax - w / 2
      T = side === 'bottom' ? box.bottom + g : box.top - g - h
    } else {
      T = ay - h / 2
      L = side === 'right' ? box.right + g : box.left - g - w
    }
    L = Math.max(b.left + 4, Math.min(L, b.right - w - 4))
    T = Math.max(b.top + 4, Math.min(T, b.bottom - h - 4))
    const caret = isVertical(side)
      ? Math.max(14, Math.min(ax - L, w - 14))
      : Math.max(14, Math.min(ay - T, h - 14))
    setPos({ left: L - wr.left, top: T - wr.top, side, caret })
  }
  const placeSoon = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(place) }
  // On scroll/resize the stored cursor position is stale, so fall back to hugging the cell.
  const replaceOnLayout = () => { if (anchor.current) anchor.current = { cell: anchor.current.cell }; placeSoon() }

  const show = (id: string, by: 'mouse' | 'touch' | 'key', cell: HTMLElement, x?: number, y?: number) => {
    window.clearTimeout(closeTimer.current)
    anchor.current = { cell, x, y }
    if (!open) lastSide.current = null // a fresh open picks its side from scratch
    place()
    openedBy.current = by
    setActive(id)
    setOpen(true)
  }

  // Re-measure once the popover has rendered for this vital/period (its height can change),
  // and keep it placed sensibly if the screen scrolls or resizes while it is open.
  useLayoutEffect(() => { if (open) place() }, [open, active, span])
  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', replaceOnLayout, true)
    window.addEventListener('resize', replaceOnLayout)
    return () => { window.removeEventListener('scroll', replaceOnLayout, true); window.removeEventListener('resize', replaceOnLayout) }
  }, [open])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current)
    // Long enough to cross the cursor gap into the popover without it vanishing.
    closeTimer.current = window.setTimeout(() => setOpen(false), 200)
  }

  // Touch & keyboard: dismiss on a tap outside or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const activeDef = active ? defs.find(d => d.id === active) : undefined

  return (
    <div ref={wrapRef} className="relative">
      <div ref={rowRef} className="grid bg-black/20 w-full rounded-b-[24px] overflow-hidden" style={{ gridTemplateColumns: `repeat(${ids.length},1fr)` }}>
        {ids.map((id, i) => {
          const def = defs.find(v => v.id === id)
          if (!def) return null
          const unit = displayUnitFor(def, patient)
          const r = latestValid(patient, id)
          const l = r ? evaluate(patient, def, r.value) : null
          const c = checkInStatus(id, r?.at, now, patient)
          const tone = CHECKIN_TONE[c.state]
          const pts = seriesFor(patient, def, unit, span, now)
          const dir = trendDir(pts, patient, def, unit)
          const isActive = open && active === id
          return (
            <button
              key={id}
              aria-label={`${def.name}: ${r ? formatReadingValue(def, r.value, unit) + ' ' + unit : 'no reading'}, ${checkInLabel(c, r?.at, now)}. Show trend.`}
              aria-expanded={isActive}
              onPointerDown={e => { lastPointer.current = e.pointerType }}
              onKeyDown={() => { lastPointer.current = 'key' }}
              onPointerEnter={e => { if (e.pointerType === 'mouse') show(id, 'mouse', e.currentTarget, e.clientX, e.clientY) }}
              onPointerMove={e => {
                if (e.pointerType !== 'mouse' || !isActive) return
                // Trails the cursor only while it is over the row; once it leaves (heading
                // into the popover) moves stop arriving here, so the popover holds still.
                anchor.current = { cell: e.currentTarget, x: e.clientX, y: e.clientY }
                placeSoon()
              }}
              onPointerLeave={e => { if (e.pointerType === 'mouse') scheduleClose() }}
              onFocus={e => { if (e.currentTarget.matches(':focus-visible')) show(id, 'key', e.currentTarget) }}
              onBlur={e => { if (openedBy.current === 'key' && !wrapRef.current?.contains(e.relatedTarget as Node)) scheduleClose() }}
              onClick={e => {
                // On touch the first tap reveals the trend; a second tap on the same cell opens that vital's page.
                if (lastPointer.current !== 'mouse' && lastPointer.current !== 'key' && !isActive) { show(id, 'touch', e.currentTarget); return }
                onOpen(id)
              }}
              className={`relative pt-2.5 pb-3 px-1 text-center outline-none transition-colors focus-visible:bg-white/10 ${isActive ? 'bg-white/10' : 'hover:bg-white/5'} ${i < ids.length - 1 ? 'border-r border-white/10' : ''}`}
            >
              <p className={`font-bold text-[13px] leading-none transition-opacity ${c.state === 'overdue' ? 'opacity-60' : ''} ${l === 'critical' ? 'text-red-300' : l === 'warning' ? 'text-amber-200' : 'text-white'}`}>
                {r ? formatReadingValue(def, r.value, unit) : '—'}
                {r && <span className="text-[10px] text-teal-200">{unitSuffix(unit)}</span>}
                {dir && <span className="text-[9px] text-teal-200 ml-0.5" aria-hidden="true">{dir === 'up' ? '↗' : dir === 'down' ? '↘' : '→'}</span>}
              </p>
              <p className="text-[10px] text-teal-300 mt-1 leading-none">{shortName(def)}</p>
              <p className={`text-[9px] mt-1 leading-none flex items-center justify-center gap-1 ${tone.text}`}>
                <span className={`w-1 h-1 rounded-full ${tone.dot}`} />
                {checkInLabel(c, r?.at, now)}
              </p>
              <span className="absolute left-2.5 right-2.5 bottom-1.5 h-[2px] rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
                <span className={`block h-full rounded-full transition-all duration-700 ${tone.bar}`} style={{ width: `${c.elapsed * 100}%` }} />
              </span>
            </button>
          )
        })}
      </div>

      {activeDef && (
        <TrendPopover
          open={open}
          patient={patient}
          def={activeDef}
          span={span}
          onSpan={setSpan}
          now={now}
          pos={pos}
          popRef={popRef}
          onOpen={() => onOpen(activeDef.id)}
          onPointerEnter={e => { if (e.pointerType === 'mouse') window.clearTimeout(closeTimer.current) }}
          onPointerLeave={e => { if (e.pointerType === 'mouse') scheduleClose() }}
        />
      )}
    </div>
  )
}

/** Direction of the primary number across the window, ignoring wiggles under 8% of the target band. */
function trendDir(pts: Point[], patient: PatientUser, def: VitalDef, unit: string): 'up' | 'down' | 'flat' | null {
  if (pts.length < 2) return null
  const t = targetRange(patient, def)
  const band = Math.max(0.1, toDisplayUnit(t.max, def.unit, unit) - toDisplayUnit(t.min, def.unit, unit))
  const change = pts[pts.length - 1].hi - pts[0].hi
  return Math.abs(change) < band * 0.08 ? 'flat' : change > 0 ? 'up' : 'down'
}

function TrendPopover({ open, patient, def, span, onSpan, now, pos, popRef, onOpen, onPointerEnter, onPointerLeave }: {
  open: boolean
  patient: PatientUser
  def: VitalDef
  span: Span
  onSpan: (s: Span) => void
  now: number
  pos: PopPos
  popRef: RefObject<HTMLDivElement | null>
  onOpen: () => void
  onPointerEnter: (e: ReactPointerEvent) => void
  onPointerLeave: (e: ReactPointerEvent) => void
}) {
  const unit = displayUnitFor(def, patient)
  const pts = seriesFor(patient, def, unit, span, now)
  const last = latestValid(patient, def.id)
  const c = checkInStatus(def.id, last?.at, now, patient)
  const t = targetRange(patient, def)
  const band = { min: toDisplayUnit(t.min, def.unit, unit), max: toDisplayUnit(t.max, def.unit, unit) }
  const diaBand = def.id === 'bp' ? { min: def.diaNormalMin ?? 60, max: def.diaNormalMax ?? 90 } : undefined

  const hasLo = pts.some(p => p.lo !== undefined)
  const avg = pts.length ? {
    hi: pts.reduce((s, p) => s + p.hi, 0) / pts.length,
    lo: hasLo ? pts.reduce((s, p) => s + (p.lo ?? 0), 0) / pts.length : undefined,
  } : null
  const low = pts.length ? pts.reduce((m, p) => (p.hi < m.hi ? p : m)) : null
  const high = pts.length ? pts.reduce((m, p) => (p.hi > m.hi ? p : m)) : null
  const inRangePct = pts.length ? Math.round((pts.filter(p => p.level === 'normal').length / pts.length) * 100) : null
  const change = pts.length >= 2 ? round1(pts[pts.length - 1].hi - pts[0].hi) : null

  return (
    <div
      ref={popRef}
      role="tooltip"
      data-open={open}
      data-side={pos.side}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="vital-pop vital-glass absolute z-30 rounded-2xl text-white"
      style={{
        left: pos.left,
        top: pos.top,
        width: POP_W,
        // grows out of the caret, so it appears to emerge from where the cursor is
        transformOrigin: CARET_ORIGIN[pos.side](pos.caret),
      }}
    >
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold truncate">{def.icon} {def.name}</p>
          <div className="flex bg-white/10 rounded-full p-0.5 flex-shrink-0" role="group" aria-label="Trend period">
            {([7, 30] as Span[]).map(s => (
              <button key={s} onClick={() => onSpan(s)} aria-pressed={span === s}
                className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-colors ${span === s ? 'bg-white text-teal-900' : 'text-teal-200'}`}>
                {s === 7 ? '7D' : '30D'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-baseline gap-1.5 mt-1.5">
          <span className="text-lg font-black leading-none font-mono">
            {last ? formatReadingValue(def, last.value, unit) : '—'}
          </span>
          <span className="text-[10px] text-teal-300">{unit}</span>
          {change !== null && (
            <span className="ml-auto text-[9px] font-bold text-teal-100 bg-white/10 rounded-full px-1.5 py-0.5">
              {change > 0 ? '▲ +' : change < 0 ? '▼ ' : '● '}{change} in {span}d
            </span>
          )}
        </div>

        <div className="mt-2">
          {pts.length === 0 ? (
            <p className="text-[10px] text-teal-200/80 py-3 text-center">No readings in the last {span} days.</p>
          ) : (
            <TrendChart pts={pts} band={band} diaBand={diaBand} days={span} now={now} id={def.id} />
          )}
          <div className="flex justify-between text-[9px] text-teal-300/70 mt-0.5">
            <span>{span}d ago</span>
            <span>target {band.min}–{band.max}</span>
            <span>now</span>
          </div>
        </div>

        {pts.length > 0 && (
          <div className="grid grid-cols-4 gap-1 mt-2 text-center">
            {[
              { k: 'Avg', v: avg ? fmtPt(avg) : '—' },
              { k: 'Low', v: low ? fmtPt(low) : '—' },
              { k: 'High', v: high ? fmtPt(high) : '—' },
              { k: 'In range', v: inRangePct === null ? '—' : `${inRangePct}%` },
            ].map(s => (
              <div key={s.k} className="bg-white/5 rounded-lg py-1">
                <p className="text-[10px] font-bold leading-none font-mono">{s.v}</p>
                <p className="text-[9px] text-teal-300 mt-0.5 leading-none">{s.k}</p>
              </div>
            ))}
          </div>
        )}
        {pts.length === 1 && <p className="text-[9px] text-teal-200/80 mt-1.5">One reading so far — log a few more to see a trend.</p>}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-white/10">
        <p className={`text-[9px] leading-tight ${CHECKIN_TONE[c.state].text}`}>
          {c.state === 'none' || !last?.at
            ? `Log ${cadenceLabel(c.intervalHours)} to track this`
            : c.state === 'overdue'
              ? `Overdue by ${shortDuration(now - c.dueAt!)} · log now`
              : `Logged ${shortDuration(now - last.at)} ago · next in ${shortDuration(c.dueAt! - now)}`}
          <span className="text-teal-300/60"> · {cadenceLabel(c.intervalHours)}</span>
        </p>
        <button onClick={onOpen} className="text-[9px] font-bold text-white bg-white/15 rounded-full px-2 py-0.5 flex-shrink-0">Open →</button>
      </div>

      {/* caret pointing back at the hovered cell, on whichever edge faces it.
          A triangle that sits wholly outside the glass, so the tint never doubles up. */}
      <span className="vital-glass-caret absolute" style={CARET_STYLE[pos.side](pos.caret)} />
    </div>
  )
}

/** Time-scaled line with the target band. Gaps in the line are real gaps in logging. */
function TrendChart({ pts, band, diaBand, days, now, id }: {
  pts: Point[]
  band: { min: number; max: number }
  diaBand?: { min: number; max: number }
  days: Span
  now: number
  id: string
}) {
  const W = 204, H = 50, P = 4
  const t0 = now - days * DAY
  const vals = pts.flatMap(p => (p.lo === undefined ? [p.hi] : [p.hi, p.lo]))
  const bands = diaBand ? [band, diaBand] : [band]
  const lo0 = Math.min(...vals, ...bands.map(b => b.min))
  const hi0 = Math.max(...vals, ...bands.map(b => b.max))
  const pad = (hi0 - lo0) * 0.08 || 1
  const lo = lo0 - pad, hi = hi0 + pad
  const x = (t: number) => P + ((t - t0) / (now - t0)) * (W - 2 * P)
  const y = (v: number) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P)
  const line = (get: (p: Point) => number | undefined) =>
    pts.filter(p => get(p) !== undefined).map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(get(p)!).toFixed(1)}`).join(' ')
  const hiPath = line(p => p.hi)
  const loPath = line(p => p.lo)
  const lastPt = pts[pts.length - 1]
  const dot = (lv: VitalLevel) => (lv === 'critical' ? '#fca5a5' : lv === 'warning' ? '#fcd34d' : 'rgba(255,255,255,.75)')
  const area = pts.length > 1 ? `${hiPath} L${x(lastPt.at).toFixed(1)},${H} L${x(pts[0].at).toFixed(1)},${H} Z` : ''

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: H }} aria-hidden="true">
      <defs>
        <linearGradient id={`vp-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#5eead4" stopOpacity=".28" />
          <stop offset="1" stopColor="#5eead4" stopOpacity="0" />
        </linearGradient>
      </defs>
      {bands.map((b, i) => (
        <rect key={i} x={P} width={W - 2 * P} y={y(b.max)} height={Math.max(1, y(b.min) - y(b.max))} rx="3" fill="#34d399" opacity=".12" />
      ))}
      {area && <path d={area} fill={`url(#vp-${id})`} />}
      {loPath && <path d={loPath} fill="none" stroke="#99f6e4" strokeOpacity=".5" strokeWidth="1.3" strokeDasharray="3 2" strokeLinejoin="round" strokeLinecap="round" />}
      <path d={hiPath} fill="none" stroke="#99f6e4" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={x(p.at)} cy={y(p.hi)} r={p.level === 'normal' ? 1.5 : 2.2} fill={dot(p.level)} />
      ))}
      <circle cx={x(lastPt.at)} cy={y(lastPt.hi)} r="5" fill={dot(lastPt.level)} opacity=".25" />
      <circle cx={x(lastPt.at)} cy={y(lastPt.hi)} r="2.8" fill={dot(lastPt.level)} stroke="#042e2e" strokeWidth="1" />
    </svg>
  )
}

/** Vital-sign widgets shared by the patient, doctor and admin portals. */
import { useCallback, useId, useState } from 'react'
import type { VitalDef } from '@/shared/lib/types'
import { ago } from '@/shared/lib/vitals'
import type { VitalLevel, Range, TrendPoint, TrendDirection, InsightTone, VitalInsight } from '@/shared/lib/vitals'
import { Toggle } from './primitives'

/* ─── VitalThresholdRow ─────────────────────────────────────────────── */
/**
 * Reusable editable threshold row used in both Doctor and Admin portals.
 * The parent holds editing state; this component is purely presentational.
 */
export function VitalThresholdRow({
  vital,
  threshold,
  isEditing,
  editMin,
  editMax,
  onStartEdit,
  onSave,
  onMinChange,
  onMaxChange,
  tracked,
  onToggleTracked,
}: {
  vital: VitalDef
  threshold: { min: number; max: number }
  isEditing: boolean
  editMin: string
  editMax: string
  onStartEdit: () => void
  onSave: () => void
  onMinChange: (v: string) => void
  onMaxChange: (v: string) => void
  /** When provided, renders an assign/track Toggle inline instead of a separate list. */
  tracked?: boolean
  onToggleTracked?: () => void
}) {
  return (
    <div className="border border-gray-100 rounded-xl p-3 mb-2 last:mb-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{vital.icon}</span>
          <p className="text-sm font-semibold text-gray-900">{vital.name}</p>
        </div>
        <div className="flex items-center gap-2">
          {onToggleTracked && <Toggle on={!!tracked} onChange={onToggleTracked} />}
          {tracked !== false && (
            <button
              onClick={isEditing ? onSave : onStartEdit}
              className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition-colors ${
                isEditing ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {isEditing ? 'Save' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      {tracked === false ? (
        <p className="text-[10px] text-gray-400">Not tracked for this patient. Default {vital.normalMin}–{vital.normalMax} {vital.unit}.</p>
      ) : isEditing ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[9px] text-gray-400 mb-1">Min ({vital.unit})</p>
            <input type="number" value={editMin} onChange={e => onMinChange(e.target.value)}
              className="w-full bg-gray-50 border border-teal-200 rounded-lg px-2.5 py-1.5 text-sm font-bold text-teal-700 outline-none" />
          </div>
          <div>
            <p className="text-[9px] text-gray-400 mb-1">Max ({vital.unit})</p>
            <input type="number" value={editMax} onChange={e => onMaxChange(e.target.value)}
              className="w-full bg-gray-50 border border-teal-200 rounded-lg px-2.5 py-1.5 text-sm font-bold text-teal-700 outline-none" />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-50 rounded-lg px-2 py-1 text-center">
            <p className="text-[9px] text-gray-400">Min</p>
            <p className="text-sm font-black text-gray-800 font-mono">{threshold.min}</p>
          </div>
          <div className="flex-1 h-[3px] bg-teal-100 rounded relative mx-1">
            <div className="absolute inset-0 bg-teal-500 rounded" style={{ left: '15%', right: '15%' }} />
          </div>
          <div className="flex-1 bg-gray-50 rounded-lg px-2 py-1 text-center">
            <p className="text-[9px] text-gray-400">Max</p>
            <p className="text-sm font-black text-gray-800 font-mono">{threshold.max}</p>
          </div>
          <p className="text-[9px] text-gray-400 w-8 flex-shrink-0">{vital.unit}</p>
        </div>
      )}

      {tracked !== false && (
        <p className="text-[9px] text-gray-400 mt-1">
          Platform default: {vital.normalMin}–{vital.normalMax} {vital.unit}
        </p>
      )}
    </div>
  )
}

/* ─── Vital level → box classes (color-by-severity), shared across portals ─── */
export const levelCls = (l: VitalLevel | null) =>
  l === 'critical' ? 'bg-red-50 border border-red-100 text-red-600'
  : l === 'warning' ? 'bg-amber-50 border border-amber-100 text-amber-700'
  : 'bg-gray-50 text-gray-900'

/* ─── VitalCard: compact tappable summary tile for a single vital's latest reading ─── */
export function VitalCard({ def, value, level, at, now, onClick }: {
  def: VitalDef
  value?: string
  level: VitalLevel | null
  at?: number
  now?: number
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={`rounded-xl p-2.5 text-center ${levelCls(level)}`}>
      <span className="text-base">{def.icon}</span>
      <p className="text-sm font-black leading-none mt-0.5 font-mono">{value ?? '—'}</p>
      <p className="text-[10px] text-gray-400">{def.unit}</p>
      <p className="text-[9px] text-gray-400">{at ? ago(at, now) : 'no data'}</p>
    </Tag>
  )
}

/* ─── Severity styling: the one place a vital level is turned into colour ─── */
export const LEVEL_STYLE: Record<VitalLevel | 'none', {
  accent: string; value: string; chip: string; label: string; tile: string; dot: string
}> = {
  critical: { accent: '#ef4444', value: 'text-red-600',   chip: 'text-red-600 bg-red-50 border-red-100',             label: '⚠ Critical', tile: 'bg-red-50',     dot: 'bg-red-500' },
  warning:  { accent: '#f59e0b', value: 'text-amber-600', chip: 'text-amber-600 bg-amber-50 border-amber-100',       label: '▲ Out',      tile: 'bg-amber-50',   dot: 'bg-amber-400' },
  normal:   { accent: '#10b981', value: 'text-gray-900',  chip: 'text-emerald-600 bg-emerald-50 border-emerald-100', label: '✓ Normal',   tile: 'bg-emerald-50', dot: 'bg-emerald-400' },
  none:     { accent: '#d1d5db', value: 'text-gray-400',  chip: 'text-gray-400 bg-gray-50 border-gray-100',          label: 'No data',    tile: 'bg-gray-50',    dot: 'bg-gray-300' },
}
export const levelStyle = (l: VitalLevel | null | undefined) => LEVEL_STYLE[l ?? 'none']

export const TREND_ARROW: Record<TrendDirection, string> = { rising: '↑', falling: '↓', steady: '→', unknown: '·' }

/* ─── InsightNotes: the auto-generated plain-language notes on a patient's readings ─── */
const INSIGHT_TONE: Record<InsightTone, { box: string; text: string; icon: string }> = {
  good:  { box: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-700', icon: '✓' },
  watch: { box: 'bg-amber-50 border-amber-100',     text: 'text-amber-700',   icon: '▲' },
  bad:   { box: 'bg-red-50 border-red-100',         text: 'text-red-600',     icon: '⚠' },
  info:  { box: 'bg-gray-50 border-gray-100',       text: 'text-gray-500',    icon: 'ℹ' },
}

export function InsightNotes({ insights, onOpen }: {
  insights: VitalInsight[]
  /** When given, a note about one vital opens that vital. */
  onOpen?: (vitalId: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {insights.map(i => {
        const s = INSIGHT_TONE[i.tone]
        const open = onOpen && i.vitalId ? () => onOpen(i.vitalId!) : undefined
        const Tag = open ? 'button' : 'div'
        return (
          <Tag key={i.id} onClick={open} className={`flex items-start gap-2 px-2.5 py-2 rounded-xl border text-left ${s.box}`}>
            <span className={`text-[10px] font-black leading-4 ${s.text}`}>{s.icon}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-[11px] leading-snug ${s.text}`}>{i.text}</p>
              {i.next && <p className="text-[10px] leading-snug text-gray-600 mt-0.5"><span className="font-bold">Next:</span> {i.next}</p>}
            </div>
            {open && <span className={`text-[10px] leading-4 ${s.text}`}>›</span>}
          </Tag>
        )
      })}
    </div>
  )
}

/* ─── VitalChart: the one trend chart, used at every size ─────────────
   Time-scaled, so a gap in the line is a real gap in logging. The scale
   follows the readings (not the whole target range), so day-to-day
   movement is visible; the green band is the part of the target range in
   view. `bare` is the tile-sized sparkline; `detailed` adds the value
   axis, labelled target edges and a soft fill for a full-page chart. */
export function VitalChart({ points, range, secondaryRange, from, to, height = 120, bare, detailed, format = round1, marks = [], activeId, onPick }: {
  /** Oldest → newest, as returned by `vitalTrend().points`. */
  points: TrendPoint[]
  range: Range
  /** Blood pressure: the diastolic target band. */
  secondaryRange?: Range
  /** Time axis bounds; default to the first and last point. */
  from?: number
  to?: number
  height?: number
  bare?: boolean
  detailed?: boolean
  /** How a stored number is written on the axis, e.g. converted to the patient's unit. */
  format?: (n: number) => number | string
  /** Moments to flag with a vertical marker, e.g. when the target range was changed. */
  marks?: number[]
  /** Makes each point tappable; receives the reading's id. */
  onPick?: (readingId: string) => void
  /** The picked reading, drawn with a guide line and a ring. */
  activeId?: string | null
}) {
  const gid = `vc${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [ref, width] = useElementWidth<SVGSVGElement>()
  if (points.length < 2) return <p className="text-[11px] text-gray-400 italic">Not enough readings for a trend yet.</p>
  // Drawn at the size it is shown, so it is as sharp and as wide as its card on any screen; a wide page chart also grows taller.
  const W = width || (bare ? 120 : 300)
  const H = detailed && W > 520 ? Math.round(height * 1.5) : height
  const PL = detailed ? 26 : bare ? 3 : 8, PR = bare ? 3 : 10, PT = bare ? 3 : 10, PB = bare ? 3 : 8
  const t0 = from ?? points[0].at
  const t1 = Math.max(to ?? points[points.length - 1].at, t0 + 1)
  const bands = secondaryRange ? [range, secondaryRange] : [range]

  // Scale to the readings, with breathing room; a target edge close by is pulled into view.
  const vals = points.flatMap(p => (p.secondary === undefined ? [p.value] : [p.value, p.secondary]))
  const dMin = Math.min(...vals), dMax = Math.max(...vals)
  const pad = Math.max((dMax - dMin) * 0.25, (range.max - range.min) * 0.08) || 1
  let lo = dMin - pad, hi = dMax + pad
  const reach = (hi - lo) * 0.6
  bands.forEach(b => {
    if (b.min < lo && lo - b.min < reach) lo = b.min - pad * 0.4
    if (b.max > hi && b.max - hi < reach) hi = b.max + pad * 0.4
  })

  const x = (t: number) => PL + Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) * (W - PL - PR)
  const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB)
  const top = PT, bottom = H - PB
  // Smooth without overshoot: each segment eases horizontally between its two readings.
  const line = (get: (p: TrendPoint) => number | undefined) =>
    points.filter(p => get(p) !== undefined).reduce((d, p, i, a) => {
      const px = x(p.at), py = y(get(p)!)
      if (i === 0) return `M${px.toFixed(1)},${py.toFixed(1)}`
      const cx = ((x(a[i - 1].at) + px) / 2).toFixed(1)
      return `${d} C${cx},${y(get(a[i - 1])!).toFixed(1)} ${cx},${py.toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`
    }, '')
  const primary = line(p => p.value)
  const secondary = line(p => p.secondary)
  const last = points[points.length - 1]
  const active = activeId ? points.find(p => p.id === activeId) : undefined
  const dot = (l: VitalLevel) => (l === 'normal' ? '#0a6e6e' : LEVEL_STYLE[l].accent)
  const inView = (v: number) => v > lo && v < hi

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: H }} role="img" aria-label="Trend of readings against the target range">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#0a6e6e" stopOpacity=".18" />
          <stop offset="1" stopColor="#0a6e6e" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* target band — only the part of it in view */}
      {bands.map((b, i) => {
        const yTop = Math.max(top, y(Math.min(b.max, hi))), yBot = Math.min(bottom, y(Math.max(b.min, lo)))
        if (yBot <= yTop) return null
        return (
          <g key={i}>
            <rect x={PL} y={yTop} width={W - PL - PR} height={yBot - yTop} rx={bare ? 0 : 4} fill="#10b981" opacity=".09" />
            {!bare && [b.max, b.min].filter(inView).map(v => (
              <g key={v}>
                <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#10b981" strokeDasharray="3 3" strokeWidth="1" opacity=".6" />
                {detailed && <text x={W - PR - 2} y={y(v) - 3} textAnchor="end" fontSize="8" fontWeight="700" fill="#059669">{format(v)}</text>}
              </g>
            ))}
          </g>
        )
      })}

      {/* value axis */}
      {detailed && [0.12, 0.5, 0.88].map(f => {
        const v = lo + (hi - lo) * f
        return (
          <g key={f}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeWidth="0.6" />
            <text x={PL - 5} y={y(v) + 3} textAnchor="end" fontSize="8" fill="#9ca3af">{format(v)}</text>
          </g>
        )
      })}

      {marks.filter(t => t >= t0 && t <= t1).map(t => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top} y2={bottom} stroke="#60a5fa" strokeWidth="1.2" strokeDasharray="2 3" />
          <path d={`M${x(t) - 3},${top - 6} h6 l-3,4 z`} fill="#60a5fa" />
        </g>
      ))}

      {detailed && <path d={`${primary} L${x(last.at).toFixed(1)},${bottom} L${x(points[0].at).toFixed(1)},${bottom} Z`} fill={`url(#${gid})`} />}
      {secondary && <path d={secondary} fill="none" stroke="#0a6e6e" strokeOpacity=".45" strokeWidth="1.4" strokeDasharray="3 2" strokeLinejoin="round" strokeLinecap="round" />}
      <path d={primary} fill="none" stroke="#0a6e6e" strokeWidth={bare ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" />

      {/* out-of-range readings always show; in-range ones only when the chart is sparse enough to read */}
      {!bare && points.filter(p => p.level !== 'normal' || points.length <= 40).map(p => (
        <circle key={p.id} cx={x(p.at)} cy={y(p.value)} r={p.level === 'normal' ? 2 : 2.8} fill={dot(p.level)} stroke="#fff" strokeWidth="0.8" />
      ))}
      {!active && <circle cx={x(last.at)} cy={y(last.value)} r={bare ? 2 : 3.6} fill={dot(last.level)} stroke="#fff" strokeWidth={bare ? 0 : 1.2} />}

      {/* the picked reading */}
      {active && (
        <g>
          <line x1={x(active.at)} x2={x(active.at)} y1={top} y2={bottom} stroke={dot(active.level)} strokeWidth="1" opacity=".35" />
          <circle cx={x(active.at)} cy={y(active.value)} r="8" fill={dot(active.level)} opacity=".18" />
          <circle cx={x(active.at)} cy={y(active.value)} r="4" fill={dot(active.level)} stroke="#fff" strokeWidth="1.4" />
        </g>
      )}
      {/* tappable points: a wide invisible target over each reading */}
      {onPick && points.map(p => (
        <circle key={p.id} cx={x(p.at)} cy={y(p.value)} r="9" fill="transparent" className="cursor-pointer" onClick={() => onPick(p.id)} />
      ))}
    </svg>
  )
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** A ref to attach to an element, and that element's current width in px (0 until measured). Keeps charts drawn at their real size. */
export function useElementWidth<T extends Element>() {
  const [width, setWidth] = useState(0)
  const ref = useCallback((el: T | null) => {
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

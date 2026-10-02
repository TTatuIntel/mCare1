import { useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import {
  BackHeader, BottomSheet, SheetButton, VitalChart, VitalHistory, ReadingFilterChips, readingMatches, InsightNotes,
  SaveError, useSave, levelStyle, TREND_ARROW, type ReadingFilter,
} from '@/shared'
import type { PatientUser } from '@/shared/lib/types'
import {
  evaluate, alertIsFor, latestValid, targetRange, effectiveCriticalRange, validateReading, vitalTrend, generateInsights,
  checkInStatus, shortDuration, readingTime, unitView, ago, dateLabel, stamp, parseValue, groupOf, VITAL_GROUPS,
  type Range, type TimeWindow,
} from '@/shared/lib/vitals'
import { SelfClearBanner } from './VitalLogSheets'
import { usePatient } from './usePatient'

/* ─── One vital, in full ──────────────────────────────────────────────
   The page behind every tapped vital, read top to bottom: how am I now
   (latest reading on its target scale), the vitals measured with it (the
   rest of its group), what my doctor said about it, then my readings — as
   a trend or a list, both driven by one period and one set of filters.
   The chips along the top switch vital without leaving the page. */

type Preset = '7d' | '30d' | '90d' | 'all' | 'custom'
const PRESETS: { key: Exclude<Preset, 'custom'>; label: string; days: number }[] = [
  { key: '7d',  label: '7D',  days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: 'all', label: 'All', days: 0 },
]
const DAY = 86_400_000

const round1 = (n: number) => Math.round(n * 10) / 10
/** "72.5", or "126/81" when there is a diastolic number. */
const pair = (v: number, s?: number) => (s === undefined ? String(round1(v)) : `${Math.round(v)}/${Math.round(s)}`)

export function VitalDetail({ vitalId, onSelect, onBack, onLog, onLogGroup }: {
  vitalId: string
  /** Switch to another vital's page. */
  onSelect: (vitalId: string) => void
  onBack: () => void
  onLog: (vitalId: string) => void
  /** Log this vital's whole group together. */
  onLogGroup: (groupId: string) => void
}) {
  const { currentUser, vitalDefs, alerts, now, canCorrect, correctReading, setUnitPref } = useApp()
  const { doctor } = usePatient()
  const patient = currentUser as PatientUser
  const [range, setRange] = useState<{ preset: Preset; from: string; to: string }>({ preset: '30d', from: '', to: '' })
  const [correcting, setCorrecting] = useState<{ id: string; value: string } | null>(null)
  const saving = useSave()
  /** One filter for both the chart and the list. */
  const [filter, setFilter] = useState<ReadingFilter>('all')
  const [tab, setTab] = useState<'trend' | 'history'>('trend')
  /** The chart point last tapped — read out under the chart. */
  const [picked, setPicked] = useState<string | null>(null)
  /** The reading History should scroll to; set from the chart's "View in history". */
  const [focus, setFocus] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const chipsRef = useRef<HTMLDivElement>(null)

  // Each vital opens at the top of its page, with its own chip in view.
  useLayoutEffect(() => {
    rootRef.current?.closest('.overflow-y-auto')?.scrollTo({ top: 0 })
    const row = chipsRef.current
    const chip = row?.querySelector<HTMLElement>('[aria-current="true"]')
    if (row && chip) row.scrollLeft = chip.offsetLeft - (row.clientWidth - chip.clientWidth) / 2
    setPicked(null); setFocus(null); setFilter('all')
  }, [vitalId])

  const def = vitalDefs.find(v => v.id === vitalId)
  if (!def) return (
    <div className="flex flex-col gap-3">
      <BackHeader title="Vital" onBack={onBack} />
      <p className="bg-white rounded-2xl p-6 shadow-sm text-center text-xs text-gray-400">This vital is no longer available.</p>
    </div>
  )

  const switcher = vitalDefs.filter(v => v.active && (patient.trackedVitalIds.includes(v.id) || v.id === def.id))
  // Everything shown or typed on this page is in the patient's unit; `target` and `crit` stay canonical for the chart and scale.
  const u = unitView(def, patient)
  const target = targetRange(patient, def)
  const shownTarget = u.range(target)
  const crit = effectiveCriticalRange(def, patient)
  const diaTarget = def.id === 'bp' ? { min: def.diaNormalMin ?? 60, max: def.diaNormalMax ?? 90 } : undefined
  const latest = latestValid(patient, def.id)
  const st = levelStyle(latest ? evaluate(patient, def, latest.value) : null)
  const checkIn = checkInStatus(def.id, latest?.at, now)
  // Where the latest reading sits against the target, in words. Blood pressure can be out on either number.
  const latestP = latest ? parseValue(def, latest.value) : null
  const latestLvl = latest ? evaluate(patient, def, latest.value) : null
  const standing = !latestP || !latestLvl ? null
    : latestLvl === 'normal' ? 'Inside your target'
    : latestP.primary > target.max ? 'Above your target'
    : latestP.primary < target.min ? 'Below your target'
    : 'Outside your target'
  // The vitals measured together with this one: the rest of its group that the patient tracks.
  const group = VITAL_GROUPS.find(g => g.id === groupOf(def.id))
  const related = vitalDefs.filter(v => v.active && v.id !== def.id && patient.trackedVitalIds.includes(v.id) && groupOf(v.id) === group?.id)

  // The period on show. Presets are open-ended at the top so a reading logged this second is never cut off.
  const preset = PRESETS.find(p => p.key === range.preset)
  const win: TimeWindow = preset
    ? { from: preset.days ? now - preset.days * DAY : undefined }
    : {
        from: range.from ? new Date(`${range.from}T00:00:00`).getTime() : undefined,
        to: range.to ? new Date(`${range.to}T23:59:59`).getTime() : undefined,
      }
  const periodLabel = preset ? (preset.days ? `the last ${preset.days} days` : 'all your history') : 'the dates you picked'
  const trend = vitalTrend(patient, def, win, now, r => readingMatches(filter, patient, def, r))
  const pts = trend.points
  const lastPt = pts[pts.length - 1]
  const axisFrom = win.from ?? pts[0]?.at
  const axisTo = win.to ?? (win.from !== undefined ? Math.max(now, lastPt?.at ?? 0) : lastPt?.at)
  const pickedPt = picked ? pts.find(p => p.id === picked) : undefined

  // History keeps readings with no usable timestamp, so a filter never silently hides data.
  const all = patient.readings.filter(r => r.vitalId === def.id)
  const rows = all.filter(r => {
    const t = readingTime(r)
    return t === null || ((win.from === undefined || t >= win.from) && (win.to === undefined || t <= win.to))
  })

  const matching = rows.filter(r => readingMatches(filter, patient, def, r))

  const secs = pts.flatMap(p => (p.secondary === undefined ? [] : [p.secondary]))
  const avgSec = secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length : undefined
  const low = pts.length ? pts.reduce((m, p) => (p.value < m.value ? p : m)) : null
  const high = pts.length ? pts.reduce((m, p) => (p.value > m.value ? p : m)) : null
  const change = u.change(pts)
  const inRangePct = pts.length ? Math.round((trend.inRange / pts.length) * 100) : 0

  const insights = preset ? generateInsights(patient, vitalDefs, preset.days, now).filter(i => i.vitalId === def.id) : []
  const correctionError = correcting ? validateReading(def, u.toCanonical(correcting.value), u.unit) : null

  // Doctor's changes to this vital's target that fall inside the period on show, newest first.
  const targetChanges = (patient.targetLog ?? [])
    .filter(c => c.vitalId === def.id && (win.from === undefined || c.at >= win.from) && (win.to === undefined || c.at <= win.to))
    .sort((a, b) => b.at - a.at)

  // What the care team has said about this vital: a re-check request, their note, the target they set, replies to alerts.
  const vitalAlerts = alerts.filter(al => al.patientId === patient.id && al.type === 'vital' && alertIsFor(al, def))
  const recheck = vitalAlerts.find(al => al.recheckRequestedAt && al.status !== 'resolved')
  const responses = vitalAlerts.filter(al => al.status === 'resolved' && al.resolvedBy && al.resolvedBy !== patient.id).slice(0, 2)
  const hasGuidance = !!(recheck || patient.doctorNote || patient.thresholds[def.id] || targetChanges.length || responses.length)

  const periodBtn = (on: boolean) =>
    `text-[10px] font-bold px-2 py-1 rounded-lg transition-all ${on ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-400'}`

  return (
    // Mobile and tablet: one column. Web: the latest reading and the doctor's guidance on the left, readings on the right.
    <div ref={rootRef} className="flex flex-col gap-3 @5xl:grid @5xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @5xl:gap-4 @5xl:items-start">
      <div className="@5xl:col-span-2">
      <BackHeader title={`${def.icon} ${def.name}`} onBack={onBack}
        subtitle={`Target ${shownTarget.min}–${shownTarget.max} ${u.unit}${patient.thresholds[def.id] ? ' · set by your doctor' : ''}`}
        right={u.options.length > 1 ? (
          <div className="flex bg-gray-100 rounded-full p-0.5 flex-shrink-0" role="group" aria-label={`Unit for ${def.name}`}>
            {u.options.map(o => (
              <button key={o} onClick={() => setUnitPref(patient.id, def.id, o)} aria-pressed={u.unit === o}
                className={`text-[10px] font-bold px-2 py-1 rounded-full transition-colors ${u.unit === o ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-400'}`}>
                {o}
              </button>
            ))}
          </div>
        ) : undefined} />
      </div>

      {/* vital switcher */}
      {switcher.length > 1 && (
        <div ref={chipsRef} className="relative flex gap-1.5 overflow-x-auto -mx-4 px-4 scrollbar-hide @2xl:mx-0 @2xl:px-0 @2xl:flex-wrap @5xl:col-span-2" style={{ scrollbarWidth: 'none' }}>
          {switcher.map(v => {
            const r = latestValid(patient, v.id)
            const on = v.id === def.id
            return (
              <button key={v.id} onClick={() => onSelect(v.id)} aria-current={on}
                className={`flex-shrink-0 flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
                  on ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-gray-600 border-gray-200'}`}>
                <span>{v.icon}</span>
                {v.name}
                <span className={`w-1.5 h-1.5 rounded-full ${levelStyle(r ? evaluate(patient, v, r.value) : null).dot}`} />
              </button>
            )
          })}
        </div>
      )}

      <div className="contents @5xl:flex @5xl:flex-col @5xl:gap-4 @5xl:min-w-0">
      {/* ── 1 · Now: the latest reading, placed on its target scale ── */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {/* the status colour runs along the top, as it does down the side of the card on the Vitals list */}
        <div className="h-1" style={{ background: st.accent }} />
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Latest reading</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className={`text-[44px] font-black leading-none tracking-tight font-mono ${st.value}`}>{latest ? u.value(latest.value) : '—'}</span>
                <span className="text-sm text-gray-400">{u.unit}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5 truncate">
                {standing && <span className={`font-bold ${st.value}`}>{standing} · </span>}
                {latest ? `${latest.at ? ago(latest.at, now) : latest.loggedAt}${latest.note ? ` · “${latest.note}”` : ''}` : 'No reading yet'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <span className={`text-[10px] font-black px-2 py-1 rounded-full border ${st.chip}`}>{st.label}</span>
              {pts.length > 1 && (
                <span className="text-[10px] font-bold text-gray-500 bg-gray-50 rounded-full px-2 py-1 font-mono">
                  {TREND_ARROW[trend.direction]} {change > 0 ? '+' : ''}{change}
                </span>
              )}
            </div>
          </div>

          {latest && <RangeScale value={Number(latest.value.split('/')[0])} target={target} crit={crit} accent={st.accent} label={u.num} />}

          <div className="flex items-center gap-2 mt-3">
            <p className={`flex-1 min-w-0 text-[11px] font-semibold truncate ${checkIn.state === 'overdue' ? 'text-red-600' : checkIn.state === 'due-soon' ? 'text-amber-600' : 'text-gray-500'}`}>
              ⏰ {checkIn.dueAt === undefined ? 'Log your first reading'
                : checkIn.state === 'overdue' ? `Check overdue by ${shortDuration(now - checkIn.dueAt)}`
                : `Next check in ${shortDuration(checkIn.dueAt - now)}`}
            </p>
            <button onClick={() => onLog(def.id)}
              className="flex-shrink-0 px-5 py-2.5 bg-teal-700 text-white text-sm font-bold rounded-xl active:scale-[.98] transition-transform">
              + Log reading
            </button>
          </div>
        </div>
        <SelfClearBanner def={def} onLog={() => onLog(def.id)} />
      </div>

      {/* ── 2 · Measured together: the rest of this vital's group, one tap away ── */}
      {group && related.length > 0 && (
        <div className="bg-white rounded-2xl p-3.5 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-base" aria-hidden="true">{group.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-gray-900 leading-tight">{group.label}</p>
              <p className="text-[10px] text-gray-400 truncate">Measured together · {group.hint.toLowerCase()}</p>
            </div>
            <button onClick={() => onLogGroup(group.id)}
              className="flex-shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-700 transition-all hover:bg-teal-100 active:scale-95">
              + Log group
            </button>
          </div>
          <div className="mt-2 flex flex-col">
            {related.map(v => {
              const r = latestValid(patient, v.id)
              const ru = unitView(v, patient)
              const rs = levelStyle(r ? evaluate(patient, v, r.value) : null)
              const at = r ? readingTime(r) : null
              return (
                <button key={v.id} onClick={() => onSelect(v.id)} className="flex items-center gap-2.5 border-t border-gray-50 py-2 text-left first:border-0">
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-base ${rs.tile}`} aria-hidden="true">{v.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-gray-900">{v.name}</span>
                    <span className="block truncate text-[10px] text-gray-400">{at ? ago(at, now) : 'No reading yet'}</span>
                  </span>
                  <span className={`font-mono text-sm font-black ${rs.value}`}>{r ? ru.value(r.value) : '—'}</span>
                  <span className="w-9 text-[10px] text-gray-400">{ru.unit}</span>
                  <span className="text-gray-300" aria-hidden="true">›</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 3 · From your doctor: everything the care team has said about this vital ── */}
      {hasGuidance && (
        <div className="bg-white rounded-2xl p-3.5 shadow-sm border border-blue-100">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-sm flex-shrink-0">👩‍⚕️</span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 leading-tight">From your doctor</p>
              <p className="text-[10px] text-gray-400 truncate">{doctor?.name ?? 'Your care team'}</p>
            </div>
          </div>

          {recheck && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-2.5 py-2 mb-2">
              <p className="flex-1 text-[11px] font-semibold text-amber-800">Please measure your {def.name.toLowerCase()} again — your doctor asked for a fresh reading.</p>
              <button onClick={() => onLog(def.id)} className="flex-shrink-0 text-[11px] font-bold text-white bg-teal-700 rounded-full px-3 py-1.5">Log now</button>
            </div>
          )}

          {patient.doctorNote && (
            <div className="bg-blue-50/60 rounded-xl px-3 py-2.5 mb-2">
              <p className="text-[9px] font-bold text-blue-500 uppercase tracking-wider mb-0.5">Recommendation</p>
              <p className="text-xs text-gray-700 leading-relaxed">“{patient.doctorNote}”</p>
            </div>
          )}

          <div className="flex flex-col">
            {patient.thresholds[def.id] && (
              <GuidanceRow icon="🎯" title={`Keep it between ${shownTarget.min}–${shownTarget.max} ${u.unit}`} sub="Your personal target for this vital" />
            )}
            {targetChanges.map(c => {
              const from = c.from && u.range(c.from), to = u.range(c.to)
              return (
                <GuidanceRow key={c.at} icon="↔️"
                  title={`Target changed${from ? ` from ${from.min}–${from.max}` : ''} to ${to.min}–${to.max} ${u.unit}`}
                  sub={`${dateLabel(new Date(c.at))} · marked in blue on the chart`} />
              )
            })}
            {responses.map(al => (
              <GuidanceRow key={al.id} icon="✅"
                title={`${al.resolutionReason ?? 'Alert reviewed'}${al.resolutionNote ? ` — ${al.resolutionNote}` : ''}`}
                sub={`About your reading of ${al.value} ${al.unit} · ${al.resolvedAt ?? al.loggedAt}`} />
            ))}
          </div>
        </div>
      )}

      </div>

      <div className="contents @5xl:flex @5xl:flex-col @5xl:gap-4 @5xl:min-w-0">
      {/* ── 4 · Trend & history: one period and one set of filters drive both views ── */}
      <div className="bg-white rounded-2xl p-3.5 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-gray-900">Readings</p>
          <div className="flex bg-gray-100 rounded-xl p-[3px] gap-[2px]" role="group" aria-label="Period">
            {PRESETS.map(p => (
              <button key={p.key} onClick={() => setRange({ preset: p.key, from: '', to: '' })} aria-pressed={range.preset === p.key}
                className={periodBtn(range.preset === p.key)}>
                {p.label}
              </button>
            ))}
            <button onClick={() => setRange(r => (r.preset === 'custom' ? { preset: '30d', from: '', to: '' } : { ...r, preset: 'custom' }))}
              aria-pressed={range.preset === 'custom'} aria-label="Pick dates" className={periodBtn(range.preset === 'custom')}>
              📅
            </button>
          </div>
        </div>
        {range.preset === 'custom' && (
          <div className="mt-2 flex items-center gap-2">
            {(['from', 'to'] as const).map(k => (
              <label key={k} className="flex-1">
                <span className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">{k}</span>
                <input type="date" value={range[k]}
                  min={k === 'to' ? range.from || undefined : undefined} max={k === 'from' ? range.to || undefined : undefined}
                  onChange={e => setRange(r => ({ ...r, [k]: e.target.value }))}
                  className="w-full text-xs bg-gray-50 border border-gray-200 rounded-xl px-2 py-1.5 outline-none focus:border-teal-400" />
              </label>
            ))}
          </div>
        )}

        {/* shared filters: they narrow the chart, its numbers and the list alike */}
        {rows.length > 0 && (
          <ReadingFilterChips patient={patient} def={def} rows={rows} filter={filter} onFilter={setFilter} className="-mx-3.5 px-3.5 mt-2.5" />
        )}

        {/* Trend | History */}
        <div className="grid grid-cols-2 bg-gray-100 rounded-xl p-[3px] gap-[2px] mt-2.5" role="tablist">
          {([['trend', '📈 Trend'], ['history', `📋 History · ${matching.length}`]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setFocus(null) }}
              className={`text-xs font-bold py-1.5 rounded-lg transition-all ${tab === k ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-400'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'history' ? (
          <div className="mt-2.5">
            <VitalHistory embedded className="" patient={patient} def={def} unit={u.unit} rows={rows} total={all.length}
              latestId={latest?.id} focusId={focus} caption={`From ${periodLabel}`} filter={filter} onFilter={setFilter}
              action={r => !r.invalid && canCorrect(r) && (
                <button onClick={() => { saving.clear(); setCorrecting({ id: r.id, value: u.value(r.value) }) }} className="block ml-auto mt-1 text-[10px] text-teal-700 font-bold underline">Correct</button>
              )}
              onShowAll={() => setRange({ preset: 'all', from: '', to: '' })} />
          </div>
        ) : pts.length < 2 ? (
          <div className="py-8 text-center">
            <p className="text-2xl mb-1">📈</p>
            <p className="text-xs font-semibold text-gray-600">
              {pts.length === 1 ? 'Only one reading here' : filter !== 'all' && rows.length > 0 ? 'No readings match this filter' : 'No readings in this period'}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">A trend needs at least two readings.</p>
            {filter !== 'all' && <button onClick={() => setFilter('all')} className="text-[11px] font-bold text-teal-700 mt-2">Clear filter</button>}
          </div>
        ) : (
          <>
            {/* key numbers first, then the picture */}
            <div className="grid grid-cols-3 gap-2 mt-3">
              {[
                { l: 'Average', v: pair(u.num(trend.average), avgSec) },
                { l: 'Lowest',  v: low ? pair(u.num(low.value), low.secondary) : '—' },
                { l: 'Highest', v: high ? pair(u.num(high.value), high.secondary) : '—' },
              ].map(s => (
                <div key={s.l} className="bg-gray-50 rounded-xl px-2.5 py-2">
                  <p className="text-[9px] text-gray-400 font-semibold">{s.l}</p>
                  <p className="text-base font-black text-gray-900 font-mono leading-tight">{s.v}</p>
                </div>
              ))}
            </div>

            <div className="mt-3">
              <VitalChart points={pts} range={target} secondaryRange={diaTarget} from={axisFrom} to={axisTo} height={150} detailed
                format={n => u.num(round1(n))} marks={targetChanges.map(c => c.at)} activeId={picked} onPick={setPicked} />
              {axisFrom !== undefined && axisTo !== undefined && (
                <div className="flex justify-between text-[9px] text-gray-400 mt-1 pl-6">
                  <span>{dateLabel(new Date(axisFrom))}</span>
                  <span>{dateLabel(new Date(axisTo))}</span>
                </div>
              )}
            </div>

            {/* legend, or the reading just tapped */}
            {pickedPt ? (
              <div className="mt-2 flex items-center gap-2 bg-gray-50 rounded-xl px-2.5 py-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${levelStyle(pickedPt.level).dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-gray-900 font-mono">{pair(u.num(pickedPt.value), pickedPt.secondary)} <span className="font-normal text-gray-400 font-sans">{u.unit}</span></p>
                  <p className="text-[10px] text-gray-400 truncate">{stamp(new Date(pickedPt.at))}</p>
                </div>
                <button onClick={() => { setTab('history'); setFocus(pickedPt.id) }} className="text-[10px] font-bold text-teal-700 flex-shrink-0">View in history →</button>
                <button onClick={() => setPicked(null)} aria-label="Clear selection" className="text-gray-400 text-xs flex-shrink-0 px-1">✕</button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-3 flex-wrap text-[9px] text-gray-400">
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-emerald-100 border border-emerald-200" /> Target {shownTarget.min}–{shownTarget.max}</span>
                {diaTarget && <span>━ systolic · ┄ diastolic</span>}
                {targetChanges.length > 0 && <span className="flex items-center gap-1"><span className="w-0.5 h-2.5 bg-blue-400" /> Target changed</span>}
                <span className="ml-auto">Tap a point for details</span>
              </div>
            )}

            {/* time in target */}
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="flex items-baseline justify-between">
                <p className="text-[11px] font-semibold text-gray-700">Time in target</p>
                <p className="text-[11px] text-gray-400"><span className="font-black text-gray-900 font-mono">{inRangePct}%</span> · {trend.inRange} of {pts.length} readings</p>
              </div>
              <div className="h-2 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${inRangePct >= 80 ? 'bg-emerald-500' : inRangePct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${inRangePct}%` }} />
              </div>
              {trend.streak >= 2 && <p className="text-[10px] text-emerald-600 font-semibold mt-1.5">🔥 {trend.streak} readings in a row inside your target</p>}
            </div>
          </>
        )}
      </div>

      {/* what the numbers say */}
      {insights.length > 0 && (
        <div className="bg-white rounded-2xl p-3.5 shadow-sm">
          <p className="text-sm font-bold text-gray-900 mb-2">What your numbers say</p>
          <InsightNotes insights={insights} />
          <p className="text-[9px] text-gray-400 mt-2 italic">These notes describe your numbers only. They are not medical advice — your doctor's recommendation above comes first.</p>
        </div>
      )}

      </div>

      <BottomSheet open={!!correcting} onClose={() => setCorrecting(null)} title="Correct reading"
        subtitle="You can fix a typo within 15 minutes of logging it."
        footer={<><SheetButton tone="ghost" onClick={() => setCorrecting(null)}>Cancel</SheetButton>
          <SheetButton disabled={!correcting || !!correctionError || saving.busy}
            onClick={async () => {
              if (!correcting) return
              // Past the 15 minutes the backend refuses, and says so here.
              if ((await saving.run(() => correctReading(patient.id, correcting.id, u.toCanonical(correcting.value)))).ok) setCorrecting(null)
            }}>{saving.busy ? 'Saving…' : 'Save'}</SheetButton></>}>
        <input value={correcting?.value ?? ''} onChange={e => setCorrecting(c => (c ? { ...c, value: e.target.value } : c))} inputMode={def.id === 'bp' ? 'text' : 'decimal'}
          aria-label={`${def.name} in ${u.unit}`}
          className="w-full text-center text-3xl font-black bg-gray-50 border-2 border-gray-200 rounded-2xl py-4 outline-none focus:border-teal-400 font-mono" />
        {correctionError && <p className="text-xs text-red-500 mt-2">{correctionError}</p>}
        <SaveError message={saving.error} className="mt-2" />
      </BottomSheet>
    </div>
  )
}

/** One line of doctor guidance: an icon, what was said, and when or why. */
function GuidanceRow({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm leading-5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-800 leading-snug">{title}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
      </div>
    </div>
  )
}

/**
 * Where a value sits against its target: a track with the green target band
 * in the middle, amber either side and red beyond the critical limits, and a
 * marker at the value. The track always spans the target plus 60% of its
 * width each way, so the band reads the same for every vital; a value off
 * the end is pinned to the edge.
 */
function RangeScale({ value, target, crit, accent, label }: {
  value: number
  target: Range
  crit: Range
  accent: string
  /** How a stored number is written under the track. */
  label: (n: number) => number | string
}) {
  if (Number.isNaN(value)) return null
  const span = Math.max(target.max - target.min, 0.1)
  const lo = target.min - span * 0.6, hi = target.max + span * 0.6
  const pos = (n: number) => Math.max(0, Math.min(100, ((n - lo) / (hi - lo)) * 100))
  const zones = [
    { from: lo,         to: crit.min,   cls: 'bg-red-300' },
    { from: target.min, to: target.max, cls: 'bg-emerald-400' },
    { from: crit.max,   to: hi,         cls: 'bg-red-300' },
  ]
  return (
    <div className="mt-4" role="img" aria-label={`Latest reading against the target range ${label(target.min)} to ${label(target.max)}`}>
      <div className="relative h-2.5">
        {/* amber base = outside target; green and red are laid over it */}
        <div className="absolute inset-0 rounded-full overflow-hidden bg-amber-300">
          {zones.map((z, i) => pos(z.to) > pos(z.from) && (
            <div key={i} className={`absolute inset-y-0 ${z.cls}`} style={{ left: `${pos(z.from)}%`, width: `${pos(z.to) - pos(z.from)}%` }} />
          ))}
        </div>
        <div className="absolute top-1/2 w-4 h-4 rounded-full bg-white shadow -translate-x-1/2 -translate-y-1/2 flex items-center justify-center transition-all"
          style={{ left: `${Math.max(3, Math.min(97, pos(value)))}%` }}>
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: accent }} />
        </div>
      </div>
      <div className="relative h-4 mt-1 text-[9px] font-mono">
        <span className="absolute -translate-x-1/2 text-emerald-600 font-bold" style={{ left: `${pos(target.min)}%` }}>{label(target.min)}</span>
        <span className="absolute -translate-x-1/2 text-emerald-600 font-bold" style={{ left: `${pos(target.max)}%` }}>{label(target.max)}</span>
        <span className="absolute left-0 text-gray-400 font-sans">Low</span>
        <span className="absolute right-0 text-gray-400 font-sans">High</span>
      </div>
    </div>
  )
}

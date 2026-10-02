import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Toggle, Page, HeroCard, VitalChart, InsightNotes, levelStyle, useElementWidth, TREND_ARROW, HERO_GRADIENT } from '@/shared'
import type { PatientUser, VitalDef } from '@/shared/lib/types'
import {
  evaluate, latestValid, targetRange, vitalTrend, generateInsights, readingTime, unitView, ago, groupOf, VITAL_GROUPS,
  type VitalInsight, type VitalTrend,
} from '@/shared/lib/vitals'
import { countdown } from '@/shared/lib/schedule'
import { useDaySchedule } from './useDaySchedule'
import { usePatient } from './usePatient'
import { VitalDetail } from './VitalDetail'
import { useVitalLog, SelfClearBanner } from './VitalLogSheets'
import { ReportRequestCard } from './ReportRequest'

type View = 'readings' | 'trends' | 'select'
type Status = 'alert' | 'normal' | 'none'
type Group = typeof VITAL_GROUPS[number]

/** Alerts first, then normal, then vitals with nothing logged. */
const RANK: Record<Status, number> = { alert: 0, normal: 1, none: 2 }

/** Bring an element to the middle of the screen's own scroll area, without moving the page around it. */
function centerInScroller(el: HTMLElement) {
  const scroller = el.closest<HTMLElement>('.overflow-y-auto')
  if (!scroller) return
  const e = el.getBoundingClientRect(), s = scroller.getBoundingClientRect()
  scroller.scrollTop += e.top - s.top - (s.height - e.height) / 2
}

/* ─── Vitals ──────────────────────────────────────────────────────────
   The overview of every tracked vital: how today stands, then the vitals
   in their groups (VITAL_GROUPS, the same structure the log sheets use),
   the groups that need attention first. Tapping one opens its own page
   (VitalDetail); `vitalId` is that page's vital, owned by PatientApp so
   Home, alerts and notifications can open a vital directly.
   The group filter narrows both the Now and the Trends view; each ends
   with the section for asking the care team for a signed report. */
export function VitalsTab({ vitalId, onOpenVital, onCloseVital, go }: {
  vitalId: string | null
  onOpenVital: (vitalId: string) => void
  onCloseVital: () => void
  /** Opens another screen (Documents, for a finished report). */
  go?: (tab: string) => void
}) {
  const { currentUser, vitalDefs, now } = useApp()
  const { doctor, setTrackedVitals, canStopTracking, status, error, reload } = usePatient()
  const patient = currentUser as PatientUser
  const { vitals: vitalsDue } = useDaySchedule()
  const log = useVitalLog()
  const [view, setView] = useState<View>('readings')
  const [dense, setDense] = useState(false)
  /** Optional status filter driven by the summary pills. */
  const [statusFilter, setStatusFilter] = useState<Status | null>(null)
  /** Optional group filter (Heart, Breathing…), shared by the Now and Trends views. */
  const [groupFilter, setGroupFilter] = useState<Group['id'] | null>(null)
  const [trendDays, setTrendDays] = useState(30)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastOpened = useRef<string | null>(null)
  /** The vital just returned from — briefly ringed so the eye lands on it. */
  const [flash, setFlash] = useState<string | null>(null)

  // Coming back from a vital's page lands on that vital's card, not the top of the list.
  useEffect(() => {
    if (vitalId) { lastOpened.current = vitalId; return }
    const id = lastOpened.current
    if (!id) return
    lastOpened.current = null
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-vital="${id}"]`)
    if (!el) return
    centerInScroller(el)
    setFlash(id)
    const t = window.setTimeout(() => setFlash(null), 1400)
    return () => window.clearTimeout(t)
  }, [vitalId])

  const activeVitals = vitalDefs.filter(v => v.active)
  const tracked = activeVitals.filter(v => patient.trackedVitalIds.includes(v.id))
  const doctorName = doctor?.name

  /** A vital the doctor set, or any tracked vital once a doctor is assigned: only the doctor removes it. */
  const lockedOn = (id: string) => patient.trackedVitalIds.includes(id) && !canStopTracking(id)
  const toggleVital = (id: string) => {
    if (lockedOn(id)) return
    const next = patient.trackedVitalIds.includes(id)
      ? patient.trackedVitalIds.filter(v => v !== id)
      : [...patient.trackedVitalIds, id]
    void setTrackedVitals(next)   // a refused save is reported by the banner at the top of the portal
  }

  const statusOf = (v: VitalDef): Status => {
    const r = latestValid(patient, v.id)
    if (!r) return 'none'
    return evaluate(patient, v, r.value) === 'normal' ? 'normal' : 'alert'
  }
  const count = (s: Status) => tracked.filter(v => statusOf(v) === s).length

  /** The groups the patient tracks something in: the choices of the group filter. */
  const groups = VITAL_GROUPS.filter(g => tracked.some(v => groupOf(v.id) === g.id))
  const inGroup = tracked.filter(v => !groupFilter || groupOf(v.id) === groupFilter)
  const clearFilters = () => { setStatusFilter(null); setGroupFilter(null) }

  /** Cards actually rendered: filtered by the summary pills and the group, alerts first. */
  const visible = inGroup
    .filter(v => !statusFilter || statusOf(v) === statusFilter)
    .sort((a, b) => RANK[statusOf(a)] - RANK[statusOf(b)])
  /** The cards in their groups, groups with an alert first. A status filter shows one plain list instead. */
  const sections: { group?: typeof VITAL_GROUPS[number]; vitals: VitalDef[] }[] = statusFilter
    ? [{ vitals: visible }]
    : VITAL_GROUPS
      .map(group => ({ group, vitals: visible.filter(v => groupOf(v.id) === group.id) }))
      .sort((a, b) => Math.min(...a.vitals.map(v => RANK[statusOf(v)]), 3) - Math.min(...b.vitals.map(v => RANK[statusOf(v)]), 3))

  /* ─ Trends: recomputed only when readings or the window change ─ */
  const trends = useMemo(() => {
    const m = new Map<string, VitalTrend>()
    tracked.forEach(v => m.set(v.id, vitalTrend(patient, v, trendDays)))
    return m
  }, [patient.readings, patient.thresholds, trendDays, tracked.length])

  const insights = useMemo(
    () => generateInsights(patient, vitalDefs, trendDays),
    [patient.readings, patient.thresholds, patient.trackedVitalIds, vitalDefs, trendDays],
  )

  /** The trend window in one line, for the snapshot on the Now view. */
  const trendTotals = useMemo(() => {
    let readings = 0, inRange = 0, moving = 0
    trends.forEach(t => {
      readings += t.points.length
      inRange += t.inRange
      if (t.direction === 'rising' || t.direction === 'falling') moving++
    })
    return { readings, inRange, moving }
  }, [trends])

  const openDocs = go ? () => go('docs') : undefined

  if (vitalId) return (
    <>
      <VitalDetail vitalId={vitalId} onSelect={onOpenVital} onBack={onCloseVital} onLog={log.logOne} onLogGroup={log.logGroup} />
      {log.sheets}
    </>
  )

  const ring = (id: string) => (flash === id ? 'ring-2 ring-teal-400' : '')

  return (
    <Page title="Vitals" flow={false} rootRef={rootRef} status={status} error={error} onRetry={reload}
      actions={
        <div className="flex bg-gray-100 rounded-xl p-[3px] gap-[2px]">
          {([
            { id: 'readings', label: 'Now' },
            { id: 'trends',   label: 'Trends' },
            { id: 'select',   label: 'My Vitals' },
          ] as const).map(v => (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`text-[11px] px-2.5 py-1.5 rounded-lg font-semibold transition-all ${view === v.id ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-400'}`}>
              {v.label}
            </button>
          ))}
        </div>
      }>

      {view === 'readings' ? (
        <>
          {/* how today stands: how many are in target, and the same next-check reminder shown on Home */}
          {tracked.length > 0 && (
            <HeroCard eyebrow="Today’s vitals"
              value={<span className="font-mono">{count('normal')}</span>}
              suffix={`of ${tracked.length} in target`}
              caption={<>
                {count('alert') > 0
                  ? `${count('alert')} ${count('alert') === 1 ? 'needs' : 'need'} attention`
                  : count('normal') > 0 ? 'All logged vitals in target' : 'No readings yet'}
                {vitalsDue.lastAt ? ` · last logged ${ago(vitalsDue.lastAt, now)}` : ''}
              </>}
              sideTitle="Next check"
              side={[{ value: vitalsDue.dueIn <= 0 ? 'Due now' : countdown(vitalsDue.dueIn), label: vitalsDue.dueIn <= 0 ? 'tap Log vitals' : 'reading due' }]}>
              {/* one segment per vital: in target, needs attention, nothing logged */}
              <div className="px-5 pb-4 flex h-1.5 gap-0.5 box-content" aria-hidden="true">
                {(['normal', 'alert', 'none'] as const).flatMap(s => tracked.filter(v => statusOf(v) === s).map(v => (
                  <span key={v.id} className={`flex-1 rounded-full ${s === 'normal' ? 'bg-white' : s === 'alert' ? 'bg-amber-300' : 'bg-white/20'}`} />
                )))}
              </div>
            </HeroCard>
          )}

          {/* Summary strip — tappable status filters + density toggle */}
          {tracked.length > 0 && (
            <div className="flex items-center gap-1.5 @2xl:gap-2">
              {([
                { id: 'alert',  label: 'Alert',   dot: 'bg-red-400',     text: 'text-red-600',     bg: 'bg-red-50',     on: 'ring-red-200'     },
                { id: 'normal', label: 'Normal',  dot: 'bg-emerald-400', text: 'text-emerald-700', bg: 'bg-emerald-50', on: 'ring-emerald-200' },
                { id: 'none',   label: 'No Data', dot: 'bg-gray-300',    text: 'text-gray-500',    bg: 'bg-gray-50',    on: 'ring-gray-300'    },
              ] as const).map(s => {
                const active = statusFilter === s.id
                const n = count(s.id)
                return (
                  <button key={s.id} disabled={n === 0} aria-pressed={active}
                    onClick={() => setStatusFilter(active ? null : s.id)}
                    className={`${s.bg} rounded-full px-2.5 py-1.5 flex items-center gap-1.5 transition-all active:scale-95
                      ${active ? `ring-2 ${s.on}` : ''} ${n === 0 ? 'opacity-40' : ''}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                    <span className={`text-xs font-black ${s.text}`}>{n}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${s.text} opacity-70`}>{s.label}</span>
                  </button>
                )
              })}
              <button onClick={() => setDense(d => !d)} aria-label="Change card layout" aria-pressed={dense}
                title={dense ? 'Show full cards' : 'Show compact tiles'}
                className="w-8 h-8 rounded-full bg-white text-gray-500 shadow-sm flex items-center justify-center flex-shrink-0 ml-auto active:scale-95 transition-transform">
                <span className="text-xs">{dense ? '☰' : '▦'}</span>
              </button>
            </div>
          )}

          <GroupFilter groups={groups} value={groupFilter} onChange={setGroupFilter} />

          {/* Vital cards */}
          {tracked.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
              <div className="w-14 h-14 bg-teal-50 rounded-full mx-auto flex items-center justify-center text-2xl mb-3">📊</div>
              <p className="text-sm font-semibold text-gray-700 mb-1">No vitals selected</p>
              <p className="text-xs text-gray-400 mb-4">Switch to "My Vitals" to choose what to track.</p>
              <button onClick={() => setView('select')}
                className="text-xs bg-teal-700 text-white px-5 py-2 rounded-full font-bold">
                Choose Vitals
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {sections.filter(sec => sec.vitals.length > 0).map(sec => (
                <section key={sec.group?.id ?? 'filtered'} aria-label={sec.group?.label ?? 'Vitals'}>
                  {sec.group && (
                    <div className="mb-2 flex items-center gap-2 px-1">
                      <span className="text-base" aria-hidden="true">{sec.group.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-gray-900">{sec.group.label}</p>
                        <p className="truncate text-[10px] text-gray-400">{sec.group.hint}</p>
                      </div>
                      {sec.vitals.length > 1 && (
                        <button onClick={() => log.logGroup(sec.group!.id)}
                          className="flex-shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-700 transition-all hover:bg-teal-100 active:scale-95">
                          + Log group
                        </button>
                      )}
                    </div>
                  )}
                  <div className={dense
              ? 'grid grid-cols-2 gap-2 @2xl:grid-cols-3 @2xl:gap-3 @5xl:grid-cols-4'
              : 'flex flex-col gap-2 @2xl:grid @2xl:grid-cols-2 @2xl:gap-3 @5xl:grid-cols-3'}>
              {sec.vitals.map(v => {
                const reading  = latestValid(patient, v.id)
                const lvl      = reading ? evaluate(patient, v, reading.value) : null
                const st       = levelStyle(lvl)
                const isLocked = !!patient.thresholds[v.id]
                const tr       = trends.get(v.id)
                const u        = unitView(v, patient)
                const range    = u.range(targetRange(patient, v))
                const change   = u.change(tr?.points ?? [])
                const when     = reading ? ago(readingTime(reading) ?? now, now) : null
                const open     = () => onOpenVital(v.id)

                /* ─ Dense (2-col) tile ─ */
                if (dense) {
                  return (
                    <div key={v.id} data-vital={v.id}
                      className={`bg-white rounded-2xl shadow-sm overflow-hidden relative transition-shadow hover:shadow-md ${ring(v.id)}`}
                      style={{ borderLeft: `3px solid ${st.accent}` }}>
                      <button onClick={open} className="w-full h-full text-left px-3 py-2.5">
                        <div className="flex items-center gap-1.5 mb-1.5 pr-7">
                          <span className="text-sm leading-none">{v.icon}</span>
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider truncate flex-1">{v.name}</p>
                          {isLocked && <span className="text-[9px] flex-shrink-0">🔒</span>}
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className={`text-xl font-black leading-none tracking-tight ${st.value} font-mono`}>
                            {reading ? u.value(reading.value) : '—'}
                          </span>
                          <span className="text-[10px] text-gray-400">{u.unit}</span>
                          {tr && tr.points.length > 1 && (
                            <span className="text-[10px] text-gray-400 ml-auto">{TREND_ARROW[tr.direction]}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-1 min-w-0">
                          {lvl && lvl !== 'normal' && (
                            <span className={`text-[9px] font-black px-1 rounded-full border flex-shrink-0 ${st.chip}`}>{st.label}</span>
                          )}
                          <p className="text-[10px] text-gray-400 truncate">
                            {when ? `${range.min}–${range.max} · ${when}` : 'No reading yet'}
                          </p>
                        </div>
                      </button>
                      <button onClick={() => log.logOne(v.id)} aria-label={`Log ${v.name}`}
                        className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center bg-teal-700 text-white text-sm font-bold transition-all hover:bg-teal-800 active:scale-90">+</button>
                    </div>
                  )
                }

                /* ─ Card: icon, name and status, the value, then target and age ─ */
                const isAlert = !!lvl && lvl !== 'normal'
                return (
                  <div key={v.id} data-vital={v.id}
                    className={`bg-white rounded-2xl overflow-hidden flex flex-col transition-shadow hover:shadow-md ${
                      ring(v.id) || (isAlert ? 'shadow-sm ring-1' : 'shadow-sm')}`}
                    style={isAlert && !ring(v.id) ? { ['--tw-ring-color' as string]: `${st.accent}33` } : undefined}>
                    {/* flex-1: in a grid row the cards share one height, and a banner sits at the bottom */}
                    <div className="flex items-stretch flex-1">
                      {/* status rail */}
                      <div className="w-1 flex-shrink-0" style={{ background: st.accent }} />

                      <button onClick={open} className="flex-1 min-w-0 text-left flex items-center gap-3 pl-3 pr-1 py-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${st.tile}`}>
                          {v.icon}
                        </div>

                        <div className="min-w-0 flex-1">
                          {/* line 1 — name, lock, status chip */}
                          <div className="flex items-center gap-1.5">
                            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider truncate">{v.name}</p>
                            {isLocked && <span className="text-[10px] flex-shrink-0" title="Range set by your doctor">🔒</span>}
                            {isAlert && (
                              <span className={`text-[9px] font-black px-1.5 py-px rounded-full border flex-shrink-0 ${st.chip}`}>
                                {st.label}
                              </span>
                            )}
                          </div>

                          {/* line 2 — value, unit, change */}
                          <div className="flex items-baseline gap-1.5 mt-1">
                            <span className={`text-2xl font-black leading-none tracking-tight ${st.value} font-mono`}>
                              {reading ? u.value(reading.value) : '—'}
                            </span>
                            <span className="text-[11px] text-gray-400 font-medium">{u.unit}</span>
                            {tr && tr.points.length > 1 && (
                              <span className={`text-[11px] font-bold flex-shrink-0 ${
                                tr.direction === 'steady' ? 'text-gray-400'
                                : lvl === 'normal' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {TREND_ARROW[tr.direction]}{change > 0 ? '+' : ''}{change}
                              </span>
                            )}
                          </div>

                          {/* line 3 — target range and how old the reading is */}
                          <p className="text-[11px] text-gray-400 mt-1 truncate">
                            <span className="text-teal-700 font-semibold">Target {range.min}–{range.max}</span>
                            {' · '}{when ?? 'tap + to log'}
                          </p>
                        </div>

                        {/* where it has been heading; only where the card has the width for it */}
                        {tr && tr.points.length > 1 && (
                          <div className="hidden @sm:block w-14 h-7 flex-shrink-0" aria-hidden="true">
                            <VitalChart points={tr.points} range={targetRange(patient, v)} height={28} bare />
                          </div>
                        )}
                      </button>

                      <div className="flex items-center pl-1 pr-3">
                        <button onClick={() => log.logOne(v.id)} aria-label={`Log ${v.name}`}
                          className="w-9 h-9 rounded-full flex items-center justify-center bg-teal-700 text-white shadow-sm transition-all hover:bg-teal-800 active:scale-90">
                          <span className="text-xl font-light leading-none">+</span>
                        </button>
                      </div>
                    </div>

                    <SelfClearBanner def={v} onLog={() => log.logOne(v.id)} />
                  </div>
                )
              })}
                  </div>
                </section>
              ))}

              {visible.length === 0 && (
                <div className="bg-white rounded-2xl py-6 text-center shadow-sm">
                  <p className="text-xs text-gray-400 mb-2">Nothing matches these filters right now.</p>
                  <button onClick={clearFilters}
                    className="text-[11px] font-bold text-teal-700">Show all vitals</button>
                </div>
              )}
            </div>
          )}

          {/* The trend window in one line; the Trends view has the charts. */}
          {trendTotals.readings > 0 && (
            <button onClick={() => setView('trends')} className="bg-white rounded-2xl shadow-sm p-3.5 flex items-center gap-3 text-left transition-shadow hover:shadow-md">
              <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center text-lg flex-shrink-0">📈</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gray-900">
                  <span className="font-mono">{Math.round((trendTotals.inRange / trendTotals.readings) * 100)}%</span> of readings in target
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                  Last <span className="font-mono">{trendDays}</span> days · <span className="font-mono">{trendTotals.readings}</span> readings
                  {trendTotals.moving > 0 ? ` · ${trendTotals.moving} ${trendTotals.moving === 1 ? 'vital is' : 'vitals are'} changing` : ' · all steady'}
                </p>
              </div>
              <span className="flex-shrink-0 text-xs font-semibold text-teal-700">Trends ›</span>
            </button>
          )}

          {tracked.length > 0 && <ReportRequestCard days={trendDays} onOpenDocs={openDocs} />}

          {/* Logging one, a group or everything: the floating "Log vitals" button (PatientApp), the same one as on Home. */}
          <DoctorNote note={patient.doctorNote} doctorName={doctorName ?? (patient.assignedDoctorId ? 'Your Doctor' : undefined)} />
        </>
      ) : view === 'trends' ? (
        <TrendsView
          patient={patient}
          tracked={inGroup}
          filter={<GroupFilter groups={groups} value={groupFilter} onChange={setGroupFilter} />}
          report={tracked.length > 0 && <ReportRequestCard days={trendDays} onOpenDocs={openDocs} />}
          trends={trends}
          insights={insights}
          days={trendDays}
          onDays={setTrendDays}
          onOpen={onOpenVital}
          ring={ring}
          doctorName={doctorName}
        />
      ) : (
        /* My Vitals — selection with lock logic */
        <div className="flex flex-col gap-2 @2xl:grid @2xl:grid-cols-2 @2xl:gap-3 @5xl:grid-cols-3">
          <p className="text-xs text-gray-500 px-1 col-span-full">
            Switch on the vitals you want to track.{patient.assignedDoctorId ? ' Once you track one, only your doctor can remove it.' : ' The ones your doctor sets are locked.'}
          </p>
          {activeVitals.map(v => {
            const isOn     = patient.trackedVitalIds.includes(v.id)
            const thr      = patient.thresholds[v.id]
            const isLocked = lockedOn(v.id)
            const u        = unitView(v, patient)
            const shown    = u.range(thr ?? { min: v.normalMin, max: v.normalMax })
            return (
              <div key={v.id}
                className={`bg-white rounded-2xl flex items-center gap-3 px-3.5 py-3 shadow-sm ${isLocked ? 'ring-1 ring-blue-100' : ''}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${isLocked ? 'bg-blue-50' : 'bg-gray-50'}`}>
                  {v.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{v.name}</p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {thr
                      ? <span className="text-blue-500 font-semibold">🔒 Doctor range: {shown.min}–{shown.max} {u.unit}</span>
                      : `Default: ${shown.min}–${shown.max} ${u.unit}`
                    }
                  </p>
                </div>
                {isLocked ? (
                  <div className="flex items-center gap-1 bg-blue-100 px-2 py-0.5 rounded-full flex-shrink-0">
                    <span className="text-[9px]">🔒</span>
                    <span className="text-[10px] font-bold text-blue-600">Locked</span>
                  </div>
                ) : (
                  <Toggle on={isOn} onChange={() => toggleVital(v.id)} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {log.sheets}
    </Page>
  )
}

function DoctorNote({ note, doctorName, className = '' }: { note?: string; doctorName?: string; className?: string }) {
  if (!note) return null
  return (
    <div className={`rounded-2xl p-4 text-white ${className}`} style={{ background: HERO_GRADIENT }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm">📋</span>
        <p className="text-[10px] text-white/70 uppercase tracking-wider font-bold">From your doctor</p>
      </div>
      <p className="text-sm text-white/95 leading-relaxed italic">"{note}"</p>
      {doctorName && <p className="text-[11px] text-white/70 mt-2 font-medium">— {doctorName}</p>}
    </div>
  )
}

/* ─── Trends view: unified chart + auto-generated summary ─────────────── */

/** One chip per group the patient tracks something in, plus "All". Hidden when there is only one group. */
function GroupFilter({ groups, value, onChange }: {
  groups: Group[]; value: Group['id'] | null; onChange: (g: Group['id'] | null) => void
}) {
  if (groups.length < 2) return null
  const chip = (on: boolean) => `flex-shrink-0 flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full border transition-colors ${
    on ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-gray-500 border-gray-200'}`
  return (
    <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }} role="group" aria-label="Filter by group">
      <button onClick={() => onChange(null)} aria-pressed={!value} className={chip(!value)}>All</button>
      {groups.map(g => (
        <button key={g.id} onClick={() => onChange(value === g.id ? null : g.id)} aria-pressed={value === g.id} className={chip(value === g.id)}>
          <span aria-hidden="true">{g.icon}</span>{g.label}
        </button>
      ))}
    </div>
  )
}

function TrendsView({ patient, tracked, filter, report, trends, insights, days, onDays, onOpen, ring, doctorName }: {
  patient: PatientUser
  /** The vitals shown: the tracked ones, narrowed by the group filter. */
  tracked: VitalDef[]
  /** The group filter, drawn under the window picker. */
  filter?: React.ReactNode
  /** The report-request section, drawn above the doctor's note. */
  report?: React.ReactNode
  trends: Map<string, VitalTrend>
  insights: VitalInsight[]
  days: number
  onDays: (d: number) => void
  onOpen: (vitalId: string) => void
  ring: (vitalId: string) => string
  doctorName?: string
}) {
  const withData = tracked.filter(v => (trends.get(v.id)?.points.length ?? 0) > 1)

  return (
    <div className="flex flex-col gap-3">
      {/* Window picker */}
      <div className="flex items-center gap-1.5">
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => onDays(d)} aria-pressed={days === d}
            className={`text-[11px] font-bold px-3.5 py-1.5 rounded-full border transition-colors ${
              days === d ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-gray-500 border-gray-200'
            }`}>
            {d} days
          </button>
        ))}
        <span className="text-[11px] text-gray-400 ml-auto">{withData.length} of {tracked.length} with a trend</span>
      </div>
      {filter}

      {/* Unified trend — every vital normalized onto its own target band */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Unified Trend</p>
        <p className="text-[11px] text-gray-400 mt-0.5 mb-3">
          All vitals on one scale — the green band is everyone's target range.
        </p>
        {withData.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic py-4 text-center">
            Log at least two readings of a vital to see it here.
          </p>
        ) : (
          <>
            <UnifiedChart patient={patient} vitals={withData} trends={trends} />
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
              {withData.map((v, i) => (
                <button key={v.id} onClick={() => onOpen(v.id)} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                  <span className="text-[11px] text-gray-500 font-medium">{v.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Per-vital mini trends — each opens that vital's page */}
      {tracked.length > 0 && (
        <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-3 @2xl:gap-3 @5xl:grid-cols-4">
          {tracked.map(v => {
            const t = trends.get(v.id)
            const latest = t?.points[t.points.length - 1]
            const st = levelStyle(latest?.level ?? null)
            const u = unitView(v, patient)
            const change = u.change(t?.points ?? [])
            return (
              <button key={v.id} data-vital={v.id} onClick={() => onOpen(v.id)}
                className={`bg-white rounded-2xl p-3 shadow-sm text-left transition-shadow hover:shadow-md ${ring(v.id)}`}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-sm">{v.icon}</span>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider truncate flex-1">{v.name}</p>
                  <span className="text-gray-300 text-xs" aria-hidden="true">›</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-xl font-black leading-none ${st.value} font-mono`}>
                    {latest ? u.num(latest.value) : '—'}
                  </span>
                  {t && t.points.length > 1 && (
                    <span className={`text-[11px] font-bold ${t.direction === 'steady' ? 'text-gray-400' : latest?.level === 'normal' ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {TREND_ARROW[t.direction]} {change > 0 ? '+' : ''}{change}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 h-6">
                  {t && t.points.length > 1
                    ? <VitalChart points={t.points} range={targetRange(patient, v)} height={24} bare />
                    : <p className="text-[10px] text-gray-300 italic pt-1.5">not enough readings</p>}
                </div>
                {t && t.points.length > 0 && (
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    avg {u.num(t.average)} · {t.inRange}/{t.points.length} in range
                  </p>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Auto-generated summary */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">✨</span>
          <div className="flex-1">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Summary Notes</p>
            <p className="text-[10px] text-gray-400">Generated from your last {days} days of readings</p>
          </div>
        </div>
        {insights.length === 0
          ? <p className="text-[11px] text-gray-400 italic">Log some readings and a summary will appear here.</p>
          : <InsightNotes insights={insights} onOpen={onOpen} />}
        <p className="text-[10px] text-gray-400 mt-2 italic">
          These notes describe your numbers only. They are not medical advice — your doctor's note below takes precedence.
        </p>
      </div>

      {report}
      <DoctorNote note={patient.doctorNote} doctorName={doctorName} />
    </div>
  )
}

const SERIES_COLORS = ['#0a6e6e', '#1d4ed8', '#b45309', '#7c3aed', '#be123c', '#0891b2', '#65a30d', '#c026d3']

/**
 * Every vital plotted on one 0–1 axis, where 0 is the bottom of that vital's
 * own target range and 1 is the top. Values outside the band are clamped into
 * a margin, so the shared green band means "in target" for all series at once.
 */
function UnifiedChart({ patient, vitals, trends }: {
  patient: PatientUser; vitals: VitalDef[]; trends: Map<string, VitalTrend>
}) {
  const [ref, width] = useElementWidth<SVGSVGElement>()
  // Taller on tablet and web, where a 90px strip across a wide card reads as a squashed line.
  const W = width || 300, H = W > 560 ? 160 : 90, PAD = 8
  /** Band occupies the middle 60% of the plot, leaving headroom either side. */
  const yOf = (n: number) => {
    const clamped = Math.max(-0.33, Math.min(1.33, n))
    return PAD + (1 - (clamped + 0.33) / 1.66) * (H - PAD * 2)
  }
  const bandTop = yOf(1)
  const bandBottom = yOf(0)

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}
      role="img" aria-label="All tracked vitals normalized against their target ranges">
      <rect x="0" y={bandTop} width={W} height={bandBottom - bandTop} fill="#10b981" opacity=".10" />
      <line x1="0" x2={W} y1={bandTop} y2={bandTop} stroke="#10b981" strokeDasharray="3 3" strokeWidth="1" opacity=".5" />
      <line x1="0" x2={W} y1={bandBottom} y2={bandBottom} stroke="#10b981" strokeDasharray="3 3" strokeWidth="1" opacity=".5" />
      {vitals.map((v, si) => {
        const t = trends.get(v.id)
        if (!t || t.points.length < 2) return null
        const range = targetRange(patient, v)
        const band = Math.max(1, range.max - range.min)
        const n = t.points.map(p => (p.value - range.min) / band)
        const x = (i: number) => (i / (n.length - 1)) * (W - PAD * 2) + PAD
        const d = n.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yOf(val).toFixed(1)}`).join(' ')
        const color = SERIES_COLORS[si % SERIES_COLORS.length]
        return (
          <g key={v.id}>
            <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity=".85" />
            <circle cx={x(n.length - 1)} cy={yOf(n[n.length - 1])} r="3" fill={color} />
          </g>
        )
      })}
    </svg>
  )
}

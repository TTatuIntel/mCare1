import { useState } from 'react'
import {
  BottomSheet, SheetButton, Field, inputCls, Toggle, Pill, ChipFilter, VitalChart, VitalHistory, EmptyState,
  useSave, SaveError, useAct,
} from '@/shared'
import type { PatientUser, VitalDef } from '@/shared/lib/types'
import { effectiveCriticalRange, latestValid, targetRange, validateReading, vitalTrend } from '@/shared/lib/vitals'
import { useDoctor } from './useDoctor'

type Period = '14' | '30' | '90' | 'all'
const PERIODS: { id: Period; label: string }[] = [
  { id: '14', label: '14 days' }, { id: '30', label: '30 days' }, { id: '90', label: '90 days' }, { id: 'all', label: 'All' },
]
const DAY = 86_400_000

type RangeForm = { vitalId: string; min: string; max: string; critLow: string; critHigh: string }
const num = (v: string) => (v.trim() === '' ? NaN : Number(v))

/* ─── A patient's vitals, as the treating doctor works with them ──────
   Readings and trends over a chosen period, the reading taken in clinic,
   which vitals the patient records, and the target and critical range for
   each. A reading is never rewritten: a wrong one is marked invalid, with
   the reason, and stays in the record. */
export function PatientVitals({ patient }: { patient: PatientUser }) {
  const { vitalDefs, nameOf, now, setTrackedVitals, setTarget, setCriticalRange, recordReading, invalidateReading } = useDoctor()
  const activeVitals = vitalDefs.filter(v => v.active)
  const act = useAct()
  const [period, setPeriod] = useState<Period>('30')
  const since = period === 'all' ? 0 : now - Number(period) * DAY

  /* a reading taken in clinic */
  const recordable = patient.trackedVitalIds.map(id => activeVitals.find(v => v.id === id)).filter((v): v is VitalDef => !!v)
  const [reading, setReading] = useState<{ vitalId: string; value: string; note: string } | null>(null)
  const readingSave = useSave()
  const readingDef = recordable.find(v => v.id === reading?.vitalId)
  const readingIssue = reading && readingDef && reading.value.trim() ? validateReading(readingDef, reading.value) : null
  const saveReading = async () => {
    if (!reading || !readingDef || readingIssue || !reading.value.trim()) return
    const saved = await readingSave.run(() => recordReading(patient.id, { vitalId: readingDef.id, value: reading.value, note: reading.note, ref: readingSave.ref }))
    if (!saved.ok) return
    setReading(null)
    act.say(`${readingDef.name} recorded${saved.value.level === 'normal' ? '' : ` · ${saved.value.level}`}${saved.value.alerted ? ' · alert raised' : ''}`)
  }

  /* marking a reading invalid */
  const [invalidFor, setInvalidFor] = useState<string | null>(null)
  const [invalidReason, setInvalidReason] = useState('')
  const invalidSave = useSave()
  const markInvalid = async () => {
    if (!invalidFor || !invalidReason.trim()) return
    if (!(await invalidSave.run(() => invalidateReading(patient.id, invalidFor, invalidReason.trim()))).ok) return
    setInvalidFor(null)
    act.say('Reading marked invalid')
  }

  /* targets and the critical range */
  const [range, setRange] = useState<RangeForm | null>(null)
  const rangeSave = useSave()
  const rangeDef = activeVitals.find(v => v.id === range?.vitalId)
  const openRange = (def: VitalDef) => {
    const target = targetRange(patient, def), own = patient.criticalThresholds?.[def.id]
    rangeSave.clear()
    setRange({ vitalId: def.id, min: String(target.min), max: String(target.max), critLow: own ? String(own.min) : '', critHigh: own ? String(own.max) : '' })
  }
  const rangeIssue = (() => {
    if (!range || !rangeDef) return null
    const min = num(range.min), max = num(range.max), lo = num(range.critLow), hi = num(range.critHigh)
    if (isNaN(min) || isNaN(max)) return 'Enter the target minimum and maximum.'
    if (min >= max) return 'The target minimum must be lower than the maximum.'
    if (isNaN(lo) !== isNaN(hi)) return 'Enter both critical limits, or leave both empty to use the standard ones.'
    if (!isNaN(lo) && (lo >= min || hi <= max)) return 'The critical limits must sit outside the target range.'
    return null
  })()
  const saveRange = async () => {
    if (!range || !rangeDef || rangeIssue) return
    const target = { min: num(range.min), max: num(range.max) }
    const critical = isNaN(num(range.critLow)) ? null : { min: num(range.critLow), max: num(range.critHigh) }
    const before = targetRange(patient, rangeDef), ownBefore = patient.criticalThresholds?.[rangeDef.id]
    const targetChanged = before.min !== target.min || before.max !== target.max
    const criticalChanged = (ownBefore?.min ?? null) !== (critical?.min ?? null) || (ownBefore?.max ?? null) !== (critical?.max ?? null)
    const saved = await rangeSave.run(async () => {
      // The target first: a critical range belongs to a vital that has one.
      const first = targetChanged ? await setTarget(patient.id, rangeDef.id, target) : { ok: true as const, value: undefined }
      if (!first.ok || !criticalChanged) return first
      return setCriticalRange(patient.id, rangeDef.id, critical)
    })
    if (!saved.ok) return
    setRange(null)
    act.say(targetChanged ? `${rangeDef.name} target saved · patient told` : criticalChanged ? `${rangeDef.name} critical range saved` : 'Nothing changed')
  }

  const toggleTracked = (def: VitalDef) => {
    const on = patient.trackedVitalIds.includes(def.id)
    const next = on ? patient.trackedVitalIds.filter(v => v !== def.id) : [...patient.trackedVitalIds, def.id]
    void act.run(() => setTrackedVitals(patient.id, next), `${def.name} ${on ? 'no longer' : 'now'} recorded by ${patient.name.split(' ')[0]}`)
  }

  const history = (patient.targetLog ?? []).slice().sort((a, b) => b.at - a.at).slice(0, 8)

  return (
    <>
      {act.node && <div className="span-all">{act.node}</div>}
      <button onClick={() => { readingSave.clear(); setReading({ vitalId: recordable[0]?.id ?? '', value: '', note: '' }) }} disabled={recordable.length === 0}
        className={`w-full py-3 rounded-2xl text-sm font-bold shadow span-all ${recordable.length ? 'bg-teal-700 text-white' : 'bg-gray-200 text-gray-400'}`}>+ Record a reading</button>

      {patient.trackedVitalIds.length === 0
        ? <div className="span-all"><EmptyState icon="📈" title="No vitals assigned" text="Switch on the vitals this patient should record, below." /></div>
        : <ChipFilter label="Period" options={PERIODS} value={period} onChange={setPeriod} />}

      {patient.trackedVitalIds.map(id => {
        const def = vitalDefs.find(v => v.id === id)
        if (!def) return null
        const target = targetRange(patient, def)
        const all = patient.readings.filter(r => r.vitalId === id)
        const rows = since ? all.filter(r => (r.at ?? 0) >= since) : all
        const trend = vitalTrend(patient, def, period === 'all' ? 0 : Number(period), now)
        return (
          <div key={id} className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-900">{def.icon} {def.name}</p>
              <p className="text-[11px] text-teal-700 font-semibold">Target {target.min}–{target.max} {def.unit}</p>
            </div>
            {trend.points.length > 0 && (
              <p className="text-[10px] text-gray-400 mb-1">
                {trend.points.length} reading{trend.points.length > 1 ? 's' : ''} · average <span className="font-mono">{trend.average}</span> · {trend.inRange} in range
              </p>
            )}
            <VitalChart points={trend.points} range={target} height={64} />
            {/* the same filterable history the patient sees, with the doctor's own row action */}
            <VitalHistory patient={patient} def={def} rows={rows} total={all.length} latestId={latestValid(patient, id)?.id}
              caption={period === 'all' ? undefined : `From the last ${period} days`} onShowAll={period === 'all' ? undefined : () => setPeriod('all')}
              className="mt-2 border border-gray-100 rounded-xl" listClassName="max-h-52"
              action={r => r.invalid
                ? (r.invalidatedBy ? <span className="block text-right mt-1 text-[10px] text-gray-400">by {nameOf(r.invalidatedBy, 'the doctor')}</span> : null)
                : <button onClick={() => { invalidSave.clear(); setInvalidFor(r.id); setInvalidReason('') }} className="block ml-auto mt-1 text-[10px] text-gray-400 underline">Mark invalid</button>} />
          </div>
        )
      })}

      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-sm font-bold text-gray-900 mb-1">Vitals and ranges</p>
        <p className="text-xs text-gray-400 mb-3">Which vitals this patient records, the target for each, and the limits that raise a critical alert at once.</p>
        {activeVitals.map(v => {
          const tracked = patient.trackedVitalIds.includes(v.id)
          const target = targetRange(patient, v), critical = effectiveCriticalRange(v, patient)
          const own = !!patient.thresholds[v.id], ownCritical = !!patient.criticalThresholds?.[v.id]
          return (
            <div key={v.id} className="border border-gray-100 rounded-xl p-3 mb-2 last:mb-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900 min-w-0 truncate">{v.icon} {v.name}</p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {tracked && <button onClick={() => openRange(v)} className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">Edit ranges</button>}
                  <Toggle on={tracked} disabled={act.busy} label={`${v.name} recorded by the patient`} onChange={() => toggleTracked(v)} />
                </div>
              </div>
              {tracked ? (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <Pill color="teal">Target {target.min}–{target.max} {v.unit}</Pill>
                  <Pill color="red">Critical ≤ {critical.min} · ≥ {critical.max}</Pill>
                  <span className="text-[10px] text-gray-400">{own ? 'Your target' : 'Standard target'}{ownCritical ? ' · your critical range' : ''}</span>
                </div>
              ) : <p className="text-[10px] text-gray-400 mt-1">Not recorded by this patient.</p>}
            </div>
          )
        })}
      </div>

      {history.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-900 mb-2">Target changes</p>
          {history.map((c, i) => {
            const def = vitalDefs.find(v => v.id === c.vitalId)
            return (
              <div key={`${c.vitalId}-${c.at}-${i}`} className="py-1.5 border-b border-gray-50 last:border-0">
                <p className="text-xs text-gray-800">
                  {def?.name ?? c.vitalId}: <span className="font-mono">{c.from ? `${c.from.min}–${c.from.max} → ` : ''}{c.to.min}–{c.to.max}</span> {def?.unit}
                </p>
                <p className="text-[10px] text-gray-400">{new Date(c.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {nameOf(c.by, 'a previous doctor')}</p>
              </div>
            )
          })}
        </div>
      )}

      <BottomSheet open={!!reading} onClose={() => setReading(null)} title="Record a Reading" subtitle={`For ${patient.name} · saved to their record under your name`}
        footer={<><SheetButton tone="ghost" onClick={() => setReading(null)}>Cancel</SheetButton><SheetButton disabled={!reading?.value.trim() || !!readingIssue || readingSave.busy} onClick={saveReading}>{readingSave.busy ? 'Saving…' : 'Save reading'}</SheetButton></>}>
        {reading && (
          <>
            <Field label="Vital">
              <div className="grid grid-cols-2 gap-2">
                {recordable.map(v => (
                  <button key={v.id} onClick={() => setReading({ ...reading, vitalId: v.id, value: '' })}
                    className={`py-2 rounded-xl text-xs font-semibold border-2 ${reading.vitalId === v.id ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-100 bg-gray-50 text-gray-600'}`}>{v.icon} {v.name}</button>
                ))}
              </div>
            </Field>
            <Field label={`Value${readingDef ? ` (${readingDef.unit})` : ''} *`}>
              <input value={reading.value} onChange={e => setReading({ ...reading, value: e.target.value })} inputMode={readingDef?.id === 'bp' ? 'text' : 'decimal'}
                placeholder={readingDef?.id === 'bp' ? '120/80' : 'e.g. 72'} className={`${inputCls} font-mono`} />
            </Field>
            {readingIssue && <p className="text-xs text-red-500 -mt-2 mb-2">{readingIssue}</p>}
            <Field label="Note"><input value={reading.note} maxLength={500} onChange={e => setReading({ ...reading, note: e.target.value })} placeholder="e.g. Taken in clinic, seated" className={inputCls} /></Field>
            <SaveError message={readingSave.error} />
          </>
        )}
      </BottomSheet>

      <BottomSheet open={!!invalidFor} onClose={() => setInvalidFor(null)} title="Mark Reading Invalid"
        subtitle="The reading stays in the record but is left out of alerts and trends. An alert it raised is closed."
        footer={<><SheetButton tone="ghost" onClick={() => setInvalidFor(null)}>Cancel</SheetButton>
          <SheetButton tone="danger" disabled={!invalidReason.trim() || invalidSave.busy} onClick={markInvalid}>{invalidSave.busy ? 'Saving…' : 'Mark Invalid'}</SheetButton></>}>
        <Field label="Reason *">
          <textarea value={invalidReason} onChange={e => setInvalidReason(e.target.value)} rows={3} maxLength={300}
            placeholder="e.g. Cuff fitted incorrectly; patient re-measured." className={`${inputCls} resize-none`} />
        </Field>
        <SaveError message={invalidSave.error} />
      </BottomSheet>

      <BottomSheet open={!!range} onClose={() => setRange(null)} title={`Ranges · ${rangeDef?.name ?? ''}`}
        subtitle={`For ${patient.name}. Readings outside the target are flagged; a reading at or beyond a critical limit alerts you at once.`}
        footer={<><SheetButton tone="ghost" onClick={() => setRange(null)}>Cancel</SheetButton>
          <SheetButton disabled={!!rangeIssue || rangeSave.busy} onClick={saveRange}>{rangeSave.busy ? 'Saving…' : 'Save ranges'}</SheetButton></>}>
        {range && rangeDef && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label={`Target min (${rangeDef.unit}) *`}><input inputMode="decimal" value={range.min} onChange={e => setRange({ ...range, min: e.target.value })} className={`${inputCls} font-mono`} /></Field>
              <Field label={`Target max (${rangeDef.unit}) *`}><input inputMode="decimal" value={range.max} onChange={e => setRange({ ...range, max: e.target.value })} className={`${inputCls} font-mono`} /></Field>
              <Field label="Critical at or below"><input inputMode="decimal" value={range.critLow} onChange={e => setRange({ ...range, critLow: e.target.value })} placeholder={String(effectiveCriticalRange(rangeDef).min)} className={`${inputCls} font-mono`} /></Field>
              <Field label="Critical at or above"><input inputMode="decimal" value={range.critHigh} onChange={e => setRange({ ...range, critHigh: e.target.value })} placeholder={String(effectiveCriticalRange(rangeDef).max)} className={`${inputCls} font-mono`} /></Field>
            </div>
            <p className="text-[10px] text-gray-400 mb-2">Leave the critical limits empty to use the standard ones for {rangeDef.name}. The patient is told when their target changes.</p>
            {rangeIssue && <p className="text-xs text-red-500 mb-2">{rangeIssue}</p>}
            <SaveError message={rangeSave.error} />
          </>
        )}
      </BottomSheet>
    </>
  )
}

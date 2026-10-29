import { useEffect, useState } from 'react'
import { Avatar, Pill, Page, EmptyState, Chevron, Segmented, BottomSheet, SheetButton, Field, inputCls, useSave, SaveError, useAct, Toggle } from '@/shared'
import type { VitalDef, VitalGroupId } from '@/shared/lib/types'
import { VITAL_GROUPS, groupOf, rangeWords } from '@/shared/lib/vitals'
import PatientThresholdView from './PatientThresholdView'
import { useAdmin } from './useAdmin'

/* ─── Vitals (definitions + each patient's readings) ────────────────── */
type DefForm = {
  name: string; unit: string; normalMin: string; normalMax: string; criticalMin: string; criticalMax: string; hardMin: string; hardMax: string; icon: string
  /** Where it is listed when logging several, how often it is due without a doctor's plan, decimals shown. */
  groupId: VitalGroupId; checkinHours: string; decimals: string
  /** False: recorded only, never graded or alerted on. */
  graded: boolean
  /** An empty critical limit means "none" (false) rather than "normal ± 25 %" (true). */
  criticalFallback: boolean
  /** Blood pressure: the lower number's ranges. */
  diaNormalMin: string; diaNormalMax: string; diaCriticalMin: string; diaCriticalMax: string
  /** A change to grading needs one (the database refuses it without). */
  reason: string
}
const EMPTY_DEF: DefForm = {
  name: '', unit: '', normalMin: '', normalMax: '', criticalMin: '', criticalMax: '', hardMin: '', hardMax: '', icon: '📊',
  groupId: 'body', checkinHours: '', decimals: '0', graded: true, criticalFallback: true,
  diaNormalMin: '', diaNormalMax: '', diaCriticalMin: '', diaCriticalMax: '', reason: '',
}
const s = (v?: number) => (v === undefined || v === null ? '' : String(v))
const opt = (v: string) => (v.trim() === '' ? undefined : Number(v))
/** The fields that decide how readings are graded, for "this change needs a reason". */
const gradingKey = (v: Partial<VitalDef>) => JSON.stringify([v.normalMin, v.normalMax, v.criticalMin ?? null, v.criticalMax ?? null, v.diaNormalMin ?? null,
  v.diaNormalMax ?? null, v.diaCriticalMin ?? null, v.diaCriticalMax ?? null, v.graded !== false, v.criticalFallback !== false])
type View = 'defs' | 'patients'
const n = (v: string) => (v.trim() === '' ? NaN : Number(v))

export default function VitalsTab() {
  const { full, can, vitalDefs, patients: all, patient, saveVitalDef, vitalDefImpact, status, error, reload } = useAdmin()
  const canManageDefs = full
  const canSeePatients = can('monitor_patients')

  const [view, setView] = useState<View>(canManageDefs ? 'defs' : 'patients')
  const [openId, setOpenId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ mode: 'add' | 'edit'; id?: string } | null>(null)
  const [form, setForm] = useState<DefForm>(EMPTY_DEF)
  const act = useAct()
  const saving = useSave()

  const patients = all.filter(p => p.status === 'active')
  const current = sheet?.mode === 'edit' ? vitalDefs.find(v => v.id === sheet.id) : undefined
  // How many patients the standard range grades: shown before a change that re-grades them.
  const [impact, setImpact] = useState<number | null>(null)
  useEffect(() => {
    setImpact(null)
    if (!current) return
    let live = true
    void vitalDefImpact(current.id).then(r => { if (live && r.ok) setImpact(r.value) })
    return () => { live = false }
  }, [current?.id])   // asked again only when another definition is opened
  const issue = (() => {
    if (!form.name.trim() || !form.unit.trim()) return 'Name and unit are required.'
    const [a, b, c, d] = [n(form.normalMin), n(form.normalMax), n(form.criticalMin), n(form.criticalMax)]
    if (isNaN(a) || isNaN(b)) return 'Enter normal min and max.'
    if (a >= b) return 'Normal min must be lower than normal max.'
    if (!isNaN(c) && c >= a) return 'Critical low must be below normal min.'
    if (!isNaN(d) && d <= b) return 'Critical high must be above normal max.'
    const hrs = n(form.checkinHours)
    if (!isNaN(hrs) && (hrs < 1 || hrs > 8760 || !Number.isInteger(hrs))) return 'Check-in hours must be a whole number from 1 to 8760.'
    if (current && gradingKey(current) !== gradingKey(defFrom()) && !form.reason.trim()) return 'Say why the grading changes: it re-grades every patient without a personal target.'
    return null
  })()

  /** The definition as the form describes it. */
  function defFrom(): VitalDef {
    const a = n(form.normalMin), b = n(form.normalMax)
    const base = {
      name: form.name.trim(), unit: form.unit.trim(), icon: form.icon || '📊',
      normalMin: a, normalMax: b,
      criticalMin: opt(form.criticalMin), criticalMax: opt(form.criticalMax),
      hardMin: isNaN(n(form.hardMin)) ? Math.min(0, a) : n(form.hardMin),
      hardMax: isNaN(n(form.hardMax)) ? b * 3 : n(form.hardMax),
      groupId: form.groupId, checkinHours: opt(form.checkinHours), decimals: opt(form.decimals) ?? 0,
      graded: form.graded, criticalFallback: form.criticalFallback,
      ...(current?.id === 'bp' ? { diaNormalMin: opt(form.diaNormalMin), diaNormalMax: opt(form.diaNormalMax), diaCriticalMin: opt(form.diaCriticalMin), diaCriticalMax: opt(form.diaCriticalMax) } : {}),
    }
    return current ? { ...current, ...base } : { ...base, id: `${base.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}`, active: true }
  }
  const gradingChanges = !!current && gradingKey(current) !== gradingKey(defFrom())

  const openEdit = (v: VitalDef) => {
    setForm({
      name: v.name, unit: v.unit, icon: v.icon,
      normalMin: String(v.normalMin), normalMax: String(v.normalMax),
      criticalMin: v.criticalMin !== undefined ? String(v.criticalMin) : '', criticalMax: v.criticalMax !== undefined ? String(v.criticalMax) : '',
      hardMin: String(v.hardMin), hardMax: String(v.hardMax),
      groupId: groupOf(v.id, v), checkinHours: s(v.checkinHours), decimals: s(v.decimals ?? 0), graded: v.graded !== false, criticalFallback: v.criticalFallback !== false,
      diaNormalMin: s(v.diaNormalMin), diaNormalMax: s(v.diaNormalMax), diaCriticalMin: s(v.diaCriticalMin), diaCriticalMax: s(v.diaCriticalMax), reason: '',
    })
    saving.clear()
    setSheet({ mode: 'edit', id: v.id })
  }

  const save = async () => {
    if (issue || !sheet) return
    const def = defFrom()
    // The sheet stays open, with the reason, until the definition is really saved.
    if (!(await saving.run(() => saveVitalDef(def, form.reason))).ok) return
    act.say(`${def.name} ${sheet.mode === 'edit' ? 'updated' : 'added'}${gradingChanges ? ' · treating doctors told' : ''}`)
    setSheet(null)
  }

  const opened = patient(openId)
  if (opened) return <PatientThresholdView patient={opened} onBack={() => setOpenId(null)} />

  const views = [
    ...(canManageDefs ? [{ id: 'defs' as const, label: 'Definitions' }] : []),
    ...(canSeePatients ? [{ id: 'patients' as const, label: 'Patient Vitals' }] : []),
  ]

  return (
    <Page title="Vitals" status={status} error={error} onRetry={reload}
      actions={view === 'defs' && canManageDefs ? (
        <button onClick={() => { setForm(EMPTY_DEF); saving.clear(); setSheet({ mode: 'add' }) }}
          className="text-xs font-semibold text-teal-700 border border-teal-200 px-3 py-1.5 rounded-full">+ Add type</button>
      ) : undefined}>
      {act.node && <div className="span-all">{act.node}</div>}
      {views.length > 1 && <div className="span-all"><Segmented label="Which view" options={views} value={view} onChange={setView} /></div>}

      {view === 'defs' && (
        <>
          <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 span-all">
            <p className="text-xs text-teal-800 leading-relaxed">
              These ranges apply when a doctor has not set a personal target or critical range for a patient. A reading at or beyond a critical limit raises an alert at once.
            </p>
          </div>
          {vitalDefs.map(v => (
            <div key={v.id} className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{v.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-gray-900">{v.name}</p>
                    <Pill color={v.active ? 'green' : 'gray'}>{v.active ? 'Active' : 'Inactive'}</Pill>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{v.unit} · Normal {v.normalMin}–{v.normalMax}</p>
                  {v.graded === false
                    ? <p className="text-[11px] text-gray-400">Recorded only · never graded or alerted on</p>
                    : <p className="text-[11px] text-red-500">
                        Critical {v.criticalMin !== undefined ? `≤ ${v.criticalMin}` : '—'} / {v.criticalMax !== undefined ? `≥ ${v.criticalMax}` : '—'}
                        {v.criticalMin === undefined && v.criticalMax === undefined && v.criticalFallback !== false ? ' (normal ± 25 %)' : ''}
                      </p>}
                  {v.contextRanges && (
                    <p className="text-[11px] text-gray-500">By time measured: {Object.entries(v.contextRanges).map(([k, r]) => `${k.replace('_', ' ')} ${rangeWords(r?.normalMin, r?.normalMax)}`).join(' · ')}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <Toggle on={v.active} disabled={!canManageDefs || act.busy} label={`Collect ${v.name}`}
                    onChange={() => canManageDefs && act.run(() => saveVitalDef({ ...v, active: !v.active }), `${v.name} ${v.active ? 'switched off' : 'switched on'}`)} />
                  {canManageDefs && (
                    <button onClick={() => openEdit(v)} className="text-[10px] text-teal-600 font-semibold bg-teal-50 px-2 py-0.5 rounded-full">Edit</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {view === 'patients' && (
        <>
          <p className="text-xs text-gray-500 -mt-2 span-all">Each patient's latest readings and the targets their doctor set. Opening a patient is recorded in the audit log.</p>
          {patients.length === 0 && <div className="span-all"><EmptyState icon="📊" title="No active patients" text="Patients appear here once they have signed up." /></div>}
          {patients.map(p => (
            <button key={p.id} onClick={() => setOpenId(p.id)}
              className="bg-white rounded-2xl px-4 py-4 flex items-center gap-3 shadow-sm text-left active:bg-gray-50 transition-colors">
              <Avatar name={p.name} avatar={p.avatar} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{p.name}</p>
                <p className="text-xs text-gray-400 truncate">{p.email}</p>
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  <Pill color="teal">{p.trackedVitalIds.length} vital{p.trackedVitalIds.length === 1 ? '' : 's'}</Pill>
                  {Object.keys(p.thresholds).length > 0 && <Pill color="purple">{Object.keys(p.thresholds).length} doctor target{Object.keys(p.thresholds).length === 1 ? '' : 's'}</Pill>}
                </div>
              </div>
              <Chevron />
            </button>
          ))}
        </>
      )}

      <BottomSheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.mode === 'edit' ? 'Edit Vital Type' : 'Add New Vital Type'}
        footer={<><SheetButton tone="ghost" onClick={() => setSheet(null)}>Cancel</SheetButton><SheetButton disabled={!!issue || saving.busy} onClick={save}>{saving.busy ? 'Saving…' : sheet?.mode === 'edit' ? 'Save' : 'Add Vital'}</SheetButton></>}>
        <div className="grid grid-cols-2 gap-x-3">
          {([
            ['Name *', 'name', 'e.g. Respiratory Rate'], ['Unit *', 'unit', 'e.g. /min'],
            ['Normal min *', 'normalMin', ''], ['Normal max *', 'normalMax', ''],
            ['Critical low', 'criticalMin', ''], ['Critical high', 'criticalMax', ''],
            ['Lowest plausible', 'hardMin', ''], ['Highest plausible', 'hardMax', ''],
            ['Icon', 'icon', ''],
          ] as const).map(([label, key, ph]) => (
            <Field key={key} label={label}>
              <input value={form[key]} placeholder={ph} inputMode={key === 'name' || key === 'unit' || key === 'icon' ? 'text' : 'decimal'}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className={inputCls} />
            </Field>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Listed under">
            <select value={form.groupId} onChange={e => setForm(f => ({ ...f, groupId: e.target.value as VitalGroupId }))} className={inputCls}>
              {VITAL_GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </Field>
          <Field label="Due every (hours) without a plan">
            <input value={form.checkinHours} placeholder="24" inputMode="numeric" onChange={e => setForm(f => ({ ...f, checkinHours: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        {current?.id === 'bp' && (
          <>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1 mb-1">Lower number (diastolic)</p>
            <div className="grid grid-cols-2 gap-x-3">
              {([['Normal min', 'diaNormalMin'], ['Normal max', 'diaNormalMax'], ['Critical low', 'diaCriticalMin'], ['Critical high', 'diaCriticalMax']] as const).map(([label, key]) => (
                <Field key={key} label={label}>
                  <input value={form[key]} inputMode="decimal" onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className={inputCls} />
                </Field>
              ))}
            </div>
          </>
        )}
        <label className="flex items-center gap-2 text-xs text-gray-700 mt-1">
          <input type="checkbox" checked={form.graded} onChange={e => setForm(f => ({ ...f, graded: e.target.checked }))} className="accent-teal-700" />
          Grade readings and raise alerts (off: recorded only, like height)
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-700 mt-1">
          <input type="checkbox" checked={!form.criticalFallback} onChange={e => setForm(f => ({ ...f, criticalFallback: !e.target.checked }))} className="accent-teal-700" />
          An empty critical limit means none (otherwise: normal ± 25 %)
        </label>
        {gradingChanges && (
          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 p-3">
            <p className="text-xs text-amber-800 font-semibold">
              This changes how readings are graded{impact !== null ? ` for ${impact} patient${impact === 1 ? '' : 's'} without a personal target` : ''}. Their treating doctors are told.
            </p>
            <Field label="Why it changes *">
              <input value={form.reason} maxLength={300} placeholder="e.g. Local guideline updated" onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className={inputCls} />
            </Field>
          </div>
        )}
        {issue && <p className="text-xs text-red-500">{issue}</p>}
        <SaveError message={saving.error} className="mt-2" />
      </BottomSheet>
    </Page>
  )
}

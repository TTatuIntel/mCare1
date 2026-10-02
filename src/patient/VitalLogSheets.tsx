import { useState } from 'react'
import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, SaveError, useSave, levelStyle } from '@/shared'
import type { PatientUser, VitalDef } from '@/shared/lib/types'
import {
  evaluate, alertIsFor, latestValid, targetRange, validateReading, unitView, groupOf, VITAL_GROUPS,
  SELF_CLEAR_WINDOW_MIN, ago, readingTime, type VitalLevel,
} from '@/shared/lib/vitals'

/* ─── Logging vitals ──────────────────────────────────────────────────
   The only place a patient enters a reading. Every screen that logs —
   the Vitals list, a vital's detail page, a Home reminder — opens one of
   these two sheets, so validation, alerts and the re-measure flow behave
   the same everywhere.

   Logging follows the vital groups (VITAL_GROUPS: heart, breathing…), the
   same structure the Vitals tab uses. A patient can log one vital, one
   group together, or everything at once, and can move between the three:
   the one-vital sheet offers the rest of its group as the next step. */

type Result = { level: VitalLevel; alerted: boolean; readingId: string; name: string; value: string; cleared?: boolean }

/** One-tap context for a reading; saved as the reading's note, so History can filter on it. */
const CONTEXT_TAGS = ['Resting', 'Before meal', 'After meal', 'After exercise', 'After medication']

/**
 * The open warning on a vital that a fresh in-range reading would clear,
 * with how long is left. Mirrors the rule the backend applies when a reading is saved.
 */
export function useSelfClear() {
  const { currentUser, alerts, now } = useApp()
  const patient = currentUser as PatientUser
  return (def: VitalDef) => {
    const a = alerts.find(x => x.patientId === patient.id && isActiveAlert(x) &&
      x.type === 'vital' && alertIsFor(x, def) && x.severity === 'warning' && x.status === 'open')
    if (!a) return null
    const msLeft = a.at + SELF_CLEAR_WINDOW_MIN * 60_000 - now
    return { expired: msLeft <= 0, minLeft: Math.max(1, Math.ceil(msLeft / 60_000)) }
  }
}

/** Strip under a vital with an open warning: re-measure prompt while the window is open, then a hand-off note. */
export function SelfClearBanner({ def, onLog }: { def: VitalDef; onLog: () => void }) {
  const sc = useSelfClear()(def)
  if (!sc) return null
  if (sc.expired) return (
    <div className="px-3.5 py-1.5 bg-blue-50 border-t border-blue-100 flex items-center gap-2">
      <span className="text-[10px]">👩‍⚕️</span>
      <p className="text-[11px] text-blue-700 font-semibold truncate">Window closed — your doctor will clear this alert</p>
    </div>
  )
  return (
    <button onClick={onLog} className="w-full text-left px-3.5 py-1.5 bg-amber-50 border-t border-amber-100 flex items-center gap-2">
      <span className="text-[10px]">⏱</span>
      <p className="text-[11px] text-amber-700 font-semibold flex-1 truncate">Re-measure within {sc.minLeft} min to clear</p>
      <span className="text-[11px] font-bold text-amber-700">Log →</span>
    </button>
  )
}

/** Owns which log sheet is open. Render `sheets` once; call `logOne` / `logAll` from anywhere on the screen. */
export function useVitalLog() {
  const [target, setTarget] = useState<{ vitalId?: string; groupId?: string } | null>(null)
  const close = () => setTarget(null)
  const logOne = (vitalId: string) => setTarget({ vitalId })
  /** Every tracked vital of one group (see VITAL_GROUPS) in one sheet. */
  const logGroup = (groupId: string) => setTarget({ groupId })
  const sheets = !target ? null
    : target.vitalId ? <LogOneSheet key={target.vitalId} vitalId={target.vitalId} onClose={close} onSwitch={logOne} onLogGroup={logGroup} />
    : <LogAllSheet key={target.groupId ?? 'all'} groupId={target.groupId} onClose={close} />
  return { logOne, logGroup, logAll: () => setTarget({}), sheets }
}

/* ─── What happened to an out-of-range (or alert-clearing) reading ─── */
function ResultSheet({ result, onClose }: { result: Result; onClose: () => void }) {
  const { currentUser, sendAlertNow } = useApp()
  const [sent, setSent] = useState(false)
  const save = useSave()
  const alerted = result.alerted || sent
  const sendNow = async () => { if ((await save.run(() => sendAlertNow(currentUser!.id, result.readingId))).ok) setSent(true) }
  return (
    <BottomSheet open onClose={onClose}
      title={result.cleared ? '✓ Alert cleared'
        : result.level === 'critical' ? '⚠ Critical reading'
        : alerted ? 'Sent to your doctor' : '▲ Please re-measure'}
      footer={!alerted && !result.cleared
        ? <><SheetButton tone="ghost" onClick={onClose}>I'll re-measure</SheetButton><SheetButton tone="danger" disabled={save.busy} onClick={sendNow}>{save.busy ? 'Sending…' : 'Send to doctor now'}</SheetButton></>
        : <SheetButton onClick={onClose}>OK</SheetButton>}>
      <div className="text-sm text-gray-700 leading-relaxed">
        <p className="font-bold text-gray-900 mb-1 font-mono">{result.name}: {result.value}</p>
        {result.cleared
          ? <p>Your re-measurement is back inside your target range, so that alert has been cleared. Your doctor can still see both readings in your history.</p>
          : result.level === 'critical'
          ? <p>Your doctor has been alerted immediately. If you feel unwell — chest pain, breathlessness, confusion — use SOS or call 999.</p>
          : alerted
            ? <p>This reading was out of range again, so your doctor has been notified. You'll see their response under My Alerts.</p>
            : <p>This reading is outside your target range and has been saved. Rest for 5 minutes and measure again: if the next reading is out of range too, it goes to your doctor. You can also send this one now.</p>}
      </div>
      <SaveError message={save.error} className="mt-3" />
    </BottomSheet>
  )
}

/* ─── One vital ─── */
function LogOneSheet({ vitalId, onClose, onSwitch, onLogGroup }: {
  vitalId: string
  onClose: () => void
  /** Carry on with another vital of the same group. */
  onSwitch: (vitalId: string) => void
  /** Log the whole group together instead. */
  onLogGroup: (groupId: string) => void
}) {
  const { currentUser, vitalDefs, logReading, now } = useApp()
  const patient = currentUser as PatientUser
  const selfClear = useSelfClear()
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const saving = useSave()
  const def = vitalDefs.find(v => v.id === vitalId)
  if (!def) return null
  if (result) return <ResultSheet result={result} onClose={onClose} />

  const sc = selfClear(def)
  const clearing = !!sc && !sc.expired
  // Typed in the patient's unit; `canon` is what gets validated, evaluated and stored.
  const u = unitView(def, patient)
  const canon = u.toCanonical(value)
  const error = value.trim() ? validateReading(def, canon, u.unit) : null
  const lvl = value.trim() && !error ? evaluate(patient, def, canon) : null
  const range = u.range(targetRange(patient, def))
  const last = latestValid(patient, def.id)
  const lastAt = last ? readingTime(last) : null
  // The vitals measured together with this one: the rest of its group that the patient tracks.
  const group = VITAL_GROUPS.find(g => g.id === groupOf(def.id))
  const siblings = vitalDefs.filter(v => v.active && v.id !== def.id && patient.trackedVitalIds.includes(v.id) && groupOf(v.id) === group?.id)

  /** Saves, then closes; `then` runs instead of closing when the reading needs no follow-up. */
  const save = async (then: () => void = onClose) => {
    if (!value.trim() || error) return
    const saved = await saving.run(() => logReading(patient.id, { id: `rd_${Date.now()}`, vitalId, value: canon, loggedAt: '', note: note.trim() || undefined }))
    if (!saved.ok) return   // nothing was saved: the sheet stays open with what was typed and says why
    const res = saved.value
    if (res.level !== 'normal' || res.cleared) setResult({ ...res, name: def.name, value: `${u.value(canon)} ${u.unit}` })
    else then()
  }
  /** Moving on keeps what was typed: a reading in the box is saved first. */
  const moveOn = (then: () => void) => (value.trim() ? save(then) : then())

  return (
    <BottomSheet open onClose={onClose} title={`${def.icon} Log ${def.name}`}
      subtitle={`${u.unit} · target ${range.min}–${range.max}${last ? ` · last ${u.value(last.value)}${lastAt ? `, ${ago(lastAt, now)}` : ''}` : ''}`}
      footer={<><SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton>
        <SheetButton disabled={!value.trim() || !!error || saving.busy} onClick={() => save()}>{saving.busy ? 'Saving…' : 'Save Reading'}</SheetButton></>}>
      {clearing && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-amber-50 border border-amber-100">
          <p className="text-[11px] text-amber-700 font-semibold">
            ⏱ {sc?.minLeft} min left — an in-range reading clears your open alert.
          </p>
        </div>
      )}
      <div className="relative">
        <input type="text" inputMode={def.id === 'bp' ? 'text' : 'decimal'} value={value} autoFocus
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          placeholder={def.id === 'bp' ? 'e.g. 120/80' : 'e.g. 72'}
          aria-label={`${def.name} in ${u.unit}`}
          className="w-full text-center text-4xl font-black bg-gray-50 border-2 border-gray-200 rounded-2xl py-5 outline-none focus:border-teal-400 transition-colors font-mono" />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">{u.unit}</span>
      </div>
      {error && (
        <div className="mt-3 text-center text-xs font-semibold px-4 py-2.5 rounded-xl bg-gray-50 text-gray-600 border border-gray-200">{error}</div>
      )}
      <SaveError message={saving.error} className="mt-3 text-center" />
      {lvl && (
        <div className={`mt-3 text-center text-xs font-semibold px-4 py-2.5 rounded-xl border ${levelStyle(lvl).chip}`}>
          {lvl === 'normal'
            ? (clearing ? '✓ In range — this will clear your alert' : '✓ Within your target range')
            : lvl === 'warning' ? '▲ Outside your target range'
            : '⚠ Critical — your doctor will be alerted immediately'}
        </div>
      )}
      {/* context: one tap for the common cases, or type your own */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {CONTEXT_TAGS.map(t => (
          <button key={t} onClick={() => setNote(note === t ? '' : t)} aria-pressed={note === t}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              note === t ? 'bg-teal-50 text-teal-700 border-teal-300' : 'bg-white text-gray-500 border-gray-200'}`}>
            {t}
          </button>
        ))}
      </div>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add context (optional) — e.g. missed dose, felt dizzy"
        className="w-full mt-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-teal-400" />

      {/* the rest of this vital's group: measured together, so offered as the next step */}
      {group && siblings.length > 0 && (
        <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500"><span aria-hidden="true">{group.icon}</span> {group.label} · log next</p>
          <p className="mt-0.5 text-[10px] text-gray-400">{value.trim() ? 'This reading is saved first.' : group.hint}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {siblings.map(s => {
              const sLast = latestValid(patient, s.id)
              return (
                <button key={s.id} type="button" disabled={!!error || saving.busy} onClick={() => moveOn(() => onSwitch(s.id))}
                  className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white py-1 pl-2 pr-2.5 text-[11px] font-semibold text-gray-800 transition-all hover:border-teal-300 active:scale-95 disabled:opacity-50">
                  <span aria-hidden="true">{s.icon}</span>
                  {s.name}
                  {sLast && <span className="font-mono font-normal text-gray-400">{unitView(s, patient).value(sLast.value)}</span>}
                </button>
              )
            })}
            <button type="button" disabled={!!error || saving.busy} onClick={() => moveOn(() => onLogGroup(group.id))}
              className="rounded-full bg-teal-700 px-3 py-1 text-[11px] font-bold text-white transition-transform active:scale-95 disabled:opacity-50">
              Log the group together
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}

/* ─── Every tracked vital, grouped; or just one group ─── */
export function LogAllSheet({ onClose, onSaved, groupId }: {
  onClose: () => void
  /** Only this group's vitals (see VITAL_GROUPS). Leave out for everything the patient tracks. */
  groupId?: string
  /** Called once the readings are stored, with how many were saved. */
  onSaved?: (count: number) => void
}) {
  const { currentUser, vitalDefs, logReading } = useApp()
  const patient = currentUser as PatientUser
  const only = VITAL_GROUPS.find(g => g.id === groupId)
  const tracked = vitalDefs.filter(v => v.active && patient.trackedVitalIds.includes(v.id) && (!only || groupOf(v.id) === only.id))
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  if (result) return <ResultSheet result={result} onClose={onClose} />

  const groups = VITAL_GROUPS
    .map(g => ({ ...g, vitals: tracked.filter(v => groupOf(v.id) === g.id) }))
    .filter(g => g.vitals.length > 0)
  // First group is open by default so the sheet is never a wall of closed rows.
  const activeGroup = openGroup ?? groups[0]?.id ?? null
  const entered = tracked.filter(v => values[v.id]?.trim())
  const filled = entered.length
  const hasErrors = Object.keys(errors).length > 0

  const save = async () => {
    if (busy) return
    const errs: Record<string, string> = {}
    entered.forEach(d => { const u = unitView(d, patient); const e = validateReading(d, u.toCanonical(values[d.id]), u.unit); if (e) errs[d.id] = e })
    setErrors(errs)
    if (Object.keys(errs).length) {
      // Open the first group holding a mistake so it can't hide in a closed row.
      setOpenGroup(groups.find(g => g.vitals.some(v => errs[v.id]))?.id ?? null)
      return
    }
    // One reading at a time, so each is graded against the one before it. A reading that was saved leaves the form;
    // one that was refused stays, with the reason, and nothing is lost.
    setBusy(true); setFailure('')
    let worst: Result | null = null
    let savedCount = 0
    const refusedBy: Record<string, string> = {}
    for (const d of entered) {
      const u = unitView(d, patient)
      const value = u.toCanonical(values[d.id])
      const saved = await logReading(patient.id, { id: `rd_${Date.now()}_${d.id}`, vitalId: d.id, value, loggedAt: '' })
      if (!saved.ok) { refusedBy[d.id] = saved.error; continue }
      savedCount++
      setValues(prev => { const n = { ...prev }; delete n[d.id]; return n })
      const res = saved.value
      if (res.level === 'critical' || (res.level === 'warning' && !worst)) worst = { ...res, name: d.name, value: `${u.value(value)} ${u.unit}` }
    }
    setBusy(false)
    if (savedCount) onSaved?.(savedCount)
    const refusedCount = Object.keys(refusedBy).length
    if (refusedCount) {
      setErrors(refusedBy)
      setOpenGroup(groups.find(g => g.vitals.some(v => refusedBy[v.id]))?.id ?? null)
      setFailure(savedCount ? `${savedCount} saved. ${refusedCount} could not be saved: see below.` : 'Nothing was saved. Check the readings below and try again.')
      return
    }
    if (worst) setResult(worst)
    else onClose()
  }

  return (
    <BottomSheet open onClose={onClose} title={only ? `${only.icon} Log ${only.label}` : '🩺 Log Your Vitals'}
      subtitle={only ? `${only.hint}. Empty fields are skipped.` : 'Fill what you have — empty fields are skipped.'}
      footer={<><SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton>
        <SheetButton disabled={filled === 0 || busy} onClick={save}>
          {busy ? 'Saving…' : hasErrors ? 'Fix errors to save' : filled > 0 ? `Save ${filled} reading${filled > 1 ? 's' : ''}` : 'Save Readings'}
        </SheetButton></>}>
      {tracked.length === 0 && <p className="text-xs text-gray-400">You aren't tracking any vitals yet.</p>}
      <SaveError message={failure} className="mb-3" />

      {/* progress */}
      {tracked.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <div className="h-1 flex-1 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-teal-600 transition-all duration-300" style={{ width: `${(filled / tracked.length) * 100}%` }} />
          </div>
          <p className="text-[10px] font-bold text-teal-700 font-mono">{filled}/{tracked.length} entered</p>
        </div>
      )}

      {/* group accordion */}
      <div className="flex flex-col gap-2">
        {groups.map(g => {
          const isOpen = activeGroup === g.id
          const done = g.vitals.filter(v => values[v.id]?.trim()).length
          const groupHasError = g.vitals.some(v => errors[v.id])
          return (
            <div key={g.id} className={`rounded-2xl border overflow-hidden transition-colors ${
              groupHasError ? 'border-red-200' : isOpen ? 'border-teal-200' : 'border-gray-100'
            }`}>
              <button onClick={() => setOpenGroup(isOpen ? '' : g.id)} aria-expanded={isOpen}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left ${isOpen ? 'bg-teal-50/60' : 'bg-gray-50'}`}>
                <span className="text-base">{g.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-800">{g.label}</p>
                  <p className="text-[9px] text-gray-400 truncate">{isOpen ? g.hint : `${g.vitals.length} vital${g.vitals.length > 1 ? 's' : ''}`}</p>
                </div>
                {done > 0 && (
                  <span className="text-[9px] font-bold text-teal-700 bg-teal-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                    {done}/{g.vitals.length}
                  </span>
                )}
                <span className={`text-[10px] text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
              </button>

              {isOpen && (
                <div className="flex flex-col divide-y divide-gray-50 bg-white">
                  {g.vitals.map(v => {
                    const raw = values[v.id] ?? ''
                    const err = errors[v.id]
                    const u = unitView(v, patient)
                    const canon = u.toCanonical(raw)
                    const lvl = raw.trim() && !err && !validateReading(v, canon) ? evaluate(patient, v, canon) : null
                    const range = u.range(targetRange(patient, v))
                    const last = latestValid(patient, v.id)
                    return (
                      <div key={v.id} className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center text-base flex-shrink-0">{v.icon}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold text-gray-800 truncate">{v.name}</p>
                            <p className="text-[9px] text-gray-400">
                              Target {range.min}–{range.max}
                              {last && ` · last ${u.value(last.value)}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <input type="text" inputMode={v.id === 'bp' ? 'text' : 'decimal'} value={raw}
                              onChange={e => {
                                setValues(prev => ({ ...prev, [v.id]: e.target.value }))
                                setErrors(prev => { if (!prev[v.id]) return prev; const n = { ...prev }; delete n[v.id]; return n })
                              }}
                              placeholder={v.id === 'bp' ? '120/80' : '—'}
                              aria-label={`${v.name} in ${u.unit}`}
                              className={`w-18 text-right text-sm font-bold bg-white border rounded-xl px-2 py-1.5 outline-none transition-colors ${
                                err || lvl === 'critical' ? 'border-red-300 text-red-600'
                                : lvl === 'warning' ? 'border-amber-300 text-amber-600'
                                : lvl === 'normal' ? 'border-emerald-300 text-emerald-700'
                                : 'border-gray-200 focus:border-teal-400'
                              } font-mono`} />
                            <span className="text-[9px] text-gray-400 w-9 text-left leading-tight">{u.unit}</span>
                          </div>
                        </div>
                        {err && <p className="text-[10px] text-red-500 mt-1.5 pl-10.5">{err}</p>}
                        {!err && lvl && lvl !== 'normal' && (
                          <p className={`text-[10px] mt-1.5 pl-10.5 font-semibold ${levelStyle(lvl).value}`}>
                            {lvl === 'critical'
                              ? '⚠ Critical — your doctor is alerted as soon as you save'
                              : '▲ Outside target — you can re-measure to clear it'}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </BottomSheet>
  )
}

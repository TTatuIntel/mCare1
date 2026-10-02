import { useState } from 'react'
import { BottomSheet, SheetButton, Field, inputCls, Toggle, useSave, SaveError, useAct } from '@/shared'
import type { WorkBlock } from '@/shared/lib/types'
import { dayKey } from '@/shared/lib/vitals'
import { useDoctor } from './useDoctor'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ORDER = [1, 2, 3, 4, 5, 6, 0]   // the week as people read it, Monday first
const SLOTS = [10, 15, 20, 30, 45, 60]
const clock = (hm: string) => { const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const day = (iso: string) => new Date(`${iso}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

type DayForm = { on: boolean; start: string; end: string; split: boolean; start2: string; end2: string }
const toForm = (hours: WorkBlock[]): Record<number, DayForm> => Object.fromEntries(DAYS.map((_, d) => {
  const [a, b] = hours.filter(h => h.weekday === d)
  return [d, { on: !!a, start: a?.start ?? '09:00', end: a?.end ?? '17:00', split: !!b, start2: b?.start ?? '14:00', end2: b?.end ?? '17:00' }]
}))

/* ─── When the doctor sees patients ───────────────────────────────────
   The working week, how long a visit lasts, and days away. Patients are
   then offered only the open times, and the database refuses a request
   outside them. With no hours set, a visit can be asked for at any time. */
export function AvailabilityCard() {
  const { doctor, timeOff, setHours, addTimeOff, removeTimeOff } = useDoctor()
  const hours = doctor.hours ?? []
  const act = useAct()

  const [form, setForm] = useState<Record<number, DayForm> | null>(null)
  const [slot, setSlot] = useState(doctor.slotMinutes ?? 30)
  const save = useSave()
  const blocks = (f: Record<number, DayForm>): WorkBlock[] => DAYS.flatMap((_, d) => !f[d].on ? [] : [
    { weekday: d, start: f[d].start, end: f[d].end }, ...(f[d].split ? [{ weekday: d, start: f[d].start2, end: f[d].end2 }] : []),
  ])
  const issue = form && (() => {
    for (const d of ORDER) {
      const x = form[d]
      if (!x.on) continue
      if (x.start >= x.end || (x.split && x.start2 >= x.end2)) return `${DAYS[d]}: each block needs a start and a later end.`
      if (x.split && x.start2 < x.end) return `${DAYS[d]}: the second block must start after the first ends.`
    }
    return null
  })()
  const submit = async () => {
    if (!form || issue) return
    if (!(await save.run(() => setHours(blocks(form), slot))).ok) return
    setForm(null)
    act.say(blocks(form).length ? 'Working hours saved · patients see the open times' : 'Working hours cleared · visits can be asked for at any time')
  }

  const [away, setAway] = useState<{ from: string; to: string; reason: string } | null>(null)
  const awaySave = useSave()
  const saveAway = async () => {
    if (!away || !away.from || away.to < away.from) return
    if (!(await awaySave.run(() => addTimeOff(away.from, away.to, away.reason))).ok) return
    setAway(null)
    act.say('Days away saved · no visits can be requested on them')
  }
  const today = dayKey()
  const upcoming = timeOff.filter(o => o.to >= today)

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Availability</p>
        <button onClick={() => { save.clear(); setSlot(doctor.slotMinutes ?? 30); setForm(toForm(hours)) }} className="text-[10px] font-bold text-teal-700">{hours.length ? 'Edit hours' : 'Set hours'}</button>
      </div>
      {act.node && <div className="mb-2">{act.node}</div>}
      {hours.length === 0 ? (
        <p className="text-xs text-gray-500">No working hours set. Patients can ask for a visit at any time, and you answer each request.</p>
      ) : (
        <>
          {ORDER.filter(d => hours.some(h => h.weekday === d)).map(d => (
            <div key={d} className="flex justify-between py-1 text-xs">
              <span className="text-gray-700 font-semibold">{DAYS[d]}</span>
              <span className="text-gray-600 font-mono">{hours.filter(h => h.weekday === d).map(h => `${clock(h.start)} – ${clock(h.end)}`).join(', ')}</span>
            </div>
          ))}
          <p className="text-[10px] text-gray-400 mt-1">Visits of {doctor.slotMinutes ?? 30} minutes.</p>
        </>
      )}

      <div className="border-t border-gray-100 mt-3 pt-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-bold text-gray-900">Days away</p>
          <button onClick={() => { awaySave.clear(); setAway({ from: today, to: today, reason: '' }) }} className="text-[10px] font-bold text-teal-700">+ Add</button>
        </div>
        {upcoming.length === 0 && <p className="text-xs text-gray-400">None planned.</p>}
        {upcoming.map(o => (
          <div key={o.id} className="flex items-center justify-between gap-2 py-1">
            <p className="text-xs text-gray-700 min-w-0 truncate">{o.from === o.to ? day(o.from) : `${day(o.from)} – ${day(o.to)}`}{o.reason ? <span className="text-gray-400"> · {o.reason}</span> : null}</p>
            <button disabled={act.busy} onClick={() => act.run(() => removeTimeOff(o.id), 'Days away removed')} className="text-[10px] font-bold text-red-600 flex-shrink-0 disabled:opacity-50">Remove</button>
          </div>
        ))}
      </div>

      <BottomSheet open={!!form} onClose={() => setForm(null)} title="Working hours"
        subtitle="Switch on the days you see patients. Add a second block to leave a break."
        footer={<><SheetButton tone="ghost" onClick={() => setForm(null)}>Cancel</SheetButton>
          <SheetButton disabled={!!issue || save.busy} onClick={submit}>{save.busy ? 'Saving…' : 'Save hours'}</SheetButton></>}>
        {form && (
          <>
            {ORDER.map(d => {
              const x = form[d]
              const set = (patch: Partial<DayForm>) => setForm({ ...form, [d]: { ...x, ...patch } })
              return (
                <div key={d} className="py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-900">{DAYS[d]}</p>
                    <Toggle on={x.on} label={`See patients on ${DAYS[d]}`} onChange={() => set({ on: !x.on })} />
                  </div>
                  {x.on && (
                    <div className="mt-2 flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input type="time" value={x.start} onChange={e => set({ start: e.target.value })} className={inputCls} aria-label={`${DAYS[d]} from`} />
                        <input type="time" value={x.end} onChange={e => set({ end: e.target.value })} className={inputCls} aria-label={`${DAYS[d]} until`} />
                      </div>
                      {x.split && (
                        <div className="grid grid-cols-2 gap-2">
                          <input type="time" value={x.start2} onChange={e => set({ start2: e.target.value })} className={inputCls} aria-label={`${DAYS[d]} second block from`} />
                          <input type="time" value={x.end2} onChange={e => set({ end2: e.target.value })} className={inputCls} aria-label={`${DAYS[d]} second block until`} />
                        </div>
                      )}
                      <button onClick={() => set({ split: !x.split })} className="self-start text-[11px] font-bold text-teal-700">{x.split ? 'Remove the second block' : '+ Add a break (second block)'}</button>
                    </div>
                  )}
                </div>
              )
            })}
            <Field label="A visit lasts">
              <select value={slot} onChange={e => setSlot(Number(e.target.value))} className={inputCls} aria-label="Visit length">
                {SLOTS.map(m => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </Field>
            {issue && <p className="text-xs text-red-500 mb-2">{issue}</p>}
            <SaveError message={save.error} />
          </>
        )}
      </BottomSheet>

      <BottomSheet open={!!away} onClose={() => setAway(null)} title="Days away" subtitle="No visit can be requested on these days. Visits already confirmed stay as they are: move or cancel them yourself."
        footer={<><SheetButton tone="ghost" onClick={() => setAway(null)}>Cancel</SheetButton>
          <SheetButton disabled={!away?.from || (away?.to ?? '') < (away?.from ?? '') || awaySave.busy} onClick={saveAway}>{awaySave.busy ? 'Saving…' : 'Save'}</SheetButton></>}>
        {away && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="First day *"><input type="date" min={today} value={away.from} onChange={e => setAway({ ...away, from: e.target.value, to: away.to < e.target.value ? e.target.value : away.to })} className={inputCls} /></Field>
              <Field label="Last day *"><input type="date" min={away.from} value={away.to} onChange={e => setAway({ ...away, to: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="Reason (seen by you and mCare staff only)"><input value={away.reason} maxLength={200} onChange={e => setAway({ ...away, reason: e.target.value })} placeholder="e.g. Leave" className={inputCls} /></Field>
            <SaveError message={awaySave.error} />
          </>
        )}
      </BottomSheet>
    </div>
  )
}

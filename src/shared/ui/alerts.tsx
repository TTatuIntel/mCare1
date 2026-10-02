import { useState, useEffect } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { RESOLUTION_REASONS } from '@/shared/lib/types'
import type { AppAlert } from '@/shared/lib/types'
import { dayKey } from '@/shared/lib/vitals'
import { Pill } from './primitives'
import { BottomSheet, SheetButton, Field, inputCls, SaveError, useSave } from './BottomSheet'

/* ─── Alert status pill ─── */
export function AlertStatusPill({ alert }: { alert: AppAlert }) {
  const map = {
    open: { c: alert.severity === 'danger' ? 'red' : 'amber', l: alert.type === 'sos' ? 'SOS' : alert.severity === 'danger' ? 'Critical' : 'Warning' },
    acknowledged: { c: 'blue', l: 'Reviewing' },
    escalated: { c: 'purple', l: 'Escalated' },
    resolved: { c: 'green', l: 'Resolved' },
  } as const
  const s = map[alert.status]
  return <Pill color={s.c}>{s.l}</Pill>
}

/* ─── Resolve alert sheet: reason is required ─── */
export function ResolveAlertSheet({ alert, patientName, onClose }: { alert: AppAlert | null; patientName?: string; onClose: () => void }) {
  const { resolveAlert, requestRecheck, scheduleFollowUp, currentUser } = useApp()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [recheckSent, setRecheckSent] = useState(false)
  const save = useSave()
  useEffect(() => { setReason(''); setNote(''); setScheduling(false); setDate(''); setTime(''); setRecheckSent(false); save.clear() }, [alert?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!alert) return null
  const needsNote = reason === 'Other'
  const ok = !!reason && (!needsNote || note.trim().length > 0)
  const submit = async () => { if (ok && (await save.run(() => resolveAlert(alert.id, reason, note))).ok) onClose() }
  const doctorId = currentUser?.role === 'doctor' ? currentUser.id : undefined
  const confirmSchedule = async () => {
    if (!doctorId || !date || !time) return
    if ((await save.run(() => scheduleFollowUp(alert.patientId, doctorId, date, time, note, alert.id))).ok) onClose()
  }
  const sendRecheck = async () => { if ((await save.run(() => requestRecheck(alert.id))).ok) setRecheckSent(true) }
  const critical = alert.severity === 'danger'

  return (
    <BottomSheet open onClose={onClose} title="Resolve Alert"
      subtitle="Choose a reason, or handle it a different way below. The alert stays in the patient's history either way."
      footer={<><SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton><SheetButton tone="success" disabled={!ok || save.busy} onClick={submit}>{save.busy ? 'Saving…' : 'Mark Resolved'}</SheetButton></>}>
      <div className={`rounded-xl px-3 py-2.5 mb-4 ${alert.severity === 'danger' ? 'bg-red-50' : 'bg-amber-50'}`}>
        <p className="text-sm font-bold text-gray-900">{alert.type === 'sos' ? `SOS · ${alert.value}` : `${alert.vitalName}: ${alert.value} ${alert.unit}`}</p>
        <p className="text-[10px] text-gray-500">{patientName} · {alert.loggedAt}</p>
      </div>

      <Field label="Resolution reason *">
        <select value={reason} onChange={e => setReason(e.target.value)} className={inputCls}>
          <option value="" disabled>Choose a reason…</option>
          {RESOLUTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      <Field label={needsNote ? 'Note *' : 'Note (optional)'}>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
          placeholder="e.g. Spoke to patient; advised rest and re-check in 2 hours."
          className={`${inputCls} resize-none`} />
      </Field>

      <div className="border-t border-gray-100 mt-1 pt-3 flex flex-col gap-2">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Or handle it another way</p>

        <button onClick={sendRecheck} disabled={recheckSent || !!alert.recheckRequestedAt}
          className={`text-left px-3 py-2.5 rounded-xl text-xs font-semibold border-2 ${recheckSent || alert.recheckRequestedAt ? 'border-gray-100 bg-gray-50 text-gray-400' : 'border-blue-100 bg-blue-50 text-blue-700'}`}>
          🔁 {recheckSent || alert.recheckRequestedAt ? 'Re-check requested — waiting for a new reading' : 'Ask patient to record a new reading'}
          <span className="block text-[10px] font-normal mt-0.5 opacity-80">{critical
            ? 'A critical alert is not closed by a number alone: the new reading comes back to you to resolve.'
            : 'A warning closes by itself if the new reading is back in range.'}</span>
        </button>

        {!scheduling ? (
          <button onClick={() => setScheduling(true)}
            className="text-left px-3 py-2.5 rounded-xl text-xs font-semibold border-2 border-teal-100 bg-teal-50 text-teal-800">
            📅 Schedule a follow-up appointment
          </button>
        ) : (
          <div className="border-2 border-teal-100 bg-teal-50 rounded-xl p-3">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <Field label="Date *"><input type="date" min={dayKey()} value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
              <Field label="Time *"><input type="time" value={time} onChange={e => setTime(e.target.value)} className={inputCls} /></Field>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setScheduling(false)} className="flex-1 py-2 bg-white text-gray-600 text-[11px] font-bold rounded-xl border border-gray-200">Cancel</button>
              <button onClick={confirmSchedule} disabled={!date || !time}
                className={`flex-1 py-2 text-[11px] font-bold rounded-xl ${date && time ? 'bg-teal-700 text-white' : 'bg-gray-200 text-gray-400'}`}>
                Confirm & Resolve
              </button>
            </div>
          </div>
        )}
        <SaveError message={save.error} />
      </div>
    </BottomSheet>
  )
}

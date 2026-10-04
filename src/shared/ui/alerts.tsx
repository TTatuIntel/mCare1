import { useState, useEffect } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { RESOLUTION_REASONS, FOLLOW_UP_REASON, REMEASURED_REASON, ALERT_COMMENT_KINDS } from '@/shared/lib/types'
import type { AppAlert, AlertCommentKind, PatientUser } from '@/shared/lib/types'
import { dayKey, ago, alertStory, alertRemeasures, evaluate, LEVEL_WORD, type AlertStep } from '@/shared/lib/vitals'
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

/* ─── The story of one alert: the reading, each re-measurement, what the care team did, how it ended ─── */
const STEP_DOT: Record<AlertStep['kind'], string> = {
  raised: 'bg-amber-500', acknowledged: 'bg-blue-500', escalated: 'bg-purple-500', requested: 'bg-blue-500',
  remeasure: 'bg-gray-400', comment: 'bg-blue-500', resolved: 'bg-emerald-500',
}
const stepDot = (s: AlertStep) =>
  s.level === 'critical' ? 'bg-red-500' : s.level === 'warning' ? 'bg-amber-500' : s.level === 'normal' ? 'bg-emerald-500' : STEP_DOT[s.kind]

export function AlertTimeline({ alert, className = '' }: { alert: AppAlert; className?: string }) {
  const { users, vitalDefs, currentUser } = useApp()
  const patient = users.find(u => u.id === alert.patientId && u.role === 'patient') as PatientUser | undefined
  const def = vitalDefs.find(d => (alert.vitalId ? d.id === alert.vitalId : d.name === alert.vitalName))
  const who = (id?: string) => (!id ? undefined : id === currentUser?.id ? 'You' : users.find(u => u.id === id)?.name)
  const steps = alertStory(alert, patient, def)
  return (
    <ol className={`flex flex-col ${className}`}>
      {steps.map((s, i) => (
        <li key={i} className="relative flex gap-2.5 pb-2.5 last:pb-0">
          {i < steps.length - 1 && <span aria-hidden="true" className="absolute left-[0.3125rem] top-3 bottom-0 w-px bg-gray-200" />}
          <span aria-hidden="true" className={`relative mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${stepDot(s)}`} />
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-semibold leading-snug ${s.kind === 'resolved' ? 'text-emerald-700' : 'text-gray-900'}`}>{s.title}</p>
            {s.detail && <p className="text-[11px] text-gray-600 leading-snug">{s.detail}</p>}
            <p className="text-[10px] text-gray-400">{[who(s.by), s.when].filter(Boolean).join(' · ')}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ─── Resolve alert sheet: reason is required; "Appointment scheduled" also requires the appointment ─── */
export function ResolveAlertSheet({ alert: opened, patientName, onClose }: { alert: AppAlert | null; patientName?: string; onClose: () => void }) {
  const { alerts, users, vitalDefs, now, resolveAlert, requestRecheck, addAlertComment, scheduleFollowUp, currentUser } = useApp()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [kind, setKind] = useState<AlertCommentKind>('comment')
  const [comment, setComment] = useState('')
  const save = useSave()
  const ask = useSave()
  const post = useSave()
  useEffect(() => { setReason(''); setNote(''); setDate(''); setTime(''); setComment(''); setKind('comment'); save.clear(); ask.clear(); post.clear() }, [opened?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!opened) return null
  // The alert as it stands now: a re-measurement or a comment may arrive while the sheet is open.
  const alert = alerts.find(a => a.id === opened.id) ?? opened
  const patient = users.find(u => u.id === alert.patientId && u.role === 'patient') as PatientUser | undefined
  const def = vitalDefs.find(d => (alert.vitalId ? d.id === alert.vitalId : d.name === alert.vitalName))
  // Only the treating doctor books a visit, so only a doctor is offered that reason.
  const doctorId = currentUser?.role === 'doctor' ? currentUser.id : undefined
  const reasons = RESOLUTION_REASONS.filter(r => r !== FOLLOW_UP_REASON || doctorId)
  const booking = reason === FOLLOW_UP_REASON
  const needsNote = reason === 'Other'
  const today = dayKey()
  const closed = alert.status === 'resolved'
  const ok = !closed && !!reason && (!needsNote || note.trim().length > 0) && (!booking || (!!doctorId && !!time && date >= today))
  const submit = async () => {
    if (!ok) return
    // Booking and resolving are one request: both happen, or neither.
    const saved = await save.run(() => booking && doctorId
      ? scheduleFollowUp(alert.patientId, doctorId, date, time, note, alert.id)
      : resolveAlert(alert.id, reason, note))
    if (saved.ok) onClose()
  }
  const sendComment = async () => {
    if (!comment.trim()) return
    if ((await post.run(() => addAlertComment(alert.id, kind, comment, post.ref))).ok) setComment('')
  }
  const askAgain = () => ask.run(() => requestRecheck(alert.id))
  const critical = alert.severity === 'danger'

  // Where the re-measurement stands: not asked, waiting, or in.
  const remeasures = alertRemeasures(alert, patient).filter(r => !r.invalid)
  const last = remeasures[remeasures.length - 1]
  const lastLevel = last && patient && def ? evaluate(patient, def, last.value) : undefined
  const requested = alert.recheckRequestedAt
  const answered = !!last && (!requested || (last.at ?? 0) >= requested)
  const useReading = () => {
    if (!last) return
    setReason(REMEASURED_REASON)
    setNote(`Re-measured ${last.value} ${def?.unit ?? alert.unit} · ${last.loggedAt}`)
    save.clear()
  }

  return (
    <BottomSheet open onClose={onClose} title={closed ? 'Alert resolved' : 'Resolve Alert'}
      subtitle={closed ? 'This alert has been closed. Its history is kept.' : "Choose a reason. The alert stays in the patient's history."}
      footer={closed
        ? <SheetButton onClick={onClose}>Done</SheetButton>
        : <><SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton><SheetButton tone="success" disabled={!ok || save.busy} onClick={submit}>{save.busy ? 'Saving…' : booking ? 'Book & Resolve' : 'Mark Resolved'}</SheetButton></>}>
      <div className={`rounded-xl px-3 py-2.5 mb-4 ${alert.severity === 'danger' ? 'bg-red-50' : 'bg-amber-50'}`}>
        <p className="text-sm font-bold text-gray-900">{alert.type === 'sos' ? `SOS · ${alert.value}` : `${alert.vitalName}: ${alert.value} ${alert.unit}`}</p>
        <p className="text-[10px] text-gray-500">{patientName} · {alert.loggedAt}</p>
      </div>

      {!closed && (
        <>
          <Field label="Resolution reason *">
            <select value={reason} onChange={e => { setReason(e.target.value); save.clear() }} className={inputCls}>
              <option value="" disabled>Choose a reason…</option>
              {reasons.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>

          {booking && (
            <div className="border-2 border-teal-100 bg-teal-50 rounded-xl px-3 pt-3 mb-3">
              <p className="text-xs font-bold text-teal-800">Follow-up appointment</p>
              <p className="text-[10px] text-teal-800 opacity-80 mt-0.5 mb-2">Required for this reason. The visit is booked and {patientName ?? 'the patient'} is told when you resolve.</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Date *"><input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
                <Field label="Time *"><input type="time" value={time} onChange={e => setTime(e.target.value)} className={inputCls} /></Field>
              </div>
            </div>
          )}

          {/* once a reason is chosen: what was found or done, kept with the alert and printed on reports */}
          {reason && (
            <Field label={needsNote ? 'Note *' : booking ? 'Reason for the visit (optional)' : 'Resolution comment (optional)'}>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                placeholder={booking ? 'e.g. Review glucose control and adjust medication.' : 'e.g. Spoke to patient; advised rest and re-check in 2 hours.'}
                className={`${inputCls} resize-none`} />
            </Field>
          )}
          <SaveError message={save.error} />
        </>
      )}

      {/* ── Re-measurement: ask for it, see it arrive, resolve with it ── */}
      {alert.type === 'vital' && !closed && (
        <div className="border-t border-gray-100 mt-1 pt-3 flex flex-col gap-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Re-measurement</p>

          {answered && last ? (
            <div className={`rounded-xl border-2 px-3 py-2.5 ${lastLevel === 'normal' ? 'border-emerald-100 bg-emerald-50' : lastLevel === 'critical' ? 'border-red-100 bg-red-50' : 'border-amber-100 bg-amber-50'}`}>
              <p className="text-xs font-bold text-gray-900">
                New reading <span className="font-mono">{last.value}</span> {def?.unit ?? alert.unit}
                {lastLevel && <span className={lastLevel === 'normal' ? 'text-emerald-700' : lastLevel === 'critical' ? 'text-red-700' : 'text-amber-700'}> · {LEVEL_WORD[lastLevel]}</span>}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                {last.at ? ago(last.at, now) : last.loggedAt} · <span className="font-mono">{remeasures.length}</span> re-measurement{remeasures.length === 1 ? '' : 's'} since the alert
              </p>
              <p className="text-[11px] text-gray-700 mt-1 leading-snug">{lastLevel === 'normal'
                ? 'A critical alert is not closed by a number alone: confirm it to close the alert.'
                : 'Still outside the target. The alert stays open and the patient has been told to contact you.'}</p>
              <div className="flex gap-2 mt-2">
                {lastLevel === 'normal' && (
                  <button onClick={useReading} className="flex-1 rounded-full bg-teal-700 py-2 text-xs font-bold text-white active:scale-[.98] transition-transform">Resolve with this reading</button>
                )}
                <button onClick={askAgain} disabled={ask.busy}
                  className="flex-1 rounded-full border border-gray-200 bg-white py-2 text-xs font-bold text-gray-700 active:scale-[.98] transition-transform disabled:opacity-60">
                  {ask.busy ? 'Asking…' : 'Ask for another reading'}
                </button>
              </div>
            </div>
          ) : requested ? (
            <div className="rounded-xl border-2 border-blue-100 bg-blue-50 px-3 py-2.5">
              <p className="text-xs font-bold text-blue-800">Waiting for a new reading</p>
              <p className="text-[10px] text-blue-800 opacity-80 mt-0.5 leading-snug">
                Asked {ago(requested, now).toLowerCase()}. {patientName ?? 'The patient'} sees a Re-measure button on this alert. {critical
                  ? 'The new reading comes back to you to resolve.'
                  : 'The alert closes by itself if the new reading is back in range.'}
              </p>
              <button onClick={askAgain} disabled={ask.busy}
                className="mt-2 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-[11px] font-bold text-blue-700 active:scale-[.98] transition-transform disabled:opacity-60">
                {ask.busy ? 'Sending…' : 'Remind the patient'}
              </button>
            </div>
          ) : (
            <button onClick={askAgain} disabled={ask.busy}
              className="text-left px-3 py-2.5 rounded-xl text-xs font-semibold border-2 border-blue-100 bg-blue-50 text-blue-700 disabled:opacity-60">
              {ask.busy ? 'Asking…' : 'Ask patient to record a new reading'}
              <span className="block text-[10px] font-normal mt-0.5 opacity-80">{critical
                ? 'A critical alert is not closed by a number alone: the new reading comes back to you to resolve.'
                : 'A warning closes by itself if the new reading is back in range.'}</span>
            </button>
          )}
          <SaveError message={ask.error} />
        </div>
      )}

      {/* ── Comment without resolving ── */}
      {!closed && (
        <div className="border-t border-gray-100 mt-3 pt-3">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Add to the record without resolving</p>
          <div className="flex gap-1.5 mb-2 flex-wrap" role="group" aria-label="Kind of entry">
            {ALERT_COMMENT_KINDS.map(k => (
              <button key={k.id} onClick={() => setKind(k.id)} aria-pressed={kind === k.id}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${kind === k.id ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-gray-600 border-gray-200'}`}>
                {k.label}
              </button>
            ))}
          </div>
          <textarea value={comment} onChange={e => { setComment(e.target.value); post.clear() }} rows={2} maxLength={1000}
            placeholder={kind === 'instruction' ? 'e.g. Take your evening dose now and measure again at 8 pm.' : kind === 'action' ? 'e.g. Called the patient; no symptoms reported.' : 'e.g. Likely post-meal rise; watching the next reading.'}
            className={`${inputCls} resize-none`} />
          <div className="flex items-center gap-2 mt-2">
            <p className="flex-1 text-[10px] text-gray-400 leading-snug">The patient can read this. It is kept with the alert and shown on reports.</p>
            <button onClick={sendComment} disabled={!comment.trim() || post.busy}
              className="flex-shrink-0 rounded-full bg-teal-700 px-3.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-40 active:scale-[.98] transition-transform">
              {post.busy ? 'Saving…' : 'Add'}
            </button>
          </div>
          <SaveError message={post.error} className="mt-2" />
        </div>
      )}

      <div className="border-t border-gray-100 mt-3 pt-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">History of this alert</p>
        <AlertTimeline alert={alert} />
      </div>
    </BottomSheet>
  )
}

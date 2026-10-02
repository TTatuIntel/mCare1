import { useState } from 'react'
import { AlertStatusPill, BottomSheet, SheetButton, SaveError, useSave } from '@/shared'
import type { AppAlert } from '@/shared/lib/types'
import { ago, ESCALATE_AFTER_MIN } from '@/shared/lib/vitals'
import { useDoctor } from './useDoctor'

/* ─── Alert card (acknowledge / resolve / escalate) ─────────────────── */
export function AlertCard({ a, patientName, onResolve, compact }: { a: AppAlert; patientName?: string; onResolve: (a: AppAlert) => void; compact?: boolean }) {
  const { acknowledgeAlert, escalateAlert, nameOf, now } = useDoctor()
  const save = useSave()
  const [confirming, setConfirming] = useState(false)
  const danger = a.severity === 'danger'
  const minsLeft = Math.max(0, ESCALATE_AFTER_MIN - Math.floor(Math.max(0, Math.max(now, Date.now()) - a.at) / 60000))
  const what = a.type === 'sos' ? 'SOS' : `${a.vitalName} ${a.value} ${a.unit}`
  const escalate = async () => { if ((await save.run(() => escalateAlert(a.id))).ok) setConfirming(false) }
  return (
    <div className={`rounded-2xl p-3.5 border ${danger ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {patientName && <p className="text-sm font-bold text-gray-900">{patientName}</p>}
          <p className={`${compact ? 'text-sm' : 'text-base'} font-black ${danger ? 'text-red-600' : 'text-amber-600'} font-mono`}>
            {a.type === 'sos' ? `🚨 SOS · ${a.value}` : `${a.vitalName}: ${a.value} ${a.unit}`}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {ago(a.at, now)}
            {a.status === 'open' && danger && <span className="text-red-600 font-semibold"> · escalates in {minsLeft} min</span>}
            {a.status === 'acknowledged' && <span> · {nameOf(a.acknowledgedBy, 'the care team')} is reviewing</span>}
            {a.status === 'escalated' && <span className="text-purple-700 font-semibold"> · escalated to admin</span>}
            {a.recheckRequestedAt && <span className="text-blue-600 font-semibold"> · 🔁 re-check requested</span>}
          </p>
        </div>
        <AlertStatusPill alert={a} />
      </div>
      <div className="flex gap-2 mt-3">
        {a.status === 'open' && (
          <button disabled={save.busy} onClick={() => save.run(() => acknowledgeAlert(a.id))}
            className="flex-1 py-2 bg-white text-gray-700 text-[11px] font-bold rounded-xl border border-gray-200 disabled:opacity-50">👁 {save.busy ? 'Saving…' : 'Acknowledge'}</button>
        )}
        <button onClick={() => onResolve(a)} className="flex-1 py-2 bg-teal-700 text-white text-[11px] font-bold rounded-xl">✓ Resolve</button>
        {a.status !== 'escalated' && (
          <button onClick={() => { save.clear(); setConfirming(true) }} className="py-2 px-3 bg-white text-purple-700 text-[11px] font-bold rounded-xl border border-purple-100" aria-label="Escalate to admin">⏫</button>
        )}
      </div>
      {!confirming && <SaveError message={save.error} className="mt-2" />}

      <BottomSheet open={confirming} onClose={() => setConfirming(false)} title="Escalate this alert?"
        subtitle={`${patientName ? `${patientName} · ` : ''}${what}`}
        footer={<><SheetButton tone="ghost" onClick={() => setConfirming(false)}>Cancel</SheetButton>
          <SheetButton disabled={save.busy} onClick={escalate}>{save.busy ? 'Escalating…' : 'Escalate'}</SheetButton></>}>
        <p className="text-xs text-gray-600 leading-relaxed">The admin team and the assistants who monitor patients are told now. The alert stays yours to resolve.</p>
        <SaveError message={save.error} className="mt-3" />
      </BottomSheet>
    </div>
  )
}

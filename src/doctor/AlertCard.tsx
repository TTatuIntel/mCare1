import { useApp } from '@/shared/state/AppContext'
import { AlertStatusPill } from '@/shared'
import type { AppAlert } from '@/shared/lib/types'
import { ago, ESCALATE_AFTER_MIN } from '@/shared/lib/vitals'

/* ─── Alert card (acknowledge / resolve / escalate) ─────────────────── */
export function AlertCard({ a, patientName, onResolve, compact }: { a: AppAlert; patientName?: string; onResolve: (a: AppAlert) => void; compact?: boolean }) {
  const { acknowledgeAlert, escalateAlert, now } = useApp()
  const danger = a.severity === 'danger'
  const minsLeft = Math.max(0, ESCALATE_AFTER_MIN - Math.floor(Math.max(0, Math.max(now, Date.now()) - a.at) / 60000))
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
            {a.status === 'acknowledged' && <span> · you are reviewing</span>}
            {a.status === 'escalated' && <span className="text-purple-700 font-semibold"> · escalated to admin</span>}
            {a.recheckRequestedAt && <span className="text-blue-600 font-semibold"> · 🔁 re-check requested</span>}
          </p>
        </div>
        <AlertStatusPill alert={a} />
      </div>
      <div className="flex gap-2 mt-3">
        {a.status === 'open' && (
          <button onClick={() => acknowledgeAlert(a.id)} className="flex-1 py-2 bg-white text-gray-700 text-[11px] font-bold rounded-xl border border-gray-200">👁 Acknowledge</button>
        )}
        <button onClick={() => onResolve(a)} className="flex-1 py-2 bg-emerald-600 text-white text-[11px] font-bold rounded-xl">✓ Resolve</button>
        {a.status !== 'escalated' && (
          <button onClick={() => escalateAlert(a.id)} className="py-2 px-3 bg-white text-purple-700 text-[11px] font-bold rounded-xl border border-purple-100" aria-label="Escalate to admin">⏫</button>
        )}
      </div>
    </div>
  )
}

import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import { Page, AlertStatusPill } from '@/shared'
import { usePatient } from './usePatient'
import type { AppAlert } from '@/shared/lib/types'
import { ago } from '@/shared/lib/vitals'

/* ─── My Alerts ─────────────────────────────────────────────────────── */
export function MyAlertsTab({ openVital }: { openVital: (vitalId: string) => void }) {
  const { alerts, now, resolveAlert, vitalDefs } = useApp()
  const { patient, nameOf, status, error, reload } = usePatient()
  /** The vital an alert is about: its stored id, else via its reading, else by name. */
  const vitalIdOf = (a: AppAlert) =>
    a.vitalId ?? patient.readings.find(r => r.id === a.readingId)?.vitalId ?? vitalDefs.find(d => d.name === a.vitalName)?.id
  const mine = alerts.filter(a => a.patientId === patient.id)
  const active = mine.filter(isActiveAlert)
  const past = mine.filter(a => a.status === 'resolved')
  return (
    <Page title="My Alerts" status={status} error={error} onRetry={reload}>
      {active.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 text-center">
          <p className="text-sm font-bold text-emerald-700">No active alerts</p>
          <p className="text-xs text-emerald-600 mt-1">Out-of-range readings are sent to your doctor automatically.</p>
        </div>
      )}
      {active.map(a => (
        <div key={a.id} className={`rounded-2xl p-4 border ${a.severity === 'danger' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
          <div className="flex justify-between items-start gap-2">
            <div>
              <p className="text-sm font-black text-gray-900">{a.type === 'sos' ? `🚨 SOS · ${a.value}` : `${a.vitalName}: ${a.value} ${a.unit}`}</p>
              <p className="text-[11px] text-gray-500">{ago(a.at, now)}</p>
            </div>
            <AlertStatusPill alert={a} />
          </div>
          <div className="flex items-center gap-1 mt-3">
            {['Sent', 'Reviewing', 'Resolved'].map((s, i) => {
              const step = a.status === 'acknowledged' || a.status === 'escalated' ? 1 : 0
              return (
                <div key={s} className="flex-1">
                  <div className={`h-1.5 rounded-full ${i <= step ? 'bg-teal-600' : 'bg-gray-200'}`} />
                  <p className={`text-[10px] mt-1 ${i <= step ? 'text-teal-700 font-semibold' : 'text-gray-400'}`}>{s}</p>
                </div>
              )
            })}
          </div>
          {a.type === 'vital' && vitalIdOf(a) && (
            <button onClick={() => openVital(vitalIdOf(a)!)} className="mt-3 w-full py-2 rounded-xl bg-white border border-gray-200 text-xs font-bold text-teal-700">
              {a.vitalName} history &amp; trend →
            </button>
          )}
          {a.type === 'sos' && (
            <button onClick={() => resolveAlert(a.id, 'Patient marked safe')} className="mt-3 w-full py-2 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-700">I'm safe now — cancel SOS</button>
          )}
        </div>
      ))}
      {past.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-900 mb-2">History</p>
          {past.map(a => (
            <div key={a.id} className="py-2 border-b border-gray-50 last:border-0">
              <p className="text-xs font-semibold text-gray-800">{a.type === 'sos' ? 'SOS' : `${a.vitalName}: ${a.value} ${a.unit}`}</p>
              <p className="text-[11px] text-emerald-700">✓ {a.resolutionReason}{a.resolutionNote ? ` — ${a.resolutionNote}` : ''}</p>
              <p className="text-[10px] text-gray-400">{nameOf(a.resolvedBy, 'You')} · {a.resolvedAt}</p>
            </div>
          ))}
        </div>
      )}
    </Page>
  )
}

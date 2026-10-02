import { useState } from 'react'
import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import { Page, AlertStatusPill, SaveError, useSave } from '@/shared'
import { usePatient } from './usePatient'
import type { AppAlert } from '@/shared/lib/types'
import { ago } from '@/shared/lib/vitals'
import { apptWhen } from '@/shared/lib/schedule'
import { useAlertView, SELF_CLEAR_NOTE } from './alertKit'

/** How many resolved alerts show before "Show all". */
const HISTORY_PREVIEW = 4

/* ─── Sent → Reviewing → Resolved ───────────────────────────────────── */
function Progress({ alert }: { alert: AppAlert }) {
  const step = alert.status === 'acknowledged' || alert.status === 'escalated' ? 1 : 0
  const steps = ['Sent', alert.status === 'escalated' ? 'Care team' : 'Reviewing', 'Resolved']
  return (
    <ol className="flex items-start" aria-label={`Step ${step + 1} of 3: ${steps[step]}`}>
      {steps.map((s, i) => {
        const done = i < step, here = i === step
        return (
          <li key={s} className="flex-1 flex flex-col items-center gap-1 relative">
            {/* the line back to the previous step */}
            {i > 0 && <span aria-hidden className={`absolute top-[9px] right-1/2 w-full h-0.5 ${i <= step ? 'bg-teal-600' : 'bg-gray-200'}`} />}
            <span className={`relative z-[1] w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
              done ? 'bg-teal-600 text-white' : here ? 'bg-white border-2 border-teal-600 text-teal-700' : 'bg-white border-2 border-gray-200 text-gray-300'}`}>
              {done ? '✓' : here ? <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-pulse" /> : ''}
            </span>
            <span className={`text-[10px] ${done || here ? 'text-teal-700 font-semibold' : 'text-gray-400'}`}>{s}</span>
          </li>
        )
      })}
    </ol>
  )
}

/* ─── One active alert ──────────────────────────────────────────────── */
function AlertCard({ alert, openVital, onLog, onMessage }: {
  alert: AppAlert
  openVital: (vitalId: string) => void
  onLog: (vitalId: string) => void
  onMessage: () => void
}) {
  const { now } = useApp()
  const { cancelSos } = usePatient()
  const save = useSave()
  const v = useAlertView()(alert)
  const tone = v.danger
    ? { bar: 'bg-red-500', tile: 'bg-red-50', value: 'text-red-600' }
    : { bar: 'bg-amber-400', tile: 'bg-amber-50', value: 'text-amber-600' }
  const outline = 'flex-1 rounded-full border border-gray-200 bg-white py-2 text-xs font-bold text-gray-700 transition-colors hover:border-teal-300 active:scale-[.98]'

  return (
    <article className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className={`h-1 ${tone.bar}`} />
      <div className="p-4 flex flex-col gap-3.5">
        {/* what and how far out */}
        <div className="flex items-start gap-3">
          <span className={`w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0 ${tone.tile}`} aria-hidden="true">{v.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-500 truncate">{v.name}</p>
            <p className="flex items-baseline gap-1.5 flex-wrap">
              <span className={`text-2xl font-black leading-tight font-mono ${tone.value}`}>{v.value}</span>
              {v.unit && <span className="text-xs text-gray-400">{v.unit}</span>}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {v.direction && <span className={`font-semibold ${tone.value}`}>{v.direction === 'high' ? '↑ Above target' : '↓ Below target'} · </span>}
              {v.target && `${v.target} · `}{ago(alert.at, now)}
            </p>
          </div>
          <AlertStatusPill alert={alert} />
        </div>

        <div>
          <Progress alert={alert} />
          <p className="text-[11px] text-gray-500 text-center mt-1.5">{v.statusLine}.</p>
        </div>

        {/* a fresh reading would help */}
        {v.remeasure && v.def && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2">
            <span aria-hidden="true">⏱</span>
            <p className="flex-1 text-[11px] font-semibold text-amber-800 leading-snug">{v.remeasure.reason}.</p>
          </div>
        )}

        {/* what to do while waiting */}
        <div className="rounded-xl bg-gray-50 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">What to do now</p>
          <ul className="flex flex-col gap-1.5">
            {v.tips.map(t => (
              <li key={t} className="flex gap-2 text-xs text-gray-700 leading-snug">
                <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-teal-600 flex-shrink-0" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* actions: one main button, the rest quiet */}
        {alert.type === 'sos' ? (
          <>
            <button onClick={() => save.run(() => cancelSos(alert.id))} disabled={save.busy} className={outline}>{save.busy ? 'Cancelling…' : 'I’m safe now · cancel SOS'}</button>
            <SaveError message={save.error} />
          </>
        ) : (
          <div className="flex flex-col gap-2">
            {v.def && (
              <button onClick={() => onLog(v.def!.id)}
                className="w-full rounded-full bg-teal-700 py-2.5 text-sm font-bold text-white shadow-sm shadow-teal-700/30 transition-all hover:bg-teal-800 active:scale-[.98]">
                {v.remeasure ? 'Re-measure now' : `Log a new ${v.name} reading`}
              </button>
            )}
            <div className="flex gap-2">
              <button onClick={onMessage} className={outline}>Message doctor</button>
              {v.def && <button onClick={() => openVital(v.def!.id)} className={outline}>History &amp; trend</button>}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

/* ─── My Alerts ─────────────────────────────────────────────────────── */
export function MyAlertsTab({ openVital, onLog, go }: {
  openVital: (vitalId: string) => void
  /** Opens the log sheet for one vital. */
  onLog: (vitalId: string) => void
  go: (tab: string, target?: string) => void
}) {
  const { alerts } = useApp()
  const { patient, nameOf, appointments, status, error, reload } = usePatient()
  const view = useAlertView()
  const [showAll, setShowAll] = useState(false)

  const mine = alerts.filter(a => a.patientId === patient.id)
  // Critical first, then newest.
  const active = mine.filter(isActiveAlert).sort((a, b) => Number(b.severity === 'danger') - Number(a.severity === 'danger') || b.at - a.at)
  const past = mine.filter(a => a.status === 'resolved')
  const reviewing = active.filter(a => a.status !== 'open').length
  const stats = [
    { label: 'Active', value: active.length, cls: active.length ? 'text-red-600' : 'text-gray-900' },
    { label: 'With your doctor', value: reviewing, cls: 'text-blue-600' },
    { label: 'Resolved', value: past.length, cls: 'text-emerald-600' },
  ]

  return (
    <Page title="My Alerts" status={status} error={error} onRetry={reload}>
      {/* where things stand, at a glance */}
      <div className="span-all grid grid-cols-3 gap-2.5">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-2xl shadow-sm px-3 py-2.5 text-center">
            <p className={`text-2xl font-black leading-tight font-mono ${s.cls}`}>{s.value}</p>
            <p className="text-[10px] font-medium text-gray-500 truncate">{s.label}</p>
          </div>
        ))}
      </div>

      {active.length === 0 && (
        <div className="span-all bg-emerald-50 border border-emerald-100 rounded-2xl p-5 text-center">
          <span className="mx-auto mb-2 flex w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 items-center justify-center text-lg font-black">✓</span>
          <p className="text-sm font-bold text-emerald-700">You’re all clear</p>
          <p className="text-xs text-emerald-700/80 mt-1 leading-relaxed">
            Out-of-range readings are sent to your doctor automatically. {SELF_CLEAR_NOTE}
          </p>
        </div>
      )}

      {active.map(a => <AlertCard key={a.id} alert={a} openVital={openVital} onLog={onLog} onMessage={() => go('messages')} />)}

      {past.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-bold text-gray-900">History</p>
            <span className="text-[11px] text-gray-400"><span className="font-mono">{past.length}</span> resolved</span>
          </div>
          {(showAll ? past : past.slice(0, HISTORY_PREVIEW)).map(a => {
            const v = view(a)
            return (
              <div key={a.id} className="flex gap-2.5 py-2.5 border-b border-gray-100 last:border-0">
                <span className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-[11px] font-black flex-shrink-0">✓</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">
                    {v.name}{a.type !== 'sos' && <> · <span className="font-mono">{v.value}</span> {v.unit}</>}
                  </p>
                  <p className="text-[11px] text-emerald-700 leading-snug">{a.resolutionReason}{a.resolutionNote ? `: ${a.resolutionNote}` : ''}</p>
                  <p className="text-[10px] text-gray-400">{nameOf(a.resolvedBy, 'You')} · {a.resolvedAt}</p>
                  {(() => {
                    // The visit booked when this alert was resolved.
                    const visit = appointments.find(x => x.alertId === a.id)
                    if (!visit) return null
                    const w = apptWhen(visit)
                    return (
                      <button onClick={() => go('appts', visit.id)} className="mt-1 text-[11px] font-bold text-teal-700">
                        📅 Follow-up visit · {w.date} · {w.time} →
                      </button>
                    )
                  })()}
                </div>
              </div>
            )
          })}
          {past.length > HISTORY_PREVIEW && (
            <button onClick={() => setShowAll(s => !s)} className="w-full pt-2.5 text-[11px] font-bold text-teal-700">
              {showAll ? 'Show fewer' : `Show all ${past.length}`}
            </button>
          )}
        </div>
      )}
    </Page>
  )
}

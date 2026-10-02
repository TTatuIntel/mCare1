import { useEffect, useState } from 'react'
import { BackHeader, EmptyState, ChipFilter, StatTiles } from '@/shared'
import type { AdminReport } from '@/shared/lib/types'
import { dayKey } from '@/shared/lib/vitals'
import { downloadBlob } from '@/shared/documents/exporters'
import { useAdmin } from './useAdmin'

type Period = '7' | '30' | '90'
const PERIODS: { id: Period; label: string }[] = [{ id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }, { id: '90', label: 'Last 90 days' }]
const daysAgo = (n: number) => dayKey(new Date(Date.now() - n * 86_400_000))
const mins = (m: number | null) => (m === null || m === undefined ? '—' : m < 60 ? `${m} min` : `${Math.round(m / 6) / 10} h`)
const APPT_LABEL: Record<string, string> = {
  requested: 'Waiting for the doctor', approved: 'Confirmed', rescheduled: 'New time proposed', completed: 'Completed', cancelled: 'Cancelled', rejected: 'Declined', no_show: 'Missed',
}

/* ─── Operational report ──────────────────────────────────────────────
   Counts made by the database from the records, for a chosen period.
   "Now" figures are what is waiting at this moment; the rest count what
   happened in the period. No patient is named and no reading is shown. */
export default function ReportsTab({ onBack }: { onBack: () => void }) {
  const { report } = useAdmin()
  const [period, setPeriod] = useState<Period>('30')
  const [state, setState] = useState<{ data?: AdminReport; error?: string; loading: boolean }>({ loading: true })
  const load = () => {
    setState(s => ({ ...s, loading: true, error: undefined }))
    void report(daysAgo(Number(period) - 1), dayKey()).then(r => setState(r.ok ? { data: r.value, loading: false } : { error: r.error, loading: false }))
  }
  useEffect(load, [period]) // eslint-disable-line react-hooks/exhaustive-deps
  const r = state.data

  const exportCsv = () => {
    if (!r) return
    const rows: (string | number)[][] = [
      ['mCare operational report', `${r.from} to ${r.to}`], [],
      ['Active accounts'], ...Object.entries(r.accounts).map(([k, v]) => [k, v ?? 0]), [],
      ['Registered in the period'], ...Object.entries(r.registered).map(([k, v]) => [k, v ?? 0]), [],
      ['Waiting now'], ...Object.entries(r.waiting).map(([k, v]) => [k.replace(/_/g, ' '), v]), [],
      ['Appointments made in the period'], ...Object.entries(r.appointments).map(([k, v]) => [APPT_LABEL[k] ?? k, v ?? 0]), [],
      ['Alerts raised in the period'], ...Object.entries(r.alerts).map(([k, v]) => [k.replace(/_/g, ' '), v ?? '']), [],
      ['Activity in the period'], ...Object.entries(r.activity).map(([k, v]) => [k.replace(/_/g, ' '), v]), [],
      ['Doctor', 'Patients', 'Open alerts', 'Visits', 'Completed'], ...r.doctors.map(d => [d.name, d.patients, d.open_alerts, d.visits, d.completed]),
    ]
    const csv = rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `mcare-report-${r.from}-to-${r.to}.csv`)
  }

  return (
    <div className="flex flex-col gap-3 card-flow">
      <BackHeader title="Reports" subtitle="Counted from the records" onBack={onBack}
        right={r && <button onClick={exportCsv} className="text-xs font-semibold text-teal-700 border border-teal-200 px-3 py-1.5 rounded-full flex-shrink-0">Export CSV</button>} />
      <ChipFilter label="Period" options={PERIODS} value={period} onChange={setPeriod} />

      {state.loading && !r && <p className="text-xs text-gray-400 span-all">Counting…</p>}
      {state.error && <div className="span-all"><EmptyState icon="⚠️" title="Couldn’t load the report" text={state.error} action="Try again" onAction={load} /></div>}

      {r && !state.error && (
        <>
          <div className="span-all">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Waiting now</p>
            <StatTiles items={[
              { value: r.waiting.open_alerts, label: 'Open alerts', tone: r.waiting.open_alerts ? 'red' : 'green' },
              { value: r.waiting.patients_without_doctor, label: 'Patients without a doctor', tone: r.waiting.patients_without_doctor ? 'amber' : 'green' },
              { value: r.waiting.doctor_approvals, label: 'Doctor approvals', tone: 'gray' },
              { value: r.waiting.doctor_requests, label: 'Doctor requests', tone: 'gray' },
              { value: r.waiting.support_requests, label: 'Support requests', tone: 'gray' },
              { value: r.waiting.invitations, label: 'Not signed up yet', tone: 'gray' },
            ]} />
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-2">Accounts</p>
            {(['patient', 'doctor', 'assistant', 'admin'] as const).map(role => (
              <div key={role} className="flex justify-between py-1 text-xs">
                <span className="text-gray-600 capitalize">{role}s active</span>
                <span className="font-mono font-bold text-gray-900">{r.accounts[role] ?? 0}<span className="font-normal text-gray-400"> · {r.registered[role] ?? 0} new</span></span>
              </div>
            ))}
            <div className="flex justify-between py-1 text-xs border-t border-gray-50 mt-1 pt-2">
              <span className="text-gray-600">Suspended or deactivated</span><span className="font-mono font-bold text-gray-900">{r.stopped}</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-2">Alerts raised</p>
            {([['Raised', r.alerts.raised], ['Critical readings', r.alerts.critical], ['SOS', r.alerts.sos], ['Escalated', r.alerts.escalated], ['Resolved', r.alerts.resolved],
              ['Average time to acknowledge', mins(r.alerts.minutes_to_acknowledge)], ['Average time to resolve', mins(r.alerts.minutes_to_resolve)]] as const).map(([l, v]) => (
              <div key={l} className="flex justify-between py-1 text-xs"><span className="text-gray-600">{l}</span><span className="font-mono font-bold text-gray-900">{v}</span></div>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-2">Appointments made</p>
            {Object.keys(r.appointments).length === 0 && <p className="text-xs text-gray-400">None in this period.</p>}
            {Object.entries(r.appointments).map(([k, v]) => (
              <div key={k} className="flex justify-between py-1 text-xs"><span className="text-gray-600">{APPT_LABEL[k] ?? k}</span><span className="font-mono font-bold text-gray-900">{v}</span></div>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-2">Activity</p>
            {([['Readings recorded', r.activity.readings], ['Patients who recorded', r.activity.patients_recording], ['Prescriptions written', r.activity.prescriptions],
              ['Documents added', r.activity.documents], ['Messages sent', r.activity.messages], ['Support requests opened', r.support.opened], ['Support requests answered', r.support.answered]] as const).map(([l, v]) => (
              <div key={l} className="flex justify-between py-1 text-xs"><span className="text-gray-600">{l}</span><span className="font-mono font-bold text-gray-900">{v}</span></div>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm span-all">
            <p className="text-sm font-bold text-gray-900 mb-2">Doctor workload</p>
            {r.doctors.length === 0 ? <p className="text-xs text-gray-400">No approved, active doctors yet.</p> : (
              <div role="table" aria-label="Doctor workload">
                <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem_4rem_4.5rem] gap-x-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider pb-1" role="row">
                  <span role="columnheader">Doctor</span><span role="columnheader" className="text-right">Patients</span><span role="columnheader" className="text-right">Alerts</span>
                  <span role="columnheader" className="text-right">Visits</span><span role="columnheader" className="text-right">Completed</span>
                </div>
                {r.doctors.map(d => (
                  <div key={d.id} role="row" className="grid grid-cols-[minmax(0,1fr)_4rem_4rem_4rem_4.5rem] gap-x-2 py-1.5 text-xs border-t border-gray-50">
                    <span role="cell" className="text-gray-800 font-semibold truncate">{d.name}</span>
                    <span role="cell" className="text-right font-mono">{d.patients}</span>
                    <span role="cell" className={`text-right font-mono ${d.open_alerts ? 'text-red-600 font-bold' : ''}`}>{d.open_alerts}</span>
                    <span role="cell" className="text-right font-mono">{d.visits}</span>
                    <span role="cell" className="text-right font-mono">{d.completed}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import { BackHeader, EmptyState, ChipFilter, SaveError, inputCls, useSave } from '@/shared'
import { downloadBlob } from '@/shared/documents/exporters'
import type { AuditEntry } from '@/shared/lib/types'
import { ago } from '@/shared/lib/vitals'
import { useAdmin } from './useAdmin'

/* ─── Audit log ───────────────────────────────────────────────────────
   Written by the database in the same step as the change it describes;
   nobody can add, edit or remove an entry from here. */
/** Table columns on tablet and web: action · detail · by · when. */
const COLS = '@2xl:grid-cols-[12rem_minmax(0,1fr)_10rem_6rem] @2xl:gap-x-4'

type By = 'all' | 'patient' | 'doctor' | 'staff' | 'system'
const BY: { id: By; label: string; match: (a: AuditEntry) => boolean }[] = [
  { id: 'all', label: 'Everyone', match: () => true },
  { id: 'patient', label: 'Patients', match: a => a.actorRole === 'patient' },
  { id: 'doctor', label: 'Doctors', match: a => a.actorRole === 'doctor' },
  { id: 'staff', label: 'Admins & assistants', match: a => a.actorRole === 'admin' || a.actorRole === 'assistant' },
  { id: 'system', label: 'System', match: a => !a.actorRole },
]

export default function AuditTab({ onBack }: { onBack: () => void }) {
  const { audit, loadOlderAudit, nameOf, now, status, error, reload } = useAdmin()
  const older = useSave()
  /** No older entries came back: the start of the trail is on screen. */
  const [atStart, setAtStart] = useState(false)
  const more = async () => { const r = await older.run(() => loadOlderAudit()); if (r.ok && r.value === 0) setAtStart(true) }
  const [q, setQ] = useState('')
  const [by, setBy] = useState<By>('all')
  const who = (a: AuditEntry) => nameOf(a.actorId, a.actorRole ? 'A former account' : 'mCare')
  const needle = q.trim().toLowerCase()
  const match = BY.find(b => b.id === by) ?? BY[0]
  const rows = audit.filter(a => match.match(a) && (!needle || `${a.action} ${a.detail} ${who(a)}`.toLowerCase().includes(needle)))
  /** What is listed, as a spreadsheet: for a review or an incident report. */
  const exportCsv = () => {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = [['When', 'Action', 'Detail', 'By', 'Role', 'About', 'Record'].map(cell).join(','),
      ...rows.map(a => [new Date(a.at).toISOString(), a.action, a.detail, who(a), a.actorRole ?? 'system', a.resourceType ?? '', a.resourceId ?? ''].map(cell).join(','))]
    downloadBlob(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `mcare-audit-${new Date().toISOString().slice(0, 10)}.csv`)
  }
  return (
    <div className="flex flex-col gap-3">
      <BackHeader title="Audit Log" subtitle={`${audit.length} actions loaded, newest first`} onBack={onBack}
        right={rows.length > 0 && <button onClick={exportCsv} className="text-xs font-semibold text-teal-700 border border-teal-200 px-3 py-1.5 rounded-full flex-shrink-0">Export CSV</button>} />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search actions, people…" aria-label="Search the audit log" className={inputCls} />
      <ChipFilter label="Who did it" options={BY} value={by} onChange={setBy} />
      {status === 'error' && <EmptyState icon="⚠️" title="Couldn’t load the audit log" text={error} action="Try again" onAction={reload} />}
      {status === 'ready' && rows.length === 0 && (
        <EmptyState icon="🧾" title={audit.length ? 'No matching entries' : 'Nothing recorded yet'}
          text={audit.length ? 'Try another search, or another group of people.' : 'Actions appear here as people use mCare.'} />
      )}
      {/* stacked rows on mobile; the same rows line up as table columns on tablet and web */}
      {rows.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-50" role="table" aria-label="Audit log">
          <div className={`hidden @2xl:grid ${COLS} px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider`} role="row">
            <span role="columnheader">Action</span><span role="columnheader">Detail</span><span role="columnheader">By</span><span role="columnheader" className="text-right">When</span>
          </div>
          {rows.map(a => (
            <div key={a.id} role="row" className={`px-4 py-3 grid grid-cols-[1fr_auto] gap-x-2 @2xl:items-baseline ${COLS}`}>
              <p role="cell" className="text-xs font-bold text-gray-900">{a.action}</p>
              <p role="cell" className="text-[10px] text-gray-400 text-right @2xl:order-last" title={a.createdAt}>{ago(a.at, now)}</p>
              <p role="cell" className="text-[11px] text-gray-600 col-span-2 @2xl:col-span-1">{a.detail}</p>
              <p role="cell" className="text-[10px] text-gray-400 col-span-2 @2xl:col-span-1 @2xl:truncate">
                <span className="@2xl:hidden">by </span>{who(a)}{a.actorRole ? ` · ${a.actorRole}` : ''}<span className="@2xl:hidden"> · {a.createdAt}</span>
              </p>
            </div>
          ))}
        </div>
      )}
      <SaveError message={older.error} />
      {audit.length > 0 && (atStart
        ? <p className="text-[11px] text-gray-400 text-center">That is the whole trail.</p>
        : <button onClick={more} disabled={older.busy} className="self-center text-xs font-bold text-teal-700 py-2 disabled:opacity-50">{older.busy ? 'Loading…' : 'Load older entries'}</button>)}
    </div>
  )
}

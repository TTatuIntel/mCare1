import { useEffect, useRef, useState } from 'react'
import { BackHeader, EmptyState, ChipFilter, SaveError, inputCls, useSave } from '@/shared'
import { downloadBlob } from '@/shared/documents/exporters'
import type { AuditEntry } from '@/shared/lib/types'
import type { AuditWho } from '@/shared/api/records'
import { ago } from '@/shared/lib/vitals'
import { useAdmin } from './useAdmin'

/* ─── Audit log ───────────────────────────────────────────────────────
   Written by the database in the same step as the change it describes;
   nobody can add, edit or remove an entry from here. The search runs in
   the database over the whole trail, a page at a time, so an old entry is
   found as easily as a new one. */
/** Table columns on tablet and web: action · detail · by · when. */
const COLS = '@2xl:grid-cols-[12rem_minmax(0,1fr)_10rem_6rem] @2xl:gap-x-4'
const BY: { id: AuditWho; label: string }[] = [
  { id: 'all', label: 'Everyone' }, { id: 'patient', label: 'Patients' }, { id: 'doctor', label: 'Doctors' },
  { id: 'staff', label: 'Admins & assistants' }, { id: 'system', label: 'System' },
]
/** A full page came back, so there may be more. */
const PAGE = 100

export default function AuditTab({ onBack }: { onBack: () => void }) {
  const { audit, searchAudit, nameOf, now } = useAdmin()
  const [q, setQ] = useState('')
  const [by, setBy] = useState<AuditWho>('all')
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [state, setState] = useState<{ loading: boolean; error?: string; more: boolean }>({ loading: true, more: false })
  const older = useSave()
  const asked = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const who = (a: AuditEntry) => nameOf(a.actorId, a.actorRole ? 'A former account' : 'mCare')

  // The first page: when the search changes (after a pause in typing), and when a new entry is recorded.
  const newest = audit[0]?.id
  useEffect(() => {
    const mine = ++asked.current
    setState(s => ({ ...s, loading: true, error: undefined }))
    const t = setTimeout(async () => {
      const r = await searchAudit(q, by)
      if (mine !== asked.current) return   // a newer search is on its way
      if (r.ok) { setRows(r.value); setState({ loading: false, more: r.value.length >= PAGE }) }
      else setState({ loading: false, error: r.error, more: false })
    }, 300)
    return () => clearTimeout(t)
  }, [q, by, newest, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadOlder = async () => {
    const last = rows[rows.length - 1]
    if (!last) return
    const mine = asked.current
    const r = await older.run(() => searchAudit(q, by, last.id))
    if (r.ok && mine === asked.current) { setRows(prev => [...prev, ...r.value]); setState(s => ({ ...s, more: r.value.length >= PAGE })) }
  }

  /** What is listed, as a spreadsheet: for a review or an incident report. */
  const exportCsv = () => {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = [['When', 'Action', 'Detail', 'By', 'Role', 'About', 'Record'].map(cell).join(','),
      ...rows.map(a => [new Date(a.at).toISOString(), a.action, a.detail, who(a), a.actorRole ?? 'system', a.resourceType ?? '', a.resourceId ?? ''].map(cell).join(','))]
    downloadBlob(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `mcare-audit-${new Date().toISOString().slice(0, 10)}.csv`)
  }
  const searching = !!q.trim() || by !== 'all'

  return (
    <div className="flex flex-col gap-3">
      <BackHeader title="Audit Log" subtitle={`${rows.length}${state.more ? '+' : ''} ${searching ? 'matching' : 'most recent'} action${rows.length === 1 ? '' : 's'}, newest first`} onBack={onBack}
        right={rows.length > 0 && <button onClick={exportCsv} className="text-xs font-semibold text-teal-700 border border-teal-200 px-3 py-1.5 rounded-full flex-shrink-0">Export CSV</button>} />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the whole trail: actions, details, people…" aria-label="Search the audit log" className={inputCls} />
      <ChipFilter label="Who did it" options={BY} value={by} onChange={setBy} />

      {state.error && <EmptyState icon="⚠️" title="Couldn’t search the audit log" text={state.error} action="Try again" onAction={() => setAttempt(n => n + 1)} />}
      {state.loading && rows.length === 0 && !state.error && <p className="text-xs text-gray-400 text-center py-4">Searching…</p>}
      {!state.loading && !state.error && rows.length === 0 && (
        <EmptyState icon="🧾" title={searching ? 'No matching entries' : 'Nothing recorded yet'}
          text={searching ? 'Try other words, or another group of people.' : 'Actions appear here as people use mCare.'} />
      )}
      {/* stacked rows on mobile; the same rows line up as table columns on tablet and web */}
      {rows.length > 0 && (
        <div className={`bg-white rounded-2xl shadow-sm divide-y divide-gray-50 ${state.loading ? 'opacity-60' : ''}`} role="table" aria-label="Audit log">
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
      {rows.length > 0 && (state.more
        ? <button onClick={loadOlder} disabled={older.busy} className="self-center text-xs font-bold text-teal-700 py-2 disabled:opacity-50">{older.busy ? 'Loading…' : 'Load older entries'}</button>
        : <p className="text-[11px] text-gray-400 text-center">{searching ? 'That is every match.' : 'That is the whole trail.'}</p>)}
    </div>
  )
}

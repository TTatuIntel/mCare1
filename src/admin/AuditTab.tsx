import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BackHeader, inputCls } from '@/shared'
import { ago } from '@/shared/lib/vitals'

/* ─── Audit log ─── */
/** Table columns on tablet and web: action · detail · by · when. */
const COLS = '@2xl:grid-cols-[12rem_minmax(0,1fr)_10rem_6rem] @2xl:gap-x-4'

export default function AuditTab({ onBack }: { onBack: () => void }) {
  const { audit, users, now } = useApp()
  const [q, setQ] = useState('')
  const rows = audit.filter(a => `${a.action} ${a.detail} ${users.find(u => u.id === a.actorId)?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="flex flex-col gap-3">
      <BackHeader title="Audit Log" subtitle={`${audit.length} recorded actions`} onBack={onBack} />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search actions, people…" className={inputCls} />
      {/* stacked rows on mobile; the same rows line up as table columns on tablet and web */}
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
              <span className="@2xl:hidden">by </span>{users.find(u => u.id === a.actorId)?.name ?? a.actorId}<span className="@2xl:hidden"> · {a.createdAt}</span>
            </p>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No matching entries.</p>}
      </div>
    </div>
  )
}

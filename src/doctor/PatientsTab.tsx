import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Avatar, Pill, PageTitle, Chevron, inputCls } from '@/shared'
import type { DoctorUser } from '@/shared/lib/types'
import { ago } from '@/shared/lib/vitals'
import { PatientDetail } from './PatientDetail'
import { useBoard } from './useBoard'

/* ─── Patients ────────────────────────────────────────────────────────
   Mobile and tablet: the list, then the opened patient in its place.
   Web: the list stays on the left beside the opened patient, so the doctor
   moves between patients without going back. */
export function PatientsTab({ doctor, openId, setOpenId, initialSection }: { doctor: DoctorUser; openId: string | null; setOpenId: (id: string | null) => void; initialSection?: 'docs' }) {
  const board = useBoard(doctor)
  const { now } = useApp()
  const [q, setQ] = useState('')
  const opened = openId && doctor.assignedPatientIds.includes(openId) ? openId : null
  const list = board.filter(b => b.p.name.toLowerCase().includes(q.toLowerCase()))

  const search = <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search patients…" className={inputCls} />
  const rows = list.length === 0 ? (
    <p className="text-sm text-gray-400 text-center py-8">{board.length ? 'No match.' : 'No patients assigned yet.'}</p>
  ) : list.map(({ p, band, lastAt, unread, open }) => (
    <button key={p.id} onClick={() => setOpenId(p.id)} aria-current={p.id === opened}
      className={`bg-white rounded-2xl px-4 py-4 flex items-center gap-3 shadow-sm text-left active:bg-gray-50 transition-colors ${p.id === opened ? 'ring-2 ring-teal-500' : ''}`}>
      <Avatar name={p.name} avatar={p.avatar} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 truncate">{p.name}</p>
        <p className="text-xs text-gray-500">Last reading {lastAt ? ago(lastAt, now) : 'never'}</p>
        <div className="flex gap-1.5 mt-1 flex-wrap">
          <Pill color={band.color}>{band.label}</Pill>
          {open.length > 0 && <Pill color="red">{open.length} alert{open.length > 1 ? 's' : ''}</Pill>}
          {unread > 0 && <Pill color="blue">💬 {unread}</Pill>}
        </div>
      </div>
      <Chevron />
    </button>
  ))

  if (opened) return (
    <div className="@5xl:grid @5xl:grid-cols-[18rem_minmax(0,1fr)] @5xl:gap-6 @5xl:items-start">
      <aside className="hidden @5xl:flex flex-col gap-3" aria-label="Patients">
        <PageTitle title="Patients" />
        {search}
        {rows}
      </aside>
      <PatientDetail patientId={opened} onBack={() => setOpenId(null)} initial={initialSection} />
    </div>
  )

  return (
    <div className="flex flex-col gap-3 card-flow">
      <PageTitle title="Patients" />
      {search}
      {rows}
    </div>
  )
}

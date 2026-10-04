import { useState } from 'react'
import { Avatar, Pill, Page, EmptyState, Chevron, inputCls } from '@/shared'
import { ago } from '@/shared/lib/vitals'
import { PatientDetail } from './PatientDetail'
import type { Section } from './PatientDetail'
import { useBoard } from './useBoard'
import { useDoctor } from './useDoctor'
import { ConsultView } from './ConsultView'

/* ─── Patients ────────────────────────────────────────────────────────
   Mobile and tablet: the list, then the opened patient in its place.
   Web: the list stays on the left beside the opened patient, so the doctor
   moves between patients without going back. */
export function PatientsTab({ openId, setOpenId, initialSection, initialDoc }: { openId: string | null; setOpenId: (id: string | null) => void; initialSection?: Section; initialDoc?: string }) {
  const board = useBoard()
  const { patient, pastPatients, consulting, now, status, error, reload } = useDoctor()
  const [q, setQ] = useState('')
  /** A patient this doctor consults on, opened to read. */
  const [consultId, setConsultId] = useState<string | null>(null)
  const consult = consulting.find(c => c.patient.id === consultId)
  // Only a patient assigned to this doctor opens; anything else falls back to the list.
  const opened = patient(openId)?.id ?? null
  const list = board.filter(b => b.p.name.toLowerCase().includes(q.trim().toLowerCase()))

  const search = <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search patients…" aria-label="Search patients" className={`${inputCls} span-all`} />
  const rows = list.length === 0 ? (
    <div className="span-all">
      {board.length
        ? <EmptyState icon="🔎" title="No match" text="No patient of yours has that name." />
        : <EmptyState icon="👥" title="No patients assigned yet" text="A patient appears here once the care coordination team assigns them to you." />}
    </div>
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

  if (consult && !opened) return <ConsultView patient={consult.patient} member={consult.member} onBack={() => setConsultId(null)} />

  if (opened) return (
    <div className="@5xl:grid @5xl:grid-cols-[18rem_minmax(0,1fr)] @5xl:gap-6 @5xl:items-start">
      <aside className="hidden @5xl:flex flex-col gap-3" aria-label="Patients">
        <h2 className="text-xl font-bold text-gray-900 font-display pt-1">Patients</h2>
        {search}
        {rows}
      </aside>
      <PatientDetail key={`${opened}:${initialSection ?? ''}:${initialDoc ?? ''}`} patientId={opened} onBack={() => setOpenId(null)} initial={initialSection} initialDoc={initialDoc} />
    </div>
  )

  return (
    <Page title="Patients" meta={board.length ? `${board.length} under your care` : undefined} status={status} error={error} onRetry={reload}>
      {board.length > 0 && search}
      {rows}
      {/* patients of other doctors whose record this doctor may read */}
      {consulting.length > 0 && <p className="span-all text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-1 -mb-2">Consulting · {consulting.length}</p>}
      {consulting.map(({ patient: p, member }) => (
        <button key={member.id} onClick={() => setConsultId(p.id)}
          className="bg-white rounded-2xl px-4 py-4 flex items-center gap-3 shadow-sm text-left active:bg-gray-50">
          <Avatar name={p.name} avatar={p.avatar} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">{p.name}</p>
            <p className="text-xs text-gray-500 truncate">{member.reason || 'Read only'}</p>
            <div className="mt-1"><Pill color="blue">Consulting</Pill></div>
          </div>
          <Chevron />
        </button>
      ))}
      {/* who this doctor used to treat: a name and dates, since the record is no longer theirs to open */}
      {pastPatients.length > 0 && (
        <details className="bg-white rounded-2xl p-4 shadow-sm span-all">
          <summary className="text-xs font-semibold text-gray-500 cursor-pointer">Past patients ({pastPatients.length})</summary>
          <p className="text-[10px] text-gray-400 mt-2">Their records are open only to the doctor who treats them now.</p>
          {pastPatients.map(p => (
            <div key={`${p.patientId}-${p.endedAt}`} className="py-2 border-t border-gray-50 mt-2">
              <p className="text-xs font-semibold text-gray-800">{p.name}</p>
              <p className="text-[10px] text-gray-400">
                {new Date(p.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} to {new Date(p.endedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {p.endReason ? ` · ${p.endReason}` : ''}
              </p>
            </div>
          ))}
        </details>
      )}
    </Page>
  )
}

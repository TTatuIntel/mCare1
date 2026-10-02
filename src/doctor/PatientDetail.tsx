import { useState } from 'react'
import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import {
  Pill, VitalThresholdRow, BottomSheet, SheetButton, Field, inputCls,
  useToast, AlertStatusPill, ResolveAlertSheet, VitalChart, VitalHistory, ChatThread, BackHeader, VitalCard, HERO_GRADIENT,
  HealthSummary, AllergyBanner,
} from '@/shared'
import type { DoctorUser, PatientUser, AppAlert, VitalDef } from '@/shared/lib/types'
import { evaluate, latestValid, riskScore, riskBand, targetRange, vitalTrend, ago, dateLabel } from '@/shared/lib/vitals'
import { buildDaySchedule, clock, TONE_PILL } from '@/shared/lib/schedule'
import { AlertCard } from './AlertCard'
import { PatientDocs } from './PatientDocs'
import { isOfficial } from '@/shared/documents/documents'
import type { DocSourceLink } from '@/shared/lib/types'

/* ─── Patient Detail ────────────────────────────────────────────────── */
type Section = 'overview' | 'vitals' | 'meds' | 'notes' | 'messages' | 'docs' | 'report'

export function PatientDetail({ patientId, onBack, initial = 'overview' }: { patientId: string; onBack: () => void; initial?: Section }) {
  const {
    vitalDefs, updateUser, setThreshold, setDoctorNote, currentUser, users, messages, alerts, clinicalNotes, doses, mealsDone,
    addPrescription, setPrescriptionActive, invalidateReading, now, documentsFor, reportRequests,
  } = useApp()
  const doctor = currentUser as DoctorUser
  const patient = users.find(u => u.id === patientId) as PatientUser
  const activeVitals = vitalDefs.filter(v => v.active)
  const [section, setSection] = useState<Section>(initial)
  const toast = useToast()

  const [editing, setEditing] = useState<string | null>(null)
  const [editMin, setEditMin] = useState('')
  const [editMax, setEditMax] = useState('')
  const [note, setNote] = useState('')
  const [resolveSheet, setResolveSheet] = useState<AppAlert | null>(null)
  const [rxOpen, setRxOpen] = useState(false)
  const [rx, setRx] = useState({ medication: '', dosage: '', frequency: 'Once daily', purpose: '' })
  const [invalidFor, setInvalidFor] = useState<string | null>(null)
  const [invalidReason, setInvalidReason] = useState('')
  const [docOpen, setDocOpen] = useState<string | null>(null)
  const [buildOpen, setBuildOpen] = useState(false)

  if (!patient) return null
  // Drafts to sign plus reports the patient has asked for
  const unsigned = documentsFor(patient.id).filter(e => isOfficial(e.doc) && e.doc.status !== 'released').length
    + reportRequests.filter(r => r.patientId === patient.id && r.status === 'pending').length
  const followDocLink = (l: DocSourceLink) => {
    setDocOpen(null)
    setSection(l.kind === 'reading' ? 'vitals' : l.kind === 'prescription' ? 'meds' : l.kind === 'note' ? 'notes' : 'overview')
  }
  const open = alerts.filter(a => a.patientId === patient.id && isActiveAlert(a))
  const unread = messages.filter(m => m.fromId === patient.id && m.toId === doctor.id && !m.read).length
  const notes = clinicalNotes.filter(n => n.patientId === patient.id)
  const activeRx = patient.prescriptions.filter(x => x.active)
  // Same schedule the patient ticks off on their Home / Meds tabs
  const day = buildDaySchedule(patient, doses, mealsDone, now)
  const score = riskScore(patient, vitalDefs, open, now)
  const band = riskBand(score)

  const toggleAssign = (id: string) => {
    const next = patient.trackedVitalIds.includes(id) ? patient.trackedVitalIds.filter(v => v !== id) : [...patient.trackedVitalIds, id]
    void updateUser(patient.id, { trackedVitalIds: next } as Partial<PatientUser>)
  }
  const startEdit = (def: VitalDef) => {
    const thr = targetRange(patient, def)
    setEditMin(String(thr.min)); setEditMax(String(thr.max)); setEditing(def.id)
  }
  const saveThreshold = async (id: string) => {
    const min = Number(editMin), max = Number(editMax)
    if (isNaN(min) || isNaN(max) || min >= max) { toast.show('Min must be lower than max'); return }
    if (!(await setThreshold(patient.id, id, { min, max })).ok) return
    setEditing(null); toast.show('Target range saved')
  }
  const prescribe = async () => {
    if (!rx.medication.trim() || !rx.dosage.trim()) return
    const saved = await addPrescription(patient.id, {
      id: `rx_${Date.now()}`, medication: rx.medication.trim(), dosage: rx.dosage.trim(), frequency: rx.frequency,
      purpose: rx.purpose.trim(), prescribedAt: dateLabel(), doctorId: doctor.id, active: true,
    })
    setRxOpen(false)
    if (!saved.ok) return
    setRx({ medication: '', dosage: '', frequency: 'Once daily', purpose: '' })
    toast.show('Prescription sent to patient')
  }

  const SECTIONS: { id: Section; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'vitals', label: 'Vitals' },
    { id: 'meds', label: 'Meds' },
    { id: 'notes', label: 'Notes' },
    { id: 'messages', label: `Chat${unread ? ` (${unread})` : ''}` },
    { id: 'docs', label: `Docs${unsigned ? ` (${unsigned})` : ''}` },
    { id: 'report', label: 'Report' },
  ]

  return (
    <div className="flex flex-col gap-4 card-flow">
      <BackHeader title={patient.name} subtitle={`${patient.phone} · last reading ${patient.readings[0]?.at ? ago(patient.readings[0].at!, now) : '—'}`}
        onBack={onBack} right={<Pill color={band.color}>{band.label}</Pill>} />
      {toast.node}

      <div className="flex gap-1.5 overflow-x-auto pb-0.5 span-all" style={{ scrollbarWidth: 'none' }}>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold flex-shrink-0 transition-colors ${section === s.id ? 'bg-teal-700 text-white' : 'bg-gray-100 text-gray-500'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {section === 'overview' && (
        <>
          {open.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider">⚠ Active alerts ({open.length})</p>
              {open.map(a => <AlertCard key={a.id} a={a} onResolve={setResolveSheet} compact />)}
            </div>
          )}

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-3">Latest Readings</p>
            {patient.trackedVitalIds.length === 0 ? <p className="text-xs text-gray-400">No vitals assigned. Open the Vitals tab to assign.</p> : (
              <div className="grid grid-cols-3 gap-2">
                {patient.trackedVitalIds.map(vId => {
                  const def = vitalDefs.find(v => v.id === vId)
                  if (!def) return null
                  const latest = latestValid(patient, vId)
                  const l = latest ? evaluate(patient, def, latest.value) : null
                  return (
                    <VitalCard key={vId} def={def} value={latest?.value} level={l} at={latest?.at} now={now} onClick={() => setSection('vitals')} />
                  )
                })}
              </div>
            )}
          </div>

          <HealthSummary patient={patient} />

          <div className="grid grid-cols-3 gap-2">
            {[
              { v: `${score}`, l: 'Risk score', c: band.color === 'red' ? 'text-red-600' : band.color === 'amber' ? 'text-amber-600' : 'text-emerald-600' },
              { v: day.doses.total ? `${day.doses.taken}/${day.doses.total}` : '—', l: 'Doses today', c: 'text-teal-700' },
              { v: `${(patient.emergencyContacts ?? []).length}`, l: 'Emergency contacts', c: 'text-gray-700' },
            ].map(x => (
              <div key={x.l} className="bg-white rounded-2xl py-3 text-center shadow-sm">
                <p className={`text-lg font-black ${x.c}`}>{x.v}</p>
                <p className="text-[10px] text-gray-400 leading-tight">{x.l}</p>
              </div>
            ))}
          </div>

          {(patient.emergencyContacts ?? []).length > 0 && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-sm font-bold text-gray-900 mb-2">Emergency Contacts</p>
              {patient.emergencyContacts!.map(c => (
                <a key={c.id} href={`tel:${c.phone}`} className="flex justify-between py-1.5 text-xs">
                  <span className="text-gray-700 font-semibold">
                    {c.name} <span className="text-gray-400 font-normal">· {c.relationship}</span>
                    {c.nextOfKin && <span className="ml-1.5"><Pill color="teal">Next of kin</Pill></span>}
                  </span>
                  <span className="text-teal-700 font-bold">📞 {c.phone}</span>
                </a>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── VITALS ── */}
      {section === 'vitals' && (
        <>
          {patient.trackedVitalIds.map(id => {
            const def = vitalDefs.find(v => v.id === id)
            if (!def) return null
            const thr = targetRange(patient, def)
            const rows = patient.readings.filter(r => r.vitalId === id)
            return (
              <div key={id} className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-bold text-gray-900">{def.icon} {def.name}</p>
                  <p className="text-[11px] text-teal-700 font-semibold">Target {thr.min}–{thr.max} {def.unit}</p>
                </div>
                <VitalChart points={vitalTrend(patient, def, 0, now).points.slice(-14)} range={thr} height={56} />
                {/* the same filterable history the patient sees, with the doctor's own row action */}
                <VitalHistory patient={patient} def={def} rows={rows} total={rows.length} latestId={latestValid(patient, id)?.id}
                  className="mt-2 border border-gray-100 rounded-xl" listClassName="max-h-52"
                  action={r => !r.invalid && (
                    <button onClick={() => { setInvalidFor(r.id); setInvalidReason('') }} className="block ml-auto mt-1 text-[10px] text-gray-400 underline">Mark invalid</button>
                  )} />
              </div>
            )
          })}

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-1">Vital Assignment & Target Ranges</p>
            <p className="text-xs text-gray-400 mb-3">Toggle which vitals this patient records, and set a personal target range for each. Admin critical limits still apply.</p>
            {activeVitals.map(v => {
              const tracked = patient.trackedVitalIds.includes(v.id)
              const thr = targetRange(patient, v)
              return (
                <VitalThresholdRow key={v.id} vital={v} threshold={thr}
                  tracked={tracked} onToggleTracked={() => toggleAssign(v.id)}
                  isEditing={editing === v.id}
                  editMin={editing === v.id ? editMin : String(thr.min)}
                  editMax={editing === v.id ? editMax : String(thr.max)}
                  onStartEdit={() => startEdit(v)} onSave={() => saveThreshold(v.id)}
                  onMinChange={setEditMin} onMaxChange={setEditMax} />
              )
            })}
          </div>
        </>
      )}

      {/* ── MEDS ── */}
      {section === 'meds' && (
        <>
          <button onClick={() => setRxOpen(true)} className="w-full py-3 rounded-2xl bg-teal-700 text-white text-sm font-bold shadow">+ New Prescription</button>
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-2">Active ({activeRx.length})</p>
            {activeRx.length === 0 && <p className="text-xs text-gray-400">No active medications.</p>}
            {activeRx.map(x => {
              const slots = day.items.filter(s => s.kind === 'med' && s.refId === x.id)
              return (
                <div key={x.id} className="flex items-center gap-2 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-sm">💊</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900">{x.medication}</p>
                    <p className="text-[11px] text-gray-400">{x.frequency}{x.purpose ? ` · ${x.purpose}` : ''} · since {x.prescribedAt}</p>
                    {slots.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {slots.map(s => <Pill key={s.key} color={TONE_PILL[s.tone]}>{s.done ? '✓ ' : ''}{clock(s.slot)}{s.tone === 'late' ? ' missed' : ''}</Pill>)}
                      </div>
                    )}
                  </div>
                  <Pill color={slots.length && slots.every(s => s.done) ? 'green' : 'amber'}>{slots.filter(s => s.done).length}/{slots.length || '—'} today</Pill>
                  <button onClick={async () => { if ((await setPrescriptionActive(patient.id, x.id, false)).ok) toast.show(`${x.medication} stopped`) }}
                    className="text-[10px] text-red-500 font-bold ml-1">Stop</button>
                </div>
              )
            })}
          </div>
          {patient.prescriptions.some(x => !x.active) && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-sm font-bold text-gray-500 mb-2">Stopped</p>
              {patient.prescriptions.filter(x => !x.active).map(x => (
                <div key={x.id} className="flex items-center justify-between py-1.5 text-xs">
                  <span className="text-gray-500 line-through">{x.medication}</span>
                  <button onClick={() => setPrescriptionActive(patient.id, x.id, true)} className="text-[10px] text-teal-700 font-bold">Restart</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── NOTES ── */}
      {section === 'notes' && (
        <>
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-2">New Clinical Note</p>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="Observations and instructions. The latest note is shown to the patient."
              className={`${inputCls} resize-none`} />
            <button onClick={async () => { if ((await setDoctorNote(patient.id, note)).ok) { setNote(''); toast.show('Note saved and shared with patient') } }} disabled={!note.trim()}
              className={`w-full mt-2 py-2.5 rounded-xl text-sm font-bold ${note.trim() ? 'bg-teal-700 text-white' : 'bg-gray-200 text-gray-400'}`}>Save Note</button>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-2">History ({notes.length})</p>
            {notes.length === 0 && <p className="text-xs text-gray-400">No notes yet.</p>}
            {notes.map(n => (
              <div key={n.id} className="py-2 border-b border-gray-50 last:border-0">
                <p className="text-xs text-gray-800 leading-relaxed">{n.content}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{users.find(u => u.id === n.authorId)?.name} · {n.createdAt}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {section === 'messages' && <div className="span-all"><ChatThread meId={doctor.id} otherId={patient.id} otherName={patient.name} subtitle="Secure patient channel" /></div>}

      {section === 'docs' && <PatientDocs patient={patient} openId={docOpen} setOpenId={setDocOpen} onLink={followDocLink} buildOpen={buildOpen} setBuildOpen={setBuildOpen} />}

      {/* ── REPORT ── */}
      {section === 'report' && (
        <>
          <div className="rounded-2xl p-4 text-white" style={{ background: HERO_GRADIENT }}>
            <p className="text-[10px] text-white/60 uppercase tracking-wider font-bold">Vital Summary Report</p>
            <p className="text-base font-bold mt-0.5">{patient.name}</p>
            <p className="text-xs text-white/70">Generated {dateLabel()} · {doctor.name}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="grid grid-cols-2 gap-px bg-gray-100">
              {patient.trackedVitalIds.map(vId => {
                const def = vitalDefs.find(v => v.id === vId)
                const r = latestValid(patient, vId)
                if (!def || !r) return null
                const l = evaluate(patient, def, r.value)
                const thr = targetRange(patient, def)
                return (
                  <div key={vId} className={`p-3 ${l === 'normal' ? 'bg-white' : l === 'warning' ? 'bg-amber-50' : 'bg-red-50'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-base">{def.icon}</span>
                      <Pill color={l === 'normal' ? 'green' : l === 'warning' ? 'amber' : 'red'}>{l}</Pill>
                    </div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">{def.name}</p>
                    <p className="text-lg font-black leading-none mt-0.5 font-mono">{r.value} <span className="text-[10px] font-normal">{def.unit}</span></p>
                    <p className="text-[10px] text-teal-600 mt-0.5">Target {thr.min}–{thr.max}</p>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-3">Alert History</p>
            {alerts.filter(a => a.patientId === patient.id).map(a => (
              <div key={a.id} className="flex items-start gap-2 py-2 border-b border-gray-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900">{a.type === 'sos' ? 'SOS' : `${a.vitalName}: ${a.value} ${a.unit}`}</p>
                  <p className="text-[10px] text-gray-400">{a.loggedAt}</p>
                  {a.status === 'resolved' && <p className="text-[10px] text-emerald-700 mt-0.5">✓ {a.resolutionReason}{a.resolutionNote ? ` — ${a.resolutionNote}` : ''}</p>}
                </div>
                <AlertStatusPill alert={a} />
              </div>
            ))}
          </div>
          <button onClick={() => { setDocOpen(null); setSection('docs'); setBuildOpen(true) }}
            className="w-full py-3 rounded-2xl bg-teal-700 text-white text-sm font-bold shadow">📄 Build report for patient's documents</button>
          <p className="text-[10px] text-gray-400 text-center -mt-2">Choose the period, vitals and sections. Saved as a draft linked to its source readings — sign and release it from Docs.</p>
          <button onClick={() => window.print()} className="w-full py-3 rounded-2xl bg-white border border-gray-200 text-sm font-bold text-gray-700">🖨 Print / Save as PDF</button>
        </>
      )}

      <ResolveAlertSheet alert={resolveSheet} patientName={patient.name} onClose={() => setResolveSheet(null)} />

      <BottomSheet open={rxOpen} onClose={() => setRxOpen(false)} title="New Prescription" subtitle={`For ${patient.name}`}
        footer={<><SheetButton tone="ghost" onClick={() => setRxOpen(false)}>Cancel</SheetButton><SheetButton disabled={!rx.medication.trim() || !rx.dosage.trim()} onClick={prescribe}>Prescribe</SheetButton></>}>
        <AllergyBanner patient={patient} />
        <Field label="Medication *"><input value={rx.medication} onChange={e => setRx(f => ({ ...f, medication: e.target.value }))} placeholder="e.g. Amlodipine 5mg" className={inputCls} /></Field>
        <Field label="Dose *"><input value={rx.dosage} onChange={e => setRx(f => ({ ...f, dosage: e.target.value }))} placeholder="e.g. 5mg" className={inputCls} /></Field>
        <Field label="Frequency">
          <div className="grid grid-cols-2 gap-2">
            {['Once daily', 'Twice daily', 'Three times daily', 'Once at night', 'As needed', 'Weekly'].map(f => (
              <button key={f} onClick={() => setRx(x => ({ ...x, frequency: f }))}
                className={`py-2 rounded-xl text-xs font-semibold border-2 ${rx.frequency === f ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-100 bg-gray-50 text-gray-600'}`}>{f}</button>
            ))}
          </div>
        </Field>
        <Field label="Purpose"><input value={rx.purpose} onChange={e => setRx(f => ({ ...f, purpose: e.target.value }))} placeholder="e.g. Blood pressure" className={inputCls} /></Field>
      </BottomSheet>

      <BottomSheet open={!!invalidFor} onClose={() => setInvalidFor(null)} title="Mark Reading Invalid"
        subtitle="The reading stays in the record but is excluded from alerts and trends."
        footer={<><SheetButton tone="ghost" onClick={() => setInvalidFor(null)}>Cancel</SheetButton><SheetButton tone="danger" disabled={!invalidReason.trim()} onClick={async () => { const ok = !!invalidFor && (await invalidateReading(patient.id, invalidFor, invalidReason.trim())).ok; setInvalidFor(null); if (ok) toast.show('Reading marked invalid') }}>Mark Invalid</SheetButton></>}>
        <textarea value={invalidReason} onChange={e => setInvalidReason(e.target.value)} rows={3}
          placeholder="e.g. Cuff fitted incorrectly; patient re-measured." className={`${inputCls} resize-none`} />
      </BottomSheet>
    </div>
  )
}

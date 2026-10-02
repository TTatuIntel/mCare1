import { useState } from 'react'
import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import {
  Pill, AlertStatusPill, ResolveAlertSheet, ChatThread, BackHeader, VitalCard, HERO_GRADIENT,
  HealthSummary, EmptyState, ChipFilter, StatTiles, CareTeamCard,
} from '@/shared'
import { useVisits } from './useVisits'
import type { AppAlert, DocSourceLink } from '@/shared/lib/types'
import { evaluate, latestValid, riskScore, riskBand, targetRange, ago, dateLabel, resolvedHowLabel } from '@/shared/lib/vitals'
import { buildDaySchedule, apptWhen, splitAppts } from '@/shared/lib/schedule'
import { AlertCard } from './AlertCard'
import { PatientDocs } from './PatientDocs'
import { PatientNutrition } from './PatientNutrition'
import { PatientVitals } from './PatientVitals'
import { PatientMeds } from './PatientMeds'
import { PatientNotes } from './PatientNotes'
import { PatientCarePlan } from './PatientCarePlan'
import { isOfficial } from '@/shared/documents/documents'
import { useDoctor } from './useDoctor'

/* ─── Patient Detail ──────────────────────────────────────────────────
   One patient's record as their treating doctor sees it. Every section
   reads the same record the patient's own portal shows; nothing here is a
   copy. */
export type Section = 'overview' | 'vitals' | 'meds' | 'plan' | 'nutrition' | 'visits' | 'notes' | 'messages' | 'docs' | 'report'

export function PatientDetail({ patientId, onBack, initial = 'overview', initialDoc }: { patientId: string; onBack: () => void; initial?: Section; /** A document to open straight away (a link from an appointment). */ initialDoc?: string }) {
  const { documentsFor } = useApp()
  const { doctor, patient: find, vitalDefs, alerts, reportRequests, doses, mealsDone, mealPlanOf, unreadFrom, now } = useDoctor()
  const patient = find(patientId)
  const [section, setSection] = useState<Section>(initial)
  const [resolveSheet, setResolveSheet] = useState<AppAlert | null>(null)
  const [docOpen, setDocOpen] = useState<string | null>(initialDoc ?? null)
  /** The appointment a document link landed on. */
  const [focusVisit, setFocusVisit] = useState<string | undefined>()
  const visits = useVisits({ focusId: focusVisit, onDoc: id => { setDocOpen(id); setSection('docs') } })
  const [buildOpen, setBuildOpen] = useState(false)

  // No longer this doctor's patient (reassigned while the page was open): there is nothing they may show.
  if (!patient) return (
    <div className="flex flex-col gap-4">
      <BackHeader title="Patient" onBack={onBack} />
      <EmptyState icon="🔒" title="This patient is no longer under your care" text="Their record is open only to the doctor who treats them now." action="Back to patients" onAction={onBack} />
    </div>
  )

  // Drafts to sign plus reports the patient has asked for
  const unsigned = documentsFor(patient.id).filter(e => isOfficial(e.doc) && e.doc.status !== 'released').length
    + reportRequests.filter(r => r.patientId === patient.id && r.status === 'pending').length
  const followDocLink = (l: DocSourceLink) => {
    setDocOpen(null)
    setFocusVisit(l.kind === 'appointment' ? l.id : undefined)
    setSection(l.kind === 'reading' ? 'vitals' : l.kind === 'prescription' ? 'meds' : l.kind === 'note' ? 'notes' : l.kind === 'appointment' ? 'visits' : 'overview')
  }
  const patientVisits = splitAppts(visits.mine.filter(a => a.patientId === patientId))
  const nextVisit = patientVisits.upcoming.find(a => a.status === 'approved')
  const mine = alerts.filter(a => a.patientId === patient.id)
  const open = mine.filter(isActiveAlert)
  const unread = unreadFrom(patient.id)
  // Same schedule the patient ticks off on their Home / Meds tabs
  const planMeals = mealPlanOf(patient.id)?.meals
  const day = buildDaySchedule(patient, doses, mealsDone, now, [], planMeals?.length ? planMeals : undefined)
  const score = riskScore(patient, vitalDefs, open, now)
  const band = riskBand(score)

  const SECTIONS: { id: Section; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'vitals', label: 'Vitals' },
    { id: 'meds', label: 'Meds' },
    { id: 'plan', label: 'Care plan' },
    { id: 'nutrition', label: 'Nutrition' },
    { id: 'visits', label: `Visits${patientVisits.upcoming.length ? ` (${patientVisits.upcoming.length})` : ''}` },
    { id: 'notes', label: 'Notes' },
    { id: 'messages', label: `Chat${unread ? ` (${unread})` : ''}` },
    { id: 'docs', label: `Docs${unsigned ? ` (${unsigned})` : ''}` },
    { id: 'report', label: 'Report' },
  ]

  return (
    <div className="flex flex-col gap-4 card-flow">
      <BackHeader title={patient.name} subtitle={`${patient.phone} · last reading ${patient.readings[0]?.at ? ago(patient.readings[0].at!, now) : '—'}`}
        onBack={onBack} right={<Pill color={band.color}>{band.label}</Pill>} />
      {visits.toast}

      <ChipFilter label="Part of the record" tone="gray" options={SECTIONS} value={section} onChange={setSection} />

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
          <CareTeamCard patient={patient} canManage />

          <button onClick={() => setSection('visits')} className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center gap-3 text-left">
            <span className="w-10 h-10 rounded-2xl bg-teal-50 flex items-center justify-center text-lg flex-shrink-0" aria-hidden="true">📅</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold text-gray-900 truncate">{nextVisit ? nextVisit.title : 'No visit booked'}</span>
              <span className="block text-[11px] text-gray-500 truncate">
                {nextVisit ? `Next visit · ${apptWhen(nextVisit).date} · ${apptWhen(nextVisit).time}`
                  : patientVisits.upcoming.length ? `${patientVisits.upcoming.length} waiting for an answer` : 'Book one from Visits'}
              </span>
            </span>
            <span className="text-[11px] font-bold text-teal-700 flex-shrink-0">Visits →</span>
          </button>

          <StatTiles items={[
            { value: score, label: 'Risk score', tone: band.color === 'red' ? 'red' : band.color === 'amber' ? 'amber' : 'green' },
            { value: day.doses.total ? `${day.doses.taken}/${day.doses.total}` : '—', label: 'Doses today', tone: 'teal' },
            { value: (patient.emergencyContacts ?? []).length, label: 'Emergency contacts', tone: 'gray' },
          ]} />

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

      {section === 'vitals' && <PatientVitals patient={patient} />}
      {section === 'meds' && <PatientMeds patient={patient} />}
      {section === 'plan' && <PatientCarePlan patient={patient} />}
      {section === 'nutrition' && <PatientNutrition patient={patient} />}

      {/* ── VISITS ── */}
      {section === 'visits' && (
        <>
          <div className="span-all flex items-center justify-between">
            <p className="text-sm font-bold text-gray-900">Visits with {patient.name}</p>
            <button onClick={() => visits.book(patient.id)} className="text-xs bg-teal-700 text-white px-4 py-2 rounded-full font-bold">Book a visit</button>
          </div>
          {patientVisits.upcoming.length + patientVisits.history.length === 0 && (
            <div className="span-all"><EmptyState icon="📅" title="No visits yet" text="Book a visit, or wait for the patient to ask for one." /></div>
          )}
          {patientVisits.upcoming.map(visits.card)}
          {patientVisits.history.length > 0 && <p className="span-all text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-1 -mb-2">History · {patientVisits.history.length}</p>}
          {patientVisits.history.map(visits.card)}
        </>
      )}

      {section === 'notes' && <PatientNotes patient={patient} />}

      {section === 'messages' && <div className="span-all"><ChatThread meId={doctor.id} otherId={patient.id} otherName={patient.name} avatar={patient.avatar} subtitle="Secure patient channel" /></div>}

      {section === 'docs' && <PatientDocs patient={patient} openId={docOpen} setOpenId={setDocOpen} onLink={followDocLink} buildOpen={buildOpen} setBuildOpen={setBuildOpen} />}

      {/* ── REPORT ── */}
      {section === 'report' && (
        <>
          <div className="rounded-2xl p-4 text-white" style={{ background: HERO_GRADIENT }}>
            <p className="text-[10px] text-white/60 uppercase tracking-wider font-bold">Vital Summary</p>
            <p className="text-base font-bold mt-0.5">{patient.name}</p>
            <p className="text-xs text-white/70">As of {dateLabel()} · {doctor.name}</p>
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
            {!patient.trackedVitalIds.some(id => latestValid(patient, id)) && <p className="bg-white p-4 text-xs text-gray-400">No readings recorded yet.</p>}
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-3">Alert History</p>
            {mine.length === 0 && <p className="text-xs text-gray-400">No alerts have been raised for this patient.</p>}
            {mine.map(a => (
              // Opens the alert's full story: re-measurements, comments and how it ended. An open one can be worked from there.
              <button key={a.id} onClick={() => setResolveSheet(a)} className="w-full text-left flex items-start gap-2 py-2 border-b border-gray-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900">{a.type === 'sos' ? 'SOS' : `${a.vitalName}: ${a.value} ${a.unit}`}</p>
                  <p className="text-[10px] text-gray-400">
                    {a.loggedAt}
                    {(a.remeasureIds?.length ?? 0) > 0 && <> · <span className="font-mono">{a.remeasureIds!.length}</span> re-measured</>}
                    {(a.comments?.length ?? 0) > 0 && <> · <span className="font-mono">{a.comments!.length}</span> comment{a.comments!.length === 1 ? '' : 's'}</>}
                  </p>
                  {a.status === 'resolved' && <p className="text-[10px] text-emerald-700 mt-0.5">✓ {resolvedHowLabel(a)} · {a.resolutionReason}{a.resolutionNote ? ` · ${a.resolutionNote}` : ''}</p>}
                </div>
                <AlertStatusPill alert={a} />
              </button>
            ))}
          </div>
          <button onClick={() => { setDocOpen(null); setSection('docs'); setBuildOpen(true) }}
            className="w-full py-3 rounded-2xl bg-teal-700 text-white text-sm font-bold shadow span-all">📄 Build a report for the patient's documents</button>
          <p className="text-[10px] text-gray-400 text-center -mt-2 span-all">Choose the period, vitals and sections. It is saved as a draft linked to its source readings; sign, release, print or export it from Docs.</p>
        </>
      )}

      <ResolveAlertSheet alert={resolveSheet} patientName={patient.name} onClose={() => setResolveSheet(null)} />
      {visits.sheets}
    </div>
  )
}

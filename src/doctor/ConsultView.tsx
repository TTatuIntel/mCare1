import { isActiveAlert } from '@/shared/state/AppContext'
import { BackHeader, Pill, AlertStatusPill, VitalCard, VitalChart, HealthSummary, CarePlanCard, EmptyState, useSave, SaveError } from '@/shared'
import type { CareTeamMember, PatientUser } from '@/shared/lib/types'
import { NOTE_TYPE_LABELS } from '@/shared/lib/types'
import { evaluate, latestValid, targetRange, vitalTrend, ago } from '@/shared/lib/vitals'
import { useDoctor } from './useDoctor'

/* ─── A patient this doctor consults on ───────────────────────────────
   The same record the treating doctor works on, to read. Nothing here
   saves anything to the patient's record: the database would refuse it.
   Internal notes, documents and messages are not part of what a
   consulting doctor is given. */
export function ConsultView({ patient, member, onBack }: { patient: PatientUser; member: CareTeamMember; onBack: () => void }) {
  const { vitalDefs, alertsOf, notesFor, carePlansFor, nameOf, leaveCareTeam, now } = useDoctor()
  const leave = useSave()
  const alerts = alertsOf(patient.id)
  const open = alerts.filter(isActiveAlert)
  const meds = patient.prescriptions.filter(x => x.active)
  const notes = notesFor(patient.id).filter(n => !n.amendedBy)
  const plans = carePlansFor(patient.id).filter(p => p.status === 'active' || p.status === 'on_hold')
  const tracked = patient.trackedVitalIds.map(id => vitalDefs.find(v => v.id === id)).filter(v => !!v)

  return (
    <div className="flex flex-col gap-4 card-flow">
      <BackHeader title={patient.name} subtitle={`Treated by ${nameOf(patient.assignedDoctorId, 'no doctor at present')}`} onBack={onBack} right={<Pill color="blue">Consulting</Pill>} />

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 span-all">
        <p className="text-xs text-blue-800 leading-relaxed">
          You are a consulting doctor for this patient{member.reason ? ` (${member.reason})` : ''}: you can read the record and cannot change it.
          Prescribing, targets, notes and messages stay with the treating doctor.
        </p>
      </div>

      {open.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-900 mb-2">Open alerts ({open.length})</p>
          {open.map(a => (
            <div key={a.id} className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-50 last:border-0">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-900 font-mono">{a.type === 'sos' ? `SOS · ${a.value}` : `${a.vitalName}: ${a.value} ${a.unit}`}</p>
                <p className="text-[10px] text-gray-400">{ago(a.at, now)}</p>
              </div>
              <AlertStatusPill alert={a} />
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-sm font-bold text-gray-900 mb-3">Latest readings</p>
        {tracked.length === 0 ? <p className="text-xs text-gray-400">This patient is not recording any vital yet.</p> : (
          <div className="grid grid-cols-3 gap-2">
            {tracked.map(def => {
              const latest = latestValid(patient, def!.id)
              return <VitalCard key={def!.id} def={def!} value={latest?.value} level={latest ? evaluate(patient, def!, latest.value) : null} at={latest?.at} now={now} />
            })}
          </div>
        )}
      </div>

      <HealthSummary patient={patient} />

      {tracked.map(def => {
        const trend = vitalTrend(patient, def!, 30, now)
        if (trend.points.length === 0) return null
        const target = targetRange(patient, def!)
        return (
          <div key={def!.id} className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-900">{def!.icon} {def!.name}</p>
              <p className="text-[11px] text-teal-700 font-semibold">Target {target.min}–{target.max} {def!.unit}</p>
            </div>
            <p className="text-[10px] text-gray-400 mb-1">Last 30 days · {trend.points.length} reading{trend.points.length === 1 ? '' : 's'} · average <span className="font-mono">{trend.average}</span> · {trend.inRange} in range</p>
            <VitalChart points={trend.points} range={target} height={64} />
          </div>
        )
      })}

      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-sm font-bold text-gray-900 mb-2">Active medicines ({meds.length})</p>
        {meds.length === 0 && <p className="text-xs text-gray-400">None prescribed.</p>}
        {meds.map(x => (
          <div key={x.id} className="py-1.5 border-b border-gray-50 last:border-0">
            <p className="text-xs font-semibold text-gray-900">{x.medication} <span className="font-normal text-gray-500">· {x.dosage} · {x.frequency}</span></p>
            <p className="text-[10px] text-gray-400">{[x.purpose, x.instructions, `since ${x.prescribedAt}`].filter(Boolean).join(' · ')}</p>
          </div>
        ))}
      </div>

      {plans.map(p => <CarePlanCard key={p.id} plan={p} nameOf={id => nameOf(id, 'The treating doctor')} vitalName={id => vitalDefs.find(v => v.id === id)?.name} />)}

      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-sm font-bold text-gray-900 mb-2">Notes shared with the patient ({notes.length})</p>
        {notes.length === 0 && <p className="text-xs text-gray-400">None yet.</p>}
        {notes.slice(0, 10).map(n => (
          <div key={n.id} className="py-2 border-b border-gray-50 last:border-0">
            <p className="text-xs text-gray-800 leading-relaxed whitespace-pre-wrap">{n.content}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{NOTE_TYPE_LABELS[n.noteType]} · {nameOf(n.authorId, 'The treating doctor')} · {n.createdAt}</p>
          </div>
        ))}
      </div>

      {alerts.length === 0 && meds.length === 0 && tracked.length === 0 && (
        <div className="span-all"><EmptyState icon="🩺" title="Nothing recorded yet" text="This patient's readings, medicines and plan appear here as they are added." /></div>
      )}

      <div className="span-all">
        <SaveError message={leave.error} className="mb-2" />
        <button disabled={leave.busy} onClick={async () => { if ((await leave.run(() => leaveCareTeam(member.id))).ok) onBack() }}
          className="w-full py-3 rounded-2xl bg-white border border-gray-200 text-sm font-bold text-gray-700 disabled:opacity-50">{leave.busy ? 'Leaving…' : 'Leave this care team'}</button>
      </div>
    </div>
  )
}

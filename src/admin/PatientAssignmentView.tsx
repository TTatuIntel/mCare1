import { useEffect, useState } from 'react'
import { Avatar, Pill, BackHeader, BottomSheet, SheetButton, Field, inputCls, useSave, SaveError, useToast, CareTeamCard } from '@/shared'
import type { DoctorUser, PatientUser } from '@/shared/lib/types'
import DoctorPicker from './DoctorPicker'
import { useAdmin } from './useAdmin'

/* ─── One patient's care assignment ───────────────────────────────────
   Two separate permissions meet here, and each control follows its own:
   assigning a doctor ("Assign healthworkers") and answering the patient's
   own request for one ("Approve patient requests"). The database checks
   the same permission on the save. */
export default function PatientAssignmentView({ patient, onBack }: { patient: PatientUser; onBack: () => void }) {
  const { can, doctor, assignDoctor, answerDoctorRequest, assignmentsOf, nameOf, logRecordView } = useAdmin()
  useEffect(() => { logRecordView(patient.id, 'assignment') }, [patient.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const history = assignmentsOf(patient.id)
  const date = (ms?: number) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
  /** Why the doctor is changing: kept in the assignment history. Required to leave a patient with no doctor. */
  const [reason, setReason] = useState('')
  const [removing, setRemoving] = useState(false)
  const removeSave = useSave()
  const remove = async () => {
    if (reason.trim().length < 5) return
    if (!(await removeSave.run(() => assignDoctor(patient.id, null, reason.trim()))).ok) return
    setRemoving(false); setReason('')
    toast.show('Doctor removed · patient and doctor told')
  }
  const canAssign = can('assign_healthworkers')
  const canAnswer = can('approve_patient_requests')
  const assignedDoctor = doctor(patient.assignedDoctorId)
  const request = patient.doctorRequest
  const requestedDoctor = doctor(request?.doctorId)

  const [picker, setPicker] = useState<'assign' | 'alternative' | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [declining, setDeclining] = useState(false)
  const toast = useToast()
  const save = useSave()

  const pick = async (doctorId: string) => {
    const alternative = picker === 'alternative'
    const saved = await save.run(() => (alternative
      ? answerDoctorRequest(patient.id, false, rejectNote.trim(), doctorId)
      : assignDoctor(patient.id, doctorId, reason.trim() || undefined)))
    if (!saved.ok) return   // the picker stays open and shows why
    setPicker(null); setReason('')
    if (alternative) { setDeclining(false); setRejectNote('') }
    toast.show(alternative ? 'Request declined · another doctor assigned · patient told' : 'Doctor assigned · patient and doctor told')
  }
  const approve = async () => { if ((await save.run(() => answerDoctorRequest(patient.id, true))).ok) toast.show('Request approved · doctor assigned') }

  const docCard = (d: DoctorUser, extra?: React.ReactNode) => (
    <div className="flex items-center gap-3">
      <Avatar name={d.name} avatar={d.avatar} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900">{d.name}</p>
        <p className="text-xs text-gray-500">{d.specialty || 'No specialty given'}</p>
        <p className="text-[10px] text-gray-400 truncate">{d.hospital || 'No facility given'} · {d.assignedPatientIds.length} patient{d.assignedPatientIds.length === 1 ? '' : 's'}</p>
      </div>
      {extra}
    </div>
  )

  return (
    <div className="flex flex-col gap-4 card-flow">
      <BackHeader title={patient.name} subtitle="Care Assignment" onBack={onBack} />
      {toast.node && <div className="span-all">{toast.node}</div>}
      {!picker && save.error && <div className="span-all"><SaveError message={save.error} /></div>}

      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-sm font-bold text-gray-900 mb-3">Assigned Doctor</p>
        {assignedDoctor ? docCard(assignedDoctor, canAssign && (
          <button onClick={() => { save.clear(); setPicker('assign') }} className="text-xs border border-teal-200 text-teal-700 font-semibold px-2.5 py-1 rounded-full flex-shrink-0">Reassign</button>
        )) : patient.assignedDoctorId ? (
          <p className="text-xs text-gray-500">A doctor is assigned.</p>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-orange-500 font-semibold mb-1">No doctor assigned</p>
            <p className="text-xs text-gray-400 mb-3">This patient's alerts reach only the admin team until a doctor is assigned.</p>
            {canAssign && <button onClick={() => { save.clear(); setPicker('assign') }} className="bg-teal-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl">Assign a Doctor</button>}
          </div>
        )}
        {assignedDoctor && canAssign && (
          <>
            <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} aria-label="Reason for changing the doctor"
              placeholder="Reason for a change (kept in the history)" className={`${inputCls} mt-3`} />
            <button onClick={() => { removeSave.clear(); setRemoving(true) }} className="text-[11px] font-bold text-red-600 mt-2">Remove the doctor without assigning another…</button>
          </>
        )}
        {!canAssign && <p className="text-[11px] text-gray-400 mt-3">Assigning a doctor needs the “Assign healthworkers” permission.</p>}
      </div>

      <CareTeamCard patient={patient} canManage={canAssign} />

      {/* who has treated this patient, newest first */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-sm font-bold text-gray-900 mb-2">Assignment history</p>
        {history.length === 0 && <p className="text-xs text-gray-400">No doctor has been assigned yet.</p>}
        {history.map(a => (
          <div key={a.id} className="py-2 border-b border-gray-50 last:border-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-gray-900 truncate">{nameOf(a.doctorId, 'A doctor')}</p>
              <Pill color={a.endedAt ? 'gray' : 'green'}>{a.endedAt ? 'Ended' : 'Current'}</Pill>
            </div>
            <p className="text-[10px] text-gray-400">{date(a.startedAt)}{a.endedAt ? ` to ${date(a.endedAt)}` : ' to now'}{a.assignedBy ? ` · assigned by ${nameOf(a.assignedBy, 'staff')}` : ''}</p>
            {a.reason && <p className="text-[10px] text-gray-500">Why: {a.reason}</p>}
            {a.endReason && <p className="text-[10px] text-gray-500">Ended: {a.endReason}{a.endedBy ? ` · ${nameOf(a.endedBy, 'staff')}` : ''}</p>}
          </div>
        ))}
      </div>

      {request && (
        <div className={`rounded-2xl p-4 border ${request.status === 'pending' ? 'bg-teal-50 border-teal-100' : request.status === 'approved' ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-gray-900">Patient's Doctor Request</p>
            <Pill color={request.status === 'pending' ? 'teal' : request.status === 'approved' ? 'green' : 'red'}>
              {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
            </Pill>
          </div>
          {requestedDoctor && <div className="mb-3">{docCard(requestedDoctor)}</div>}
          <p className="text-[10px] text-gray-400 mb-3">Requested {request.requestedAt}</p>

          {request.status === 'pending' && !canAnswer && <p className="text-[11px] text-gray-500">Answering this request needs the “Approve patient requests” permission.</p>}
          {request.status === 'pending' && canAnswer && (!declining ? (
            <div className="flex gap-2">
              <button onClick={approve} disabled={save.busy} className="flex-1 py-2.5 bg-teal-700 text-white text-xs font-bold rounded-xl disabled:opacity-50">{save.busy ? 'Saving…' : 'Approve Request'}</button>
              <button onClick={() => { save.clear(); setDeclining(true) }} disabled={save.busy} className="flex-1 py-2.5 bg-red-50 text-red-600 text-xs font-bold rounded-xl">Decline</button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3} maxLength={300} aria-label="Reason for declining"
                placeholder="Reason the patient will read, e.g. that doctor is at full capacity this month." className={`${inputCls} resize-none bg-white`} />
              <p className="text-[11px] text-red-700">Next, choose another doctor, so the patient is not left without care.</p>
              <div className="flex gap-2">
                <button onClick={() => setDeclining(false)} className="flex-1 py-2 bg-gray-100 text-gray-600 text-xs font-semibold rounded-xl">Cancel</button>
                <button onClick={() => { save.clear(); setPicker('alternative') }} disabled={!rejectNote.trim()}
                  className={`flex-1 py-2 text-white text-xs font-bold rounded-xl ${rejectNote.trim() ? 'bg-teal-700' : 'bg-gray-300'}`}>Choose another doctor →</button>
              </div>
            </div>
          ))}

          {request.status === 'rejected' && request.responseNote && (
            <div className="bg-white rounded-xl p-2.5">
              <p className="text-[10px] text-red-500 font-semibold uppercase tracking-wide mb-0.5">Decline Reason</p>
              <p className="text-xs text-red-700">{request.responseNote}</p>
            </div>
          )}
        </div>
      )}

      <DoctorPicker open={!!picker} onClose={() => setPicker(null)} busy={save.busy} error={<SaveError message={save.error} />}
        title={picker === 'alternative' ? 'Choose another doctor' : 'Select a Doctor'}
        excludeId={picker === 'alternative' ? request?.doctorId : undefined}
        currentId={patient.assignedDoctorId} onPick={pick} />

      <BottomSheet open={removing} onClose={() => setRemoving(false)} title="Remove this patient's doctor?"
        subtitle={`${patient.name} will have no doctor. Their alerts then reach only the admin team, and nobody can prescribe or message them until one is assigned.`}
        footer={<><SheetButton tone="ghost" onClick={() => setRemoving(false)}>Cancel</SheetButton>
          <SheetButton tone="danger" disabled={reason.trim().length < 5 || removeSave.busy} onClick={remove}>{removeSave.busy ? 'Saving…' : 'Remove doctor'}</SheetButton></>}>
        <Field label="Reason *">
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={300} className={`${inputCls} resize-none`}
            placeholder="e.g. The patient has moved abroad and is leaving the programme." />
        </Field>
        <SaveError message={removeSave.error} />
      </BottomSheet>
    </div>
  )
}

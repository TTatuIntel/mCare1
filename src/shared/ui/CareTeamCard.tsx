import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { DoctorUser, PatientUser } from '@/shared/lib/types'
import { Avatar, Pill } from './primitives'
import { BottomSheet, SheetButton, Field, inputCls, SaveError, useSave, useToast } from './BottomSheet'

/* ─── A patient's care team ───────────────────────────────────────────
   The treating doctor, and any consulting doctors. A consulting doctor
   reads the record (readings, alerts, medicines, shared notes, the care
   plan) and changes nothing; documents, internal notes and messages stay
   with the treating doctor. The database decides who may add or remove
   one: `canManage` only decides whether the buttons are shown. */
export function CareTeamCard({ patient, canManage }: { patient: PatientUser; canManage: boolean }) {
  const { users, careTeam, getDoctors, addConsultingDoctor, removeConsultingDoctor } = useApp()
  const members = careTeam.filter(m => m.patientId === patient.id && !m.endedAt)
  const doctorOf = (id?: string) => users.find(u => u.id === id && u.role === 'doctor') as DoctorUser | undefined
  const treating = doctorOf(patient.assignedDoctorId)
  const choices = getDoctors().filter(d => d.status === 'active' && d.approvalStatus === 'approved'
    && d.id !== patient.assignedDoctorId && !members.some(m => m.doctorId === d.id))

  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const add = useSave()
  const remove = useSave()
  const toast = useToast()
  const submit = async () => {
    if (!picked) return
    if (!(await add.run(() => addConsultingDoctor(patient.id, picked, reason))).ok) return
    setAdding(false)
    toast.show('Consulting doctor added · they and the patient have been told')
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-gray-900">Care team</p>
        {canManage && (
          <button onClick={() => { add.clear(); setPicked(null); setReason(''); setAdding(true) }} className="text-[11px] font-bold text-teal-700">+ Consulting doctor</button>
        )}
      </div>
      {toast.node && <div className="mb-2">{toast.node}</div>}
      <SaveError message={remove.error} className="mb-2" />

      {treating ? (
        <div className="flex items-center gap-3 py-1.5">
          <Avatar name={treating.name} avatar={treating.avatar} size="xs" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-900 truncate">{treating.name}</p>
            <p className="text-[10px] text-gray-400 truncate">{treating.specialty || 'Doctor'}</p>
          </div>
          <Pill color="teal">Treating</Pill>
        </div>
      ) : <p className="text-xs text-gray-400 py-1.5">No treating doctor assigned.</p>}

      {members.map(m => {
        const d = doctorOf(m.doctorId)
        return (
          <div key={m.id} className="flex items-center gap-3 py-1.5 border-t border-gray-50">
            <Avatar name={d?.name ?? 'Doctor'} avatar={d?.avatar} size="xs" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900 truncate">{d?.name ?? 'A doctor'}</p>
              <p className="text-[10px] text-gray-400 truncate">{[d?.specialty, m.reason].filter(Boolean).join(' · ') || 'Consulting doctor'}</p>
            </div>
            <Pill color="blue">Consulting</Pill>
            {canManage && (
              <button disabled={remove.busy} onClick={async () => { if ((await remove.run(() => removeConsultingDoctor(m.id))).ok) toast.show('Removed from the care team') }}
                className="text-[10px] font-bold text-red-600 flex-shrink-0 disabled:opacity-50">Remove</button>
            )}
          </div>
        )
      })}
      <p className="text-[10px] text-gray-400 mt-2 leading-snug">A consulting doctor reads this record and cannot change it. Only the treating doctor prescribes, sets targets and messages the patient.</p>

      <BottomSheet open={adding} onClose={() => setAdding(false)} title="Add a consulting doctor"
        subtitle={`They will be able to read ${patient.name}'s record. They and the patient are told.`}
        footer={<><SheetButton tone="ghost" onClick={() => setAdding(false)}>Cancel</SheetButton>
          <SheetButton disabled={!picked || add.busy} onClick={submit}>{add.busy ? 'Adding…' : 'Add to care team'}</SheetButton></>}>
        <div className="flex flex-col gap-2 mb-3" role="radiogroup" aria-label="Doctors">
          {choices.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No other approved doctor is available.</p>}
          {choices.map(d => (
            <button key={d.id} role="radio" aria-checked={picked === d.id} onClick={() => setPicked(d.id)}
              className={`flex items-center gap-3 p-3 rounded-xl text-left border-2 ${picked === d.id ? 'border-teal-400 bg-teal-50' : 'border-gray-100 bg-gray-50'}`}>
              <Avatar name={d.name} avatar={d.avatar} size="xs" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{d.name}</p>
                <p className="text-xs text-gray-500 truncate">{[d.specialty, d.hospital].filter(Boolean).join(' · ') || 'Doctor'}</p>
              </div>
            </button>
          ))}
        </div>
        <Field label="Why (optional)">
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="e.g. Cardiology opinion" className={inputCls} />
        </Field>
        <SaveError message={add.error} />
      </BottomSheet>
    </div>
  )
}

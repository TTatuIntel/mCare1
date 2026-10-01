import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { DoctorUser } from '@/shared/lib/types'

export function DoctorStatusScreen() {
  const { currentUser, setCurrentUser, updateUser, getAdmins, notify } = useApp()
  const doctor = currentUser as DoctorUser
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ specialty: doctor.specialty, licenseNo: doctor.licenseNo, hospital: doctor.hospital, licenseFile: '' })

  if (editing) {
    const ok = form.specialty.trim() && form.licenseNo.trim() && form.hospital.trim()
    return (
      <div className="flex flex-col px-6 pt-8 pb-6 gap-4">
        <h2 className="text-xl font-bold text-gray-900 text-center font-display">Update Application</h2>
        {doctor.approvalNote && (
          <div className="rounded-2xl p-3 border bg-blue-50 border-blue-200">
            <p className="text-[10px] font-semibold text-blue-800 uppercase tracking-wide mb-0.5">Admin asked for</p>
            <p className="text-xs text-blue-800">{doctor.approvalNote}</p>
          </div>
        )}
        {([['Medical Specialty', 'specialty'], ['License Number', 'licenseNo'], ['Hospital / Clinic', 'hospital']] as const).map(([label, key]) => (
          <div key={key}>
            <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wide font-semibold">{label}</p>
            <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              className="w-full bg-gray-50 border-2 border-gray-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-teal-400" />
          </div>
        ))}
        <div>
          <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wide font-semibold">Licence Certificate</p>
          <label className="block border-2 border-dashed border-gray-200 rounded-2xl p-4 text-center cursor-pointer">
            <input type="file" accept=".pdf,image/*" className="hidden" onChange={e => setForm(f => ({ ...f, licenseFile: e.target.files?.[0]?.name ?? '' }))} />
            <p className="text-xs text-gray-500">{form.licenseFile || 'Tap to attach an updated licence (PDF or image)'}</p>
          </label>
        </div>
        <button disabled={!ok}
          onClick={() => {
            updateUser(doctor.id, { specialty: form.specialty.trim(), licenseNo: form.licenseNo.trim(), hospital: form.hospital.trim(), approvalStatus: 'pending', approvalNote: undefined, status: 'pending_approval' } as Partial<DoctorUser>)
            getAdmins().forEach(a => notify(a.id, 'account', 'Doctor application resubmitted', `${doctor.name} updated their details`, 'approvals'))
            setEditing(false)
          }}
          className={`w-full py-3.5 rounded-2xl text-sm font-bold shadow ${ok ? 'bg-teal-700 text-white' : 'bg-gray-200 text-gray-400'}`}>
          Resubmit for Review
        </button>
        <button onClick={() => setEditing(false)} className="text-xs text-gray-400 text-center">Cancel</button>
      </div>
    )
  }

  const isPending   = doctor.approvalStatus === 'pending'
  const isSentBack  = doctor.approvalStatus === 'sent_back'
  const isRejected  = doctor.approvalStatus === 'rejected'

  const icon    = isPending ? '⏳' : isSentBack ? '📋' : '❌'
  const title   = isPending ? 'Account Under Review' : isSentBack ? 'Additional Info Required' : 'Application Rejected'
  const color   = isPending ? 'bg-amber-50 border-amber-200' : isSentBack ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'
  const textCol = isPending ? 'text-amber-800' : isSentBack ? 'text-blue-800' : 'text-red-700'

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-5">
      <div className="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
        style={{ background: 'linear-gradient(135deg,#064f4f,#0a6e6e)' }}>{icon}</div>
      <div>
        <h2 className="text-xl font-bold text-gray-900 font-display">{title}</h2>
        <p className="text-sm text-gray-500 mt-1">{doctor.name}</p>
        <p className="text-xs text-gray-400">{doctor.specialty} · {doctor.hospital}</p>
      </div>

      {isPending && (
        <div className={`w-full rounded-2xl p-4 border ${color}`}>
          <p className={`text-sm leading-relaxed ${textCol}`}>
            Your registration is being reviewed by the Matendocare team. This typically takes 1–2 business days. You'll be notified by email once approved.
          </p>
        </div>
      )}

      {isSentBack && doctor.approvalNote && (
        <div className={`w-full rounded-2xl p-4 border ${color}`}>
          <p className={`text-xs font-semibold ${textCol} mb-1`}>Review Note from Admin</p>
          <p className={`text-sm leading-relaxed ${textCol}`}>{doctor.approvalNote}</p>
        </div>
      )}

      {isRejected && doctor.approvalNote && (
        <div className={`w-full rounded-2xl p-4 border ${color}`}>
          <p className={`text-xs font-semibold ${textCol} mb-1`}>Rejection Reason</p>
          <p className={`text-sm leading-relaxed ${textCol}`}>{doctor.approvalNote}</p>
        </div>
      )}

      {isSentBack && (
        <button onClick={() => setEditing(true)} className="w-full bg-teal-700 text-white font-bold py-3.5 rounded-2xl text-sm shadow">
          Resubmit Application
        </button>
      )}

      <button onClick={() => setCurrentUser(null)} className="text-xs text-gray-400">
        ← Sign in with another account
      </button>
    </div>
  )
}

import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Avatar, Pill, PageTitle, BackHeader, Toggle, BottomSheet, SheetButton, Field, inputCls } from '@/shared'
import { PERM_LABELS, ALL_PERMS } from '@/shared/lib/types'
import type {
  AdminUser, DoctorUser, PatientUser,
  AssistantPerm, UserRole,
} from '@/shared/lib/types'
import { can, isFullAdmin } from '@/assistant/permissions'
import PatientAssignmentView from './PatientAssignmentView'

/* ─── Users Tab ─────────────────────────────────────────────────────── */
export default function UsersTab({ admin }: { admin: AdminUser }) {
  const { users, addUser, getAdmins, getPatients, updateAssistantPerms, setUserStatus, logAudit } = useApp()
  const [actionUser, setActionUser] = useState<string | null>(null)
  const canSuspend = isFullAdmin(admin)
  const canAssign = can(admin, 'assign_healthworkers')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'patient' as UserRole })
  const [created, setCreated] = useState<{ name: string; code: string; role: string } | null>(null)
  const [filter, setFilter] = useState<UserRole | 'all'>('all')
  const [selectedAssistant, setSelectedAssistant] = useState<AdminUser | null>(null)
  const [selectedPatientForAssignment, setSelectedPatientForAssignment] = useState<PatientUser | null>(null)

  const canCreate = can(admin, 'create_users')

  const create = () => {
    if (!form.name.trim() || !form.email.trim()) return
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const id = `u${Date.now()}`
    const base = {
      id, name: form.name.trim(), email: form.email.trim(), phone: form.phone,
      role: form.role, status: 'unverified' as const,
      createdAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), verificationCode: code, password: code,
    }
    let user: import('@/shared/lib/types').AppUser
    if (form.role === 'patient') {
      user = { ...base, role: 'patient', trackedVitalIds: [], thresholds: {}, prescriptions: [], readings: [], profileSetup: 'pending' }
    } else if (form.role === 'doctor') {
      user = { ...base, role: 'doctor', status: 'unverified', specialty: '', licenseNo: '', hospital: '', approvalStatus: 'pending', assignedPatientIds: [] }
    } else {
      user = { ...base, role: form.role, isAssistant: form.role === 'assistant', permissions: [] }
    }
    addUser(user, { invited: true })
    logAudit('Created user', `${user.name} (${user.role})`)
    setCreated({ name: form.name.trim(), code, role: form.role })
    setForm({ name: '', email: '', phone: '', role: 'patient' })
    setShowForm(false)
  }

  const togglePerm = (assistantId: string, perm: AssistantPerm, current: AssistantPerm[]) => {
    const next = current.includes(perm) ? current.filter(p => p !== perm) : [...current, perm]
    updateAssistantPerms(assistantId, next)
    if (selectedAssistant?.id === assistantId) setSelectedAssistant(prev => prev ? { ...prev, permissions: next } : null)
  }

  const filtered = filter === 'all' ? users : users.filter(u => u.role === filter)

  const statusColor: Record<string, string> = {
    active: 'green', unverified: 'amber', pending_approval: 'blue', suspended: 'red',
  }
  const roleColor: Record<string, string> = {
    patient: 'teal', doctor: 'blue', admin: 'purple', assistant: 'purple',
  }

  // Patient care assignment detail view
  if (selectedPatientForAssignment) {
    const live = users.find(u => u.id === selectedPatientForAssignment.id) as PatientUser ?? selectedPatientForAssignment
    return (
      <div className="relative flex flex-col gap-0">
        <PatientAssignmentView patient={live} onBack={() => setSelectedPatientForAssignment(null)} />
      </div>
    )
  }

  // Permission detail view for an assistant
  if (selectedAssistant) {
    const live = getAdmins().find(a => a.id === selectedAssistant.id) ?? selectedAssistant
    return (
      <div className="flex flex-col gap-4 card-flow">
        <BackHeader title={live.name} subtitle={`mCare Assistant · ${live.email}`} onBack={() => setSelectedAssistant(null)}
          right={<Pill color="purple">{live.permissions.length}/{ALL_PERMS.length} perms</Pill>} />

        <div className="bg-teal-50 border border-teal-100 rounded-xl p-3">
          <p className="text-xs text-teal-800">
            Grant only the permissions this assistant needs to perform their duties. Changes take effect immediately.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-900 mb-3">Permission Gates</p>
          <div className="flex flex-col gap-0">
            {ALL_PERMS.map(perm => {
              const isOn = live.permissions.includes(perm)
              return (
                <div key={perm} className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{PERM_LABELS[perm]}</p>
                  </div>
                  <Toggle on={isOn} disabled={!isFullAdmin(admin)} onChange={() => isFullAdmin(admin) && togglePerm(live.id, perm, live.permissions)} />
                </div>
              )
            })}
          </div>
          {!isFullAdmin(admin) && (
            <p className="text-xs text-gray-400 italic mt-3">Only a full Admin can modify assistant permissions.</p>
          )}
          <p className="text-[10px] text-gray-400 mt-3 leading-snug">
            Clinical approval — signing and releasing reports, prescribing — belongs to the treating doctor and is never included in any assistant permission.
            Document Support gives metadata and recovery only, never document content.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 card-flow">
      <PageTitle title="Users" action={canCreate ? '+ Register' : undefined} onAction={() => setShowForm(true)} />

      {created && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-emerald-800">✓ {created.name} registered!</p>
          <p className="text-xs text-emerald-700 mt-0.5">
            Verification code sent to their email{created.role === 'doctor' ? '. They must verify, then complete their professional profile before appearing in Approvals.' : '.'} Demo code:
          </p>
          <p className="text-2xl font-black text-teal-700 mt-1 font-mono">{created.code}</p>
          <button onClick={() => setCreated(null)} className="text-xs text-emerald-600 font-semibold mt-1">Dismiss</button>
        </div>
      )}

      {/* Role filter */}
      <div className="flex gap-1.5 overflow-x-auto span-all" style={{ scrollbarWidth: 'none' }}>
        {(['all', 'patient', 'doctor', 'admin', 'assistant'] as const).map(r => (
          <button key={r} onClick={() => setFilter(r)}
            className={`flex-shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-full transition-colors ${filter === r ? 'bg-teal-700 text-white' : 'bg-white text-gray-500 shadow-sm'}`}>
            {r.charAt(0).toUpperCase() + r.slice(1)}
          </button>
        ))}
      </div>

      {/* cards on mobile; on tablet and web the same rows line up as one table */}
      <div className="span-all flex flex-col gap-4 @2xl:gap-0 @2xl:bg-white @2xl:rounded-2xl @2xl:shadow-sm @2xl:divide-y @2xl:divide-gray-50 @2xl:overflow-hidden" role="table" aria-label="Users">
      <div className={`hidden @2xl:grid @2xl:grid-cols-[2.25rem_minmax(0,1.2fr)_minmax(0,1.4fr)_6rem_8.5rem_1rem] @2xl:gap-x-4 px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider`} role="row">
        <span /><span role="columnheader">Name</span><span role="columnheader">Email</span><span role="columnheader">Role</span><span role="columnheader">Status</span><span />
      </div>
      {filtered.map(u => {
        const isAssistant = u.role === 'assistant'
        const isPatient = u.role === 'patient'
        const patient = isPatient ? u as PatientUser : null
        const hasPendingRequest = patient?.doctorRequest?.status === 'pending'
        const isClickable = u.id !== admin.id

        return (
          <button
            key={u.id}
            onClick={() => { if (isClickable) setActionUser(u.id) }}
            role="row"
            className={`bg-white rounded-2xl px-4 py-3.5 flex items-center gap-3 shadow-sm text-left transition-colors @2xl:rounded-none @2xl:shadow-none @2xl:py-2.5 @2xl:grid @2xl:grid-cols-[2.25rem_minmax(0,1.2fr)_minmax(0,1.4fr)_6rem_8.5rem_1rem] @2xl:gap-x-4 ${isClickable ? 'active:bg-gray-50 cursor-pointer @2xl:hover:bg-gray-50' : 'cursor-default'}`}
          >
            <div className="relative w-9 h-9 flex-shrink-0">
              <Avatar name={u.name} avatar={u.avatar} size="xs" />
              {hasPendingRequest && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-teal-500 border-2 border-white" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900">{u.name}</p>
              <p className="text-[10px] text-gray-400 truncate @2xl:hidden">{u.email}</p>
              {isPatient && (
                <p className="text-[9px] mt-0.5 font-medium">
                  {hasPendingRequest
                    ? <span className="text-teal-600">● Doctor request pending</span>
                    : patient?.assignedDoctorId
                    ? <span className="text-gray-400">Doctor assigned</span>
                    : <span className="text-orange-500">No doctor assigned</span>
                  }
                </p>
              )}
            </div>
            <p className="hidden @2xl:block text-xs text-gray-500 truncate">{u.email}</p>
            <div className="flex flex-col items-end gap-1 flex-shrink-0 @2xl:contents">
              <span><Pill color={roleColor[u.role] ?? 'gray'}>{u.role}</Pill></span>
              <span><Pill color={statusColor[u.status] ?? 'gray'}>{u.status.replace(/_/g, ' ')}</Pill></span>
            </div>
            {isClickable && (
              <svg className="w-4 h-4 text-gray-300 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </button>
        )
      })}
      </div>

      <BottomSheet open={showForm} onClose={() => setShowForm(false)} title="Register New User"
        subtitle="They receive a verification code and set up their own account."
        footer={<><SheetButton tone="ghost" onClick={() => setShowForm(false)}>Cancel</SheetButton><SheetButton disabled={!form.name.trim() || !/^\S+@\S+\.\S+$/.test(form.email.trim()) || users.some(x => x.email.toLowerCase() === form.email.trim().toLowerCase())} onClick={create}>Register User</SheetButton></>}>
        {([['Full Name *', 'name', 'e.g. Grace Otieno', 'text'], ['Email Address *', 'email', 'email@example.com', 'email'], ['Phone Number', 'phone', '+254 7XX XXX XXX', 'tel']] as const).map(([label, key, ph, type]) => (
          <Field key={key} label={label}>
            <input type={type} value={form[key]} placeholder={ph} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className={inputCls} />
          </Field>
        ))}
        {users.some(x => x.email.toLowerCase() === form.email.trim().toLowerCase()) && <p className="text-xs text-red-500 -mt-2 mb-2">That email is already registered.</p>}
        <Field label="Role">
          <div className="grid grid-cols-2 gap-2">
            {(['patient', 'doctor', 'admin', 'assistant'] as UserRole[]).filter(r => isFullAdmin(admin) || r === 'patient' || r === 'doctor').map(r => (
              <button key={r} onClick={() => setForm(f => ({ ...f, role: r }))}
                className={`py-2.5 rounded-xl text-xs font-bold border-2 ${form.role === r ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-gray-600 border-gray-200'}`}>
                {r === 'assistant' ? 'mCare Assistant' : r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
        </Field>
      </BottomSheet>

      {(() => {
        const u = users.find(x => x.id === actionUser)
        if (!u) return null
        const suspended = u.status === 'suspended'
        const close = () => setActionUser(null)
        return (
          <BottomSheet open onClose={close} title={u.name} subtitle={`${u.role === 'assistant' ? 'mCare Assistant' : u.role} · ${u.email} · ${u.status.replace(/_/g, ' ')}`}
            footer={<SheetButton tone="ghost" onClick={close}>Close</SheetButton>}>
            <div className="flex flex-col gap-2">
              {u.role === 'patient' && canAssign && (
                <button onClick={() => { setSelectedPatientForAssignment(u as PatientUser); close() }}
                  className="text-left px-4 py-3 rounded-xl bg-gray-50 text-sm font-semibold text-gray-800">🩺 Manage care assignment</button>
              )}
              {u.role === 'assistant' && isFullAdmin(admin) && (
                <button onClick={() => { setSelectedAssistant(u as AdminUser); close() }}
                  className="text-left px-4 py-3 rounded-xl bg-gray-50 text-sm font-semibold text-gray-800">🛡️ Edit permissions</button>
              )}
              {u.role === 'doctor' && (
                <div className="px-4 py-3 rounded-xl bg-gray-50 text-xs text-gray-600">
                  {(u as DoctorUser).specialty || '—'} · {(u as DoctorUser).hospital || '—'} · {(u as DoctorUser).assignedPatientIds.length} patients
                </div>
              )}
              {canSuspend && u.status !== 'unverified' && (
                <button onClick={() => {
                  if (!suspended && u.role === 'doctor' && (u as DoctorUser).assignedPatientIds.length > 0) return
                  setUserStatus(u.id, suspended ? 'active' : 'suspended'); close()
                }}
                  className={`text-left px-4 py-3 rounded-xl text-sm font-semibold ${suspended ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'} ${!suspended && u.role === 'doctor' && (u as DoctorUser).assignedPatientIds.length > 0 ? 'opacity-50' : ''}`}>
                  {suspended ? '✓ Reactivate account' : '⛔ Suspend account'}
                </button>
              )}
              {!suspended && u.role === 'doctor' && (u as DoctorUser).assignedPatientIds.length > 0 && canSuspend && (
                <p className="text-[11px] text-gray-500">Reassign this doctor's {(u as DoctorUser).assignedPatientIds.length} patients before suspending.</p>
              )}
              {!canSuspend && <p className="text-[11px] text-gray-400">Only a full Admin can suspend accounts.</p>}
            </div>
          </BottomSheet>
        )
      })()}
    </div>
  )
}

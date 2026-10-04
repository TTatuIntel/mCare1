import { useState } from 'react'
import {
  Avatar, Pill, Page, EmptyState, BackHeader, Toggle, Chevron, ChipFilter, BottomSheet, SheetButton, Field, inputCls,
  useSave, SaveError, useAct,
} from '@/shared'
import { PERM_LABELS, ALL_PERMS } from '@/shared/lib/types'
import type { AccountStatus, AdminUser, AppUser, AssistantPerm, DoctorUser, PatientUser, UserRole } from '@/shared/lib/types'
import PatientAssignmentView from './PatientAssignmentView'
import { useAdmin } from './useAdmin'

const STATUS_COLOR: Record<string, string> = { active: 'green', unverified: 'amber', pending_approval: 'blue', suspended: 'red', deactivated: 'gray' }
const ROLE_COLOR: Record<string, string> = { patient: 'teal', doctor: 'blue', admin: 'purple', assistant: 'purple' }
const ROLE_LABEL: Record<UserRole, string> = { patient: 'Patient', doctor: 'Doctor', admin: 'Admin', assistant: 'mCare Assistant' }
const ROLES: { id: UserRole | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'patient', label: 'Patients' }, { id: 'doctor', label: 'Doctors' }, { id: 'admin', label: 'Admins' }, { id: 'assistant', label: 'Assistants' },
]
const STATUSES: { id: AccountStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Any status' }, { id: 'active', label: 'Active' }, { id: 'pending_approval', label: 'Awaiting approval' },
  { id: 'suspended', label: 'Suspended' }, { id: 'deactivated', label: 'Deactivated' },
]
const STOP: Record<'suspended' | 'deactivated' | 'active', { title: string; button: string; done: string; text: string }> = {
  suspended:   { title: 'Suspend this account?', button: 'Suspend', done: 'suspended',
    text: 'For an account that must stop for now. They can no longer read or change anything in mCare, even if they are signed in. Their record and everything they did are kept.' },
  deactivated: { title: 'Deactivate this account?', button: 'Deactivate', done: 'deactivated',
    text: 'For someone who has left. The account is closed and can no longer be used. Their record and everything they did are kept.' },
  active:      { title: 'Reactivate this account?', button: 'Reactivate', done: 'reactivated', text: 'They can sign in again and reach what their role allows.' },
}
const COLS = '@2xl:grid @2xl:grid-cols-[2.25rem_minmax(0,1.2fr)_minmax(0,1.4fr)_6rem_8.5rem_1rem] @2xl:gap-x-4'
const statusLabel = (s: string) => s.replace(/_/g, ' ')

/* ─── Users ───────────────────────────────────────────────────────────
   Everyone with an mCare account, and those registered in advance who
   have not signed up yet. One person is one account: a role is a property
   of the account, not a second identity. */
export default function UsersTab() {
  const { admin, full, can, people, invitations, staff, patient: patientById, invite, withdrawInvitation, setPermissions, setStatus, updateDetails, resetTwoStep, now, status, error, reload } = useAdmin()
  const canSupport = can('handle_support')
  const canCreate = can('create_users')
  const canAssign = can('assign_healthworkers', 'approve_patient_requests')
  const act = useAct()

  /* finding someone */
  const [role, setRole] = useState<UserRole | 'all'>('all')
  const [state, setState] = useState<AccountStatus | 'all'>('all')
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const found = people.filter(u => (role === 'all' || u.role === role) && (state === 'all' || u.status === state)
    && (!needle || `${u.name} ${u.email} ${u.phone}`.toLowerCase().includes(needle)))

  /* registering someone */
  const [form, setForm] = useState<{ name: string; email: string; phone: string; role: UserRole } | null>(null)
  const [created, setCreated] = useState<{ name: string; code?: string; role: UserRole } | null>(null)
  const saving = useSave()
  const email = form?.email.trim().toLowerCase() ?? ''
  const emailTaken = !!email && people.some(x => x.email.toLowerCase() === email)
  const alreadyInvited = !!email && invitations.some(x => x.email === email)
  const create = async () => {
    if (!form) return
    const { name, role: r } = form
    // Nothing is shown as registered until it has been saved.
    const saved = await saving.run(() => invite(form))
    if (!saved.ok) return
    setCreated({ name: name.trim(), code: saved.value.code, role: r })
    setForm(null)
  }

  /* one person */
  const [openId, setOpenId] = useState<string | null>(null)
  const [permsFor, setPermsFor] = useState<string | null>(null)
  const [assignFor, setAssignFor] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ user: AppUser; to: 'suspended' | 'deactivated' | 'active' } | null>(null)
  const [why, setWhy] = useState('')
  const statusSave = useSave()
  const needsWhy = !!confirm && confirm.to !== 'active'
  const changeStatus = async () => {
    if (!confirm || (needsWhy && why.trim().length < 5)) return
    const { user, to } = confirm
    if (!(await statusSave.run(() => setStatus(user.id, to, why.trim() || undefined))).ok) return
    setConfirm(null); setOpenId(null)
    act.say(`${user.name} ${STOP[to].done}`)
  }
  const askStatus = (user: AppUser, to: 'suspended' | 'deactivated' | 'active') => { statusSave.clear(); setWhy(''); setConfirm({ user, to }) }

  /* support acting for someone: their details, or their two-step sign-in, always with the reason */
  const [details, setDetails] = useState<{ user: AppUser; name: string; phone: string; dob: string; why: string } | null>(null)
  const [reset, setReset] = useState<{ user: AppUser; why: string } | null>(null)
  const supportSave = useSave()
  const saveDetails = async () => {
    if (!details) return
    const { user, name, phone, dob } = details
    if (!(await supportSave.run(() => updateDetails(user.id, { name, phone, dob }, details.why))).ok) return
    setDetails(null); setOpenId(null)
    act.say(`${name.trim()}'s details updated; they have been told`)
  }
  const doReset = async () => {
    if (!reset) return
    if (!(await supportSave.run(() => resetTwoStep(reset.user.id, reset.why))).ok) return
    act.say(`Two-step sign-in reset for ${reset.user.name}; they have been told`)
    setReset(null); setOpenId(null)
  }

  // Care assignment for one patient
  const assigning = patientById(assignFor)
  if (assigning) return <PatientAssignmentView patient={assigning} onBack={() => setAssignFor(null)} />

  // Permissions of one assistant
  const assistant = staff.find(a => a.id === permsFor)
  if (assistant) {
    const toggle = (perm: AssistantPerm) => {
      const on = assistant.permissions.includes(perm)
      const next = on ? assistant.permissions.filter(p => p !== perm) : [...assistant.permissions, perm]
      // The switch moves once the change is saved; the assistant is told and it is audited.
      void act.run(() => setPermissions(assistant.id, next), `${PERM_LABELS[perm]} ${on ? 'removed' : 'granted'}`)
    }
    return (
      <div className="flex flex-col gap-4 card-flow">
        <BackHeader title={assistant.name} subtitle={`mCare Assistant · ${assistant.email}`} onBack={() => setPermsFor(null)}
          right={<Pill color="purple">{assistant.permissions.length}/{ALL_PERMS.length} granted</Pill>} />
        {act.node && <div className="span-all">{act.node}</div>}

        <div className="bg-teal-50 border border-teal-100 rounded-xl p-3">
          <p className="text-xs text-teal-800">Grant only what this assistant needs. A change applies from their next action and is recorded in the audit log.</p>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-900 mb-1">Permissions</p>
          {ALL_PERMS.map(perm => (
            <div key={perm} className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
              <p className="flex-1 text-sm font-medium text-gray-900">{PERM_LABELS[perm]}</p>
              <Toggle on={assistant.permissions.includes(perm)} disabled={!full || act.busy} label={PERM_LABELS[perm]} onChange={() => full && toggle(perm)} />
            </div>
          ))}
          {!full && <p className="text-xs text-gray-400 italic mt-3">Only a full Admin can change an assistant's permissions.</p>}
          <p className="text-[10px] text-gray-400 mt-3 leading-snug">
            Signing and releasing reports and prescribing belong to the treating doctor and are not part of any permission.
            Document Support gives metadata and recovery only, never a document's content.
          </p>
        </div>
      </div>
    )
  }

  const selected = people.find(x => x.id === openId)

  return (
    <Page title="Users" actions={canCreate ? (
      <button onClick={() => { saving.clear(); setForm({ name: '', email: '', phone: '', role: 'patient' }) }}
        className="text-xs font-semibold text-teal-700 border border-teal-200 px-3 py-1.5 rounded-full">+ Register</button>
    ) : undefined} meta={`${people.length} accounts`} status={status} error={error} onRetry={reload}>
      {act.node && <div className="span-all">{act.node}</div>}

      {created && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 span-all">
          <p className="text-sm font-bold text-emerald-800">✓ {created.name} registered</p>
          {created.code ? (
            <>
              <p className="text-xs text-emerald-700 mt-0.5">
                Verification code sent to their email{created.role === 'doctor' ? '. They must verify, then complete their professional profile before appearing in Approvals.' : '.'}
              </p>
              <p className="text-2xl font-black text-teal-700 mt-1 font-mono">{created.code}</p>
            </>
          ) : (
            <p className="text-xs text-emerald-700 mt-0.5 leading-relaxed">
              Ask them to sign up in mCare with that email address. They choose their own password
              {created.role === 'doctor' ? ', then wait in Approvals like every doctor.'
                : created.role === 'patient' ? ' and start as a patient straight away.'
                : `, and become ${created.role === 'admin' ? 'an admin' : 'an assistant'} once they confirm the address.`}
            </p>
          )}
          <button onClick={() => setCreated(null)} className="text-xs text-emerald-600 font-semibold mt-1">Dismiss</button>
        </div>
      )}

      {/* registered in advance, not signed up yet */}
      {canCreate && invitations.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm span-all">
          <p className="text-sm font-bold text-gray-900">Waiting to sign up ({invitations.length})</p>
          <p className="text-[11px] text-gray-400 mb-2">Registered here; the account appears below once they sign up with this email.</p>
          {invitations.map(i => {
            const expired = i.expiresAt < now
            const mayWithdraw = full || i.role === 'patient' || i.role === 'doctor'
            return (
              <div key={i.id} className="flex items-center gap-2 py-2 border-b border-gray-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900 truncate">{i.name}</p>
                  <p className="text-[10px] text-gray-400 truncate">{i.email} · registered {i.createdAt}</p>
                </div>
                <Pill color={ROLE_COLOR[i.role] ?? 'gray'}>{ROLE_LABEL[i.role]}</Pill>
                {expired && <Pill color="gray">Expired</Pill>}
                {mayWithdraw && (
                  <button disabled={act.busy} onClick={() => act.run(() => withdrawInvitation(i.id), `Registration of ${i.name} withdrawn`)}
                    className="text-[10px] text-red-600 font-bold flex-shrink-0 disabled:opacity-50">Withdraw</button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, email or phone…" aria-label="Search users" className={`${inputCls} span-all`} />
      <ChipFilter label="Role" options={ROLES} value={role} onChange={setRole} />
      <ChipFilter label="Account status" options={STATUSES} value={state} onChange={setState} />

      {found.length === 0 && (
        <div className="span-all"><EmptyState icon="🔎" title="Nobody matches" text="Try another name, or clear the filters." /></div>
      )}

      {/* cards on mobile; on tablet and web the same rows line up as one table */}
      {found.length > 0 && (
        <div className="span-all flex flex-col gap-4 @2xl:gap-0 @2xl:bg-white @2xl:rounded-2xl @2xl:shadow-sm @2xl:divide-y @2xl:divide-gray-50 @2xl:overflow-hidden" role="table" aria-label="Users">
          <div className={`hidden ${COLS} px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider`} role="row">
            <span /><span role="columnheader">Name</span><span role="columnheader">Email</span><span role="columnheader">Role</span><span role="columnheader">Status</span><span />
          </div>
          {found.map(u => {
            const pt = u.role === 'patient' ? u as PatientUser : null
            const requesting = pt?.doctorRequest?.status === 'pending'
            const me = u.id === admin.id
            return (
              <button key={u.id} onClick={() => { if (!me) setOpenId(u.id) }} role="row"
                className={`bg-white rounded-2xl px-4 py-3.5 flex items-center gap-3 shadow-sm text-left transition-colors @2xl:rounded-none @2xl:shadow-none @2xl:py-2.5 ${COLS} ${me ? 'cursor-default' : 'active:bg-gray-50 cursor-pointer @2xl:hover:bg-gray-50'}`}>
                <div className="relative w-9 h-9 flex-shrink-0">
                  <Avatar name={u.name} avatar={u.avatar} size="xs" />
                  {requesting && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-teal-500 border-2 border-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{u.name}{me ? ' (you)' : ''}</p>
                  <p className="text-[10px] text-gray-400 truncate @2xl:hidden">{u.email}</p>
                  {pt && (
                    <p className="text-[9px] mt-0.5 font-medium">
                      {requesting ? <span className="text-teal-600">● Doctor request pending</span>
                        : pt.assignedDoctorId ? <span className="text-gray-400">Doctor assigned</span>
                        : <span className="text-orange-500">No doctor assigned</span>}
                    </p>
                  )}
                </div>
                <p className="hidden @2xl:block text-xs text-gray-500 truncate">{u.email}</p>
                <div className="flex flex-col items-end gap-1 flex-shrink-0 @2xl:contents">
                  <span><Pill color={ROLE_COLOR[u.role] ?? 'gray'}>{ROLE_LABEL[u.role]}</Pill></span>
                  <span><Pill color={STATUS_COLOR[u.status] ?? 'gray'}>{statusLabel(u.status)}</Pill></span>
                </div>
                {me ? <span /> : <Chevron />}
              </button>
            )
          })}
        </div>
      )}

      <BottomSheet open={!!form} onClose={() => setForm(null)} title="Register New User"
        subtitle="They set up their own account and password with this email address."
        footer={<><SheetButton tone="ghost" onClick={() => setForm(null)}>Cancel</SheetButton>
          <SheetButton disabled={saving.busy || !form?.name.trim() || !/^\S+@\S+\.\S+$/.test(email) || emailTaken || alreadyInvited} onClick={create}>{saving.busy ? 'Registering…' : 'Register User'}</SheetButton></>}>
        {form && (
          <>
            {([['Full Name *', 'name', 'Their full name', 'text'], ['Email Address *', 'email', 'email@example.com', 'email'], ['Phone Number', 'phone', 'With country code', 'tel']] as const).map(([label, key, ph, type]) => (
              <Field key={key} label={label}>
                <input type={type} value={form[key]} placeholder={ph} onChange={e => setForm({ ...form, [key]: e.target.value })} className={inputCls} />
              </Field>
            ))}
            {(emailTaken || alreadyInvited) && <p className="text-xs text-red-500 -mt-2 mb-2">{emailTaken ? 'That email is already registered.' : 'That email is already waiting to sign up.'}</p>}
            <Field label="Role">
              <div className="grid grid-cols-2 gap-2">
                {(['patient', 'doctor', 'admin', 'assistant'] as UserRole[]).filter(r => full || r === 'patient' || r === 'doctor').map(r => (
                  <button key={r} onClick={() => setForm({ ...form, role: r })}
                    className={`py-2.5 rounded-xl text-xs font-bold border-2 ${form.role === r ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-gray-600 border-gray-200'}`}>
                    {ROLE_LABEL[r]}
                  </button>
                ))}
              </div>
            </Field>
            <SaveError message={saving.error} />
          </>
        )}
      </BottomSheet>

      {/* one person: who they are, and what this member of staff may do with the account */}
      <BottomSheet open={!!selected && !confirm && !details && !reset} onClose={() => setOpenId(null)} title={selected?.name}
        subtitle={selected ? `${ROLE_LABEL[selected.role]} · ${statusLabel(selected.status)}` : ''}
        footer={<SheetButton tone="ghost" onClick={() => setOpenId(null)}>Close</SheetButton>}>
        {selected && (
          <div className="flex flex-col gap-2">
            <div className="rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-600 leading-relaxed">
              <p>{selected.email}</p>
              {selected.phone && <p>{selected.phone}</p>}
              <p className="text-gray-400">Joined {selected.createdAt}</p>
              {(selected.status === 'suspended' || selected.status === 'deactivated') && (
                <p className="text-red-600 mt-1">{selected.status === 'suspended' ? 'Suspended' : 'Deactivated'}{selected.statusChangedAt ? ` ${selected.statusChangedAt}` : ''}{selected.statusReason ? ` · ${selected.statusReason}` : ''}</p>
              )}
              {selected.role === 'doctor' && (() => {
                const d = selected as DoctorUser
                return <p className="mt-1">{d.specialty || 'No specialty given'} · {d.hospital || 'No facility given'} · licence <span className="font-mono">{d.licenseNo || '—'}</span> · {d.assignedPatientIds.length} patient{d.assignedPatientIds.length === 1 ? '' : 's'}</p>
              })()}
              {selected.role === 'assistant' && full && <p className="mt-1">{(selected as AdminUser).permissions.length} of {ALL_PERMS.length} permissions granted</p>}
            </div>
            {selected.role === 'patient' && canAssign && (
              <button onClick={() => { setAssignFor(selected.id); setOpenId(null) }}
                className="text-left px-4 py-3 rounded-xl bg-gray-50 text-sm font-semibold text-gray-800">🩺 Manage care assignment</button>
            )}
            {selected.role === 'assistant' && full && (
              <button onClick={() => { act.clear(); setPermsFor(selected.id); setOpenId(null) }}
                className="text-left px-4 py-3 rounded-xl bg-gray-50 text-sm font-semibold text-gray-800">🛡️ Edit permissions</button>
            )}
            {(canSupport && (selected.role === 'patient' || selected.role === 'doctor' || full)) && (
              <button onClick={() => { supportSave.clear(); setDetails({ user: selected, name: selected.name, phone: selected.phone, dob: selected.dob ?? '', why: '' }) }}
                className="text-left px-4 py-3 rounded-xl bg-gray-50 text-sm font-semibold text-gray-800">✏️ Correct their details</button>
            )}
            {full && (
              <button onClick={() => { supportSave.clear(); setReset({ user: selected, why: '' }) }}
                className="text-left px-4 py-3 rounded-xl bg-gray-50 text-sm font-semibold text-gray-800">🔑 Reset two-step sign-in (lost phone)</button>
            )}
            {full && selected.status === 'active' && (
              <>
                <button onClick={() => askStatus(selected, 'suspended')} className="text-left px-4 py-3 rounded-xl text-sm font-semibold bg-red-50 text-red-600">⛔ Suspend account</button>
                <button onClick={() => askStatus(selected, 'deactivated')} className="text-left px-4 py-3 rounded-xl text-sm font-semibold bg-gray-50 text-gray-700">🚪 Deactivate account (the person has left)</button>
              </>
            )}
            {full && (selected.status === 'suspended' || selected.status === 'deactivated') && (
              <button onClick={() => askStatus(selected, 'active')} className="text-left px-4 py-3 rounded-xl text-sm font-semibold bg-teal-50 text-teal-800">✓ Reactivate account</button>
            )}
            {!full && <p className="text-[11px] text-gray-400">Only a full Admin can suspend or reactivate an account.</p>}
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm ? STOP[confirm.to].title : ''}
        subtitle={confirm ? `${confirm.user.name} · ${ROLE_LABEL[confirm.user.role]}` : ''}
        footer={<><SheetButton tone="ghost" onClick={() => setConfirm(null)}>Cancel</SheetButton>
          <SheetButton tone={confirm?.to === 'active' ? 'primary' : 'danger'} disabled={statusSave.busy || (needsWhy && why.trim().length < 5)} onClick={changeStatus}>
            {statusSave.busy ? 'Saving…' : confirm ? STOP[confirm.to].button : ''}</SheetButton></>}>
        {needsWhy && (
          <Field label="Reason *">
            <textarea value={why} onChange={e => setWhy(e.target.value)} rows={2} maxLength={300} className={`${inputCls} resize-none`}
              placeholder="Kept with the account and in the audit log; the person is told." />
          </Field>
        )}
        <p className="text-xs text-gray-600 leading-relaxed">{confirm ? STOP[confirm.to].text : ''} {needsWhy ? 'The account can be reactivated later.' : ''}</p>
        <SaveError message={statusSave.error} className="mt-3" />
      </BottomSheet>

      <BottomSheet open={!!details} onClose={() => setDetails(null)} title="Correct their details"
        subtitle={details ? `${details.user.name} · recorded as done for them, with your reason; they are told` : ''}
        footer={<><SheetButton tone="ghost" onClick={() => setDetails(null)}>Cancel</SheetButton>
          <SheetButton disabled={supportSave.busy || !details?.name.trim() || (details?.why.trim().length ?? 0) < 5} onClick={saveDetails}>{supportSave.busy ? 'Saving…' : 'Save details'}</SheetButton></>}>
        {details && (
          <>
            <Field label="Full name *"><input value={details.name} onChange={e => setDetails({ ...details, name: e.target.value })} className={inputCls} /></Field>
            <Field label="Phone"><input type="tel" value={details.phone} onChange={e => setDetails({ ...details, phone: e.target.value })} className={inputCls} /></Field>
            <Field label="Date of birth"><input type="date" value={details.dob} onChange={e => setDetails({ ...details, dob: e.target.value })} className={inputCls} /></Field>
            <Field label="Reason *">
              <textarea value={details.why} onChange={e => setDetails({ ...details, why: e.target.value })} rows={2} maxLength={200} className={`${inputCls} resize-none`}
                placeholder="e.g. Patient called to correct the phone number" />
            </Field>
            <p className="text-[11px] text-gray-400">The sign-in email is changed by the person themself, from their account settings.</p>
            <SaveError message={supportSave.error} className="mt-2" />
          </>
        )}
      </BottomSheet>

      <BottomSheet open={!!reset} onClose={() => setReset(null)} title="Reset two-step sign-in?"
        subtitle={reset ? `${reset.user.name} · ${reset.user.email}` : ''}
        footer={<><SheetButton tone="ghost" onClick={() => setReset(null)}>Cancel</SheetButton>
          <SheetButton tone="danger" disabled={supportSave.busy || (reset?.why.trim().length ?? 0) < 5} onClick={doReset}>{supportSave.busy ? 'Resetting…' : 'Reset'}</SheetButton></>}>
        {reset && (
          <>
            <p className="text-xs text-gray-600 leading-relaxed mb-3">For someone who lost the phone with their authenticator app. It is removed and they are signed out everywhere; they sign in with their password and set up a new one. Confirm who they are before you do this.</p>
            <Field label="Reason *">
              <textarea value={reset.why} onChange={e => setReset({ ...reset, why: e.target.value })} rows={2} maxLength={200} className={`${inputCls} resize-none`}
                placeholder="e.g. Lost phone; identity checked by video call" />
            </Field>
            <SaveError message={supportSave.error} className="mt-2" />
          </>
        )}
      </BottomSheet>
    </Page>
  )
}

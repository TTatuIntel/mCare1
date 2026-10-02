import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { DoctorUser, AdminUser } from '@/shared/lib/types'
import { PERM_LABELS, ALL_PERMS } from '@/shared/lib/types'
import { calcAge } from '@/shared/lib/vitals'
import { Avatar, Pill, Chevron, InfoRow } from '@/shared/ui/primitives'
import { MailboxSheet } from '@/shared/email/Mailbox'
import { EditProfileSheet, ChangePasswordSheet, ThemeFontSheet, HelpSupportSheet, DeactivateAccountSheet } from './AccountSheets'

/* ─── ProfileCard ───────────────────────────────────────────────────── */
/**
 * Uniform profile card used in every role.
 * Reads currentUser from context — no props needed.
 * Pass children to inject role-specific sections between details and sign-out.
 */
export function ProfileCard({ children }: { children?: React.ReactNode }) {
  const { currentUser, setCurrentUser, live } = useApp()
  const [showEdit, setShowEdit]         = useState(false)
  const [showPw, setShowPw]             = useState(false)
  const [showTheme, setShowTheme]       = useState(false)
  const [showHelp, setShowHelp]         = useState(false)
  const [showMail, setShowMail]         = useState(false)
  const [showDeactivate, setShowDeactivate] = useState(false)
  if (!currentUser) return null

  const rolePill: Record<string, string> = {
    patient:   'teal',
    doctor:    'blue',
    admin:     'purple',
    assistant: 'purple',
  }

  const statusPill: Record<string, string> = {
    active:           'green',
    unverified:       'amber',
    pending_approval: 'blue',
    suspended:        'red',
  }

  const doctor    = currentUser.role === 'doctor'                                           ? currentUser as DoctorUser : null
  const adminUser = currentUser.role === 'admin' || currentUser.role === 'assistant'       ? currentUser as AdminUser  : null
  const age = currentUser.dob ? calcAge(currentUser.dob) : null

  const coreRows: [string, string][] = [
    ['Email',        currentUser.email],
    ['Phone',        currentUser.phone || '—'],
    ...(currentUser.dob ? [['Date of Birth', `${currentUser.dob}${age !== null ? ` · Age ${age}` : ''}`] as [string, string]] : []),
    ['Member since', currentUser.createdAt],
  ]

  const extraRows: [string, string][] = doctor
    ? [['Specialty', doctor.specialty], ['Licence No.', doctor.licenseNo], ['Hospital', doctor.hospital]]
    : adminUser?.isAssistant
    ? [['Role', 'mCare Assistant'], ['Permissions', `${adminUser.permissions.length} of ${ALL_PERMS.length} granted`]]
    : []

  const allRows = [...coreRows, ...extraRows]

  return (
    <div className="flex flex-col gap-4">
      {/* avatar hero — identical across all roles */}
      <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
        <div className="mx-auto mb-3 w-fit">
          <Avatar name={currentUser.name} avatar={currentUser.avatar} size="lg" />
        </div>
        <p className="text-xl font-black text-gray-900 font-display">
          {currentUser.name}
        </p>
        {doctor && <p className="text-xs text-gray-500 mt-0.5">{doctor.specialty}</p>}
        <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
          <Pill color={rolePill[currentUser.role]}>
            {currentUser.role === 'assistant' ? 'mCare Assistant' : currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)}
          </Pill>
          <Pill color={statusPill[currentUser.status] ?? 'gray'}>
            {currentUser.status.replace(/_/g, ' ')}
          </Pill>
        </div>
      </div>

      {/* account details — uniform row layout */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Account Details</p>
        {allRows.map(([l, v]) => <InfoRow key={l} label={l} value={v} />)}
      </div>

      {/* assistant permissions summary */}
      {adminUser?.isAssistant && adminUser.permissions.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">My Permissions</p>
          <div className="flex flex-wrap gap-1.5">
            {adminUser.permissions.map(p => (
              <span key={p} className="text-[9px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-semibold">
                {PERM_LABELS[p]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* account settings — edit, password, theme, help (uniform across all roles) */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 pt-4 pb-1">Account Settings</p>
        <SettingsRow icon="✏️" label="Edit Profile" onClick={() => setShowEdit(true)} />
        <SettingsRow icon="🔒" label="Change Password" onClick={() => setShowPw(true)} />
        <SettingsRow icon="🎨" label="Theme & Font" onClick={() => setShowTheme(true)} />
        {/* Demo mode shows the emails mCare would send. In live mode they go to the person's real inbox. */}
        {!live && <SettingsRow icon="📧" label="Messages from mCare" onClick={() => setShowMail(true)} />}
        <SettingsRow icon="💬" label="Help & Support" onClick={() => setShowHelp(true)} />
        <SettingsRow icon="🚫" label="Deactivate Account" onClick={() => setShowDeactivate(true)} danger last />
      </div>

      <EditProfileSheet open={showEdit} onClose={() => setShowEdit(false)} />
      <ChangePasswordSheet open={showPw} onClose={() => setShowPw(false)} />
      <ThemeFontSheet open={showTheme} onClose={() => setShowTheme(false)} />
      <HelpSupportSheet open={showHelp} onClose={() => setShowHelp(false)} />
      <MailboxSheet address={currentUser.email} phone={currentUser.phone} open={showMail} onClose={() => setShowMail(false)} />
      <DeactivateAccountSheet open={showDeactivate} onClose={() => setShowDeactivate(false)} />

      {/* role-specific injected content */}
      {children}

      {/* sign out — identical across all roles */}
      <button
        onClick={() => setCurrentUser(null)}
        className="w-full py-3 rounded-2xl text-red-500 font-bold text-sm bg-red-50 border-2 border-red-100 active:bg-red-100 transition-colors"
      >
        Sign Out
      </button>
    </div>
  )
}

/* ─── SettingsRow ───────────────────────────────────────────────────── */
function SettingsRow({ icon, label, onClick, last, danger }: { icon: string; label: string; onClick: () => void; last?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${last ? '' : 'border-b border-gray-50'}`}>
      <span className="text-base w-6 text-center flex-shrink-0">{icon}</span>
      <span className={`flex-1 text-sm font-semibold ${danger ? 'text-red-500' : 'text-gray-800'}`}>{label}</span>
      <Chevron />
    </button>
  )
}

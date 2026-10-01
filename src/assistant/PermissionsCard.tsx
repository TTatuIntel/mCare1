import { PERM_LABELS } from '@/shared/lib/types'
import type { AdminUser } from '@/shared/lib/types'
import { Pill } from '@/shared'

/** "What can I do?" summary shown on an assistant's home screen. */
export function PermissionsCard({ user }: { user: AdminUser }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Your active permissions</p>
      {user.permissions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {user.permissions.map(p => <Pill key={p} color="teal">{PERM_LABELS[p]}</Pill>)}
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic">No permissions granted yet — ask an administrator.</p>
      )}
    </div>
  )
}
